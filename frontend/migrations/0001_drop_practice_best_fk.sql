-- 0001_drop_practice_best_fk
--
-- A practice score belongs to an address, not to a claimed name. Dropping the
-- foreign key to profiles(address) lets a wallet that never set a name still
-- save a score and appear on the leaderboard under its generated alias.
--
-- Mirrors the practice_best block in schema.sql. Safe to re-run: `if exists`
-- makes it idempotent, and it touches no rows. Localhost and production share
-- one Neon database, so running this once applies to both.
--
-- Apply: Neon Console -> SQL Editor, or any Postgres client on DATABASE_URL.

alter table practice_best drop constraint if exists practice_best_address_fkey;

-- Verify: expect exactly one row, `practice_best_pkey`.
select conname from pg_constraint where conrelid = 'practice_best'::regclass;
