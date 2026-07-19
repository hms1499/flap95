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
  // An unparseable timestamp must not be allowed to decide anything. Every comparison below
  // is `>=`, which answers false for NaN, so a corrupt row would silently take whichever
  // branch happens to be the fallthrough — for a 'settling' row that is 'retry', re-relaying
  // a settle on a row we know nothing reliable about. Refuse instead: the row keeps its
  // on-chain escape hatches, which need no timestamp from us.
  if (Number.isNaN(ageMs)) {
    console.warn(`[reconcile] duel row has an unparseable updatedAt (${d.updatedAt}) — skipping`);
    return 'skip';
  }
  if (d.status === 'settling') return ageMs >= STALE_AFTER_MS ? 'stale-alert' : 'retry';
  if (d.status === 'accepted' && d.acceptorTaps === null && ageMs >= FORFEIT_AFTER_MS) return 'forfeit';
  return 'skip';
}
