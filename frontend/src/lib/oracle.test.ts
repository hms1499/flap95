import { describe, it, expect, vi, beforeEach } from 'vitest';

const getBlock = vi.fn();
const request = vi.fn();
vi.mock('./chain', () => ({ publicClient: { getBlock: () => getBlock(), request: (a: unknown) => request(a) } }));

import { decideWinner, feeFields } from './oracle';

describe('decideWinner', () => {
  it('creator wins on higher score', () => expect(decideWinner(5, 3)).toBe('creator'));
  it('acceptor wins on higher score', () => expect(decideWinner(2, 3)).toBe('acceptor'));
  it('equal scores tie (including 0-0)', () => {
    expect(decideWinner(4, 4)).toBe('tie');
    expect(decideWinner(0, 0)).toBe('tie');
  });
});

// Regression cover for the bug that broke every mainnet settle: viem's own fee estimate for a
// fee-currency tx is denominated in that currency and lands an order of magnitude below the
// native base fee the node actually validates against, and the request could degrade from
// cip64 to a plain eip1559 tx the oracle has no CELO budget for.
describe('feeFields', () => {
  const BASE = 217_000_000_000n; // ~217 gwei, the real Celo base fee when the bug was found
  const TIP = 171_475_000n;

  beforeEach(() => {
    getBlock.mockReset().mockResolvedValue({ baseFeePerGas: BASE });
    request.mockReset().mockResolvedValue('0x' + TIP.toString(16));
  });

  it('pins the tx type so it can never degrade to native-gas eip1559', async () => {
    expect((await feeFields()).type).toBe('cip64');
  });

  it('pays gas in USDm', async () => {
    expect((await feeFields()).feeCurrency).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('caps above the NATIVE base fee, not the fee-currency one', async () => {
    const { maxFeePerGas } = await feeFields();
    expect(maxFeePerGas).toBeGreaterThan(BASE);
    expect(maxFeePerGas).toBe(BASE * 2n + TIP);
  });

  it('keeps headroom for a base fee that doubles before inclusion', async () => {
    const { maxFeePerGas } = await feeFields();
    expect(maxFeePerGas).toBeGreaterThanOrEqual(BASE * 2n);
  });

  it('refuses to guess when the chain reports no base fee', async () => {
    getBlock.mockResolvedValue({ baseFeePerGas: null });
    await expect(feeFields()).rejects.toThrow(/baseFeePerGas/);
  });
});
