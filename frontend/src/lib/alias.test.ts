import { describe, it, expect } from 'vitest';
import { aliasFor, ALIAS_RE } from './alias';

describe('aliasFor', () => {
  it('pins known addresses to known aliases', () => {
    // Regenerating the word list changes these. That is the point: they are the
    // canary for a change that would silently rename every player at once.
    expect(aliasFor('0x5028f26d8c3c0b3d88ab730ef98fef8f4d2f97f9')).toBe('RUFFLED_7F9');
    expect(aliasFor('0x66f744af7b1d1218031c83cb2c62eba7e6138ed8')).toBe('FEATHER_ED8');
    expect(aliasFor('0x64Ad61211C1b0B7f20B3e04B49661f30f152ae78')).toBe('SKYLARK_E78');
  });

  it('ignores the casing of the input address', () => {
    const lower = aliasFor('0x66f744af7b1d1218031c83cb2c62eba7e6138ed8');
    const upper = aliasFor('0x66F744AF7B1D1218031C83CB2C62EBA7E6138ED8');
    expect(upper).toBe(lower);
  });

  it('is deterministic across calls', () => {
    const a = '0x0000000000000000000000000000000000000001';
    expect(aliasFor(a)).toBe(aliasFor(a));
  });

  it('always produces the reserved shape', () => {
    for (let i = 0; i < 64; i++) {
      const addr = `0x${i.toString(16).padStart(2, '0')}${'ab'.repeat(19)}`;
      expect(aliasFor(addr), addr).toMatch(ALIAS_RE);
    }
  });

  it('falls back rather than throwing on a malformed address', () => {
    // Display code must never crash a page over a bad row.
    expect(aliasFor('not-an-address')).toBe('PLAYER_000');
    expect(aliasFor('')).toBe('PLAYER_000');
  });
});
