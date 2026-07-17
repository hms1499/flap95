'use client';
import { useCallback, useState } from 'react';
import { Window } from '@/components/Window';
import { Dialog95 } from '@/components/Dialog95';
import { GameCanvas } from '@/components/GameCanvas';

function randomSeed() { return Math.floor(Math.random() * 2 ** 31); }

export default function PlayPage() {
  const [seed, setSeed] = useState(randomSeed);
  const [runKey, setRunKey] = useState(0);
  const [result, setResult] = useState<{ taps: number[]; score: number } | null>(null);
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);

  const onRunEnd = useCallback((taps: number[], score: number) => setResult({ taps, score }), []);

  async function save() {
    if (!result || !name.trim()) return;
    await fetch('/api/practice', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, seed, taps: result.taps }),
    });
    setSaved(true);
  }

  function again() {
    setSeed(randomSeed()); setRunKey((k) => k + 1); setResult(null); setSaved(false);
  }

  return (
    <main className="desktop">
      <Window title="PRACTICE.EXE — tap to flap">
        <GameCanvas key={runKey} seed={seed} onRunEnd={onRunEnd} />
      </Window>
      <Dialog95 title="Game over" open={result !== null}>
        <p>⚠️ You scored <b>{result?.score}</b>.</p>
        {!saved ? (
          <div className="row">
            <input placeholder="Your name" value={name} maxLength={16} onChange={(e) => setName(e.target.value)} />
            <button onClick={save} disabled={!name.trim()}>Save score</button>
          </div>
        ) : <p>Saved to the Hall of Fame.</p>}
        <div className="row spread" style={{ marginTop: 8 }}>
          <button onClick={again}>Play again</button>
          <a className="button" href="/duels/new"><button>Duel for USDm</button></a>
        </div>
      </Dialog95>
    </main>
  );
}
