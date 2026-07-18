import type { DuelRow } from './duelStore';

export const FORFEIT_AFTER_MS = 30 * 60 * 1000;   // acceptor abandons -> forfeit
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000; // relay stuck this long -> oracle likely dead

export type ReconcileAction = 'forfeit' | 'retry' | 'stale-alert' | 'skip';

/** Decide what the reconciler should do with one duel row. Pure + timezone-safe. */
export function planReconcileAction(
  d: Pick<DuelRow, 'status' | 'updatedAt' | 'acceptorTaps'>,
  nowMs: number,
): ReconcileAction {
  const ageMs = nowMs - Date.parse(d.updatedAt);
  if (d.status === 'settling') return ageMs >= STALE_AFTER_MS ? 'stale-alert' : 'retry';
  if (d.status === 'accepted' && d.acceptorTaps === null && ageMs >= FORFEIT_AFTER_MS) return 'forfeit';
  return 'skip';
}
