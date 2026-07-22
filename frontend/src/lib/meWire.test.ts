import { describe, it, expect } from 'vitest';
import { toWire } from './meWire';
import type { DuelRow } from './duelStore';

/** A row with every secret column populated, so a leak shows up as a value, not a null. */
function loadedRow(status: DuelRow['status'], winner: DuelRow['winner']): DuelRow {
  return {
    id: 42, onchainId: '7', seed: 12345, stakeWei: '200000000000000000',
    token: '0xtoken', creator: '0xcreator', acceptor: '0xacceptor', status,
    creatorScore: 999, acceptorScore: 888, creatorDeathTick: 555, acceptorDeathTick: 444,
    creatorTaps: [1, 2, 3], acceptorTaps: [4, 5, 6], challengeTo: '0xinvitee',
    winner, settleTx: '0xsettle',
    createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T01:00:00.000Z',
  };
}

const WIRE_KEYS = [
  'id', 'status', 'stakeWei', 'token', 'creator', 'acceptor', 'winner', 'settleTx', 'createdAt',
];

describe('toWire', () => {
  it('emits exactly the nine allowed keys — no scores, taps, death ticks or seed', () => {
    for (const status of ['funded', 'open', 'accepted', 'settling', 'settled', 'cancelled'] as const) {
      const keys = Object.keys(toWire(loadedRow(status, 'creator'))).sort();
      expect(keys, `status ${status}`).toEqual([...WIRE_KEYS].sort());
    }
  });

  it('withholds winner and settleTx while a duel is still in flight', () => {
    // markSettling writes `winner` in the same statement that sets status='settling',
    // and the reconciler's forfeit path does the same. Both are outcomes that a settle
    // tx can still revert, so neither may reach a client yet.
    for (const status of ['accepted', 'settling'] as const) {
      const w = toWire(loadedRow(status, 'creator'));
      expect(w.winner, `status ${status}`).toBeNull();
      expect(w.settleTx, `status ${status}`).toBeNull();
    }
  });

  it('withholds a stale winner left on a duel that ended up refunded', () => {
    const w = toWire(loadedRow('cancelled', 'creator'));
    expect(w.winner).toBeNull();
    expect(w.settleTx).toBeNull();
  });

  it('releases winner and settleTx once the duel is settled', () => {
    const w = toWire(loadedRow('settled', 'acceptor'));
    expect(w.winner).toBe('acceptor');
    expect(w.settleTx).toBe('0xsettle');
  });

  it('passes the public fields through unchanged', () => {
    const w = toWire(loadedRow('open', null));
    expect(w).toEqual({
      id: 42, status: 'open', stakeWei: '200000000000000000', token: '0xtoken',
      creator: '0xcreator', acceptor: '0xacceptor', winner: null, settleTx: null,
      createdAt: '2026-07-22T00:00:00.000Z',
    });
  });
});
