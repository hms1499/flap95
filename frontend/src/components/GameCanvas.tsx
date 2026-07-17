'use client';
import { useEffect, useRef } from 'react';
import { CONFIG, GameSim } from '@/engine/engine';

const TICK_MS = 1000 / CONFIG.ticksPerSecond;

export function GameCanvas({ seed, ghostTaps, onRunEnd }: {
  seed: number;
  ghostTaps?: readonly number[];
  onRunEnd: (taps: number[], score: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const endedRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const sim = new GameSim(seed);
    const ghost = ghostTaps ? new GameSim(seed) : null;
    const ghostSet = new Set(ghostTaps ?? []);
    const taps: number[] = [];
    let pendingTap = false;
    let last = performance.now();
    let acc = 0;
    let raf = 0;
    endedRef.current = false;

    const onDown = (e: Event) => { e.preventDefault(); pendingTap = true; };
    canvas.addEventListener('pointerdown', onDown);

    function draw() {
      ctx.fillStyle = '#7ec0ee';
      ctx.fillRect(0, 0, CONFIG.worldW, CONFIG.worldH);
      // pipes
      for (const p of sim.pipesInView()) {
        ctx.fillStyle = '#2e8b2e';
        const top = p.gapCenter - p.gapHeight / 2;
        const bottom = p.gapCenter + p.gapHeight / 2;
        ctx.fillRect(p.x, 0, CONFIG.pipeW, top);
        ctx.fillRect(p.x, bottom, CONFIG.pipeW, CONFIG.worldH - bottom);
        ctx.fillStyle = '#1f5f1f'; // bevel edge
        ctx.fillRect(p.x, top - 12, CONFIG.pipeW, 12);
        ctx.fillRect(p.x, bottom, CONFIG.pipeW, 12);
      }
      // ghost bird
      if (ghost && ghost.state.alive) {
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = '#c0c0c0';
        ctx.fillRect(CONFIG.birdX - CONFIG.birdR, ghost.state.birdY - CONFIG.birdR, CONFIG.birdR * 2, CONFIG.birdR * 2);
        ctx.globalAlpha = 1;
      }
      // player bird
      ctx.fillStyle = '#ffd700';
      ctx.fillRect(CONFIG.birdX - CONFIG.birdR, sim.state.birdY - CONFIG.birdR, CONFIG.birdR * 2, CONFIG.birdR * 2);
      ctx.fillStyle = '#000';
      ctx.fillRect(CONFIG.birdX + 2, sim.state.birdY - 6, 4, 4);
      // HUD
      ctx.font = '20px monospace';
      ctx.fillStyle = '#fff';
      ctx.fillText(`SCORE ${sim.state.score}`, 10, 28);
      if (ghost) ctx.fillText(`GHOST ${ghost.state.score}`, 10, 52);
    }

    function frame(now: number) {
      acc += now - last;
      last = now;
      while (acc >= TICK_MS && sim.state.alive) {
        if (pendingTap) taps.push(sim.state.tick);
        sim.step(pendingTap);
        if (ghost && ghost.state.alive) ghost.step(ghostSet.has(ghost.state.tick));
        pendingTap = false;
        acc -= TICK_MS;
      }
      draw();
      if (!sim.state.alive) {
        if (!endedRef.current) { endedRef.current = true; onRunEnd(taps, sim.state.score); }
        return;
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => { cancelAnimationFrame(raf); canvas.removeEventListener('pointerdown', onDown); };
  }, [seed, ghostTaps, onRunEnd]);

  return (
    <div className="game-frame">
      <canvas ref={canvasRef} width={CONFIG.worldW} height={CONFIG.worldH} />
    </div>
  );
}
