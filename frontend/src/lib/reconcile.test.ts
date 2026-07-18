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
});
