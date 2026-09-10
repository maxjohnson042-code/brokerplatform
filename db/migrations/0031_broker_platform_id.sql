-- A permanent, platform-wide identifier for a broker — distinct from broker_profiles.id
-- (an internal primary key, never meant to be treated as the broker's "membership
-- number") and distinct from accreditations.lender_issued_id (a per-accreditation,
-- per-lender reference the LENDER assigns, already modelled separately). This one is
-- system-generated, once, the first time ANY of a broker's accreditations reaches
-- 'active' — see training.repository.ts's activateAccreditation, which sets this via
-- COALESCE (idempotent: a broker's second/third activation with a different lender
-- never regenerates it). Nullable until then — a broker who has never been accredited
-- anywhere has no platform_broker_id, by design.
--
-- No RLS change needed: broker_profiles_visibility (migration 0021) already governs
-- this whole row for both the broker's own view and a related lender's view via
-- getBrokerProfile (the single actor-agnostic function both call) — adding a column
-- here does not widen who can read the row, only what's in it once they can.

ALTER TABLE broker_profiles ADD COLUMN platform_broker_id UUID UNIQUE;
