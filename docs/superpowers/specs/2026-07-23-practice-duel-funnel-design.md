# Practice → duel funnel: the game-over screen

## Problem

Practice ("play free") exists to funnel players into staked duels, but its
game-over screen does not act like a funnel. It offers three co-equal actions —
a manual **Save score** button, **Play again**, and **Duel for stablecoins** —
so the money path competes for attention with a save button and a replay button.

Players also misread the flow: sitting under "You scored X", the duel button
looks like it carries the practice score into the duel. It does not, and cannot:
a duel is played on its own server-issued seed that both players run, so the
duel score is earned fresh, not inherited. (Copy already added to `/play` and
`/duels/new` states this; this change builds on it.)

Saving a practice score no longer needs a signature (the MiniPay-identity
change, [[2026-07-22-minipay-identity-design]]), so the manual save button buys
nothing but friction and visual competition.

## Goal

After **every** practice run, the single obvious next action is to duel. The
score still reaches the Hall of Fame — as social proof for the funnel — but it
gets there on its own, not by competing for the player's click.

Decided in brainstorming: practice is a **funnel to duels** (not a standalone
leaderboard), and the duel invitation is **always** primary (no score
threshold).

## Scope

One file: `frontend/src/app/play/page.tsx` (the practice game-over dialog). No
API, DB, or contract changes. `POST /api/practice` and `upsertBest` are reused
as-is; `upsertBest` already keeps only the greatest score, so saving on every
run is safe and idempotent in effect.

## Design

### Save becomes automatic

Replace the manual `save()` button and its `saved` / `busy` booleans with a
small state machine:

```
saveState: 'idle' | 'saving' | 'saved' | 'error'
```

An effect auto-saves when a run has ended and a wallet is connected:

- Fires when `result !== null` **and** `address` is set **and**
  `saveState === 'idle'`.
- Transitions `idle → saving`, POSTs `/api/practice`
  (`{ address, seed, taps, token }`, unchanged), then `saving → saved` or
  `saving → error`.
- **No auto-retry on error** — the effect only leaves `idle`, so a failed save
  lands on `error` and stays there until the player asks. This avoids an
  infinite retry loop.

Because the effect keys on `address`, a player who finishes a run *then*
connects still gets an automatic save the moment the wallet attaches.

### Duel is the primary action

- **Connected:** a large, full-width primary button **⚔️ Duel for stablecoins**
  linking to `/duels/new`. **Play again** demotes to a small secondary button.
  The manual save button is gone.
- **Not connected:** the primary button is **💰 Connect to keep your score &
  duel**. A practice run needs no wallet, but both saving and dueling do;
  connecting serves both. On connect, the auto-save effect fires and the primary
  button becomes the duel CTA on the next render.

### Status and helper copy

Inside the dialog, in order:

1. `You scored <b>{score}</b>.`
2. Save status, driven by `saveState`:
   - `saving`: "Saving your score…"
   - `saved`: "Saved to the Hall of Fame as <b>{shownAs}</b>."
   - `error`: "Couldn't save your score. [Try again]" — the button re-enters
     `saving`.
   - `idle`: no line (the not-connected CTA covers it).
3. The alias hint, when the player has no claimed name: "You appear as
   <b>{shownAs}</b>. Want your own name? Set it on your profile." (unchanged).
4. The duel-clarity fineprint (unchanged): "A duel is a fresh run for real
   stakes — this practice score stays on the Hall of Fame."

`shownAs = profileName ?? aliasFor(address)` as today.

### Play again resets cleanly

`again()` sets `saveState = 'idle'`, `result = null`, `error = null`, loads a
new seed, and bumps `runKey`. A save resolving after a reset must not write
stale status onto the next run: guard the in-flight save against the run it
belongs to (capture the run's identity, or a cancellation flag, and drop the
result if it changed).

## Consent note

Auto-save publishes the connected wallet's best score to a public leaderboard
under its alias, where before it took an explicit click. This is intended: the
leaderboard is the funnel's social proof and the player has connected a wallet
to a game whose whole point is public, staked competition. No addresses or raw
`0x…` are shown — only the alias or a claimed name.

## Testing

`play/page.tsx` has no unit tests (the identity plan verified it by hand); this
change keeps that convention. Verify by hand at a 360×640 viewport:

- Connected, finish a run: status auto-advances to "Saved to the Hall of Fame
  as <ALIAS>" with no button press, and the primary button is the full-width
  **Duel for stablecoins**.
- Not connected, finish a run: primary button reads **Connect to keep your
  score & duel**; after connecting, the score saves itself and the primary
  becomes the duel CTA.
- Force a save failure (offline): status shows "Couldn't save… Try again", and
  the button retries — it does **not** loop on its own.
- **Play again** starts a new round (new seed, canvas reset) with the save
  status cleared.

Gates: `npx tsc --noEmit` clean; `npx eslint src` reports no new problems
(baseline 12).
