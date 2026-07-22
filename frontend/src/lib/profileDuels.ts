import type { DuelRow } from './duelStore';

/** Unfinished duels the player may still need to act on. */
export const ACTIVE_STATUSES = ['funded', 'open', 'accepted', 'settling'] as const;
/** Duels that are over, one way or another. */
export const HISTORY_STATUSES = ['settled', 'cancelled'] as const;

/**
 * Splits a wallet's duels for the profile page. `draft` rows are dropped:
 * a draft was never funded, so there is no stake and nothing to act on.
 */
export function splitDuels(rows: readonly DuelRow[]): { active: DuelRow[]; history: DuelRow[] } {
  const active: DuelRow[] = [];
  const history: DuelRow[] = [];
  for (const r of rows) {
    if ((ACTIVE_STATUSES as readonly string[]).includes(r.status)) active.push(r);
    else if ((HISTORY_STATUSES as readonly string[]).includes(r.status)) history.push(r);
  }
  return { active, history };
}
