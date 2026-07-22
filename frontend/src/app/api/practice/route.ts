import { NextResponse } from 'next/server';
import { verifyRun } from '@/engine/verify';
import { upsertBest, topScores } from '@/lib/profileStore';
import { verifySeedToken, submittedTooFast } from '@/lib/seedToken';
import { CONFIG } from '@/engine/engine';

/**
 * Saving a practice score.
 *
 * No signature: MiniPay cannot produce one, and the one we had did not protect
 * what it appeared to. The score is whatever the server's own replay computes,
 * the seed must be one the server issued, and the run must have taken at least
 * as long as it claims to have lasted.
 *
 * The order of the checks below is the security property. Do not reorder:
 * cheap rejections first, replay only after the token proves the seed is ours,
 * and the wall-clock floor last because it needs the replayed deathTick.
 */
export async function POST(req: Request) {
  const secret = process.env.SEED_SECRET;
  if (!secret) return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });

  const body = await req.json().catch(() => null);
  if (body === null || typeof body !== 'object')
    return NextResponse.json({ error: 'bad input' }, { status: 400 });

  const { address, seed, taps, token } = body as Record<string, unknown>;
  if (
    typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address) ||
    typeof seed !== 'number' || typeof token !== 'string' ||
    !Array.isArray(taps) || taps.length > CONFIG.maxTaps
  )
    return NextResponse.json({ error: 'bad input' }, { status: 400 });

  const now = Date.now();
  const t = verifySeedToken(token, secret, now);
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: 401 });
  if (t.seed !== seed) return NextResponse.json({ error: 'bad_token' }, { status: 401 });

  const r = verifyRun(seed, taps as number[]);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });

  if (submittedTooFast(r.deathTick, t.issuedAt, now))
    return NextResponse.json({ error: 'too_fast' }, { status: 400 });

  await upsertBest(address.toLowerCase(), r.score);
  return NextResponse.json({ ok: true, score: r.score });
}

export async function GET() {
  return NextResponse.json({ scores: await topScores() });
}
