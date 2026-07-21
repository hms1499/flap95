'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { formatUnits } from 'viem';
import { Window } from '@/components/Window';
import { tokenByAddress } from '@/lib/contracts';
import { viewerRole } from '@/lib/outcome';
import { timeLeft } from '@/lib/duelClock';
import { useNow } from '@/lib/useNow';

interface OpenDuel { id: number; stakeWei: string; token: string | null; creator: string; challengeTo: string | null; createdAt: string }

function stakeLabel(d: OpenDuel): string {
  const t = d.token ? tokenByAddress(d.token) : undefined;
  return `${formatUnits(BigInt(d.stakeWei), t?.decimals ?? 18)} ${t?.symbol ?? 'USDm'}`;
}

export default function DuelsPage() {
  const { address } = useAccount();
  const now = useNow();
  const [duels, setDuels] = useState<OpenDuel[]>([]);
  useEffect(() => {
    const q = address ? `?viewer=${address}` : '';
    fetch(`/api/duels${q}`).then((r) => r.json()).then((d) => setDuels(d.duels ?? []));
  }, [address]);

  return (
    <main className="desktop">
      <Window title="C:\DUELS — open challenges">
        <table className="ledger">
          <thead><tr><th>Duel</th><th>Stake</th><th></th></tr></thead>
          <tbody>
            {duels.map((d) => {
              // acceptDuel reverts with SelfAccept() for the creator, so a duel of your own
              // must never look like something you can join — the revert only surfaces after
              // the ERC-20 approve has already cost the user gas.
              const mine = viewerRole(address, d.creator, null) === 'creator';
              // A duel stops being acceptable 24h after creation, so how long is left is
              // part of deciding whether to open it at all. Null until the clock mounts.
              const left = now === null ? null : timeLeft(Date.parse(d.createdAt), now);
              const who = mine ? 'yours' : `${d.creator.slice(0, 8)}…${d.challengeTo ? ' · rematch' : ''}`;
              return (
                <tr key={d.id}>
                  <td>⚔️ duel_{d.id}.exe<br /><small>{who}{left && ` · ${left.expired ? 'expired' : `${left.label} left`}`}</small></td>
                  <td className="stake">{stakeLabel(d)}</td>
                  <td><Link href={`/duels/${d.id}`}><button>{mine ? 'View' : 'Open'}</button></Link></td>
                </tr>
              );
            })}
            {duels.length === 0 && <tr><td colSpan={3}>No open duels. Create one!</td></tr>}
          </tbody>
        </table>
        <div className="row spread" style={{ marginTop: 8 }}>
          <Link href="/"><button>Back</button></Link>
          <Link href="/duels/new"><button>New duel</button></Link>
        </div>
      </Window>
    </main>
  );
}
