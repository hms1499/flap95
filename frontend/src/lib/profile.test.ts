import { describe, it, expect } from 'vitest';
import { normalizeName, setNameMessage, practiceMessage, tapsHash, SIG_FRESH_MS, verifySignedAction } from './profile';
import { privateKeyToAccount } from 'viem/accounts';

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

describe('verifySignedAction', () => {
  // Well-known anvil test key #1 — not a secret.
  const account = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');

  it('accepts a fresh, valid signature', async () => {
    const ts = 1_753_142_400_000;
    const message = setNameMessage('Huy', ts);
    const signature = await account.signMessage({ message });
    await expect(
      verifySignedAction({ address: account.address, message, signature, timestamp: ts, now: ts + 1000 }),
    ).resolves.toBe('ok');
  });

  it('rejects a signature attributed to a different wallet', async () => {
    const ts = 1_753_142_400_000;
    const message = setNameMessage('Huy', ts);
    const signature = await account.signMessage({ message });
    await expect(
      verifySignedAction({
        address: '0x000000000000000000000000000000000000dEaD',
        message, signature, timestamp: ts, now: ts + 1000,
      }),
    ).resolves.toBe('bad_signature');
  });

  it('rejects a stale timestamp', async () => {
    const ts = 1_753_142_400_000;
    const message = setNameMessage('Huy', ts);
    const signature = await account.signMessage({ message });
    await expect(
      verifySignedAction({ address: account.address, message, signature, timestamp: ts, now: ts + SIG_FRESH_MS + 1 }),
    ).resolves.toBe('stale');
  });

  it('rejects a non-finite timestamp', async () => {
    await expect(
      verifySignedAction({ address: account.address, message: 'x', signature: '0x12', timestamp: NaN }),
    ).resolves.toBe('stale');
  });

  it('rejects garbage signatures without throwing', async () => {
    await expect(
      verifySignedAction({ address: account.address, message: 'x', signature: '0x1234', timestamp: Date.now() }),
    ).resolves.toBe('bad_signature');
  });
});
