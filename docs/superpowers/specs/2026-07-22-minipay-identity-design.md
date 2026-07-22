# MiniPay-compatible identity: on-chain names, server seeds, generated aliases (design)

Date: 2026-07-22
Status: approved

## Problem

MiniPay does not support `personal_sign` or `eth_signTypedData`
(`minipay-guide.md` → Important Constraints #4; `minipay-app-fit.md` scores it
a hard technical block). The identity work committed earlier today depends on
`personal_sign` for both of its flows:

- `src/app/play/page.tsx:50,60` — saving a practice score
- `src/app/profile/page.tsx:93` — setting or changing a name

Inside MiniPay both fail. A user can play but cannot keep a score and cannot
have a name. None of this is deployed yet (28 commits ahead of `origin/main`),
so no live user has hit it.

Two further problems surfaced while designing the fix:

**The signature never protected what we assumed it protected.** `POST
/api/practice` already replays the run server-side (`api/practice/route.ts:26`,
`verifyRun`) and stores the score *it* computes, so score integrity comes from
the engine, not the signature. Meanwhile the seed is chosen by the browser
(`play/page.tsx:9`, `Math.random()`) and accepted as given, so a solver can pick
a seed, compute an optimal tap sequence offline against the same deterministic
engine, and submit it — signed with its own key, perfectly valid. And
`upsertBest` only raises a score, so attributing a run to someone else's address
can only help them. The signature's only real function was preventing name
impersonation.

**Naming is mandatory today, structurally.** `profiles.name` is `not null` and
`practice_best.address` references `profiles(address)`, so an address with no
name cannot hold a score. That is why `api/practice/route.ts:24` returns
`no_profile`. A new player must claim a name *before* their first score can be
kept.

## Decisions (agreed with owner)

- **Names live on-chain** in a new `NameRegistry` contract. `msg.sender` is the
  proof of ownership, so impersonation becomes structurally impossible rather
  than check-dependent. MiniPay supports `eth_sendTransaction` and pays the
  network fee in USDm.
- **Practice scores need no signature.** A server-issued, HMAC'd seed replaces
  the client-chosen one, and a wall-clock floor rejects runs submitted faster
  than they could have been played.
- **Every address has a generated alias** derived from the address itself. No
  transaction, no signature, no registration. Claiming a real name is an
  optional upgrade that never gates play.
- **One path everywhere.** The signature machinery is deleted, not kept as a
  non-MiniPay branch. Two auth paths would double the surface and hide MiniPay
  breakage from local testing.
- **Copy rules apply**: no raw `0x…` in ordinary UI, "network fee" never "gas",
  no CELO anywhere user-facing.

## Contract

`contracts/src/NameRegistry.sol`:

```solidity
mapping(address => string) private _names;
event NameSet(address indexed owner, string name);

function setName(string calldata name) external {
    require(bytes(name).length > 0 && bytes(name).length <= 64, "bad length");
    _names[msg.sender] = name;
    emit NameSet(msg.sender, name);
}
function nameOf(address a) external view returns (string memory);
```

- **Byte bound only.** Character rules (`^[\p{L}\p{N} _.\-]{1,16}$`) stay in
  `normalizeName`. Unicode classification on-chain is expensive and would
  duplicate a rule that must exist off-chain anyway. 64 bytes covers 16
  characters at UTF-8's 3-byte worst case for Vietnamese, with margin.
- **No uniqueness on-chain.** Case-folding Unicode in Solidity is a trap.
  Uniqueness stays in the existing `profiles_name_lower_idx`, resolved by the
  order the server observes names in.
- **No owner, no admin, no upgrade path.** Nothing to compromise and nothing to
  rotate — deliberately unlike `DuelEscrow`.
- Deployed with the existing `script/Deploy.s.sol` pattern. The deploy script
  must reject forge-std's `DEFAULT_SENDER`
  (`0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38`) before broadcasting and assert
  the deployed code reads back, per the trap that cost 0.42 CELO on the escrow.
- Verified on Sourcify. Address exposed as `NEXT_PUBLIC_NAME_REGISTRY`.

## Generated aliases

`src/lib/alias.ts`, pure and shared by client and server:

```
aliasFor('0x5028f26d…97f9')  →  'SPARROW_A3F'
```

- Word chosen from a fixed 32-entry list by the address's first byte; suffix is
  the address's last three hex digits, uppercased.
- Deterministic and stateless: never stored, never registered, identical on both
  sides. Nothing to migrate, nothing to keep in sync.
- 32 × 4096 = 131,072 combinations. Collisions are possible and harmless: the
  alias is a display label, never a key. Ranking, scores and duels are always
  keyed by address.
- **`normalizeName` must reject the alias pattern** `^[A-Z]+_[0-9A-F]{3}$`.
  Without this, a user could claim `SPARROW_A3F` and impersonate whoever holds
  that address.

## Data model

```sql
alter table practice_best drop constraint if exists practice_best_address_fkey;
```

- `practice_best` becomes standalone, keyed by address. A score no longer
  requires a `profiles` row.
- `profiles` is unchanged and now holds **only claimed names**. Its absence is
  meaningful: it means "this address uses its alias".
- `topScores()` changes to a left join returning `{address, name: string | null,
  score}`. Callers render `name ?? aliasFor(address)`.
- The single existing `profiles` row ("noctokk") predates the registry and has
  no on-chain record. It stays; the owner re-claims it with one transaction if
  they want it backed on-chain.

## API

