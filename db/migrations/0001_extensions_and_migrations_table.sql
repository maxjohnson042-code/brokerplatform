-- Epic 1: Platform foundations.
-- Extensions and the tracking table for the hand-rolled migration runner (db/migrate.ts).
-- We deliberately avoid an ORM's migration DSL here: Section 20.3's append-only /
-- temporal tables and Section 20.2's RLS policies are easiest to get right in plain SQL.

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";   -- case-insensitive email columns

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
