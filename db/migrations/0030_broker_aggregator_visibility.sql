-- Product requirement: a lender needs to see which aggregator a broker on their panel
-- comes through (and, separately, which association(s) they belong to — MFAA/FBAA/
-- CAFBA/AFCA), but must NEVER see which OTHER LENDERS that same broker is panelled
-- with. Association visibility already works today with zero changes here —
-- association_memberships_visibility (migration 0021) has no relationship-type
-- restriction at all ("every relationship type may see association standing," Section
-- 2.5). Aggregator visibility does not exist yet: relationships_visibility (0021) only
-- ever matches the caller's OWN client_organisation_id, so a lender currently cannot
-- see ANY relationship row belonging to a different organisation, aggregator or not.
--
-- Two coordinated branches below, reviewed together as one piece (same shape as
-- 0021's own three-table review) — reusing has_active_relationship() exactly as
-- built, no new SQL function needed:
--
-- 1. relationships_visibility: a client_user may see a relationship row belonging to
--    a DIFFERENT organisation only when that row's type = 'aggregator_membership' AND
--    the caller's own org has an active lender_panel/aggregator_membership
--    relationship with the same broker. The type='aggregator_membership' condition is
--    load-bearing — it is the ONLY thing preventing this from also exposing another
--    lender's lender_panel row, which must never happen.
--
-- 2. client_organisations_visibility: a client_user may see an organisation's own row
--    (id/name/logo, per the application layer below — RLS grants row visibility, not
--    column exposure, same split as migration 0029) when that organisation is the
--    aggregator_membership counterparty for a broker the caller also has an active
--    relationship with. Without this, branch 1 would make the relationship row itself
--    visible but the aggregator's name would still read as null.
--
-- Both branches are broker-mediated: a lender only ever learns of an aggregator
-- through a broker they already have an active relationship with, never a blanket
-- aggregator directory.

ALTER POLICY relationships_visibility ON relationships
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
    OR (
      current_setting('app.actor_type', true) = 'client_user'
      AND relationships.type = 'aggregator_membership'
      AND relationships.status = 'active'
      AND has_active_relationship(
        relationships.broker_profile_id,
        NULLIF(current_setting('app.client_organisation_id', true), '')::uuid,
        ARRAY['lender_panel', 'aggregator_membership']
      )
    )
  );

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
    OR (
      current_setting('app.actor_type', true) = 'broker'
      AND status = 'active'
      AND verified_at IS NOT NULL
    )
    OR (
      current_setting('app.actor_type', true) = 'client_user'
      AND EXISTS (
        SELECT 1 FROM relationships r
        WHERE r.client_organisation_id = client_organisations.id
          AND r.type = 'aggregator_membership'
          AND r.status = 'active'
          AND has_active_relationship(
            r.broker_profile_id,
            NULLIF(current_setting('app.client_organisation_id', true), '')::uuid,
            ARRAY['lender_panel', 'aggregator_membership']
          )
      )
    )
  );
