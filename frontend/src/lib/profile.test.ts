import { describe, it, expect } from 'vitest';
import { normalizeName } from './profile';

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
  it('accepts a decomposed (NFD) Vietnamese name by normalizing it', () => {
    const nfd = 'Việt Anh'.normalize('NFD');
    expect(nfd.length).toBe(10);
    expect(normalizeName(nfd)).toEqual({ ok: true, name: 'Việt Anh' });
  });
});

describe('normalizeName vs generated aliases', () => {
  it('rejects a name shaped like a generated alias', () => {
    // Without this, anyone could claim RUFFLED_7F9 and impersonate the wallet
    // that alias belongs to.
    expect(normalizeName('RUFFLED_7F9').ok).toBe(false);
    expect(normalizeName('PLAYER_000').ok).toBe(false);
  });

  it('still accepts ordinary names that merely resemble one', () => {
    expect(normalizeName('Ruffled_7f9').ok).toBe(true);   // not all-caps
    expect(normalizeName('RUFFLED_7F9A').ok).toBe(true);  // four hex chars
    expect(normalizeName('RUFFLED').ok).toBe(true);       // no suffix
  });

  it('still accepts Vietnamese names', () => {
    expect(normalizeName('Đổi Tên OK').ok).toBe(true);
  });
});
