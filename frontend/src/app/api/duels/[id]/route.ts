import { NextResponse } from 'next/server';
import { getDuel } from '@/lib/duelStore';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await getDuel(Number(id));
  if (!d) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const settled = d.status === 'settled';
  return NextResponse.json({
    id: d.id, onchainId: d.onchainId, status: d.status, stakeWei: d.stakeWei, token: d.token,
    creator: d.creator, acceptor: d.acceptor, challengeTo: d.challengeTo,
    updatedAt: d.updatedAt,
    creatorScore: settled ? d.creatorScore : null,
    acceptorScore: settled ? d.acceptorScore : null,
    winner: settled ? d.winner : null,
    settleTx: settled ? d.settleTx : null,
  });
}
