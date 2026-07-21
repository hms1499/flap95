/**
 * How long a duel has left before it stops being joinable.
 *
 * DuelEscrow gates both acceptDuel and cancelExpired on `createdAt + EXPIRY`, so this
 * counts from creation, not from the row's updated_at. `now` is injected rather than
 * read here so the countdown is testable and so callers can drive it off one ticking
 * clock instead of each computing their own.
 */
export const EXPIRY_MS = 24 * 60 * 60 * 1000;

export interface TimeLeft {
  expired: boolean;
  /** Ready to render: '19h 45m', '30m', '<1m', 'expired', or 'unknown'. */
  label: string;
}

export function timeLeft(createdAtMs: number, nowMs: number): TimeLeft {
  // An unparseable timestamp must not render as 'NaNh NaNm'. Report it as unknown and
  // leave `expired` false: the chain, not this label, decides what the user may do, and
  // claiming "expired" on a clock we can't read would hide a duel that is still live.
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(nowMs)) return { expired: false, label: 'unknown' };

  const ms = createdAtMs + EXPIRY_MS - nowMs;
  // The contract reverts once `now > createdAt + EXPIRY`, and its checks are strict, so
  // treat the boundary itself as gone rather than showing a '0m' that invites a revert.
  if (ms <= 0) return { expired: true, label: 'expired' };

  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return { expired: false, label: '<1m' };
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return { expired: false, label: h > 0 ? `${h}h ${m}m` : `${m}m` };
}
