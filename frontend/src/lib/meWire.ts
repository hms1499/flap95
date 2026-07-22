import type { DuelRow } from './duelStore';

/**
 * The exact shape of a duel on the /api/me wire, and the only definition of it —
 * the route builds it and the profile page consumes it, so a field added on one
 * side and not the other is a type error rather than a silent `undefined`.
 *
 * Scores are deliberately absent: the page shows outcomes from `winner`, and an
 * opponent's score must never reach a client that has not finished its own run.
 */
export interface MeDuel {
  id: number;
  status: DuelRow['status'];
  stakeWei: string | null;
  token: string | null;
  creator: string;
  acceptor: string | null;
  winner: 'creator' | 'acceptor' | 'tie' | null;
  settleTx: string | null;
  createdAt: string;
}

/**
 * `winner` and `settleTx` are withheld until the duel is settled, matching
 * /api/duels/[id]. `winner` is written as early as the accepted -> settling
 * transition — including by the reconciler's forfeit path, where the acceptor
 * never played — so returning it unconditionally would announce an outcome
 * while the settle tx is still in flight and could still revert.
 */
export function toWire(d: DuelRow): MeDuel {
  const settled = d.status === 'settled';
  return {
    id: d.id, status: d.status, stakeWei: d.stakeWei, token: d.token,
    creator: d.creator, acceptor: d.acceptor,
    winner: settled ? d.winner : null,
    settleTx: settled ? d.settleTx : null,
    createdAt: d.createdAt,
  };
}
