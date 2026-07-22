# Wallet-Bound Usernames Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require a wallet signature to save practice scores, bind one unique username per wallet, and show usernames across the Hall of Fame and duel screens.

**Architecture:** Per-action message signatures (viem `verifyMessage`, EOA-only, no sessions). New `profiles` table (address → unique name) and `practice_best` table (one best-score row per wallet, so replay spam is idempotent). Pure helpers (name rules, message formats, signature check) live in `src/lib/profile.ts` and are unit-tested; SQL lives in `src/lib/profileStore.ts` (untested, matching this repo's pattern); route handlers stay thin.

**Tech Stack:** Next.js 16 route handlers, viem 2.x (`verifyMessage`, `keccak256`, `privateKeyToAccount` in tests), wagmi 3.x (`useSignMessage`), Neon serverless Postgres, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-22-wallet-username-design.md`

## Global Constraints

- All paths below are relative to `frontend/` unless they start with `docs/`.
- This repo's Next.js has breaking changes vs. training data (see `frontend/AGENTS.md`). Follow the existing route/page files as the pattern; if unsure, read `node_modules/next/dist/docs/`.
- Signed message formats, verbatim:
  - set-name: `flap95 set-name:<name> ts:<timestamp>`
  - practice: `flap95 practice seed:<seed> taps:<keccak256(JSON.stringify(taps))> ts:<timestamp>`
- Name rule: trim, then must match `/^[\p{L}\p{N} _.\-]{1,16}$/u`.
- Signature freshness window: 10 minutes (`SIG_FRESH_MS = 600_000`).
- Addresses are stored and looked up lowercase; signatures verify against any case (viem is case-insensitive).
- Commit directly to `main` (solo repo convention). Never `git push` without the owner's explicit go-ahead.
- Run tests with `npm test` (vitest, `src/**/*.test.ts`, node env). Lint with `npm run lint`, build with `npm run build`.
- End every commit message with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Legacy `practice_scores` table: stop reading/writing it, keep it in schema.sql as an archive. Hall of Fame restarts empty by design.

---

### Task 1: Pure profile helpers — name rules, message formats, taps hash

**Files:**
- Create: `src/lib/profile.ts`
- Test: `src/lib/profile.test.ts`

**Interfaces:**
- Consumes: `keccak256`, `stringToHex` from `viem`.
- Produces (later tasks import these exact names from `@/lib/profile`):
  - `normalizeName(raw: string): { ok: true; name: string } | { ok: false; error: 'bad_name' }`
  - `setNameMessage(name: string, timestamp: number): string`
  - `practiceMessage(seed: number, tapsHashHex: string, timestamp: number): string`
  - `tapsHash(taps: readonly number[]): string` (0x-prefixed keccak256 hex)
  - `SIG_FRESH_MS: number` (600_000)

- [ ] **Step 1: Write the failing test**

Create `src/lib/profile.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeName, setNameMessage, practiceMessage, tapsHash, SIG_FRESH_MS } from './profile';

describe('normalizeName', () => {
  it('trims and accepts a plain name', () => {
    expect(normalizeName('  Huy ')).toEqual({ ok: true, name: 'Huy' });
  });
  it('accepts Vietnamese letters and spaces', () => {
    expect(normalizeName('Việt Anh')).toEqual({ ok: true, name: 'Việt Anh' });
  });
  it('accepts digits, underscore, dot, dash', () => {
    expect(normalizeName('a_b.c-1')).toEqual({ ok: true, name: 'a_b.c-1' });
  });
  it('rejects empty and whitespace-only', () => {
    expect(normalizeName('').ok).toBe(false);
    expect(normalizeName('   ').ok).toBe(false);
  });
  it('rejects more than 16 chars', () => {
    expect(normalizeName('a'.repeat(17)).ok).toBe(false);
    expect(normalizeName('a'.repeat(16)).ok).toBe(true);
  });
  it('rejects emoji', () => {
    expect(normalizeName('bird🐤').ok).toBe(false);
  });
  it('rejects control characters', () => {
    expect(normalizeName('a\nb').ok).toBe(false);
  });
});

