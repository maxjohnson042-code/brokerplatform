-- Epic 2: extend Section 20.2's "layer two" RLS to the three identity tables Epic 1
-- left uncovered (0007_row_level_security.sql's comment already documents which
-- tables it enabled RLS on — client_organisations, client_users and
-- platform_administrators were deliberately deferred, not forgotten, until Epic 2
-- actually needed authenticated client_user/platform_admin requests to exist). Same
-- session-variable mechanism as 0007 — no new plumbing, just new policies.
--
-- AUTH-008 (client user provisioning/roles/deactivation by a client administrator) is
-- the concrete requirement this closes: without this, "list users in my org" relies
-- entirely on the application remembering to WHERE-clause by client_organisation_id,
-- which is exactly the "single missed WHERE clause" failure mode 0007's own comment
-- warns about.

GRANT SELECT, INSERT, UPDATE ON client_organisations TO thriski_app; -- 0007 granted this already; restated here is a no-op, kept for readability of this file in isolation

ALTER TABLE client_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_users FORCE ROW LEVEL SECURITY;

CREATE POLICY client_users_visibility ON client_users
  FOR SELECT
  USING (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR (
      current_setting('app.actor_type', true) = 'client_user'
      AND client_organisation_id = NULLIF(current_setting('app.client_organisation_id', true), '')::uuid
    )
  );

CREATE POLICY client_users_insert ON client_users
  FOR INSERT
  WITH CHECK (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR (
      current_setting('app.actor_type', true) = 'client_user'
      AND client_organisation_id = NULLIF(current_setting('app.client_organisation_id', true), '')::uuid
    )
  );

CREATE POLICY client_users_update ON client_users
  FOR UPDATE
  USING (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR (
      current_setting('app.actor_type', true) = 'client_user'
      AND client_organisation_id = NULLIF(current_setting('app.client_organisation_id', true), '')::uuid
    )
  );

ALTER TABLE client_organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_organisations FORCE ROW LEVEL SECURITY;

-- Broker visibility of a linked lender's own organisation row (e.g. branding, W7) is
-- deliberately NOT included here — it needs the same relationship-EXISTS shape
-- broker_profiles_visibility uses in 0007, and guessing that shape ahead of the actual
-- W7 UX that needs it risks building the wrong policy. Add it as a follow-up migration
-- once that UI exists, per 0007's own COMMENT ON POLICY about extracting a shared
-- has_active_relationship(...) function once a third/fourth table needs this pattern.
CREATE POLICY client_organisations_visibility ON client_organisations
  FOR SELECT
  USING (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR (
      current_setting('app.actor_type', true) = 'client_user'
      AND id = NULLIF(current_setting('app.client_organisation_id', true), '')::uuid
    )
  );

CREATE POLICY client_organisations_write ON client_organisations
  FOR ALL
  USING (current_setting('app.actor_type', true) IN ('system', 'platform_admin'))
  WITH CHECK (current_setting('app.actor_type', true) IN ('system', 'platform_admin'));
  -- W7: only Thriski operations (platform_admin) or system creates/updates a client
  -- organisation in Release 1 — there is no client-organisation self-registration
  -- (Section 6.7).

ALTER TABLE platform_administrators ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_administrators FORCE ROW LEVEL SECURITY;

CREATE POLICY platform_administrators_visibility ON platform_administrators
  FOR SELECT
  USING (current_setting('app.actor_type', true) IN ('system', 'platform_admin'));

CREATE POLICY platform_administrators_write ON platform_administrators
  FOR ALL
  USING (current_setting('app.actor_type', true) = 'system')
  WITH CHECK (current_setting('app.actor_type', true) = 'system');
  -- Deliberately narrower than the visibility policy: a platform_admin can read the
  -- roster (needed to render it) but only the system actor (i.e. the one-off seed
  -- script, scripts/seed-platform-admin.ts) creates new platform administrator rows in
  -- Release 1 — there is no self-service platform-admin provisioning endpoint.

-- W7: entity verification is a discrete, auditable fact — kept separate from the
-- coarse operational `status` column (which governs active/suspended, not "has Thriski
-- ops verified this organisation's registration").
ALTER TABLE client_organisations ADD COLUMN verified_at TIMESTAMPTZ;
