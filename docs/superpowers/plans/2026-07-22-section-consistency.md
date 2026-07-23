# Section consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make every `<Window>` section on every page render the same four states — loading, error, empty, content — from shared parts instead of per-page markup.

**Architecture:** One pure `fetchJson` helper carries the testable logic; a thin `useJson` hook wraps it with React state and a cancellation flag; three small components render the three non-content states. The four pages move onto them, which also fixes two pages that today show their empty state while loading and swallow fetch errors entirely.

**Tech Stack:** Next.js 16 (App Router), React 19, Vitest (node environment, no component-test setup).

**Spec:** `docs/superpowers/specs/2026-07-22-section-consistency-design.md`

**Runs after:** `docs/superpowers/plans/2026-07-22-minipay-identity.md`. That plan changes what these sections display (aliases on the leaderboard, transaction-based renaming). Doing this one first would mean rebuilding sections around content that then changes.

## Global Constraints

- **The Windows 95 identity is not up for discussion.** No visual redesign: no new colours, fonts, radii, or layout metaphors. This plan changes state handling and consistency only.
- **Section contract:** every `<Window>` renders exactly one of loading → error → empty → content. No page invents a fifth state or skips one.
- **Title rule:** `FILENAME.EXT` uppercase; an optional subtitle after ` — ` is a lowercase noun phrase with no closing period.
- **Empty-state voice:** one sentence, no exclamation mark, and one next step when a sensible one exists.
- **Inline styles:** static ones become classes. Genuinely dynamic ones (computed from state) stay inline.
- Every task ends with `npx tsc --noEmit` clean and `npm test` green before its commit. All commands run in `frontend/`.
- Commit directly to `main`. No feature branches. Do not `git push`.

## Deviation from the spec, decided here

The spec lists hook-level tests (unmount discards a pending response, changing the url discards the earlier one). Testing a React hook needs `@testing-library/react` and a jsdom environment, and the same spec rules that adding component-test infrastructure for four sections is disproportionate. Those two statements conflict.

Resolution: the logic that can hold a bug lives in a pure `fetchJson`, which is unit-tested here. `useJson` stays thin enough to read in one screen, and its cancellation behaviour is verified by hand in Task 4. If a future change makes the hook non-trivial, add the test infrastructure then.

---

### Task 1: `fetchJson` and the `useJson` hook

**Files:**
- Create: `frontend/src/lib/fetchJson.ts`
- Create: `frontend/src/lib/fetchJson.test.ts`
- Create: `frontend/src/lib/useJson.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `fetchJson<T>(url: string): Promise<{ ok: true; data: T } | { ok: false }>`
  - `useJson<T>(url: string | null): { data: T | null; error: boolean; loading: boolean; reload: () => void }` — `url === null` means "not ready to fetch yet" (no wallet connected, for instance) and holds the hook in its loading state without issuing a request.

- [x] **Step 1: Write the failing test**

Create `frontend/src/lib/fetchJson.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchJson } from './fetchJson';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function stub(impl: () => Promise<Response> | never) {
  globalThis.fetch = vi.fn(impl) as unknown as typeof fetch;
}