describe('message formats', () => {
  it('setNameMessage matches the spec format', () => {
    expect(setNameMessage('Huy', 1753142400000)).toBe('flap95 set-name:Huy ts:1753142400000');
  });
  it('practiceMessage matches the spec format', () => {
    expect(practiceMessage(42, '0xabc', 1753142400000)).toBe('flap95 practice seed:42 taps:0xabc ts:1753142400000');
  });
});

describe('tapsHash', () => {
  it('is deterministic and 0x-prefixed 32-byte hex', () => {
    const h = tapsHash([10, 20, 30]);
    expect(h).toBe(tapsHash([10, 20, 30]));
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it('differs for different taps', () => {
    expect(tapsHash([10, 20])).not.toBe(tapsHash([10, 21]));
  });
});

describe('SIG_FRESH_MS', () => {
  it('is ten minutes', () => {
    expect(SIG_FRESH_MS).toBe(600_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/lib/profile.test.ts`
Expected: FAIL — cannot resolve `./profile`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/profile.ts`:

```ts
import { keccak256, stringToHex } from 'viem';

/** Trimmed, 1–16 chars: Unicode letters/digits (Vietnamese names work), space, _ . - */
const NAME_RE = /^[\p{L}\p{N} _.\-]{1,16}$/u;

export function normalizeName(
  raw: string,
): { ok: true; name: string } | { ok: false; error: 'bad_name' } {
  const name = raw.trim();
  if (!NAME_RE.test(name)) return { ok: false, error: 'bad_name' };
  return { ok: true, name };
}

/** A signed action is rejected when its timestamp is further than this from server time. */
export const SIG_FRESH_MS = 600_000;

export function tapsHash(taps: readonly number[]): string {
  return keccak256(stringToHex(JSON.stringify(taps)));
}

export function setNameMessage(name: string, timestamp: number): string {
  return `flap95 set-name:${name} ts:${timestamp}`;
}

export function practiceMessage(seed: number, tapsHashHex: string, timestamp: number): string {
  return `flap95 practice seed:${seed} taps:${tapsHashHex} ts:${timestamp}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- src/lib/profile.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/profile.ts frontend/src/lib/profile.test.ts
git commit -m "feat(profile): name rules and signed-message formats

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Signature verification helper

**Files:**
- Modify: `src/lib/profile.ts` (append)
- Test: `src/lib/profile.test.ts` (append)

**Interfaces:**
- Consumes: `SIG_FRESH_MS` (Task 1), `verifyMessage` from `viem` (pure ecrecover — EOA-only, works offline; documented spec limitation).
- Produces: `verifySignedAction(args: { address: string; message: string; signature: string; timestamp: number; now?: number }): Promise<'ok' | 'stale' | 'bad_signature'>`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/profile.test.ts` (add `verifySignedAction` to the existing import from `./profile`, and add this import + block):

```ts
import { privateKeyToAccount } from 'viem/accounts';

describe('verifySignedAction', () => {
  // Well-known anvil test key #1 — not a secret.
  const account = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');

  it('accepts a fresh, valid signature', async () => {
    const ts = 1_753_142_400_000;
    const message = setNameMessage('Huy', ts);
    const signature = await account.signMessage({ message });
    await expect(
      verifySignedAction({ address: account.address, message, signature, timestamp: ts, now: ts + 1000 }),
    ).resolves.toBe('ok');
  });

  it('rejects a signature attributed to a different wallet', async () => {
    const ts = 1_753_142_400_000;
    const message = setNameMessage('Huy', ts);
    const signature = await account.signMessage({ message });
    await expect(
      verifySignedAction({
        address: '0x000000000000000000000000000000000000dEaD',
        message, signature, timestamp: ts, now: ts + 1000,
      }),
    ).resolves.toBe('bad_signature');
  });

  it('rejects a stale timestamp', async () => {
    const ts = 1_753_142_400_000;
    const message = setNameMessage('Huy', ts);
    const signature = await account.signMessage({ message });
    await expect(
      verifySignedAction({ address: account.address, message, signature, timestamp: ts, now: ts + SIG_FRESH_MS + 1 }),
    ).resolves.toBe('stale');
  });

  it('rejects a non-finite timestamp', async () => {
    await expect(
      verifySignedAction({ address: account.address, message: 'x', signature: '0x12', timestamp: NaN }),
    ).resolves.toBe('stale');
  });

  it('rejects garbage signatures without throwing', async () => {
    await expect(
      verifySignedAction({ address: account.address, message: 'x', signature: '0x1234', timestamp: Date.now() }),
    ).resolves.toBe('bad_signature');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/lib/profile.test.ts`
Expected: FAIL — `verifySignedAction` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/profile.ts`:

```ts
import { verifyMessage, type Address, type Hex } from 'viem';

/**
 * EOA-only (pure ecrecover): smart-contract wallets can't sign here.
 * Acceptable for MiniPay and browser extension wallets — see spec.
 */
export async function verifySignedAction(args: {
  address: string;
  message: string;
  signature: string;
  timestamp: number;
  now?: number;
}): Promise<'ok' | 'stale' | 'bad_signature'> {
  const now = args.now ?? Date.now();
  if (!Number.isFinite(args.timestamp) || Math.abs(now - args.timestamp) > SIG_FRESH_MS) return 'stale';
  const valid = await verifyMessage({
    address: args.address as Address,
    message: args.message,
    signature: args.signature as Hex,
  }).catch(() => false);
  return valid ? 'ok' : 'bad_signature';
}
```

(Merge the `viem` imports into the existing import line at the top of the file: `import { keccak256, stringToHex, verifyMessage, type Address, type Hex } from 'viem';`)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- src/lib/profile.test.ts`
Expected: PASS (all tests, including Task 1's).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/profile.ts frontend/src/lib/profile.test.ts
git commit -m "feat(profile): verify signed actions with freshness window

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Schema, profile store, and applying the schema to Neon

SQL functions follow this repo's convention of no unit tests (no test DB); they are exercised end-to-end in Task 5's verification.

**Files:**
- Modify: `schema.sql` (append at end; also annotate `practice_scores`)
- Create: `src/lib/profileStore.ts`

**Interfaces:**
- Consumes: `sql` from `./db` (Neon tagged-template client).
- Produces (later tasks import these exact names from `@/lib/profileStore`; all addresses passed in must already be lowercase):
  - `setName(address: string, name: string): Promise<'ok' | 'taken'>`
  - `getName(address: string): Promise<string | null>`
  - `getNames(addresses: string[]): Promise<Record<string, string>>`
  - `upsertBest(address: string, score: number): Promise<void>`
  - `topScores(): Promise<{ name: string; score: number }[]>`

- [ ] **Step 1: Append the new tables to `schema.sql`**

Add a comment above the existing `practice_scores` table:

```sql
-- LEGACY: anonymous practice scores. No longer read or written since the
-- wallet-username change (2026-07-22); kept as an archive.
```

Append at the end of the file:

```sql
create table if not exists profiles (
  address text primary key,           -- lowercase 0x address
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists profiles_name_lower_idx on profiles (lower(name));

create table if not exists practice_best (
  address text primary key references profiles(address),
  score integer not null,
  updated_at timestamptz not null default now()
);
```

- [ ] **Step 2: Apply the schema to the Neon database**

`psql` is not installed; use a one-off tsx script. Write this to the session scratchpad (NOT the repo), e.g. `<scratchpad>/apply-schema.mts`:

```ts
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);
await sql`create table if not exists profiles (
  address text primary key,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)`;
await sql`create unique index if not exists profiles_name_lower_idx on profiles (lower(name))`;
await sql`create table if not exists practice_best (
  address text primary key references profiles(address),
  score integer not null,
  updated_at timestamptz not null default now()
)`;
console.log(await sql`select table_name from information_schema.tables
  where table_name in ('profiles', 'practice_best') order by table_name`);
```

Run: `cd frontend && DATABASE_URL="$(grep '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d '\"')" npx tsx <scratchpad>/apply-schema.mts`
Expected output: two rows, `practice_best` and `profiles`. Do not proceed until you see both.

- [ ] **Step 3: Write the store**

Create `src/lib/profileStore.ts`:

```ts
import { sql } from './db';

/** All addresses passed to this module must already be lowercase. */

export async function setName(address: string, name: string): Promise<'ok' | 'taken'> {
  try {
    await sql`insert into profiles (address, name) values (${address}, ${name})
      on conflict (address) do update set name = excluded.name, updated_at = now()`;
    return 'ok';
  } catch (e) {
    // 23505 = unique_violation, here only reachable via profiles_name_lower_idx.
    if ((e as { code?: string }).code === '23505') return 'taken';
    throw e;
  }
}

export async function getName(address: string): Promise<string | null> {
  const rows = await sql`select name from profiles where address = ${address}`;
  return rows.length ? (rows[0].name as string) : null;
}

export async function getNames(addresses: string[]): Promise<Record<string, string>> {
  if (addresses.length === 0) return {};
  const rows = await sql`select address, name from profiles where address = any(${addresses})`;
  return Object.fromEntries(rows.map((r) => [r.address as string, r.name as string]));
}

export async function upsertBest(address: string, score: number): Promise<void> {
  await sql`insert into practice_best (address, score) values (${address}, ${score})
    on conflict (address) do update
      set score = greatest(practice_best.score, excluded.score), updated_at = now()`;
}

export async function topScores(): Promise<{ name: string; score: number }[]> {
  const rows = await sql`select p.name, b.score
    from practice_best b join profiles p on p.address = b.address
    order by b.score desc, b.updated_at asc limit 20`;
  return rows.map((r) => ({ name: r.name as string, score: Number(r.score) }));
}
```

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/schema.sql frontend/src/lib/profileStore.ts
git commit -m "feat(profile): profiles + practice_best tables and store

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `/api/profile` and `/api/names` routes

Thin handlers over the tested helpers — no route-level unit tests (repo convention); exercised end-to-end in Task 5.

**Files:**
- Create: `src/app/api/profile/route.ts`
- Create: `src/app/api/names/route.ts`

**Interfaces:**
- Consumes: `normalizeName`, `setNameMessage`, `verifySignedAction` from `@/lib/profile`; `setName`, `getName`, `getNames` from `@/lib/profileStore`.
- Produces (HTTP, used by Tasks 6–7):
  - `POST /api/profile` body `{address, name, timestamp, signature}` → `200 {ok, name}` | `400 {error:'bad input'|'bad_name'}` | `401 {error:'stale'|'bad_signature'}` | `409 {error:'name_taken'}`
  - `GET /api/profile?address=0x…` → `200 {name: string | null}`
  - `GET /api/names?addrs=0x…,0x…` → `200 {names: Record<lowercaseAddress, string>}`

- [ ] **Step 1: Write `src/app/api/profile/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { normalizeName, setNameMessage, verifySignedAction } from '@/lib/profile';
import { getName, setName } from '@/lib/profileStore';

export async function POST(req: Request) {
  const { address, name, timestamp, signature } = await req.json();
  if (
    typeof address !== 'string' || typeof name !== 'string' ||
    typeof timestamp !== 'number' || typeof signature !== 'string'
  )
    return NextResponse.json({ error: 'bad input' }, { status: 400 });
  const n = normalizeName(name);
  if (!n.ok) return NextResponse.json({ error: 'bad_name' }, { status: 400 });
  const v = await verifySignedAction({
    address, message: setNameMessage(n.name, timestamp), signature, timestamp,
  });
  if (v !== 'ok') return NextResponse.json({ error: v }, { status: 401 });
  const r = await setName(address.toLowerCase(), n.name);
  if (r === 'taken') return NextResponse.json({ error: 'name_taken' }, { status: 409 });
  return NextResponse.json({ ok: true, name: n.name });
}

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get('address');
  if (!address) return NextResponse.json({ error: 'bad input' }, { status: 400 });
  return NextResponse.json({ name: await getName(address.toLowerCase()) });
}
```

Note: renaming to your own current name hits the `on conflict (address) do update` path, which re-sets the same name — correct and idempotent. `setName` only reports `'taken'` when the name-uniqueness index rejects a *different* wallet's name.

Edge case to be aware of (accepted, don't code around it): two different spellings that lowercase identically ("Huy" vs "huy") collide by design.

- [ ] **Step 2: Write `src/app/api/names/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getNames } from '@/lib/profileStore';

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('addrs') ?? '';
  const addrs = raw
    .split(',')
    .filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a))
    .map((a) => a.toLowerCase())
    .slice(0, 50);
  if (addrs.length === 0) return NextResponse.json({ names: {} });
  return NextResponse.json({ names: await getNames(addrs) });
}
```

- [ ] **Step 3: Type-check and lint**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/api/profile/route.ts frontend/src/app/api/names/route.ts
git commit -m "feat(api): signed set-name endpoint and batch name lookup

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Rewrite `/api/practice` to require a signed wallet action

**Files:**
- Modify: `src/app/api/practice/route.ts` (full rewrite below)
- Modify: `src/lib/duelStore.ts` — delete `addPracticeScore` and `topPracticeScores` (lines ~224–233)

**Interfaces:**
- Consumes: `practiceMessage`, `tapsHash`, `verifySignedAction` from `@/lib/profile`; `getName`, `upsertBest`, `topScores` from `@/lib/profileStore`; `verifyRun` from `@/engine/verify` (unchanged).
- Produces (HTTP, used by Task 6 and the fame page):
  - `POST /api/practice` body `{address, seed, taps, timestamp, signature}` → `200 {ok, score}` | `400 {error:'bad input'|'no_profile'|<trace error>}` | `401 {error:'stale'|'bad_signature'}`
  - `GET /api/practice` → `200 {scores: {name, score}[]}` (same shape as before — fame page needs no change)

- [ ] **Step 1: Replace `src/app/api/practice/route.ts` entirely with:**

```ts
import { NextResponse } from 'next/server';
import { verifyRun } from '@/engine/verify';
import { practiceMessage, tapsHash, verifySignedAction } from '@/lib/profile';
import { getName, upsertBest, topScores } from '@/lib/profileStore';

export async function POST(req: Request) {
  const { address, seed, taps, timestamp, signature } = await req.json();
  if (
    typeof address !== 'string' || typeof seed !== 'number' || !Array.isArray(taps) ||
    typeof timestamp !== 'number' || typeof signature !== 'string'
  )
    return NextResponse.json({ error: 'bad input' }, { status: 400 });
  const v = await verifySignedAction({
    address, message: practiceMessage(seed, tapsHash(taps), timestamp), signature, timestamp,
  });
  if (v !== 'ok') return NextResponse.json({ error: v }, { status: 401 });
  const addr = address.toLowerCase();
  if ((await getName(addr)) === null)
    return NextResponse.json({ error: 'no_profile' }, { status: 400 });
  const r = verifyRun(seed, taps);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  await upsertBest(addr, r.score);
  return NextResponse.json({ ok: true, score: r.score });
}

export async function GET() {
  return NextResponse.json({ scores: await topScores() });
}
```

- [ ] **Step 2: Delete the two legacy functions from `src/lib/duelStore.ts`**

Remove `addPracticeScore` and `topPracticeScores` (the two functions at the bottom that touch `practice_scores`). Nothing else imports them after Step 1 — confirm with:

Run: `cd frontend && grep -rn "addPracticeScore\|topPracticeScores" src`
Expected: no matches.

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit && npm test`
Expected: no errors; all tests pass.

- [ ] **Step 4: End-to-end verification against the real routes + DB**

Start the dev server: `cd frontend && npm run dev` (background). Then write `<scratchpad>/e2e-profile.mts`:

```ts
import { privateKeyToAccount } from 'viem/accounts';
import { setNameMessage, practiceMessage, tapsHash } from '/Users/vanhuy/Desktop/celo-game/frontend/src/lib/profile';

const BASE = 'http://localhost:3000';
// Throwaway key for testing only — anvil well-known key #2, not a secret.
const account = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');

// 1. Set name
let ts = Date.now();
let msg = setNameMessage('E2E Tester', ts);
let sig = await account.signMessage({ message: msg });
let res = await fetch(`${BASE}/api/profile`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ address: account.address, name: 'E2E Tester', timestamp: ts, signature: sig }),
});
console.log('set-name', res.status, await res.json()); // expect 200 {ok:true, name:'E2E Tester'}

// 2. Save a real (short) run: taps must satisfy verifyRun, an empty run scores 0 and is valid
ts = Date.now();
const taps: number[] = [];
msg = practiceMessage(123, tapsHash(taps), ts);
sig = await account.signMessage({ message: msg });
res = await fetch(`${BASE}/api/practice`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ address: account.address, seed: 123, taps, timestamp: ts, signature: sig }),
});
console.log('save-score', res.status, await res.json()); // expect 200 {ok:true, score:0}

// 3. Unsigned spam must bounce
res = await fetch(`${BASE}/api/practice`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ address: account.address, seed: 123, taps, timestamp: Date.now(), signature: '0x1234' }),
});
console.log('spam', res.status, await res.json()); // expect 401 {error:'bad_signature'}

// 4. Leaderboard shows the verified name
res = await fetch(`${BASE}/api/practice`);
console.log('board', await res.json()); // expect scores to include {name:'E2E Tester', score:0}

// 5. Names lookup
res = await fetch(`${BASE}/api/names?addrs=${account.address}`);
console.log('names', await res.json()); // expect { names: { [lowercase address]: 'E2E Tester' } }
```

Run: `npx tsx <scratchpad>/e2e-profile.mts` (fix the import path first).
Expected: the five logged lines match the inline comments. If any don't, stop and debug before continuing.

Cleanup: delete the test rows so the live board doesn't show them —
write `<scratchpad>/cleanup.mts`:

```ts
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL!);
const addr = '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc'; // anvil key #2's address, lowercase
await sql`delete from practice_best where address = ${addr}`;
await sql`delete from profiles where address = ${addr}`;
console.log('cleaned');
```

Run it the same way as the apply-schema script. Expected: `cleaned`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/api/practice/route.ts frontend/src/lib/duelStore.ts
git commit -m "feat(practice): require a wallet signature to save scores

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Play page — connect, name, sign, save

**Files:**
- Modify: `src/app/play/page.tsx` (full rewrite below)

**Interfaces:**
- Consumes: `POST/GET /api/profile`, `POST /api/practice` (Tasks 4–5); `normalizeName`, `setNameMessage`, `practiceMessage`, `tapsHash` from `@/lib/profile`; wagmi `useAccount`, `useConnect`, `useSignMessage`.
- Produces: user-facing save flow; no exports.

- [ ] **Step 1: Replace `src/app/play/page.tsx` entirely with:**

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAccount, useConnect, useSignMessage } from 'wagmi';
import { Window } from '@/components/Window';
import { Dialog95 } from '@/components/Dialog95';
import { GameCanvas } from '@/components/GameCanvas';
import { normalizeName, setNameMessage, practiceMessage, tapsHash } from '@/lib/profile';

function randomSeed() { return Math.floor(Math.random() * 2 ** 31); }

export default function PlayPage() {
  const [seed, setSeed] = useState(randomSeed);
  const [runKey, setRunKey] = useState(0);
  const [result, setResult] = useState<{ taps: number[]; score: number } | null>(null);
  const [name, setName] = useState('');
  const [profileName, setProfileName] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { signMessageAsync } = useSignMessage();

  useEffect(() => {
    setProfileName(null);
    if (!address) return;
    let stale = false;
    fetch(`/api/profile?address=${address}`)
      .then((r) => r.json())
      .then((d) => { if (!stale) setProfileName(d.name ?? null); })
      .catch(() => {});
    return () => { stale = true; };
  }, [address]);

  const onRunEnd = useCallback((taps: number[], score: number) => setResult({ taps, score }), []);

  async function save() {
    if (!result || !address) return;
    setError(null);
    setBusy(true);
    try {
      if (!profileName) {
        const n = normalizeName(name);
        if (!n.ok) { setError('Name: 1–16 letters, digits, space, _ . -'); return; }
        const ts = Date.now();
        const signature = await signMessageAsync({ message: setNameMessage(n.name, ts) });
        const res = await fetch('/api/profile', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ address, name: n.name, timestamp: ts, signature }),
        });
        if (res.status === 409) { setError('That name is taken — pick another.'); return; }
        if (!res.ok) { setError('Could not save your name. Try again.'); return; }
        setProfileName(n.name);
      }
      const ts = Date.now();
      const signature = await signMessageAsync({
        message: practiceMessage(seed, tapsHash(result.taps), ts),
      });
      const res = await fetch('/api/practice', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, seed, taps: result.taps, timestamp: ts, signature }),
      });
      if (!res.ok) { setError('Could not save your score. Try again.'); return; }
      setSaved(true);
    } catch {
      setError('Signature request was cancelled.');
    } finally {
      setBusy(false);
    }
  }

  function again() {
    setSeed(randomSeed()); setRunKey((k) => k + 1); setResult(null); setSaved(false); setError(null);
  }

  return (
    <main className="desktop">
      <Window title="PRACTICE.EXE — tap to flap">
        <GameCanvas key={runKey} seed={seed} onRunEnd={onRunEnd} />
      </Window>
      <Dialog95 title="Game over" open={result !== null}>
        <p>⚠️ You scored <b>{result?.score}</b>.</p>
        {saved ? (
          <p>Saved to the Hall of Fame.</p>
        ) : !isConnected ? (
          <button onClick={() => connectors[0] && connect({ connector: connectors[0] })}>
            💰 Connect wallet to save
          </button>
        ) : (
          <div className="row">
            {!profileName && (
              <input
                placeholder="Your name" value={name} maxLength={16}
                onChange={(e) => setName(e.target.value)}
              />
            )}
            <button onClick={save} disabled={busy || (!profileName && !name.trim())}>
              {busy ? 'Signing…' : profileName ? `Save as ${profileName}` : 'Save score'}
            </button>
          </div>
        )}
        {error && <p className="fineprint">⚠️ {error}</p>}
        <div className="row spread" style={{ marginTop: 8 }}>
          <button onClick={again}>Play again</button>
          <a className="button" href="/duels/new"><button>Duel for stablecoins</button></a>
        </div>
      </Dialog95>
    </main>
  );
}
```

Known cosmetic tradeoff (accept it): while the profile fetch is in flight, a wallet that already has a name briefly shows the name input. The first save then still signs only the score message because `profileName` resolves before the user finishes typing in practice; if they race it and set a name anyway, the rename is idempotent.

- [ ] **Step 2: Type-check, lint, test**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npm test`
Expected: clean.

