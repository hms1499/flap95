# Fair Tab-Switch Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** End a run when its tab is backgrounded mid-play so the accumulator backlog can never kill the bird for a reason that is not skill, and rewind a backgrounded countdown to idle.

**Architecture:** Two off-chain changes. A pure `onHidden(phase)` decision function is added to the existing pre-roll module `runPhase.ts` (vitest only collects `.ts`, so the decision logic must live there to be tested). `GameCanvas.tsx` then registers a `visibilitychange` listener that calls `onHidden` and either ends the run through the existing `onRunEnd` path or resets the phase to `idle`. The tick-backlog hazard is removed by construction: the only phase that can accumulate a backlog (`running`) is ended before the paused `requestAnimationFrame` can ever resume.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, vitest.

## Global Constraints

- **Do not modify `src/engine/engine.ts` or `src/engine/rng.ts`.** Physics are frozen; `engine.test.ts` has a golden test asserting `simulate(42, []) === { score: 0, deathTick: 55 }`. If it fails, you changed something you must not change.
- **Do not modify `contracts/`.** This is off-chain only.
- **Do not change the `onRunEnd` signature.** It stays `(taps: number[], score: number) => void`. The run-end path is reused verbatim; the duel server re-simulates the tap trace and computes the authoritative score and deathTick itself.
- **Vitest only collects `src/**/*.test.ts`** (`vitest.config.ts`), environment `node`. Decision logic goes in `.ts`; `.tsx` changes are verified by `npm run build` and a manual Playwright check.
- **All work happens on branch `feat/tab-switch-guard`.** Do not merge to `main`.
- Run commands from `frontend/`.

---

### Task 1: `onHidden` decision function in `runPhase.ts`

Pure logic, no I/O. Decides what losing visibility means for each run phase.

**Files:**
- Modify: `frontend/src/lib/runPhase.ts` (append after `countdownLabel`, current end of file)
- Test: `frontend/src/lib/runPhase.test.ts` (add a new `describe` block; update the import line)

**Interfaces:**
- Consumes: `RunPhase` (already exported from `runPhase.ts`).
- Produces:
  - `export type VisibilityAction = 'end-run' | 'reset-idle' | 'none'`
  - `export function onHidden(phase: RunPhase): VisibilityAction`

- [ ] **Step 1: Add the failing tests**

In `frontend/src/lib/runPhase.test.ts`, update the import line at the top. It currently reads:

```ts
import { COUNTDOWN_MS, countdownLabel, onPointerDown, type RunPhase } from './runPhase';
```

Replace it with:

```ts
import { COUNTDOWN_MS, countdownLabel, onHidden, onPointerDown, type RunPhase } from './runPhase';
```

Then append this `describe` block to the end of the file:

```ts
describe('onHidden', () => {
  it('ends a running run — the bird would fall and die anyway once tapping stops', () => {
    expect(onHidden('running')).toBe('end-run');
  });
  it('rewinds a countdown to idle so it cannot complete while the page is hidden', () => {
    expect(onHidden('countdown')).toBe('reset-idle');
  });
  it('does nothing at idle — there is no run to affect', () => {
    expect(onHidden('idle')).toBe('none');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/runPhase.test.ts`

Expected: FAIL. vitest reports that `onHidden` is not exported from `./runPhase`.

- [ ] **Step 3: Implement `onHidden`**

Append to `frontend/src/lib/runPhase.ts`, after the `countdownLabel` function (the current end of the file):

```ts
/** What losing visibility means for a run, by phase. */
export type VisibilityAction = 'end-run' | 'reset-idle' | 'none';

/**
 * Decides what a backgrounded tab does to a run, by phase.
 *
 * `running` ends: a backgrounded tab throttles requestAnimationFrame, and on
 * return the fixed-timestep accumulator would burn a backlog of ticks with no
 * input and kill the bird — costing a staked player for something that is not
 * skill. Ending the run instead submits the taps so far; the engine replays them
 * to a natural death, which is the honest outcome of the player having stopped.
 *
 * `countdown` rewinds to idle so it cannot silently complete while hidden and
 * drop the player into an already-falling run. `idle` has no run to affect.
 */
export function onHidden(phase: RunPhase): VisibilityAction {
  if (phase === 'running') return 'end-run';
  if (phase === 'countdown') return 'reset-idle';
  return 'none';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/runPhase.test.ts`

Expected: PASS, all `onPointerDown`, `countdownLabel`, and `onHidden` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/runPhase.ts src/lib/runPhase.test.ts
git commit -m "feat(game): decide what a backgrounded tab does to a run

