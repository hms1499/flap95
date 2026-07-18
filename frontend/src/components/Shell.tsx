'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAccount, useConnect } from 'wagmi';
import { PixelBird } from './PixelBird';

const NAV = [
  { href: '/play', ico: '🐤', label: 'Play', file: 'PRACTICE.EXE' },
  { href: '/duels', ico: '⚔️', label: 'Open Duels', file: 'C:\\DUELS' },
  { href: '/duels/new', ico: '📝', label: 'New Duel', file: 'NEWDUEL.EXE' },
  { href: '/fame', ico: '🏆', label: 'Hall of Fame', file: 'HALLOFFAME.XLS' },
];

/** Label for the taskbar's active-window button. */
function windowLabel(pathname: string): { ico: string; file: string } {
  if (pathname === '/') return { ico: '🖥️', file: 'FLAP95.EXE' };
  if (pathname.startsWith('/duels/') && pathname !== '/duels/new') {
    return { ico: '⚔️', file: 'DUEL.EXE' };
  }
  const hit = NAV.find((n) => n.href === pathname);
  return hit ? { ico: hit.ico, file: hit.file } : { ico: '🖥️', file: 'FLAP95.EXE' };
}

function Clock() {
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    const tick = () =>
      setNow(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);
  return <span className="tray__clock" suppressHydrationWarning>{now ?? '--:--'}</span>;
}

function WalletChip() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  if (isConnected && address) {
    return (
      <span className="wallet-chip is-live" title={address}>
        <span className="dot" />
        {address.slice(0, 4)}…{address.slice(-2)}
      </span>
    );
  }
  return (
    <button
      className="wallet-chip"
      onClick={() => connectors[0] && connect({ connector: connectors[0] })}
    >
      💰 Connect
    </button>
  );
}

function Boot() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || sessionStorage.getItem('flap95-booted')) return;
    sessionStorage.setItem('flap95-booted', '1');
    setShow(true);
    const id = setTimeout(() => setShow(false), 1350);
    return () => clearTimeout(id);
  }, []);
  if (!show) return null;
  return (
    <div className="boot" onClick={() => setShow(false)}>
      <div className="boot__panel">
        <PixelBird />
        <div className="wordmark">
          FLAP95<small>DUEL SYSTEM</small>
        </div>
        <div className="boot__bar"><span /></div>
        <p className="boot__hint">Starting Flap95… (tap to skip)</p>
      </div>
    </div>
  );
}

function Taskbar() {
  const pathname = usePathname();
  const [menu, setMenu] = useState(false);
  const active = windowLabel(pathname);

  // Close the menu on route change.
  useEffect(() => setMenu(false), [pathname]);

  return (
    <>
      {menu && (
        <>
          <div className="start-scrim" onClick={() => setMenu(false)} />
          <nav className="start-menu">
            <div className="start-menu__brand">
              FLAP<b>95</b>
            </div>
            <div className="start-menu__list">
              {NAV.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`start-menu__item ${pathname === n.href ? 'is-active' : ''}`}
                >
                  <span className="ico">{n.ico}</span>
                  {n.label}
                </Link>
              ))}
              <div className="start-menu__sep" />
              <Link href="/" className="start-menu__item">
                <span className="ico">🖥️</span>Desktop
              </Link>
              <div className="start-menu__foot">Duel like it&apos;s 1995.</div>
            </div>
          </nav>
        </>
      )}
      <div className="taskbar">
        <div className="taskbar__inner">
          <button
            className="start-btn"
            aria-expanded={menu}
            aria-haspopup="menu"
            onClick={() => setMenu((v) => !v)}
          >
            <PixelBird />
            Start
          </button>
          <span className="task-btn">
            {active.ico} {active.file}
          </span>
          <div className="tray">
            <WalletChip />
            <Clock />
          </div>
        </div>
      </div>
    </>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Taskbar />
      <Boot />
    </>
  );
}
