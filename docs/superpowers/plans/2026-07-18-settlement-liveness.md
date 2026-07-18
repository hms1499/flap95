# Settlement Liveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee Flap95 duel stakes can never lock forever — via an on-chain `refundStale` escape hatch plus an off-chain reconciler that forfeits abandoners, retries failed settles, and watches oracle gas.

**Architecture:** Redeploy `DuelEscrow` with a permissionless 24h `refundStale(id)` that refunds both stakers. Add a Vercel-Cron reconciler route whose decision logic lives in a pure, unit-tested function; it forfeits acceptors who never submit (30 min), retries `settling` rows whose relay failed, and logs low oracle gas. Fix `replay/route.ts` to mark `settling` (not `settled`) when a relay fails.

**Tech Stack:** Solidity 0.8.26 + Foundry (forge-std, OpenZeppelin), Next.js 16 App Router, viem, Neon Postgres, Vitest, Vercel Cron.

## Global Constraints

- Solidity `pragma ^0.8.26`; contracts under `contracts/`, tests run with `forge test`.
- Frontend under `frontend/`; **Next.js 16** — read `frontend/node_modules/next/dist/docs/` before using unfamiliar APIs (per `frontend/AGENTS.md`).
- Frontend tests run with `npm test` (Vitest) from `frontend/`.
- DB `duels.status` is a plain `text` column (no CHECK) — new status values need code only, no DDL.
- Off-chain forfeit window: **30 minutes**. On-chain `SETTLE_TIMEOUT`: **24 hours**. Cron cadence: **every 10 minutes**.
- Stake tiers are 0.1 / 0.5 / 1 whole tokens; `1e18` is a valid tier for an 18-decimal token.
- Commit messages end with the repo's `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

---

## File Structure

- `contracts/src/DuelEscrow.sol` — **modify**: add `acceptedAt`, `SETTLE_TIMEOUT`, `DuelRefunded`, `refundStale`.
- `contracts/test/DuelEscrow.t.sol` — **modify**: fix struct destructures (arity +1), add `refundStale` unit tests.
- `contracts/test/DuelEscrowInvariant.t.sol` — **create**: stateful solvency invariant.
- `frontend/src/lib/contracts.ts` — **modify**: add `refundStale` + `DuelRefunded`/`DuelCancelled` to the ABI; address comes from env.
- `frontend/schema.sql` — **modify**: add composite index `(status, updated_at)`.
- `frontend/src/lib/duelStore.ts` — **modify**: add `'settling'` status + `updatedAt` field; add `markSettling`, `markSettled`, `listReconcileCandidates`; keep `setAcceptorResult` removed in favor of the split.
- `frontend/src/lib/reconcile.ts` — **create**: pure `planReconcileAction`.
- `frontend/src/lib/reconcile.test.ts` — **create**: Vitest for the pure logic.
- `frontend/src/lib/oracle.ts` — **modify**: export `oracleAddress()`.
- `frontend/src/app/api/duels/[id]/replay/route.ts` — **modify**: split settled/settling on relay result.
- `frontend/src/app/api/cron/reconcile/route.ts` — **create**: the reconciler.
- `frontend/vercel.json` — **create**: cron schedule.
- `frontend/src/app/api/duels/[id]/route.ts` — **modify**: include `updatedAt`.
- `frontend/src/app/duels/[id]/page.tsx` — **modify**: "Reclaim stake" action.

---

## Task 1: Contract — `acceptedAt` + `refundStale`

**Files:**
- Modify: `contracts/src/DuelEscrow.sol`
- Test: `contracts/test/DuelEscrow.t.sol`

**Interfaces:**
- Produces: `function refundStale(uint256 id) external`; `uint256 public constant SETTLE_TIMEOUT = 24 hours`; `event DuelRefunded(uint256 indexed id)`; the public `duels(id)` getter now returns a **7-tuple** ending in `uint40 acceptedAt`.

- [ ] **Step 1: Fix existing struct destructures for the new 7th field**

In `contracts/test/DuelEscrow.t.sol`, replace each of these lines (the `duels(id)` getter gains a trailing `uint40 acceptedAt`, so every destructure needs one extra trailing skip):

