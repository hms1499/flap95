'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAccount, useConnect, useSignMessage } from 'wagmi';
import { Window } from '@/components/Window';
import { normalizeName, setNameMessage } from '@/lib/profile';

export interface MeDuel {
  id: number;
  status: string;
  stakeWei: string | null;
  token: string | null;
  creator: string;
  acceptor: string | null;
  winner: 'creator' | 'acceptor' | 'tie' | null;
  settleTx: string | null;
  createdAt: string;
}
export interface Me {
  name: string | null;
  bestScore: number | null;
  active: MeDuel[];
  history: MeDuel[];
}

export default function ProfilePage() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { signMessageAsync } = useSignMessage();

  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!address) return;
    setLoadError(false);
    try {
      const res = await fetch(`/api/me?address=${address}`);
      if (!res.ok) throw new Error('bad status');
      setMe(await res.json());
    } catch {
      setLoadError(true);
    }
  }, [address]);

  useEffect(() => {
    setMe(null);
    void load();
  }, [load]);

  async function rename() {
    if (!address) return;
    const n = normalizeName(draftName);
    if (!n.ok) { setError('Name: 1–16 letters, digits, space, _ . -'); return; }
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      const ts = Date.now();
      const signature = await signMessageAsync({ message: setNameMessage(n.name, ts) });
      const res = await fetch('/api/profile', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, name: n.name, timestamp: ts, signature }),
      });
      if (res.status === 409) { setError('That name is taken — pick another.'); return; }
      if (!res.ok) { setError('Could not save your name. Try again.'); return; }
      setMe((m) => (m ? { ...m, name: n.name } : m));
      setDraftName('');
      setSaved(true);
    } catch {
      setError('Signature request was cancelled.');
    } finally {
      setBusy(false);
    }
  }

  if (!isConnected) {
    return (
      <main className="desktop">
        <Window title="PROFILE.EXE">
          <p>Connect your wallet to see your name and your duels.</p>
          <button onClick={() => connectors[0] && connect({ connector: connectors[0] })}>
            💰 Connect wallet
          </button>
        </Window>
      </main>
    );
  }

  return (
    <main className="desktop">
      <Window title="PROFILE.EXE">
        {loadError ? (
          <>
            <p>⚠️ Could not load your profile.</p>
            <button onClick={() => void load()}>Try again</button>
          </>
        ) : (
          <>
            <p>
              👤 <b>{me?.name ?? 'No name yet'}</b>
              {me?.bestScore !== null && me?.bestScore !== undefined && (
                <> · best practice score <b>{me.bestScore}</b></>
              )}
            </p>
            <p className="mono fineprint">{address}</p>
            <fieldset>
              <legend>{me?.name ? 'Change your name' : 'Pick your name'}</legend>
              <div className="row">
                <input
                  placeholder="New name" value={draftName} maxLength={16}
                  onChange={(e) => setDraftName(e.target.value)}
                />
                <button onClick={rename} disabled={busy || !draftName.trim()}>
                  {busy ? 'Signing…' : 'Save name'}
                </button>
              </div>
              {saved && <p className="fineprint">Saved.</p>}
              {error && <p className="fineprint">⚠️ {error}</p>}
              <p className="fineprint">
                Your scores follow your wallet, so renaming keeps them. Your old name becomes
                free for anyone else to take.
              </p>
            </fieldset>
          </>
        )}
      </Window>
    </main>
  );
}
