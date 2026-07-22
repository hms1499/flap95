# Wallet-bound usernames (design)

Date: 2026-07-22
Status: approved

## Problem

`POST /api/practice` accepts `{name, seed, taps}` from anyone. No wallet, no
signature, no rate limit: a curl loop can insert unlimited rows into
`practice_scores`, flood the Hall of Fame with fake names, and bloat the
database. Names are self-declared, so impersonation is trivial.

## Decisions (agreed with owner)

- Saving a practice score **requires a connected wallet**. Playing practice
  stays walletless; only saving needs a wallet.
- **One wallet = one username.** Usernames are globally unique,
  case-insensitive.
- A wallet may **rename freely** (to any name not already taken). Scores
  follow the wallet address, so old scores display the new name.
- Usernames display **everywhere**: Hall of Fame and duels (replacing
  shortened addresses, with the shortened address as fallback).
- Auth mechanism: **per-action message signatures** verified with viem's
  `verifyMessage`. No sessions, no SIWE, no on-chain registry.

## Data model

Additions to `frontend/schema.sql`:

```sql
create table if not exists profiles (
  address text primary key,          -- lowercase 0x address
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

- `practice_best` keeps **one row per wallet, best score only**
  (`greatest(old, new)` on upsert). This is the second anti-spam layer: even
  a valid wallet replaying requests cannot grow the table.
- Name rules: 1–16 chars after trim, matching
  `^[\p{L}\p{N} _.\-]{1,16}$` (Unicode letters/digits — Vietnamese names
  work — plus space, `_`, `.`, `-`; no control chars, no emoji).
- The legacy `practice_scores` table stops being read and stays as an
  archive. The Hall of Fame restarts empty — old anonymous rows have no
  wallet to attach a verified name to.

## API

- `POST /api/profile` — set or change name.
  Body `{address, name, timestamp, signature}`. Signed message:
  `flap95 set-name:<name> ts:<timestamp>`.
  Checks: timestamp within 10 minutes (replay guard), signature recovers to
  `address`, name passes rules, name not taken by another address
  (case-insensitive). Upserts the profile. `409` if the name is taken.
- `GET /api/profile?address=0x…` — returns `{name}` or `{name: null}`.
- `POST /api/practice` (changed) — body
  `{address, seed, taps, timestamp, signature}`. Signed message:
  `flap95 practice seed:<seed> taps:<keccak256(JSON.stringify(taps))> ts:<timestamp>`.
  Checks: signature and timestamp as above, `verifyRun(seed, taps)` as
  today, profile must exist. Upserts `practice_best`. The self-declared
  `name` field is removed.
- `GET /api/practice` (changed) — top 20 from `practice_best` joined with
  `profiles`, ordered by score.
- `GET /api/names?addrs=0x…,0x…` — batch map of address → name for duel
  screens.

## Client

- **Play page** (`src/app/play/page.tsx`): gameplay unchanged and
  walletless. Game-over dialog:
  - wallet not connected → "Connect wallet to save" (reuse existing connect
    UI);
  - connected, no profile → name input; first save signs two messages
    (set-name, then save-score);
  - connected with profile → single "Save as **<name>**" button, one
    signature.
- **Fame page**: same table shape; data now comes from verified profiles.
- **Duels**: new `Name` component — takes an address, shows the profile name
  when one exists, falls back to the shortened address, batch-fetches via
  `/api/names`. Swapped into the places that currently print raw addresses.

## Errors

- `401` — bad signature or stale timestamp.
- `409` — name already taken (UI says so and lets the user pick another).
- `400` — invalid run or malformed input (unchanged).

## Out of scope (known limits, deliberate)

- **Forged scores**: the seed is still client-chosen, so a real wallet can
  still fabricate a high score offline. Fix is server-issued seeds — a
  separate follow-up.
- **Sybil wallets**: creating wallets is free, so a determined attacker can
  still script many identities. Accepted; the bar is high enough for this
  game's size.

## Testing

Vitest (already set up): name-rule validation, signed-message construction
and verification (sign with a real key via viem's `privateKeyToAccount`),
route-handler logic with the store mocked. Wallet popup UX is verified
manually in the browser.
