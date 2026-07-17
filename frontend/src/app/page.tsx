import Link from 'next/link';
import { Window } from '@/components/Window';

export default function Home() {
  return (
    <main className="desktop">
      <Window title="FLAP95.EXE">
        <p style={{ margin: '4px 0 8px' }}>
          One-tap duels. Flap like it&apos;s 1995. Stake stablecoins, race the ghost, win the pot.
        </p>
      </Window>
      <nav className="desktop-icons">
        <Link className="desktop-icon" href="/play"><span className="glyph">🐤</span>Play</Link>
        <Link className="desktop-icon" href="/duels"><span className="glyph">⚔️</span>Open Duels</Link>
        <Link className="desktop-icon" href="/duels/new"><span className="glyph">📝</span>New Duel</Link>
        <Link className="desktop-icon" href="/fame"><span className="glyph">🏆</span>Hall of Fame</Link>
      </nav>
    </main>
  );
}
