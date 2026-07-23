import { sql } from './db';

/** All addresses passed to this module must already be lowercase. */

export async function setName(address: string, name: string): Promise<'ok' | 'taken'> {
  try {
    await sql`insert into profiles (address, name) values (${address}, ${name})
      on conflict (address) do update set name = excluded.name, updated_at = now()`;
    return 'ok';
  } catch (e) {
    // 23505 = unique_violation, here only reachable via profiles_name_lower_idx.
    if ((e as { code?: string }).code === '23505') return 'taken';
    throw e;
  }
}

export async function getName(address: string): Promise<string | null> {
  const rows = await sql`select name from profiles where address = ${address}`;
  return rows.length ? (rows[0].name as string) : null;
}

export async function getNames(addresses: string[]): Promise<Record<string, string>> {
  if (addresses.length === 0) return {};
  const rows = await sql`select address, name from profiles where address = any(${addresses})`;
  return Object.fromEntries(rows.map((r) => [r.address as string, r.name as string]));
}

export async function upsertBest(address: string, score: number): Promise<void> {
  await sql`insert into practice_best (address, score) values (${address}, ${score})
    on conflict (address) do update
      set score = greatest(practice_best.score, excluded.score), updated_at = now()`;
}

/**
 * The leaderboard. Left join because a score no longer requires a claimed name;
 * callers render `name ?? aliasFor(address)`.
 */
export async function topScores(): Promise<{ address: string; name: string | null; score: number }[]> {
  const rows = await sql`select b.address, p.name, b.score
    from practice_best b left join profiles p on p.address = b.address
    order by b.score desc, b.updated_at asc limit 20`;
  return rows.map((r) => ({
    address: r.address as string,
    name: (r.name as string | null) ?? null,
    score: Number(r.score),
  }));
}

export async function getBestScore(address: string): Promise<number | null> {
  const rows = await sql`select score from practice_best where address = ${address}`;
  return rows.length ? Number(rows[0].score) : null;
}
