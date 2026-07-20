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
    await setCreatorRun(duel.id, taps, r.score, r.deathTick);
    return NextResponse.json({ ok: true, score: r.score });
  }

  if (role === 'acceptor') {
    if (duel.status !== 'accepted' || !duel.onchainId || duel.creatorScore === null)
      return NextResponse.json({ error: 'bad state' }, { status: 409 });
    const r = verifyRun(duel.seed, taps);
    // A trace that fails verification is a forfeit, decided before any tie-break: the
    // creator wins outright and the acceptor is recorded at 0. Survival time is meaningless
    // for a run we could not replay, so it is stored as 0 rather than fabricated.
    const acceptorScore = r.ok ? r.score : 0;
    const acceptorDeathTick = r.ok ? r.deathTick : 0;
    const winner = r.ok
      ? decideWinner(
          { score: duel.creatorScore, deathTick: duel.creatorDeathTick },
          { score: acceptorScore, deathTick: acceptorDeathTick },
        )
      : 'creator';
    const winnerAddr: Address =
      winner === 'tie' ? zeroAddress
      : winner === 'creator' ? (duel.creator as Address)
      : (duel.acceptor as Address);
    const gotSettling = await markSettling(duel.id, r.ok ? taps : [], acceptorScore, acceptorDeathTick, winner);

    if (!gotSettling) {
      // Lost the race (e.g. the cron reconciler already forfeited this duel). relaySettle
      // must stay unreachable here — report the authoritative persisted outcome instead of
      // this request's own locally computed one, since the row was already settled by
      // whoever won the race.
      const fresh = await getDuel(duel.id);
      if (fresh) {
        return NextResponse.json({
          ok: true, score: fresh.acceptorScore, winner: fresh.winner,
          creatorScore: fresh.creatorScore, acceptorScore: fresh.acceptorScore, settleTx: fresh.settleTx,
        });
      }
      // Row vanished — should not happen. Fall back to this request's own computation.
      return NextResponse.json({
        ok: true, score: acceptorScore, winner,
        creatorScore: duel.creatorScore, acceptorScore, settleTx: null,
      });
    }

    const settleTx = await relaySettle(BigInt(duel.onchainId), winnerAddr, duel.creatorScore, acceptorScore);
    if (settleTx) {
      try {
        await markSettled(duel.id, settleTx);
      } catch (err) {
        // The on-chain settle already succeeded — don't lose the tx hash over a DB hiccup.
        // Log with enough context to reconcile manually; otherwise the reconciler retries
        // and relays again, reverting with WrongStatus() and burning gas.
        console.error('markSettled failed after successful relay', { duelId: duel.id, settleTx, err });
      }
    }
    return NextResponse.json({
      ok: true, score: acceptorScore, winner,
      creatorScore: duel.creatorScore, acceptorScore, settleTx,
    });
  }

  return NextResponse.json({ error: 'bad role' }, { status: 400 });
}
