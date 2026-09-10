-- REL-001: "As a broker I can search for and select the lenders, aggregators and
-- associations I want to link to" — never actually buildable until now, since
-- client_organisations_visibility (0013, extended in 0022) only lets a broker see an
-- organisation row once a `relationships` row already exists between them. That's
-- exactly backwards for a first-time request: the broker needs to discover the
-- organisation BEFORE any relationship exists.
--
-- This is the first broad, non-relationship-scoped SELECT grant to a whole actor
-- type in this codebase (every other broker-visible policy is self-ownership or an
-- EXISTS(relationships/affiliations ...) check) — worth being explicit about that
-- here rather than let it blend in as "just another branch." It's safe because:
--   1. Gated on verified_at IS NOT NULL — the real, already-meaningful fact (0013)
--      that Thriski ops has actually verified this organisation is real, not the
--      vestigial `status` column alone (kept as a defensive secondary check).
--   2. Row-level access here does NOT mean column-level exposure — the repository
--      function backing this (listOrganisationsForDiscovery) explicitly selects only
--      id/name/type/logoUrl, never the full `settings` jsonb or anything else. RLS
--      grants row visibility; the application layer still decides what of that row
--      is actually returned, same belt-and-braces split as everywhere else in this
--      schema (Section 20.2).
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
  );
