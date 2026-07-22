import type { DuelRow, DuelStatus } from './duelStore';
import { EXPIRY_MS } from './duelClock';

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

/** What the viewer is waiting on, per status, while the duel is still inside its window. */
const FRESH_LABEL: Partial<Record<DuelStatus, string>> = {
  funded: 'Finish your run',
  open: 'Waiting for an opponent',
  accepted: 'Opponent is playing',
  settling: 'Settling…',
};

/**
 * How an unfinished duel should read on the profile page, given the clock.
 *
 * Without ageing, a duel accepted three weeks ago still says "Opponent is
 * playing" — the list reads as "everything is fine" precisely when it isn't.
 *
 * The two stale labels differ on purpose. `funded` and `open` are gated on
 * `createdAt + EXPIRY`, the same clock as here, so promising the reclaim is a
 * promise the contract keeps. `accepted` and `settling` unlock via refundStale,
 * which runs off the on-chain `acceptedAt` — later than `createdAt` and not on
 * the wire — so this can only tell the user to go look.
 *
 * `now` is null until the client mounts (see useNow), and an unparseable
 * timestamp is treated the same way: never age on a clock you cannot read.
 */
export function activeLabel(status: DuelStatus, createdAtMs: number, nowMs: number | null): string {
  const fresh = FRESH_LABEL[status] ?? status;
  if (nowMs === null || !Number.isFinite(createdAtMs)) return fresh;
  if (nowMs <= createdAtMs + EXPIRY_MS) return fresh;
  if (status === 'funded' || status === 'open') return 'Expired — reclaim your stake';
  if (status === 'accepted' || status === 'settling') return 'Taking too long — open to check';
  return fresh;
}

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
