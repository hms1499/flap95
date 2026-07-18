import { NextResponse } from 'next/server';
import { zeroAddress, formatEther, type Address } from 'viem';
import { publicClient } from '@/lib/chain';
import { USDM_ADDRESS, erc20Abi } from '@/lib/contracts';
import { relaySettle, oracleAddress } from '@/lib/oracle';
import { listReconcileCandidates, markSettling, markSettled, type DuelRow } from '@/lib/duelStore';
import { planReconcileAction } from '@/lib/reconcile';

export const dynamic = 'force-dynamic';

const LOW_CELO = 5n * 10n ** 17n; // 0.5 CELO
const LOW_USDM = 1n * 10n ** 18n; // 1 USDm

function winnerAddress(d: DuelRow): Address {
  return d.winner === 'tie' ? zeroAddress
    : d.winner === 'acceptor' ? (d.acceptor as Address)
    : (d.creator as Address);
}

async function run(req: Request) {
  // Fail closed in production: an unset CRON_SECRET must refuse, not open the gate.
  // This endpoint spends real oracle gas on-chain, so leaving it publicly callable
  // whenever the secret is unset would be a gas-drain vector. Local dev stays open
  // (no secret configured there) so it can still be smoke-tested by hand.
  const secret = process.env.CRON_SECRET;
  const isDev = process.env.NODE_ENV === 'development';

  if (!secret) {
    if (!isDev) {
      console.error('[reconcile] CRON_SECRET unset — refusing to run');
      return NextResponse.json({ error: 'not configured' }, { status: 401 });
    }
  } else if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const now = Date.now();
  const results: { id: number; action: string; settleTx?: string | null }[] = [];

  for (const d of await listReconcileCandidates()) {
    const action = planReconcileAction(d, now);
    if (action === 'skip') { continue; }
    if (action === 'stale-alert') {
      console.warn(`[reconcile] duel ${d.id} stuck >24h — refundStale is available on-chain`);
      results.push({ id: d.id, action });
      continue;
    }
    if (!d.onchainId || d.creatorScore === null) { results.push({ id: d.id, action: 'skip-incomplete' }); continue; }

    if (action === 'forfeit') {
      // markSettling's guarded UPDATE (where status = 'accepted') is our atomic claim on
      // this duel. If it returns false, a live user request (replay/route.ts) already won
      // the race and moved the row — we must not also relay settle() for it.
      const gotSettling = await markSettling(d.id, [], 0, 'creator');
      if (!gotSettling) {
        results.push({ id: d.id, action: 'skip-lost-race' });
        continue;
      }
    }
    // Note: in the 'retry' branch the row is already 'settling', so markSettling's guard
    // (where status = 'accepted') could never match here — there is no equivalent atomic
    // claim available for a retry. The 5-minute age floor in listReconcileCandidates is
    // what keeps a retry from colliding with an in-flight live request instead.
    const winner: Address = action === 'forfeit' ? (d.creator as Address) : winnerAddress(d);
    const scoreB = action === 'forfeit' ? 0 : (d.acceptorScore ?? 0);
    const settleTx = await relaySettle(BigInt(d.onchainId), winner, d.creatorScore, scoreB);
    if (settleTx) {
      const settled = await markSettled(d.id, settleTx);
      if (!settled) {
        console.error('markSettled failed after successful relay', { duelId: d.id, settleTx });
      }
    }
    results.push({ id: d.id, action, settleTx });
  }

  // Oracle gas health — low gas is the #1 cause of settlement stalls.
  const oracle = oracleAddress();
  const celoBal = await publicClient.getBalance({ address: oracle });
  const usdmBal = await publicClient.readContract({
    address: USDM_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [oracle],
  });
  const lowGas = celoBal < LOW_CELO && usdmBal < LOW_USDM;
  if (lowGas) console.warn(`[reconcile] LOW ORACLE GAS celo=${formatEther(celoBal)} usdm=${formatEther(usdmBal)}`);

  return NextResponse.json({
    processed: results.length, results,
    oracle: { address: oracle, celoBal: celoBal.toString(), usdmBal: usdmBal.toString(), lowGas },
  });
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }
