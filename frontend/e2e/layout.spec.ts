import { test, expect } from '@playwright/test';

const STUB = `window.ethereum = {
  isMetaMask: true,
  request: async ({ method }) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts')
      return ['0x66f744Af7b1D1218031c83cB2c62EBa7E6138eD8'];
    if (method === 'eth_chainId') return '0xa4ec';
    if (method === 'net_version') return '42220';
    return null;
  },
  on: () => {}, removeListener: () => {},
};`;

for (const path of ['/', '/duels', '/fame', '/play']) {
  test(`${path} does not scroll sideways at 360px`, async ({ page }) => {
    await page.goto(path);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(360);
  });
}

/**
 * `/api/me` is intercepted rather than left to hit the live DB/chain.
 *
 * The live stub address's real duel history is whatever the dev environment
 * happens to hold at the moment the suite runs, and it drifts: while building
 * this guard, that address's one active duel was `open` with no acceptor yet
 * ("... · vs nobody yet" — well short of the ledger's wrap threshold), so the
 * `white-space: normal` rule had nothing to prove itself against and the test
 * could not be made to fail no matter how the CSS was broken. `HOLLOWBONE` is
 * the longest word `aliasFor` (src/lib/alias.ts) ever produces; an `accepted`
 * duel old enough to read "Taking too long — open to check" combined with
 * that alias reproduces the exact 360px-vs-374px failure this guard exists
 * to catch, deterministically, on every run.
 */
const LONG_SUBTITLE_DUEL = {
  id: 999,
  status: 'accepted',
  stakeWei: '100000000000000000',
  token: '0x765de816845861e75a25fca122bb6898b8b1282a',
  creator: '0x66f744af7b1d1218031c83cb2c62eba7e6138ed8',
  // First byte 0x1a (26) selects the 'HOLLOWBONE' word in aliasFor's WORDS table —
  // the longest alias `aliasFor` can produce, e.g. "HOLLOWBONE_11A".
  acceptor: '0x1a1111111111111111111111111111111111111a',
  winner: null,
  settleTx: null,
  // Twice EXPIRY_MS (24h, src/lib/duelClock.ts) in the past so activeLabel()
  // reads "Taking too long — open to check" instead of the fresh label.
  createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
};

test('/profile does not scroll sideways at 360px', async ({ page }) => {
  await page.addInitScript(STUB);
  await page.route('**/api/me*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ name: 'TESTER', active: [LONG_SUBTITLE_DUEL], history: [] }),
    }),
  );
  await page.goto('/profile');
  await page.getByRole('button', { name: /connect wallet/i }).click();
  // getByText resolves against the .title-bar-text div `Window` renders — not a
  // heading — but it has been reliable in practice; kept as-is rather than
  // swapped for a more specific locator pre-emptively.
  await expect(page.getByText('UNFINISHED.LST')).toBeVisible();
  // The title bar renders synchronously; the ledger row is still an async fetch
  // away. Checking scrollWidth before it lands would measure the loading state,
  // not the layout this guard is for, so wait for the row itself.
  await expect(page.getByText('HOLLOWBONE', { exact: false })).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(360);
});
