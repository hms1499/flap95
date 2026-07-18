import Link from 'next/link';
import { Window } from '@/components/Window';
import { PixelBird } from '@/components/PixelBird';

export default function Home() {
  return (
    <main className="desktop">
      <Window title="FLAP95.EXE">
        <div className="hero">
          <div className="hero__plate">
            <PixelBird />
            <div className="wordmark">
              FLAP95<small>DUEL SYSTEM · CELO</small>
            </div>
          </div>
          <p className="pitch">
            One-tap duels. Flap like it&apos;s 1995 — stake stablecoins, race your
            rival&apos;s ghost, and the winner takes the pot.
          </p>
          <div className="cta-row">
            <Link className="cta" href="/play">▶ Play free</Link>
            <Link className="cta cta--duel" href="/duels/new">⚔️ Duel for stables</Link>
          </div>
          <div className="marquee" aria-label="House rules">
            <div className="marquee__track">
              Winner takes the pot <b>−5% house fee</b> &nbsp;•&nbsp; Ties refund both
              players &nbsp;•&nbsp; Same pipes, same physics &nbsp;•&nbsp; Provably-fair
              replay — <b>no sniping</b> &nbsp;•&nbsp; Settled on-chain on Celo &nbsp;•&nbsp;
            </div>
          </div>
        </div>
      </Window>

      <nav className="desktop-icons">
        <Link className="desktop-icon" href="/play"><span className="glyph">🐤</span><span>Play</span></Link>
        <Link className="desktop-icon" href="/duels"><span className="glyph">⚔️</span><span>Open Duels</span></Link>
        <Link className="desktop-icon" href="/duels/new"><span className="glyph">📝</span><span>New Duel</span></Link>
        <Link className="desktop-icon" href="/fame"><span className="glyph">🏆</span><span>Hall of Fame</span></Link>
      </nav>
    </main>
  );
}
