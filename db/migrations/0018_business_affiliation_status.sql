-- Epic 4, BUS-005: closes a real gap — business_affiliations.ended_at NULL currently
-- means "still current," but that's also true of a merely-REQUESTED affiliation that
-- nobody has confirmed yet. Nothing distinguishes "pending confirmation" from "active
-- and rights-granting" today. Adds the missing state, mirroring
-- relationships.status's existing enum-status idiom (migration 0004) rather than
-- inventing a new pattern for the second table in this schema that needs a lifecycle.
--
-- ended_at is untouched and keeps its existing meaning (the historical "when did it
-- end" timestamp, needed verbatim for BUS-015's "dates of each") — status becomes the
-- single source of truth for "does this affiliation currently grant anything," which
-- migration 0019 wires into RLS.

CREATE TYPE business_affiliation_status AS ENUM ('pending_confirmation', 'active', 'ended');

-- Default 'pending_confirmation' is the safe default for the column itself; every
-- INSERT in the application layer (businesses.repository.ts) always sets status
-- explicitly, so this default only matters for defensive correctness, not for any real
-- code path relying on it.
ALTER TABLE business_affiliations ADD COLUMN status business_affiliation_status NOT NULL DEFAULT 'pending_confirmation';

-- Rebuilt against status = 'active' since that's what every query and RLS policy
-- (migration 0019) now actually filters on — the old `ended_at IS NULL` partial index
-- would silently stop matching the new query shape and never be used.
DROP INDEX idx_affiliations_broker;
DROP INDEX idx_affiliations_business;
CREATE INDEX idx_affiliations_broker ON business_affiliations(broker_profile_id) WHERE status = 'active';
CREATE INDEX idx_affiliations_business ON business_affiliations(broker_business_id) WHERE status = 'active';
