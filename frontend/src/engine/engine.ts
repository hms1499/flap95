import { hashedUnit } from './rng';

export const CONFIG = {
  ticksPerSecond: 60,
  maxTicks: 3600,          // 60s hard cap per run
  worldW: 360, worldH: 560,
  birdX: 80, birdR: 12,
  gravity: 0.18, flapVy: -4.2,
  pipeW: 56, pipeSpacing: 180, firstPipeX: 360,
  gapStart: 150, gapMin: 110, gapStep: 8, gapEvery: 5,
  speed: 2.4, speedStep: 0.2, speedEvery: 10,
  minTapGap: 4,            // min ticks between taps (max 15 taps/s)
  maxTaps: 900,
} as const;

export interface SimState {
  tick: number; alive: boolean; score: number;
  birdY: number; birdVy: number; scrollX: number;
}

export interface RunResult { score: number; deathTick: number }

export class GameSim {
  readonly state: SimState;
  private readonly seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.state = { tick: 0, alive: true, score: 0, birdY: CONFIG.worldH / 2, birdVy: 0, scrollX: 0 };
  }

  gapCenter(i: number): number {
    return 100 + hashedUnit(this.seed, i) * (CONFIG.worldH - 200);
  }

  gapHeight(i: number): number {
    return Math.max(CONFIG.gapMin, CONFIG.gapStart - Math.floor(i / CONFIG.gapEvery) * CONFIG.gapStep);
  }

  pipeScreenX(i: number): number {
    return CONFIG.firstPipeX + i * CONFIG.pipeSpacing - this.state.scrollX;
  }

  private speed(): number {
    return CONFIG.speed + Math.floor(this.state.score / CONFIG.speedEvery) * CONFIG.speedStep;
  }

  step(tapped: boolean): void {
    const s = this.state;
    if (!s.alive || s.tick >= CONFIG.maxTicks) { s.alive = false; return; }
    s.birdVy = tapped ? CONFIG.flapVy : s.birdVy + CONFIG.gravity;
    s.birdY += s.birdVy;
    s.scrollX += this.speed();
    s.tick += 1;

    while (this.pipeScreenX(s.score) + CONFIG.pipeW < CONFIG.birdX - CONFIG.birdR) s.score += 1;

    if (s.birdY + CONFIG.birdR >= CONFIG.worldH || s.birdY - CONFIG.birdR <= 0) { s.alive = false; return; }

    const i = s.score;
    const px = this.pipeScreenX(i);
    if (CONFIG.birdX + CONFIG.birdR > px && CONFIG.birdX - CONFIG.birdR < px + CONFIG.pipeW) {
      const gc = this.gapCenter(i), gh = this.gapHeight(i);
      if (s.birdY - CONFIG.birdR < gc - gh / 2 || s.birdY + CONFIG.birdR > gc + gh / 2) s.alive = false;
    }
  }

  /** Pipes currently on screen — render-only helper, never affects simulation state. */
  pipesInView(): { x: number; gapCenter: number; gapHeight: number }[] {
    const out: { x: number; gapCenter: number; gapHeight: number }[] = [];
    for (let i = Math.max(0, this.state.score - 1); ; i++) {
      const x = this.pipeScreenX(i);
      if (x > CONFIG.worldW) break;
      if (x + CONFIG.pipeW < 0) continue;
      out.push({ x, gapCenter: this.gapCenter(i), gapHeight: this.gapHeight(i) });
    }
    return out;
  }
}

export function simulate(seed: number, taps: readonly number[]): RunResult {
  const sim = new GameSim(seed);
  const tapSet = new Set(taps);
  while (sim.state.alive && sim.state.tick < CONFIG.maxTicks) {
    sim.step(tapSet.has(sim.state.tick));
  }
  return { score: sim.state.score, deathTick: sim.state.tick };
}
