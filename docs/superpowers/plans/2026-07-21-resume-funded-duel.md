# Resume a Funded Duel's Creator Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a creator who funded a duel but abandoned before finishing their run come back to `/duels/[id]` and complete that run from a seed stashed in localStorage, flipping the duel from `funded` to `open`.

**Architecture:** A storage-injected `duelSeedStore` module persists `{duelId → seed}` on the creator's device. `duels/new` saves the seed at draft creation and clears it once the run is recorded. `duels/[id]` routes a fresh `funded` duel to a new `funded` phase whose render — reactive to the connected address — offers the creator a "Finish your run" `GameCanvas` (no ghost) that submits `role: 'creator'` to the existing replay endpoint. No backend, contract, or engine change; the seed is never exposed by an API.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, wagmi, vitest.

## Global Constraints

- **Off-chain only.** No contract, engine (`src/engine/`), RNG, or API/route change. The `role: 'creator'` replay endpoint and the `GET /api/duels/[id]` route already provide everything needed.
- **Do not expose the seed via any API.** The seed reaches the creator only through localStorage (stashed client-side at creation). Do not add a route that returns `seed`.
- **Vitest collects `src/**/*.test.ts` only** (node env, no jsdom). The storage module is testable by injecting a fake `Storage`; the two `.tsx` pages are verified by `npm run build` and a manual check.
- **Lint:** the repo has pre-existing `react-hooks/set-state-in-effect` errors. The one new effect in `duels/[id]` adds one more instance **of that same rule**; that is acceptable. Introduce no new *kind* of lint error.
- **All work happens on branch `feat/resume-funded-duel`.** Do not merge to `main`.
- Run commands from `frontend/`.

---

### Task 1: `duelSeedStore` module + tests

Pure, storage-injected persistence. TDD.

**Files:**
- Create: `frontend/src/lib/duelSeedStore.ts`
- Test: `frontend/src/lib/duelSeedStore.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export function saveDuelSeed(storage: Storage, id: number, seed: number): void`
  - `export function loadDuelSeed(storage: Storage, id: number): number | null`
  - `export function clearDuelSeed(storage: Storage, id: number): void`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/lib/duelSeedStore.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { saveDuelSeed, loadDuelSeed, clearDuelSeed } from './duelSeedStore';

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => { m.clear(); },
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  } as Storage;
}

