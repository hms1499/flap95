'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { formatUnits } from 'viem';
import { Window } from '@/components/Window';
import { tokenByAddress } from '@/lib/contracts';

interface OpenDuel { id: number; stakeWei: string; token: string | null; creator: string; challengeTo: string | null; createdAt: string }

function stakeLabel(d: OpenDuel): string {
  const t = d.token ? tokenByAddress(d.token) : undefined;
  return `${formatUnits(BigInt(d.stakeWei), t?.decimals ?? 18)} ${t?.symbol ?? 'USDm'}`;
}

export default function DuelsPage() {
  const { address } = useAccount();
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
            {duels.map((d) => (
              <tr key={d.id}>
                <td>⚔️ duel_{d.id}.exe<br /><small>{d.creator.slice(0, 8)}…{d.challengeTo ? ' · rematch' : ''}</small></td>
                <td className="stake">{stakeLabel(d)}</td>
                <td><Link href={`/duels/${d.id}`}><button>Open</button></Link></td>
              </tr>
            ))}
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
