-- Epic 4: two changes, both explained here per the plan reviewed before writing this
-- file.
--
-- 1. business_principals and business_affiliations were in 0007's blanket GRANT
--    SELECT/INSERT/UPDATE but never got ENABLE ROW LEVEL SECURITY or any policy at
--    all — the same class of gap relationships.repository.ts's own doc comment
--    already flags and defers to Epic 8. Unlike relationships, Epic 4 is the epic
--    that first puts broker-driven HTTP writes onto these two tables, so it's closed
--    here rather than deferred further, mirroring migration 0015's
--    association_memberships precedent.
--
-- 2. MODIFIES two existing, already-proven policies from 0007:
--    broker_businesses_visibility and broker_businesses_update currently key off
--    `ba.ended_at IS NULL`, but a merely-REQUESTED (unconfirmed) affiliation also has
--    ended_at IS NULL — nothing sets it until the affiliation actually ends. That
--    means today, a broker who has only *requested* to join a business — before
--    anyone there has confirmed they belong (BUS-005) — already gets full visibility
--    of it, and so does any lender linked to them. Migration 0018 added
--    business_affiliations.status specifically so this can be fixed: `ended_at IS
--    NULL` becomes `status = 'active'`, which correctly excludes pending rows.
--
-- IMPORTANT correction versus the first version of this migration: a policy on
-- business_affiliations that subqueries business_affiliations ITSELF (needed so an
-- already-active co-principal can see and confirm someone else's pending row) hits
-- Postgres's "infinite recursion detected in policy for relation" (42P17) —
-- unconditionally, regardless of whether the subquery is logically bounded. Worse,
-- because check_result_visibility and evidence_visibility's business-subject
-- branches also join through business_affiliations, that recursion error surfaced on
-- completely unrelated queries (e.g. inserting a check_result row) the moment RLS was
-- forced on this table — caught by running npm run demo:tenancy immediately after
-- applying, per the standing instruction to test after anything touching the
-- database. Fixed with the standard, documented workaround: a SECURITY DEFINER helper
-- function breaks the direct self-reference Postgres's planner is unwilling to prove
-- terminates, while still expressing exactly the same check. The function is owned by
-- the migration-runner role (superuser-equivalent, see migration 0007's comment on
-- POSTGRES_USER), so it bypasses RLS internally — intentional and narrow: it only
-- ever returns a boolean for one specific (business, broker) pair, never rows.

CREATE FUNCTION has_active_business_affiliation(p_broker_business_id UUID, p_broker_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM business_affiliations
    WHERE broker_business_id = p_broker_business_id
      AND broker_profile_id = p_broker_profile_id
      AND status = 'active'
  );
$$;

ALTER POLICY broker_businesses_visibility ON broker_businesses
  USING (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR EXISTS (
      SELECT 1 FROM business_affiliations ba
      WHERE ba.broker_business_id = broker_businesses.id
        AND ba.status = 'active'
        AND (
          (current_setting('app.actor_type', true) = 'broker'
           AND ba.broker_profile_id = NULLIF(current_setting('app.actor_id', true), '')::uuid)
          OR (
            current_setting('app.actor_type', true) = 'client_user'
            AND EXISTS (
              SELECT 1 FROM relationships r
              WHERE r.broker_profile_id = ba.broker_profile_id
                AND r.client_organisation_id = NULLIF(current_setting('app.client_organisation_id', true), '')::uuid
                AND r.status = 'active'
                AND r.effective_to IS NULL
                AND r.type IN ('lender_panel', 'aggregator_membership')
            )
          )
        )
    )
  );

ALTER POLICY broker_businesses_update ON broker_businesses
  USING (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR EXISTS (
      SELECT 1 FROM business_affiliations ba
      WHERE ba.broker_business_id = broker_businesses.id
        AND ba.status = 'active'
        AND current_setting('app.actor_type', true) = 'broker'
        AND ba.broker_profile_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
    )
  );

-- ---------------------------------------------------------------------------
-- business_affiliations: newly RLS-protected. Uses has_active_business_affiliation()
-- above wherever the check would otherwise self-reference this table.
-- ---------------------------------------------------------------------------

ALTER TABLE business_affiliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_affiliations FORCE ROW LEVEL SECURITY;

CREATE POLICY business_affiliations_visibility ON business_affiliations
  FOR SELECT
  USING (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR (
      current_setting('app.actor_type', true) = 'broker'
      AND broker_profile_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
    )
    OR (
      current_setting('app.actor_type', true) = 'broker'
      AND has_active_business_affiliation(
        broker_business_id, NULLIF(current_setting('app.actor_id', true), '')::uuid
      )
    )
    OR (
      current_setting('app.actor_type', true) = 'client_user'
      AND status = 'active'
      AND EXISTS (
        SELECT 1 FROM relationships r
        WHERE r.broker_profile_id = business_affiliations.broker_profile_id
          AND r.client_organisation_id = NULLIF(current_setting('app.client_organisation_id', true), '')::uuid
          AND r.status = 'active'
          AND r.effective_to IS NULL
          AND r.type IN ('lender_panel', 'aggregator_membership')
      )
    )
  );

-- A broker inserts only their own row (broker_profile_id = self) — the application
-- layer decides whether it lands 'active' (founding a new business) or
-- 'pending_confirmation' (requesting to join an existing one); RLS doesn't need to
-- distinguish those cases, that's business logic, not a tenancy boundary.
CREATE POLICY business_affiliations_insert ON business_affiliations
  FOR INSERT
  WITH CHECK (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR (
      current_setting('app.actor_type', true) = 'broker'
      AND broker_profile_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
    )
  );

-- A broker updates their own row (to end it — "leave") OR any row of a business they
-- hold an active affiliation to (to confirm a co-principal's pending row). The
-- application layer enforces the finer distinction (you may confirm someone else's
-- row, you may only end your own) — this is deliberately the coarser backstop, same
-- division of labour as everywhere else in this schema.
CREATE POLICY business_affiliations_update ON business_affiliations
  FOR UPDATE
  USING (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR (
      current_setting('app.actor_type', true) = 'broker'
      AND broker_profile_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
    )
    OR (
      current_setting('app.actor_type', true) = 'broker'
      AND has_active_business_affiliation(
        broker_business_id, NULLIF(current_setting('app.actor_id', true), '')::uuid
      )
    )
  );

-- ---------------------------------------------------------------------------
-- business_principals: newly RLS-protected. Same shape as evidence_visibility's
-- subject_type = 'broker_business' branch (0007) — visibility/writes gated on the
-- caller holding an active affiliation to the principal's business. Querying
-- business_affiliations from business_principals' own policy is NOT a self-reference
-- (different table), so this does not need the helper function.
-- ---------------------------------------------------------------------------

ALTER TABLE business_principals ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_principals FORCE ROW LEVEL SECURITY;

CREATE POLICY business_principals_visibility ON business_principals
  FOR SELECT
  USING (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR EXISTS (
      SELECT 1 FROM business_affiliations ba
      WHERE ba.broker_business_id = business_principals.broker_business_id
        AND ba.status = 'active'
        AND (
          (current_setting('app.actor_type', true) = 'broker'
           AND ba.broker_profile_id = NULLIF(current_setting('app.actor_id', true), '')::uuid)
          OR (
            current_setting('app.actor_type', true) = 'client_user'
            AND EXISTS (
              SELECT 1 FROM relationships r
              WHERE r.broker_profile_id = ba.broker_profile_id
                AND r.client_organisation_id = NULLIF(current_setting('app.client_organisation_id', true), '')::uuid
                AND r.status = 'active'
                AND r.effective_to IS NULL
                AND r.type IN ('lender_panel', 'aggregator_membership')
            )
          )
        )
    )
  );

CREATE POLICY business_principals_insert ON business_principals
  FOR INSERT
  WITH CHECK (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR (
      current_setting('app.actor_type', true) = 'broker'
      AND EXISTS (
        SELECT 1 FROM business_affiliations ba
        WHERE ba.broker_business_id = business_principals.broker_business_id
          AND ba.broker_profile_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
          AND ba.status = 'active'
      )
    )
  );

CREATE POLICY business_principals_update ON business_principals
  FOR UPDATE
  USING ( -- same shape as insert's broker branch — covers edits and removed_at soft-deletes alike
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR (
      current_setting('app.actor_type', true) = 'broker'
      AND EXISTS (
        SELECT 1 FROM business_affiliations ba
        WHERE ba.broker_business_id = business_principals.broker_business_id
          AND ba.broker_profile_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
          AND ba.status = 'active'
      )
    )
  );
