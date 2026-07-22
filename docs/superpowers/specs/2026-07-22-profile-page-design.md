# Profile page (design)

Date: 2026-07-22
Status: approved

## Problem

Two gaps, both found while reviewing the wallet-username work
([2026-07-22-wallet-username-design.md](2026-07-22-wallet-username-design.md)):

1. **Renaming has an API but no way in.** `POST /api/profile` supports
   renaming, but `play/page.tsx` only renders the name input when the wallet
   has *no* profile yet. Once a name is set, nothing in the UI can change it —
   so the approved spec's "a wallet may rename freely" is unimplemented.
2. **Finished duels vanish.** `listOpenDuels` returns only `status = 'open'`
   rows from the last 24 hours, so once a duel settles it disappears from
   the app entirely; the only way back is a saved `/duels/<id>` URL. Worse,
   a duel that was **funded but never finished** has real money sitting in
   escrow with no discovery path at all.

A single `/profile` page fixes both.

## Decisions (agreed with owner)

- **Private only.** One route, `/profile`, rendered for the connected
  wallet. No public `/profile/0x…` view in this scope.
- **Two duel sections**: unfinished (needs action) above, finished history
  below.
- **Renaming stays free**, and the old name is **released immediately** for
  anyone to claim. Accepted risk: a squatter can take a released name, but
  scores are keyed by wallet, so they must earn a top-20 score themselves
  before that name appears on the leaderboard.

## Hard constraint: do not leak in-progress scores

`listOpenDuels` deliberately selects `null as creator_taps, null as
creator_score, …` — an acceptor must not see the creator's score before
playing ("no sniping"). **The new query must null the same columns for every
duel that is not `settled`.** This is the single most dangerous thing to get
wrong here, because a leak would be silent: the page would look correct
while handing an opponent's score to the person about to play against it.

## Data

No schema change. No new tables. Two new store functions.

In `src/lib/profileStore.ts`:

```
getBestScore(address: string): Promise<number | null>
```

Reads the wallet's row from `practice_best`; `null` when it has never saved
a score.

In `src/lib/duelStore.ts`:

```
listDuelsForAddress(address: string): Promise<DuelRow[]>
```

- `where creator = ${addr} or acceptor = ${addr}`, address lowercased by the
  caller, `order by created_at desc limit 100`.
- Selects `null` for `creator_taps`, `creator_score`, `acceptor_taps`,
  `acceptor_score` **unless** `status = 'settled'`, per the constraint above.

## Splitting statuses

A pure function in a new file `src/lib/profileDuels.ts`, unit-tested, kept
separate from SQL so it can be tested without a database:

```
splitDuels(rows: DuelRow[]): { active: DuelRow[]; history: DuelRow[] }
```

- `active`: `funded | open | accepted | settling`
- `history`: `settled | cancelled`
- `draft` is **dropped entirely** — a draft was created but never funded, so
  no money is at stake and there is nothing to act on.

## API

`GET /api/me?address=0x…` → `200 { name, bestScore, active, history }`

- Validates the address against `/^0x[0-9a-fA-F]{40}$/`; `400 bad input`
  otherwise. Lowercases before querying.
- `name` from `getName` (null when the wallet has no profile), `bestScore`
  from a new `getBestScore(address)` in `profileStore` (null when none).
- `active` / `history` from `splitDuels(listDuelsForAddress(addr))`, each row
  reduced to what the page renders: `id`, `status`, `stakeWei`, `token`,
  `creator`, `acceptor`, `winner`, `settleTx`, `createdAt`.

**No signature required.** Duel data is already public — `/duels/<id>` is
readable by anyone with the link and the escrow is on-chain — so demanding a
wallet popup to view your own page is a bad trade. The accepted consequence:
anyone who knows an address can read that wallet's duel history.

Renaming reuses the existing, already-reviewed `POST /api/profile`. No new
write endpoint.

## Page

`/profile`, a client component gated on the connected wallet. Not connected →
a Connect button and nothing else.

**Identity block.** Current name, wallet address, best practice score, and a
rename form (input + Save, one signature). `409` → "That name is taken — pick
another." Reuses `normalizeName` for client-side validation before signing,
exactly as the play page does.

**Unfinished block.** One row per active duel: status label, stake, and a
link to `/duels/<id>`. Rows with status `funded` are visually emphasised and
labelled as needing the creator to finish their run — this is the money-in-
escrow case that currently has no discovery path.

**History block.** Opponent name, stake, outcome, and a link to
`https://celoscan.io/tx/<settleTx>` when present. Outcome is derived from
the existing `viewerRole` helper plus the row's `winner` field — no new
logic. `cancelled` rows have no winner and no opponent; they render as
"refunded" and are excluded from the win–loss tally. A summary line gives
the overall record across `settled` rows only.

Opponent names use the existing `useNames` hook, falling back to a shortened
address.

**Navigation.** A "Profile" entry is added to `NAV` in `Shell.tsx`.

**Empty states.** No duels → a line pointing at `/duels/new`. No profile name
yet → the rename form doubles as the set-name form.

## Errors

- `400 bad input` — malformed or missing address.
- Rename errors reuse the existing mapping: `400 bad_name`, `401 stale |
  bad_signature`, `409 name_taken`.
- A failed `/api/me` fetch shows a retry line rather than an empty page.

## Testing

- `splitDuels` — unit tests: each status routed correctly, `draft` dropped,
  empty input.
- **A test that proves in-progress scores stay hidden.** Exercise
  `/api/me` end-to-end against seeded rows in a non-settled state and assert
  no score or taps field comes back, mirroring how Task 5 of the username
  plan was verified. This is the constraint most likely to regress silently.
- Store SQL follows repo convention (no unit tests); verified by the e2e
  pass above.
- The rename flow is checked manually in the browser, as with the play page.

## Out of scope

- Public profiles (`/profile/0x…`).
- Reserving or blocklisting released names.
- Rename cooldowns.
- Pagination beyond the 100-row cap.
