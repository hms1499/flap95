# Flap95 — Settlement Liveness Design

**Date:** 2026-07-18
**Status:** Approved, ready for implementation plan
**Goal:** Guarantee that staked funds can never be locked forever, and that a
duel always resolves — even if the oracle dies, the acceptor abandons, or a
settle relay fails.

## Problem

Flap95 duels lock real stablecoin stakes in the `DuelEscrow` contract. Two
failure modes can trap funds or corrupt the game economy:

1. **Oracle death → funds locked forever.** Once both players stake, a duel is
   `Accepted`. The only exit is `settle()`, which requires the oracle's EIP-712
   signature. If the oracle loses its key, runs out of gas, or goes offline,
   every `Accepted` duel's stakes are stuck permanently. `cancelExpired()` only
   covers `Open` duels (before anyone accepts).

2. **Abandon / relay-failure → stuck or economically broken.**
   - The acceptor plays while watching the creator's ghost score in real time.
     If they see they're losing, they can close the tab and never submit a run.
     The duel stays `Accepted` on-chain and `accepted` in the DB, and never
     settles.
   - `replay/route.ts` currently marks the DB row `settled` **even when
     `relaySettle` returns `null`** (the on-chain settle failed). The DB says
     "settled" while the chain is still `Accepted` and funds are locked, and any
     sweep keyed on `status='accepted'` misses it.

A naive "refund both after a timeout" reintroduces an exploit: a losing acceptor
could stall to dodge the loss. The fix must separate the *trustless escape hatch*
(for genuine oracle death) from the *normal-operation forfeit* (for abandonment),
and keep the escape-hatch timeout long enough that stalling is never worthwhile
while the oracle is alive.

## Approach

Two cooperating layers:

- **On-chain (trustless escape hatch):** a permissionless `refundStale()` that
  refunds both stakers after a long timeout (24h) from acceptance. Only ever
  triggers on real oracle death. Because the chain cannot know who *should* have
  won without the oracle, it refunds both — the fair outcome when the oracle is
  absent.
- **Off-chain (normal-operation reconciler):** a Vercel Cron reconciler that,
  while the oracle is alive, forfeits abandoning acceptors quickly (30 min),
  retries failed settle relays, and monitors oracle gas balance. The 30-min
  forfeit window is far shorter than the 24h refund timeout, so stalling for a
  refund is never a viable strategy under normal operation.

## Parameters (approved)

| Parameter | Value | Rationale |
|---|---|---|
| Off-chain forfeit window | **30 min** after accept | Generous vs a ~60s run; creator paid promptly on abandon. |
| On-chain `SETTLE_TIMEOUT` | **24 h** after accept | Only fires on true oracle death; matches existing `EXPIRY`. |
| `refundStale` semantics | **Refund both** | Chain can't determine winner without oracle. |
| Cron cadence | ~every 10 min | Bounds abandon-forfeit latency near the 30-min window. |
| Redeploy | New contract, no migration | Pre-launch: no real funds in `0x2524…`. |

## Component 1 — Contract `DuelEscrow` v2 (redeploy)

Changes to `contracts/src/DuelEscrow.sol`:

- Add `uint40 acceptedAt` to the `Duel` struct. It packs into the existing slot
  alongside `createdAt (5) + status (1) + token (20) = 26`, leaving room for
  `acceptedAt (5) = 31 ≤ 32` — **no new storage slot**.
- In `acceptDuel`, set `d.acceptedAt = uint40(block.timestamp)`.
- Add `uint256 public constant SETTLE_TIMEOUT = 24 hours;`
- Add `event DuelRefunded(uint256 indexed id);`
- Add the permissionless function:

```solidity
function refundStale(uint256 id) external {
    Duel storage d = duels[id];
    if (d.status != Status.Accepted) revert WrongStatus();
    if (block.timestamp <= d.acceptedAt + SETTLE_TIMEOUT) revert NotExpired();
    d.status = Status.Cancelled;
    d.token.safeTransfer(d.creator, d.stake);
    d.token.safeTransfer(d.acceptor, d.stake);
    emit DuelRefunded(id);
}
```

Everything else (create/accept/settle/cancelExpired/fee math/tie handling) is
unchanged. `NotExpired`, `WrongStatus`, `Status.Cancelled` already exist and are
reused. After deploy, update `ESCROW_ADDRESS` and the ABI in
`frontend/src/lib/contracts.ts`.

**Deploy:** via the existing Foundry `script/Deploy.s.sol` with the same
constructor args (tokens, oracle, treasury, owner) used for the current mainnet
deploy. Record the new address; the old `0x2524…` is abandoned (no funds).

