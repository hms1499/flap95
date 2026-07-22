'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAccount, useConnect, useSignMessage } from 'wagmi';
import { Window } from '@/components/Window';
import { Dialog95 } from '@/components/Dialog95';
import { GameCanvas } from '@/components/GameCanvas';
import { normalizeName, setNameMessage, practiceMessage, tapsHash } from '@/lib/profile';

function randomSeed() { return Math.floor(Math.random() * 2 ** 31); }

export default function PlayPage() {
  const [seed, setSeed] = useState(randomSeed);
  const [runKey, setRunKey] = useState(0);
  const [result, setResult] = useState<{ taps: number[]; score: number } | null>(null);
  const [name, setName] = useState('');
  const [profileName, setProfileName] = useState<string | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { signMessageAsync } = useSignMessage();

  useEffect(() => {
    setProfileName(null);
    setProfileLoaded(false);
    if (!address) return;
    let stale = false;
    fetch(`/api/profile?address=${address}`)
      .then((r) => r.json())
      .then((d) => { if (!stale) { setProfileName(d.name ?? null); setProfileLoaded(true); } })
      .catch(() => { if (!stale) setError('Could not check your profile. Try again.'); });
    return () => { stale = true; };
  }, [address]);

  const onRunEnd = useCallback((taps: number[], score: number) => setResult({ taps, score }), []);

  async function save() {
    if (!result || !address) return;
    if (!profileLoaded) return;
    setError(null);
    setBusy(true);
    try {
      if (!profileName) {
        const n = normalizeName(name);
        if (!n.ok) { setError('Name: 1–16 letters, digits, space, _ . -'); return; }
        const ts = Date.now();
        const signature = await signMessageAsync({ message: setNameMessage(n.name, ts) });
        const res = await fetch('/api/profile', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ address, name: n.name, timestamp: ts, signature }),
        });
        if (res.status === 409) { setError('That name is taken — pick another.'); return; }
        if (!res.ok) { setError('Could not save your name. Try again.'); return; }
        setProfileName(n.name);
      }
      const ts = Date.now();
      const signature = await signMessageAsync({
        message: practiceMessage(seed, tapsHash(result.taps), ts),
      });
      const res = await fetch('/api/practice', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, seed, taps: result.taps, timestamp: ts, signature }),
      });
      if (!res.ok) { setError('Could not save your score. Try again.'); return; }
      setSaved(true);
    } catch {
      setError('Signature request was cancelled.');
    } finally {
      setBusy(false);
    }
  }

  function again() {
    setSeed(randomSeed()); setRunKey((k) => k + 1); setResult(null); setSaved(false); setError(null);
  }

  return (
    <main className="desktop">
      <Window title="PRACTICE.EXE — tap to flap">
        <GameCanvas key={runKey} seed={seed} onRunEnd={onRunEnd} />
      </Window>
      <Dialog95 title="Game over" open={result !== null}>
        <p>⚠️ You scored <b>{result?.score}</b>.</p>
        {saved ? (
          <p>Saved to the Hall of Fame.</p>
        ) : !isConnected ? (
          <button onClick={() => connectors[0] && connect({ connector: connectors[0] })}>
            💰 Connect wallet to save
          </button>
        ) : (
          <div className="row">
            {profileLoaded && !profileName && (
              <input
                placeholder="Your name" value={name} maxLength={16}
                onChange={(e) => setName(e.target.value)}
              />
            )}
            <button onClick={save} disabled={busy || !profileLoaded || (!profileName && !name.trim())}>
              {busy ? 'Signing…' : !profileLoaded ? 'Checking…' : profileName ? `Save as ${profileName}` : 'Save score'}
            </button>
          </div>
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
