import { NextResponse } from 'next/server';
import { parseEventLogs } from 'viem';
import { publicClient } from '@/lib/chain';
import { ESCROW_ADDRESS, duelEscrowAbi } from '@/lib/contracts';
import { getDuel, markAccepted } from '@/lib/duelStore';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const duel = await getDuel(Number(id));
  if (!duel || duel.status !== 'open' || !duel.onchainId)
    return NextResponse.json({ error: 'bad state' }, { status: 409 });

  const { txHash } = await req.json();
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') return NextResponse.json({ error: 'tx failed' }, { status: 400 });

  const events = parseEventLogs({ abi: duelEscrowAbi, eventName: 'DuelAccepted', logs: receipt.logs })
    .filter((l) => l.address.toLowerCase() === ESCROW_ADDRESS.toLowerCase())
    .filter((l) => l.args.id === BigInt(duel.onchainId!));
  if (events.length !== 1) return NextResponse.json({ error: 'no matching DuelAccepted event' }, { status: 400 });

  await markAccepted(duel.id, events[0].args.acceptor);
  // Ghost is revealed only now — after acceptance is proven on-chain (blind duels).
  return NextResponse.json({
    ok: true, seed: duel.seed, ghostTaps: duel.creatorTaps, ghostScore: duel.creatorScore,
  });
}
