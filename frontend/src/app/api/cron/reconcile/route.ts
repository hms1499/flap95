import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { zeroAddress, formatEther, type Address } from 'viem';
import { publicClient } from '@/lib/chain';
import { ESCROW_ADDRESS, USDM_ADDRESS, duelEscrowAbi, erc20Abi } from '@/lib/contracts';
import { relaySettle, oracleAddress } from '@/lib/oracle';
import { listReconcileCandidates, markSettling, markSettled, markChainResolved, type DuelRow } from '@/lib/duelStore';
import { planReconcileAction } from '@/lib/reconcile';

export const dynamic = 'force-dynamic';
// Up to 100 sequential on-chain broadcasts can run per invocation — give this route real
// headroom, and pair it with the wall-clock budget below so we bail out safely before the
// platform kills the invocation outright.
export const maxDuration = 60;

const LOW_CELO = 5n * 10n ** 17n; // 0.5 CELO
const LOW_USDM = 1n * 10n ** 18n; // 1 USDm
// Safe margin under maxDuration (seconds) — leaves headroom for the final DB write + response.
const TIME_BUDGET_MS = 50_000;

function winnerAddress(d: DuelRow): Address | null {
  if (d.winner === 'tie') return zeroAddress;
  if (d.winner === 'acceptor') return d.acceptor as Address;
  if (d.winner === 'creator') return d.creator as Address;
  return null;
}

async function run(req: Request) {
  // Fail closed in production: an unset CRON_SECRET must refuse, not open the gate.
  // This endpoint spends real oracle gas on-chain, so leaving it publicly callable
  // whenever the secret is unset would be a gas-drain vector. Local dev stays open
  // (no secret configured there) so it can still be smoke-tested by hand.
  const secret = process.env.CRON_SECRET;
  const isDev = process.env.NODE_ENV === 'development';
  // Both 401 branches below return an identical body so an unauthenticated caller can't
  // distinguish "secret missing" from "secret wrong" — only the server-side log differs.
  const unauthorized = () => NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (!secret) {
    if (!isDev) {
      console.error('[reconcile] CRON_SECRET unset — refusing to run');
      return unauthorized();
    }
  } else {
    const provided = Buffer.from(req.headers.get('authorization') ?? '');
    const expected = Buffer.from(`Bearer ${secret}`);
    const authorized = provided.length === expected.length && timingSafeEqual(provided, expected);
    if (!authorized) return unauthorized();
  }

  // Oracle gas health — checked and reported before the loop so it always runs, even if
  // the loop later times out. relaySettle pays its fee in USDm unconditionally (see
  // oracle.ts), so USDm is the authoritative signal: CELO is still reported as useful
  // operational context, but it must not mask a USDm shortfall.
  const oracle = oracleAddress();
  const celoBal = await publicClient.getBalance({ address: oracle });
  const usdmBal = await publicClient.readContract({
    address: USDM_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [oracle],
  });
  const lowGas = usdmBal < LOW_USDM;
  if (lowGas) console.warn(`[reconcile] LOW ORACLE GAS celo=${formatEther(celoBal)} usdm=${formatEther(usdmBal)}`);

  const now = Date.now();
  const startedAt = Date.now();
  const results: { id: number; action: string; settleTx?: string | null; onchainStatus?: number }[] = [];
  const candidates = await listReconcileCandidates();
  let remaining = 0;

  for (let i = 0; i < candidates.length; i++) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      remaining = candidates.length - i;
      break;
    }
    const d = candidates[i];
    // Declared outside the try so the catch block can still report the tx hash if
    // markSettled throws after relaySettle already succeeded — real money moved and that
    // hash must not be lost.
    let settleTx: string | null = null;
    try {
      const action = planReconcileAction(d, now);
      if (action === 'skip') { continue; }
      if (action === 'stale-alert') {
        console.warn(`[reconcile] duel ${d.id} stuck >24h — refundStale is available on-chain`);
        results.push({ id: d.id, action });
        continue;
      }
      if (!d.onchainId || d.creatorScore === null) { results.push({ id: d.id, action: 'skip-incomplete' }); continue; }

      // Authoritative pre-flight: the DB row can diverge from chain truth for any reason
      // (reclaim via refundStale being the motivating case, but not the only one). Read
      // the real on-chain status before ever relaying settle() — a duel already resolved
      // on-chain (Cancelled/Settled/Open/None) must never be relayed again, since settle()
      // would revert and relaySettle broadcasts without simulating first.
      const onchainDuel = await publicClient.readContract({
        address: ESCROW_ADDRESS, abi: duelEscrowAbi, functionName: 'duels', args: [BigInt(d.onchainId)],
      });
      const onchainStatus = onchainDuel[4];
      if (onchainStatus !== 2) {
        await markChainResolved(d.id, onchainStatus);
        results.push({ id: d.id, action: 'skip-chain-resolved', onchainStatus });
        continue;
      }

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
      const winner: Address | null = action === 'forfeit' ? (d.creator as Address) : winnerAddress(d);
      if (winner === null) {
        // A null/unrecognized winner must never fall back to a default payee — that would
        // silently route the full pot. There is no reachable path to this today (retry
        // implies status='settling', and markSettling always sets a non-null winner), but
        // this guard exists so a future change can't turn that invariant into a money bug.
        results.push({ id: d.id, action: 'skip-no-winner' });
        continue;
      }
      const scoreB = action === 'forfeit' ? 0 : (d.acceptorScore ?? 0);
      settleTx = await relaySettle(BigInt(d.onchainId), winner, d.creatorScore, scoreB);
      if (settleTx) {
        const settled = await markSettled(d.id, settleTx);
        if (!settled) {
          console.error('markSettled failed after successful relay', { duelId: d.id, settleTx });
        }
      }
      results.push({ id: d.id, action, settleTx });
    } catch (err) {
      // One bad row must never abort the run — a failed row's updated_at never changes, so
      // an uncaught throw here would make it first-in-line on every subsequent run
      // (permanent head-of-line block). If relaySettle already succeeded and the throw came
      // from markSettled, settleTx (captured above) preserves the hash so a human can
      // reconcile the real on-chain settlement manually instead of it being silently lost.
      console.error('[reconcile] duel failed, skipping', { duelId: d.id, settleTx, err });
      results.push({ id: d.id, action: 'error', settleTx });
    }
  }

  return NextResponse.json({
    processed: results.length, results, remaining,
    oracle: { address: oracle, celoBal: celoBal.toString(), usdmBal: usdmBal.toString(), lowGas },
  });
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }
