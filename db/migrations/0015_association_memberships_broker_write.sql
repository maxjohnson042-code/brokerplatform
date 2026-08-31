-- Epic 3: closes an RLS gap left open since Epic 1, not a routine schema change — see
-- the plan discussion this migration was reviewed against before writing.
--
-- 0007_row_level_security.sql gave association_memberships only a SELECT policy
-- (association_memberships_visibility) and an INSERT policy
-- (association_memberships_write). With FORCE ROW LEVEL SECURITY on and no UPDATE or
-- DELETE policy, an UPDATE/DELETE against this table currently matches zero rows for
-- every actor, silently, not even an error. That blocks ONB-008 ("draft save and
-- resume") for membership entries specifically: a broker fixing a typo in a
-- membership number, or removing one added by mistake before submitting, has no path
-- to do so at all, at any layer, today.
--
-- Shape is a deliberate copy of 0007's broker_profiles_self_write policy — ownership
-- check only (broker_profile_id = the caller's own actor id), no additional status
-- gating in the policy itself. Application-layer code (brokers.repository.ts) is what
-- enforces "only while the profile is still draft/attention_required" — same division
-- of responsibility Section 20.2 already uses everywhere else: RLS is the backstop,
-- not the place business-state rules live.

CREATE POLICY association_memberships_update ON association_memberships
  FOR UPDATE
  USING (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR (
      current_setting('app.actor_type', true) = 'broker'
      AND broker_profile_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
    )
  );

CREATE POLICY association_memberships_delete ON association_memberships
  FOR DELETE
  USING (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR (
      current_setting('app.actor_type', true) = 'broker'
      AND broker_profile_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
    )
  );
