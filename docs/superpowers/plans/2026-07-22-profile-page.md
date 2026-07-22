# Profile Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a private `/profile` page where the connected wallet can rename itself and see its own unfinished and finished duels.

**Architecture:** One new read endpoint (`GET /api/me`) returns everything the page needs in a single round trip; renaming reuses the existing, already-reviewed `POST /api/profile`. Status splitting lives in a pure, unit-tested module (`profileDuels.ts`) kept out of the SQL layer. No schema change.

**Tech Stack:** Next.js 16 route handlers and client components, wagmi 3.x (`useAccount`, `useConnect`, `useSignMessage`), viem, Neon serverless Postgres, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-22-profile-page-design.md`

## Global Constraints

- All paths are relative to `frontend/` unless they start with `docs/`.
- This repo's Next.js has breaking changes vs. training data (see `frontend/AGENTS.md`). Follow existing route/page files as the pattern.
- **HARD CONSTRAINT — never leak in-progress scores.** `listOpenDuels` already selects `null as creator_taps, null as creator_score, …` so an acceptor cannot see the creator's score before playing. The new query must be at least as strict. This plan tightens it further: the new query nulls **all four** taps/score columns unconditionally, and `/api/me` maps only an explicit field list that contains no score at all. Two independent layers; neither may be removed.
- Addresses are stored and queried lowercase; the route lowercases before hitting the store.
- Status routing: `active` = `funded | open | accepted | settling`; `history` = `settled | cancelled`; `draft` is dropped entirely.
- Released names stay claimable — no reservation logic anywhere.
- Commit directly to `main` (solo-repo convention). Never `git push`.
- Gates: `npx tsc --noEmit`, `npm test`, `npm run lint`, `npm run build`. Lint baseline is **11 problems (10 errors, 1 warning)** in pre-existing files — a task may not add new ones except where this plan says so explicitly.
- End every commit message with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `splitDuels` — pure status routing

**Files:**
- Create: `src/lib/profileDuels.ts`
- Test: `src/lib/profileDuels.test.ts`

**Interfaces:**
- Consumes: `DuelRow` (type only) from `./duelStore`.
- Produces: `splitDuels(rows: readonly DuelRow[]): { active: DuelRow[]; history: DuelRow[] }`, plus the exported constants `ACTIVE_STATUSES` and `HISTORY_STATUSES`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/profileDuels.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { splitDuels } from './profileDuels';
import type { DuelRow } from './duelStore';

function row(id: number, status: DuelRow['status']): DuelRow {
  return {
    id, onchainId: null, seed: 1, stakeWei: null, token: null,
    creator: '0xaaa', acceptor: null, status,
    creatorScore: null, acceptorScore: null, creatorDeathTick: null, acceptorDeathTick: null,
    creatorTaps: null, acceptorTaps: null, challengeTo: null, winner: null, settleTx: null,
    createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z',
  };
}

describe('splitDuels', () => {
  it('routes every unfinished status to active', () => {
    const { active, history } = splitDuels([
      row(1, 'funded'), row(2, 'open'), row(3, 'accepted'), row(4, 'settling'),
    ]);
    expect(active.map((d) => d.id)).toEqual([1, 2, 3, 4]);
    expect(history).toEqual([]);
  });

  it('routes finished statuses to history', () => {
    const { active, history } = splitDuels([row(5, 'settled'), row(6, 'cancelled')]);
    expect(history.map((d) => d.id)).toEqual([5, 6]);
    expect(active).toEqual([]);
  });

  it('drops drafts entirely — no money is at stake in one', () => {
    const { active, history } = splitDuels([row(7, 'draft'), row(8, 'open')]);
    expect(active.map((d) => d.id)).toEqual([8]);
    expect(history).toEqual([]);
  });

  it('preserves input order within each group', () => {
    const { active } = splitDuels([row(3, 'open'), row(1, 'funded'), row(2, 'accepted')]);
    expect(active.map((d) => d.id)).toEqual([3, 1, 2]);
  });

  it('handles an empty list', () => {
    expect(splitDuels([])).toEqual({ active: [], history: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/lib/profileDuels.test.ts`
Expected: FAIL — cannot resolve `./profileDuels`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/profileDuels.ts`:

```ts
import type { DuelRow } from './duelStore';

