import type { Metadata } from 'next';
import '98.css';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'FLAP95.EXE',
  description: 'One-tap duels. Flap like it\'s 1995. Stake stablecoins, race the ghost, win the pot.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
