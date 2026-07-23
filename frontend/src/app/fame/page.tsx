'use client';
import { Window } from '@/components/Window';
import { Loading, Empty, LoadFailed } from '@/components/SectionState';
import { useJson } from '@/lib/useJson';
import { aliasFor } from '@/lib/alias';

interface Row { address: string; name: string | null; score: number }

export default function FamePage() {
  const { data, error, loading, reload } = useJson<{ scores: Row[] }>('/api/practice');
  const scores = data?.scores ?? [];

  return (
    <main className="desktop">
      <Window title="HALLOFFAME.XLS — best practice runs">
        <table className="ledger">
          <thead><tr><th>#</th><th>Name</th><th>Score</th></tr></thead>
          <tbody>
            {loading && <Loading as="row" colSpan={3} />}
            {error && <LoadFailed as="row" colSpan={3} onRetry={reload} />}
            {!loading && !error && scores.length === 0 && (
              <Empty as="row" colSpan={3} line="No scores yet" action={{ href: '/play', label: 'Play a round' }} />
            )}
            {!loading && !error && scores.map((s, i) => (
              <tr key={s.address}>
                <td>{i + 1}</td>
                <td>{s.name ?? aliasFor(s.address)}</td>
                <td className="win">{s.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="stack">
          <a href="/"><button className="btn-block">Back</button></a>
        </div>
      </Window>
    </main>
  );
}