`GET /api/practice/seed` → `{ seed, token }`

- `seed`: server-generated with `crypto.randomInt(0, 2 ** 31)`, the same range
  `randomSeed()` used on the client.
- `token`: `<payload>.<hmac>` where `payload` is base64url of
  `${seed}.${issuedAt}` and `hmac` is HMAC-SHA256 of the payload under
  `SEED_SECRET`. Stateless — no table, no cleanup job.

`POST /api/practice` — body `{address, seed, taps, token}`, no signature.
Checks **in this order**, and the order is the security property:

1. Shape and bounds (`taps.length <= CONFIG.maxTaps`, address matches
   `^0x[0-9a-fA-F]{40}$`).
2. Token HMAC valid, and its embedded `seed` equals the submitted `seed`.
3. `now - issuedAt <= 600_000` (10 minutes).
4. `verifyRun(seed, taps)` — rejects an invalid trace.
5. **Wall-clock floor**: `now - issuedAt >= (deathTick / 60) * 1000 - 1500`.
   A run that lasted 90 seconds of game time cannot be submitted 3 seconds
   after the seed was issued. This is what a solver cannot fake; the signature
   never could.
6. `upsertBest(address, score)`.

Replaying the same token is deliberately allowed: same seed and taps produce
the same score, and `upsertBest` only raises, so a replay is a no-op. This
removes the need for a used-token table entirely.

`POST /api/profile` — body `{address}` only.

- The server calls `nameOf(address)` on the registry and takes **the chain's
  value**, ignoring anything the client claims. Then `normalizeName`,
  uniqueness check, upsert.
- Anyone may trigger a sync for any address. That is safe by construction: the
  value never comes from the caller.
- **When sync runs**: after a successful `setName` receipt, and again whenever
  `/profile` loads. The second call covers a transaction that landed while the
  page was closed — without it, a name claimed on-chain but never synced would
  stay invisible. It is a no-op when chain and DB already agree.

`GET /api/names` — unchanged. Returns claimed names only; the client falls back
to `aliasFor`.

## Client

- `play/page.tsx`: fetch `/api/practice/seed` instead of `randomSeed()`; drop
  `useSignMessage`; drop the "set a name first" gate; save on every completed
  run. Show the player's alias when they have no claimed name.
- `profile/page.tsx`: rename calls `writeContract(NameRegistry.setName)` with
  `feeCurrencyOverrides()`, waits for the receipt, then `POST /api/profile`.
  Copy states the network fee is paid in USDm. On a post-transaction 409:
  "that name was just taken — pick another and send again."
- `fame/page.tsx`: render `name ?? aliasFor(address)`.
- `useNames.ts`: `displayName` falls back to `aliasFor(address)` instead of the
  shortened address. After this change no raw `0x…` appears in ordinary UI. The
  full address stays on the user's **own** profile as fineprint — it is their
  own data and a legibility signal for reviewers.

## Deleted

`verifySignedAction`, `setNameMessage`, `practiceMessage`, `tapsHash` and their
tests. Roughly 120 lines written earlier today. The reason is not that they are
wrong but that they do not run on the target platform and were not buying the
integrity we credited them with.

## Errors

| Case | Response |
|---|---|
| Bad body shape | 400 `bad input` |
| Token HMAC mismatch or seed mismatch | 401 `bad token` |
| Token older than 10 minutes | 401 `stale token` |
| Invalid trace | 400 with the `TraceError` |
| Submitted faster than the run could be played | 400 `too fast` |
| Chain name fails `normalizeName` | 400 `bad_name`; DB unchanged, UI shows the alias |
| Name held by another address | 409 `taken` |
| Registry read fails | 502; the client keeps the old name and offers retry |

## Out of scope (deliberate)

- On-chain uniqueness of names.
- Rate limiting — belongs in the Vercel Firewall, a dashboard change the owner
  makes separately.
- A fully solver-proof leaderboard. The wall-clock floor raises the cost from
  "free" to "must burn real time per submission"; beating it requires a bot that
  plays in real time, which is a different and much smaller problem.
- Migrating the existing `noctokk` row to the registry.

## Testing

- **Forge**: `setName` stores and emits; empty name reverts; 65 bytes reverts;
  64 bytes succeeds; a second `setName` overwrites; two addresses are
  independent.
- **`aliasFor`**: deterministic across calls; format matches
  `^[A-Z]+_[0-9A-F]{3}$`; case-insensitive to input address casing; two known
  addresses produce two known aliases (pinned).
- **`normalizeName`**: rejects the reserved alias pattern; still accepts
  Vietnamese names with diacritics.
- **Seed token**: valid round-trip; tampered payload rejected; tampered hmac
  rejected; expired rejected; a run submitted before its own duration rejected;
  a run submitted after it accepted.
- **Route-level tests for `/api/practice` and `/api/profile`** — the outstanding
  debt from the wallet-username review. The check *order* is the security
  property here, and nothing else would catch a reordering.

## Risks

1. A cosmetic action now costs a transaction and ~5s of confirmation. Accepted:
   in exchange, nobody can name someone else's wallet, and naming is optional.
2. Chain and DB can diverge if a name is claimed by another address between the
   availability check and the transaction landing. The UI checks first and the
   window is small; the 409 message tells the user what happened.
3. This is the project's second mainnet contract. Re-read the `DEFAULT_SENDER`
   trap before deploying.
4. `POST /api/profile` now performs a chain read, so a Forno outage degrades
   renaming. Play, scores and the leaderboard are unaffected.
