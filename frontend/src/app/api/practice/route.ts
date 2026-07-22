import { NextResponse } from 'next/server';
import { verifyRun } from '@/engine/verify';
import { practiceMessage, tapsHash, verifySignedAction } from '@/lib/profile';
import { getName, upsertBest, topScores } from '@/lib/profileStore';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (body === null || typeof body !== 'object')
    return NextResponse.json({ error: 'bad input' }, { status: 400 });
  const { address, seed, taps, timestamp, signature } = body;
  if (
    typeof address !== 'string' || typeof seed !== 'number' || !Array.isArray(taps) ||
    typeof timestamp !== 'number' || typeof signature !== 'string'
  )
    return NextResponse.json({ error: 'bad input' }, { status: 400 });
  const v = await verifySignedAction({
    address, message: practiceMessage(seed, tapsHash(taps), timestamp), signature, timestamp,
  });
  if (v !== 'ok') return NextResponse.json({ error: v }, { status: 401 });
  const addr = address.toLowerCase();
  if ((await getName(addr)) === null)
    return NextResponse.json({ error: 'no_profile' }, { status: 400 });
  const r = verifyRun(seed, taps);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  await upsertBest(addr, r.score);
  return NextResponse.json({ ok: true, score: r.score });
}

export async function GET() {
  return NextResponse.json({ scores: await topScores() });
}
