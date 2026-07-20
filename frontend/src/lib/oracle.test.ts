import { describe, it, expect, vi, beforeEach } from 'vitest';

const getBlock = vi.fn();
const request = vi.fn();
vi.mock('./chain', () => ({ publicClient: { getBlock: () => getBlock(), request: (a: unknown) => request(a) } }));

import { decideWinner, feeFields, type RunOutcome } from './oracle';

describe('decideWinner', () => {
  const run = (score: number, deathTick: number | null = null): RunOutcome => ({ score, deathTick });

  it('creator wins on higher score', () => {
    expect(decideWinner(run(5), run(3))).toBe('creator');
  });
  it('acceptor wins on higher score', () => {
    expect(decideWinner(run(2), run(3))).toBe('acceptor');
  });
  it('score beats survival time — a lower score never wins by lasting longer', () => {
    expect(decideWinner(run(5, 100), run(3, 3600))).toBe('creator');
  });

  it('equal scores: whoever survived longer wins', () => {
    expect(decideWinner(run(4, 900), run(4, 800))).toBe('creator');
    expect(decideWinner(run(4, 800), run(4, 900))).toBe('acceptor');
  });
  it('equal score and equal survival time is a true tie', () => {
    expect(decideWinner(run(4, 900), run(4, 900))).toBe('tie');
    expect(decideWinner(run(0, 55), run(0, 55))).toBe('tie');
  });

  // Legacy duels: rows created before the death-tick columns existed. They must settle
  // under the rule that applied when they were created — score only, ties refund.
  it('ties when either side has no recorded survival time', () => {
    expect(decideWinner(run(4, null), run(4, 900))).toBe('tie');
    expect(decideWinner(run(4, 900), run(4, null))).toBe('tie');
    expect(decideWinner(run(4, null), run(4, null))).toBe('tie');
  });
  it('still decides on score when survival time is missing', () => {
    expect(decideWinner(run(5, null), run(3, null))).toBe('creator');
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
