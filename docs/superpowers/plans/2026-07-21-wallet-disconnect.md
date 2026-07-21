# Wallet Disconnect (MiniPay-aware) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a desktop user disconnect their wallet from a confirm dialog on the taskbar chip, while keeping the chip a static, non-interactive label inside MiniPay where disconnect is meaningless.

**Architecture:** One change to `WalletChip` in `src/components/Shell.tsx`. It gains `useDisconnect`, a `mounted` SSR-safe flag, and a `confirmOpen` state. When connected on desktop (`mounted && !isMiniPay()`), the chip becomes a `<button>` that opens a reused `Dialog95` confirmation; confirming calls `disconnect()`. In MiniPay or before mount, the chip renders exactly as it does today (a static `<span>`), and `providers.tsx`'s `AutoConnect` is untouched so MiniPay keeps auto-connecting.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, wagmi.

## Global Constraints

- **Off-chain only.** No contract, engine, or RNG change. Do not touch `contracts/`, `src/engine/`.
- **One file:** `src/components/Shell.tsx`. Do **not** add any CSS — reuse existing classes (`wallet-chip`, `is-live`, `dot`, `mono`, `row`, `spread`), all of which already exist in `src/app/globals.css`.
- **Do not modify `providers.tsx` / `AutoConnect`.** MiniPay must keep auto-connecting; the gate lives entirely in `WalletChip`.
- **No unit test.** The repo has no jsdom / React Testing Library and vitest collects `.ts` only (`vitest.config.ts`). This `.tsx`-only change is verified by `npm run build`, `npm run lint`, and a manual check — the same approach the Fair & Feel plan used for its `.tsx`-only "hide the ghost score" task.
- **Lint:** `Shell.tsx` already has pre-existing `react-hooks/set-state-in-effect` errors. The `mounted` effect adds one more instance **of that same already-present rule** — that is acceptable. The change must introduce **no new *kind* of lint error** and must not alter the pre-existing ones.
- **All work happens on branch `feat/wallet-disconnect`.** Do not merge to `main`.
- Run commands from `frontend/`.

---

### Task 1: Add a MiniPay-aware disconnect to `WalletChip`

Rewrites the one component. No earlier tasks; nothing consumes this.

**Files:**
- Modify: `frontend/src/components/Shell.tsx` (imports on lines 2 & 5; the `WalletChip` function at lines 37–56)

**Interfaces:**
- Consumes: `useDisconnect` (wagmi), `Dialog95` (`{ title, open, onClose?, children }` from `./Dialog95`), `isMiniPay()` (from `@/lib/minipay`).
- Produces: nothing consumed elsewhere. `WalletChip` takes no props (unchanged).

- [ ] **Step 1: Add the imports**

In `frontend/src/components/Shell.tsx`, line 5 currently reads:

```tsx
import { useAccount, useConnect } from 'wagmi';
```

Replace it with:

```tsx
import { useAccount, useConnect, useDisconnect } from 'wagmi';
```

Then, immediately after the `PixelBird` import (line 6: `import { PixelBird } from './PixelBird';`), add:

```tsx
import { Dialog95 } from './Dialog95';
import { isMiniPay } from '@/lib/minipay';
```

`useEffect` and `useState` are already imported on line 2 — do not change that line.

- [ ] **Step 2: Rewrite `WalletChip`**

Replace the entire `WalletChip` function (currently lines 37–56) with:

