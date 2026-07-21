# Resume a Funded Duel's Creator Run — Design

**Date:** 2026-07-21
**Branch:** `feat/resume-funded-duel`

## Problem

A duel is only listed (`status = 'open'`) after the creator plays their run
(`setCreatorRun` flips `funded → open`). The creation flow funds on-chain
(`createDuel` → `bind` → `funded`) and *then* drops the creator into their run.
If the creator abandons before the run is submitted — closes the tab, gets
interrupted, or leaves the new `TAP TO START` idle screen — the duel is stuck at
`funded`: invisible in the open list, and `/duels/[id]` returns "This duel is not
open." with **no in-app way to finish the run**. The stake is locked until 24h
pass, when `cancelExpired` can refund it.

Observed live: duel id 10 (onchain id 2, creator `0x66f7…8eD8`, 0.1 USDm) sat at
`funded` with `creator_taps = null` — funded on-chain but the run was never
recorded. The `TAP TO START` gate this project just added makes the abandon
window more likely, since there is now an idle screen before the run.

## Constraint that shapes the design

The seed is deliberately protected: `createDraft` returns `{ id, seed }` to the
creator at creation time, but neither `GET /api/duels/[id]` nor the list endpoint
exposes `seed` (the list query selects it but the handler projects it away). The
acceptor only receives it after an on-chain accept. So a resume flow must get the
seed to the creator **without** adding a server route that leaks it. The chosen
answer: the creator already holds the seed at creation time — stash it in
`localStorage` and read it back on resume. No new server endpoint, no seed
exposure, and the post-fund "one committed run" fairness property is preserved
(the creator finishes the same single run they funded, not a fresh reroll).

## Decisions

1. **localStorage-backed resume**, keyed by duel id. Same-device/browser only —
   accepted for an edge case (abandonment is almost always same session).
2. **No backend change.** `POST /api/duels/[id]/replay` with `role: 'creator'`
   already requires and accepts `status === 'funded'` and returns `{ ok, score }`;
   `GET /api/duels/[id]` already returns `status` and `creator`.
3. **The already-stuck duel 10 is not recovered by this feature** (its seed was
   never stashed). Its creator reclaims the 0.1 USDm via `cancelExpired` after
   24h. Accepted.
4. **Unit-tested seam.** The localStorage access is wrapped in a module that
   takes a `Storage` argument, so vitest (node, no jsdom) can test it with a fake
   store — unlike a raw `localStorage` call.

## Design

### New module: `src/lib/duelSeedStore.ts`

Pure, storage-injected — testable:

```ts
const KEY = (id: number) => `flap95:duelseed:${id}`;

export function saveDuelSeed(storage: Storage, id: number, seed: number): void;
export function loadDuelSeed(storage: Storage, id: number): number | null;  // null if absent or unparseable
export function clearDuelSeed(storage: Storage, id: number): void;
```

`loadDuelSeed` returns `null` for a missing key and for a stored value that does
not parse to a finite number (defensive against corruption / tampering — a bad
value must not crash the page or feed a NaN seed into the engine).

### `src/app/duels/new/page.tsx`

- After the draft is created (`setDuel(draft)` — we have `{ id, seed }` there):
  `saveDuelSeed(localStorage, draft.id, draft.seed)`.
- After a **successful** creator run submit (the existing `onRunEnd`, once
  `res.ok`): `clearDuelSeed(localStorage, duel.id)`. The seed is no longer needed
  once the run is recorded; clearing it keeps storage tidy.

### `src/app/duels/[id]/page.tsx`

