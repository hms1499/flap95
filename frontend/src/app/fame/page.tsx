'use client';
import { useEffect, useState } from 'react';
import { Window } from '@/components/Window';

export default function FamePage() {
  const [scores, setScores] = useState<{ name: string; score: number }[]>([]);
  useEffect(() => {
    fetch('/api/practice').then((r) => r.json()).then((d) => setScores(d.scores ?? []));
  }, []);
  return (
    <main className="desktop">
      <Window title="HALLOFFAME.XLS">
        <table className="ledger">
          <thead><tr><th>#</th><th>Name</th><th>Score</th></tr></thead>
          <tbody>
            {scores.map((s, i) => (
              <tr key={`${s.name}-${i}`}><td>{i + 1}</td><td>{s.name}</td><td>{s.score}</td></tr>
            ))}
            {scores.length === 0 && <tr><td colSpan={3}>No scores yet. Be the first.</td></tr>}
          </tbody>
        </table>
        <a href="/"><button style={{ marginTop: 8 }}>Back</button></a>
      </Window>
    </main>
  );
}
