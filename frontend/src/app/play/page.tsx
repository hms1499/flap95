'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAccount, useConnect } from 'wagmi';
import { Window } from '@/components/Window';
import { Dialog95 } from '@/components/Dialog95';
import { GameCanvas } from '@/components/GameCanvas';
import { aliasFor } from '@/lib/alias';

interface Seed { seed: number; token: string }

export default function PlayPage() {
  const [seed, setSeed] = useState<Seed | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [result, setResult] = useState<{ taps: number[]; score: number } | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();

  // Every run plays a seed the server issued. A browser-chosen seed could be
  // solved offline before the run was ever played.
  //
  // The fetch lives inside the effect rather than in a useCallback the effect
  // calls: the callback form made the linter see a setState reachable from an
  // effect body, and inlining it also buys the cancellation flag this page was
  // missing — a slow seed request landing after "Play again" would otherwise
  // overwrite the newer round's seed.
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

  const onRunEnd = useCallback((taps: number[], score: number) => setResult({ taps, score }), []);

  async function save() {
    if (!result || !address || !seed) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/practice', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, seed: seed.seed, taps: result.taps, token: seed.token }),
      });
      if (!res.ok) { setError('Could not save your score. Try again.'); return; }
      setSaved(true);
    } catch {
      setError('Could not save your score. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function again() {
    // Bumping runKey does double duty: it remounts the canvas for a fresh run
    // and re-runs the seed effect above, so a new round always plays a seed the
    // server issued for it.
    setResult(null); setSaved(false); setError(null); setSeed(null);
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
        <p>⚠️ You scored <b>{result?.score}</b>.</p>
        {saved ? (
          <p>Saved to the Hall of Fame as <b>{shownAs}</b>.</p>
        ) : !isConnected ? (
          <button onClick={() => connectors[0] && connect({ connector: connectors[0] })}>
            💰 Connect to keep your score
          </button>
        ) : (
          <button onClick={save} disabled={busy}>
            {busy ? 'Saving…' : `Save score as ${shownAs}`}
          </button>
        )}
        {shownAs !== null && !profileName && !saved && (
          <p className="fineprint">
            You appear as <b>{shownAs}</b>. Want your own name? Set it on your profile.
          </p>
        )}
        {error && <p className="fineprint">⚠️ {error}</p>}
        <div className="row spread" style={{ marginTop: 8 }}>
          <button onClick={again}>Play again</button>
          <a className="button" href="/duels/new"><button>Duel for stablecoins</button></a>
        </div>
      </Dialog95>
    </main>
  );
}
