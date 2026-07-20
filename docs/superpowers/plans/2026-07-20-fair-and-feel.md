# Fair & Feel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the acceptor's free information advantage, stop runs from starting before the player is ready, break tied duels on survival time, and show every player the result of a duel they were in.

**Architecture:** All five changes are off-chain. `DuelEscrow` is untouched — `settle()` never checks the winner against the scores, so tie-breaking needs no on-chain support. The game engine is untouched, so `(seed, taps)` replays identically before and after. Two nullable columns carry survival time; their NULL-ness is what makes pre-existing duels settle under the old rule. Logic that would otherwise be trapped inside React components is extracted into pure modules so it can actually be tested.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, viem/wagmi, Neon Postgres, vitest.

## Global Constraints

- **Do not modify `contracts/`.** No contract change, no redeploy. Verified: `DuelEscrow.settle()` (`contracts/src/DuelEscrow.sol:95-111`) validates only `winner ∈ {creator, acceptor, address(0)}`.
- **Do not modify `src/engine/engine.ts` or `src/engine/rng.ts`.** Physics are frozen; `engine.test.ts` has a golden test asserting exact values (`simulate(42, []) === { score: 0, deathTick: 55 }`). If that test fails, you changed something you must not change.
- **Tap traces stay tick-indexed from 0.** The countdown delays when tick 0 happens in wall-clock time; it never renumbers ticks.
- **Vitest only collects `src/**/*.test.ts`** (see `vitest.config.ts`), environment `node`. There is no jsdom and no React testing library installed, and **this plan does not add them.** Therefore all logic worth testing must live in `.ts` modules, not `.tsx` components. `.tsx` changes are verified by `npm run build`, `npm run lint`, and the manual checks named in each task.
- **All work happens on branch `feat/fair-and-feel`.** Do not merge to `main`.
- Run commands from `frontend/`.

---

### Task 1: Tie-break on survival time in `decideWinner`

Pure decision logic, no I/O. Nothing else in this task.

**Files:**
- Modify: `frontend/src/lib/oracle.ts:8-12`
- Test: `frontend/src/lib/oracle.test.ts:10-16`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `export interface RunOutcome { score: number; deathTick: number | null }`
  - `export function decideWinner(creator: RunOutcome, acceptor: RunOutcome): 'creator' | 'acceptor' | 'tie'`

  This is a **breaking signature change** — the old `decideWinner(creatorScore: number, acceptorScore: number)` had two positional numbers. Task 2 updates the only production call site.

- [ ] **Step 1: Replace the existing `decideWinner` tests with the new signature**

Replace the whole `describe('decideWinner', ...)` block in `frontend/src/lib/oracle.test.ts` (currently lines 10-16) with:

```ts
describe('decideWinner', () => {
  const run = (score: number, deathTick: number | null = null): RunOutcome => ({ score, deathTick });

  it('creator wins on higher score', () => {
    expect(decideWinner(run(5), run(3))).toBe('creator');
  });
  it('acceptor wins on higher score', () => {
    expect(decideWinner(run(2), run(3))).toBe('acceptor');
  });
  it('score beats survival time — a lower score never wins by lasting longer', () => {
    expect(decideWinner(run(5, 100), run(3, 3600))).toBe('creator');
  });

  it('equal scores: whoever survived longer wins', () => {
    expect(decideWinner(run(4, 900), run(4, 800))).toBe('creator');
    expect(decideWinner(run(4, 800), run(4, 900))).toBe('acceptor');
  });
  it('equal score and equal survival time is a true tie', () => {
    expect(decideWinner(run(4, 900), run(4, 900))).toBe('tie');
    expect(decideWinner(run(0, 55), run(0, 55))).toBe('tie');
  });

  // Legacy duels: rows created before the death-tick columns existed. They must settle
  // under the rule that applied when they were created — score only, ties refund.
  it('ties when either side has no recorded survival time', () => {
    expect(decideWinner(run(4, null), run(4, 900))).toBe('tie');
    expect(decideWinner(run(4, 900), run(4, null))).toBe('tie');
    expect(decideWinner(run(4, null), run(4, null))).toBe('tie');
  });
  it('still decides on score when survival time is missing', () => {
    expect(decideWinner(run(5, null), run(3, null))).toBe('creator');
  });
});
```

Update the import line at the top of the file (currently line 7) to:

```ts
import { decideWinner, feeFields, type RunOutcome } from './oracle';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/oracle.test.ts`

Expected: FAIL. TypeScript/vitest will report that `RunOutcome` is not exported from `./oracle`, and the `decideWinner` calls do not match its two-number signature.

- [ ] **Step 3: Implement the new `decideWinner`**

In `frontend/src/lib/oracle.ts`, replace the existing function (lines 8-12) with:

```ts
/** A finished run. `deathTick` is null for duels created before survival time was recorded. */
export interface RunOutcome {
  score: number;
  deathTick: number | null;
}

/**
 * Decides a duel: higher score wins; equal scores go to whoever survived longer.
 *
 * Taking whole outcomes rather than four loose numbers is deliberate. The scalar form
 * (creatorScore, creatorDeathTick, acceptorScore, acceptorDeathTick) puts four same-typed
 * numbers side by side, where transposing a pair type-checks cleanly and silently inverts
 * a real-money result.
 *
 * A null deathTick means the row predates the columns, so the survival tie-break is skipped
 * and the duel settles under the score-only rule that applied when it was created. Ties
 * refund both players, so falling back to 'tie' is always the safe direction.
 */
export function decideWinner(creator: RunOutcome, acceptor: RunOutcome): 'creator' | 'acceptor' | 'tie' {
  if (creator.score !== acceptor.score) return creator.score > acceptor.score ? 'creator' : 'acceptor';
  if (creator.deathTick === null || acceptor.deathTick === null) return 'tie';
  if (creator.deathTick !== acceptor.deathTick) return creator.deathTick > acceptor.deathTick ? 'creator' : 'acceptor';
  return 'tie';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/oracle.test.ts`

