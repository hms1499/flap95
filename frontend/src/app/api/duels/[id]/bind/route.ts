import { NextResponse } from 'next/server';
import { parseEventLogs } from 'viem';
import { publicClient } from '@/lib/chain';
import { ESCROW_ADDRESS, duelEscrowAbi } from '@/lib/contracts';
import { getDuel, markFunded } from '@/lib/duelStore';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const duel = await getDuel(Number(id));
  if (!duel || duel.status !== 'draft') return NextResponse.json({ error: 'bad state' }, { status: 409 });

  const { txHash } = await req.json();
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') return NextResponse.json({ error: 'tx failed' }, { status: 400 });

  const events = parseEventLogs({ abi: duelEscrowAbi, eventName: 'DuelCreated', logs: receipt.logs })
    .filter((l) => l.address.toLowerCase() === ESCROW_ADDRESS.toLowerCase())
    .filter((l) => l.args.creator.toLowerCase() === duel.creator);
  if (events.length !== 1) return NextResponse.json({ error: 'no matching DuelCreated event' }, { status: 400 });

  await markFunded(duel.id, events[0].args.id, events[0].args.stake, events[0].args.token);
  return NextResponse.json({ ok: true });
}