/** Unfinished duels the player may still need to act on. */
export const ACTIVE_STATUSES = ['funded', 'open', 'accepted', 'settling'] as const;
/** Duels that are over, one way or another. */
export const HISTORY_STATUSES = ['settled', 'cancelled'] as const;

/**
 * Splits a wallet's duels for the profile page. `draft` rows are dropped:
 * a draft was never funded, so there is no stake and nothing to act on.
 */
export function splitDuels(rows: readonly DuelRow[]): { active: DuelRow[]; history: DuelRow[] } {
  const active: DuelRow[] = [];
  const history: DuelRow[] = [];
  for (const r of rows) {
    if ((ACTIVE_STATUSES as readonly string[]).includes(r.status)) active.push(r);
    else if ((HISTORY_STATUSES as readonly string[]).includes(r.status)) history.push(r);
  }
  return { active, history };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- src/lib/profileDuels.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/profileDuels.ts frontend/src/lib/profileDuels.test.ts
git commit -m "feat(profile): split a wallet's duels into active and history

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Store queries

SQL functions follow this repo's convention of no unit tests (no test DB); Task 3's e2e exercises them.

**Files:**
- Modify: `src/lib/profileStore.ts` (append one function)
- Modify: `src/lib/duelStore.ts` (append one function at the end)

**Interfaces:**
- Consumes: `sql` from `./db`; `toRow` (already private in `duelStore.ts`); `DuelRow`.
- Produces:
  - `getBestScore(address: string): Promise<number | null>` from `@/lib/profileStore`
  - `listDuelsForAddress(address: string): Promise<DuelRow[]>` from `@/lib/duelStore`
  - Both take an **already-lowercased** address.

- [ ] **Step 1: Append `getBestScore` to `src/lib/profileStore.ts`**

```ts
export async function getBestScore(address: string): Promise<number | null> {
  const rows = await sql`select score from practice_best where address = ${address}`;
  return rows.length ? Number(rows[0].score) : null;
}
```

- [ ] **Step 2: Append `listDuelsForAddress` to the end of `src/lib/duelStore.ts`**

```ts
/**
 * Every duel a wallet took part in, newest first.
 *
 * Taps and scores are nulled for EVERY row, not just unfinished ones: the
 * profile page renders outcomes from `winner`, never from scores, so there is
 * no reason to put an opponent's score on the wire. Keeping this
 * unconditional means the no-sniping rule cannot regress by someone editing a
 * status condition.
 */
export async function listDuelsForAddress(address: string): Promise<DuelRow[]> {
  const rows = await sql`
    select id, onchain_id, seed, stake_wei, token, creator, acceptor, status, challenge_to, winner,
           settle_tx, created_at, updated_at,
           null as creator_taps, null as creator_score, null as acceptor_taps, null as acceptor_score
    from duels
    where creator = ${address} or acceptor = ${address}
    order by created_at desc limit 100`;
  return rows.map(toRow);
}
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit && npm test`
Expected: no errors; all tests pass (106 + Task 1's 5 = 111).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/profileStore.ts frontend/src/lib/duelStore.ts
git commit -m "feat(profile): store queries for best score and a wallet's duels

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `GET /api/me` + proof that scores never leak

**Files:**
- Create: `src/app/api/me/route.ts`

**Interfaces:**
- Consumes: `getName`, `getBestScore` from `@/lib/profileStore`; `listDuelsForAddress` from `@/lib/duelStore`; `splitDuels` from `@/lib/profileDuels`.
- Produces (HTTP, used by Tasks 4–5):
  `GET /api/me?address=0x…` → `200 { name: string | null, bestScore: number | null, active: MeDuel[], history: MeDuel[] }` | `400 { error: 'bad input' }`
  where `MeDuel = { id, status, stakeWei, token, creator, acceptor, winner, settleTx, createdAt }`.

- [ ] **Step 1: Write `src/app/api/me/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getName, getBestScore } from '@/lib/profileStore';
import { listDuelsForAddress, type DuelRow } from '@/lib/duelStore';
import { splitDuels } from '@/lib/profileDuels';

/**
 * The exact wire shape. Scores are deliberately absent: the page shows
 * outcomes from `winner`, and an opponent's score must never reach a client
 * that has not finished its own run.
 */
function toWire(d: DuelRow) {
  return {
    id: d.id, status: d.status, stakeWei: d.stakeWei, token: d.token,
    creator: d.creator, acceptor: d.acceptor, winner: d.winner,
    settleTx: d.settleTx, createdAt: d.createdAt,
  };
}

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get('address') ?? '';
  if (!/^0x[0-9a-fA-F]{40}$/.test(address))
    return NextResponse.json({ error: 'bad input' }, { status: 400 });
  const addr = address.toLowerCase();
  const [name, bestScore, rows] = await Promise.all([
    getName(addr), getBestScore(addr), listDuelsForAddress(addr),
  ]);
  const { active, history } = splitDuels(rows);
  return NextResponse.json({
    name, bestScore, active: active.map(toWire), history: history.map(toWire),
  });
}
```

- [ ] **Step 2: Type-check and lint**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: no errors; lint stays at the 11-problem baseline.

- [ ] **Step 3: End-to-end check, including the score-leak proof**

Start the dev server: `cd frontend && npm run dev` (background; wait for `http://localhost:3000/play` to return 200).

`tsx` resolves imports from the script's own directory, so scratchpad scripts cannot see `frontend/node_modules`. Create a temporary symlink and remove it when done:
`ln -s /Users/vanhuy/Desktop/celo-game/frontend/node_modules <scratchpad>/node_modules`

Write `<scratchpad>/e2e-me.mts`:

```ts
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);
const ADDR = '0x1111111111111111111111111111111111111111';
const OPP  = '0x2222222222222222222222222222222222222222';

// Seed: one draft (must be dropped), one accepted WITH scores (must not leak),
// one settled (history), one cancelled (history).
const draft    = (await sql`insert into duels (seed, creator, status) values (1, ${ADDR}, 'draft') returning id`)[0].id;
const accepted = (await sql`insert into duels (seed, creator, acceptor, status, creator_score, acceptor_score, stake_wei)
  values (2, ${ADDR}, ${OPP}, 'accepted', 999, 888, '1000000000000000000') returning id`)[0].id;
const settled  = (await sql`insert into duels (seed, creator, acceptor, status, winner, settle_tx, stake_wei)
  values (3, ${ADDR}, ${OPP}, 'settled', 'creator', '0xdeadbeef', '1000000000000000000') returning id`)[0].id;
const cancelled= (await sql`insert into duels (seed, creator, status) values (4, ${ADDR}, 'cancelled') returning id`)[0].id;

const res = await fetch(`http://localhost:3000/api/me?address=${ADDR}`);
const body = await res.json();
console.log('status', res.status);
console.log('active ids  ', body.active.map((d: { id: number }) => d.id), '(expect', [accepted], ')');
console.log('history ids ', body.history.map((d: { id: number }) => d.id), '(expect', [settled, cancelled], 'in some order)');
console.log('draft dropped:', !JSON.stringify(body).includes(`"id":${draft},`));

// THE PROOF: no score, taps, or death-tick field anywhere in the payload.
// `bestScore` is a legitimate top-level key and contains the substring
// "Score", so drop that key BEFORE matching — otherwise every run false-alarms.
const { bestScore: _ownBest, ...scannable } = body;
const raw = JSON.stringify(scannable);
const leaked = ['999', '888', 'Score', 'score', 'taps', 'deathTick']
  .filter((needle) => raw.includes(needle));
console.log('LEAK CHECK — offending substrings:', leaked, leaked.length === 0 ? 'PASS' : 'FAIL');

// Bad address must 400.
const bad = await fetch('http://localhost:3000/api/me?address=nope');
console.log('bad address ->', bad.status, JSON.stringify(await bad.json()));

await sql`delete from duels where id = any(${[draft, accepted, settled, cancelled]})`;
console.log('cleaned');
```

Note on the leak check: the payload legitimately contains the key
`bestScore`, so filter that exact word out before matching, then assert
nothing else score-shaped survives. If `LEAK CHECK` prints anything other
than `PASS`, stop — the hard constraint is broken.

Run: `cd frontend && DATABASE_URL="$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '"')" npx tsx <scratchpad>/e2e-me.mts`

Expected: `status 200`; active contains only the accepted duel; history contains the settled and cancelled ones; `draft dropped: true`; `LEAK CHECK … PASS`; `bad address -> 400 {"error":"bad input"}`; `cleaned`.

Then remove the symlink and stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/api/me/route.ts
git commit -m "feat(api): /api/me returns a wallet's name, best score and duels

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `/profile` page — identity and renaming

**Files:**
- Create: `src/app/profile/page.tsx`

**Interfaces:**
- Consumes: `GET /api/me` (Task 3); `POST /api/profile` (existing, unchanged); `normalizeName`, `setNameMessage` from `@/lib/profile`; wagmi `useAccount`, `useConnect`, `useSignMessage`; `Window` from `@/components/Window`.
- Produces: the page's `Me` and `MeDuel` interfaces, which Task 5 extends with rendering. Task 5 modifies this same file.

- [ ] **Step 1: Create `src/app/profile/page.tsx`**

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAccount, useConnect, useSignMessage } from 'wagmi';
import { Window } from '@/components/Window';
import { normalizeName, setNameMessage } from '@/lib/profile';

export interface MeDuel {
  id: number;
  status: string;
  stakeWei: string | null;
  token: string | null;
  creator: string;
  acceptor: string | null;
  winner: 'creator' | 'acceptor' | 'tie' | null;
  settleTx: string | null;
  createdAt: string;
}
export interface Me {
  name: string | null;
  bestScore: number | null;
  active: MeDuel[];
  history: MeDuel[];
}

export default function ProfilePage() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { signMessageAsync } = useSignMessage();

  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!address) return;
    setLoadError(false);
    try {
      const res = await fetch(`/api/me?address=${address}`);
      if (!res.ok) throw new Error('bad status');
      setMe(await res.json());
    } catch {
      setLoadError(true);
    }
  }, [address]);

  useEffect(() => {
    setMe(null);
    void load();
  }, [load]);

  async function rename() {
    if (!address) return;
    const n = normalizeName(draftName);
    if (!n.ok) { setError('Name: 1–16 letters, digits, space, _ . -'); return; }
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      const ts = Date.now();
      const signature = await signMessageAsync({ message: setNameMessage(n.name, ts) });
      const res = await fetch('/api/profile', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, name: n.name, timestamp: ts, signature }),
      });
      if (res.status === 409) { setError('That name is taken — pick another.'); return; }
      if (!res.ok) { setError('Could not save your name. Try again.'); return; }
      setMe((m) => (m ? { ...m, name: n.name } : m));
      setDraftName('');
      setSaved(true);
    } catch {
      setError('Signature request was cancelled.');
    } finally {
      setBusy(false);
    }
  }

  if (!isConnected) {
    return (
      <main className="desktop">
        <Window title="PROFILE.EXE">
          <p>Connect your wallet to see your name and your duels.</p>
          <button onClick={() => connectors[0] && connect({ connector: connectors[0] })}>
            💰 Connect wallet
          </button>
        </Window>
      </main>
    );
  }

  return (
    <main className="desktop">
      <Window title="PROFILE.EXE">
        {loadError ? (
          <>
            <p>⚠️ Could not load your profile.</p>
            <button onClick={() => void load()}>Try again</button>
          </>
        ) : (
          <>
            <p>
              👤 <b>{me?.name ?? 'No name yet'}</b>
              {me?.bestScore !== null && me?.bestScore !== undefined && (
                <> · best practice score <b>{me.bestScore}</b></>
              )}
            </p>
            <p className="mono fineprint">{address}</p>
            <fieldset>
              <legend>{me?.name ? 'Change your name' : 'Pick your name'}</legend>
              <div className="row">
                <input
                  placeholder="New name" value={draftName} maxLength={16}
                  onChange={(e) => setDraftName(e.target.value)}
                />
                <button onClick={rename} disabled={busy || !draftName.trim()}>
                  {busy ? 'Signing…' : 'Save name'}
                </button>
              </div>
              {saved && <p className="fineprint">Saved.</p>}
              {error && <p className="fineprint">⚠️ {error}</p>}
              <p className="fineprint">
                Your scores follow your wallet, so renaming keeps them. Your old name becomes
                free for anyone else to take.
              </p>
            </fieldset>
          </>
        )}
      </Window>
    </main>
  );
}
```

- [ ] **Step 2: Gates**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: all clean. Lint may gain **one** `react-hooks/set-state-in-effect` finding for `setMe(null)` in the effect — that matches four accepted instances already in the repo (`Shell.tsx:99`, `Shell.tsx:124`, `useNow.ts:15`, `play/page.tsx:26`). Report the exact count; do not restructure to avoid it.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/profile/page.tsx
git commit -m "feat(profile): profile page with wallet identity and renaming

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Duel sections on the profile page

**Files:**
- Modify: `src/lib/contracts.ts` (append one helper)
- Modify: `src/app/duels/page.tsx` (drop its local `stakeLabel`, use the shared helper)
- Modify: `src/app/profile/page.tsx` (add the two sections)

**Interfaces:**
- Consumes: `Me`, `MeDuel` (Task 4); `useNames`, `displayName` from `@/lib/useNames`; `viewerRole` from `@/lib/outcome`; `tokenByAddress` from `@/lib/contracts`.
- Produces: `formatStake(stakeWei: string | null, token: string | null): string` exported from `@/lib/contracts`.

- [ ] **Step 1: Add the shared stake formatter to `src/lib/contracts.ts`**

`duels/page.tsx` already has a local `stakeLabel`; the profile page needs the same thing, so lift it rather than copying it. Append to `src/lib/contracts.ts`:

```ts
import { formatUnits } from 'viem';

