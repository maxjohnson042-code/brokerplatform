-- Epic 1 / Epic 8: Row-level security — Section 20.2's "layer two".
--
-- "Layer one, application: every query touching broker data goes through a single
-- repository layer that requires an AuthorisationContext... Layer two, database:
-- Postgres row-level security policies on every broker-scoped table, keyed on a
-- session variable set per request... Belt and braces is proportionate here. A single
-- missed WHERE clause exposes one lender's panel to another."
--
-- IMPORTANT: the docker-compose Postgres user (POSTGRES_USER=thriski) is created as a
-- superuser-equivalent role and BYPASSES row-level security regardless of policy —
-- that's fine for running migrations, but it means RLS proves nothing unless the
-- application itself connects as a different, non-superuser role. This migration
-- creates that role. src/db/pool.ts must connect using thriski_app in every
-- environment except the migration runner.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'thriski_app') THEN
    -- Local dev password only. In any real environment this comes from a secret
    -- store, not source control — see README "Secrets" section.
    CREATE ROLE thriski_app LOGIN PASSWORD 'thriski_app_dev_only';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO thriski_app;
GRANT SELECT, INSERT, UPDATE ON
  client_organisations, client_users, platform_administrators,
  broker_profiles, association_memberships,
  broker_businesses, business_principals, business_affiliations,
  relationships,
  evidence, check_result, check_exceptions,
  audit_log, metering_event
TO thriski_app;
-- Deliberately no DELETE grant on evidence, check_result, audit_log or metering_event
-- anywhere in this schema — Sections 20.4/20.5 require those to be append-only in
-- practice, not just by convention. If a future migration needs to correct bad data in
-- one of these tables, that is a deliberate, logged, superuser operation — not
-- something the running application can ever do.

ALTER TABLE broker_profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE broker_profiles        FORCE ROW LEVEL SECURITY;
ALTER TABLE broker_businesses      ENABLE ROW LEVEL SECURITY;
ALTER TABLE broker_businesses      FORCE ROW LEVEL SECURITY;
ALTER TABLE association_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE association_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE evidence               ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence               FORCE ROW LEVEL SECURITY;
ALTER TABLE check_result           ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_result           FORCE ROW LEVEL SECURITY;

-- Session variables set per request by src/db/authorization-context.ts via SET LOCAL,
-- inside the same transaction as the query — never as a separate round trip, or a
-- connection-pool reuse bug becomes a cross-tenant leak.
--   app.actor_type            'broker' | 'client_user' | 'platform_admin' | 'system'
--   app.actor_id              uuid of the broker_profile or client_user row (or null)
--   app.client_organisation_id uuid, set only when actor_type = 'client_user'
--
-- current_setting(..., true) returns NULL rather than erroring when unset, which is
-- what we want: an unset variable should fail every policy closed, not open.

CREATE POLICY broker_profiles_visibility ON broker_profiles
  FOR SELECT
  USING (
    current_setting('app.actor_type', true) = 'system'
    OR current_setting('app.actor_type', true) = 'platform_admin'
    OR (
      current_setting('app.actor_type', true) = 'broker'
      AND id = NULLIF(current_setting('app.actor_id', true), '')::uuid
    )
    OR (
      current_setting('app.actor_type', true) = 'client_user'
      AND EXISTS (
        SELECT 1 FROM relationships r
        WHERE r.broker_profile_id = broker_profiles.id
          AND r.client_organisation_id = NULLIF(current_setting('app.client_organisation_id', true), '')::uuid
          AND r.status = 'active'
          AND r.effective_to IS NULL
          -- Section 2.2: an association-type relationship sees membership data only,
          -- not the full profile. This table is "full profile", so association
          -- relationships are excluded here — see association_memberships' own
          -- (more permissive) policy below.
          AND r.type IN ('lender_panel', 'aggregator_membership')
      )
    )
  );

CREATE POLICY broker_profiles_self_write ON broker_profiles
  FOR UPDATE
  USING (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR (current_setting('app.actor_type', true) = 'broker'
        AND id = NULLIF(current_setting('app.actor_id', true), '')::uuid)
  );

CREATE POLICY broker_profiles_insert ON broker_profiles
  FOR INSERT
  WITH CHECK (current_setting('app.actor_type', true) IN ('system', 'broker', 'platform_admin'));

-- Association relationships DO see membership status (that is the association's whole
-- function per Section 2.3), even though they are excluded from the full-profile
-- policy above.
CREATE POLICY association_memberships_visibility ON association_memberships
  FOR SELECT
  USING (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR (
      current_setting('app.actor_type', true) = 'broker'
      AND broker_profile_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
    )
    OR (
      current_setting('app.actor_type', true) = 'client_user'
      AND EXISTS (
        SELECT 1 FROM relationships r
        WHERE r.broker_profile_id = association_memberships.broker_profile_id
          AND r.client_organisation_id = NULLIF(current_setting('app.client_organisation_id', true), '')::uuid
          AND r.status = 'active'
          AND r.effective_to IS NULL
          -- every relationship type may see association standing (Section 2.5): a
          -- lender needs it directly, an aggregator needs it, and an association
          -- naturally sees its own members' membership rows.
      )
    )
  );