Expected: PASS, all `decideWinner` and `feeFields` tests green. The build will still be broken at the `replay` route call site — Task 2 fixes it. Do not fix it here.

- [ ] **Step 5: Commit**

```bash
git add src/lib/oracle.ts src/lib/oracle.test.ts
git commit -m "feat(settle): break tied duels on survival time

Equal scores now go to whoever stayed alive longer. decideWinner takes whole
run outcomes rather than four loose numbers, where transposing a pair would
type-check and invert a real-money result. A null deathTick marks a row from
before the columns existed and falls back to the score-only rule."
```

---

### Task 2: Persist survival time and wire it through settlement

Makes the build compile again by feeding Task 1's new signature from the database.

**Files:**
- Modify: `frontend/schema.sql`
- Modify: `frontend/src/lib/duelStore.ts` (`DuelRow` interface ~line 5, `toRow` ~line 38, `setCreatorRun` ~line 79, `markSettling` ~line 93, `listOpenDuels` ~line 205)
- Modify: `frontend/src/app/api/duels/[id]/replay/route.ts`

**Interfaces:**
- Consumes: `RunOutcome`, `decideWinner(creator, acceptor)` from Task 1.
- Produces:
  - `DuelRow` gains `creatorDeathTick: number | null` and `acceptorDeathTick: number | null`.
  - `setCreatorRun(id: number, taps: number[], score: number, deathTick: number): Promise<void>`
  - `markSettling(id: number, taps: number[], score: number, deathTick: number, winner: 'creator' | 'acceptor' | 'tie'): Promise<boolean>`

- [ ] **Step 1: Add the migration to `schema.sql`**

Append to `frontend/schema.sql`, immediately after the `create index ... duels_status_updated_idx` line:

```sql
-- Survival time in engine ticks (60/s), used to break tied scores.
-- Nullable on purpose: rows that predate these columns settle under the score-only rule.
alter table duels add column if not exists creator_death_tick integer;
alter table duels add column if not exists acceptor_death_tick integer;
```

Additive and nullable — no backfill, no downtime, and the current code keeps working against the new schema.

- [ ] **Step 2: Add the fields to `DuelRow` and `toRow`**

In `frontend/src/lib/duelStore.ts`, add to the `DuelRow` interface right after `acceptorScore`:

```ts
  creatorDeathTick: number | null;
  acceptorDeathTick: number | null;
```

And in `toRow`, right after the `acceptorScore` line:

```ts
    creatorDeathTick: (r.creator_death_tick ?? null) as number | null,
    acceptorDeathTick: (r.acceptor_death_tick ?? null) as number | null,
```

The `?? null` matters: `listOpenDuels` selects an explicit column list that does not include these columns, so the key is `undefined` rather than `null` on those rows. Without the coalesce, `DuelRow` would carry `undefined` where its type promises `null`.

- [ ] **Step 3: Persist the death ticks in both writers**

Replace `setCreatorRun` with:

```ts
export async function setCreatorRun(id: number, taps: number[], score: number, deathTick: number): Promise<void> {
  await sql`update duels set creator_taps = ${JSON.stringify(taps)}::jsonb, creator_score = ${score},
    creator_death_tick = ${deathTick},
    status = 'open', updated_at = now() where id = ${id} and status = 'funded'`;
}
```

Replace `markSettling` with:

```ts
// Returns false if the guard did not match (another actor already moved the row) —
// the caller lost the race and must not proceed to relay on-chain.
export async function markSettling(
  id: number, taps: number[], score: number, deathTick: number,
  winner: 'creator' | 'acceptor' | 'tie',
): Promise<boolean> {
  const rows = await sql`update duels set acceptor_taps = ${JSON.stringify(taps)}::jsonb, acceptor_score = ${score},
    acceptor_death_tick = ${deathTick},
    winner = ${winner}, status = 'settling', updated_at = now()
    where id = ${id} and status = 'accepted'
    returning id`;
  return rows.length > 0;
}
```

- [ ] **Step 4: Wire the replay route**

In `frontend/src/app/api/duels/[id]/replay/route.ts`:

In the `creator` branch, change the `setCreatorRun` call to pass the death tick:

```ts
    await setCreatorRun(duel.id, taps, r.score, r.deathTick);
```

In the `acceptor` branch, replace the winner computation and the `markSettling` call. The old code read:

```ts
    const acceptorScore = r.ok ? r.score : 0;
    const winner = r.ok ? decideWinner(duel.creatorScore, acceptorScore) : 'creator';
```

Replace with:

```ts
    // A trace that fails verification is a forfeit, decided before any tie-break: the
    // creator wins outright and the acceptor is recorded at 0. Survival time is meaningless
    // for a run we could not replay, so it is stored as 0 rather than fabricated.
    const acceptorScore = r.ok ? r.score : 0;
    const acceptorDeathTick = r.ok ? r.deathTick : 0;
    const winner = r.ok
      ? decideWinner(
          { score: duel.creatorScore, deathTick: duel.creatorDeathTick },
          { score: acceptorScore, deathTick: acceptorDeathTick },
        )
      : 'creator';
```

