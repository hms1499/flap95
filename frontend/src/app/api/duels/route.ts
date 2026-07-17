import { NextResponse } from 'next/server';
import { createDraft, listOpenDuels } from '@/lib/duelStore';
import { isAddress } from 'viem';

export async function POST(req: Request) {
  const body = await req.json();
  if (!isAddress(body.creator)) return NextResponse.json({ error: 'bad creator' }, { status: 400 });
  if (body.challengeTo && !isAddress(body.challengeTo))
    return NextResponse.json({ error: 'bad challengeTo' }, { status: 400 });
  const draft = await createDraft(body.creator, body.challengeTo);
  return NextResponse.json(draft);
}

export async function GET(req: Request) {
  const viewer = new URL(req.url).searchParams.get('viewer') ?? undefined;
  const duels = await listOpenDuels(viewer);
  return NextResponse.json({
    duels: duels.map((d) => ({
      id: d.id, onchainId: d.onchainId, stakeWei: d.stakeWei, token: d.token,
      creator: d.creator, challengeTo: d.challengeTo, createdAt: d.createdAt,
    })),
  });
}
