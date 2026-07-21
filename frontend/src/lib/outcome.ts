import { CONFIG } from '../engine/engine';

/** Who is looking at a settled duel. */
export type ViewerRole = 'creator' | 'acceptor' | 'observer';

export interface SettledDuel {
  winner: 'creator' | 'acceptor' | 'tie';
  creatorScore: number;
  acceptorScore: number;
  creatorDeathTick: number | null;
  acceptorDeathTick: number | null;
}

export interface OrientedResult {
  won: boolean;
  tie: boolean;
  observer: boolean;
  yourScore: number;
  theirScore: number;
  yourDeathTick: number | null;
  theirDeathTick: number | null;
  yourLabel: string;
  theirLabel: string;
  /** Which side of the board actually won — drives the highlight. */
  winnerSide: 'yours' | 'theirs' | 'none';
}

/** Addresses are stored lowercased but wallets hand them back checksummed, so compare folded. */
export function viewerRole(
  address: string | undefined,
  creator: string,
  acceptor: string | null,
): ViewerRole {
  const a = address?.toLowerCase();
  if (!a) return 'observer';
  if (a === creator.toLowerCase()) return 'creator';
  if (acceptor && a === acceptor.toLowerCase()) return 'acceptor';
  return 'observer';
}

/**
 * Presents a settled duel from one viewer's side of the board.
 *
 * An observer is shown the duel from the creator's side but is never told they won —
 * nobody should get a VICTORY banner for a duel they were not in.
 */
export function orientResult(role: ViewerRole, d: SettledDuel): OrientedResult {
  const asCreator = role !== 'acceptor';
  const observer = role === 'observer';
  const tie = d.winner === 'tie';

  const winnerSide: OrientedResult['winnerSide'] =
    tie ? 'none'
    : (d.winner === 'creator') === asCreator ? 'yours'
    : 'theirs';

  return {
    won: !observer && !tie && winnerSide === 'yours',
    tie,
    observer,
    yourScore: asCreator ? d.creatorScore : d.acceptorScore,
    theirScore: asCreator ? d.acceptorScore : d.creatorScore,
    yourDeathTick: asCreator ? d.creatorDeathTick : d.acceptorDeathTick,
    theirDeathTick: asCreator ? d.acceptorDeathTick : d.creatorDeathTick,
    yourLabel: observer ? 'CREATOR' : 'YOU',
    theirLabel: observer ? 'ACCEPTOR' : 'THEM',
    winnerSide,
  };
}

/** Engine ticks as display seconds, e.g. 900 -> "15.0". */
export function tickToSeconds(tick: number): string {
  return (tick / CONFIG.ticksPerSecond).toFixed(1);
}
