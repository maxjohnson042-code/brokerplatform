-- Epic 2: close a gap left over from Epic 1's scaffolding. broker_profiles.email was
-- correctly declared CITEXT UNIQUE NOT NULL from the start (migration 0003); client_users
-- and platform_administrators were not, which means two rows with the same email could
-- exist for either today. That breaks "login by email" the moment it's more than a
-- single-row lookup, so fix it before Epic 2 builds sign-in against these tables.
--
-- Safe to run now: neither table has any real data yet (Epic 1 only proved the schema),
-- so there is no backfill/dedupe step required. If this ever needs to run against a
-- populated environment, check for duplicate emails first — the ADD CONSTRAINT will
-- fail loudly rather than silently corrupting data, which is the correct failure mode.

ALTER TABLE client_users ALTER COLUMN email SET NOT NULL;
ALTER TABLE client_users ADD CONSTRAINT client_users_email_key UNIQUE (email);

ALTER TABLE platform_administrators ALTER COLUMN email SET NOT NULL;
ALTER TABLE platform_administrators ADD CONSTRAINT platform_administrators_email_key UNIQUE (email);
