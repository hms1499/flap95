import { NextResponse } from 'next/server';
import { getName, getBestScore } from '@/lib/profileStore';
import { listDuelsForAddress, type DuelRow } from '@/lib/duelStore';
import { splitDuels } from '@/lib/profileDuels';

/**
 * The exact wire shape. Scores are deliberately absent: the page shows
 * outcomes from `winner`, and an opponent's score must never reach a client
 * that has not finished its own run.
 *
 * `winner` and `settleTx` are withheld until the duel is settled, matching
 * /api/duels/[id]. `winner` is written as early as the accepted -> settling
 * transition — including by the reconciler's forfeit path, where the acceptor
 * never played — so returning it unconditionally would reveal an outcome that
 * is not final yet.
 */
function toWire(d: DuelRow) {
  const settled = d.status === 'settled';
  return {
    id: d.id, status: d.status, stakeWei: d.stakeWei, token: d.token,
    creator: d.creator, acceptor: d.acceptor,
    winner: settled ? d.winner : null,
    settleTx: settled ? d.settleTx : null,
    createdAt: d.createdAt,
  };
}

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get('address') ?? '';
  if (!/^0x[0-9a-fA-F]{40}$/.test(address))
    return NextResponse.json({ error: 'bad input' }, { status: 400 });
  const addr = address.toLowerCase();
  const [name, bestScore, rows] = await Promise.all([
    getName(addr), getBestScore(addr), listDuelsForAddress(addr),
  ]);
  const { active, history } = splitDuels(rows);
  return NextResponse.json({
    name, bestScore, active: active.map(toWire), history: history.map(toWire),
  });
}
