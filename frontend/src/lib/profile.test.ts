import { describe, it, expect } from 'vitest';
import { normalizeName, setNameMessage, practiceMessage, tapsHash, SIG_FRESH_MS } from './profile';

describe('normalizeName', () => {
  it('trims and accepts a plain name', () => {
    expect(normalizeName('  Huy ')).toEqual({ ok: true, name: 'Huy' });
  });
  it('accepts Vietnamese letters and spaces', () => {
    expect(normalizeName('Việt Anh')).toEqual({ ok: true, name: 'Việt Anh' });
  });
  it('accepts digits, underscore, dot, dash', () => {
    expect(normalizeName('a_b.c-1')).toEqual({ ok: true, name: 'a_b.c-1' });
  });
  it('rejects empty and whitespace-only', () => {
    expect(normalizeName('').ok).toBe(false);
    expect(normalizeName('   ').ok).toBe(false);
  });
  it('rejects more than 16 chars', () => {
    expect(normalizeName('a'.repeat(17)).ok).toBe(false);
    expect(normalizeName('a'.repeat(16)).ok).toBe(true);
  });
  it('rejects emoji', () => {
    expect(normalizeName('bird🐤').ok).toBe(false);
  });
  it('rejects control characters', () => {
    expect(normalizeName('a\nb').ok).toBe(false);
  });
});

describe('message formats', () => {
  it('setNameMessage matches the spec format', () => {
    expect(setNameMessage('Huy', 1753142400000)).toBe('flap95 set-name:Huy ts:1753142400000');
  });
  it('practiceMessage matches the spec format', () => {
    expect(practiceMessage(42, '0xabc', 1753142400000)).toBe('flap95 practice seed:42 taps:0xabc ts:1753142400000');
  });
});

describe('tapsHash', () => {
  it('is deterministic and 0x-prefixed 32-byte hex', () => {
    const h = tapsHash([10, 20, 30]);
    expect(h).toBe(tapsHash([10, 20, 30]));
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it('differs for different taps', () => {
    expect(tapsHash([10, 20])).not.toBe(tapsHash([10, 21]));
  });
});

describe('SIG_FRESH_MS', () => {
  it('is ten minutes', () => {
    expect(SIG_FRESH_MS).toBe(600_000);
  });
});
