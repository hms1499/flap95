# MiniPay-compatible identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every `personal_sign` dependency so the app works inside MiniPay, replacing it with on-chain names, server-issued practice seeds, and a generated alias for every address.

**Architecture:** Names move to a tiny ownerless `NameRegistry` contract where `msg.sender` is the proof of ownership; the server reads the chain and treats its own `profiles` table as an index. Practice scores drop signatures entirely and are protected by a server-issued HMAC'd seed plus a wall-clock floor that a solver cannot fake. Every address gets a deterministic alias computed from its own bytes, so naming becomes optional instead of a precondition for keeping a score.

**Tech Stack:** Next.js 16 (App Router), React 19, wagmi 3 + viem 2, Neon serverless Postgres, Vitest, Foundry (solc 0.8.26, optimizer runs 200), Celo mainnet.

**Spec:** `docs/superpowers/specs/2026-07-22-minipay-identity-design.md`

## Global Constraints

- **MiniPay supports no message signing.** `personal_sign` and `eth_signTypedData` must not appear anywhere in the final code.
- **No raw `0x…` in ordinary UI.** The only exception is the full address on the user's own profile page, as fineprint.
- **Copy rules:** "network fee", never "gas". No CELO in any user-facing string. Say "stablecoin" or the token symbol.
- **Legacy transactions only.** Never set `maxFeePerGas` / `maxPriorityFeePerGas` on a user transaction. Use the existing `feeCurrencyOverrides()` helper.
- **Name rules:** 1–16 characters after trim, matching `^[\p{L}\p{N} _.\-]{1,16}$`, plus the new reserved-alias rejection.
- **All addresses passed to `profileStore` must already be lowercase.**
- Every task ends with `npx tsc --noEmit` clean and `npm test` green before its commit. Frontend commands run in `frontend/`; forge commands run in `contracts/`.
- Commit directly to `main`. No feature branches. Do not `git push` — that deploys production and needs the owner's explicit go-ahead.

---

### Task 1: `aliasFor` and the reserved-name rule

**Files:**
- Create: `frontend/src/lib/alias.ts`
- Create: `frontend/src/lib/alias.test.ts`
- Modify: `frontend/src/lib/profile.ts` (the `normalizeName` function)
- Modify: `frontend/src/lib/profile.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `aliasFor(address: string): string` and `ALIAS_RE: RegExp`. Later tasks call `aliasFor` from both client components and server routes; it must stay pure and free of browser or node APIs.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/alias.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { aliasFor, ALIAS_RE } from './alias';

describe('aliasFor', () => {
  it('pins known addresses to known aliases', () => {
    // Regenerating the word list changes these. That is the point: they are the
    // canary for a change that would silently rename every player at once.
    expect(aliasFor('0x5028f26d8c3c0b3d88ab730ef98fef8f4d2f97f9')).toBe('RUFFLED_7F9');
    expect(aliasFor('0x66f744af7b1d1218031c83cb2c62eba7e6138ed8')).toBe('FEATHER_ED8');
    expect(aliasFor('0x64Ad61211C1b0B7f20B3e04B49661f30f152ae78')).toBe('SKYLARK_E78');
  });

  it('ignores the casing of the input address', () => {
    const lower = aliasFor('0x66f744af7b1d1218031c83cb2c62eba7e6138ed8');
    const upper = aliasFor('0x66F744AF7B1D1218031C83CB2C62EBA7E6138ED8');
    expect(upper).toBe(lower);
  });

  it('is deterministic across calls', () => {
    const a = '0x0000000000000000000000000000000000000001';
    expect(aliasFor(a)).toBe(aliasFor(a));
  });

  it('always produces the reserved shape', () => {
    for (let i = 0; i < 64; i++) {
      const addr = `0x${i.toString(16).padStart(2, '0')}${'ab'.repeat(19)}`;
      expect(aliasFor(addr), addr).toMatch(ALIAS_RE);
    }
  });

  it('falls back rather than throwing on a malformed address', () => {
    // Display code must never crash a page over a bad row.
    expect(aliasFor('not-an-address')).toBe('PLAYER_000');
    expect(aliasFor('')).toBe('PLAYER_000');
  });
});
```

Append to `frontend/src/lib/profile.test.ts`:

```ts
describe('normalizeName vs generated aliases', () => {
  it('rejects a name shaped like a generated alias', () => {
    // Without this, anyone could claim RUFFLED_7F9 and impersonate the wallet
    // that alias belongs to.
    expect(normalizeName('RUFFLED_7F9').ok).toBe(false);
    expect(normalizeName('PLAYER_000').ok).toBe(false);
  });

  it('still accepts ordinary names that merely resemble one', () => {
    expect(normalizeName('Ruffled_7f9').ok).toBe(true);   // not all-caps
    expect(normalizeName('RUFFLED_7F9A').ok).toBe(true);  // four hex chars
    expect(normalizeName('RUFFLED').ok).toBe(true);       // no suffix
  });

  it('still accepts Vietnamese names', () => {
    expect(normalizeName('Đổi Tên OK').ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/alias.test.ts src/lib/profile.test.ts`
Expected: FAIL — `alias.test.ts` cannot resolve `./alias`; the three `normalizeName` alias cases fail because the reserved rule does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/alias.ts`:

```ts
/**
 * A display name for an address that has not claimed one.
 *
 * Derived from the address, not stored anywhere: no transaction, no signature,
 * no registration, and identical on the client and the server. Its only job is
 * to keep raw 0x addresses out of the UI (a MiniPay copy rule) and to let a
 * player appear on the leaderboard before deciding whether they want a real
 * name.
 *
 * Collisions are possible (32 words x 4096 suffixes) and harmless: this is a
 * label, never a key. Scores, duels and ranking are keyed by address.
 */