onHidden(phase) ends a running run and rewinds a countdown to idle. Extracted
as pure logic so it can be tested — vitest only collects .ts here."
```

---

### Task 2: Wire the visibility guard into `GameCanvas`

Registers the `visibilitychange` listener that acts on `onHidden`'s decision.

**Files:**
- Modify: `frontend/src/components/GameCanvas.tsx` (import line 2; the effect body around line 39; the cleanup return on line 138)

**Interfaces:**
- Consumes: `onHidden`, `VisibilityAction` from Task 1; the existing effect locals `phase`, `endedRef`, `raf`, `taps`, `sim`, and the `onRunEnd` prop.
- Produces: nothing consumed by later tasks. `GameCanvas`'s props are unchanged.

- [ ] **Step 1: Extend the `runPhase` import**

In `frontend/src/components/GameCanvas.tsx`, the import currently reads:

```ts
import { COUNTDOWN_MS, countdownLabel, onPointerDown, type RunPhase } from '@/lib/runPhase';
```

Replace it with:

```ts
import { COUNTDOWN_MS, countdownLabel, onHidden, onPointerDown, type RunPhase } from '@/lib/runPhase';
```

- [ ] **Step 2: Register the visibility listener**

The `pointerdown` listener is registered at line 39:

```ts
    canvas.addEventListener('pointerdown', onDown);
```

Immediately after that line, add:

```ts

    // A backgrounded tab throttles requestAnimationFrame; on return the accumulator
    // would burn a tick backlog with no input and kill the bird. End a running run
    // (the honest outcome — the player stopped tapping) and rewind a countdown to
    // idle. Using visibilitychange, not blur: blur also fires for a wallet popup while
    // the page is still visible, which is not the condition that causes the backlog.
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') return;
      const action = onHidden(phase);
      if (action === 'end-run') {
        if (!endedRef.current) { endedRef.current = true; cancelAnimationFrame(raf); onRunEnd(taps, sim.state.score); }
      } else if (action === 'reset-idle') {
        // countdownStart is left stale on purpose: the next tap from idle re-arms it
        // fresh, and the running transition resets last/acc, so nothing leaks forward.
        phase = 'idle';
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
```

- [ ] **Step 3: Remove the listener on cleanup**

The cleanup return is line 138:

```ts
    return () => { cancelAnimationFrame(raf); canvas.removeEventListener('pointerdown', onDown); };
```

Replace it with:

```ts
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      document.removeEventListener('visibilitychange', onVisibility);
    };
```

- [ ] **Step 4: Verify the full suite, build, and lint**

Run: `npm test && npm run build`

Expected: `npm test` — all files pass, including `runPhase.test.ts` (with the new `onHidden` tests) and `engine.test.ts`'s golden test. `npm run build` — compiles with no TypeScript errors.

Run: `npm run lint`

Expected: no **new** errors in `src/components/GameCanvas.tsx` or `src/lib/runPhase.ts`. (The repo has pre-existing lint errors in `Shell.tsx`, `fame/page.tsx`, `play/page.tsx`, and `duels/new/page.tsx` that this plan does not touch and does not fix.)

- [ ] **Step 5: Manual check with Playwright**

Start the dev server (`npm run dev`) and, against `http://localhost:3000/play`, verify:

1. **Mid-run end:** tap once to start, wait past `GO` so the bird is falling, then dispatch a hide and confirm the run ends (game-over appears). In a driver:

```js
// after the bird is running:
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
document.dispatchEvent(new Event('visibilitychange'));
```

Expected: the "Game over" dialog appears — the run ended rather than continuing.

2. **Mid-countdown reset:** reload, tap once to start the countdown, then (before it finishes) dispatch the same hide. Restore visibility and confirm the canvas is back at `TAP TO START`:

```js
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
document.dispatchEvent(new Event('visibilitychange'));
```

Expected: the frozen `TAP TO START` overlay is shown again; a fresh tap restarts the countdown from `3`.

- [ ] **Step 6: Commit**

```bash
git add src/components/GameCanvas.tsx
git commit -m "feat(game): end a run when its tab is backgrounded mid-play

A backgrounded tab throttles rAF; on return the accumulator burned a tick
backlog with no input and killed the bird — costing a staked player for
something that was not skill. A visibilitychange listener ends a running run
through the existing end path and rewinds a countdown to idle."
```

---

## Final verification

- [ ] **Full suite:** `cd frontend && npm test` — all green, including `engine.test.ts`'s golden physics test and the new `onHidden` cases.
- [ ] **Build:** `npm run build` — no TypeScript errors.
- [ ] **Manual:** both Playwright checks in Task 2 Step 5 pass — a run ends when hidden mid-play; a countdown returns to `TAP TO START` when hidden.

## Known gaps, deliberately not addressed here

- **No pause and no explicit forfeit button.** A staked, deterministic game must not let a player rest or plan mid-run, and a player can already forfeit by letting the bird crash. Both are recorded as out of scope in the spec.
- **`visibilitychange` does not fire for every interruption.** A notification banner that does not hide the page will not end the run; only a genuine background/lock does. That is intended — the guard targets the backlog hazard, which only occurs when rAF is actually throttled.
