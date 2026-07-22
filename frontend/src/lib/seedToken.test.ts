import { describe, it, expect } from 'vitest';
import { issueSeedToken, verifySeedToken, submittedTooFast, SEED_TTL_MS } from './seedToken';

const SECRET = 'test-secret';
const T0 = 1_800_000_000_000;

describe('seed token', () => {
  it('round-trips a seed and its issue time', () => {
    const token = issueSeedToken(12345, T0, SECRET);
    expect(verifySeedToken(token, SECRET, T0 + 1000)).toEqual({ ok: true, seed: 12345, issuedAt: T0 });
  });

  it('rejects a tampered payload', () => {
    const token = issueSeedToken(1, T0, SECRET);
    const forged = `${Buffer.from('999.' + T0).toString('base64url')}.${token.split('.')[1]}`;
    expect(verifySeedToken(forged, SECRET, T0)).toEqual({ ok: false, error: 'bad_token' });
  });

  it('rejects a tampered signature', () => {
    const token = issueSeedToken(1, T0, SECRET);
    expect(verifySeedToken(`${token.split('.')[0]}.deadbeef`, SECRET, T0))
      .toEqual({ ok: false, error: 'bad_token' });
  });

  it('rejects a token signed with a different secret', () => {
    const token = issueSeedToken(1, T0, 'other-secret');
    expect(verifySeedToken(token, SECRET, T0)).toEqual({ ok: false, error: 'bad_token' });
  });

  it('rejects malformed input without throwing', () => {
    expect(verifySeedToken('', SECRET, T0)).toEqual({ ok: false, error: 'bad_token' });
    expect(verifySeedToken('nodot', SECRET, T0)).toEqual({ ok: false, error: 'bad_token' });
  });

  it('expires after the TTL', () => {
    const token = issueSeedToken(7, T0, SECRET);
    expect(verifySeedToken(token, SECRET, T0 + SEED_TTL_MS)).toMatchObject({ ok: true });
    expect(verifySeedToken(token, SECRET, T0 + SEED_TTL_MS + 1)).toEqual({ ok: false, error: 'stale_token' });
  });

  it('rejects a token issued in the future', () => {
    const token = issueSeedToken(7, T0, SECRET);
    expect(verifySeedToken(token, SECRET, T0 - 1)).toEqual({ ok: false, error: 'stale_token' });
  });
});

describe('submittedTooFast', () => {
  it('rejects a long run submitted moments after the seed was issued', () => {
    // 1800 ticks at 60/s is 30 seconds of play; 2 seconds is not enough.
    expect(submittedTooFast(1800, T0, T0 + 2000)).toBe(true);
  });

  it('accepts a run submitted after at least its own duration', () => {
    expect(submittedTooFast(1800, T0, T0 + 30_000)).toBe(false);
  });

  it('allows a small slack for network and clock drift', () => {
    // 30s of play submitted at 29s is allowed; at 28s it is not.
    expect(submittedTooFast(1800, T0, T0 + 29_000)).toBe(false);
    expect(submittedTooFast(1800, T0, T0 + 28_000)).toBe(true);
  });

  it('never blocks a very short run', () => {
    expect(submittedTooFast(30, T0, T0 + 10)).toBe(false);
  });
});
