import { describe, it, expect } from 'vitest';
import { CONFIG, GameSim, simulate } from './engine';

describe('simulate', () => {
  it('is deterministic', () => {
    const taps = [5, 15, 25, 40, 55, 70];
    expect(simulate(42, taps)).toEqual(simulate(42, taps));
  });
  it('with no taps the bird falls and dies with score 0', () => {
    const r = simulate(1, []);
    expect(r.score).toBe(0);
    expect(r.deathTick).toBeGreaterThan(0);
    expect(r.deathTick).toBeLessThan(120);
  });
  it('taps change the outcome', () => {
    const taps = Array.from({ length: 30 }, (_, i) => i * 10);
    expect(simulate(1, taps).deathTick).not.toBe(simulate(1, []).deathTick);
  });
  it('different seeds place pipes differently', () => {
    const a = new GameSim(1), b = new GameSim(2);
    expect(a.gapCenter(0)).not.toBe(b.gapCenter(0));
  });
  it('never exceeds maxTicks', () => {
    // saturate with taps every minTapGap ticks; run must still terminate at cap
    const taps: number[] = [];
    for (let t = 0; t < CONFIG.maxTicks; t += CONFIG.minTapGap) taps.push(t);
    expect(simulate(3, taps).deathTick).toBeLessThanOrEqual(CONFIG.maxTicks);
  });
  it('gap shrinks with pipe index but never below gapMin', () => {
    const sim = new GameSim(9);
    expect(sim.gapHeight(0)).toBe(CONFIG.gapStart);
    expect(sim.gapHeight(500)).toBe(CONFIG.gapMin);
  });
  it('golden: physics are frozen', () => {
    expect(simulate(42, [])).toEqual({ score: 0, deathTick: 55 });
    expect(simulate(42, [5, 15, 25, 35, 45, 60, 75, 90])).toEqual({ score: 0, deathTick: 91 });
  });
});
