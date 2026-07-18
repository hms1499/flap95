import { NextResponse } from 'next/server';
import { publicClient } from '@/lib/chain';
import { ESCROW_ADDRESS, duelEscrowAbi } from '@/lib/contracts';
import { getDuel, markChainResolved } from '@/lib/duelStore';

// Security: the only client-supplied input is the duel id from the path. We never trust a
// caller's claim that a duel was refunded/settled — we read the on-chain status ourselves
// and only write to the DB when the chain itself says the duel is resolved. Because every
// write is validated against chain truth, this route needs no secret and is safe to call
// repeatedly (idempotent): a call on an already-synced or still-Accepted row is a no-op.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const d = await getDuel(numId);
  if (!d) return NextResponse.json({ error: 'not found' }, { status: 404 });

  if (!d.onchainId) {
    return NextResponse.json({ id: d.id, action: 'skip-no-onchain-id' });
  }

  if (
    d.status !== 'funded' &&
    d.status !== 'open' &&
    d.status !== 'accepted' &&
    d.status !== 'settling'
  ) {
    return NextResponse.json({ id: d.id, action: 'already-terminal' });
  }

  const onchainDuel = await publicClient.readContract({
    address: ESCROW_ADDRESS, abi: duelEscrowAbi, functionName: 'duels', args: [BigInt(d.onchainId)],
  });
  const onchainStatus = onchainDuel[4];

  if (onchainStatus !== 3 && onchainStatus !== 4) {
    return NextResponse.json({ id: d.id, action: 'unchanged', onchainStatus });
  }

  const synced = await markChainResolved(d.id, onchainStatus);
  return NextResponse.json({ id: d.id, action: synced ? 'synced' : 'already-terminal', onchainStatus });
}
