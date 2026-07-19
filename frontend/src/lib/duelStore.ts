import { sql } from './db';

export type DuelStatus = 'draft' | 'funded' | 'open' | 'accepted' | 'settling' | 'settled' | 'cancelled';

export interface DuelRow {
  id: number;
  onchainId: string | null;
  seed: number;
  stakeWei: string | null;
  token: string | null;
  creator: string;
  acceptor: string | null;
  status: DuelStatus;
  creatorScore: number | null;
  acceptorScore: number | null;
  creatorTaps: number[] | null;
  acceptorTaps: number[] | null;
  challengeTo: string | null;
  winner: 'creator' | 'acceptor' | 'tie' | null;
  settleTx: string | null;
  createdAt: string;
  updatedAt: string;
}

// The Neon driver parses timestamp columns into JS Date objects, so String(date) would emit
// Date.prototype.toString() ("Sat Jul 18 2026 12:00:00 GMT+0000 (...)"). Parsing that format
// back with Date.parse is engine-specific and unspecified — an engine returning NaN silently
// disables every staleness comparison downstream (notably the reclaim gate in the duel page).
// Always emit ISO 8601, which Date.parse is required to handle.
function toIso(v: unknown): string {
  const d = v instanceof Date ? v : new Date(v as string | number);
  if (Number.isNaN(d.getTime())) {
    console.warn(`[duelStore] unparseable timestamp ${String(v)} — emitting raw value`);
    return String(v);
  }
  return d.toISOString();
}

function toRow(r: Record<string, unknown>): DuelRow {
  return {
    id: r.id as number,
    onchainId: r.onchain_id === null ? null : String(r.onchain_id),
    seed: r.seed as number,
    stakeWei: r.stake_wei === null ? null : String(r.stake_wei),
    token: r.token as string | null,
    creator: r.creator as string,
    acceptor: r.acceptor as string | null,
    status: r.status as DuelStatus,
    creatorScore: r.creator_score as number | null,
    acceptorScore: r.acceptor_score as number | null,
    creatorTaps: r.creator_taps as number[] | null,
    acceptorTaps: r.acceptor_taps as number[] | null,
    challengeTo: r.challenge_to as string | null,
    winner: r.winner as DuelRow['winner'],
    settleTx: r.settle_tx as string | null,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at ?? r.created_at),
  };
}

export async function createDraft(creator: string, challengeTo?: string): Promise<{ id: number; seed: number }> {
  const seed = Math.floor(Math.random() * 2 ** 31);
  const rows = await sql`
    insert into duels (creator, seed, challenge_to)
    values (${creator.toLowerCase()}, ${seed}, ${challengeTo?.toLowerCase() ?? null})
    returning id, seed`;
  return { id: rows[0].id as number, seed: rows[0].seed as number };
}

export async function getDuel(id: number): Promise<DuelRow | null> {
  const rows = await sql`select * from duels where id = ${id}`;
  return rows.length ? toRow(rows[0]) : null;
}

export async function markFunded(id: number, onchainId: bigint, stakeWei: bigint, token: string): Promise<void> {
  await sql`update duels set onchain_id = ${onchainId.toString()}, stake_wei = ${stakeWei.toString()},
    token = ${token.toLowerCase()},
    status = 'funded', updated_at = now() where id = ${id} and status = 'draft'`;
}

export async function setCreatorRun(id: number, taps: number[], score: number): Promise<void> {
  await sql`update duels set creator_taps = ${JSON.stringify(taps)}::jsonb, creator_score = ${score},
    status = 'open', updated_at = now() where id = ${id} and status = 'funded'`;
}

export async function markAccepted(id: number, acceptor: string): Promise<void> {
  await sql`update duels set acceptor = ${acceptor.toLowerCase()}, status = 'accepted', updated_at = now()
    where id = ${id} and status = 'open'`;
}

// Returns false if the guard did not match (another actor already moved the row) —
// the caller lost the race and must not proceed to relay on-chain.
export async function markSettling(
  id: number, taps: number[], score: number, winner: 'creator' | 'acceptor' | 'tie',
): Promise<boolean> {
  const rows = await sql`update duels set acceptor_taps = ${JSON.stringify(taps)}::jsonb, acceptor_score = ${score},
    winner = ${winner}, status = 'settling', updated_at = now()
    where id = ${id} and status = 'accepted'
    returning id`;
  return rows.length > 0;
}

// Returns false if the guard did not match (another actor already moved the row) —
// the caller lost the race and must not proceed to relay on-chain.
export async function markSettled(id: number, settleTx: string): Promise<boolean> {
  const rows = await sql`update duels set settle_tx = ${settleTx}, status = 'settled', updated_at = now()
    where id = ${id} and status in ('accepted', 'settling')
    returning id`;
  return rows.length > 0;
}