- [ ] **Step 3: Manual browser check**

With `npm run dev` running, open `http://localhost:3000/play`, play a run, and verify: disconnected → "Connect wallet to save" appears; after connecting (browser wallet) → name input + Save; save triggers two signature popups the first time, one thereafter; the score appears on `/fame` under the chosen name.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/play/page.tsx
git commit -m "feat(play): wallet-signed score saving with per-wallet username

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Show usernames on duel screens

**Files:**
- Create: `src/lib/useNames.ts`
- Test: `src/lib/useNames.test.ts` (covers the pure `displayName` helper only; the hook is browser-glue, verified manually)
- Modify: `src/app/duels/page.tsx:43` (the `who` line)
- Modify: `src/app/duels/[id]/page.tsx:276` and `:410` (the two `detail.creator.slice(0, 8)` spans)
- Modify: `src/app/duels/new/page.tsx:108` (the `challenge.slice(0, 8)` span)

**Interfaces:**
- Consumes: `GET /api/names` (Task 4).
- Produces:
  - `useNames(addresses: (string | null | undefined)[]): Record<string, string>` (keys are lowercase addresses)
  - `displayName(names: Record<string, string>, address: string): string` (profile name, else `0x123456…` shortened form)

- [ ] **Step 1: Write the failing test**

