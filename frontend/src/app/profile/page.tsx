'use client';
import { useEffect, useState } from 'react';
import { useAccount, useConnect, useWriteContract, usePublicClient } from 'wagmi';
import Link from 'next/link';
import { Window } from '@/components/Window';
import { Loading, Empty, LoadFailed } from '@/components/SectionState';
import { normalizeName } from '@/lib/profile';
import { formatStake, NAME_REGISTRY_ADDRESS, nameRegistryAbi } from '@/lib/contracts';
import { feeCurrencyOverrides } from '@/lib/minipay';
import { aliasFor } from '@/lib/alias';
import { useNames, displayName } from '@/lib/useNames';
import { viewerRole } from '@/lib/outcome';
import { activeLabel } from '@/lib/profileDuels';
import { useNow } from '@/lib/useNow';
import { useJson } from '@/lib/useJson';
import type { MeDuel } from '@/lib/meWire';

export interface Me {
  name: string | null;
  bestScore: number | null;
  active: MeDuel[];
  history: MeDuel[];
}

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
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const now = useNow();

  const { data: me, error: loadError, loading, reload } = useJson<Me>(
    address ? `/api/me?address=${address}` : null,
  );
  const [draftName, setDraftName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const names = useNames([
    ...(me?.active ?? []).flatMap((d) => [d.creator, d.acceptor]),
    ...(me?.history ?? []).flatMap((d) => [d.creator, d.acceptor]),
  ]);

  /** The other party's display name, or null when nobody ever joined. */
  function opponentOf(d: MeDuel): string | null {
    const a = address?.toLowerCase();
    const other = d.creator.toLowerCase() === a ? d.acceptor : d.creator;
    return other ? displayName(names, other) : null;
  }

  const record = (me?.history ?? []).filter((d) => d.status === 'settled');
  const wins = record.filter((d) => outcomeLabel(d, address) === 'Won').length;
  const losses = record.filter((d) => outcomeLabel(d, address) === 'Lost').length;

  useEffect(() => {
    if (!address) return;
    // Covers a setName transaction that landed while this page was not open.
    void fetch('/api/profile', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address }),
    }).then(() => reload()).catch(() => {});
  }, [address, reload]);

  async function rename() {
    if (!address || !publicClient) return;
    const n = normalizeName(draftName);
    if (!n.ok) { setError('Name: 1–16 letters, digits, space, _ . -'); return; }
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      const hash = await writeContractAsync({
        address: NAME_REGISTRY_ADDRESS, abi: nameRegistryAbi,
        functionName: 'setName', args: [n.name],
        ...feeCurrencyOverrides(),
      });
      await publicClient.waitForTransactionReceipt({ hash });
      // The name is now on-chain; ask the server to read it back into the index.
      const res = await fetch('/api/profile', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      if (res.status === 409) {
        setError('That name was just taken — pick another and send again.');
        return;
      }
      if (!res.ok) { setError('Saved on-chain, but the index did not update. Reload to retry.'); return; }
      reload();
      setDraftName('');
      setSaved(true);
    } catch {
      setError('The transaction was cancelled or did not go through.');
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
          <LoadFailed onRetry={reload} />
        ) : loading || !me ? (
          // Not the same as "no name / no duels": this page exists to tell people they have
          // money stuck in escrow, so it must never answer "nothing here" before it knows.
          <Loading />
        ) : (
          <>
            <p>
              👤 <b>{me.name ?? aliasFor(address ?? '')}</b>
              {me.bestScore !== null && (
                <> · best practice score <b>{me.bestScore}</b></>
              )}
            </p>
            <p className="mono fineprint">{address}</p>
            <fieldset>
              <legend>{me.name ? 'Change your name' : 'Pick your name'}</legend>
              <div className="row">
                <input
                  placeholder="New name" value={draftName} maxLength={16}
                  // Clear both notices: "Saved." under a half-typed new name claims
                  // something that has not happened yet.
                  onChange={(e) => { setDraftName(e.target.value); setSaved(false); setError(null); }}
                />
                <button onClick={rename} disabled={busy || !draftName.trim()}>
                  {busy ? 'Confirming…' : 'Save name'}
                </button>
              </div>
              {saved && <p className="fineprint">Saved.</p>}
              {error && <p className="fineprint">⚠️ {error}</p>}
              <p className="fineprint">
                Your scores follow your wallet, so renaming keeps them. Setting a name is a
                transaction — the network fee is paid in USDm. Your old name becomes free for
                anyone else to take.
              </p>
            </fieldset>
          </>
        )}
      </Window>

      {!loadError && (
        <Window title="UNFINISHED.LST">
          {loading || !me ? (
            <Loading />
          ) : me.active.length === 0 ? (
            <Empty line="Nothing unfinished" action={{ href: '/duels/new', label: 'Start a duel' }} />
          ) : (
            <table className="ledger">
              <thead><tr><th>Duel</th><th>Stake</th><th></th></tr></thead>
              <tbody>
                {me.active.map((d) => (
                  <tr key={d.id}>
                    <td>
                      ⚔️ duel_{d.id}.exe<br />
                      <small className={d.status === 'funded' ? 'win' : undefined}>
                        {activeLabel(d.status, Date.parse(d.createdAt), now)} · vs {opponentOf(d) ?? 'nobody yet'}
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
          {loading || !me ? (
            <Loading />
          ) : me.history.length === 0 ? (
            <Empty line="No finished duels yet" />
          ) : (
            <>
              <p className="fineprint">Record: {wins}W – {losses}L</p>
              <table className="ledger">
                <thead><tr><th>Duel</th><th>Stake</th><th>Result</th></tr></thead>
                <tbody>
                  {me.history.map((d) => (
                    <tr key={d.id}>
                      <td>
                        ⚔️ duel_{d.id}.exe<br />
                        {/* A duel nobody accepted has no opponent to name — "vs nobody yet"
                            is phrased for the active list and reads oddly once it is over. */}
                        <small>{opponentOf(d) ? `vs ${opponentOf(d)}` : 'Nobody accepted'}</small>
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