/** Human-readable stake, e.g. "0.5 cUSD". Falls back to "—" for unfunded rows. */
export function formatStake(stakeWei: string | null, token: string | null): string {
  if (!stakeWei) return '—';
  const t = token ? tokenByAddress(token) : undefined;
  return `${formatUnits(BigInt(stakeWei), t?.decimals ?? 18)} ${t?.symbol ?? 'USDm'}`;
}
```

If `contracts.ts` already imports from `viem`, merge the `formatUnits` import into that line instead of adding a second one.

- [ ] **Step 2: Point `duels/page.tsx` at the shared helper**

Delete this local function (near the top of `src/app/duels/page.tsx`):

```ts
function stakeLabel(d: OpenDuel): string {
  const t = d.token ? tokenByAddress(d.token) : undefined;
  return `${formatUnits(BigInt(d.stakeWei), t?.decimals ?? 18)} ${t?.symbol ?? 'USDm'}`;
}
```

Change its single call site from `{stakeLabel(d)}` to `{formatStake(d.stakeWei, d.token)}`, update the import to `import { formatStake } from '@/lib/contracts';`, and remove the now-unused `tokenByAddress` and `formatUnits` imports if nothing else in the file uses them (check first — lint will fail on unused imports).

- [ ] **Step 3: Add the sections to `src/app/profile/page.tsx`**

Add these imports to the existing import block:

```tsx
import Link from 'next/link';
import { formatStake } from '@/lib/contracts';
import { useNames, displayName } from '@/lib/useNames';
import { viewerRole } from '@/lib/outcome';
```

Add these two helpers above `export default function ProfilePage()`:

```tsx
const ACTIVE_LABEL: Record<string, string> = {
  funded: 'Finish your run',
  open: 'Waiting for an opponent',
  accepted: 'Opponent is playing',
  settling: 'Settling…',
};

