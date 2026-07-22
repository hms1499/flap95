# Section consistency across pages (design)

Date: 2026-07-22
Status: approved
Depends on: `2026-07-22-minipay-identity-design.md` (do that first — it changes
what these sections display)

## Problem

Every page is built from `<Window>` sections, but each page invents its own
handling of the states around the content. The result is not only uneven: two
pages carry the exact bug that was fixed on `/profile` on 2026-07-22.

| Page | Loading | Error | Empty |
|---|---|---|---|
| `/profile` | present, but three different markups **in one file** | retry button | two variants |
| `/duels` | **absent** — renders "No open duels. Create one!" while loading | **absent** — `.then()` with no `.catch()`, a failed fetch fails silently forever | table row |
| `/fame` | **absent** — renders "No scores yet. Be the first." while loading | **absent** — same | table row |
| `/duels/[id]` | phase machine | dialog | n/a |

`/duels` and `/fame` also lack a cancellation flag, so they carry the
wallet-switch race that `/profile` just fixed.

Measured inconsistencies:

- **27 inline styles.** The most repeated are `fontSize: 12` (×7) — while
  `.fineprint { font-size: 12px }` already exists — and `width: '100%'` (×8),
  which has no class at all.
- **Two spacing rhythms for one intent**: `marginTop: 8` (×4) and
  `marginTop: 10` (×3).
- **Three subtitle conventions** in window titles: a noun phrase
  (`— pick your stake`), a possessive (`— yours`), and a full sentence with a
  period (`— your run. Make it count.`). Plus `DUEL.EXE` while loading versus
  `DUEL_12.EXE` once loaded.
- **Four empty-state shapes**: two are table rows, two are paragraphs; two offer
  a next step, one dead-ends ("No finished duels yet."); exclamation marks
  appear in some and not others.

## Decisions (agreed with owner)

- Every `<Window>` renders exactly one of four states: **loading → error →
  empty → content**. No page invents a fifth or skips one.
- The three non-content states come from **shared components**, not per-page
  markup.
- Data fetching for list/detail sections goes through **one hook** that owns
  loading, error and cancellation. Pages stop writing `useEffect` + `fetch` by
  hand.
- Static inline styles become classes. Genuinely dynamic ones stay — a blanket
  ban is dogma, not discipline.
- Window titles follow one written rule.

## The section contract

```tsx
<Window title="HALLOFFAME.XLS">
  {state === 'loading' ? <Loading />
   : state === 'error' ? <LoadFailed onRetry={retry} />
   : rows.length === 0 ? <Empty line="No scores yet" action={{href: '/play', label: 'Play a round'}} />
   : <table className="ledger">…</table>}
</Window>
```

**`useJson<T>(url)`** (`src/lib/useJson.ts`) returns
`{ data, error, loading, reload }` and owns:

- the `cancelled` flag on unmount and on url change (the wallet-switch race),
- `.catch` and non-`ok` responses (today missing on two pages),
- never reporting `data` and `loading` as both settled, so "loading" can never
  be mistaken for "empty" again.

`/duels`, `/fame` and `/profile` all move onto it. Fixing the hook once fixes
three pages, and no page can regress by hand-rolling the effect again.

**`<Loading />`** — one markup, replacing the three variants now in
`profile/page.tsx` alone (lines 134, 171, 199).

**`<Empty line action? as? colSpan? />`** — one sentence, no exclamation mark,
and at most one next step. `as` defaults to `'block'` (a `<p>`); a table passes
`as="row" colSpan={3}` and gets a `<tr><td colSpan>`. The prop exists because a
component cannot detect its parent element, and rendering a `<p>` inside
`<tbody>` is invalid HTML that browsers silently relocate.

**`<LoadFailed onRetry />`** — the pattern `/profile` already has, made
available to the pages that have nothing.

## Title convention

`FILENAME.EXT` in uppercase. An optional subtitle follows ` — ` and is a
**lowercase noun phrase with no closing period**.

| Now | After |
|---|---|
| `NEWDUEL.EXE — your run. Make it count.` | `NEWDUEL.EXE — your run` |
| `DUEL_12.EXE — yours` | `DUEL_12.EXE — your duel` |
| `DUEL.EXE` (loading, id known) | `DUEL_12.EXE` |

## Typography and spacing

- `style={{ fontSize: 12 }}` → `className="fineprint"` (7 sites).
- `style={{ width: '100%' }}` → new `.btn-block` (8 sites).
- `marginTop: 8` and `marginTop: 10` → one 8px rhythm, expressed as a `.stack`
  gap on the container rather than per-child margins.
- Kept as inline: the four dynamic styles (`fontWeight` by selected tier,
  `marginBottom` by open state, the scrollable error box's computed bounds).

## Empty-state voice

One sentence, no exclamation mark, and a next step when a sensible one exists.

| Now | After |
|---|---|
| `No scores yet. Be the first.` | `No scores yet` + action "Play a round" |
| `No open duels. Create one!` | `No open duels` + action "Create one" |
| `Nothing unfinished. Start a duel.` | `Nothing unfinished` + action "Start a duel" |
| `No finished duels yet.` | `No finished duels yet` (no action — none exists) |

## Scope

In: `src/lib/useJson.ts`, `src/components/Loading.tsx`,
`src/components/Empty.tsx`, `src/components/LoadFailed.tsx`, and the four pages
(`/duels`, `/fame`, `/profile`, `/duels/[id]` titles only), plus `globals.css`
for `.btn-block` and `.stack`.

Out: the duel page's phase machine (it is a genuine state machine over a
transaction flow, not a fetch — it keeps its own shape); the game canvas; any
visual redesign. The Windows 95 identity is deliberately untouched.

## Testing

- `useJson`: resolves to data; a non-`ok` response sets error and not data; a
  rejected fetch sets error; unmounting before resolution does not set state;
  changing the url discards the earlier response. Fetch is stubbed — these are
  unit tests, not integration.
- A rendering check per page is not proposed: there is no component-test setup
  in this repo, and adding one for four sections is disproportionate. Verify the
  four pages by hand in the browser at 360×640 and record what was seen.

## Risks

1. These three pages are also touched by the identity spec. Doing identity
   first means touching them twice, but the second pass is cosmetic and cheap;
   the reverse order would mean rebuilding sections around content that then
   changes.
2. `useJson` is a shared abstraction introduced for three call sites. That is
   the right number to justify it — but if a fourth caller needs materially
   different behaviour, extend it deliberately rather than adding options for
   hypothetical cases.
