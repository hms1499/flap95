create table if not exists duels (
  id serial primary key,
  onchain_id bigint unique,
  seed integer not null,
  stake_wei numeric,
  token text,
  creator text not null,
  acceptor text,
  status text not null default 'draft',
  creator_taps jsonb,
  creator_score integer,
  acceptor_taps jsonb,
  acceptor_score integer,
  challenge_to text,
  winner text,
  settle_tx text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists duels_status_idx on duels (status);
create index if not exists duels_status_updated_idx on duels (status, updated_at);
-- listDuelsForAddress (/api/me) matches `creator = $1 or acceptor = $1`; Postgres BitmapOrs
-- these two. Unindexed it is a seq scan plus a full sort on every call, and /api/me needs no
-- signature, so anyone could drive that scan as fast as they can issue requests.
create index if not exists duels_creator_created_idx on duels (creator, created_at desc);
create index if not exists duels_acceptor_created_idx on duels (acceptor, created_at desc);

-- Survival time in engine ticks (60/s), used to break tied scores.
-- Nullable on purpose: rows that predate these columns settle under the score-only rule.
alter table duels add column if not exists creator_death_tick integer;
alter table duels add column if not exists acceptor_death_tick integer;

-- LEGACY: anonymous practice scores. No longer read or written since the
-- wallet-username change (2026-07-22); kept as an archive.
create table if not exists practice_scores (
  id serial primary key,
  name text not null,
  score integer not null,
  created_at timestamptz not null default now()
);

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
