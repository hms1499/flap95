import type { Metadata } from 'next';
import '98.css';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'FLAP95.EXE',
  description: 'One-tap duels. Flap like it\'s 1995. Stake stablecoins, race the ghost, win the pot.',
  other: {
    'talentapp:project_verification':
      'a0204d2808c6c4fb48301d8fdb014a8e8677399d3c321ba339b6142ee6bed5f3e4d0245bcb9c5591944258300fc1789d6897393089aa5345cd3f3c53feb2311d',
  },
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
