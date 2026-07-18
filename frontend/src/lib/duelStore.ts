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
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at ?? r.created_at),
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

export async function listReconcileCandidates(): Promise<DuelRow[]> {
  const rows = await sql`
    select * from duels
    where (status = 'settling' and updated_at < now() - interval '5 minutes')
       or (status = 'accepted' and updated_at < now() - interval '30 minutes')
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
