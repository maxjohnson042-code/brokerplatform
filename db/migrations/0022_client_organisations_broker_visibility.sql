-- Epic 8: a gap surfaced while building listMyRelationships — client_organisations_visibility
-- (migration 0013) has a system/platform_admin branch and a client_user-own-org
-- branch, but no branch letting a BROKER see a client organisation's own row at all.
-- A broker listing their relationships (REL-005) needs the name of who they're linked
-- to, not just an opaque client_organisation_id — and a broker who's been invited but
-- hasn't yet accepted (status = 'pending_acceptance') needs to see who invited them to
-- decide whether to accept, so this is deliberately not restricted to active
-- relationships only. Not self-referential (client_organisations != relationships),
-- no recursion risk.

ALTER POLICY client_organisations_visibility ON client_organisations
  USING (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR (
      current_setting('app.actor_type', true) = 'client_user'
      AND id = NULLIF(current_setting('app.client_organisation_id', true), '')::uuid
    )
    OR (
      current_setting('app.actor_type', true) = 'broker'
      AND EXISTS (
        SELECT 1 FROM relationships r
        WHERE r.client_organisation_id = client_organisations.id
          AND r.broker_profile_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
      )
    )
  );