/** What a finished duel meant for this viewer. Cancelled duels have no winner. */
function outcomeLabel(d: MeDuel, address: string | undefined): string {
  if (d.status === 'cancelled') return 'Refunded';
  if (d.winner === 'tie') return 'Tie';
  const role = viewerRole(address, d.creator, d.acceptor);
  if (role === 'observer' || d.winner === null) return '—';
  return d.winner === role ? 'Won' : 'Lost';
}
```

Inside the component, after the existing state declarations, add:

```tsx
  const names = useNames([
    ...(me?.active ?? []).flatMap((d) => [d.creator, d.acceptor]),
    ...(me?.history ?? []).flatMap((d) => [d.creator, d.acceptor]),
  ]);

  function opponentOf(d: MeDuel): string {
    const a = address?.toLowerCase();
    const other = d.creator.toLowerCase() === a ? d.acceptor : d.creator;
    return other ? displayName(names, other) : 'nobody yet';
  }

  const record = (me?.history ?? []).filter((d) => d.status === 'settled');
  const wins = record.filter((d) => outcomeLabel(d, address) === 'Won').length;
  const losses = record.filter((d) => outcomeLabel(d, address) === 'Lost').length;
```

Then add these two `Window` blocks after the existing identity `Window`, inside the same `<main>`:

```tsx
      <Window title="UNFINISHED.LST">
        {(me?.active ?? []).length === 0 ? (
          <p className="fineprint">Nothing unfinished. <Link href="/duels/new">Start a duel</Link>.</p>
        ) : (
          <table className="ledger">
            <thead><tr><th>Duel</th><th>Stake</th><th></th></tr></thead>
            <tbody>
              {me!.active.map((d) => (
                <tr key={d.id}>
                  <td>
                    ⚔️ duel_{d.id}.exe<br />
                    <small className={d.status === 'funded' ? 'win' : undefined}>
                      {ACTIVE_LABEL[d.status] ?? d.status} · vs {opponentOf(d)}
                    </small>
                  </td>
                  <td className="stake">{formatStake(d.stakeWei, d.token)}</td>
                  <td><Link href={`/duels/${d.id}`}><button>Open</button></Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Window>

      <Window title="HISTORY.LOG">
        {(me?.history ?? []).length === 0 ? (
          <p className="fineprint">No finished duels yet.</p>
        ) : (
          <>
            <p className="fineprint">Record: {wins}W – {losses}L</p>
            <table className="ledger">
              <thead><tr><th>Duel</th><th>Stake</th><th>Result</th></tr></thead>
              <tbody>
                {me!.history.map((d) => (
                  <tr key={d.id}>
                    <td>
                      ⚔️ duel_{d.id}.exe<br />
                      <small>vs {opponentOf(d)}</small>
                    </td>
                    <td className="stake">{formatStake(d.stakeWei, d.token)}</td>
                    <td>
                      {outcomeLabel(d, address)}
                      {d.settleTx && (
                        <> · <a href={`https://celoscan.io/tx/${d.settleTx}`} target="_blank" rel="noreferrer">tx</a></>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Window>
```

Both blocks go inside the `!loadError` branch, so a failed load shows only the retry line.

- [ ] **Step 4: Gates**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: all clean; lint count unchanged from what Task 4 left it at.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/contracts.ts frontend/src/app/duels/page.tsx frontend/src/app/profile/page.tsx
git commit -m "feat(profile): list a wallet's unfinished and finished duels

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Navigation entry and final sweep

**Files:**
- Modify: `src/components/Shell.tsx` (the `NAV` array near the top)

- [ ] **Step 1: Add the nav entry**

In `src/components/Shell.tsx`, the `NAV` array currently reads:

```ts
const NAV = [
  { href: '/play', ico: '🐤', label: 'Play', file: 'PRACTICE.EXE' },
  { href: '/duels', ico: '⚔️', label: 'Open Duels', file: 'C:\\DUELS' },
  { href: '/duels/new', ico: '📝', label: 'New Duel', file: 'NEWDUEL.EXE' },
  { href: '/fame', ico: '🏆', label: 'Hall of Fame', file: 'HALLOFFAME.XLS' },
];
```

Add one entry at the end:

```ts
  { href: '/profile', ico: '👤', label: 'Profile', file: 'PROFILE.EXE' },
```

`windowLabel` derives the taskbar label from this same array, so the taskbar picks the new page up with no further change.

- [ ] **Step 2: Full gate run**

Run: `cd frontend && npm test && npm run lint && npm run build`
Expected: all pass. Paste the summary lines into the report — no claims without output.

- [ ] **Step 3: Manual browser check**

With `npm run dev` running and a wallet connected, visit `/profile` and confirm: the Start menu has a Profile entry; the identity block shows your name, address and best score; renaming prompts one signature and the displayed name updates; unfinished and finished sections render (or show their empty states); a `funded` row is highlighted and links through to its duel.

This step is **controller-run**, not delegated to an implementer.

- [ ] **Step 4: Spec conformance check**

Re-read `docs/superpowers/specs/2026-07-22-profile-page-design.md` and confirm each decision landed: private route only, two duel sections, `draft` dropped, rename free with the old name released, no signature on `/api/me`, no schema change, scores never on the wire. List any deviation in the report rather than silently accepting it.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Shell.tsx
git commit -m "feat(profile): add Profile to the Start menu

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**Deploy note:** `git push` and Vercel deployment are NOT part of this plan — the owner pushes after their own review.
