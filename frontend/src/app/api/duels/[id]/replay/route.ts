import { NextResponse } from 'next/server';
import { zeroAddress, type Address } from 'viem';
import { verifyRun } from '@/engine/verify';
import { getDuel, setCreatorRun, markSettling, markSettled } from '@/lib/duelStore';
import { decideWinner, relaySettle } from '@/lib/oracle';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const duel = await getDuel(Number(id));
  if (!duel) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const { role, taps } = await req.json();

  if (role === 'creator') {
    if (duel.status !== 'funded') return NextResponse.json({ error: 'bad state' }, { status: 409 });
    const r = verifyRun(duel.seed, taps);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    await setCreatorRun(duel.id, taps, r.score);
    return NextResponse.json({ ok: true, score: r.score });
  }

  if (role === 'acceptor') {
    if (duel.status !== 'accepted' || !duel.onchainId || duel.creatorScore === null)
      return NextResponse.json({ error: 'bad state' }, { status: 409 });
    const r = verifyRun(duel.seed, taps);
    // Invalid acceptor trace = forfeit: creator wins, acceptor scored 0.
    const acceptorScore = r.ok ? r.score : 0;
    const winner = r.ok ? decideWinner(duel.creatorScore, acceptorScore) : 'creator';
    const winnerAddr: Address =
      winner === 'tie' ? zeroAddress
      : winner === 'creator' ? (duel.creator as Address)
      : (duel.acceptor as Address);
    const gotSettling = await markSettling(duel.id, r.ok ? taps : [], acceptorScore, winner);
    let settleTx: string | null = null;
    if (gotSettling) {
      settleTx = await relaySettle(BigInt(duel.onchainId), winnerAddr, duel.creatorScore, acceptorScore);
      if (settleTx) await markSettled(duel.id, settleTx);
    }
    return NextResponse.json({
      ok: true, score: acceptorScore, winner,
      creatorScore: duel.creatorScore, acceptorScore, settleTx,
    });
  }

  return NextResponse.json({ error: 'bad role' }, { status: 400 });
}
