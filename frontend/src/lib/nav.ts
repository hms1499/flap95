/**
 * Every place the app can be reached from, in one list.
 *
 * The Start menu (Shell) and the home screen's icon grid both render this. They
 * used to hold separate hand-written copies, and the copies drifted: Profile
 * shipped in the Start menu and was missing from the landing page, which is
 * where a first-time visitor looks.
 *
 * `file` is the DOS-style name the taskbar shows for the active window.
 */
export interface NavEntry {
  href: string;
  ico: string;
  label: string;
  file: string;
}

export const NAV: readonly NavEntry[] = [
  { href: '/play', ico: '🐤', label: 'Play', file: 'PRACTICE.EXE' },
  { href: '/duels', ico: '⚔️', label: 'Open Duels', file: 'C:\\DUELS' },
  { href: '/duels/new', ico: '📝', label: 'New Duel', file: 'NEWDUEL.EXE' },
  { href: '/fame', ico: '🏆', label: 'Hall of Fame', file: 'HALLOFFAME.XLS' },
  { href: '/profile', ico: '👤', label: 'Profile', file: 'PROFILE.EXE' },
];
