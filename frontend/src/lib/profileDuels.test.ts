import { describe, it, expect } from 'vitest';
import { splitDuels } from './profileDuels';
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