And update the `markSettling` call to pass the death tick in its new position:

```ts
    const gotSettling = await markSettling(duel.id, r.ok ? taps : [], acceptorScore, acceptorDeathTick, winner);
```

Leave everything else in the route unchanged — the race-loss branch, `relaySettle`, and `markSettled` are all untouched.

- [ ] **Step 5: Verify the whole suite and the build**

Run: `npm test`

Expected: PASS, all files including `oracle.test.ts`, `engine.test.ts`, `verify.test.ts`, `rng.test.ts`, `reconcile.test.ts`. The `engine.test.ts` golden test must still pass — if it does not, engine code was modified, which this plan forbids.

Run: `npm run build`

Expected: compiles with no TypeScript errors. This is what proves the Task 1 signature change is fully wired.

- [ ] **Step 6: Commit**

```bash
git add schema.sql src/lib/duelStore.ts "src/app/api/duels/[id]/replay/route.ts"
git commit -m "feat(settle): record survival time and feed it to the tie-break

Two nullable columns, no backfill. verifyRun already computed deathTick and the
pipeline was discarding it. A forfeited trace records 0 rather than a fabricated
survival time, and is decided before the tie-break runs at all."
```

---

### Task 3: Hide the ghost's numeric score

**Files:**
- Modify: `frontend/src/components/GameCanvas.tsx:64` (the HUD block)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks. `GameCanvas`'s props are unchanged.

- [ ] **Step 1: Replace the ghost HUD line**

In `frontend/src/components/GameCanvas.tsx`, the HUD block currently ends with:

```ts
      if (ghost) ctx.fillText(`GHOST ${ghost.state.score}`, 10, 52);
```

Replace that single line with:

```ts
      // The ghost's score is deliberately NOT drawn. Showing it hands the acceptor a
      // free, zero-cost read on exactly how many pipes they need — enough to clear one
      // more and then stop taking risk, while the creator plays blind. The grey bird
      // stays: racing it is the product, and counting its pipes costs attention the
      // player needs to stay alive, which is the whole point.
      if (ghost && !ghost.state.alive) {
        ctx.fillStyle = '#fff';
        ctx.fillText('GHOST DOWN', 10, 52);
      }
```

`GHOST DOWN` persists for the rest of the run once the ghost dies. That is intended: it tells the acceptor "every pipe from here is profit" without naming the number.

- [ ] **Step 2: Verify build and lint**

Run: `npm run build && npm run lint`

Expected: both succeed with no errors.

- [ ] **Step 3: Manual check**

Run `npm run dev`, open a duel you can accept, and confirm during the ghost race that:
- the grey ghost bird is still visible and moving
- no `GHOST <number>` counter appears anywhere
- `GHOST DOWN` appears when the grey bird dies and stays until the run ends

- [ ] **Step 4: Commit**

```bash
git add src/components/GameCanvas.tsx
git commit -m "feat(game): stop showing the ghost's score during a race

The live counter let the acceptor read their exact target for free, clear one
more pipe and coast, while the creator played blind — enough of an edge that a
rational player only ever accepts. The ghost bird stays; only the number goes."
```

---

### Task 4: Pre-roll countdown before every run

The state machine is extracted into a pure module so it can be tested — vitest cannot reach `.tsx` here (see Global Constraints). This also makes the swallow-the-first-tap rule explicit instead of burying it in an effect.

**Files:**
- Create: `frontend/src/lib/runPhase.ts`
- Create: `frontend/src/lib/runPhase.test.ts`
- Modify: `frontend/src/components/GameCanvas.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `export type RunPhase = 'idle' | 'countdown' | 'running'`
  - `export const COUNTDOWN_MS = 1500`
  - `export function onPointerDown(phase: RunPhase): { phase: RunPhase; isFlap: boolean }`
  - `export function countdownLabel(elapsedMs: number): string`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/lib/runPhase.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { COUNTDOWN_MS, countdownLabel, onPointerDown, type RunPhase } from './runPhase';

describe('onPointerDown', () => {
  it('the first tap starts the countdown and is NOT a flap', () => {
    // This is the whole point of the pre-roll: the tap that wakes the game up must not
    // also fire the bird upward at tick 0.
    expect(onPointerDown('idle')).toEqual({ phase: 'countdown', isFlap: false });
  });
  it('taps during the countdown are swallowed', () => {
    expect(onPointerDown('countdown')).toEqual({ phase: 'countdown', isFlap: false });
  });
  it('taps once running are flaps', () => {
    expect(onPointerDown('running')).toEqual({ phase: 'running', isFlap: true });
  });
  it('never reports a flap before the run starts', () => {
    const before: RunPhase[] = ['idle', 'countdown'];
    for (const p of before) expect(onPointerDown(p).isFlap).toBe(false);
  });
});

describe('countdownLabel', () => {
  it('counts 3, 2, 1 then GO across the countdown window', () => {
    expect(countdownLabel(0)).toBe('3');
    expect(countdownLabel(400)).toBe('2');
    expect(countdownLabel(800)).toBe('1');
    expect(countdownLabel(1200)).toBe('GO');
  });
  it('still reads GO at the exact end of the window', () => {
    expect(countdownLabel(COUNTDOWN_MS)).toBe('GO');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/runPhase.test.ts`

Expected: FAIL — the file `./runPhase` does not exist.

- [ ] **Step 3: Implement the module**