Line ~57:
```solidity
        (address creator,, uint96 stake,, DuelEscrow.Status status, IERC20 token,) = escrow.duels(id);
```
Line ~67:
```solidity
        (,, uint96 stake,,, IERC20 token,) = escrow.duels(id);
```
Line ~112:
```solidity
        (, address acceptor,,, DuelEscrow.Status status,,) = escrow.duels(id);
```
Lines ~145 and ~170 (both identical):
```solidity
        (,,,, DuelEscrow.Status status,,) = escrow.duels(id);
```

- [ ] **Step 2: Write the failing `refundStale` tests**

Append to `contracts/test/DuelEscrow.t.sol`, before the final closing `}`:

```solidity
    function test_acceptDuel_recordsAcceptedAt() public {
        uint256 id = _create(usdm, 1e18);
        vm.warp(block.timestamp + 100);
        uint256 t = block.timestamp;
        vm.prank(bob); escrow.acceptDuel(id);
        (,,,,,, uint40 acceptedAt) = escrow.duels(id);
        assertEq(uint256(acceptedAt), t);
    }

    function test_refundStale_refundsBothAfterTimeout() public {
        uint256 id = _acceptedDuel(usdm, 1e18);
        vm.warp(block.timestamp + escrow.SETTLE_TIMEOUT() + 1);
        vm.expectEmit(true, false, false, false);
        emit DuelEscrow.DuelRefunded(id);
        escrow.refundStale(id);
        assertEq(usdm.balanceOf(alice), 100e18);
        assertEq(usdm.balanceOf(bob), 100e18);
        assertEq(usdm.balanceOf(address(escrow)), 0);
        (,,,, DuelEscrow.Status status,,) = escrow.duels(id);
        assertEq(uint8(status), uint8(DuelEscrow.Status.Cancelled));
    }

    function test_refundStale_rejectsBeforeTimeout() public {
        uint256 id = _acceptedDuel(usdm, 1e18);
        vm.expectRevert(DuelEscrow.NotExpired.selector);
        escrow.refundStale(id);
    }

    function test_refundStale_rejectsOpenDuel() public {
        uint256 id = _create(usdm, 1e18);
        vm.warp(block.timestamp + escrow.SETTLE_TIMEOUT() + 1);
        vm.expectRevert(DuelEscrow.WrongStatus.selector);
        escrow.refundStale(id);
    }

    function test_refundStale_rejectsDoubleCall() public {
        uint256 id = _acceptedDuel(usdm, 1e18);
        vm.warp(block.timestamp + escrow.SETTLE_TIMEOUT() + 1);
        escrow.refundStale(id);
        vm.expectRevert(DuelEscrow.WrongStatus.selector);
        escrow.refundStale(id);
    }
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd contracts && forge test --match-contract DuelEscrowTest`
Expected: compile error or FAIL — `refundStale`, `SETTLE_TIMEOUT`, `DuelRefunded`, and the 7th tuple field do not exist yet.

- [ ] **Step 4: Implement the contract changes**

In `contracts/src/DuelEscrow.sol`:

Add `acceptedAt` to the struct (end of `Duel`):
```solidity
    struct Duel {
        address creator;
        address acceptor;
        uint96 stake;
        uint40 createdAt;
        Status status;
        IERC20 token;
        uint40 acceptedAt;
    }
```

Add the constant next to `EXPIRY`:
```solidity
    uint256 public constant SETTLE_TIMEOUT = 24 hours;
```

Add the event next to `DuelCancelled`:
```solidity
    event DuelRefunded(uint256 indexed id);
```

In `acceptDuel`, set `acceptedAt` (add after `d.status = Status.Accepted;`):
```solidity
        d.acceptedAt = uint40(block.timestamp);
```

Add the function after `cancelExpired`:
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

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd contracts && forge test --match-contract DuelEscrowTest`
Expected: PASS (all existing + 5 new tests).

- [ ] **Step 6: Commit**

```bash
git add contracts/src/DuelEscrow.sol contracts/test/DuelEscrow.t.sol
git commit -m "feat(contract): refundStale escape hatch + acceptedAt

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Contract — solvency invariant

**Files:**
- Create: `contracts/test/DuelEscrowInvariant.t.sol`

