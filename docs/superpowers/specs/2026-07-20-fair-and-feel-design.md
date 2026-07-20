# Fair & Feel — gameplay upgrade design

Date: 2026-07-20
Status: approved, ready for planning

## Problem

Flap95 duels are technically sound (server-verified traces, oracle-signed settlement,
on-chain escape hatches) but the gameplay loop has two structural defects and one
avoidable source of unsatisfying outcomes.

### 1. The acceptor holds a free information advantage

`GameCanvas` renders a live `GHOST <n>` counter next to the player's own score. The
creator plays blind — they have no target and must push until they die. The acceptor
watches the exact number they need, and once the ghost dies they know precisely how many
pipes remain between them and the pot. They can clear one more pipe and stop taking risk.

A player who reasons about this never creates a duel; they only accept. If enough players
reason about it, there are no duels left to accept. This is an economic design defect, not
a bug.

### 2. Runs start before the player is ready

In `duels/new/page.tsx` the phase goes `depositing` → `binding` → `playing`, and
`GameCanvas` starts its `requestAnimationFrame` loop the moment it mounts. The player has
just confirmed a wallet transaction — inside MiniPay, on a phone — and the simulation is
already running before their thumb returns to the screen. Losing the first pipes to a
reaction gap is routine.

With real money staked and exactly one run per duel, that gap costs a stake and locks
capital for 24 hours.

### 3. Ties are common and refund everyone

Settlement compares `score` only. Scores are small integers (mostly 3–15), so exact ties
happen often. Every tie refunds both players, collects no fee, and ends the duel with no
result. `verifyRun()` already computes `deathTick` (`src/engine/verify.ts:26`) and the
pipeline discards it.

### 4. The creator can never see their own result

Pre-existing, and surfaced while designing the above. `api/duels/[id]/route.ts` already
returns `winner`, `creatorScore`, `acceptorScore` and `settleTx` once a duel is settled —
the data is served. But the loader in `duels/[id]/page.tsx:110` treats `settled` as
terminal and falls through to `setPhase('error')` with **"This duel is not open."**

So a creator stakes, plays, waits, wins — and reopening their duel link shows an error
dialog. The only way they learn the outcome is noticing their wallet balance changed. In a
product whose emotional payoff *is* the VICTORY banner, this is the largest leak in the
flow. It is in scope here because it sits on exactly the surface the tie-break changes and
needs no new data.

## What this design does NOT change

Verified before writing this spec:

- **No contract change.** `DuelEscrow.settle()` (`contracts/src/DuelEscrow.sol:95-111`)
  validates only that `winner ∈ {creator, acceptor}` or is `address(0)`. It never checks
  the winner against `scoreA`/`scoreB` — those are carried into the `DuelSettled` event as
  information only. Off-chain tie-breaking needs no on-chain support.
- **No engine version column.** None of the three changes touch physics, pipe layout, or
  tap semantics. Hiding the ghost score is render-only; the countdown only delays when
  tick 0 occurs in wall-clock time; tie-breaking is settlement logic. A given
  `(seed, taps)` pair replays to the identical result before and after this work.

## Design

### 1. Hide the ghost's numeric score

**File:** `src/components/GameCanvas.tsx`

- Remove the `GHOST <n>` HUD line.
- **Keep the grey ghost bird.** It is the product — "race the ghost" is the pitch in the
  README and the branding.
- When the ghost dies, flash `GHOST DOWN` briefly, then clear it. This signals "every pipe
  from here is profit" without revealing the target number.

**Accepted trade-off.** This reduces the acceptor's edge; it does not eliminate it. An
acceptor can still count the pipes the ghost clears. The point is that counting costs
attention while staying alive, whereas glancing at a number costs nothing — the
information moves from free to paid. Eliminating the edge entirely would mean removing the
ghost, which removes what distinguishes this from an ordinary Flappy clone. Wrong trade.

### 2. Pre-roll countdown

**File:** `src/components/GameCanvas.tsx`

Add a pre-roll state ahead of the simulation loop:

1. On mount, draw the world **frozen** — bird at its start position, pipes at their
   initial offsets — with a `TAP TO START` overlay. No sim ticks run.
2. The first `pointerdown` **starts the countdown and is not recorded as a tap.**
3. Render `3 · 2 · 1 · GO` over roughly 1.5s. Still no sim ticks.
4. Begin the simulation loop. Tick 0 is the first tick after `GO`.

**Critical detail:** the starting tap must be swallowed, not pushed into `taps`. Leaking it
through gives the player an unrequested flap at tick 0 — the exact class of unfair death
this change exists to remove.

Applies to every run: practice, duel creation, and ghost race. Determinism is unaffected
because tick indices are unchanged.

### 3. Tie-break on survival time

**Migration** — `schema.sql`, add to `duels`:

```sql
alter table duels add column if not exists creator_death_tick integer;
alter table duels add column if not exists acceptor_death_tick integer;
```

Both nullable.

**New rule, in order:**

1. Higher score wins.
2. Equal score → higher `deathTick` wins (survived longer).
3. Equal on both → tie, refund both, as today.

**Legacy duels.** A row created before the migration has `creator_death_tick = NULL`. When
either death tick is NULL, skip step 2 and return `tie`. In-flight duels settle under
exactly the rule that applied when they were created. This is the versioning story, and it
costs nothing — no `engine_version` column is required.

