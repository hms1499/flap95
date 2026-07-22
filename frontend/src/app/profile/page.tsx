'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAccount, useConnect, useSignMessage } from 'wagmi';
import Link from 'next/link';
import { Window } from '@/components/Window';
import { normalizeName, setNameMessage } from '@/lib/profile';
import { formatStake } from '@/lib/contracts';
import { useNames, displayName } from '@/lib/useNames';
import { viewerRole } from '@/lib/outcome';

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

const ACTIVE_LABEL: Record<string, string> = {
  funded: 'Finish your run',
  open: 'Waiting for an opponent',
  accepted: 'Opponent is playing',
  settling: 'Settling…',
};

/** What a finished duel meant for this viewer. Cancelled duels have no winner. */
function outcomeLabel(d: MeDuel, address: string | undefined): string {
  if (d.status === 'cancelled') return 'Refunded';
  if (d.winner === 'tie') return 'Tie';
  const role = viewerRole(address, d.creator, d.acceptor);
  if (role === 'observer' || d.winner === null) return '—';
  return d.winner === role ? 'Won' : 'Lost';
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

  const names = useNames([
    ...(me?.active ?? []).flatMap((d) => [d.creator, d.acceptor]),
    ...(me?.history ?? []).flatMap((d) => [d.creator, d.acceptor]),
  ]);

  function opponentOf(d: MeDuel): string {
    const a = address?.toLowerCase();
    const other = d.creator.toLowerCase() === a ? d.acceptor : d.creator;
    return other ? displayName(names, other) : 'nobody yet';
  }

  const record = (me?.history ?? []).filter((d) => d.status === 'settled');
  const wins = record.filter((d) => outcomeLabel(d, address) === 'Won').length;
  const losses = record.filter((d) => outcomeLabel(d, address) === 'Lost').length;

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

      {!loadError && (
        <Window title="UNFINISHED.LST">
          {(me?.active ?? []).length === 0 ? (
            <p className="fineprint">Nothing unfinished. <Link href="/duels/new">Start a duel</Link>.</p>
          ) : (
            <table className="ledger">
              <thead><tr><th>Duel</th><th>Stake</th><th></th></tr></thead>
              <tbody>
                {me!.active.map((d) => (
                  <tr key={d.id}>
                    <td>
                      ⚔️ duel_{d.id}.exe<br />
                      <small className={d.status === 'funded' ? 'win' : undefined}>
                        {ACTIVE_LABEL[d.status] ?? d.status} · vs {opponentOf(d)}
                      </small>
                    </td>
                    <td className="stake">{formatStake(d.stakeWei, d.token)}</td>
                    <td><Link href={`/duels/${d.id}`}><button>Open</button></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Window>
      )}

      {!loadError && (
        <Window title="HISTORY.LOG">
          {(me?.history ?? []).length === 0 ? (
            <p className="fineprint">No finished duels yet.</p>
          ) : (
            <>
              <p className="fineprint">Record: {wins}W – {losses}L</p>
              <table className="ledger">
                <thead><tr><th>Duel</th><th>Stake</th><th>Result</th></tr></thead>
                <tbody>
                  {me!.history.map((d) => (
                    <tr key={d.id}>
                      <td>
                        ⚔️ duel_{d.id}.exe<br />
                        <small>vs {opponentOf(d)}</small>
                      </td>
                      <td className="stake">{formatStake(d.stakeWei, d.token)}</td>
                      <td>
                        {outcomeLabel(d, address)}
                        {d.settleTx && (
                          <> · <a href={`https://celoscan.io/tx/${d.settleTx}`} target="_blank" rel="noreferrer">tx</a></>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Window>
      )}
    </main>
  );
}
