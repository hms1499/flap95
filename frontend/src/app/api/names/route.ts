import { NextResponse } from 'next/server';
import { getNames } from '@/lib/profileStore';

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('addrs') ?? '';
  const addrs = raw
    .split(',')
    .filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a))
    .map((a) => a.toLowerCase())
    .slice(0, 50);
  if (addrs.length === 0) return NextResponse.json({ names: {} });
  return NextResponse.json({ names: await getNames(addrs) });
}