**Interfaces:**
- Consumes: `DuelEscrow` (create/accept/settle/refundStale/cancelExpired), `settleDigest`, the 7-tuple `duels(id)` getter.

- [ ] **Step 1: Write the invariant test + handler**

Create `contracts/test/DuelEscrowInvariant.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DuelEscrow} from "../src/DuelEscrow.sol";

contract InvToken is ERC20 {
    constructor() ERC20("USDm", "USDm") {}
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

contract Handler is Test {
    DuelEscrow public escrow;
    InvToken public token;
    uint256 immutable oraclePk;
    address[3] actors;
    uint256[] public openIds;
    uint256[] public acceptedIds;
    mapping(uint256 => uint96) public stakeOf;
    uint256 public locked; // ghost: exact tokens that should sit in escrow
    uint96 constant STAKE = 1e18;

    constructor(DuelEscrow _e, InvToken _t, uint256 _pk, address a, address b, address c) {
        escrow = _e; token = _t; oraclePk = _pk; actors = [a, b, c];
    }

    function createDuel(uint256 actorSeed) public {
        vm.prank(actors[actorSeed % 3]);
        try escrow.createDuel(token, STAKE) returns (uint256 id) {
            openIds.push(id); stakeOf[id] = STAKE; locked += STAKE;
        } catch {}
    }

    function acceptDuel(uint256 idSeed, uint256 actorSeed) public {
        if (openIds.length == 0) return;
        uint256 idx = idSeed % openIds.length; uint256 id = openIds[idx];
        vm.prank(actors[actorSeed % 3]);
        try escrow.acceptDuel(id) {
            _rmOpen(idx); acceptedIds.push(id); locked += stakeOf[id];
        } catch {}
    }

    function settle(uint256 idSeed, uint256 wSeed) public {
        if (acceptedIds.length == 0) return;
        uint256 idx = idSeed % acceptedIds.length; uint256 id = acceptedIds[idx];
        (address creator, address acceptor,,,,,) = escrow.duels(id);
        address winner = wSeed % 3 == 0 ? address(0) : (wSeed % 3 == 1 ? creator : acceptor);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oraclePk, escrow.settleDigest(id, winner, 1, 2));
        try escrow.settle(id, winner, 1, 2, abi.encodePacked(r, s, v)) {
            _rmAccepted(idx); locked -= uint256(stakeOf[id]) * 2;
        } catch {}
    }

    function refundStale(uint256 idSeed, uint256 warpBy) public {
        if (acceptedIds.length == 0) return;
        uint256 idx = idSeed % acceptedIds.length; uint256 id = acceptedIds[idx];
        vm.warp(block.timestamp + (warpBy % 3 days));
        try escrow.refundStale(id) {
            _rmAccepted(idx); locked -= uint256(stakeOf[id]) * 2;
        } catch {}
    }

    function cancelExpired(uint256 idSeed, uint256 warpBy) public {
        if (openIds.length == 0) return;
        uint256 idx = idSeed % openIds.length; uint256 id = openIds[idx];
        vm.warp(block.timestamp + (warpBy % 3 days));
        try escrow.cancelExpired(id) {
            _rmOpen(idx); locked -= stakeOf[id];
        } catch {}
    }

    function _rmOpen(uint256 i) internal { openIds[i] = openIds[openIds.length - 1]; openIds.pop(); }
    function _rmAccepted(uint256 i) internal { acceptedIds[i] = acceptedIds[acceptedIds.length - 1]; acceptedIds.pop(); }
}

contract DuelEscrowInvariantTest is StdInvariant, Test {
    DuelEscrow escrow;
    InvToken token;
    Handler handler;
    uint256 oraclePk = 0xA11CE;

    function setUp() public {
        token = new InvToken();
        IERC20[] memory tokens = new IERC20[](1);
        tokens[0] = token;
        escrow = new DuelEscrow(tokens, vm.addr(oraclePk), address(0xFEE), address(this));
        address a = address(0xA1); address b = address(0xB1); address c = address(0xC1);
        handler = new Handler(escrow, token, oraclePk, a, b, c);
        address[3] memory who = [a, b, c];
        for (uint256 i = 0; i < 3; i++) {
            token.mint(who[i], 1_000_000e18);
            vm.prank(who[i]);
            token.approve(address(escrow), type(uint256).max);
        }
        targetContract(address(handler));
    }

    function invariant_escrowSolvent() public view {
        assertEq(token.balanceOf(address(escrow)), handler.locked());
    }
}
```