## Component 2 — Foundry tests (`contracts/test/DuelEscrow.t.sol`)

New cases:

1. `acceptDuel` sets `acceptedAt == block.timestamp`.
2. `refundStale` reverts `NotExpired` before `acceptedAt + SETTLE_TIMEOUT`.
3. `refundStale` reverts `WrongStatus` when duel is `Open`, `Settled`, or
   `Cancelled`.
4. After the timeout, `refundStale` transfers exactly `stake` back to each of
   creator and acceptor, sets status `Cancelled`, and emits `DuelRefunded`.
5. `refundStale` cannot be called twice (second call reverts `WrongStatus`).
6. Invariant: the contract's token balance equals the sum of stakes across all
   duels not in a terminal state (`Settled`/`Cancelled`) — use Foundry's
   `StdInvariant` (already in deps).

## Component 3 — Off-chain reconciler

New protected route `frontend/src/app/api/cron/reconcile/route.ts`, guarded by a
`CRON_SECRET` bearer/header check, invoked by Vercel Cron every ~10 min. It runs
three passes:

| Case | Condition | Action |
|---|---|---|
| **Abandoned acceptor** | `status='accepted'` AND `updated_at < now()-30min` AND `acceptor_taps IS NULL` | Record forfeit result (creator wins, `scoreB=0`), then `relaySettle`; on success mark `settled`, on `null` mark `settling`. |
| **Relay retry** | `status='settling'` | Retry `relaySettle` with the stored `winner`/scores + `onchain_id`; on success mark `settled`, else leave `settling`. |
| **Oracle-death backstop** | `status='accepted'` AND `updated_at < now()-24h` | Log/alert only. UI + permissionless `refundStale` handle the actual refund. |

Both settle-emitting cases share one path: compute the outcome, attempt
`relaySettle`, and branch on the result (`settled` vs `settling`) — the same
success/failure split applied in the fixed `replay/route.ts`.

Plus an **oracle gas check**: read the oracle account's CELO and fee-currency
(USDm) balances; log a warning when below a configurable threshold (e.g.
`< 0.5 CELO` or `< 1 USDm`). Low gas is the primary cause of settlement stalls.

### DB and store changes (`frontend/src/lib/duelStore.ts` + Neon migration)

- Add `'settling'` to the `DuelStatus` union and to the DB status domain.
  Migration also adds an index on `(status, updated_at)` for the sweep queries.
- New store functions:
  - `listStaleAccepted(cutoffMinutes)` → accepted duels past cutoff with
    `acceptor_taps IS NULL`.
  - `listPendingSettlement()` → `status='settling'` rows.
  - `markSettling(id, taps, score, winner)` — stores the computed acceptor
    result and sets status `settling` (guarded on `status='accepted'`).
  - `markSettled(id, settleTx)` — sets `settle_tx` and status `settled`
    (guarded on `status IN ('accepted','settling')`).
  - The abandoned-forfeit path reuses `markSettling` (with `taps=[]`, `score=0`,
    `winner='creator'`) followed by `markSettled` on relay success — no separate
    `forfeitAcceptor` needed.

### `replay/route.ts` fix

When `relaySettle` returns a hash → `markSettled` (`settled`). When it returns
`null` → `markSettling` (`settling`) so the reconciler retries, instead of the
current behavior that marks `settled` with a null tx.

## Component 4 — Frontend reclaim

On the duel detail page (`frontend/src/app/duels/[id]/page.tsx`): when a duel is
`accepted`, older than 24h, and the connected wallet is the creator or acceptor,
show a **"Reclaim stake"** action that calls `refundStale(id)` via
`writeContract` (with `feeCurrencyOverrides()`), then routes back to the duel
list. Update the ABI/address import.

## Out of scope (named, not built here)

- Anti-cheat hardening (server-measured play time, anomaly detection) — separate
  effort; this spec does not make the deterministic replay cheat-proof.
- Multi-oracle / threshold signing — a single oracle remains, now with a
  trustless escape hatch behind it.
- General observability stack (Sentry, event indexer) beyond the oracle-gas log.

## Success criteria

1. Foundry suite (existing + new) passes, including the balance invariant.
2. A duel accepted with no acceptor submission is auto-forfeited to the creator
   within ~40 min (30-min window + cron cadence).
3. A settle whose relay fails is retried and eventually confirmed on-chain by the
   reconciler.
4. An `Accepted` duel with a dead oracle can be refunded by either party (or any
   caller) after 24h via `refundStale`, returning each stake exactly once.
5. Frontend shows a working "Reclaim stake" action on stuck duels.
