'use client';
import Link from 'next/link';
import { useAccount } from 'wagmi';
import { Window } from '@/components/Window';
import { formatStake } from '@/lib/contracts';
import { viewerRole } from '@/lib/outcome';
import { timeLeft } from '@/lib/duelClock';
import { useNow } from '@/lib/useNow';
import { useNames, displayName } from '@/lib/useNames';
import { Loading, Empty, LoadFailed } from '@/components/SectionState';
import { useJson } from '@/lib/useJson';

interface OpenDuel { id: number; stakeWei: string; token: string | null; creator: string; challengeTo: string | null; createdAt: string }

export default function DuelsPage() {
  const { address } = useAccount();
  const now = useNow();
  const { data, error, loading, reload } = useJson<{ duels: OpenDuel[] }>(
    address ? `/api/duels?viewer=${address}` : '/api/duels',
  );
  const duels = data?.duels ?? [];
  const names = useNames(duels.map((d) => d.creator));

  return (
    <main className="desktop">
      <Window title="C:\DUELS — open challenges">
        <div className="stack">
          <table className="ledger">
            <thead><tr><th>Duel</th><th>Stake</th></tr></thead>
            <tbody>
              {loading && <Loading as="row" colSpan={2} />}
              {error && <LoadFailed as="row" colSpan={2} onRetry={reload} />}
              {!loading && !error && duels.length === 0 && (
                <Empty as="row" colSpan={2} line="No open duels" action={{ href: '/duels/new', label: 'Create one' }} />
              )}
              {!loading && !error && duels.map((d) => {
                // acceptDuel reverts with SelfAccept() for the creator, so a duel of your own
                // must never look like something you can join — the revert only surfaces after
                // the ERC-20 approve has already cost the user gas.
                const mine = viewerRole(address, d.creator, null) === 'creator';
                // A duel stops being acceptable 24h after creation, so how long is left is
                // part of deciding whether to open it at all. Null until the clock mounts.
                const left = now === null ? null : timeLeft(Date.parse(d.createdAt), now);
                const who = mine ? 'yours' : `${displayName(names, d.creator)}${d.challengeTo ? ' · rematch' : ''}`;
                return (
                  <tr key={d.id}>
                    <td>
                      <Link className="rowlink" href={`/duels/${d.id}`}>
                        <span>⚔️ duel_{d.id}.exe</span>
                        <small>{who}{left && ` · ${left.expired ? 'expired' : `${left.label} left`}`}</small>
                      </Link>
                    </td>
                    <td className="stake">{formatStake(d.stakeWei, d.token)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="row spread">
            <Link href="/"><button>Back</button></Link>
            <Link href="/duels/new"><button>New duel</button></Link>
          </div>
        </div>
      </Window>
    </main>
  );
}