- [ ] **Step 2: Run the invariant**

Run: `cd contracts && forge test --match-contract DuelEscrowInvariantTest`
Expected: PASS — `invariant_escrowSolvent` holds across fuzzed sequences (escrow balance always equals the ghost `locked`).

- [ ] **Step 3: Commit**

```bash
git add contracts/test/DuelEscrowInvariant.t.sol
git commit -m "test(contract): escrow solvency invariant

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Deploy v2 + wire frontend ABI/address

**Files:**
- Modify: `frontend/src/lib/contracts.ts:32-59` (ABI)

**Interfaces:**
- Consumes: the deployed v2 address (set via `NEXT_PUBLIC_ESCROW_ADDRESS`).
- Produces: `duelEscrowAbi` entries `refundStale`, event `DuelRefunded`, event `DuelCancelled`.

- [ ] **Step 1: Add the new ABI entries**

In `frontend/src/lib/contracts.ts`, inside the `duelEscrowAbi` array, add after the `cancelExpired` function entry (line ~45):
```typescript
  { type: 'function', name: 'refundStale', stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint256' }], outputs: [] },
```
and add these event entries after the `DuelSettled` event (line ~58):
```typescript
  { type: 'event', name: 'DuelCancelled', inputs: [
      { name: 'id', type: 'uint256', indexed: true }] },
  { type: 'event', name: 'DuelRefunded', inputs: [
      { name: 'id', type: 'uint256', indexed: true }] },
```

- [ ] **Step 2: Verify the frontend still type-checks and builds**

Run: `cd frontend && npm run build`
Expected: `✓ Compiled successfully` and TypeScript passes.

- [ ] **Step 3: Commit the ABI change**

```bash
git add frontend/src/lib/contracts.ts
git commit -m "feat(frontend): add refundStale + cancel/refund events to ABI

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 4: (HUMAN) Deploy the v2 contract to Celo mainnet**

> This broadcasts a real mainnet transaction with the deployer key — a human runs it, not an automated agent. Reuse the same constructor inputs as the current deploy.

```bash
cd contracts
export USDM_ADDRESS=0x765DE816845861e75A25fCA122bb6898B8B1282a
export USDC_ADDRESS=0xcebA9300f2b948710d2653dD7B07f33A8B32118C
export USDT_ADDRESS=0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e
export ORACLE_ADDRESS=0x90D9F192C63304535064ed1348c8Da7e45CF6ecd
export TREASURY_ADDRESS=0x64Ad61211C1b0B7f20B3e04B49661f30f152ae78
forge script script/Deploy.s.sol \
  --rpc-url https://forno.celo.org --broadcast \
  --verify --verifier sourcify \
  --private-key "$DEPLOYER_PRIVATE_KEY"
```
Record the new contract address from the broadcast output.

- [ ] **Step 5: (HUMAN) Point the frontend at the new address**

Update `NEXT_PUBLIC_ESCROW_ADDRESS` to the new address in **both** `frontend/.env.local` and the Vercel project env (`vercel env add NEXT_PUBLIC_ESCROW_ADDRESS` or the dashboard). Redeploy is handled later by the normal git push.

- [ ] **Step 6: (HUMAN) Sanity-check the deploy**

```bash
cast call <NEW_ADDRESS> "SETTLE_TIMEOUT()(uint256)" --rpc-url https://forno.celo.org
```
Expected: `86400` (24h in seconds).

---

## Task 4: DB migration + duelStore split

**Files:**
- Modify: `frontend/schema.sql:20`
- Modify: `frontend/src/lib/duelStore.ts`

**Interfaces:**
- Produces: `DuelStatus` gains `'settling'`; `DuelRow` gains `updatedAt: string`; new fns `markSettling(id, taps, score, winner)`, `markSettled(id, settleTx)`, `listReconcileCandidates()`. Removes `setAcceptorResult`.

- [ ] **Step 1: Add the composite index (schema + live DB)**

In `frontend/schema.sql`, after line 20 add:
```sql
create index if not exists duels_status_updated_idx on duels (status, updated_at);
```
Then apply it to the live Neon DB (HUMAN or via psql):
```bash
psql "$DATABASE_URL" -c "create index if not exists duels_status_updated_idx on duels (status, updated_at);"
```

- [ ] **Step 2: Extend the status union and row mapping**

In `frontend/src/lib/duelStore.ts`:

Change the status type (line 3):
```typescript
export type DuelStatus = 'draft' | 'funded' | 'open' | 'accepted' | 'settling' | 'settled' | 'cancelled';
```
Add `updatedAt` to `DuelRow` (after `createdAt: string;`):
```typescript
  updatedAt: string;
```
In `toRow`, map it (after the `createdAt` line):
```typescript
    updatedAt: String(r.updated_at ?? r.created_at),
```

- [ ] **Step 3: Replace `setAcceptorResult` with the split functions**

In `frontend/src/lib/duelStore.ts`, delete `setAcceptorResult` (lines ~75-82) and add:

```typescript
export async function markSettling(
  id: number, taps: number[], score: number, winner: 'creator' | 'acceptor' | 'tie',
): Promise<void> {
  await sql`update duels set acceptor_taps = ${JSON.stringify(taps)}::jsonb, acceptor_score = ${score},
    winner = ${winner}, status = 'settling', updated_at = now()
    where id = ${id} and status = 'accepted'`;
}

export async function markSettled(id: number, settleTx: string): Promise<void> {
  await sql`update duels set settle_tx = ${settleTx}, status = 'settled', updated_at = now()
    where id = ${id} and status in ('accepted', 'settling')`;
}

export async function listReconcileCandidates(): Promise<DuelRow[]> {
  const rows = await sql`
    select * from duels
    where status = 'settling'
       or (status = 'accepted' and updated_at < now() - interval '30 minutes')
    order by updated_at asc limit 100`;
  return rows.map(toRow);
}
```

- [ ] **Step 4: Verify build**

Run: `cd frontend && npm run build`
Expected: compile error at `replay/route.ts` (still imports `setAcceptorResult`). That is expected — Task 6 fixes it. Confirm the error is **only** the missing `setAcceptorResult` import, then proceed.

- [ ] **Step 5: Commit**

```bash
git add frontend/schema.sql frontend/src/lib/duelStore.ts
git commit -m "feat(db): settling status + reconcile candidate query

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Pure reconcile logic + tests

**Files:**
- Create: `frontend/src/lib/reconcile.ts`
- Test: `frontend/src/lib/reconcile.test.ts`

**Interfaces:**
- Consumes: a `DuelRow`-shaped object with `status`, `updatedAt`, `acceptorTaps`.
- Produces: `type ReconcileAction = 'forfeit' | 'retry' | 'stale-alert' | 'skip'`; `planReconcileAction(d, nowMs): ReconcileAction`; constants `FORFEIT_AFTER_MS = 1_800_000`, `STALE_AFTER_MS = 86_400_000`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/lib/reconcile.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { planReconcileAction, FORFEIT_AFTER_MS, STALE_AFTER_MS } from './reconcile';

const NOW = 1_000_000_000_000;
function row(over: Partial<Parameters<typeof planReconcileAction>[0]>) {
  return { status: 'accepted', updatedAt: new Date(NOW).toISOString(), acceptorTaps: null, ...over } as Parameters<typeof planReconcileAction>[0];
}

describe('planReconcileAction', () => {
  it('skips a freshly accepted duel', () => {
    expect(planReconcileAction(row({ updatedAt: new Date(NOW - 5 * 60_000).toISOString() }), NOW)).toBe('skip');
  });
  it('forfeits an accepted duel whose acceptor never submitted past the window', () => {
    expect(planReconcileAction(row({ updatedAt: new Date(NOW - FORFEIT_AFTER_MS - 1).toISOString() }), NOW)).toBe('forfeit');
  });
  it('retries a settling duel', () => {
    expect(planReconcileAction(row({ status: 'settling', updatedAt: new Date(NOW - 60_000).toISOString() }), NOW)).toBe('retry');
  });
  it('alerts on a settling duel stuck past the stale timeout', () => {
    expect(planReconcileAction(row({ status: 'settling', updatedAt: new Date(NOW - STALE_AFTER_MS - 1).toISOString() }), NOW)).toBe('stale-alert');
  });
  it('skips terminal statuses', () => {
    expect(planReconcileAction(row({ status: 'settled' }), NOW)).toBe('skip');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npm test -- reconcile`
Expected: FAIL — `./reconcile` module not found.

- [ ] **Step 3: Implement the pure logic**

Create `frontend/src/lib/reconcile.ts`:

```typescript
import type { DuelRow } from './duelStore';

export const FORFEIT_AFTER_MS = 30 * 60 * 1000;   // acceptor abandons -> forfeit
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000; // relay stuck this long -> oracle likely dead

export type ReconcileAction = 'forfeit' | 'retry' | 'stale-alert' | 'skip';

/** Decide what the reconciler should do with one duel row. Pure + timezone-safe. */
export function planReconcileAction(
  d: Pick<DuelRow, 'status' | 'updatedAt' | 'acceptorTaps'>,
  nowMs: number,
): ReconcileAction {
  const ageMs = nowMs - Date.parse(d.updatedAt);
  if (d.status === 'settling') return ageMs >= STALE_AFTER_MS ? 'stale-alert' : 'retry';
  if (d.status === 'accepted' && d.acceptorTaps === null && ageMs >= FORFEIT_AFTER_MS) return 'forfeit';
  return 'skip';
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npm test -- reconcile`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/reconcile.ts frontend/src/lib/reconcile.test.ts
git commit -m "feat: pure reconcile decision logic

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Fix `replay/route.ts` settled/settling split

**Files:**
- Modify: `frontend/src/app/api/duels/[id]/replay/route.ts`

**Interfaces:**
- Consumes: `markSettling`, `markSettled` (Task 4); `relaySettle`, `decideWinner` (existing).

- [ ] **Step 1: Update the acceptor branch**

In `frontend/src/app/api/duels/[id]/replay/route.ts`, change the import (line 4):
```typescript
import { getDuel, setCreatorRun, markSettling, markSettled } from '@/lib/duelStore';
```
Replace the settle block in the `acceptor` branch (the `const settleTx = ...` and `await setAcceptorResult(...)` lines) with:
```typescript
    await markSettling(duel.id, r.ok ? taps : [], acceptorScore, winner);
    const settleTx = await relaySettle(BigInt(duel.onchainId), winnerAddr, duel.creatorScore, acceptorScore);
    if (settleTx) await markSettled(duel.id, settleTx);
```
The response object stays the same (it already returns `settleTx`, which is `null` when the relay failed — the reconciler will retry the `settling` row).

- [ ] **Step 2: Verify build passes now**

Run: `cd frontend && npm run build`
Expected: `✓ Compiled successfully`, TypeScript passes (the `setAcceptorResult` error from Task 4 is resolved).

- [ ] **Step 3: Run the full frontend test suite**

Run: `cd frontend && npm test`
Expected: PASS (existing 23 + reconcile tests).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/api/duels/[id]/replay/route.ts
git commit -m "fix(settle): mark settling (not settled) when relay fails

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Reconciler route + oracle gas check + cron

**Files:**
- Modify: `frontend/src/lib/oracle.ts`
- Create: `frontend/src/app/api/cron/reconcile/route.ts`
- Create: `frontend/vercel.json`

**Interfaces:**
- Consumes: `listReconcileCandidates`, `markSettling`, `markSettled` (Task 4); `planReconcileAction` (Task 5); `relaySettle` (existing).
- Produces: `oracleAddress(): Address` in `oracle.ts`.

- [ ] **Step 1: Export the oracle address helper**

In `frontend/src/lib/oracle.ts`, add after `oracleAccount()`:
```typescript
export function oracleAddress(): Address {
  return oracleAccount().address;
}
```

- [ ] **Step 2: Write the reconciler route**

Create `frontend/src/app/api/cron/reconcile/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import { zeroAddress, formatEther, type Address } from 'viem';
import { publicClient } from '@/lib/chain';
import { USDM_ADDRESS, erc20Abi } from '@/lib/contracts';
import { relaySettle, oracleAddress } from '@/lib/oracle';
import { listReconcileCandidates, markSettling, markSettled, type DuelRow } from '@/lib/duelStore';
import { planReconcileAction } from '@/lib/reconcile';

export const dynamic = 'force-dynamic';

const LOW_CELO = 5n * 10n ** 17n; // 0.5 CELO
const LOW_USDM = 1n * 10n ** 18n; // 1 USDm

function winnerAddress(d: DuelRow): Address {
  return d.winner === 'tie' ? zeroAddress
    : d.winner === 'acceptor' ? (d.acceptor as Address)
    : (d.creator as Address);
}

async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const now = Date.now();
  const results: { id: number; action: string; settleTx?: string | null }[] = [];

  for (const d of await listReconcileCandidates()) {
    const action = planReconcileAction(d, now);
    if (action === 'skip') { continue; }
    if (action === 'stale-alert') {
      console.warn(`[reconcile] duel ${d.id} stuck >24h — refundStale is available on-chain`);
      results.push({ id: d.id, action });
      continue;
    }
    if (!d.onchainId || d.creatorScore === null) { results.push({ id: d.id, action: 'skip-incomplete' }); continue; }

    if (action === 'forfeit') {
      await markSettling(d.id, [], 0, 'creator');
    }
    const winner: Address = action === 'forfeit' ? (d.creator as Address) : winnerAddress(d);
    const scoreB = action === 'forfeit' ? 0 : (d.acceptorScore ?? 0);
    const settleTx = await relaySettle(BigInt(d.onchainId), winner, d.creatorScore, scoreB);
    if (settleTx) await markSettled(d.id, settleTx);
    results.push({ id: d.id, action, settleTx });
  }

  // Oracle gas health — low gas is the #1 cause of settlement stalls.
  const oracle = oracleAddress();
  const celoBal = await publicClient.getBalance({ address: oracle });
  const usdmBal = await publicClient.readContract({
    address: USDM_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [oracle],
  });
  const lowGas = celoBal < LOW_CELO && usdmBal < LOW_USDM;
  if (lowGas) console.warn(`[reconcile] LOW ORACLE GAS celo=${formatEther(celoBal)} usdm=${formatEther(usdmBal)}`);

  return NextResponse.json({
    processed: results.length, results,
    oracle: { address: oracle, celoBal: celoBal.toString(), usdmBal: usdmBal.toString(), lowGas },
  });
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }
```

- [ ] **Step 3: Add the Vercel cron schedule**

Create `frontend/vercel.json`:
```json
{
  "crons": [
    { "path": "/api/cron/reconcile", "schedule": "*/10 * * * *" }
  ]
}
```
> **Note (HUMAN):** `*/10` (every 10 min) requires a Vercel **Pro** plan; Hobby crons run at most daily. If on Hobby, either upgrade or point an external scheduler (e.g. cron-job.org / GitHub Actions) at `https://<domain>/api/cron/reconcile` with header `Authorization: Bearer $CRON_SECRET`. Set the `CRON_SECRET` env var in Vercel either way.

- [ ] **Step 4: Verify build**

Run: `cd frontend && npm run build`
Expected: `✓ Compiled successfully`; the route appears as `ƒ /api/cron/reconcile` in the route list.

- [ ] **Step 5: Smoke-test the route locally (no auth in dev)**

Run: `cd frontend && npm run dev` then in another shell:
```bash
curl -s -X POST http://localhost:3000/api/cron/reconcile | head -c 400
```
Expected: JSON with `processed`, `results`, and an `oracle` block (reads the oracle balances). It will process 0 rows on an empty DB — that is fine; we only need a 200 with the oracle block.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/oracle.ts frontend/src/app/api/cron/reconcile/route.ts frontend/vercel.json
git commit -m "feat: settlement reconciler cron (forfeit, retry, gas check)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Frontend "Reclaim stake" for stuck duels

**Files:**
- Modify: `frontend/src/app/api/duels/[id]/route.ts:9-16`
- Modify: `frontend/src/app/duels/[id]/page.tsx`

**Interfaces:**
- Consumes: `duelEscrowAbi.refundStale` (Task 3); `feeCurrencyOverrides` (existing).

- [ ] **Step 1: Return `updatedAt` from the detail API**

In `frontend/src/app/api/duels/[id]/route.ts`, add `updatedAt` to the JSON response object (inside `NextResponse.json({ ... })`):
```typescript
    updatedAt: d.updatedAt,
```

- [ ] **Step 2: Add a reclaim path to the duel page**

In `frontend/src/app/duels/[id]/page.tsx`:

Extend the `Detail` interface (line ~14) to include the fields we now use:
```typescript
interface Detail { id: number; onchainId: string; status: string; stakeWei: string; token: string | null; creator: string; acceptor: string | null; updatedAt: string }
```

In the initial `useEffect` that sets phase, allow the stuck-accepted case (replace the `setPhase(d.status === 'open' ? 'preview' : 'error')` block):
```typescript
      setDetail(d);
      if (d.status === 'open') { setPhase('preview'); return; }
      const stale = d.status === 'accepted'
        && Date.now() - Date.parse(d.updatedAt) > 24 * 60 * 60 * 1000;
      if (stale) { setPhase('reclaim'); return; }
      setPhase('error');
      setError('This duel is not open.');
```

Add `'reclaim'` and `'reclaiming'` to the `Phase` union (line ~12):
```typescript
type Phase = 'loading' | 'preview' | 'reclaim' | 'reclaiming' | 'approving' | 'accepting' | 'binding' | 'playing' | 'submitting' | 'result' | 'error';
```

Add a `reclaim` handler inside the component (after `accept`):
```typescript
  async function reclaim() {
    if (!detail?.onchainId) return;
    try {
      setPhase('reclaiming');
      const tx = await writeContractAsync({
        address: ESCROW_ADDRESS, abi: duelEscrowAbi, functionName: 'refundStale',
        args: [BigInt(detail.onchainId)], ...feeCurrencyOverrides(),
      });
      await publicClient!.waitForTransactionReceipt({ hash: tx });
      router.push('/duels');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reclaim failed');
      setPhase('error');
    }
  }
```

Render the reclaim UI (add before the `phase === 'error'` block):
```tsx
      {phase === 'reclaim' && detail && (
        <Window title={`DUEL_${detail.id}.EXE — stuck`}>
          <p>⚠️ This duel was accepted but never settled for over 24 hours.</p>
          <p style={{ fontSize: 12 }}>You can reclaim your <span className="stake">{stakeStr} {symbol}</span> stake. Both players are refunded.</p>
          {isConnected
            ? <button onClick={reclaim} style={{ width: '100%' }}>Reclaim stake</button>
            : <button onClick={() => connect({ connector: connectors[0] })} style={{ width: '100%' }}>Connect wallet</button>}
        </Window>
      )}
      {phase === 'reclaiming' && (
        <Dialog95 title="Reclaiming…" open>
          <TxProgress title="Refunding both stakes" steps={['Confirm on-chain']} active={0} />
        </Dialog95>
      )}
```

- [ ] **Step 3: Verify build + types**

Run: `cd frontend && npm run build`
Expected: `✓ Compiled successfully`, TypeScript passes.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/api/duels/[id]/route.ts frontend/src/app/duels/[id]/page.tsx
git commit -m "feat(frontend): reclaim stake on duels stuck past 24h

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** Contract `refundStale`+`acceptedAt` (T1) · Foundry tests incl. invariant (T1,T2) · redeploy + ABI/address (T3) · `settling` status + reconciler queries (T4) · reconciler 3 cases + gas check (T5,T7) · `replay` settled/settling fix (T6) · cron config (T7) · reclaim UI (T8). All spec sections mapped.
- **Out of scope (unchanged):** anti-cheat hardening, multi-oracle, Sentry/indexer.
- **Cross-task type consistency:** `markSettling(id, taps, score, winner)` / `markSettled(id, settleTx)` / `listReconcileCandidates()` / `planReconcileAction(d, nowMs)` / `oracleAddress()` used identically wherever referenced.
