# Profile Mobile UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/profile` usable — and listable — at MiniPay's 360×640 minimum by removing the horizontal overflow, the dead tab stops, the iOS zoom trap, and the inverted information hierarchy.

**Architecture:** Five independent changes, each self-contained and separately revertable. Two are single-line CSS rules in `globals.css`, one is markup in the shared `Window` component, one restructures `/profile`'s section order, and one changes the `.ledger` row into a single tappable link. No new runtime dependencies and no change to the 98.css visual language.

**Tech Stack:** Next.js 16 (App Router, Turbopack, React 19 + React Compiler), 98.css 0.1.21, plain CSS in `src/app/globals.css`, vitest (node environment).

## Global Constraints

- **Minimum viewport 360×640.** `document.documentElement.scrollWidth` must be `<= 360` at that size on every route. The body must never scroll horizontally. This is a hard MiniPay listing requirement.
- **No new runtime dependencies.** MiniPay Mini Apps have a 2MB footprint budget. devDependencies are acceptable (Task 6 only).
- **MiniPay copy rules.** In user-facing strings: never "gas"/"gas fee" (use **Network fee**), never "crypto" (use **stablecoin**), never "onramp"/"offramp" (use **Deposit**/**Withdraw**). Code identifiers (`feeCurrency`, `gasEstimate`) are unaffected.
- **Never display CELO** in the UI. Only USDT / USDC / USDm.
- **Preserve the 98.css aesthetic.** No new animation libraries, no rounded corners, no drop shadows outside the existing bevel system. Accent tokens live in `:root` in `globals.css` and must be reused, not redefined.
- **Gates, run from `frontend/`, after every task:**
  - `npx vitest run` → 158 passed (19 files)
  - `npx tsc --noEmit` → no output
  - `npx eslint` → **12 problems (11 errors, 1 warning)** — this is the accepted baseline. More than 12 means the task introduced a regression.
  - `npx next build` → `✓ Compiled successfully`
- **Commit after each task.** Solo project, commit straight to `main`, no feature branches. Do not push without explicit instruction.

## Measurement Harness (used by several tasks)

Several tasks verify layout in a real browser, because `scrollWidth` needs a layout engine and the repo has no DOM test harness. Where a task says "measure", use this procedure:

1. `npx next dev` from `frontend/`
2. Open `http://localhost:3000<path>` in a browser at exactly **360×640** (Chrome DevTools device toolbar → Responsive → 360×640)
3. `/profile` needs a connected wallet. In the DevTools console, before clicking "Connect wallet":

```js
window.ethereum = {
  isMetaMask: true,
  request: async ({ method }) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts')
      return ['0x66f744Af7b1D1218031c83cB2c62EBa7E6138eD8'];
    if (method === 'eth_chainId') return '0xa4ec';
    if (method === 'net_version') return '42220';
    return null;
  },
  on: () => {}, removeListener: () => {},
};
```

4. Then run the assertion given in the task.

**Baseline before any of this work (measured 2026-07-24):** `/profile` `scrollWidth` = **374px** against a 360px viewport.

---

### Task 1: Take the decorative title-bar controls out of the tab order

Every `Window` renders three real `<button>` elements with `aria-label="Minimize|Maximize|Close"` and no `onClick`. `/profile` renders three Windows, so a keyboard or screen-reader user moves through **nine** controls that announce as actionable and do nothing. They are pure 98.css decoration.

**Files:**
- Modify: `frontend/src/components/Window.tsx:8-12`

**Interfaces:**
- Consumes: nothing.
- Produces: no API change. `Window({ title, children, className })` keeps its exact signature.

- [ ] **Step 1: Measure the current dead tab stops**

Start the dev server and open `http://localhost:3000/duels` (no wallet needed). In the console:

```js
[...document.querySelectorAll('.title-bar-controls button')]
  .filter(b => b.tabIndex >= 0 && !b.onclick).length
```

Expected: `3` (one Window on `/duels`). This is the number the task drives to `0`.

- [ ] **Step 2: Make the controls presentational**

Replace the `title-bar-controls` block in `frontend/src/components/Window.tsx`:

```tsx
        <div className="title-bar-controls" aria-hidden="true">
          <button aria-label="Minimize" tabIndex={-1} />
          <button aria-label="Maximize" tabIndex={-1} />
          <button aria-label="Close" tabIndex={-1} />
        </div>
```

The `aria-label` attributes stay: 98.css selects the glyph for each button with `[aria-label=Minimize]` etc., so removing them removes the icons. `aria-hidden` on the wrapper keeps them out of the accessibility tree anyway, and `tabIndex={-1}` keeps them out of the tab order.

- [ ] **Step 3: Re-measure**

Reload `http://localhost:3000/duels` and run the Step 1 snippet again.
Expected: `0`.

Also confirm the icons still render: the three buttons in the title bar must still show the minimise bar, the maximise box, and the close cross.

- [ ] **Step 4: Run the gates**

```bash
cd frontend && npx vitest run && npx tsc --noEmit && npx eslint && npx next build
```

Expected: 158 passed, no tsc output, 12 eslint problems, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Window.tsx
git commit -m "fix(a11y): keep the decorative window controls out of the tab order"
```

---

### Task 2: Let ledger cells wrap

98.css ships `table { white-space: nowrap }`. That is the actual mechanism behind the 374px overflow: the duel subtitle (`Waiting for an opponent · vs nobody yet`) cannot break, so the first column's minimum width is the full length of that string. Dropping a column (Task 3) does not help while the text still cannot wrap — **this task must land before Task 3 to see the benefit, and it is the larger half of the fix.**

`/duels` happens not to overflow today only because its subtitle is shorter; a long opponent name breaks it too. Fixing the rule centrally covers every `.ledger`.

**Files:**
- Modify: `frontend/src/app/globals.css:274-280` (the `table.ledger` block)

**Interfaces:**
- Consumes: nothing.
- Produces: `.ledger` cells wrap. Later tasks assume this.

- [ ] **Step 1: Measure the overflow**

With the dev server running, open `/profile` at 360×640 with the wallet stub from the Measurement Harness. In the console:

```js
document.documentElement.scrollWidth
```

Expected: `374` — larger than the 360 viewport.

- [ ] **Step 2: Add the wrap rule**

In `frontend/src/app/globals.css`, immediately after the existing `table.ledger td:last-child` rule (line 280), add:

```css
/* 98.css sets `table { white-space: nowrap }` for authenticity. In the ledger
   that turned a duel's subtitle into one unbreakable line, so the first column's
   minimum width was the length of that string and /profile scrolled sideways at
   360px — MiniPay's minimum. Cells wrap; the stake column keeps nowrap so an
   amount never splits across lines. */
table.ledger td { white-space: normal; }
table.ledger td.stake { white-space: nowrap; }
```

- [ ] **Step 3: Re-measure**

Reload `/profile` at 360×640 with the wallet stub.

```js
document.documentElement.scrollWidth
```

Expected: `<= 360`.

Also check `/duels` and `/fame` at 360×640 — both must report `<= 360`.

- [ ] **Step 4: Run the gates**

```bash
cd frontend && npx vitest run && npx tsc --noEmit && npx eslint && npx next build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/globals.css
git commit -m "fix(ui): let ledger cells wrap so /profile fits 360px"
```

---

### Task 3: Make the whole ledger row the link

The only way into a duel is a button measuring **56×15px** — far under the 44×44 guidance, and on `/profile` it needs a third table column that costs horizontal room. Turning the first cell into a full-height link removes the column and gives a ~44px target in one change.

**Files:**
- Modify: `frontend/src/app/globals.css` (append after the `table.ledger` block from Task 2)
- Modify: `frontend/src/app/profile/page.tsx` — the `UNFINISHED.LST` table
- Modify: `frontend/src/app/duels/page.tsx:28-50`

**Interfaces:**
- Consumes: `table.ledger td { white-space: normal }` from Task 2.
- Produces: CSS class `.rowlink` — a column flex link with `min-height: 44px`. Task 4 reuses nothing from here.

- [ ] **Step 1: Measure the current target**

On `/profile` at 360×640 with the wallet stub:

```js
[...document.querySelectorAll('td a button')].map(b => {
  const r = b.getBoundingClientRect();
  return `${b.textContent} ${Math.round(r.width)}x${Math.round(r.height)}`;
});
```

Expected: entries like `"Open 56x15"`.

- [ ] **Step 2: Add the row-link style**

Append to `frontend/src/app/globals.css` after the `table.ledger` rules:

```css
/* The row is the target. A duel used to be reachable only through a 56x15
   button, which is under half the 44px minimum for touch. Stacking the title
   and subtitle inside one link makes the whole cell tappable and frees the
   column the button needed. */
.rowlink {
  display: flex; flex-direction: column; justify-content: center; gap: 2px;
  min-height: 44px; color: inherit; text-decoration: none;
}
.rowlink:hover, .rowlink:focus-visible { text-decoration: underline; }
```

- [ ] **Step 3: Rewrite the UNFINISHED.LST table**

In `frontend/src/app/profile/page.tsx`, replace the `UNFINISHED.LST` table with:

```tsx
            <table className="ledger">
              <thead><tr><th>Duel</th><th>Stake</th></tr></thead>
              <tbody>
                {me.active.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link className="rowlink" href={`/duels/${d.id}`}>
                        <span>⚔️ duel_{d.id}.exe</span>
                        <small className={d.status === 'funded' ? 'win' : undefined}>
                          {activeLabel(d.status, Date.parse(d.createdAt), now)} · vs {opponentOf(d) ?? 'nobody yet'}
                        </small>
                      </Link>
                    </td>
                    <td className="stake">{formatStake(d.stakeWei, d.token)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
```

- [ ] **Step 4: Rewrite the /duels table**

In `frontend/src/app/duels/page.tsx`, change the header row and the three `colSpan={3}` state rows to `2`, and replace the mapped row. The `mine` flag no longer picks a button label — `who` already reads `yours` for your own duels, so the distinction survives:

```tsx
          <table className="ledger">
            <thead><tr><th>Duel</th><th>Stake</th></tr></thead>
            <tbody>
              {loading && <Loading as="row" colSpan={2} />}
              {error && <LoadFailed as="row" colSpan={2} onRetry={reload} />}
              {!loading && !error && duels.length === 0 && (
                <Empty as="row" colSpan={2} line="No open duels" action={{ href: '/duels/new', label: 'Create one' }} />
              )}
              {!loading && !error && duels.map((d) => {
                const mine = viewerRole(address, d.creator, null) === 'creator';
                const left = now === null ? null : timeLeft(Date.parse(d.createdAt), now);
                const who = mine ? 'yours' : `${displayName(names, d.creator)}${d.challengeTo ? ' · rematch' : ''}`;
                return (
                  <tr key={d.id}>
                    <td>
                      <Link className="rowlink" href={`/duels/${d.id}`}>
                        <span>⚔️ duel_{d.id}.exe</span>
                        <small>{who}{left && ` · ${left.expired ? 'expired' : `${left.label} left`}`}</small>
                      </Link>
                    </td>
                    <td className="stake">{formatStake(d.stakeWei, d.token)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
```

- [ ] **Step 5: Re-measure**

On `/profile` at 360×640 with the wallet stub:

```js
({
  scrollWidth: document.documentElement.scrollWidth,
  rowTargets: [...document.querySelectorAll('.rowlink')].map(a => {
    const r = a.getBoundingClientRect();
    return `${Math.round(r.width)}x${Math.round(r.height)}`;
  }),
})
```

Expected: `scrollWidth <= 360`, and every `.rowlink` at least 44px tall.

Click a row and confirm it navigates to `/duels/<id>`. Repeat both checks on `/duels`.

- [ ] **Step 6: Run the gates**

```bash
cd frontend && npx vitest run && npx tsc --noEmit && npx eslint && npx next build
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/globals.css frontend/src/app/profile/page.tsx frontend/src/app/duels/page.tsx
git commit -m "fix(ui): make the whole ledger row the duel's tap target"
```

---

### Task 4: Stop iOS zooming the page on the rename field

98.css sets `font-size: 11px` on `input`. iOS Safari zooms the viewport whenever a focused form field is under 16px, so tapping the rename field jumps the whole page. Raising it only for coarse pointers fixes touch without changing the desktop look.

**Files:**
- Modify: `frontend/src/app/globals.css` (append near the other form rules)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks read.

- [ ] **Step 1: Confirm the current size**

On `/profile` at 360×640 with the wallet stub:

```js
getComputedStyle(document.querySelector('input')).fontSize
```

Expected: `"11px"` — under the 16px threshold.

- [ ] **Step 2: Add the coarse-pointer rule**

Append to `frontend/src/app/globals.css`:

```css
/* iOS Safari zooms the viewport when a focused field is under 16px, which made
   tapping the rename box jump the whole page. Scoped to coarse pointers so the
   11px 98.css control keeps its proportions with a mouse. */
@media (pointer: coarse) {
  input, select, textarea { font-size: 16px; }
}
```

- [ ] **Step 3: Verify**

In Chrome DevTools device toolbar (which reports a coarse pointer), reload `/profile` at 360×640 with the wallet stub:

```js
getComputedStyle(document.querySelector('input')).fontSize
```

Expected: `"16px"`.

Then confirm `scrollWidth` is still `<= 360` — the larger field must not reintroduce overflow.

- [ ] **Step 4: Run the gates**

```bash
cd frontend && npx vitest run && npx tsc --noEmit && npx eslint && npx next build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/globals.css
git commit -m "fix(ui): stop iOS zooming when the rename field takes focus"
```

---

### Task 5: Put the money above the settings

The comment at `frontend/src/app/profile/page.tsx` says the page "exists to tell people they have money stuck in escrow", but `UNFINISHED.LST` sits below a rename form most people use once. This task splits the rename form into its own `RENAME.EXE` window at the bottom, leaving `PROFILE.EXE` as identity only.

Final order: **PROFILE.EXE** (name + address) → **UNFINISHED.LST** → **HISTORY.LOG** → **RENAME.EXE**.

**Files:**
- Modify: `frontend/src/app/profile/page.tsx` — the returned JSX only. No state, no handlers, no `rename()` logic changes.

**Interfaces:**
- Consumes: `Window` from Task 1, `.rowlink` markup from Task 3.
- Produces: nothing later tasks read.

- [ ] **Step 1: Move the rename fieldset into its own Window**

In the returned JSX, `PROFILE.EXE`'s data branch becomes identity only:

```tsx
          <>
            <p>👤 <b>{me.name ?? aliasFor(address ?? '')}</b></p>
            <p className="mono fineprint">{address}</p>
          </>
```

Then, after the `HISTORY.LOG` window and before the closing `</main>`, add:

```tsx
      {!loadError && me && (
        <Window title="RENAME.EXE">
          <fieldset>
            <legend>{me.name ? 'Change your name' : 'Pick your name'}</legend>
            <div className="row">
              <input
                placeholder="New name" value={draftName} maxLength={16} disabled={busy}
                // Clear both notices: "Saved." under a half-typed new name claims
                // something that has not happened yet. Mid-flight the keystroke is
                // ignored instead — the transaction is already broadcast.
                onChange={(e) => {
                  setDraftName(e.target.value);
                  setPhase((p) => nextPhase(p, 'edit'));
                  setError(null);
                }}
              />
              <button onClick={rename} disabled={busy || !draftName.trim()}>Save name</button>
            </div>
            {step !== null && (
              <TxProgress title="Saving your name" steps={RENAME_STEPS} active={step} />
            )}
            {phase === 'done' && <p className="fineprint win">✓ Saved.</p>}
            {error && <p className="fineprint">⚠️ {error}</p>}
            <p className="fineprint">
              Your scores follow your wallet, so renaming keeps them. Setting a name is a
              transaction — the network fee is paid in USDm. Your old name becomes free for
              anyone else to take.
            </p>
          </fieldset>
        </Window>
      )}
```

The `me &&` guard matters: the fieldset reads `me.name` for its legend, and `me` is `null` while the first load is in flight.

- [ ] **Step 2: Verify the order and that renaming still works**

Reload `/profile` at 360×640 with the wallet stub. Confirm the four windows appear in order: `PROFILE.EXE`, `UNFINISHED.LST`, `HISTORY.LOG`, `RENAME.EXE`.

```js
[...document.querySelectorAll('.title-bar-text')].map(e => e.textContent)
```

Expected: `["PROFILE.EXE", "UNFINISHED.LST", "HISTORY.LOG", "RENAME.EXE"]`

Then check `document.documentElement.scrollWidth <= 360`.

A full rename needs a real wallet and costs a real network fee, so it is not part of this step. Verify only that the field accepts input and the button enables when the field is non-empty.

- [ ] **Step 3: Run the gates**

```bash
cd frontend && npx vitest run && npx tsc --noEmit && npx eslint && npx next build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/profile/page.tsx
git commit -m "feat(profile): lead with unfinished duels, not the rename form"
```

---

### Task 6 (optional but recommended): A layout guard that fails the build

Every problem in this plan is invisible to the current test suite: 158 tests run in `environment: 'node'`, which has no layout engine, so nothing can measure `scrollWidth`. The 374px overflow shipped for exactly that reason — the refactor that introduced it was gated on `grep -c 'style={{'`.

This task adds one Playwright check. It is a **devDependency**, so it does not touch the MiniPay bundle budget.

**Files:**
- Create: `frontend/e2e/layout.spec.ts`
- Create: `frontend/playwright.config.ts`
- Modify: `frontend/package.json` (add `@playwright/test` to devDependencies and a `test:e2e` script)

**Interfaces:**
- Consumes: the routes fixed in Tasks 2–5.
- Produces: `npm run test:e2e`.

- [ ] **Step 1: Install Playwright**

```bash
cd frontend && npm i -D @playwright/test && npx playwright install chromium
```

- [ ] **Step 2: Write the config**

Create `frontend/playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:3000', viewport: { width: 360, height: 640 } },
  webServer: { command: 'npm run dev', url: 'http://localhost:3000', reuseExistingServer: true },
});
```

- [ ] **Step 3: Write the failing test**

Create `frontend/e2e/layout.spec.ts`. `/profile` is covered through the wallet stub; the other two need no wallet:

```ts
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

test('/profile does not scroll sideways at 360px', async ({ page }) => {
  await page.addInitScript(STUB);
  await page.goto('/profile');
  await page.getByRole('button', { name: /connect wallet/i }).click();
  await expect(page.getByText('UNFINISHED.LST')).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(360);
});
```

- [ ] **Step 4: Prove the test can fail**

Temporarily revert Task 2's wrap rule by commenting out `table.ledger td { white-space: normal; }` in `globals.css`, then:

```bash
cd frontend && npx playwright test
```

Expected: the `/profile` test FAILS with `Expected: <= 360, Received: 374`. Restore the rule and re-run — all tests pass. **Do not skip this step**: a layout test that has never failed proves nothing.

- [ ] **Step 5: Add the script**

In `frontend/package.json`, add to `scripts`:

```json
    "test:e2e": "playwright test"
```

- [ ] **Step 6: Run everything**

```bash
cd frontend && npx vitest run && npx tsc --noEmit && npx eslint && npm run test:e2e && npx next build
```

- [ ] **Step 7: Commit**

```bash
git add frontend/e2e frontend/playwright.config.ts frontend/package.json frontend/package-lock.json
git commit -m "test(e2e): guard the 360px floor that the node suite cannot see"
```

---

## Out of Scope

Deliberately excluded, recorded so they are not silently dropped:

- **The `tx` link on `HISTORY.LOG` is 16×15px.** Still under the 44px guidance after this plan. Fixing it means restructuring the Result cell, which fights the ledger layout Task 3 just settled. Worth its own pass.
- **The raw `0x…` address on `/profile`.** MiniPay's guidance is not to use an address as the primary identifier. It is secondary here (below the name), so it is not a violation, but it costs a full 314px monospace line. Truncating it is a copy decision, not a bug fix.
- **The root cause of the stale header after a rename.** Investigated on 2026-07-24 and never resolved; the symptom was removed with the best-score display in `c8c57a6`. The name still renders from the same `me` object, so it can resurface.
- **`/fame` and `/duels` beyond the shared `.ledger` fixes.** Tasks 2 and 3 touch them only where the shared table pattern demands it.
