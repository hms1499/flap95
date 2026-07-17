import { describe, it, expect } from 'vitest';
import { mulberry32, hashedUnit } from './rng';

describe('mulberry32', () => {
  it('is deterministic for a seed', () => {
    const a = mulberry32(42), b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
  it('yields values in [0,1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) { const v = r(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
});

describe('hashedUnit', () => {
  it('is order-independent', () => {
    const late = hashedUnit(42, 10);
    expect(hashedUnit(42, 10)).toBe(late);   // same regardless of prior calls
    expect(hashedUnit(42, 0)).not.toBe(hashedUnit(42, 1));
    expect(hashedUnit(1, 5)).not.toBe(hashedUnit(2, 5));
  });
});
