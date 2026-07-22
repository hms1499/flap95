import { NextResponse } from 'next/server';
import { normalizeName, setNameMessage, verifySignedAction } from '@/lib/profile';
import { getName, setName } from '@/lib/profileStore';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (body === null || typeof body !== 'object')
    return NextResponse.json({ error: 'bad input' }, { status: 400 });
  const { address, name, timestamp, signature } = body;
  if (
    typeof address !== 'string' || typeof name !== 'string' ||
    typeof timestamp !== 'number' || typeof signature !== 'string'
  )
    return NextResponse.json({ error: 'bad input' }, { status: 400 });
  const n = normalizeName(name);
  if (!n.ok) return NextResponse.json({ error: 'bad_name' }, { status: 400 });
  const v = await verifySignedAction({
    address, message: setNameMessage(n.name, timestamp), signature, timestamp,
  });
  if (v !== 'ok') return NextResponse.json({ error: v }, { status: 401 });
  const r = await setName(address.toLowerCase(), n.name);
  if (r === 'taken') return NextResponse.json({ error: 'name_taken' }, { status: 409 });
  return NextResponse.json({ ok: true, name: n.name });
}

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get('address');
  if (!address) return NextResponse.json({ error: 'bad input' }, { status: 400 });
  return NextResponse.json({ name: await getName(address.toLowerCase()) });
}
