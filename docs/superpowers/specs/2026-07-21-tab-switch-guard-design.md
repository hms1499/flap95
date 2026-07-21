# Fair Tab-Switch Guard — Design

**Date:** 2026-07-21
**Branch:** `feat/tab-switch-guard`

## Problem

`GameCanvas` drives a run with `requestAnimationFrame` and a fixed-timestep
accumulator:

```ts
acc += now - last;
last = now;
while (acc >= TICK_MS && sim.state.alive) { ... }
```

When a tab is backgrounded — the user switches apps (extremely common inside
MiniPay on a phone), takes a call, or locks the screen — the browser throttles
`requestAnimationFrame`. On return, `now - last` is a large delta, so `acc`
holds a backlog of hundreds of ticks. The `while` loop then burns them all in
one frame with `pendingTap = false`, and the bird falls and dies before it is
drawn once.

In a staked duel on Celo Mainnet this costs the player their stake for a reason
that is not skill. That is the exact class of unfairness the Fair & Feel branch
was created to remove, so leaving it unhandled contradicts that work.

This is the same "catch-up backlog" hazard the countdown already neutralises at
the start of a run (`last = now; acc = 0;` at GO). It is simply unhandled for a
tab-switch that happens **mid-run**.

## Decisions

1. **Tab hidden during an active run → end the run immediately**, uniform for
   practice and duel. This is fair because the engine's `simulate(seed, taps)`
   always plays forward to a natural death: after the last recorded tap the bird
   glides on gravity until it crashes. Submitting the partial tap trace is the
   honest outcome of "the player stopped tapping." No free pause, no fabricated
   score, no backlog death.
2. **Tab hidden during the countdown → reset to `idle`.** The run has not
   started, so nothing is lost. Resetting stops the countdown from silently
   completing while the page is hidden and dropping the player into an
   already-falling run on return.
3. **Silent.** Reuse the existing game-over / settlement path. No message, no
   change to the `onRunEnd` signature.
4. **Use `visibilitychange`, not `blur`.** `blur` fires when focus moves to a
   wallet popup while the page is still visible — too aggressive. `visibilitychange`
   fires only when the page is actually hidden (backgrounded / locked), which is
   the condition that causes the backlog.

## Why the backlog is solved by construction

The only phase that can accumulate a tick backlog is `running`. Because a hidden
tab **ends** a running run and **rewinds** a countdown to `idle`, the game is
never resumed mid-run from a paused `requestAnimationFrame`. The dangerous path
therefore cannot occur; there is no `acc` to clamp.

## Design

### 1. Pure decision logic — `src/lib/runPhase.ts`

Following the Task 4 pattern (vitest only collects `src/**/*.test.ts`, so
decision logic lives in a `.ts` module, not the `.tsx` component):

```ts
export type VisibilityAction = 'end-run' | 'reset-idle' | 'none';

/**
 * What losing visibility means for a run, by phase.
 *
 * Running ends — the bird would fall and die anyway once the player stopped
 * tapping, so submitting the partial trace is the honest result. Countdown
 * rewinds to idle so it cannot complete while the page is hidden. Idle has no
 * run to affect.
 */
export function onHidden(phase: RunPhase): VisibilityAction {
  if (phase === 'running') return 'end-run';
  if (phase === 'countdown') return 'reset-idle';
  return 'none';
}
```

### 2. Wiring — `src/components/GameCanvas.tsx`

Inside the existing effect, alongside the `pointerdown` listener:

```ts
const onVisibility = () => {
  if (document.visibilityState !== 'hidden') return;
  const action = onHidden(phase);
  if (action === 'end-run' && !endedRef.current) {
    endedRef.current = true;
    cancelAnimationFrame(raf);
    onRunEnd(taps, sim.state.score);
  } else if (action === 'reset-idle') {
    phase = 'idle';
  }
};
document.addEventListener('visibilitychange', onVisibility);
```

Cleanup removes the listener alongside the existing `pointerdown` removal and
`cancelAnimationFrame`.

- `endedRef` guards against a double end (e.g. the bird died on the same frame).
- `onRunEnd(taps, sim.state.score)` is the **existing** end path. In a duel the
  server re-simulates the tap trace and computes the authoritative score and
  deathTick; the client score passed here is only used by practice's local
  game-over. No signature change.
- On `reset-idle`, `countdownStart` is left stale on purpose: the next
  `pointerdown` from `idle` sets it fresh (`GameCanvas.tsx` `onDown`), and the
  `running` transition resets `last`/`acc`, so no stale timestamp leaks into a
  later run.

### 3. Testing

- **Pure:** add `describe('onHidden')` to `runPhase.test.ts` — three cases:
  `running → 'end-run'`, `countdown → 'reset-idle'`, `idle → 'none'`.
- **Wiring (`.tsx`):** verified by `npm run build`, and a manual Playwright check
  that dispatches `visibilitychange` (a) mid-run and confirms the run ends, and
  (b) mid-countdown and confirms the overlay returns to `TAP TO START`.

## Scope / constraints

- Off-chain only. No contract, engine, or RNG change.
- Files touched: `src/lib/runPhase.ts`, `src/lib/runPhase.test.ts`,
  `src/components/GameCanvas.tsx`.
- Branch `feat/tab-switch-guard`, off `main`.

## Deliberately out of scope

- **No pause feature.** A staked, deterministic game must not let a player rest
  or plan mid-run; pause is also meaningless in a tick-indexed replay.
- **No explicit forfeit button.** A player can already forfeit by letting the
  bird crash; the outcome is identical. Not worth the UI and test surface.
