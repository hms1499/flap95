import { describe, it, expect } from 'vitest';
import { planReconcileAction, FORFEIT_AFTER_MS, STALE_AFTER_MS } from './reconcile';

const NOW = 1_000_000_000_000;
function row(over: Partial<Parameters<typeof planReconcileAction>[0]>) {
  return { status: 'accepted', updatedAt: new Date(NOW).toISOString(), acceptorTaps: null, ...over } as Parameters<typeof planReconcileAction>[0];
}

describe('planReconcileAction', () => {
  it('skips a freshly accepted duel', () => {
    expect(planReconcileAction(row({ updatedAt: new Date(NOW - 5 * 60_000).toISOString() }), NOW)).toBe('skip');
  });
  it('forfeits an accepted duel whose acceptor never submitted past the window', () => {
    expect(planReconcileAction(row({ updatedAt: new Date(NOW - FORFEIT_AFTER_MS - 1).toISOString() }), NOW)).toBe('forfeit');
  });
  it('retries a settling duel', () => {
    expect(planReconcileAction(row({ status: 'settling', updatedAt: new Date(NOW - 60_000).toISOString() }), NOW)).toBe('retry');
  });
  it('alerts on a settling duel stuck past the stale timeout', () => {
    expect(planReconcileAction(row({ status: 'settling', updatedAt: new Date(NOW - STALE_AFTER_MS - 1).toISOString() }), NOW)).toBe('stale-alert');
  });
  it('skips terminal statuses', () => {
    expect(planReconcileAction(row({ status: 'settled' }), NOW)).toBe('skip');
  });

  it('does not forfeit when the acceptor did submit a run', () => {
    expect(
      planReconcileAction(
        row({
          updatedAt: new Date(NOW - FORFEIT_AFTER_MS - 60_000).toISOString(),
          acceptorTaps: [1, 2, 3],
        }),
        NOW,
      ),
    ).toBe('skip');
  });

  it('forfeits exactly at the forfeit boundary (ageMs === FORFEIT_AFTER_MS)', () => {
    expect(
      planReconcileAction(row({ updatedAt: new Date(NOW - FORFEIT_AFTER_MS).toISOString() }), NOW),
    ).toBe('forfeit');
  });

  it('skips one millisecond before the forfeit boundary (ageMs === FORFEIT_AFTER_MS - 1)', () => {
    expect(
      planReconcileAction(row({ updatedAt: new Date(NOW - (FORFEIT_AFTER_MS - 1)).toISOString() }), NOW),
    ).toBe('skip');
  });

  it('alerts exactly at the stale boundary (ageMs === STALE_AFTER_MS)', () => {
    expect(
      planReconcileAction(
        row({ status: 'settling', updatedAt: new Date(NOW - STALE_AFTER_MS).toISOString() }),
        NOW,
      ),
    ).toBe('stale-alert');
  });

  it('retries one millisecond before the stale boundary (ageMs === STALE_AFTER_MS - 1)', () => {
    expect(
      planReconcileAction(
        row({ status: 'settling', updatedAt: new Date(NOW - (STALE_AFTER_MS - 1)).toISOString() }),
        NOW,
      ),
    ).toBe('retry');
  });

  // An unparseable timestamp yields NaN, and every age comparison in the planner is `>=`,
  // which answers false for NaN. Without an explicit guard a corrupt row silently takes the
  // fallthrough branch — 'retry' for a settling row, i.e. re-broadcasting a settle for a duel
  // whose age we could not establish. These must refuse instead.
  // Note: Date.prototype.toString() output ("Sat Jul 18 2026 12:00:00 GMT+0000") is NOT in
  // this list — V8 parses it fine. The spec leaves that format implementation-defined, which
  // is why toIso normalises to ISO 8601, but it is not a NaN source on this engine.
  for (const bad of ['', 'not a date', 'NaN', '0000-13-45']) {
    it(`skips a settling row rather than retrying it when updatedAt is unparseable (${JSON.stringify(bad)})`, () => {
      expect(Number.isNaN(Date.parse(bad))).toBe(true); // the premise: this really is unparseable
      expect(planReconcileAction(row({ status: 'settling', updatedAt: bad }), NOW)).toBe('skip');
    });
  }

  it('skips an accepted row with an unparseable updatedAt rather than forfeiting it', () => {
    expect(planReconcileAction(row({ status: 'accepted', updatedAt: 'not a date' }), NOW)).toBe('skip');
  });
});