CREATE POLICY association_memberships_write ON association_memberships
  FOR INSERT WITH CHECK (current_setting('app.actor_type', true) IN ('system', 'broker', 'platform_admin', 'client_user'));

-- BUS-018: a lender sees the business a linked broker operates through. Visibility is
-- via the broker's affiliation, not a direct relationship to the business itself —
-- there is no such thing as a client-to-business relationship in the domain model
-- (Section 5.3).
CREATE POLICY broker_businesses_visibility ON broker_businesses
  FOR SELECT
  USING (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR EXISTS (
      SELECT 1 FROM business_affiliations ba
      WHERE ba.broker_business_id = broker_businesses.id
        AND ba.ended_at IS NULL
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
CREATE POLICY broker_businesses_write ON broker_businesses
  FOR INSERT WITH CHECK (current_setting('app.actor_type', true) IN ('system', 'broker', 'platform_admin'));
CREATE POLICY broker_businesses_update ON broker_businesses
  FOR UPDATE
  USING (current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR EXISTS (
      SELECT 1 FROM business_affiliations ba
      WHERE ba.broker_business_id = broker_businesses.id
        AND ba.ended_at IS NULL
        AND current_setting('app.actor_type', true) = 'broker'
        AND ba.broker_profile_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
    ));

-- Evidence and check_result: Section 2.4's "evidence visibility" requirement — a
-- linked client must see the FULL result and evidence, not a summary. Visibility
-- mirrors broker_profiles/broker_businesses depending on subject_type, so this is
-- necessarily a broader policy than a simple ownership check.
CREATE POLICY evidence_visibility ON evidence
  FOR SELECT
  USING (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR (
      subject_type = 'broker_profile' AND (
        (current_setting('app.actor_type', true) = 'broker'
         AND subject_id = NULLIF(current_setting('app.actor_id', true), '')::uuid)
        OR (current_setting('app.actor_type', true) = 'client_user' AND EXISTS (
          SELECT 1 FROM relationships r
          WHERE r.broker_profile_id = evidence.subject_id
            AND r.client_organisation_id = NULLIF(current_setting('app.client_organisation_id', true), '')::uuid
            AND r.status = 'active' AND r.effective_to IS NULL
            AND r.type IN ('lender_panel', 'aggregator_membership')
        ))
      )
    )
    OR (
      subject_type = 'broker_business' AND EXISTS (
        SELECT 1 FROM business_affiliations ba
        JOIN relationships r ON r.broker_profile_id = ba.broker_profile_id
        WHERE ba.broker_business_id = evidence.subject_id
          AND ba.ended_at IS NULL
          AND current_setting('app.actor_type', true) = 'client_user'
          AND r.client_organisation_id = NULLIF(current_setting('app.client_organisation_id', true), '')::uuid
          AND r.status = 'active' AND r.effective_to IS NULL
          AND r.type IN ('lender_panel', 'aggregator_membership')
      )
    )
  );
CREATE POLICY evidence_insert ON evidence
  FOR INSERT WITH CHECK (current_setting('app.actor_type', true) IN ('system', 'platform_admin'));
  -- Evidence is written by the verification module on the system's own authority
  -- (a broker or client user never inserts evidence rows directly) — see Section 21.

CREATE POLICY check_result_visibility ON check_result
  FOR SELECT
  USING (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR (
      subject_type = 'broker_profile' AND (
        (current_setting('app.actor_type', true) = 'broker'
         AND subject_id = NULLIF(current_setting('app.actor_id', true), '')::uuid)
        OR (current_setting('app.actor_type', true) = 'client_user' AND EXISTS (
          SELECT 1 FROM relationships r
          WHERE r.broker_profile_id = check_result.subject_id
            AND r.client_organisation_id = NULLIF(current_setting('app.client_organisation_id', true), '')::uuid
            AND r.status = 'active' AND r.effective_to IS NULL
            AND r.type IN ('lender_panel', 'aggregator_membership')
        ))
      )
    )
    OR (
      subject_type = 'broker_business' AND EXISTS (
        SELECT 1 FROM business_affiliations ba
        JOIN relationships r ON r.broker_profile_id = ba.broker_profile_id
        WHERE ba.broker_business_id = check_result.subject_id
          AND ba.ended_at IS NULL
          AND current_setting('app.actor_type', true) = 'client_user'
          AND r.client_organisation_id = NULLIF(current_setting('app.client_organisation_id', true), '')::uuid
          AND r.status = 'active' AND r.effective_to IS NULL
          AND r.type IN ('lender_panel', 'aggregator_membership')
      )
    )
  );
CREATE POLICY check_result_insert ON check_result
  FOR INSERT WITH CHECK (current_setting('app.actor_type', true) IN ('system', 'platform_admin'));

COMMENT ON POLICY broker_profiles_visibility ON broker_profiles IS
  'Reference implementation of Section 20.2''s visibility resolution for ONE table. '
  'Epic 8 should extract the repeated relationship-lookup subquery into a SQL '
  'function (e.g. has_active_relationship(broker_id, client_org_id, allowed_types[])) '
  'once a third or fourth table needs the same shape — do not let it drift into five '
  'slightly-different inline copies.';
