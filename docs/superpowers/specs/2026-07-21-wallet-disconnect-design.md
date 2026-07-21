# Wallet Disconnect (MiniPay-aware) — Design

**Date:** 2026-07-21
**Branch:** `feat/wallet-disconnect`

## Problem

The app can connect a wallet but can never disconnect one. `Shell.tsx`'s
`WalletChip` renders a `💰 Connect` button when disconnected, and once connected
shows a **static, non-interactive** `<span className="wallet-chip is-live">` with
the short address. There is no `useDisconnect` anywhere in the codebase — the
connected state is a dead end.

On **desktop with an injected wallet** (MetaMask) this is a real gap: a player
may want to switch accounts, connect a different wallet, or "log out" on a shared
machine. It also makes testing the two-sided duel flow (creator vs acceptor)
awkward, since there is no clean way to drop one account and connect another.

Inside **MiniPay** (the primary, mobile audience) disconnect is meaningless: the
wallet is the embedded provider that hosts the dapp, there is only ever one
account, and `providers.tsx`'s `AutoConnect` reconnects immediately whenever
`isMiniPay()` is true. A disconnect affordance there would either do nothing or
flicker (disconnect → instant reconnect).

## Decisions

1. **Add a disconnect affordance, gated to non-MiniPay.** On desktop the
   connected chip becomes clickable; in MiniPay it stays the static span it is
   today.
2. **Confirm before disconnecting.** Clicking the chip opens a `Dialog95`
   confirmation (`Disconnect wallet?` + short address, `[Disconnect]` /
   `[Cancel]`), reusing the existing component. This prevents an accidental
   disconnect from a stray click on the address.
3. **No unit test.** This is UI wiring over wagmi hooks with no non-trivial pure
   logic to extract, and the repo has no jsdom / React Testing Library (vitest
   collects `.ts` only). It is verified by `npm run build`, `npm run lint`, and a
   manual check — the same approach the Fair & Feel plan used for its `.tsx`-only
   "hide the ghost score" task.

## Design

### Single file: `src/components/Shell.tsx` (`WalletChip`)

Current `WalletChip`:

```tsx
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
    <button className="wallet-chip" onClick={() => connectors[0] && connect({ connector: connectors[0] })}>
      💰 Connect
    </button>
  );
}
```

Changes:

- Add `useDisconnect` (wagmi) and two pieces of local state: `confirmOpen`
  (dialog visibility) and `mounted` (SSR-safe client flag).
- **SSR-safe MiniPay gate.** `isMiniPay()` reads `window.ethereum`, which does
  not exist during server render. To avoid a hydration mismatch, the interactive
  version is gated behind a `mounted` flag set in a mount effect. Before mount
  (and therefore during SSR), the connected chip renders as the current static
  span. After mount, on non-MiniPay, it renders as a button that opens the
  confirm dialog. `const canDisconnect = mounted && isConnected && address && !isMiniPay();`
- **Connected + can disconnect:** render the chip as a `<button className="wallet-chip is-live">`
  (same classes, so the visual is unchanged) whose `onClick` sets `confirmOpen = true`,
  plus a `Dialog95` rendered alongside.
- **Connected in MiniPay / before mount:** render the existing static `<span>`
  unchanged.
- **Disconnected:** unchanged `💰 Connect` button.

### Confirm dialog

Rendered from within `WalletChip` when `confirmOpen`:

```tsx
<Dialog95 title="Disconnect" open={confirmOpen} onClose={() => setConfirmOpen(false)}>
  <p>⚠️ Disconnect wallet?</p>
  <p className="mono">{address}</p>
  <div className="row spread" style={{ marginTop: 10 }}>
    <button onClick={() => { disconnect(); setConfirmOpen(false); }}>Disconnect</button>
    <button onClick={() => setConfirmOpen(false)}>Cancel</button>
  </div>
</Dialog95>
```

`onClose` (the dialog's ✕) and `Cancel` both just close the dialog. `Disconnect`
calls `useDisconnect().disconnect()` then closes. After disconnect, wagmi flips
`isConnected` to false and `WalletChip` re-renders to the `💰 Connect` button
automatically; because we are not in MiniPay, `AutoConnect` does not reconnect.

## Note on lint

`Shell.tsx` already carries pre-existing `react-hooks/set-state-in-effect`
lint errors (unrelated to this work). The `mounted` flag adds one more mount
effect of the same shape. This matches the file's existing pattern; the project's
real gate is `npm run build` (which passes with these lint errors present). The
implementation must not introduce lint errors of any *new* kind and must not
touch the pre-existing ones.

## Scope / constraints

- Off-chain only. No contract, engine, or RNG change.
- File touched: `src/components/Shell.tsx` only (plus `globals.css` **only if** a
  new style is genuinely needed — the plan should reuse existing classes and add
  none if possible).
- Reuses `Dialog95` and `isMiniPay()`; adds `useDisconnect` from wagmi.
- Branch `feat/wallet-disconnect`, off `main`.

## Verification

- `npm run build` — compiles clean.
- `npm run lint` — no new error kinds in `Shell.tsx`.
- Manual (desktop, real MetaMask): connect → the chip is clickable → clicking
  opens the confirm dialog showing the full address → Cancel closes it, chip
  still connected → clicking again → Disconnect drops the wallet and the chip
  returns to `💰 Connect`.
- Manual (MiniPay, or MiniPay simulated by stubbing `window.ethereum.isMiniPay`):
  the connected chip is the static span and is not clickable.

## Deliberately out of scope

- **No account switcher / multi-wallet picker.** The single `injected()`
  connector stays; switching accounts is done in the wallet extension itself.
- **No "copy address" or explorer link.** Could live in a future dropdown, but
  the confirm-dialog interaction chosen here does not add them (YAGNI).
- **No special handling for disconnecting mid-transaction.** The chip is a global
  taskbar control; disconnecting mid-flow naturally drops the user to the
  connect prompts, which is acceptable.
