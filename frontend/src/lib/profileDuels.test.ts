import { describe, it, expect } from 'vitest';
import { splitDuels, activeLabel } from './profileDuels';
import { EXPIRY_MS } from './duelClock';
import type { DuelRow } from './duelStore';

function row(id: number, status: DuelRow['status']): DuelRow {
  return {
    id, onchainId: null, seed: 1, stakeWei: null, token: null,
    creator: '0xaaa', acceptor: null, status,
    creatorScore: null, acceptorScore: null, creatorDeathTick: null, acceptorDeathTick: null,
    creatorTaps: null, acceptorTaps: null, challengeTo: null, winner: null, settleTx: null,
    createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z',
  };
}

describe('splitDuels', () => {
  it('routes every unfinished status to active', () => {
    const { active, history } = splitDuels([
      row(1, 'funded'), row(2, 'open'), row(3, 'accepted'), row(4, 'settling'),
    ]);
    expect(active.map((d) => d.id)).toEqual([1, 2, 3, 4]);
    expect(history).toEqual([]);
  });

  it('routes finished statuses to history', () => {
    const { active, history } = splitDuels([row(5, 'settled'), row(6, 'cancelled')]);
    expect(history.map((d) => d.id)).toEqual([5, 6]);
    expect(active).toEqual([]);
  });

  it('drops drafts entirely — no money is at stake in one', () => {
    const { active, history } = splitDuels([row(7, 'draft'), row(8, 'open')]);
    expect(active.map((d) => d.id)).toEqual([8]);
    expect(history).toEqual([]);
  });

  it('preserves input order within each group', () => {
    const { active } = splitDuels([row(3, 'open'), row(1, 'funded'), row(2, 'accepted')]);
    expect(active.map((d) => d.id)).toEqual([3, 1, 2]);
  });

  it('handles an empty list', () => {
    expect(splitDuels([])).toEqual({ active: [], history: [] });
  });
});

describe('activeLabel', () => {
  const created = Date.parse('2026-07-22T00:00:00.000Z');
  const fresh = created + 60_000;
  const old = created + EXPIRY_MS + 60_000;

  it('describes a fresh duel by what the viewer is waiting on', () => {
    expect(activeLabel('funded', created, fresh)).toBe('Finish your run');
    expect(activeLabel('open', created, fresh)).toBe('Waiting for an opponent');
    expect(activeLabel('accepted', created, fresh)).toBe('Opponent is playing');
    expect(activeLabel('settling', created, fresh)).toBe('Settling…');
  });

  it('offers the reclaim once a stake nobody accepted has expired', () => {
    // cancelExpired is gated on createdAt + EXPIRY, exactly the clock used here,
    // so this promise is one the contract will keep.
    expect(activeLabel('funded', created, old)).toBe('Expired — reclaim your stake');
    expect(activeLabel('open', created, old)).toBe('Expired — reclaim your stake');
  });

  it('only says "check" for a stuck duel, never "refund available"', () => {
    // refundStale runs off the on-chain acceptedAt, which is later than createdAt and
    // is not on the wire. Promising a refund from this clock could promise it early.
    expect(activeLabel('accepted', created, old)).toBe('Taking too long — open to check');
    expect(activeLabel('settling', created, old)).toBe('Taking too long — open to check');
  });

  it('falls back to the fresh label when the clock is unknown', () => {
    // now is null until the client mounts, and a bad timestamp must not age anything.
    expect(activeLabel('open', created, null)).toBe('Waiting for an opponent');
    expect(activeLabel('open', NaN, old)).toBe('Waiting for an opponent');
  });

  it('never ages a status that has no active label', () => {
    expect(activeLabel('settled', created, old)).toBe('settled');
    expect(activeLabel('draft', created, old)).toBe('draft');
  });
});
