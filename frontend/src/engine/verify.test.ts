import { describe, it, expect } from 'vitest';
import { validateTaps, verifyRun } from './verify';
import { CONFIG, simulate } from './engine';

describe('validateTaps', () => {
  it('accepts a legal trace', () => expect(validateTaps([0, 10, 20])).toBeNull());
  it('accepts empty trace', () => expect(validateTaps([])).toBeNull());
  it('rejects non-integers', () => expect(validateTaps([1.5])).toBe('not_integers'));
  it('rejects negatives', () => expect(validateTaps([-1, 5])).toBe('not_integers'));
  it('rejects unsorted / duplicate ticks', () => {
    expect(validateTaps([10, 5])).toBe('not_sorted');
    expect(validateTaps([5, 5])).toBe('not_sorted');
  });
  it('rejects superhuman tap rate', () => expect(validateTaps([0, CONFIG.minTapGap - 1])).toBe('taps_too_fast'));
  it('rejects too many taps', () => {
    const taps = Array.from({ length: CONFIG.maxTaps + 1 }, (_, i) => i * CONFIG.minTapGap);
    expect(validateTaps(taps)).toBe('too_many_taps');
  });
  it('rejects taps beyond maxTicks', () => expect(validateTaps([CONFIG.maxTicks])).toBe('out_of_range'));
});

describe('verifyRun', () => {
  it('returns the simulated score for a valid trace', () => {
    const r = verifyRun(42, [5, 15, 25]);
    expect(r).toEqual({ ok: true, ...simulate(42, [5, 15, 25]) });
  });
  it('propagates validation errors', () => {
    expect(verifyRun(42, [3, 3])).toEqual({ ok: false, error: 'not_sorted' });
  });
});