Create `src/lib/useNames.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { displayName } from './useNames';

describe('displayName', () => {
  const addr = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
  it('prefers the profile name, looked up lowercase', () => {
    expect(displayName({ [addr.toLowerCase()]: 'Huy' }, addr)).toBe('Huy');
  });
  it('falls back to the shortened address', () => {
    expect(displayName({}, addr)).toBe('0x709979…');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- src/lib/useNames.test.ts`
Expected: FAIL — cannot resolve `./useNames`.

- [ ] **Step 3: Write `src/lib/useNames.ts`**

```ts
'use client';
import { useEffect, useState } from 'react';

/** Batch-resolves profile names for the given addresses. Keys are lowercase. */
export function useNames(addresses: (string | null | undefined)[]): Record<string, string> {
  const key = [...new Set(
    addresses.filter((a): a is string => !!a).map((a) => a.toLowerCase()),
  )].sort().join(',');
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!key) return;
    let stale = false;
    fetch(`/api/names?addrs=${key}`)
      .then((r) => r.json())
      .then((d) => { if (!stale) setNames(d.names ?? {}); })
      .catch(() => {});
    return () => { stale = true; };
  }, [key]);
  return names;
}

export function displayName(names: Record<string, string>, address: string): string {
  return names[address.toLowerCase()] ?? `${address.slice(0, 8)}…`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- src/lib/useNames.test.ts`