Create `frontend/src/lib/runPhase.ts`:

```ts
/**
 * Pre-roll state for a run.
 *
 * `GameCanvas` used to start simulating the moment it mounted. In a duel that mount
 * happens right after a wallet confirmation — on a phone, inside MiniPay — so the bird was
 * already falling before the player's thumb came back to the screen. With one run per duel
 * and a real stake, that reaction gap cost money.
 *
 * The rule that matters most here is that the tap which starts the game is consumed by the
 * start and never recorded as a flap. Leaking it into the trace would hand the player an
 * unrequested flap at tick 0 — the exact unfair death this exists to remove.
 */
export type RunPhase = 'idle' | 'countdown' | 'running';

/** How long `3 · 2 · 1 · GO` is displayed before tick 0. */
export const COUNTDOWN_MS = 1500;

/** Advances the pre-roll and reports whether this pointer event counts as a flap. */
export function onPointerDown(phase: RunPhase): { phase: RunPhase; isFlap: boolean } {
  if (phase === 'idle') return { phase: 'countdown', isFlap: false };
  if (phase === 'countdown') return { phase: 'countdown', isFlap: false };
  return { phase: 'running', isFlap: true };
}

/** The text shown mid-countdown: three beats then GO, evenly across COUNTDOWN_MS. */
export function countdownLabel(elapsedMs: number): string {
  const beat = COUNTDOWN_MS / 4;
  if (elapsedMs < beat) return '3';
  if (elapsedMs < beat * 2) return '2';
  if (elapsedMs < beat * 3) return '1';
  return 'GO';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/runPhase.test.ts`

Expected: PASS, all tests green.

- [ ] **Step 5: Commit the module**

```bash
git add src/lib/runPhase.ts src/lib/runPhase.test.ts
git commit -m "feat(game): add the pre-roll state machine

Extracted rather than inlined so it can be tested — vitest only collects .ts
here. It also makes the load-bearing rule explicit: the tap that starts a run is
consumed by the start and never enters the tap trace."
```

- [ ] **Step 6: Wire the pre-roll into `GameCanvas`**

In `frontend/src/components/GameCanvas.tsx`:

Add to the imports at the top:

```ts
import { COUNTDOWN_MS, countdownLabel, onPointerDown, type RunPhase } from '@/lib/runPhase';
```

Inside the effect, replace the mutable-state declarations. The current block reads:

```ts
    const taps: number[] = [];
    let pendingTap = false;
    let last = performance.now();
    let acc = 0;
    let raf = 0;
    endedRef.current = false;

    const onDown = (e: Event) => { e.preventDefault(); pendingTap = true; };
    canvas.addEventListener('pointerdown', onDown);
```

Replace it with:

```ts
    const taps: number[] = [];
    let pendingTap = false;
    let phase: RunPhase = 'idle';
    let countdownStart = 0;
    let last = performance.now();
    let acc = 0;
    let raf = 0;
    endedRef.current = false;

    const onDown = (e: Event) => {
      e.preventDefault();
      const next = onPointerDown(phase);
      if (next.phase === 'countdown' && phase === 'idle') countdownStart = performance.now();
      phase = next.phase;
      // Only a tap taken while running is a flap. The starting tap is swallowed here.
      if (next.isFlap) pendingTap = true;
    };
    canvas.addEventListener('pointerdown', onDown);
```

Add an overlay helper immediately after the existing `draw` function:

```ts
    function drawOverlay(text: string, sub?: string) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, CONFIG.worldW, CONFIG.worldH);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.font = 'bold 48px monospace';
      ctx.fillText(text, CONFIG.worldW / 2, CONFIG.worldH / 2);
      if (sub) {
        ctx.font = '14px monospace';
        ctx.fillText(sub, CONFIG.worldW / 2, CONFIG.worldH / 2 + 34);
      }
      ctx.textAlign = 'left';
    }
```

`textAlign` is restored to `left` on the way out because `draw` relies on the default for the HUD.

Replace the whole `frame` function with:

```ts
    function frame(now: number) {
      // Pre-roll: draw the world frozen so the player can read the first pipes, and run
      // no simulation ticks at all. Tick 0 happens after GO.
      if (phase === 'idle') {
        draw();
        drawOverlay('TAP TO START', 'first tap starts the countdown');
        raf = requestAnimationFrame(frame);
        return;
      }
      if (phase === 'countdown') {
        const elapsed = now - countdownStart;
        draw();
        drawOverlay(countdownLabel(elapsed));
        if (elapsed >= COUNTDOWN_MS) {
          phase = 'running';
          // Reset the accumulator clock so the countdown's wall time is not handed to the
          // simulation as a backlog of ticks to catch up on.
          last = now;
          acc = 0;
        }
        raf = requestAnimationFrame(frame);
        return;
      }

      acc += now - last;
      last = now;
      while (acc >= TICK_MS && sim.state.alive) {
        if (pendingTap) taps.push(sim.state.tick);
        sim.step(pendingTap);
        if (ghost && ghost.state.alive) ghost.step(ghostSet.has(ghost.state.tick));
        pendingTap = false;
        acc -= TICK_MS;
      }
      draw();
      if (!sim.state.alive) {
        if (!endedRef.current) { endedRef.current = true; onRunEnd(taps, sim.state.score); }
        return;
      }
      raf = requestAnimationFrame(frame);
    }
```

The `last = now; acc = 0;` reset is load-bearing. Without it the ~1.5s countdown accumulates in `acc`, and the first `while` loop would immediately burn ~90 ticks with no player input — killing the bird before it is drawn once.

