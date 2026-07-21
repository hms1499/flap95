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
