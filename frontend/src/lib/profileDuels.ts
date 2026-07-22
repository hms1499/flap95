import type { DuelRow, DuelStatus } from './duelStore';

/**
 * Where each duel status belongs on the profile page.
 *
 * Typing this as a full `Record<DuelStatus, …>` is the point: adding a status
 * to `DuelStatus` without deciding its home here fails the build, instead of
 * silently dropping those duels from the page.
 *
 * `draft` is dropped on purpose — a draft was never funded, so there is no
 * stake and nothing to act on.
 */
const STATUS_ROUTE: Record<DuelStatus, 'active' | 'history' | 'drop'> = {
  draft: 'drop',
  funded: 'active',
  open: 'active',
  accepted: 'active',
  settling: 'active',
  settled: 'history',
  cancelled: 'history',
};

export function splitDuels(rows: readonly DuelRow[]): { active: DuelRow[]; history: DuelRow[] } {
  const active: DuelRow[] = [];
  const history: DuelRow[] = [];
  for (const r of rows) {
    const where = STATUS_ROUTE[r.status];
    if (where === 'active') active.push(r);
    else if (where === 'history') history.push(r);
  }
  return { active, history };
}