// Syncs a row to the status the chain itself reports, as discovered by a chain read
// elsewhere (reconciler pre-flight, refunded route). Chain state is authoritative, but the
// sync must never move a row BACKWARDS out of a terminal state or clobber a more advanced
// one, so each on-chain status has its own `where` guard naming only the DB statuses it is
// legal to move FROM. settle_tx is only set when the row doesn't already have one — a
// Settled duel may already carry a legitimate hash.
// Returns false if the guard did not match (row already in the target state, or in a more
// advanced one) or the on-chain status doesn't map to a DB state (None; logged and no-op).
export async function markChainResolved(
  id: number,
  onchainStatus: number,
  opts: { settleTx?: string; acceptor?: string } = {},
): Promise<boolean> {
  const { settleTx, acceptor } = opts;
  // Cancelled — reachable from any non-terminal state (refundStale from Accepted,
  // cancelExpired from Open).
  if (onchainStatus === 4) {
    const rows = await sql`update duels set status = 'cancelled', updated_at = now()
      where id = ${id} and status in ('funded', 'open', 'accepted', 'settling')
      returning id`;
    return rows.length > 0;
  }
  // Settled — the pot has been paid out on-chain; terminal.
  if (onchainStatus === 3) {
    const rows = await sql`update duels set status = 'settled', updated_at = now(),
      settle_tx = coalesce(settle_tx, ${settleTx ?? null})
      where id = ${id} and status in ('funded', 'open', 'accepted', 'settling')
      returning id`;
    return rows.length > 0;
  }
  // Accepted — the acceptDuel tx landed but POST /accept died before markAccepted. Only
  // rows that haven't advanced past 'open' may move here; never pull back a settling row.
  // The acceptor address is required, not optional: only the chain knows who accepted, and
  // a row sitting at 'accepted' with a null acceptor is worse than one left at 'open' — an
  // acceptor win would resolve to a null payee and be dropped as 'skip-no-winner' forever.
  // Refuse loudly rather than write a half-synced row.
  if (onchainStatus === 2) {
    if (!acceptor) {
      console.warn(`[duelStore] markChainResolved: duel ${id} -> accepted needs the on-chain acceptor — no-op`);
      return false;
    }
    const rows = await sql`update duels set status = 'accepted', acceptor = ${acceptor.toLowerCase()},
      updated_at = now()
      where id = ${id} and status in ('funded', 'open')
      returning id`;
    return rows.length > 0;
  }
  // Open — nobody ever accepted on-chain, so a DB row claiming otherwise is wrong.
  // 'settling'/terminal rows are excluded: those imply a settle path we must not undo.
  if (onchainStatus === 1) {
    const rows = await sql`update duels set status = 'open', updated_at = now()
      where id = ${id} and status in ('funded', 'accepted')
      returning id`;
    return rows.length > 0;
  }
  console.warn(`[duelStore] markChainResolved: duel ${id} has unexpected onchain status ${onchainStatus} — no-op`);
  return false;
}

// GIVE_UP_AFTER (the outer 48h floor) is what keeps this queue bounded, and it is load-bearing.
//
// Every action the reconciler can take moves the row it acted on: a forfeit advances it to
// 'settling', a successful relay to 'settled', a chain sync to the chain's own status. So a
// row that is still here after many runs is one the reconciler could NOT move, and nothing
// about the next run will change that. Each status arm has such a state:
//   - settling  past 24h  -> planner returns 'stale-alert', which only logs
//   - accepted  with a null creator_score -> 'skip-incomplete'; settle() needs a score
//   - open      already matching a chain-Open duel -> markChainResolved has nothing to write
// None of these touch updated_at, so without a floor they are re-selected on every run
// forever. They are also the OLDEST rows in the table, and this query is
// `order by updated_at asc limit 100` — so they collect at the head of the page and, once
// there are 100 of them, push every genuinely stuck duel out of the result entirely. The
// reconciler would then be permanently busy doing nothing, which is a total loss of the
// settlement liveness it exists to provide.
//
// 48h is far past the point where retrying helps: the tightest arm re-examines a row every
// run, so a duel gets hundreds of attempts at a 10-minute cadence. Past the floor the
// on-chain escape hatches take over — refundStale and cancelExpired are permissionless, are
// surfaced on the duel page, and need no DB row to work — and POST /refunded syncs the row
// the moment a player uses one. Giving up costs observability, not money.
export async function listReconcileCandidates(): Promise<DuelRow[]> {
  const rows = await sql`
    select * from duels
    where updated_at > now() - interval '48 hours'
      and ( (status = 'settling' and updated_at < now() - interval '5 minutes')
         or (status = 'accepted' and updated_at < now() - interval '30 minutes')
         or (status in ('open', 'funded') and updated_at < now() - interval '24 hours') )
    order by updated_at asc limit 100`;
  return rows.map(toRow);
}

export async function listOpenDuels(viewer?: string): Promise<DuelRow[]> {
  const v = viewer?.toLowerCase() ?? '';
  const rows = await sql`
    select id, onchain_id, seed, stake_wei, token, creator, acceptor, status, challenge_to, winner,
           settle_tx, created_at,
           null as creator_taps, null as creator_score, null as acceptor_taps, null as acceptor_score
    from duels
    where status = 'open'
      and created_at > now() - interval '24 hours'
      and (challenge_to is null or challenge_to = ${v} or created_at < now() - interval '1 hour')
    order by created_at desc limit 50`;
  return rows.map(toRow);
}

export async function addPracticeScore(name: string, score: number): Promise<void> {
  await sql`insert into practice_scores (name, score) values (${name.slice(0, 16)}, ${score})`;
}

export async function topPracticeScores(): Promise<{ name: string; score: number }[]> {
  const rows = await sql`select name, max(score) as score from practice_scores
    group by name order by score desc limit 20`;
  return rows.map((r) => ({ name: r.name as string, score: Number(r.score) }));
}