describe('fetchJson', () => {
  it('returns the parsed body on success', async () => {
    stub(async () => new Response(JSON.stringify({ hello: 'world' }), { status: 200 }));
    expect(await fetchJson<{ hello: string }>('/x')).toEqual({ ok: true, data: { hello: 'world' } });
  });

  it('reports failure on a non-ok status instead of returning a body', async () => {
    // /duels and /fame previously ignored status entirely and rendered the
    // empty state, so a 500 looked exactly like "no data yet".
    stub(async () => new Response('nope', { status: 500 }));
    expect(await fetchJson('/x')).toEqual({ ok: false });
  });

  it('reports failure when the request rejects', async () => {
    stub(async () => { throw new Error('offline'); });
    expect(await fetchJson('/x')).toEqual({ ok: false });
  });

  it('reports failure when the body is not valid JSON', async () => {
    stub(async () => new Response('<html>error page</html>', { status: 200 }));
    expect(await fetchJson('/x')).toEqual({ ok: false });
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/fetchJson.test.ts`
Expected: FAIL — cannot resolve `./fetchJson`.

- [x] **Step 3: Write the implementation**

Create `frontend/src/lib/fetchJson.ts`:

```ts
/**
 * One JSON fetch with every failure folded into a single result shape.
 *
 * Pages used to write `fetch(url).then(r => r.json()).then(setState)`, which
 * treats a 500 and an HTML error page as data and drops rejections on the
 * floor. Each of those produced the same symptom: an empty section that never
 * explains itself.
 */
export async function fetchJson<T>(url: string): Promise<{ ok: true; data: T } | { ok: false }> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false };
  }
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/fetchJson.test.ts`
Expected: PASS, 4 tests.

- [x] **Step 5: Write the hook**

Create `frontend/src/lib/useJson.ts`:

```ts
'use client';
import { useCallback, useEffect, useState } from 'react';
import { fetchJson } from './fetchJson';

/**
 * The data half of the section contract: loading, error, or data — never two at
 * once, and never "empty" standing in for "not loaded yet".
 *
 * `url === null` means the caller is not ready (no wallet connected, say): the
 * hook stays in its loading state and issues no request. The cancellation flag
 * is why this exists as one hook rather than three copies: without it, switching
 * wallets could land the previous wallet's response under the new address.
 */
export function useJson<T>(url: string | null): {
  data: T | null; error: boolean; loading: boolean; reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(false);
    setLoading(true);
    if (url === null) return;
    void fetchJson<T>(url).then((r) => {
      if (cancelled) return;
      if (r.ok) setData(r.data); else setError(true);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [url, nonce]);

  return { data, error, loading, reload };
}
```

- [x] **Step 6: Type-check and commit**

```bash
cd frontend && npx tsc --noEmit && npm test
cd /Users/vanhuy/Desktop/celo-game
git add frontend/src/lib/fetchJson.ts frontend/src/lib/fetchJson.test.ts frontend/src/lib/useJson.ts
git commit -m "feat(ui): one fetch helper and one hook for every section's data"
```

---

### Task 2: The three state components

**Files:**
- Create: `frontend/src/components/SectionState.tsx`
- Modify: `frontend/src/app/globals.css`

**Interfaces:**
- Consumes: nothing.
- Produces, all from `@/components/SectionState`:
  - `<Loading as?: 'block' | 'row'; colSpan?: number />`
  - `<Empty line: string; action?: { href: string; label: string }; as?: 'block' | 'row'; colSpan?: number />`
  - `<LoadFailed onRetry: () => void; as?: 'block' | 'row'; colSpan?: number />`

  `as` defaults to `'block'`. A caller inside `<tbody>` passes `as="row"` with a `colSpan`, because a component cannot detect its parent and a `<p>` inside `<tbody>` is invalid HTML that browsers silently relocate.

- [x] **Step 1: Write the components**

Create `frontend/src/components/SectionState.tsx`:

```tsx
import Link from 'next/link';

type Shape = { as?: 'block' | 'row'; colSpan?: number };

/** Wraps children as a paragraph or as a full-width table row, per the caller. */
function Slot({ as = 'block', colSpan = 1, children }: Shape & { children: React.ReactNode }) {
  if (as === 'row') return <tr><td colSpan={colSpan}>{children}</td></tr>;
  return <p className="fineprint">{children}</p>;
}

export function Loading(props: Shape) {
  return <Slot {...props}>Loading…</Slot>;
}

/**
 * An empty section. One sentence, no exclamation mark, and at most one next
 * step — an empty list that offers no way forward is a dead end, and four
 * different phrasings of the same idea read as four different products.
 */
export function Empty({ line, action, ...shape }: Shape & {
  line: string; action?: { href: string; label: string };
}) {
  return (
    <Slot {...shape}>
      {line}
      {action && <> · <Link href={action.href}>{action.label}</Link></>}
    </Slot>
  );
}

export function LoadFailed({ onRetry, ...shape }: Shape & { onRetry: () => void }) {
  return (
    <Slot {...shape}>
      ⚠️ Could not load this. <button onClick={onRetry}>Try again</button>
    </Slot>
  );
}
```

- [x] **Step 2: Add the two utility classes**

In `frontend/src/app/globals.css`, next to the existing `.fineprint` rule:

```css
/* Full-width action button. Replaces eight copies of style={{ width: '100%' }}. */
.btn-block { width: 100%; }
/* One vertical rhythm for stacked blocks, replacing a mix of marginTop 8 and 10. */
.stack { display: flex; flex-direction: column; gap: 8px; }
```

- [x] **Step 3: Type-check and commit**

```bash
cd frontend && npx tsc --noEmit && npm run build
cd /Users/vanhuy/Desktop/celo-game
git add frontend/src/components/SectionState.tsx frontend/src/app/globals.css
git commit -m "feat(ui): shared loading, empty and failed states for sections"
```

Expected: tsc clean; build "Compiled successfully". `LoadFailed` uses `onClick`, so any file importing it must already be a client component — all four call sites are.

---

### Task 3: `/fame` and `/duels` onto the contract

**Files:**
- Modify: `frontend/src/app/fame/page.tsx`
- Modify: `frontend/src/app/duels/page.tsx`

**Interfaces:**
- Consumes: `useJson` (Task 1); `Loading`, `Empty`, `LoadFailed` (Task 2); `aliasFor` from the identity plan.
- Produces: nothing.

- [x] **Step 1: Rewrite the Hall of Fame**

Replace `frontend/src/app/fame/page.tsx`:

```tsx
'use client';
import { Window } from '@/components/Window';
import { Loading, Empty, LoadFailed } from '@/components/SectionState';
import { useJson } from '@/lib/useJson';
import { aliasFor } from '@/lib/alias';

interface Row { address: string; name: string | null; score: number }

export default function FamePage() {
  const { data, error, loading, reload } = useJson<{ scores: Row[] }>('/api/practice');
  const scores = data?.scores ?? [];

  return (
    <main className="desktop">
      <Window title="HALLOFFAME.XLS — best practice runs">
        <table className="ledger">
          <thead><tr><th>#</th><th>Name</th><th>Score</th></tr></thead>
          <tbody>
            {loading && <Loading as="row" colSpan={3} />}
            {error && <LoadFailed as="row" colSpan={3} onRetry={reload} />}
            {!loading && !error && scores.length === 0 && (
              <Empty as="row" colSpan={3} line="No scores yet" action={{ href: '/play', label: 'Play a round' }} />
            )}
            {!loading && !error && scores.map((s, i) => (
              <tr key={s.address}>
                <td>{i + 1}</td>
                <td>{s.name ?? aliasFor(s.address)}</td>
                <td className="win">{s.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="stack">
          <a href="/"><button className="btn-block">Back</button></a>
        </div>
      </Window>
    </main>
  );
}
```

- [x] **Step 2: Move `/duels` onto the hook**

In `frontend/src/app/duels/page.tsx`, delete the `useState` + `useEffect` + `fetch` block and replace it with:

```tsx
const { data, error, loading, reload } = useJson<{ duels: OpenDuel[] }>(
  address ? `/api/duels?viewer=${address}` : '/api/duels',
);
const duels = data?.duels ?? [];
```

Add the imports:

```tsx
import { Loading, Empty, LoadFailed } from '@/components/SectionState';
import { useJson } from '@/lib/useJson';
```

Inside `<tbody>`, replace the current `{duels.length === 0 && <tr><td colSpan={3}>No open duels. Create one!</td></tr>}` with the same three-state block used above:

```tsx
{loading && <Loading as="row" colSpan={3} />}
{error && <LoadFailed as="row" colSpan={3} onRetry={reload} />}
{!loading && !error && duels.length === 0 && (
  <Empty as="row" colSpan={3} line="No open duels" action={{ href: '/duels/new', label: 'Create one' }} />
)}
```

and guard the existing `{duels.map(…)}` with `{!loading && !error && duels.map(…)}`.

- [x] **Step 3: Gates**

Run in `frontend/`: `npx tsc --noEmit && npm test && npx eslint src`
Expected: tsc clean, tests green, no new lint problems.

- [x] **Step 4: Verify by hand**

With the dev server running, at 360×640:
- `/fame` shows "Loading…" first, then either rows or "No scores yet · Play a round" — never the empty line while a request is in flight. Throttle to Slow 3G in DevTools to see it.
- Stop the dev server, reload `/duels`, and confirm the failure renders "⚠️ Could not load this. Try again" instead of an empty table. Restart the server and click Try again — the list appears.

- [x] **Step 5: Commit**

```bash
cd /Users/vanhuy/Desktop/celo-game
git add frontend/src/app/fame/page.tsx frontend/src/app/duels/page.tsx
git commit -m "fix(ui): /fame and /duels stop showing 'empty' while loading or failing"
```

---

### Task 4: `/profile`, titles, and the inline-style sweep

**Files:**
- Modify: `frontend/src/app/profile/page.tsx`
- Modify: `frontend/src/app/duels/new/page.tsx`
- Modify: `frontend/src/app/duels/[id]/page.tsx`
- Modify: `frontend/src/app/play/page.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: nothing.

- [x] **Step 1: Move `/profile` onto the hook**

In `frontend/src/app/profile/page.tsx`, replace the hand-written `load` callback, its `useEffect`, and the `me` / `loadError` state with:

```tsx
const { data: me, error: loadError, loading, reload } = useJson<Me>(
  address ? `/api/me?address=${address}` : null,
);
```

`url === null` while the address is undefined keeps the page in its loading state rather than reporting "nothing unfinished" to a wallet it has not identified yet.

Then replace the three hand-rolled state renders:
- the identity block's `me === null` branch becomes `{loading ? <Loading /> : …}`,
- the `loadError` branch becomes `<LoadFailed onRetry={reload} />`,
- both section empties become
  `<Empty line="Nothing unfinished" action={{ href: '/duels/new', label: 'Start a duel' }} />` and
  `<Empty line="No finished duels yet" />` (no action — none exists).

The rename flow keeps its own `error` / `saved` state; it is a mutation, not a fetch, and `useJson` does not own it. `load()` no longer exists, so both of its call sites move to `reload()`: the rename handler, and the on-load registry sync effect added by the identity plan (Task 8, Step 3).

- [x] **Step 2: Fix the three off-convention titles**

| File | From | To |
|---|---|---|
| `src/app/duels/new/page.tsx` | `NEWDUEL.EXE — your run. Make it count.` | `NEWDUEL.EXE — your run` |
| `src/app/duels/[id]/page.tsx` | `DUEL_${detail.id}.EXE — yours` | `DUEL_${detail.id}.EXE — your duel` |
| `src/app/duels/[id]/page.tsx` | `DUEL.EXE` in the loading phase | `DUEL_${id}.EXE` (the route param is known before the fetch resolves) |

- [x] **Step 3: Replace the static inline styles**

Run `grep -rn "style={{" src/app src/components` and convert, leaving only styles computed from state:

- `style={{ width: '100%' }}` → `className="btn-block"` (8 sites). Where a button already has a class, append: `className="btn-block"` merges by hand into the existing string.
- `style={{ fontSize: 12 }}` → `className="fineprint"` (7 sites). If the element already has a class, append `fineprint` to it.
- `style={{ marginTop: 8 }}` and `style={{ marginTop: 10 }}` → wrap the affected siblings in `<div className="stack">` and drop the margins.

Keep these four, which are genuinely dynamic:
- `style={{ marginBottom: open ? 8 : 0 }}`
- `style={{ flex: 1, fontWeight: t.symbol === token.symbol ? 'bold' : 'normal' }}`
- `style={{ flex: 1, fontWeight: i === tier ? 'bold' : 'normal' }}`
- the error box's `style={{ fontSize: 11, maxHeight: 140, overflowY: 'auto', wordBreak: 'break-word' }}` — a one-off scroll container, not a shared pattern.

- [x] **Step 4: Full gate run**

Run in `frontend/`:

```bash
npx tsc --noEmit && npm test && npx eslint src && npm run build
```

Expected: tsc clean; tests green; no new lint problems; build "Compiled successfully".

Then confirm the sweep actually landed:

```bash
grep -rn "style={{" src/app src/components | wc -l
```

Expected: 4.

- [x] **Step 5: Verify every section by hand**

With the dev server running at a 360×640 viewport, walk all five pages and record what you saw for each: `/`, `/play`, `/duels`, `/fame`, `/profile`.

For each `<Window>`, confirm:
- the title matches the convention (uppercase filename; subtitle, if any, a lowercase noun phrase with no period),
- a slow connection shows "Loading…" and never the empty line (DevTools → Network → Slow 3G),
- with the dev server stopped, the section shows the retry line rather than an empty one,
- empty copy has no exclamation mark and offers a next step where one exists.

Then switch wallets while `/profile` is open and confirm the page does not briefly show the previous wallet's duels — this is the cancellation behaviour that has no automated test.

- [x] **Step 6: Commit**

```bash
cd /Users/vanhuy/Desktop/celo-game
git add frontend/src/app/profile/page.tsx frontend/src/app/duels/new/page.tsx "frontend/src/app/duels/[id]/page.tsx" frontend/src/app/play/page.tsx
git commit -m "fix(ui): one section contract, one title rule, no stray inline styles"
```
