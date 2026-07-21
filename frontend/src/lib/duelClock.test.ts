import { describe, it, expect } from 'vitest';
import { timeLeft } from './duelClock';

const H = 60 * 60 * 1000;
const M = 60 * 1000;
const created = Date.parse('2026-07-21T00:00:00.000Z');
const at = (ms: number) => created + ms;

describe('timeLeft', () => {
  it('counts down in hours and minutes for a fresh duel', () => {
    expect(timeLeft(created, at(4 * H + 14 * M))).toEqual({ expired: false, label: '19h 46m' });
  });

  it('drops the hours once under an hour', () => {
    expect(timeLeft(created, at(23 * H + 30 * M))).toEqual({ expired: false, label: '30m' });
  });

  it('never shows 0m while time remains — the last minute reads "<1m"', () => {
    expect(timeLeft(created, at(24 * H - 20 * 1000))).toEqual({ expired: false, label: '<1m' });
  });

  it('reports expired exactly at the 24h boundary, matching the contract', () => {
    // DuelEscrow reverts on `<=`, so the duel is only acceptable strictly before the
    // boundary; showing "expires in 0m" at the boundary would offer a button that reverts.
    expect(timeLeft(created, at(24 * H))).toEqual({ expired: true, label: 'expired' });
  });

  it('stays expired well past the boundary', () => {
    expect(timeLeft(created, at(50 * H))).toEqual({ expired: true, label: 'expired' });
  });

  it('degrades to unknown for an unparseable timestamp rather than showing NaN', () => {
    expect(timeLeft(NaN, at(H))).toEqual({ expired: false, label: 'unknown' });
  });
});
