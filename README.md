# FLAP95.EXE 🐤

One-tap duels. Flap like it's 1995. Stake stablecoins, race the ghost, win the pot.

Flap95 is a Flappy-style skill game on **Celo Mainnet** with 1v1 staked async duels:
create a duel, stake **USDm (cUSD), USDC, or USDT** (0.1 / 0.5 / 1), play your run —
then a challenger locks a matching stake and races your **ghost** on the exact same
pipes. Winner takes the pot minus a 5% house fee; equal scores go to whoever survived
longer, and a dead-even run refunds both players. All of it wrapped in a Windows 95 UI.

## How it works

- **Deterministic engine** (`frontend/src/engine/`) — fixed 60 ticks/s, taps are tick
  indices, the world derives from a seed with order-independent randomness. The same
  seed + taps always replays identically, in the browser and on the server.
- **Server-side verification** — the client only ever submits its tap trace. API routes
  re-simulate the run, reject impossible traces (superhuman tap rate, out-of-range
  ticks), and compute the score themselves.
- **Oracle-signed settlement** — the backend decides the winner and signs an EIP-712
  `Settle` message; the escrow contract pays out only against that signature.
- **Blind duels** — open listings never reveal the creator's score, and the ghost race
  never shows the ghost's score either. You can watch the grey bird, but the number stays
  hidden until you finish — so neither side gets a free read on the target.
- **Ties break on survival time** — equal scores go to whoever stayed alive longer. Only a
  run matching on both counts refunds both players. Survival time is off-chain, so a duel
  settled this way shows equal scores in the `DuelSettled` event; the winner is whoever
  lasted more ticks.

## Contract

| | |
|---|---|
| DuelEscrow | [`0x252463d6F470Ba46ccd6d861d0cf14029ADc42ad`](https://celoscan.io/address/0x252463d6F470Ba46ccd6d861d0cf14029ADc42ad) |
| Chain | Celo Mainnet (42220) |
| Source verification | [Sourcify (exact match)](https://repo.sourcify.dev/contracts/full_match/42220/0x252463d6F470Ba46ccd6d861d0cf14029ADc42ad/) |
| Stake tokens | USDm `0x765D…282a` · USDC `0xcebA…118C` · USDT `0x4806…3D5e` |

## Run locally

```bash
# frontend (Next.js App Router)
cd frontend
npm install
cp .env.example .env.local   # fill in the values below
npm run dev

# contracts (Foundry)
cd contracts
forge test
```

| Env var | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string |
| `ORACLE_PRIVATE_KEY` | Server-only settle signer — never commit |
| `NEXT_PUBLIC_ESCROW_ADDRESS` | Deployed DuelEscrow address |
| `NEXT_PUBLIC_USDM_ADDRESS` / `USDC` / `USDT` | Stake token addresses (defaults baked in) |

Tests: `npm test` (engine + oracle, vitest) and `forge test` (contract, incl. fuzz).

## MiniPay

MiniPay detection lives in [`frontend/src/lib/minipay.ts`](frontend/src/lib/minipay.ts)
(`isMiniPay()`); inside MiniPay the app auto-connects the injected provider and passes
`feeCurrency` (USDm) on writes.

## Screenshots

_Coming soon._
