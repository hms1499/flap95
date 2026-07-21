'use client';
import { useEffect, useRef } from 'react';
import { CONFIG, GameSim } from '@/engine/engine';
import { COUNTDOWN_MS, countdownLabel, onHidden, onPointerDown, type RunPhase } from '@/lib/runPhase';

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
    let phase: RunPhase = 'idle';
    let countdownStart = 0;
    let last = performance.now();
    let acc = 0;
    let raf = 0;
    endedRef.current = false;

    const onDown = (e: Event) => {
      e.preventDefault();
      const next = onPointerDown(phase);
      if (next.phase === 'countdown' && phase === 'idle') countdownStart = performance.now();
      phase = next.phase;
      // Only a tap taken while running is a flap. The starting tap is swallowed here.
      if (next.isFlap) pendingTap = true;
    };
    canvas.addEventListener('pointerdown', onDown);

    // A backgrounded tab throttles requestAnimationFrame; on return the accumulator
    // would burn a tick backlog with no input and kill the bird. End a running run
    // (the honest outcome — the player stopped tapping) and rewind a countdown to
    // idle. Using visibilitychange, not blur: blur also fires for a wallet popup while
    // the page is still visible, which is not the condition that causes the backlog.
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') return;
      const action = onHidden(phase);
      if (action === 'end-run') {
        if (!endedRef.current) { endedRef.current = true; cancelAnimationFrame(raf); onRunEnd(taps, sim.state.score); }
      } else if (action === 'reset-idle') {
        // countdownStart is left stale on purpose: the next tap from idle re-arms it
        // fresh, and the running transition resets last/acc, so nothing leaks forward.
        phase = 'idle';
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

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
      // The ghost's score is deliberately NOT drawn. Showing it hands the acceptor a
      // free, zero-cost read on exactly how many pipes they need — enough to clear one
      // more and then stop taking risk, while the creator plays blind. The grey bird
      // stays: racing it is the product, and counting its pipes costs attention the
      // player needs to stay alive, which is the whole point.
      if (ghost && !ghost.state.alive) {
        ctx.fillStyle = '#fff';
        ctx.fillText('GHOST DOWN', 10, 52);
      }
    }

    function drawOverlay(text: string, sub?: string) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, CONFIG.worldW, CONFIG.worldH);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.font = 'bold 48px monospace';
      ctx.fillText(text, CONFIG.worldW / 2, CONFIG.worldH / 2);
      if (sub) {
        ctx.font = '14px monospace';
        ctx.fillText(sub, CONFIG.worldW / 2, CONFIG.worldH / 2 + 34);
      }
      ctx.textAlign = 'left';
    }

    function frame(now: number) {
      // Pre-roll: draw the world frozen so the player can read the first pipes, and run
      // no simulation ticks at all. Tick 0 happens after GO.
      if (phase === 'idle') {
        draw();
        drawOverlay('TAP TO START', 'first tap starts the countdown');
        raf = requestAnimationFrame(frame);
        return;
      }
      if (phase === 'countdown') {
        const elapsed = now - countdownStart;
        draw();
        drawOverlay(countdownLabel(elapsed));
        if (elapsed >= COUNTDOWN_MS) {
          phase = 'running';
          // Reset the accumulator clock so the countdown's wall time is not handed to the
          // simulation as a backlog of ticks to catch up on.
          last = now;
          acc = 0;
        }
        raf = requestAnimationFrame(frame);
        return;
      }

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

    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [seed, ghostTaps, onRunEnd]);

  return (
    <div className="game-frame">
      <canvas ref={canvasRef} width={CONFIG.worldW} height={CONFIG.worldH} />
    </div>
  );
}