**Carry the outcome as one value, not two scalars.** A run is now `(score, deathTick)` —
exactly what `verifyRun()` already returns. Threading two parallel numbers through the
pipeline would give `decideWinner` four adjacent same-typed `number` parameters, where
transposing a pair type-checks cleanly and silently inverts a real-money result. Introduce:

```ts
interface RunOutcome { score: number; deathTick: number | null }

decideWinner(creator: RunOutcome, acceptor: RunOutcome):
  'creator' | 'acceptor' | 'tie'
```

The nullability sits on `deathTick`, not on the outcome: a legacy duel always has scores,
it only lacks the death tick. A `null` there makes the "old duels settle under the old
rule" guarantee something a call site cannot silently skip.

**Touch points:**

- `src/engine/verify.ts` — already returns `deathTick`; stop discarding it at the call
  sites.
- `src/lib/duelStore.ts` — persist both death ticks (`setCreatorRun`, `markSettling`) and
  expose them on the duel record.
- `src/lib/oracle.ts` — `decideWinner` takes death ticks and implements the cascade above.
- `src/app/api/duels/[id]/replay/route.ts` — thread the values through.
- Forfeit path in `src/lib/reconcile.ts` is unchanged: an abandoned acceptor still forfeits
  to the creator outright.

**On-chain readability.** The `DuelSettled` event will sometimes show equal `scoreA`/
`scoreB` with a non-zero winner, which reads as inconsistent from a block explorer. The
resolution is documentation, not a contract change: state the tie-break rule in the duel
result UI (see 3b) and in the README. Redeploying an escrow for event cosmetics is not
worth it.

### 3a. Show settled duels instead of an error

**File:** `src/app/duels/[id]/page.tsx`

In the loader, `status === 'settled'` must route to the result view, not to `error`:

- Add a `settled` phase that renders `DuelResult`.
- Orient the scoreboard from the **connected wallet's** point of view: if `address` matches
  `creator`, then `yourScore = creatorScore`; otherwise `yourScore = acceptorScore`. A
  third-party viewer (neither address, or no wallet connected) sees the creator as "them"
  and a neutral, non-celebratory framing — nobody should be shown a VICTORY banner for a
  duel they were not in.
- `winner` maps to `won`/`tie` relative to that same viewer.
- `settleTx` already flows through, so the Celoscan link works unchanged.

`status === 'cancelled'` keeps its current terminal handling — a refund is not a result.

The GET route needs one addition: return `creatorDeathTick` and `acceptorDeathTick`
alongside the scores when settled, gated by the same `settled` check as the other fields
so an in-flight duel never leaks them.

### 3b. Explain a tie-broken win in the result UI

**File:** `src/components/DuelResult.tsx`

Today the component derives its highlight purely from `yourScore > theirScore`. After
tie-breaking, a duel can be won with equal scores — the scoreboard would show `07 — 07`
with neither side highlighted under a `VICTORY` banner, which reads as a broken system.

- Accept optional `yourTime` / `theirTime` props (seconds, from `deathTick / 60`).
- When the scores are equal and a winner exists, show survival time under each score and
  label the outcome **"Survived longer"**.
- Drive the side highlight from the actual winner rather than from the score comparison, so
  the highlighted side always agrees with the banner.

When the scores differ, the display is unchanged — no extra noise in the common case.

## Testing

- `src/engine/engine.test.ts` — the countdown does not alter simulation output: the same
  `(seed, taps)` produces the same score and death tick as before.
- `src/lib/oracle.test.ts` — `decideWinner` across: higher score; equal score with
  differing death ticks in both directions; equal on both; and **either death tick NULL,
  which must yield `tie`** (the legacy-duel guarantee).
- `GameCanvas` — the tap that starts the countdown does not appear in the submitted trace.
- `DuelResult` — equal scores with a winner renders the survival times, the "Survived
  longer" label, and highlights the side that actually won.
- Duel page loader — a settled duel renders the result rather than the error dialog, and
  the scoreboard orients correctly for the creator, for the acceptor, and for a
  disconnected third-party viewer.
- Manual: create a duel inside MiniPay and confirm no pipes are lost between the wallet
  confirmation and the first input.
- Manual: settle a duel, then reopen its link as the creator and confirm the result shows.

## Known consequence, deferred

Tie-breaking narrows what a third party can verify from chain data alone. Before this
change, `DuelSettled` carried enough information to check the oracle: if `scoreA > scoreB`
the winner had to be the creator. After it, a duel won on survival time shows equal scores
against a non-zero winner, and `deathTick` exists only off-chain — so that outcome has to
be taken on trust.

The fix needs no contract change: `creator_taps` and `acceptor_taps` are already stored, so
exposing them once a duel is settled lets anyone re-run `simulate(seed, taps)` and check
both the score and the death tick themselves. That restores full verifiability and matches
the "provably-fair replay" claim in the README.

Deferred to a follow-up rather than widening this spec. Recorded here so it is not
rediscovered as a surprise.

## Out of scope

Deferred deliberately, each worth its own spec:

- Richer duel list (opponent win rate, expiry countdown)
- Retention meta (streaks, winnings leaderboard, rematch always available)
- Mandatory practice run before staking
- Any creator-side economic compensation (e.g. reduced fee). Revisit only if post-launch
  data shows creators still losing systematically — a rule that never fires compensates
  nobody, which is why "creator wins exact ties" was considered and rejected here.