Expected: PASS.

- [ ] **Step 5: Swap the three duel screens over**

In `src/app/duels/page.tsx` — add the import and, inside the component (it already uses hooks), resolve names for the listed creators:

```ts
import { useNames, displayName } from '@/lib/useNames';
// inside DuelsPage(), after the duels state is declared:
const names = useNames(duels.map((d) => d.creator));
```

Change the `who` line:

```ts
// old
const who = mine ? 'yours' : `${d.creator.slice(0, 8)}…${d.challengeTo ? ' · rematch' : ''}`;
// new
const who = mine ? 'yours' : `${displayName(names, d.creator)}${d.challengeTo ? ' · rematch' : ''}`;
```

In `src/app/duels/[id]/page.tsx` — add the same import, then inside the component:

```ts
const names = useNames([detail?.creator]);
```

Replace both address spans (lines ~276 and ~410):

```tsx
// old (both places)
<span className="mono">{detail.creator.slice(0, 8)}…</span>
// new (both places)
<span className="mono">{displayName(names, detail.creator)}</span>
```

In `src/app/duels/new/page.tsx` — add the same import, then inside the component:

```ts
const names = useNames([challenge]);
```

Replace the span:

```tsx
// old
<span className="mono">{challenge.slice(0, 8)}…</span>
// new
<span className="mono">{displayName(names, challenge)}</span>
```

