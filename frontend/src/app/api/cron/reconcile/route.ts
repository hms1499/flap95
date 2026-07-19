import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { zeroAddress, formatEther, type Address } from 'viem';
import { publicClient } from '@/lib/chain';
import { ESCROW_ADDRESS, USDM_ADDRESS, duelEscrowAbi, erc20Abi } from '@/lib/contracts';
import { relaySettle, oracleAddress, RELAY_RECEIPT_TIMEOUT_MS } from '@/lib/oracle';
import { listReconcileCandidates, markSettling, markSettled, markChainResolved, type DuelRow } from '@/lib/duelStore';
import { planReconcileAction } from '@/lib/reconcile';

export const dynamic = 'force-dynamic';
// Sequential on-chain relays run per invocation — give this route real headroom, and pair
// it with the wall-clock budget below so we bail out safely before the platform kills the
// invocation outright. relaySettle awaits each receipt (so a revert reads as failure), which
// caps throughput at a handful of duels per run rather than 100: relays may only *start*
// while TIME_BUDGET_MS - RELAY_RECEIPT_TIMEOUT_MS of budget remains, so the worst case is a
// relay beginning at 30s and timing out at 50s, still inside maxDuration. Cheap outcomes
// (chain-resolved syncs, skips) keep running until the full budget. That is fine at a
// 10-minute cadence, and the `remaining` count in the response surfaces any real backlog.
export const maxDuration = 60;

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
  //
  // This is a *diagnostic* read, so it must never gate the liveness work: one transient RPC
  // failure here used to 500 the whole invocation and reconcile nothing for that tick. On
  // failure we report null balances and lowGas: null ("unknown", distinct from false) and
  // carry on into the loop.
  const oracle = oracleAddress();
  let celoBal: bigint | null = null;
  let usdmBal: bigint | null = null;
  let lowGas: boolean | null = null;
  try {
    celoBal = await publicClient.getBalance({ address: oracle });
    usdmBal = await publicClient.readContract({
      address: USDM_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [oracle],
    });
    lowGas = usdmBal < LOW_USDM;
    if (lowGas) console.warn(`[reconcile] LOW ORACLE GAS celo=${formatEther(celoBal)} usdm=${formatEther(usdmBal)}`);
  } catch (err) {
    console.error('[reconcile] oracle balance read failed — continuing without gas health', err);
  }

  const startedAt = Date.now();
  // `changed` records whether THIS RUN moved the row. It is set from the return value of the
  // write that moved it, never inferred from the action name: a guarded UPDATE can match zero
  // rows and a relay can fail, both of which leave the row exactly as it was. This is the
  // signal that tells a jammed queue (rows examined every run, none of them movable) apart
  // from a healthy idle one, so it has to mean what it says. Where a row moved but another
  // actor moved it (skip-lost-race), this run gets no credit — under-reporting is the safe
  // direction for a health metric.
  const results: {
    id: number; action: string; changed: boolean; settleTx?: string | null; onchainStatus?: number;
  }[] = [];
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
    // hash must not be lost. `action` is likewise hoisted so a failure is triageable: the
    // log must say whether the row that blew up was a forfeit or a retry.
    let settleTx: string | null = null;
    let action: string = 'pre-flight';
    try {
      if (!d.onchainId) { results.push({ id: d.id, action: 'skip-no-onchain-id', changed: false }); continue; }

      // Authoritative pre-flight: the DB row can diverge from chain truth for any reason
      // (reclaim via refundStale being the motivating case, but not the only one). Read
      // the real on-chain status before ever relaying settle() — a duel already resolved
      // on-chain (Cancelled/Settled/Open/None) must never be relayed again, since settle()
      // would revert and relaySettle broadcasts without simulating first.
      //
      // This read sits ABOVE the action switch so EVERY candidate gets chain-checked,
      // including rows that the planner would skip or merely alert on. Those used to
      // `continue` before ever being reconciled against the chain, which is how DB/chain
      // divergence (a landed acceptDuel whose binding died, a duel nobody accepted) stayed
      // stranded indefinitely.
      const onchainDuel = await publicClient.readContract({
        address: ESCROW_ADDRESS, abi: duelEscrowAbi, functionName: 'duels', args: [BigInt(d.onchainId)],
      });
      const onchainStatus = onchainDuel[4];

      // Settled/Cancelled — the escrow already paid out or refunded. Terminal: sync and
      // never relay.
      if (onchainStatus === 3 || onchainStatus === 4) {
        action = 'skip-chain-resolved';
        const changed = await markChainResolved(d.id, onchainStatus);
        results.push({ id: d.id, action, changed, onchainStatus });
        continue;
      }
      // Open — nobody ever accepted, so there is nothing to settle and only the creator's
      // stake is at risk. We deliberately do NOT call cancelExpired from the oracle: the
      // refund goes to the creator, and we're not spending oracle gas to hand users back
      // their own money. The creator reclaims it themselves from the duel page.
      if (onchainStatus === 1) {
        action = 'chain-open-unaccepted';
        const changed = await markChainResolved(d.id, onchainStatus);
        results.push({ id: d.id, action, changed, onchainStatus });
        continue;
      }
      // None — no such duel on-chain (bad onchain_id, or a create that never landed).
      // Nothing to sync to; leave the row alone for a human.
      if (onchainStatus !== 2) {
        action = 'skip-chain-none';
        console.warn(`[reconcile] duel ${d.id} has no on-chain record (status ${onchainStatus})`);
        results.push({ id: d.id, action, changed: false, onchainStatus });
        continue;
      }

      // Chain says Accepted but the DB never caught up — POST /accept died after the
      // acceptDuel tx landed. Sync the row, including the acceptor address that only the
      // chain has, and let a later tick plan from the corrected row (it needs to age 30
      // minutes as 'accepted' before it can forfeit anyway). Without this the row sits at
      // 'open' forever while the escrow holds both stakes, and the only recourse left is a
      // player finding the 24h refundStale button themselves.
      if (d.status === 'open' || d.status === 'funded') {
        action = 'chain-accepted-sync';
        const synced = await markChainResolved(d.id, onchainStatus, { acceptor: onchainDuel[1] });
        results.push({
          id: d.id, action: synced ? action : `${action}-noop`, changed: synced, onchainStatus,
        });
        continue;
      }

      // Chain says Accepted — the row is genuinely live and the planner decides from here.
      action = planReconcileAction(d, startedAt);
      // Recorded rather than silently dropped so `processed` reflects rows examined, not
      // just rows acted on.
      if (action === 'skip') { results.push({ id: d.id, action, changed: false, onchainStatus }); continue; }
      if (action === 'stale-alert') {
        console.warn(`[reconcile] duel ${d.id} stuck >24h — refundStale is available on-chain`);
        results.push({ id: d.id, action, changed: false, onchainStatus });
        continue;
      }
      if (d.creatorScore === null) { results.push({ id: d.id, action: 'skip-incomplete', changed: false }); continue; }

      // Both remaining actions broadcast a settle() and then block for up to
      // RELAY_RECEIPT_TIMEOUT_MS waiting on its receipt. The top-of-loop budget check can
      // only fire *between* iterations, so it cannot interrupt a relay already in flight —
      // starting one without that much budget still in hand is what runs the invocation past
      // maxDuration and gets it killed, losing the tx hash and the response along with it.
      // Stop cleanly here instead; the row is untouched, so the next tick picks it up.
      if (Date.now() - startedAt > TIME_BUDGET_MS - RELAY_RECEIPT_TIMEOUT_MS) {
        remaining = candidates.length - i;
        break;
      }

      if (action === 'forfeit') {
        // markSettling's guarded UPDATE (where status = 'accepted') is our atomic claim on
        // this duel. If it returns false, a live user request (replay/route.ts) already won
        // the race and moved the row — we must not also relay settle() for it.
        const gotSettling = await markSettling(d.id, [], 0, 'creator');
        if (!gotSettling) {
          results.push({ id: d.id, action: 'skip-lost-race', changed: false });
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
        results.push({ id: d.id, action: 'skip-no-winner', changed: false });
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
      results.push({ id: d.id, action, changed: settleTx !== null, settleTx });
    } catch (err) {
      // One bad row must never abort the run — a failed row's updated_at never changes, so
      // an uncaught throw here would make it first-in-line on every subsequent run
      // (permanent head-of-line block). If relaySettle already succeeded and the throw came
      // from markSettled, settleTx (captured above) preserves the hash so a human can
      // reconcile the real on-chain settlement manually instead of it being silently lost.
      console.error('[reconcile] duel failed, skipping', { duelId: d.id, action, settleTx, err });
      results.push({ id: d.id, action: `error:${action}`, changed: settleTx !== null, settleTx });
    }
  }

  // `processed` counts every row examined (skips included); `acted` is the subset this run
  // actually moved. Deriving `acted` from the action name instead counted stale-alert (which
  // only logs), a no-op chain sync, and even an outright error as work done — exactly
  // backwards, since those are the outcomes that signal the queue is filling with rows
  // nothing can move. processed high with acted at zero, run after run, is that alarm.
  const acted = results.filter((r) => r.changed).length;
  return NextResponse.json({
    processed: results.length, acted, results, remaining,
    oracle: {
      address: oracle,
      celoBal: celoBal === null ? null : celoBal.toString(),
      usdmBal: usdmBal === null ? null : usdmBal.toString(),
      lowGas,
    },
  });
}

export async function GET(req: Request) { return run(req); }
export async function POST(req: Request) { return run(req); }