- [ ] **Step 7: Verify build, lint, and the full suite**

Run: `npm test && npm run build && npm run lint`

Expected: all pass. `engine.test.ts`'s golden test must still pass — the countdown must not have changed simulation output.

- [ ] **Step 8: Manual check**

Run `npm run dev` and open `/play`:
- the world is drawn frozen with `TAP TO START` before any input
- the first tap starts `3 · 2 · 1 · GO` and the bird does **not** jump
- after `GO` the bird begins falling from its start position, not mid-screen and not already dead
- the bird responds to the first tap after `GO`

- [ ] **Step 9: Commit**

```bash
git add src/components/GameCanvas.tsx
git commit -m "feat(game): hold every run behind TAP TO START and a 3-2-1 countdown

Runs used to begin the instant the canvas mounted — right after a wallet
confirmation, before the player's thumb was back on the screen. The accumulator
clock is reset at GO so the countdown's wall time is not replayed as a backlog
of ticks the player never got to play."
```

---

### Task 5: Orient a settled duel for whoever is looking at it

Pure logic plus the API field it needs. No UI yet — Task 6 consumes this.

**Files:**
- Create: `frontend/src/lib/outcome.ts`
- Create: `frontend/src/lib/outcome.test.ts`
- Modify: `frontend/src/app/api/duels/[id]/route.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `export type ViewerRole = 'creator' | 'acceptor' | 'observer'`
  - `export function viewerRole(address: string | undefined, creator: string, acceptor: string | null): ViewerRole`
  - `export interface SettledDuel { winner: 'creator' | 'acceptor' | 'tie'; creatorScore: number; acceptorScore: number; creatorDeathTick: number | null; acceptorDeathTick: number | null }`
  - `export interface OrientedResult { won: boolean; tie: boolean; observer: boolean; yourScore: number; theirScore: number; yourDeathTick: number | null; theirDeathTick: number | null; yourLabel: string; theirLabel: string; winnerSide: 'yours' | 'theirs' | 'none' }`
  - `export function orientResult(role: ViewerRole, d: SettledDuel): OrientedResult`
  - `export function tickToSeconds(tick: number): string`
- The GET route response gains `creatorDeathTick` and `acceptorDeathTick`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/lib/outcome.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { orientResult, tickToSeconds, viewerRole, type SettledDuel } from './outcome';

const CREATOR = '0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa';
const ACCEPTOR = '0xBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBbBb';
const STRANGER = '0xCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCcCc';

describe('viewerRole', () => {
  it('identifies the creator regardless of address casing', () => {
    expect(viewerRole(CREATOR.toLowerCase(), CREATOR, ACCEPTOR)).toBe('creator');
    expect(viewerRole(CREATOR.toUpperCase(), CREATOR, ACCEPTOR)).toBe('creator');
  });
  it('identifies the acceptor', () => {
    expect(viewerRole(ACCEPTOR, CREATOR, ACCEPTOR)).toBe('acceptor');
  });
  it('treats an unrelated wallet as an observer', () => {
    expect(viewerRole(STRANGER, CREATOR, ACCEPTOR)).toBe('observer');
  });
  it('treats a disconnected viewer as an observer', () => {
    expect(viewerRole(undefined, CREATOR, ACCEPTOR)).toBe('observer');
  });
  it('treats an unaccepted duel as having no acceptor to match', () => {
    expect(viewerRole(STRANGER, CREATOR, null)).toBe('observer');
  });
});

describe('orientResult', () => {
  const creatorWon: SettledDuel = {
    winner: 'creator', creatorScore: 7, acceptorScore: 5,
    creatorDeathTick: 900, acceptorDeathTick: 700,
  };

  it('shows the creator their own score first', () => {
    const r = orientResult('creator', creatorWon);
    expect(r.yourScore).toBe(7);
    expect(r.theirScore).toBe(5);
    expect(r.won).toBe(true);
    expect(r.winnerSide).toBe('yours');
  });
  it('flips the board for the acceptor', () => {
    const r = orientResult('acceptor', creatorWon);
    expect(r.yourScore).toBe(5);
    expect(r.theirScore).toBe(7);
    expect(r.won).toBe(false);
    expect(r.winnerSide).toBe('theirs');
  });
  it('never congratulates an observer', () => {
    const r = orientResult('observer', creatorWon);
    expect(r.won).toBe(false);
    expect(r.observer).toBe(true);
    expect(r.yourLabel).toBe('CREATOR');
    expect(r.theirLabel).toBe('ACCEPTOR');
    // An observer still sees which side actually won.
    expect(r.winnerSide).toBe('yours');
  });
  it('labels the two players YOU and THEM', () => {
    const r = orientResult('creator', creatorWon);
    expect(r.yourLabel).toBe('YOU');
    expect(r.theirLabel).toBe('THEM');
  });

  it('reports a tie to both players with no winning side', () => {
    const tied: SettledDuel = {
      winner: 'tie', creatorScore: 4, acceptorScore: 4,
      creatorDeathTick: 900, acceptorDeathTick: 900,
    };
    for (const role of ['creator', 'acceptor'] as const) {
      const r = orientResult(role, tied);
      expect(r.tie).toBe(true);
      expect(r.won).toBe(false);
      expect(r.winnerSide).toBe('none');
    }
  });

  it('carries survival times through so a tie-broken win can be explained', () => {
    const brokenTie: SettledDuel = {
      winner: 'acceptor', creatorScore: 4, acceptorScore: 4,
      creatorDeathTick: 800, acceptorDeathTick: 900,
    };
    const r = orientResult('acceptor', brokenTie);
    expect(r.yourScore).toBe(r.theirScore);
    expect(r.yourDeathTick).toBe(900);
    expect(r.theirDeathTick).toBe(800);
    expect(r.won).toBe(true);
    expect(r.winnerSide).toBe('yours');
  });

  it('carries null survival times from a legacy duel', () => {
    const legacy: SettledDuel = {
      winner: 'creator', creatorScore: 6, acceptorScore: 2,
      creatorDeathTick: null, acceptorDeathTick: null,
    };
    const r = orientResult('creator', legacy);
    expect(r.yourDeathTick).toBeNull();
    expect(r.theirDeathTick).toBeNull();
  });
});

describe('tickToSeconds', () => {
  it('converts engine ticks to seconds at 60 ticks/s', () => {
    expect(tickToSeconds(900)).toBe('15.0');
    expect(tickToSeconds(55)).toBe('0.9');
    expect(tickToSeconds(3600)).toBe('60.0');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/outcome.test.ts`

Expected: FAIL — the file `./outcome` does not exist.

- [ ] **Step 3: Implement the module**

Create `frontend/src/lib/outcome.ts`:

```ts
import { CONFIG } from '@/engine/engine';

/** Who is looking at a settled duel. */
export type ViewerRole = 'creator' | 'acceptor' | 'observer';

export interface SettledDuel {
  winner: 'creator' | 'acceptor' | 'tie';
  creatorScore: number;
  acceptorScore: number;
  creatorDeathTick: number | null;
  acceptorDeathTick: number | null;
}

export interface OrientedResult {
  won: boolean;
  tie: boolean;
  observer: boolean;
  yourScore: number;
  theirScore: number;
  yourDeathTick: number | null;
  theirDeathTick: number | null;
  yourLabel: string;
  theirLabel: string;
  /** Which side of the board actually won — drives the highlight. */
  winnerSide: 'yours' | 'theirs' | 'none';
}

/** Addresses are stored lowercased but wallets hand them back checksummed, so compare folded. */
export function viewerRole(
  address: string | undefined,
  creator: string,
  acceptor: string | null,
): ViewerRole {
  const a = address?.toLowerCase();
  if (!a) return 'observer';
  if (a === creator.toLowerCase()) return 'creator';
  if (acceptor && a === acceptor.toLowerCase()) return 'acceptor';
  return 'observer';
}

/**
 * Presents a settled duel from one viewer's side of the board.
 *
 * An observer is shown the duel from the creator's side but is never told they won —
 * nobody should get a VICTORY banner for a duel they were not in.
 */
export function orientResult(role: ViewerRole, d: SettledDuel): OrientedResult {
  const asCreator = role !== 'acceptor';
  const observer = role === 'observer';
  const tie = d.winner === 'tie';

  const winnerSide: OrientedResult['winnerSide'] =
    tie ? 'none'
    : (d.winner === 'creator') === asCreator ? 'yours'
    : 'theirs';

  return {
    won: !observer && !tie && winnerSide === 'yours',
    tie,
    observer,
    yourScore: asCreator ? d.creatorScore : d.acceptorScore,
    theirScore: asCreator ? d.acceptorScore : d.creatorScore,
    yourDeathTick: asCreator ? d.creatorDeathTick : d.acceptorDeathTick,
    theirDeathTick: asCreator ? d.acceptorDeathTick : d.creatorDeathTick,
    yourLabel: observer ? 'CREATOR' : 'YOU',
    theirLabel: observer ? 'ACCEPTOR' : 'THEM',
    winnerSide,
  };
}

/** Engine ticks as display seconds, e.g. 900 -> "15.0". */
export function tickToSeconds(tick: number): string {
  return (tick / CONFIG.ticksPerSecond).toFixed(1);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/outcome.test.ts`

Expected: PASS, all tests green.

- [ ] **Step 5: Expose the death ticks on the duel API**

In `frontend/src/app/api/duels/[id]/route.ts`, add two fields to the JSON response, immediately after the `acceptorScore` line:

```ts
    creatorDeathTick: settled ? d.creatorDeathTick : null,
    acceptorDeathTick: settled ? d.acceptorDeathTick : null,
```

They ride the same `settled` gate as the scores, so an in-flight duel never leaks them — a live death tick would tell an acceptor how long the creator survived, which is exactly the kind of free read Task 3 removed.

- [ ] **Step 6: Verify the full suite and the build**

Run: `npm test && npm run build`

Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/outcome.ts src/lib/outcome.test.ts "src/app/api/duels/[id]/route.ts"
git commit -m "feat(duels): orient a settled result for whoever is viewing it

Getting creator and acceptor backwards would show a player the wrong side of
their own duel, so the orientation is pure and tested rather than inlined in the
page. Observers see the board but are never congratulated. Death ticks ride the
same settled gate as the scores so a live duel cannot leak them."
```

---

### Task 6: Show the result — to both players, and explain tie-broken wins

**Files:**
- Modify: `frontend/src/components/DuelResult.tsx`
- Modify: `frontend/src/app/globals.css` (after line 343)
- Modify: `frontend/src/app/duels/[id]/page.tsx`

**Interfaces:**
- Consumes: `viewerRole`, `orientResult`, `tickToSeconds`, `OrientedResult` from Task 5.
- Produces: `DuelResult` gains props `yourDeathTick`, `theirDeathTick`, `yourLabel`, `theirLabel`, `winnerSide`, `observer`.

- [ ] **Step 1: Rewrite `DuelResult` to take the oriented result**

Replace the whole of `frontend/src/components/DuelResult.tsx` with:

```tsx
import { PixelBird } from './PixelBird';
import { tickToSeconds } from '@/lib/outcome';

