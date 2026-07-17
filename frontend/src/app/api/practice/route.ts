import { NextResponse } from 'next/server';
import { verifyRun } from '@/engine/verify';
import { addPracticeScore, topPracticeScores } from '@/lib/duelStore';

export async function POST(req: Request) {
  const { name, seed, taps } = await req.json();
  if (typeof name !== 'string' || !name.trim() || typeof seed !== 'number')
    return NextResponse.json({ error: 'bad input' }, { status: 400 });
  const r = verifyRun(seed, taps);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  await addPracticeScore(name.trim(), r.score);
  return NextResponse.json({ ok: true, score: r.score });
}

export async function GET() {
  return NextResponse.json({ scores: await topPracticeScores() });
}
