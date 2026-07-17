import { CONFIG, simulate } from './engine';

export type TraceError = 'not_integers' | 'not_sorted' | 'too_many_taps' | 'taps_too_fast' | 'out_of_range';

export function validateTaps(taps: readonly number[]): TraceError | null {
  if (taps.length > CONFIG.maxTaps) return 'too_many_taps';
  for (let i = 0; i < taps.length; i++) {
    const t = taps[i];
    if (!Number.isInteger(t) || t < 0) return 'not_integers';
    if (t >= CONFIG.maxTicks) return 'out_of_range';
    if (i > 0) {
      if (t <= taps[i - 1]) return 'not_sorted';
      if (t - taps[i - 1] < CONFIG.minTapGap) return 'taps_too_fast';
    }
  }
  return null;
}

export function verifyRun(
  seed: number,
  taps: readonly number[],
): { ok: true; score: number; deathTick: number } | { ok: false; error: TraceError } {
  const error = validateTaps(taps);
  if (error) return { ok: false, error };
  return { ok: true, ...simulate(seed, taps) };
}