/** The emotional peak of a duel. Win = gold banner + flapping bird +
 *  green payout; draw = neutral; loss = greyed. Buttons live in the page. */
export function DuelResult({
  won, tie, observer = false, amount, symbol,
  yourScore, theirScore, yourDeathTick = null, theirDeathTick = null,
  yourLabel = 'YOU', theirLabel = 'THEM', winnerSide = 'none', settleTx,
}: {
  won: boolean;
  tie: boolean;
  observer?: boolean;
  amount: string;
  symbol: string;
  yourScore: number;
  theirScore: number;
  yourDeathTick?: number | null;
  theirDeathTick?: number | null;
  yourLabel?: string;
  theirLabel?: string;
  winnerSide?: 'yours' | 'theirs' | 'none';
  settleTx?: string | null;
}) {
  const kind = won ? 'win' : tie ? 'tie' : 'loss';
  const banner = observer ? 'SETTLED' : won ? 'VICTORY' : tie ? 'DRAW' : 'DEFEAT';
  const payout = observer ? `Pot: ${amount} ${symbol}`
    : won ? `+${amount} ${symbol}`
    : tie ? 'Stakes refunded'
    : `−${amount} ${symbol}`;

  // A tie-break makes equal scores decisive, so the highlight follows the recorded winner
  // rather than a score comparison — otherwise a won duel would render 07 — 07 with nothing
  // lit up under a VICTORY banner and read as broken.
  const tieBroken = winnerSide !== 'none' && yourScore === theirScore;
  const showTimes = tieBroken && yourDeathTick !== null && theirDeathTick !== null;

  return (
    <div className={`result result--${kind}`}>
      <div className="result__banner">{banner}</div>
      <div className="result__bird"><PixelBird /></div>
      <p className="result__payout">{payout}</p>
      <div className="scoreboard">
        <div className={`scoreboard__side ${winnerSide === 'yours' ? 'is-win' : ''}`}>
          <span className="scoreboard__num">{String(yourScore).padStart(2, '0')}</span>
          <span className="scoreboard__lab">{yourLabel}</span>
          {showTimes && <span className="scoreboard__time">{tickToSeconds(yourDeathTick!)}s</span>}
        </div>
        <span className="scoreboard__dash">—</span>
        <div className={`scoreboard__side ${winnerSide === 'theirs' ? 'is-win' : ''}`}>
          <span className="scoreboard__num">{String(theirScore).padStart(2, '0')}</span>
          <span className="scoreboard__lab">{theirLabel}</span>
          {showTimes && <span className="scoreboard__time">{tickToSeconds(theirDeathTick!)}s</span>}
        </div>
      </div>
      {showTimes && <p className="result__tiebreak">Tied on score — survived longer wins.</p>}
      {settleTx && (
        <p className="result__link">
          <a href={`https://celoscan.io/tx/${settleTx}`} target="_blank" rel="noreferrer">
            View settlement ↗
          </a>
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the two new styles**

In `frontend/src/app/globals.css`, immediately after the `.scoreboard__dash` rule (line 343), add:

```css
.scoreboard__time { font-size: 10px; opacity: .7; font-variant-numeric: tabular-nums; }
.result__tiebreak { font-size: 11px; margin: 0; opacity: .8; }
```

- [ ] **Step 3: Render settled duels on the duel page**

In `frontend/src/app/duels/[id]/page.tsx`:

Add `'settled'` to the `Phase` union:

```ts
type Phase = 'loading' | 'preview' | 'settled' | 'reclaim' | 'reclaiming' | 'approving' | 'accepting' | 'binding' | 'playing' | 'submitting' | 'result' | 'error';
```

Extend the `Detail` interface with the settled fields the GET route already returns:

```ts
interface Detail {
  id: number; onchainId: string | null; status: string; stakeWei: string; token: string | null;
  creator: string; acceptor: string | null; updatedAt: string;
  winner: 'creator' | 'acceptor' | 'tie' | null;
  creatorScore: number | null; acceptorScore: number | null;
  creatorDeathTick: number | null; acceptorDeathTick: number | null;
  settleTx: string | null;
}
```

Add to the imports:

```ts
import { orientResult, viewerRole } from '@/lib/outcome';
```

In the loader effect, the terminal branch currently reads:

```ts
      if (!maybeStale) {
        // Fast path: a live duel still inside its window needs no chain read.
        if (d.status === 'open') { setPhase('preview'); return; }
        setPhase('error');
        setError('This duel is not open.');
        return;
      }
```

Replace it with:

```ts
      // A settled duel is a result, not an error. The creator never sees their own outcome
      // any other way — they stake, play, wait, and their only other signal that they won
      // is noticing the balance move.
      if (d.status === 'settled' && d.winner !== null) { setPhase('settled'); return; }

      if (!maybeStale) {
        // Fast path: a live duel still inside its window needs no chain read.
        if (d.status === 'open') { setPhase('preview'); return; }
        setPhase('error');
        setError('This duel is not open.');
        return;
      }
```

Placing it above the `maybeStale` check is deliberate: a settled duel is always terminal, so it must never fall through to the staleness path or a chain read. A `cancelled` duel is untouched — a refund is not a result.

Add the render block, immediately after the existing `{phase === 'preview' && ...}` block:

```tsx
      {phase === 'settled' && detail && detail.winner !== null && (() => {
        const oriented = orientResult(
          viewerRole(address, detail.creator, detail.acceptor),
          {
            winner: detail.winner,
            creatorScore: detail.creatorScore ?? 0,
            acceptorScore: detail.acceptorScore ?? 0,
            creatorDeathTick: detail.creatorDeathTick,
            acceptorDeathTick: detail.acceptorDeathTick,
          },
        );
        return (
          <Window title={`DUEL_${detail.id}.EXE — settled`}>
            <DuelResult
              {...oriented}
              amount={oriented.won ? (Number(stakeStr) * 1.9).toFixed(2) : stakeStr}
              symbol={symbol}
              settleTx={detail.settleTx}
            />
            <div className="row spread" style={{ marginTop: 10 }}>
              {!oriented.observer && !oriented.won && (
                <button onClick={() => router.push(`/duels/new?challenge=${detail.creator}`)}>Rematch</button>
              )}
              <button onClick={() => router.push('/duels')}>Back to duels</button>
            </div>
          </Window>
        );
      })()}
```

`{...oriented}` spreads `won`, `tie`, `observer`, both scores, both death ticks, both labels and `winnerSide` straight into `DuelResult` — the prop names were chosen in Task 5 to line up exactly.

- [ ] **Step 4: Verify build, lint, and the full suite**

Run: `npm test && npm run build && npm run lint`

Expected: all pass.

- [ ] **Step 5: Manual check**

With `npm run dev`, open a settled duel's URL (`/duels/<id>`):
- connected as the creator: their own score is on the left under `YOU`, and a win shows `VICTORY`
- connected as the acceptor: the board is flipped
- disconnected: banner reads `SETTLED`, labels read `CREATOR` / `ACCEPTOR`, no victory framing
- a duel won on equal scores shows both survival times and the line "Tied on score — survived longer wins.", with the winner's side highlighted

- [ ] **Step 6: Commit**

```bash
git add src/components/DuelResult.tsx src/app/globals.css "src/app/duels/[id]/page.tsx"
git commit -m "feat(duels): show settled results and explain tie-broken wins

A creator who won previously got 'This duel is not open.' on their own duel and
had to infer the outcome from their wallet balance. The scoreboard highlight now
follows the recorded winner rather than a score comparison, so a tie-broken win
no longer renders as 07 - 07 with nothing lit under a VICTORY banner."
```

---

### Task 7: Document the tie-break rule

The rule decides who gets paid, and the `DuelSettled` event alone cannot show why — equal scores against a non-zero winner reads as inconsistent on a block explorer. That gap is closed with words.

**Files:**
- Modify: `README.md` (repo root)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Document the rule**

In `README.md`, in the "How it works" list, replace the `**Blind duels**` bullet with these two:

```markdown
- **Blind duels** — open listings never reveal the creator's score, and the ghost race
  never shows the ghost's score either. You can watch the grey bird, but the number stays
  hidden until you finish — so neither side gets a free read on the target.
- **Ties break on survival time** — equal scores go to whoever stayed alive longer. Only a
  run matching on both counts refunds both players. Survival time is off-chain, so a duel
  settled this way shows equal scores in the `DuelSettled` event; the winner is whoever
  lasted more ticks.
```

Also update the intro paragraph. It currently ends:

```markdown
then a challenger locks a matching stake and races your **ghost** on the exact same
pipes. Winner takes the pot minus a 5% house fee; ties refund both players. All of it
wrapped in a Windows 95 UI.
```

Replace with:

```markdown
then a challenger locks a matching stake and races your **ghost** on the exact same
pipes. Winner takes the pot minus a 5% house fee; equal scores go to whoever survived
longer, and a dead-even run refunds both players. All of it wrapped in a Windows 95 UI.
```

- [ ] **Step 2: Verify**

Run: `git diff README.md`

Expected: only the intro paragraph and the two bullets changed. No other section touched.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: describe the ghost-score blind and the survival tie-break

The DuelSettled event cannot show why an equal-score duel had a winner, since
survival time never goes on-chain. Documenting the rule is the fix; redeploying
an escrow for event cosmetics is not worth it."
```

---

## Final verification

- [ ] **Full suite:** `cd frontend && npm test` — all green, including `engine.test.ts`'s golden physics test.
- [ ] **Build:** `npm run build` — no TypeScript errors.
- [ ] **Lint:** `npm run lint` — clean.
- [ ] **Migration applied:** run the two `alter table` statements from `schema.sql` against the target database before deploying. They are `if not exists`, so re-running is safe.
- [ ] **Deploy ordering:** the migration is additive and nullable, so it can be applied before the code ships. Applying it first is the safe order — new code against the old schema would fail to write death ticks.

## Known gaps, deliberately not addressed here

- **Tie-broken wins are not independently verifiable from chain data.** `deathTick` never goes on-chain, so a third party auditing `DuelSettled` cannot check an equal-score outcome. The stored `creator_taps` / `acceptor_taps` would let anyone re-run `simulate(seed, taps)` and verify it themselves; exposing them is a follow-up, recorded in the spec's "Known consequence, deferred" section.
- **Hiding the ghost's score reduces but does not eliminate the acceptor's edge** — pipes cleared by the ghost remain countable. Eliminating it entirely would mean removing the ghost, which is the product. Accepted trade-off, recorded in the spec.
