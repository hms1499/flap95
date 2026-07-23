import { NextResponse } from 'next/server';
import { normalizeName } from '@/lib/profile';
import { getName, setName } from '@/lib/profileStore';
import { publicClient } from '@/lib/chain';
import { NAME_REGISTRY_ADDRESS, nameRegistryAbi } from '@/lib/contracts';

/**
 * Syncs a wallet's on-chain name into the local index.
 *
 * The body carries an address and nothing else: the name is read from the
 * registry, never accepted from the caller. That is why this endpoint needs no
 * authentication — anyone may ask the server to re-read the chain for any
 * address, and the answer is the same either way.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (body === null || typeof body !== 'object')
    return NextResponse.json({ error: 'bad input' }, { status: 400 });

  const { address } = body as Record<string, unknown>;
  if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address))
    return NextResponse.json({ error: 'bad input' }, { status: 400 });
  const addr = address.toLowerCase();

  let onchain: string;
  try {
    onchain = await publicClient.readContract({
      address: NAME_REGISTRY_ADDRESS, abi: nameRegistryAbi,
      functionName: 'nameOf', args: [addr as `0x${string}`],
    });
  } catch (e) {
    console.error('registry read failed', e);
    return NextResponse.json({ error: 'chain_unreachable' }, { status: 502 });
  }

  // Never set: nothing to sync. The client falls back to the generated alias.
  if (onchain === '') return NextResponse.json({ name: await getName(addr) });

  // A name can be written directly to the contract without passing through our
  // rules, so it is validated here before it is allowed into the index.
  const n = normalizeName(onchain);
  if (!n.ok) return NextResponse.json({ error: 'bad_name' }, { status: 400 });

  const r = await setName(addr, n.name);
  if (r === 'taken') return NextResponse.json({ error: 'name_taken' }, { status: 409 });
  return NextResponse.json({ name: n.name });
}

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get('address');
  if (!address) return NextResponse.json({ error: 'bad input' }, { status: 400 });
  return NextResponse.json({ name: await getName(address.toLowerCase()) });
}