- [ ] **Step 6: Type-check, lint, test, build**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: all clean. The build is the real gate — Next 16 may surface issues tsc misses.

- [ ] **Step 7: Manual browser check**

With the dev server running and the Task 5 e2e data recreated or a real profile set via `/play`: `/duels` shows names (or shortened addresses as fallback) in the list; a duel detail page shows the creator's name.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/useNames.ts frontend/src/lib/useNames.test.ts \
  frontend/src/app/duels/page.tsx "frontend/src/app/duels/[id]/page.tsx" \
  frontend/src/app/duels/new/page.tsx
git commit -m "feat(duels): show wallet usernames instead of raw addresses

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Final verification sweep

**Files:** none new.

- [ ] **Step 1: Full clean run**

Run: `cd frontend && npm test && npm run lint && npm run build`
Expected: everything passes. Paste the summary lines into the final report — no claims without output.

- [ ] **Step 2: Spec conformance check**

Re-read `docs/superpowers/specs/2026-07-22-wallet-username-design.md` section by section and confirm each decision landed: wallet-required save, unique case-insensitive names, free rename, names on duels + fame, per-action signatures, best-score-only storage, legacy table untouched, 400/401/409 error mapping. List any deviation in the report instead of silently accepting it.

- [ ] **Step 3: Confirm nothing writes `practice_scores` anymore**

Run: `cd frontend && grep -rn "practice_scores" src`
Expected: no matches (the only remaining mention is in `schema.sql`).

**Deploy note:** Deployment to Vercel and `git push` are NOT part of this plan — the owner pushes after their own review.