const WORDS = [
  'SPARROW', 'TAILWIND', 'PIPEDREAM', 'BRASSCOG', 'SKYLARK', 'DRIFTER', 'FEATHER', 'JETSTREAM',
  'CLOUDHOP', 'WINGNUT', 'GLIDER', 'THERMAL', 'UPDRAFT', 'CRESTED', 'SWIFTBEAK', 'PLUMAGE',
  'RUFFLED', 'NESTEGG', 'TALON', 'FLYWAY', 'PERCH', 'ROOST', 'QUILL', 'DOWNDRAFT',
  'SKIMMER', 'SOARER', 'HOLLOWBONE', 'WINGBEAT', 'PIPEFITTER', 'GREENPIPE', 'GOLDCREST', 'PIXELWING',
] as const;

/** The shape every generated alias takes. `normalizeName` rejects claimed names matching it. */
export const ALIAS_RE = /^[A-Z]+_[0-9A-F]{3}$/;

export function aliasFor(address: string): string {
  const hex = address.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{40}$/.test(hex)) return 'PLAYER_000';
  const word = WORDS[parseInt(hex.slice(0, 2), 16) % WORDS.length];
  return `${word}_${hex.slice(-3).toUpperCase()}`;
}
```

In `frontend/src/lib/profile.ts`, import the pattern and reject it inside `normalizeName`:

```ts
import { ALIAS_RE } from './alias';
```

```ts
export function normalizeName(
  raw: string,
): { ok: true; name: string } | { ok: false; error: 'bad_name' } {
  const name = raw.normalize('NFC').trim();
  if (!NAME_RE.test(name)) return { ok: false, error: 'bad_name' };
  // Generated aliases are not claimable: allowing one would let a stranger
  // impersonate whichever wallet that alias is derived from.
  if (ALIAS_RE.test(name)) return { ok: false, error: 'bad_name' };
  return { ok: true, name };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/alias.test.ts src/lib/profile.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
cd /Users/vanhuy/Desktop/celo-game
git add frontend/src/lib/alias.ts frontend/src/lib/alias.test.ts frontend/src/lib/profile.ts frontend/src/lib/profile.test.ts
git commit -m "feat(identity): generated aliases, and reserve their shape from claimed names"
```

---

### Task 2: `NameRegistry` contract

**Files:**
- Create: `contracts/src/NameRegistry.sol`
- Create: `contracts/test/NameRegistry.t.sol`
- Create: `contracts/script/DeployNameRegistry.s.sol`

**Interfaces:**
- Consumes: nothing.
- Produces: a deployed contract exposing `setName(string calldata)` and `nameOf(address) returns (string memory)`, plus `event NameSet(address indexed owner, string name)`. Task 7 encodes this ABI in TypeScript.

- [ ] **Step 1: Write the failing test**

Create `contracts/test/NameRegistry.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {NameRegistry} from "../src/NameRegistry.sol";

contract NameRegistryTest is Test {
    NameRegistry reg;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    event NameSet(address indexed owner, string name);

    function setUp() public {
        reg = new NameRegistry();
    }

    function test_setName_storesAndEmits() public {
        vm.expectEmit(true, false, false, true);
        emit NameSet(alice, "noctokk");
        vm.prank(alice);
        reg.setName("noctokk");
        assertEq(reg.nameOf(alice), "noctokk");
    }

    function test_unsetAddressReturnsEmpty() public view {
        assertEq(reg.nameOf(bob), "");
    }

    function test_addressesAreIndependent() public {
        vm.prank(alice);
        reg.setName("alice");
        vm.prank(bob);
        reg.setName("bob");
        assertEq(reg.nameOf(alice), "alice");
        assertEq(reg.nameOf(bob), "bob");
    }

    function test_setNameOverwrites() public {
        vm.startPrank(alice);
        reg.setName("first");
        reg.setName("second");
        vm.stopPrank();
        assertEq(reg.nameOf(alice), "second");
    }

    function test_emptyNameReverts() public {
        vm.prank(alice);
        vm.expectRevert(bytes("bad length"));
        reg.setName("");
    }

    function test_64BytesOk_65Reverts() public {
        // 16 Vietnamese characters can reach 48 UTF-8 bytes; 64 leaves margin.
        string memory ok = _repeat("a", 64);
        string memory tooLong = _repeat("a", 65);
        vm.startPrank(alice);
        reg.setName(ok);
        assertEq(bytes(reg.nameOf(alice)).length, 64);
        vm.expectRevert(bytes("bad length"));
        reg.setName(tooLong);
        vm.stopPrank();
    }

    function test_multibyteNameSurvivesRoundTrip() public {
        vm.prank(alice);
        reg.setName(unicode"Đổi Tên");
        assertEq(reg.nameOf(alice), unicode"Đổi Tên");
    }

    function _repeat(string memory ch, uint256 n) internal pure returns (string memory out) {
        for (uint256 i = 0; i < n; i++) out = string.concat(out, ch);
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd contracts && forge test --match-contract NameRegistryTest`
Expected: FAIL — `Source "src/NameRegistry.sol" not found`.

- [ ] **Step 3: Write the contract**

Create `contracts/src/NameRegistry.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * Wallet-owned display names.
 *
 * MiniPay supports no message signing, so a signature cannot prove who owns an
 * address. A transaction can: msg.sender is the proof, which makes
 * impersonation structurally impossible rather than check-dependent.
 *
 * Deliberately minimal:
 *  - No owner, no admin, no upgrade path. Nothing to compromise or rotate.
 *  - Only a byte-length bound. Character rules (1-16 Unicode letters, digits,
 *    space, _ . -) live in normalizeName off-chain, where they are needed
 *    anyway; classifying Unicode on-chain would be expensive and duplicated.
 *  - No uniqueness. Case-folding Unicode in Solidity is a trap; uniqueness is
 *    an index concern and stays in the app's database.
 */
contract NameRegistry {
    mapping(address => string) private _names;

    event NameSet(address indexed owner, string name);

    function setName(string calldata name) external {
        uint256 len = bytes(name).length;
        require(len > 0 && len <= 64, "bad length");
        _names[msg.sender] = name;
        emit NameSet(msg.sender, name);
    }

    function nameOf(address a) external view returns (string memory) {
        return _names[a];
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd contracts && forge test --match-contract NameRegistryTest -vv`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the deploy script**

Create `contracts/script/DeployNameRegistry.s.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {NameRegistry} from "../src/NameRegistry.sol";

contract DeployNameRegistry is Script {
    function run() external {
        vm.startBroadcast();
        NameRegistry reg = new NameRegistry();
        vm.stopBroadcast();

        // No constructor arguments and no owner, so the DEFAULT_SENDER trap that
        // produced a permanently ownerless escrow cannot apply here. Still read
        // the deployed code back: a script that "succeeds" without deploying is
        // the failure mode this project has already paid for once.
        require(address(reg).code.length > 0, "no code at deployed address");
        console.log("NameRegistry:", address(reg));
    }
}
```

- [ ] **Step 6: Commit the contract**

```bash
cd /Users/vanhuy/Desktop/celo-game
git add contracts/src/NameRegistry.sol contracts/test/NameRegistry.t.sol contracts/script/DeployNameRegistry.s.sol
git commit -m "feat(contracts): NameRegistry — wallet-owned names without message signing"
```

- [ ] **Step 7: STOP — ask the owner before deploying**

Deployment spends real CELO on Celo mainnet and is not reversible. Do not run this without an explicit go-ahead in this session.

When approved, run from `contracts/`:

```bash
forge script script/DeployNameRegistry.s.sol:DeployNameRegistry \
  --rpc-url https://forno.celo.org \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast --verify --verifier sourcify
```

Record the printed address, then add it to `frontend/.env.local` and to Vercel production:

```
NEXT_PUBLIC_NAME_REGISTRY=0x…
```

Verify the deployment before continuing:

```bash
cast call <ADDRESS> "nameOf(address)(string)" 0x0000000000000000000000000000000000000001 --rpc-url https://forno.celo.org
```

Expected: an empty string, which proves the contract exists and answers.

---

### Task 3: Seed token

**Files:**
- Create: `frontend/src/lib/seedToken.ts`
- Create: `frontend/src/lib/seedToken.test.ts`

**Interfaces:**
- Consumes: `CONFIG.ticksPerSecond` from `@/engine/engine` (value 60).
- Produces:
  - `issueSeedToken(seed: number, issuedAt: number, secret: string): string`
  - `verifySeedToken(token: string, secret: string, now: number): { ok: true; seed: number; issuedAt: number } | { ok: false; error: 'bad_token' | 'stale_token' }`
  - `submittedTooFast(deathTick: number, issuedAt: number, now: number): boolean`
  - `SEED_TTL_MS` (600000), `SUBMIT_SLACK_MS` (1500)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/seedToken.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { issueSeedToken, verifySeedToken, submittedTooFast, SEED_TTL_MS } from './seedToken';

const SECRET = 'test-secret';
const T0 = 1_800_000_000_000;

describe('seed token', () => {
  it('round-trips a seed and its issue time', () => {
    const token = issueSeedToken(12345, T0, SECRET);
    expect(verifySeedToken(token, SECRET, T0 + 1000)).toEqual({ ok: true, seed: 12345, issuedAt: T0 });
  });

  it('rejects a tampered payload', () => {
    const token = issueSeedToken(1, T0, SECRET);
    const forged = `${Buffer.from('999.' + T0).toString('base64url')}.${token.split('.')[1]}`;
    expect(verifySeedToken(forged, SECRET, T0)).toEqual({ ok: false, error: 'bad_token' });
  });

  it('rejects a tampered signature', () => {
    const token = issueSeedToken(1, T0, SECRET);
    expect(verifySeedToken(`${token.split('.')[0]}.deadbeef`, SECRET, T0))
      .toEqual({ ok: false, error: 'bad_token' });
  });

  it('rejects a token signed with a different secret', () => {
    const token = issueSeedToken(1, T0, 'other-secret');
    expect(verifySeedToken(token, SECRET, T0)).toEqual({ ok: false, error: 'bad_token' });
  });

  it('rejects malformed input without throwing', () => {
    expect(verifySeedToken('', SECRET, T0)).toEqual({ ok: false, error: 'bad_token' });
    expect(verifySeedToken('nodot', SECRET, T0)).toEqual({ ok: false, error: 'bad_token' });
  });

  it('expires after the TTL', () => {
    const token = issueSeedToken(7, T0, SECRET);
    expect(verifySeedToken(token, SECRET, T0 + SEED_TTL_MS)).toMatchObject({ ok: true });
    expect(verifySeedToken(token, SECRET, T0 + SEED_TTL_MS + 1)).toEqual({ ok: false, error: 'stale_token' });
  });

  it('rejects a token issued in the future', () => {
    const token = issueSeedToken(7, T0, SECRET);
    expect(verifySeedToken(token, SECRET, T0 - 1)).toEqual({ ok: false, error: 'stale_token' });
  });
});

describe('submittedTooFast', () => {
  it('rejects a long run submitted moments after the seed was issued', () => {
    // 1800 ticks at 60/s is 30 seconds of play; 2 seconds is not enough.
    expect(submittedTooFast(1800, T0, T0 + 2000)).toBe(true);
  });

  it('accepts a run submitted after at least its own duration', () => {
    expect(submittedTooFast(1800, T0, T0 + 30_000)).toBe(false);
  });

  it('allows a small slack for network and clock drift', () => {
    // 30s of play submitted at 29s is allowed; at 28s it is not.
    expect(submittedTooFast(1800, T0, T0 + 29_000)).toBe(false);
    expect(submittedTooFast(1800, T0, T0 + 28_000)).toBe(true);
  });

  it('never blocks a very short run', () => {
    expect(submittedTooFast(30, T0, T0 + 10)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/seedToken.test.ts`
Expected: FAIL — cannot resolve `./seedToken`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/seedToken.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { CONFIG } from '@/engine/engine';

/**
 * A practice seed the server issued, carried by the client and handed back with
 * the run.
 *
 * Replaces the browser-chosen seed. Letting the client pick meant a solver
 * could choose a seed, compute an optimal tap sequence offline against this
 * same deterministic engine, and submit a run that verifies perfectly — which
 * the old per-run signature did nothing to prevent, because the solver signs
 * with its own key.
 *
 * Stateless on purpose: an HMAC plus an embedded issue time needs no table and
 * no cleanup job. Reusing a token is harmless — the same seed and taps produce
 * the same score, and upsertBest only ever raises one.
 */
export const SEED_TTL_MS = 600_000;

/** Tolerance for network latency and clock drift on the wall-clock floor. */
export const SUBMIT_SLACK_MS = 1_500;

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function issueSeedToken(seed: number, issuedAt: number, secret: string): string {
  const payload = Buffer.from(`${seed}.${issuedAt}`).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export type SeedTokenResult =
  | { ok: true; seed: number; issuedAt: number }
  | { ok: false; error: 'bad_token' | 'stale_token' };

export function verifySeedToken(token: string, secret: string, now: number): SeedTokenResult {
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return { ok: false, error: 'bad_token' };

  const expected = sign(payload, secret);
  const given = Buffer.from(mac);
  const want = Buffer.from(expected);
  // Length must match before timingSafeEqual, which throws on a mismatch.
  if (given.length !== want.length || !timingSafeEqual(given, want))
    return { ok: false, error: 'bad_token' };

  const [seedStr, issuedStr] = Buffer.from(payload, 'base64url').toString().split('.');
  const seed = Number(seedStr);
  const issuedAt = Number(issuedStr);
  if (!Number.isInteger(seed) || !Number.isInteger(issuedAt)) return { ok: false, error: 'bad_token' };

  // A token from the future is as suspect as an expired one.
  if (now < issuedAt || now - issuedAt > SEED_TTL_MS) return { ok: false, error: 'stale_token' };
  return { ok: true, seed, issuedAt };
}

/**
 * True when a run could not physically have been played in the time between the
 * seed being issued and the score arriving.
 *
 * This is the check a solver cannot satisfy cheaply: it can find a perfect tap
 * sequence in milliseconds, but it cannot make 30 seconds of game time pass in
 * 2 seconds of wall time.
 */
export function submittedTooFast(deathTick: number, issuedAt: number, now: number): boolean {
  const playedMs = (deathTick / CONFIG.ticksPerSecond) * 1000;
  return now - issuedAt < playedMs - SUBMIT_SLACK_MS;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/seedToken.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Add the secret to the environment**

Generate one and append it to `frontend/.env.local` (gitignored):

```bash
cd /Users/vanhuy/Desktop/celo-game/frontend
echo "SEED_SECRET=$(openssl rand -hex 32)" >> .env.local
```

Tell the owner it must also be set in Vercel production before deploying. The route in Task 4 fails closed without it.

- [ ] **Step 6: Commit**

```bash
cd /Users/vanhuy/Desktop/celo-game
git add frontend/src/lib/seedToken.ts frontend/src/lib/seedToken.test.ts
git commit -m "feat(practice): server-issued seed tokens with a wall-clock floor"
```

---

### Task 4: Practice API — issue seeds, accept runs without a signature

**Files:**
- Modify: `frontend/vitest.config.ts`
- Create: `frontend/src/app/api/practice/seed/route.ts`
- Modify: `frontend/src/app/api/practice/route.ts`
- Create: `frontend/src/app/api/practice/route.test.ts`

**Interfaces:**
- Consumes: `issueSeedToken`, `verifySeedToken`, `submittedTooFast` (Task 3); `verifyRun` from `@/engine/verify`; `upsertBest` from `@/lib/profileStore`.
- Produces: `GET /api/practice/seed` → `{ seed: number, token: string }`; `POST /api/practice` accepting `{address, seed, taps, token}`.

- [ ] **Step 1: Teach Vitest the `@/` alias**

Route files import via `@/…`, which Vitest cannot resolve today. Replace `frontend/vitest.config.ts` with:

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
});
```

Run: `cd frontend && npm test`
Expected: still green (122 tests). This step only adds resolution.

- [ ] **Step 2: Write the failing route test**

Create `frontend/src/app/api/practice/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// The store is mocked so these tests never touch Neon — localhost shares one
// database with production. `topScores` must be mocked too even though these
// tests never call it: the route module's GET handler imports it, and a mock
// factory that omits an imported name fails the import itself.
const upsertBest = vi.fn();
vi.mock('@/lib/profileStore', () => ({
  upsertBest: (a: string, s: number) => upsertBest(a, s),
  topScores: async () => [],
}));

process.env.SEED_SECRET = 'test-secret';

const { POST } = await import('./route');
const { issueSeedToken } = await import('@/lib/seedToken');
const { verifyRun } = await import('@/engine/verify');

const ADDRESS = '0x5028f26d8c3c0b3d88ab730ef98fef8f4d2f97f9';
const SEED = 12345;
// An empty tap list is a real, verifiable run: the bird falls and dies.
const TAPS: number[] = [];
const RUN = verifyRun(SEED, TAPS);
if (!RUN.ok) throw new Error('fixture run must verify');

function post(body: unknown): Promise<Response> {
  return POST(new Request('http://test/api/practice', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
}

/** A submission that arrives long enough after the seed to clear the wall-clock floor. */
function validBody(overrides: Record<string, unknown> = {}) {
  const issuedAt = Date.now() - 120_000;
  return {
    address: ADDRESS, seed: SEED, taps: TAPS,
    token: issueSeedToken(SEED, issuedAt, 'test-secret'),
    ...overrides,
  };
}

beforeEach(() => upsertBest.mockReset());

describe('POST /api/practice', () => {
  it('accepts a valid run and stores the score the server computed', async () => {
    const res = await post(validBody());
    expect(res.status).toBe(200);
    expect(upsertBest).toHaveBeenCalledWith(ADDRESS.toLowerCase(), RUN.score);
  });

  it('needs no signature and no profile — a nameless wallet can score', async () => {
    const body = validBody();
    expect('signature' in body).toBe(false);
    expect((await post(body)).status).toBe(200);
  });

  it('rejects a forged token before replaying anything', async () => {
    const res = await post(validBody({ token: 'forged.token' }));
    expect(res.status).toBe(401);
    expect(upsertBest).not.toHaveBeenCalled();
  });

  it('rejects a token whose seed does not match the submitted seed', async () => {
    // Otherwise a valid token could carry any seed the client preferred.
    const res = await post(validBody({ seed: SEED + 1 }));
    expect(res.status).toBe(401);
    expect(upsertBest).not.toHaveBeenCalled();
  });

  it('rejects an expired token', async () => {
    const stale = issueSeedToken(SEED, Date.now() - 700_000, 'test-secret');
    const res = await post(validBody({ token: stale }));
    expect(res.status).toBe(401);
    expect(upsertBest).not.toHaveBeenCalled();
  });

  it('rejects a run that could not have been played in the elapsed time', async () => {
    const justIssued = issueSeedToken(SEED, Date.now(), 'test-secret');
    const res = await post(validBody({ token: justIssued }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'too_fast' });
    expect(upsertBest).not.toHaveBeenCalled();
  });

  it('rejects an invalid trace', async () => {
    const res = await post(validBody({ taps: [5, 5, 5] })); // not strictly increasing
    expect(res.status).toBe(400);
    expect(upsertBest).not.toHaveBeenCalled();
  });

  it('rejects a malformed address', async () => {
    const res = await post(validBody({ address: 'nope' }));
    expect(res.status).toBe(400);
    expect(upsertBest).not.toHaveBeenCalled();
  });

  it('rejects a tap list longer than the engine cap without replaying it', async () => {
    const res = await post(validBody({ taps: Array.from({ length: 901 }, (_, i) => i * 5) }));
    expect(res.status).toBe(400);
    expect(upsertBest).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/app/api/practice/route.test.ts`
Expected: FAIL — the current route requires `timestamp` and `signature`, so every case returns 400 or 401.

If the failure is instead an import error from `next/server`, stop and report it: the fallback is to move the handler body into a pure `submitPractice(body, now)` in `src/lib/practiceSubmit.ts` and test that instead, leaving the route as a three-line adapter.

- [ ] **Step 4: Write the seed route**

Create `frontend/src/app/api/practice/seed/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { randomInt } from 'node:crypto';
import { issueSeedToken } from '@/lib/seedToken';

/** Hands out a seed the server chose, with a token binding it to an issue time. */
export async function GET() {
  const secret = process.env.SEED_SECRET;
  if (!secret) return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
  const seed = randomInt(0, 2 ** 31);
  return NextResponse.json({ seed, token: issueSeedToken(seed, Date.now(), secret) });
}
```

- [ ] **Step 5: Rewrite the practice route**

Replace the `POST` handler in `frontend/src/app/api/practice/route.ts`. Keep the existing `GET`, which returns the leaderboard — so `topScores` stays in the import list even though `POST` does not use it, and `getName` goes (the `no_profile` gate is deliberately removed):

```ts
import { NextResponse } from 'next/server';
import { verifyRun } from '@/engine/verify';
import { upsertBest, topScores } from '@/lib/profileStore';
import { verifySeedToken, submittedTooFast } from '@/lib/seedToken';
import { CONFIG } from '@/engine/engine';

/**
 * Saving a practice score.
 *
 * No signature: MiniPay cannot produce one, and the one we had did not protect
 * what it appeared to. The score is whatever the server's own replay computes,
 * the seed must be one the server issued, and the run must have taken at least
 * as long as it claims to have lasted.
 *
 * The order of the checks below is the security property. Do not reorder:
 * cheap rejections first, replay only after the token proves the seed is ours,
 * and the wall-clock floor last because it needs the replayed deathTick.
 */
export async function POST(req: Request) {
  const secret = process.env.SEED_SECRET;
  if (!secret) return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });

  const body = await req.json().catch(() => null);
  if (body === null || typeof body !== 'object')
    return NextResponse.json({ error: 'bad input' }, { status: 400 });

  const { address, seed, taps, token } = body as Record<string, unknown>;
  if (
    typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address) ||
    typeof seed !== 'number' || typeof token !== 'string' ||
    !Array.isArray(taps) || taps.length > CONFIG.maxTaps
  )
    return NextResponse.json({ error: 'bad input' }, { status: 400 });

  const now = Date.now();
  const t = verifySeedToken(token, secret, now);
  if (!t.ok) return NextResponse.json({ error: t.error }, { status: 401 });
  if (t.seed !== seed) return NextResponse.json({ error: 'bad_token' }, { status: 401 });

  const r = verifyRun(seed, taps as number[]);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });

  if (submittedTooFast(r.deathTick, t.issuedAt, now))
    return NextResponse.json({ error: 'too_fast' }, { status: 400 });

  await upsertBest(address.toLowerCase(), r.score);
  return NextResponse.json({ ok: true, score: r.score });
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/app/api/practice/route.test.ts`
Expected: PASS, 9 tests.

Then the full suite: `npm test` — expected green, and `npx tsc --noEmit` clean.

- [ ] **Step 7: Commit**

```bash
cd /Users/vanhuy/Desktop/celo-game
git add frontend/vitest.config.ts frontend/src/app/api/practice
git commit -m "feat(api): practice scores without signatures, seeds issued by the server"
```

Note for the next task: the app is knowingly broken between here and Task 5 — `play/page.tsx` still posts a signature and no token, so saving returns 401 until it is rewired.

---

### Task 5: Play page — no signature, no name gate

**Files:**
- Modify: `frontend/src/app/play/page.tsx`

**Interfaces:**
- Consumes: `GET /api/practice/seed`, `POST /api/practice` (Task 4); `aliasFor` (Task 1).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Rewrite the page**

Replace `frontend/src/app/play/page.tsx` entirely:

```tsx
'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAccount, useConnect } from 'wagmi';
import { Window } from '@/components/Window';
import { Dialog95 } from '@/components/Dialog95';
import { GameCanvas } from '@/components/GameCanvas';
import { aliasFor } from '@/lib/alias';

interface Seed { seed: number; token: string }

export default function PlayPage() {
  const [seed, setSeed] = useState<Seed | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [result, setResult] = useState<{ taps: number[]; score: number } | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();

  // Every run plays a seed the server issued. A browser-chosen seed could be
  // solved offline before the run was ever played.
  const loadSeed = useCallback(async () => {
    setSeed(null);
    try {
      const res = await fetch('/api/practice/seed');
      if (!res.ok) throw new Error('bad status');
      setSeed(await res.json());
    } catch {
      setError('Could not start a round. Check your connection and try again.');
    }
  }, []);

  useEffect(() => { void loadSeed(); }, [loadSeed]);

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
    if (!result || !address || !seed) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/practice', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, seed: seed.seed, taps: result.taps, token: seed.token }),
      });
      if (!res.ok) { setError('Could not save your score. Try again.'); return; }
      setSaved(true);
    } catch {
      setError('Could not save your score. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function again() {
    setResult(null); setSaved(false); setError(null);
    await loadSeed();
    setRunKey((k) => k + 1);
  }

  const shownAs = profileName ?? (address ? aliasFor(address) : null);

  return (
    <main className="desktop">
      <Window title="PRACTICE.EXE — tap to flap">
        {seed === null
          ? <p>Loading…</p>
          : <GameCanvas key={runKey} seed={seed.seed} onRunEnd={onRunEnd} />}
      </Window>
      <Dialog95 title="Game over" open={result !== null}>
        <p>⚠️ You scored <b>{result?.score}</b>.</p>
        {saved ? (
          <p>Saved to the Hall of Fame as <b>{shownAs}</b>.</p>
        ) : !isConnected ? (
          <button onClick={() => connectors[0] && connect({ connector: connectors[0] })}>
            💰 Connect to keep your score
          </button>
        ) : (
          <button onClick={save} disabled={busy}>
            {busy ? 'Saving…' : `Save score as ${shownAs}`}
          </button>
        )}
        {shownAs !== null && !profileName && !saved && (
          <p className="fineprint">
            You appear as <b>{shownAs}</b>. Want your own name? Set it on your profile.
          </p>
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

- [ ] **Step 2: Gates**

Run in `frontend/`:

```bash
npx tsc --noEmit && npm test && npx eslint src
```

Expected: tsc clean; tests green; eslint reports no *new* problems (the pre-existing count was 12 before this plan — record the number you see and compare).

- [ ] **Step 3: Verify by hand**

Start the dev server (`npm run dev`), open `http://localhost:3000/play` at a 360×640 viewport, play one run to death, and confirm:
- no wallet dialog appears at any point,
- the button reads "Save score as <ALIAS>",
- after saving, the line reads "Saved to the Hall of Fame as <ALIAS>",
- "Play again" starts a round with a different seed (the score dialog closes and the canvas resets).

- [ ] **Step 4: Commit**

```bash
cd /Users/vanhuy/Desktop/celo-game
git add frontend/src/app/play/page.tsx
git commit -m "feat(play): save a score with no signature and no name required"
```

---

### Task 6: Database — scores without a profile

**Files:**
- Modify: `frontend/schema.sql`
- Modify: `frontend/src/lib/profileStore.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `topScores(): Promise<{ address: string; name: string | null; score: number }[]>` — note the changed shape; Task 8 renders it.

- [ ] **Step 1: Update the schema file**

In `frontend/schema.sql`, replace the `practice_best` block with:

```sql
-- A score belongs to an address, not to a claimed name: a player who never sets
-- a name still appears on the leaderboard, under their generated alias.
create table if not exists practice_best (
  address text primary key,
  score integer not null,
  updated_at timestamptz not null default now()
);
alter table practice_best drop constraint if exists practice_best_address_fkey;
```

- [ ] **Step 2: Update `topScores`**

In `frontend/src/lib/profileStore.ts`, replace `topScores`:

```ts
/**
 * The leaderboard. Left join because a score no longer requires a claimed name;
 * callers render `name ?? aliasFor(address)`.
 */
export async function topScores(): Promise<{ address: string; name: string | null; score: number }[]> {
  const rows = await sql`select b.address, p.name, b.score
    from practice_best b left join profiles p on p.address = b.address
    order by b.score desc, b.updated_at asc limit 20`;
  return rows.map((r) => ({
    address: r.address as string,
    name: (r.name as string | null) ?? null,
    score: Number(r.score),
  }));
}
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: FAIL in `src/app/fame/page.tsx`, which still expects `{name, score}`. That is correct and is fixed in Task 8. To keep this task self-contained, update the page's local type now:

In `frontend/src/app/fame/page.tsx` change the state type to
`useState<{ address: string; name: string | null; score: number }[]>([])`
and render `{s.name ?? s.address}` as a temporary placeholder — Task 8 replaces it with the alias.

Re-run: `npx tsc --noEmit` — expected clean.

- [ ] **Step 4: STOP — apply the migration to Neon**

This writes to the production database (localhost and production share one). Ask the owner before running.

When approved, from `frontend/`:

```bash
set -a && . ./.env.local && set +a && npx tsx -e "
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL);
await sql\`alter table practice_best drop constraint if exists practice_best_address_fkey\`;
console.log(await sql\`select conname from pg_constraint where conrelid = 'practice_best'::regclass\`);
"
```

Expected: the printed constraint list contains only the primary key.

- [ ] **Step 5: Commit**

```bash
cd /Users/vanhuy/Desktop/celo-game
git add frontend/schema.sql frontend/src/lib/profileStore.ts frontend/src/app/fame/page.tsx
git commit -m "feat(db): a practice score no longer requires a claimed name"
```

---

### Task 7: Registry wiring and the chain-reading profile route

**Files:**
- Modify: `frontend/src/lib/contracts.ts`
- Modify: `frontend/src/app/api/profile/route.ts`

**Interfaces:**
- Consumes: `publicClient` from `@/lib/chain`; `normalizeName` (Task 1); `setName`, `getName` from `@/lib/profileStore`; the deployed address from `NEXT_PUBLIC_NAME_REGISTRY` (Task 2).
- Produces: `NAME_REGISTRY_ADDRESS` and `nameRegistryAbi` exported from `@/lib/contracts`; `POST /api/profile` accepting `{address}` alone.

- [ ] **Step 1: Add the registry to contracts.ts**

Append to `frontend/src/lib/contracts.ts`:

```ts
export const NAME_REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_NAME_REGISTRY as `0x${string}`;

export const nameRegistryAbi = [
  { type: 'function', name: 'setName', stateMutability: 'nonpayable',
    inputs: [{ name: 'name', type: 'string' }], outputs: [] },
  { type: 'function', name: 'nameOf', stateMutability: 'view',
    inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'string' }] },
] as const;
```

- [ ] **Step 2: Rewrite the profile POST handler**

Replace the `POST` handler in `frontend/src/app/api/profile/route.ts` (keep `GET` as is):

```ts
import { NextResponse } from 'next/server';
import { normalizeName } from '@/lib/profile';
import { getName, setName } from '@/lib/profileStore';
import { publicClient } from '@/lib/chain';
import { NAME_REGISTRY_ADDRESS, nameRegistryAbi } from '@/lib/contracts';

/**
 * Syncs a wallet's on-chain name into the local index.
 *
 * The body carries an address and nothing else: the name is read from the
 * registry, never accepted from the caller. That is why this endpoint needs no
 * authentication — anyone may ask the server to re-read the chain for any
 * address, and the answer is the same either way.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (body === null || typeof body !== 'object')
    return NextResponse.json({ error: 'bad input' }, { status: 400 });

  const { address } = body as Record<string, unknown>;
  if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address))
    return NextResponse.json({ error: 'bad input' }, { status: 400 });
  const addr = address.toLowerCase();

  let onchain: string;
  try {
    onchain = await publicClient.readContract({
      address: NAME_REGISTRY_ADDRESS, abi: nameRegistryAbi,
      functionName: 'nameOf', args: [addr as `0x${string}`],
    });
  } catch (e) {
    console.error('registry read failed', e);
    return NextResponse.json({ error: 'chain_unreachable' }, { status: 502 });
  }

  // Never set: nothing to sync. The client falls back to the generated alias.
  if (onchain === '') return NextResponse.json({ name: await getName(addr) });

  // A name can be written directly to the contract without passing through our
  // rules, so it is validated here before it is allowed into the index.
  const n = normalizeName(onchain);
  if (!n.ok) return NextResponse.json({ error: 'bad_name' }, { status: 400 });

  const r = await setName(addr, n.name);
  if (r === 'taken') return NextResponse.json({ error: 'name_taken' }, { status: 409 });
  return NextResponse.json({ name: n.name });
}
```

- [ ] **Step 3: Gates**

Run in `frontend/`: `npx tsc --noEmit && npm test`
Expected: tsc clean, tests green.

- [ ] **Step 4: Verify against the deployed registry**

Requires Task 2's deployment and `NEXT_PUBLIC_NAME_REGISTRY` in `.env.local`. With the dev server running:

```bash
curl -s -X POST http://localhost:3000/api/profile \
  -H 'content-type: application/json' \
  -d '{"address":"0x0000000000000000000000000000000000000001"}'
```

Expected: `{"name":null}` — proving the route reaches the chain and treats an unset name as "no name" rather than an error.

- [ ] **Step 5: Commit**

```bash
cd /Users/vanhuy/Desktop/celo-game
git add frontend/src/lib/contracts.ts frontend/src/app/api/profile/route.ts
git commit -m "feat(api): read names from the registry instead of verifying signatures"
```

---

### Task 8: Profile, Hall of Fame, and the display fallback

**Files:**
- Modify: `frontend/src/app/profile/page.tsx`
- Modify: `frontend/src/app/fame/page.tsx`
- Modify: `frontend/src/lib/useNames.ts`
- Modify: `frontend/src/lib/useNames.test.ts`

**Interfaces:**
- Consumes: `aliasFor` (Task 1); `NAME_REGISTRY_ADDRESS`, `nameRegistryAbi` (Task 7); `feeCurrencyOverrides` from `@/lib/minipay`; `topScores`'s new shape (Task 6).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Change the display fallback**

In `frontend/src/lib/useNames.ts`:

```ts
import { aliasFor } from './alias';
```

```ts
/** A claimed name if there is one, otherwise the address's generated alias. */
export function displayName(names: Record<string, string>, address: string): string {
  return names[address.toLowerCase()] ?? aliasFor(address);
}
```

Update `frontend/src/lib/useNames.test.ts`: any case asserting the shortened-address fallback now expects `aliasFor(address)`. Import `aliasFor` and assert against it rather than hardcoding a string, so the two stay in step.

- [ ] **Step 2: Rename via transaction on the profile page**

In `frontend/src/app/profile/page.tsx`, replace the wagmi imports and the `rename` function.

Imports:

```tsx
import { useAccount, useConnect, useWriteContract, usePublicClient } from 'wagmi';
import { NAME_REGISTRY_ADDRESS, nameRegistryAbi } from '@/lib/contracts';
import { feeCurrencyOverrides } from '@/lib/minipay';
import { aliasFor } from '@/lib/alias';
```

Hooks (replacing `useSignMessage`):

```tsx
const { writeContractAsync } = useWriteContract();
const publicClient = usePublicClient();
```

The function:

```tsx
async function rename() {
  if (!address || !publicClient) return;
  const n = normalizeName(draftName);
  if (!n.ok) { setError('Name: 1–16 letters, digits, space, _ . -'); return; }
  setError(null);
  setSaved(false);
  setBusy(true);
  try {
    const hash = await writeContractAsync({
      address: NAME_REGISTRY_ADDRESS, abi: nameRegistryAbi,
      functionName: 'setName', args: [n.name],
      ...feeCurrencyOverrides(),
    });
    await publicClient.waitForTransactionReceipt({ hash });
    // The name is now on-chain; ask the server to read it back into the index.
    const res = await fetch('/api/profile', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address }),
    });
    if (res.status === 409) {
      setError('That name was just taken — pick another and send again.');
      return;
    }
    if (!res.ok) { setError('Saved on-chain, but the index did not update. Reload to retry.'); return; }
    setMe((m) => (m ? { ...m, name: n.name } : m));
    setDraftName('');
    setSaved(true);
  } catch {
    setError('The transaction was cancelled or did not go through.');
  } finally {
    setBusy(false);
  }
}
```

Copy changes in the same file:
- The identity line shows `me.name ?? aliasFor(address ?? '')`, so a nameless wallet reads as its alias rather than "No name yet".
- The fieldset legend stays as it is.
- Replace the existing fineprint under the input with:
  `Your scores follow your wallet, so renaming keeps them. Setting a name is a transaction — the network fee is paid in USDm. Your old name becomes free for anyone else to take.`
- The busy label becomes `Confirming…` rather than `Signing…`.

- [ ] **Step 3: Sync on load**

Still in `frontend/src/app/profile/page.tsx`, inside the existing load effect, fire a sync so a name claimed while the page was closed appears:

```tsx
useEffect(() => {
  if (!address) return;
  // Covers a setName transaction that landed while this page was not open.
  void fetch('/api/profile', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address }),
  }).then(() => load()).catch(() => {});
}, [address, load]);
```

- [ ] **Step 4: Hall of Fame renders aliases**

In `frontend/src/app/fame/page.tsx`, import `aliasFor` and render
`{s.name ?? aliasFor(s.address)}`, replacing the temporary placeholder from Task 6. Change the row key to `s.address`.

- [ ] **Step 5: Gates**

Run in `frontend/`: `npx tsc --noEmit && npm test && npx eslint src && npm run build`
Expected: tsc clean, tests green, no new lint problems, build "Compiled successfully".

- [ ] **Step 6: Verify by hand**

With the dev server running, at a 360×640 viewport:
- `/fame` lists at least one entry rendered as an alias, not as `0x…`.
- `/profile` with a nameless wallet shows the alias as the identity line.
- Renaming prompts exactly one wallet **transaction** and no signature dialog, and the new name appears afterwards.
- Grep the built output for leaks: `grep -rn "personal_sign\|signMessage" src/` must return nothing.

- [ ] **Step 7: Commit**

```bash
cd /Users/vanhuy/Desktop/celo-game
git add frontend/src/app/profile/page.tsx frontend/src/app/fame/page.tsx frontend/src/lib/useNames.ts frontend/src/lib/useNames.test.ts
git commit -m "feat(identity): names set on-chain, aliases everywhere else"
```

---

### Task 9: Delete the signature machinery and sweep

**Files:**
- Modify: `frontend/src/lib/profile.ts`
- Modify: `frontend/src/lib/profile.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Confirm nothing still uses them**

Run in `frontend/`:

```bash
grep -rn "verifySignedAction\|setNameMessage\|practiceMessage\|tapsHash\|useSignMessage" src/
```

Expected: matches only inside `src/lib/profile.ts` and `src/lib/profile.test.ts`. If anything else appears, that call site was missed — fix it before deleting.

- [ ] **Step 2: Delete**

From `frontend/src/lib/profile.ts` remove `SIG_FRESH_MS`, `tapsHash`, `setNameMessage`, `practiceMessage`, `verifySignedAction`, and the now-unused `viem` imports. `normalizeName`, `NAME_RE` and the `ALIAS_RE` rejection stay.

From `frontend/src/lib/profile.test.ts` remove the describe blocks covering the deleted functions. Keep every `normalizeName` case.

- [ ] **Step 3: Full gate run**

Run in `frontend/`:

```bash
npx tsc --noEmit && npm test && npx eslint src && npm run build
```

Expected: tsc clean; tests green (the count drops by however many signature tests were removed — record it); no new lint problems; build "Compiled successfully".

- [ ] **Step 4: Verify against the spec**

Re-read `docs/superpowers/specs/2026-07-22-minipay-identity-design.md` and confirm each of these, writing down what you observed:
- no `personal_sign` or `eth_signTypedData` anywhere in `src/`,
- no raw `0x…` in ordinary UI (the profile page's own-address fineprint is the allowed exception),
- no user-facing string containing "gas" or "CELO",
- `/api/practice` check order matches the spec's numbered list,
- a nameless wallet can play, save a score, and appear on the leaderboard.

- [ ] **Step 5: STOP — MiniPay device check**

This is the whole point of the plan and cannot be verified on a desktop. Ask the owner to run it: expose the dev server (`ngrok http 3000`), open MiniPay → Developer Mode → Load Test Page with the HTTPS URL, then confirm on the device that a full round can be played and saved with **no wallet prompt at all**, and that setting a name opens a transaction the wallet pays in USDm.

Report exactly what the owner observed. Do not describe this plan as verified until that happens.

- [ ] **Step 6: Commit**

```bash
cd /Users/vanhuy/Desktop/celo-game
git add frontend/src/lib/profile.ts frontend/src/lib/profile.test.ts
git commit -m "refactor(identity): delete the signature machinery MiniPay cannot run"
```