- **Loader** (runs once on `[id]`, does not read `address`): add the funded branch
  **inside the existing `if (!maybeStale)` block**, after the `open` check and
  before the "not open" error:

  ```ts
  if (!maybeStale) {
    if (d.status === 'open') { setPhase('preview'); return; }
    if (d.status === 'funded') { setPhase('funded'); return; }
    setPhase('error');
    setError('This duel is not open.');
    return;
  }
  ```

  Placement inside `!maybeStale` is load-bearing: only a **fresh** funded duel
  (age < 24h) gets the resume phase. A funded duel older than 24h is `maybeStale`,
  so it must fall through to the existing chain-read path that offers
  `cancelExpired` — the creator's stake refund. Intercepting all funded duels
  above that check would break the refund path for old stuck duels.

  Detecting *whether the viewer is the creator* is deliberately NOT done here: the
  loader intentionally does not depend on `address` (it would re-run and clobber
  state), and `address` may not be hydrated when it runs. That decision moves to
  render, which is reactive to `address`.

- **Add `'funded'` to the `Phase` union.**

- **Render `phase === 'funded'`** (reactive to `address`):
  - Compute `role = viewerRole(address, detail.creator, detail.acceptor)` (reuse
    the existing `outcome.ts` helper).
  - Read the seed once, SSR-safe: a `useEffect` keyed on `phase === 'funded'`
    reads `loadDuelSeed(localStorage, detail.id)` into a `resumeSeed` state
    (localStorage is client-only; reading it in an effect avoids a hydration
    mismatch).
  - **Creator with a seed:** show a "Finish your run" window → on click, render
    `GameCanvas` with that seed and **no `ghostTaps`** (the creator races nothing).
    Its `onRunEnd(taps)` POSTs `role: 'creator'` to
    `/api/duels/[id]/replay` (mirrors `duels/new`), and on `res.ok` calls
    `clearDuelSeed(localStorage, detail.id)` and shows a confirmation ("Your run
    is in — the duel is now open") with a button to `/duels`.
  - **Creator without a seed** (`resumeSeed === null`): a message explaining the
    run can't be recovered on this device, and that the stake can be reclaimed
    after 24h (the existing reclaim path already handles the on-chain refund once
    the duel is old enough).
  - **Not the creator:** a neutral "This duel isn't open yet." message — no seed,
    no resume, nothing leaked.

No change to `providers.tsx`, the engine, contracts, or any API route.

## Scope / constraints

- Off-chain only. No contract, engine, RNG, or backend/API change.
- Files: create `src/lib/duelSeedStore.ts` + `src/lib/duelSeedStore.test.ts`;
  modify `src/app/duels/new/page.tsx` and `src/app/duels/[id]/page.tsx`.
- Reuses `GameCanvas`, `viewerRole` (`outcome.ts`), `Window`, and the existing
  `role: 'creator'` replay endpoint.
- Branch `feat/resume-funded-duel`, off `main`.

## Verification

- **Unit:** `duelSeedStore.test.ts` with a fake `Storage` — save then load returns
  the seed; load of a missing key returns `null`; load of a corrupt value returns
  `null`; clear removes it.
- **Build / lint:** `npm run build` clean; `npm run lint` adds no new *kind* of
  error.
- **Manual (Playwright, stubbed):** with a stubbed injected wallet as the creator
  of a `funded` duel and its seed placed in `localStorage`, opening `/duels/<id>`
  shows "Finish your run"; playing a run and finishing flips the duel to `open`
  (verified via the DB / the open list) and clears the stored seed. With no seed
  in `localStorage`, the recover-after-24h message shows instead. As a non-creator
  wallet, the neutral message shows.

## Deliberately out of scope

- **Cross-device resume.** Requires proving creator identity to a server to
  re-hand the seed (a signature-gated endpoint) — heavier, and rejected here in
  favor of the localStorage approach for this edge case.
- **Recovering duel 10 (or any pre-existing stuck duel).** Its seed was never
  stashed; it refunds via `cancelExpired` after 24h.
- **Preventing the stuck state at the source** (playing before funding). That
  reorder would let a creator reroll their run before committing a stake, an
  unfairness versus the acceptor's single post-accept run, so it is not pursued.
