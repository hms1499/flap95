'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAccount, useConnect } from 'wagmi';
import { Window } from '@/components/Window';
import { Dialog95 } from '@/components/Dialog95';
import { GameCanvas } from '@/components/GameCanvas';
import { aliasFor } from '@/lib/alias';

interface Seed { seed: number; token: string }
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function PlayPage() {
  const [seed, setSeed] = useState<Seed | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [result, setResult] = useState<{ taps: number[]; score: number } | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveNonce, setSaveNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();

  // Every run plays a seed the server issued. A browser-chosen seed could be
  // solved offline before the run was ever played. The fetch lives inside the
  // effect (not a useCallback) so the linter does not see a setState reachable
  // from an effect body, and so a slow seed landing after "Play again" can be
  // cancelled instead of overwriting the newer round's seed.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/practice/seed');
        if (!res.ok) throw new Error('bad status');
        const next = await res.json();
        if (!cancelled) setSeed(next);
      } catch {
        if (!cancelled) setError('Could not start a round. Check your connection and try again.');
      }
    })();
    return () => { cancelled = true; };
  }, [runKey]);

  useEffect(() => {
    setProfileName(null);
    if (!address) return;
    let stale = false;
    fetch(`/api/profile?address=${address}`)
      .then((r) => r.json())
      .then((d) => { if (!stale) setProfileName(d.name ?? null); })
      .catch(() => {});
    return () => { stale = true; };
  }, [address]);

  // Practice scores are the funnel's social proof, so a finished run saves
  // itself the moment a wallet is present — no button, no signature. The server
  // keeps only the best score, so re-saving every run is harmless. Keyed on
  // [result, address, seed] rather than saveState so it cannot re-enter itself
  // and cancel its own in-flight save; a run finished *before* connecting saves
  // when `address` later attaches. saveNonce lets the error retry re-run it.
  // setSaveState lives inside the IIFE to avoid a set-state-in-effect lint error.
  useEffect(() => {
    if (!result || !address || !seed) return;
    let cancelled = false;
    void (async () => {
      setSaveState('saving');
      try {
        const res = await fetch('/api/practice', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ address, seed: seed.seed, taps: result.taps, token: seed.token }),
        });
        if (!cancelled) setSaveState(res.ok ? 'saved' : 'error');
      } catch {
        if (!cancelled) setSaveState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [result, address, seed, saveNonce]);

  const onRunEnd = useCallback((taps: number[], score: number) => setResult({ taps, score }), []);

  function again() {
    // Bumping runKey does double duty: it remounts the canvas for a fresh run
    // and re-runs the seed effect above, so a new round always plays a seed the
    // server issued for it.
    setResult(null); setSaveState('idle'); setError(null); setSeed(null);
    setRunKey((k) => k + 1);
  }

  const shownAs = profileName ?? (address ? aliasFor(address) : null);

  return (
    <main className="desktop">
      <Window title="PRACTICE.EXE — tap to flap">
        {seed === null
          ? <p>Loading…</p>
          : <GameCanvas key={runKey} seed={seed.seed} onRunEnd={onRunEnd} />}
      </Window>
      <Dialog95 title="Game over" open={result !== null}>
        <div className="stack">
          <p>⚠️ You scored <b>{result?.score}</b>.</p>

          {!isConnected ? (
            <button
              onClick={() => connectors[0] && connect({ connector: connectors[0] })}
              className="btn-block"
            >
              💰 Connect to keep your score & duel
            </button>
          ) : (
            <>
              {saveState === 'saving' && <p className="fineprint">Saving your score…</p>}
              {saveState === 'saved' && <p>Saved to the Hall of Fame as <b>{shownAs}</b>.</p>}
              {saveState === 'error' && (
                <p className="fineprint">
                  ⚠️ Couldn&apos;t save your score.{' '}
                  <button onClick={() => setSaveNonce((n) => n + 1)}>Try again</button>
                </p>
              )}
              <a className="button" href="/duels/new">
                <button className="btn-block">⚔️ Duel for stablecoins</button>
              </a>
              {/* The duel is a fresh run on its own server-issued seed (both players
                  run the same one), so this practice score is not carried into it —
                  it stays on the Hall of Fame. */}
              <p className="fineprint">
                A duel is a fresh run for real stakes — this practice score stays on the Hall of Fame.
              </p>
            </>
          )}

          {isConnected && shownAs !== null && !profileName && (
            <p className="fineprint">
              You appear as <b>{shownAs}</b>. Want your own name? Set it on your profile.
            </p>
          )}

          {error && <p className="fineprint">⚠️ {error}</p>}

          <div className="row">
            <button onClick={again}>Play again</button>
          </div>
        </div>
      </Dialog95>
    </main>
  );
}
