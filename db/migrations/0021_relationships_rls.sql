-- Epic 8: three changes, all reviewed as one coherent piece of relationship-visibility
-- work before writing this file.
--
-- 1. relationships itself has NEVER had row-level security — migration 0007's
--    comment on relationships.repository.ts flagged this as a deliberate, visible gap
--    ("close this in Epic 8"), not an oversight. Every other tenant-scoped table has
--    had layer-two RLS since Epic 1; this table has relied on layer one
--    (AuthorizationContext) alone until now.
--
-- 2. The extraction migration 0007's own COMMENT ON POLICY already named:
--    "Epic 8 should extract the repeated relationship-lookup subquery into a SQL
--    function... once a third or fourth table needs the same shape." Six now do
--    (broker_profiles, association_memberships, broker_businesses, evidence x2,
--    check_result x2). has_active_relationship() below is that function, SECURITY
--    DEFINER for the same reasoning as has_active_business_affiliation() (migration
--    0019) even though this one isn't self-referential — it's called FROM other
--    tables' policies, never from relationships' own.
--
-- 3. A THIRD occurrence of a bug already fixed twice: check_result_visibility's
--    business-subject branch still used `ba.ended_at IS NULL`, the same "a pending,
--    unconfirmed affiliation satisfies this too" bug fixed in
--    broker_businesses_visibility/update (migration 0019) and evidence_visibility
--    (migration 0020). Missed both previous times because neither of those epics was
--    looking at check results. Fixed here the same way: `ba.status = 'active'`.

CREATE FUNCTION has_active_relationship(
  p_broker_profile_id UUID,
  p_client_organisation_id UUID,
  p_allowed_types TEXT[] DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM relationships r
    WHERE r.broker_profile_id = p_broker_profile_id
      AND r.client_organisation_id = p_client_organisation_id
      AND r.status = 'active'
      AND r.effective_to IS NULL
      AND (p_allowed_types IS NULL OR r.type::text = ANY (p_allowed_types)) -- r.type is the relationship_type enum; cast to compare against the plain TEXT[] param
  );
$$;

ALTER POLICY broker_profiles_visibility ON broker_profiles
  USING (
    current_setting('app.actor_type', true) = 'system'
    OR current_setting('app.actor_type', true) = 'platform_admin'
    OR (
      current_setting('app.actor_type', true) = 'broker'
      AND id = NULLIF(current_setting('app.actor_id', true), '')::uuid
    )
    OR (
      current_setting('app.actor_type', true) = 'client_user'
      AND has_active_relationship(
        id,
        NULLIF(current_setting('app.client_organisation_id', true), '')::uuid,
        ARRAY['lender_panel', 'aggregator_membership']
      )
    )
  );

ALTER POLICY association_memberships_visibility ON association_memberships
  USING (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR (
      current_setting('app.actor_type', true) = 'broker'
      AND broker_profile_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
    )
    OR (
      current_setting('app.actor_type', true) = 'client_user'
      -- No type restriction, unchanged from the original policy: every relationship
      -- type may see association standing (Section 2.5).
      AND has_active_relationship(
        broker_profile_id,
        NULLIF(current_setting('app.client_organisation_id', true), '')::uuid
      )
    )
  );

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
            AND has_active_relationship(
              ba.broker_profile_id,
              NULLIF(current_setting('app.client_organisation_id', true), '')::uuid,
              ARRAY['lender_panel', 'aggregator_membership']
            )
          )
        )
    )
  );

ALTER POLICY evidence_visibility ON evidence
  USING (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR (
      subject_type = 'broker_profile' AND (
        (current_setting('app.actor_type', true) = 'broker'
         AND subject_id = NULLIF(current_setting('app.actor_id', true), '')::uuid)
        OR (current_setting('app.actor_type', true) = 'client_user' AND has_active_relationship(
          evidence.subject_id,
          NULLIF(current_setting('app.client_organisation_id', true), '')::uuid,
          ARRAY['lender_panel', 'aggregator_membership']
        ))
      )
    )
    OR (
      subject_type = 'broker_business' AND (
        (current_setting('app.actor_type', true) = 'broker' AND EXISTS (
          SELECT 1 FROM business_affiliations ba
          WHERE ba.broker_business_id = evidence.subject_id
            AND ba.broker_profile_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
            AND ba.status = 'active'
        ))
        OR (current_setting('app.actor_type', true) = 'client_user' AND EXISTS (
          SELECT 1 FROM business_affiliations ba
          WHERE ba.broker_business_id = evidence.subject_id
            AND ba.status = 'active'
            AND has_active_relationship(
              ba.broker_profile_id,
              NULLIF(current_setting('app.client_organisation_id', true), '')::uuid,
              ARRAY['lender_panel', 'aggregator_membership']
            )
        ))
      )
    )
  );

ALTER POLICY check_result_visibility ON check_result
  USING (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR (
      subject_type = 'broker_profile' AND (
        (current_setting('app.actor_type', true) = 'broker'
         AND subject_id = NULLIF(current_setting('app.actor_id', true), '')::uuid)
        OR (current_setting('app.actor_type', true) = 'client_user' AND has_active_relationship(
          check_result.subject_id,
          NULLIF(current_setting('app.client_organisation_id', true), '')::uuid,
          ARRAY['lender_panel', 'aggregator_membership']
        ))
      )
    )
    OR (
      subject_type = 'broker_business' AND EXISTS (
        SELECT 1 FROM business_affiliations ba
        WHERE ba.broker_business_id = check_result.subject_id
          AND ba.status = 'active' -- fixed from ba.ended_at IS NULL — see file header
          AND (
            (current_setting('app.actor_type', true) = 'broker'
             AND ba.broker_profile_id = NULLIF(current_setting('app.actor_id', true), '')::uuid)
            OR (current_setting('app.actor_type', true) = 'client_user' AND has_active_relationship(
              ba.broker_profile_id,
              NULLIF(current_setting('app.client_organisation_id', true), '')::uuid,
              ARRAY['lender_panel', 'aggregator_membership']
            ))
          )
      )
    )
  );

-- relationships' own RLS: straightforward ownership, no self-reference. A broker sees
-- their own rows (any status — REL-005's "one view" includes history); a client_user
-- sees their own organisation's rows, same reasoning.
ALTER TABLE relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE relationships FORCE ROW LEVEL SECURITY;

CREATE POLICY relationships_visibility ON relationships
  FOR SELECT
  USING (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR (
      current_setting('app.actor_type', true) = 'broker'
      AND broker_profile_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
    )
    OR (
      current_setting('app.actor_type', true) = 'client_user'
      AND client_organisation_id = NULLIF(current_setting('app.client_organisation_id', true), '')::uuid
    )
  );

CREATE POLICY relationships_insert ON relationships
  FOR INSERT
  WITH CHECK (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR (
      current_setting('app.actor_type', true) = 'broker'
      AND broker_profile_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
    )
    OR (
      current_setting('app.actor_type', true) = 'client_user'
      AND client_organisation_id = NULLIF(current_setting('app.client_organisation_id', true), '')::uuid
    )
  );

CREATE POLICY relationships_update ON relationships
  FOR UPDATE
  USING ( -- same ownership shape as insert/select — accept/decline/revoke (broker), end (client_user)
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR (
      current_setting('app.actor_type', true) = 'broker'
      AND broker_profile_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
    )
    OR (
      current_setting('app.actor_type', true) = 'client_user'
      AND client_organisation_id = NULLIF(current_setting('app.client_organisation_id', true), '')::uuid
    )
  );
