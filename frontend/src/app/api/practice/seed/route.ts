import { NextResponse } from 'next/server';
import { randomInt } from 'node:crypto';
import { issueSeedToken } from '@/lib/seedToken';

/** Hands out a seed the server chose, with a token binding it to an issue time. */
export async function GET() {
  const secret = process.env.SEED_SECRET;
  if (!secret) return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
  const seed = randomInt(0, 2 ** 31);
  return NextResponse.json({ seed, token: issueSeedToken(seed, Date.now(), secret) });
}