```tsx
function WalletChip() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const [mounted, setMounted] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // isMiniPay() reads window.ethereum, which is absent during SSR. Gate the
  // interactive chip behind a mount flag so the server render and the first
  // client render agree (both show the static span), then upgrade after mount.
  useEffect(() => { setMounted(true); }, []);

  if (isConnected && address) {
    // Inside MiniPay, disconnect is meaningless — the embedded wallet hosts the
    // dapp and AutoConnect would immediately reconnect — so the chip stays a
    // static, non-interactive label there and before hydration.
    if (!mounted || isMiniPay()) {
      return (
        <span className="wallet-chip is-live" title={address}>
          <span className="dot" />
          {address.slice(0, 4)}…{address.slice(-2)}
        </span>
      );
    }
    return (
      <>
        <button className="wallet-chip is-live" title={address} onClick={() => setConfirmOpen(true)}>
          <span className="dot" />
          {address.slice(0, 4)}…{address.slice(-2)}
        </button>
        <Dialog95 title="Disconnect" open={confirmOpen} onClose={() => setConfirmOpen(false)}>
          <p>⚠️ Disconnect wallet?</p>
          <p className="mono">{address}</p>
          <div className="row spread" style={{ marginTop: 10 }}>
            <button onClick={() => { disconnect(); setConfirmOpen(false); }}>Disconnect</button>
            <button onClick={() => setConfirmOpen(false)}>Cancel</button>
          </div>
        </Dialog95>
      </>
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
```

The connected `<button>` keeps the exact classes (`wallet-chip is-live`) and inner
markup (`dot` + short address) of the old `<span>`, so it looks identical — the
`.wallet-chip` class already styles buttons (the `💰 Connect` button uses it). The
disconnected branch is unchanged.

- [ ] **Step 3: Verify the build**

Run: `npm run build`

Expected: compiles with no TypeScript errors.

- [ ] **Step 4: Verify lint introduces no new kind of error**

Run: `npm run lint`

Expected: the only errors in `src/components/Shell.tsx` are `react-hooks/set-state-in-effect` — the same rule already present before this change (now with one additional instance from the `mounted` effect). No new *kind* of error (no unused imports, no `react/*` rule you newly tripped). The pre-existing errors in `Shell.tsx`, `fame/page.tsx`, `play/page.tsx`, and `duels/new/page.tsx` are not yours to fix.

- [ ] **Step 5: Manual check**

This step is run by the controller, not the implementer (it needs a wallet or a stubbed provider). Two scenarios:

1. **Desktop (real MetaMask, or a stubbed injected provider):** connect → the chip is clickable → clicking opens a `Disconnect` dialog showing the full address → `Cancel` (or the ✕) closes it with the wallet still connected → clicking again → `Disconnect` drops the wallet and the chip returns to `💰 Connect` (and does **not** auto-reconnect, because this is not MiniPay).
2. **MiniPay simulated** (`window.ethereum.isMiniPay = true`): the connected chip renders as the static span and does nothing on click.

- [ ] **Step 6: Commit**

```bash
git add src/components/Shell.tsx
git commit -m "feat(wallet): disconnect from the taskbar chip on desktop

The connected chip was a dead end. On desktop it now opens a confirm dialog and
calls wagmi disconnect(); inside MiniPay it stays the static label it was, since
disconnect is meaningless there and AutoConnect would immediately reconnect."
```

---

## Final verification

- [ ] **Build:** `cd frontend && npm run build` — no TypeScript errors.
- [ ] **Lint:** `npm run lint` — no new *kind* of error in `Shell.tsx` beyond the pre-existing `set-state-in-effect` rule.
- [ ] **Manual:** both scenarios in Task 1 Step 5 pass — desktop chip opens the confirm dialog and disconnects; MiniPay chip is a static label.
- [ ] **Full suite unaffected:** `npm test` — still green (this change touches no tested module, but confirm nothing regressed).

## Known gaps, deliberately not addressed here

- **No account switcher / multi-wallet picker, no "copy address" or explorer link.** The single `injected()` connector stays; account switching is done in the wallet extension. Recorded as out of scope in the spec.
- **No special handling for disconnecting mid-transaction.** The chip is a global taskbar control; disconnecting mid-flow drops the user to the connect prompts, which is acceptable.
- **Disconnect UI cannot be fully unit-tested** in this repo (no jsdom/RTL). The `mounted && !isMiniPay()` gate is the only logic, and it is trivial; verification is build + lint + manual by design.