describe('duelSeedStore', () => {
  it('saves then loads the seed for a duel id', () => {
    const s = fakeStorage();
    saveDuelSeed(s, 10, 123456);
    expect(loadDuelSeed(s, 10)).toBe(123456);
  });
  it('returns null for a duel with no stored seed', () => {
    expect(loadDuelSeed(fakeStorage(), 99)).toBeNull();
  });
  it('keeps seeds separate per duel id', () => {
    const s = fakeStorage();
    saveDuelSeed(s, 1, 111);
    saveDuelSeed(s, 2, 222);
    expect(loadDuelSeed(s, 1)).toBe(111);
    expect(loadDuelSeed(s, 2)).toBe(222);
  });
  it('returns null for a corrupt (non-numeric) stored value', () => {
    const s = fakeStorage();
    s.setItem('flap95:duelseed:5', 'not-a-number');
    expect(loadDuelSeed(s, 5)).toBeNull();
  });
  it('clear removes the stored seed', () => {
    const s = fakeStorage();
    saveDuelSeed(s, 7, 42);
    clearDuelSeed(s, 7);
    expect(loadDuelSeed(s, 7)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/duelSeedStore.test.ts`

Expected: FAIL — `./duelSeedStore` does not exist.

- [ ] **Step 3: Implement the module**

Create `frontend/src/lib/duelSeedStore.ts`:

```ts
/**
 * Where a duel's seed lives on the creator's device so they can finish an
 * interrupted run. The seed is deliberately never exposed by any API — the
 * creator holds it at creation time — so localStorage is the only place it can
 * come from on a return visit. `Storage` is injected so this is testable in node.
 */
const key = (id: number) => `flap95:duelseed:${id}`;

export function saveDuelSeed(storage: Storage, id: number, seed: number): void {
  storage.setItem(key(id), String(seed));
}

/**
 * The stored seed, or null if absent or not a finite number. A corrupt or
 * tampered value must degrade to "no seed" (recover-later message) rather than
 * crash the page or feed a NaN seed into the engine.
 */
export function loadDuelSeed(storage: Storage, id: number): number | null {
  const raw = storage.getItem(key(id));
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function clearDuelSeed(storage: Storage, id: number): void {
  storage.removeItem(key(id));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/duelSeedStore.test.ts`

Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/duelSeedStore.ts src/lib/duelSeedStore.test.ts
git commit -m "feat(duels): stash a duel's seed on the creator's device

Storage-injected so it is testable in node. The seed is never exposed by an API,
so localStorage is the only way a returning creator can recover it to finish an
interrupted run. A corrupt value degrades to null, never a NaN seed."
```

---

### Task 2: Save the seed on create, clear it on submit (`duels/new`)

**Files:**
- Modify: `frontend/src/app/duels/new/page.tsx` (imports; `setDuel(draft)` at line 38; `onRunEnd` around lines 71–82)

**Interfaces:**
- Consumes: `saveDuelSeed`, `clearDuelSeed` from Task 1.
- Produces: nothing consumed by later tasks (Task 3 reads localStorage independently).

- [ ] **Step 1: Add the import**

In `frontend/src/app/duels/new/page.tsx`, after the `feeCurrencyOverrides` import (line 11), add:

```ts
import { saveDuelSeed, clearDuelSeed } from '@/lib/duelSeedStore';
```

- [ ] **Step 2: Save the seed when the draft is created**

Line 38 reads:

```ts
      setDuel(draft);
```

Add immediately after it:

```ts
      // Stash the seed so the creator can finish this run later if they abandon it
      // before it is recorded (the seed is never re-served by any API).
      saveDuelSeed(localStorage, draft.id, draft.seed);
```

- [ ] **Step 3: Clear the seed once the run is recorded**

In `onRunEnd`, the success tail currently reads (lines ~79–81):

```ts
    const data = await res.json();
    setFinalScore(data.score);
    setPhase('done');
```

Replace with:

```ts
    const data = await res.json();
    clearDuelSeed(localStorage, duel.id);
    setFinalScore(data.score);
    setPhase('done');
```

`duel` is non-null here — `onRunEnd` returns early at its top if `!duel`.

- [ ] **Step 4: Verify build and lint**

Run: `npm run build`

Expected: compiles, no TypeScript errors.

Run: `npm run lint`

Expected: no new *kind* of error in `duels/new/page.tsx` (this file has a pre-existing warning/errors unrelated to this change; do not fix them).

- [ ] **Step 5: Commit**

```bash
git add "src/app/duels/new/page.tsx"
git commit -m "feat(duels): persist the seed at create, clear it once the run lands

The creator now stashes the seed when the draft is created and clears it after
the run is recorded, so an interrupted run can be resumed from /duels/[id]."
```

---

### Task 3: Resume UI on the duel page (`duels/[id]`)

Routes a fresh `funded` duel to a `funded` phase and lets its creator finish the run.

**Files:**
- Modify: `frontend/src/app/duels/[id]/page.tsx` (import line 13; `Phase` union line 15; state block ~lines 40–45; loader `!maybeStale` block ~lines 89–94; add an effect and a handler; add a render block after the settled block)

**Interfaces:**
- Consumes: `loadDuelSeed`, `clearDuelSeed` from Task 1; existing `viewerRole` (`outcome.ts`), `GameCanvas`, `Window`, and the `role: 'creator'` replay endpoint.
- Produces: nothing.

- [ ] **Step 1: Add the import**

Line 13 currently reads:

```ts
import { orientResult, viewerRole } from '@/lib/outcome';
```

Add after it:

```ts
import { loadDuelSeed, clearDuelSeed } from '@/lib/duelSeedStore';
```

- [ ] **Step 2: Add `'funded'` to the `Phase` union**

Line 15 currently reads:

```ts
type Phase = 'loading' | 'preview' | 'settled' | 'reclaim' | 'reclaiming' | 'approving' | 'accepting' | 'binding' | 'playing' | 'submitting' | 'result' | 'error';
```

Replace with (adds `'funded'` after `'settled'`):

```ts
type Phase = 'loading' | 'preview' | 'settled' | 'funded' | 'reclaim' | 'reclaiming' | 'approving' | 'accepting' | 'binding' | 'playing' | 'submitting' | 'result' | 'error';
```

- [ ] **Step 3: Add the resume state**

Immediately after the `error` state declaration (`const [error, setError] = useState('');`, around line 45), add:

```ts
  // Creator-resume of a funded duel: the seed read from localStorage, whether the
  // run has been started, and the score once the finished run is recorded.
  const [resumeSeed, setResumeSeed] = useState<number | null>(null);
  const [resumeStarted, setResumeStarted] = useState(false);
  const [resumeScore, setResumeScore] = useState<number | null>(null);
```

- [ ] **Step 4: Route a fresh funded duel to the `funded` phase**

The loader's `!maybeStale` block currently reads:

```ts
      if (!maybeStale) {
        // Fast path: a live duel still inside its window needs no chain read.
        if (d.status === 'open') { setPhase('preview'); return; }
        setPhase('error');
        setError('This duel is not open.');
        return;
      }
```

Replace with:

```ts
      if (!maybeStale) {
        // Fast path: a live duel still inside its window needs no chain read.
        if (d.status === 'open') { setPhase('preview'); return; }
        // A funded duel is one the creator staked but never finished the run for.
        // Only fresh ones resume here; an old funded duel is maybeStale and must
        // fall through to the cancelExpired refund path below, so this stays inside
        // the !maybeStale block.
        if (d.status === 'funded') { setPhase('funded'); return; }
        setPhase('error');
        setError('This duel is not open.');
        return;
      }
```

- [ ] **Step 5: Read the stashed seed once the duel is known funded**

Add this effect immediately after the loader effect's closing `}, [id]);` line:

```ts
  // localStorage is client-only, so read the stashed seed in an effect (not during
  // render) to avoid a hydration mismatch. Runs once the funded phase is entered.
  useEffect(() => {
    if (phase === 'funded' && detail) setResumeSeed(loadDuelSeed(localStorage, detail.id));
  }, [phase, detail]);
```

- [ ] **Step 6: Add the creator-run submit handler**

Add after the existing `onRunEnd` callback (the acceptor handler):

```ts
  const onCreatorRunEnd = useCallback(async (taps: number[]) => {
    if (!detail) return;
    const res = await fetch(`/api/duels/${detail.id}/replay`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'creator', taps }),
    });
    if (!res.ok) { setError('Could not save your run. Try again.'); setPhase('error'); return; }
    const data = await res.json();
    clearDuelSeed(localStorage, detail.id);
    setResumeScore(data.score);
  }, [detail]);
```

- [ ] **Step 7: Add the `funded` render block**

Immediately after the `{phase === 'settled' && ...}` render block (it ends with `})()}`), add:

```tsx
      {phase === 'funded' && detail && (() => {
        const role = viewerRole(address, detail.creator, detail.acceptor);
        if (role !== 'creator') {
          return (
            <Window title={`DUEL_${detail.id}.EXE`}>
              <p>This duel isn&apos;t open yet — its creator hasn&apos;t finished their run.</p>
              <button onClick={() => router.push('/duels')}>Back to duels</button>
            </Window>
          );
        }
        if (resumeScore !== null) {
          return (
            <Window title={`DUEL_${detail.id}.EXE — run saved`}>
              <p>✅ Your run is in (score {resumeScore}). The duel is now open for challengers.</p>
              <button onClick={() => router.push('/duels')}>Back to duels</button>
            </Window>
          );
        }
        if (resumeSeed === null) {
          return (
            <Window title={`DUEL_${detail.id}.EXE — unfinished`}>
              <p style={{ fontSize: 12 }}>⚠️ You funded this duel but didn&apos;t finish your run, and
                the game can&apos;t be recovered on this device. Your {stakeStr} {symbol} stake can be
                reclaimed 24 hours after creation — reopen this page then to refund it.</p>
              <button onClick={() => router.push('/duels')}>Back to duels</button>
            </Window>
          );
        }
        if (resumeStarted) {
          return (
            <Window title={`DUEL_${detail.id}.EXE — finish your run`}>
              <GameCanvas seed={resumeSeed} onRunEnd={onCreatorRunEnd} />
            </Window>
          );
        }
        return (
          <Window title={`DUEL_${detail.id}.EXE — finish your run`}>
            <p style={{ fontSize: 12 }}>You funded this duel but never finished your run. Play it now
              to open it for challengers.</p>
            <button onClick={() => setResumeStarted(true)} style={{ width: '100%' }}>Finish your run</button>
          </Window>
        );
      })()}
```

`stakeStr` and `symbol` are already computed in the component body before the
return (used by the preview/settled blocks), so they are in scope here.

- [ ] **Step 8: Verify build, lint, and the full suite**

Run: `npm test && npm run build`

Expected: tests pass (including Task 1's `duelSeedStore.test.ts` and the engine golden test); build compiles.

Run: `npm run lint`

Expected: the only new lint line is one additional `react-hooks/set-state-in-effect` (the resume-seed effect) — same rule already present in the repo. No new *kind* of error.

- [ ] **Step 9: Manual check (controller-run)**

Uses a stubbed injected wallet and a temporary `funded` DB row (a `funded` duel needs no on-chain deposit for the resume UI + `setCreatorRun`, which are DB-only). The controller: inserts a throwaway funded duel with a known seed and a test creator address; stubs the wallet as that creator; sets `localStorage['flap95:duelseed:<id>'] = <seed>`; opens `/duels/<id>` and confirms:
- "Finish your run" shows; clicking it renders the game; finishing the run flips the duel to `status = 'open'` (verify via DB) and shows the "run saved" confirmation; the stored seed is cleared.
- With no localStorage seed, the recover-after-24h message shows instead.
- As a non-creator wallet, the neutral "isn't open yet" message shows.
Then delete the throwaway row.

- [ ] **Step 10: Commit**

```bash
git add "src/app/duels/[id]/page.tsx"
git commit -m "feat(duels): let a creator finish a funded duel's interrupted run

A funded duel the creator abandoned before finishing their run now routes to a
resume screen: with the seed stashed in localStorage they replay it and the duel
opens; without it they get a reclaim-after-24h message. The funded branch sits
inside the non-stale check so old funded duels still reach cancelExpired."
```

---

## Final verification

- [ ] **Full suite:** `cd frontend && npm test` — all green, including `duelSeedStore.test.ts` and the engine golden test.
- [ ] **Build:** `npm run build` — no TypeScript errors.
- [ ] **Lint:** `npm run lint` — no new *kind* of error; at most one added `set-state-in-effect`.
- [ ] **Manual:** the three scenarios in Task 3 Step 9 pass; the throwaway DB row is deleted afterward.

## Known gaps, deliberately not addressed here

- **Cross-device resume is not supported.** The seed lives in one browser's localStorage; a different device gets the recover-after-24h path. Recorded in the spec.
- **Pre-existing stuck duels (e.g. duel 10) are not recovered** — their seed was never stashed; they refund via `cancelExpired` after 24h.
- **A brief frozen last frame** may show between the creator's bird dying and the "run saved" confirmation while the replay POST is in flight. Cosmetic; not worth an extra submitting state.
