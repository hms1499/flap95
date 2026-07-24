import { NextResponse } from 'next/server';
import { getName } from '@/lib/profileStore';
import { listDuelsForAddress } from '@/lib/duelStore';
import { splitDuels } from '@/lib/profileDuels';
import { toWire } from '@/lib/meWire';

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get('address') ?? '';
  if (!/^0x[0-9a-fA-F]{40}$/.test(address))
    return NextResponse.json({ error: 'bad input' }, { status: 400 });
  const addr = address.toLowerCase();
  const [name, rows] = await Promise.all([
    getName(addr), listDuelsForAddress(addr),
  ]);
  const { active, history } = splitDuels(rows);
  return NextResponse.json({
    name, active: active.map(toWire), history: history.map(toWire),
  });
}
