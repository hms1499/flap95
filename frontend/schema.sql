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

create table if not exists practice_scores (
  id serial primary key,
  name text not null,
  score integer not null,
  created_at timestamptz not null default now()
);
