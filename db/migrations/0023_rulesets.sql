-- Epic 9: the ruleset engine's schema. Section 9.2 (G-14) states the key literally —
-- (client_organisation, brand, role, product_scope, pathway) resolves to a ruleset
-- version — and none of brand/role/product_scope/pathway exist anywhere in the schema
-- yet, so this is a from-scratch table, not extending something partial.
--
-- All four dimension columns are free TEXT, not Postgres ENUMs. This is deliberate:
-- an ENUM requires ALTER TYPE (a schema/code change) to add a new lender's vocabulary
-- value, which is exactly the failure mode Section 9.3's acceptance test is checking
-- for ("if the second [ruleset] cannot be expressed without code changes, the
-- abstraction is wrong"). A lender without a real distinction on some dimension just
-- uses the literal value 'default' there. `status` IS a Postgres ENUM, because that
-- vocabulary (draft/published/superseded) is platform-defined and fixed, not client
-- vocabulary — same reasoning as profile_status/business_status.
--
-- ruleset_versions is a genuinely new table (the first since migration 0007's blanket
-- GRANT to thriski_app), so it gets RLS enabled and its own GRANT in this same
-- migration, same as every other table's first commit in this project.

CREATE TYPE ruleset_version_status AS ENUM ('draft', 'published', 'superseded');

CREATE TABLE ruleset_versions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organisation_id  UUID NOT NULL REFERENCES client_organisations(id),
  brand                   TEXT NOT NULL,
  role                    TEXT NOT NULL,
  product_scope           TEXT NOT NULL,
  pathway                 TEXT NOT NULL,
  version_number          INT NOT NULL,
  label                   TEXT NOT NULL,
  status                  ruleset_version_status NOT NULL DEFAULT 'draft',
  -- RulesetDefinition (src/modules/rulesets/ruleset.types.ts): requirementGroups,
  -- thresholds, declarations, approvalRouting, training. See that file for the shape
  -- the application code assumes; this column is intentionally untyped at the SQL
  -- level (Section 23: versioned declarative JSON, not a DSL enforced by the schema).
  definition              JSONB NOT NULL,
  superseded_by           UUID REFERENCES ruleset_versions(id),
  published_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One sequence of versions per key-tuple.
CREATE UNIQUE INDEX ruleset_versions_key_version
  ON ruleset_versions (client_organisation_id, brand, role, product_scope, pathway, version_number);

-- At most one currently-published version per key-tuple — this IS the "current
-- ruleset for new work" resolution. Publishing a replacement must first flip the old
-- row to 'superseded' in the same transaction (rulesets.repository.ts's publish()),
-- or this index rejects the insert.
CREATE UNIQUE INDEX ruleset_versions_one_published
  ON ruleset_versions (client_organisation_id, brand, role, product_scope, pathway)
  WHERE status = 'published';

GRANT SELECT, INSERT, UPDATE ON ruleset_versions TO thriski_app;

ALTER TABLE ruleset_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ruleset_versions FORCE ROW LEVEL SECURITY;

-- platform_admin/system: full read (this is the Thriski-ops-only administrative tool,
-- same precedent as PlatformAdminOrgController/W7). client_user: read-only, own
-- organisation — reviewing their own configuration, never writing it. No broker
-- branch: brokers never read raw ruleset JSON (it may carry internal
-- approval-routing/escalation detail not meant for their eyes) — they only ever see
-- computed outstanding-items, same as document-catalog.ts today.
CREATE POLICY ruleset_versions_visibility ON ruleset_versions
  FOR SELECT
  USING (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR (
      current_setting('app.actor_type', true) = 'client_user'
      AND client_organisation_id = NULLIF(current_setting('app.client_organisation_id', true), '')::uuid
    )
  );

CREATE POLICY ruleset_versions_write ON ruleset_versions
  FOR INSERT
  WITH CHECK (current_setting('app.actor_type', true) IN ('system', 'platform_admin'));

CREATE POLICY ruleset_versions_update ON ruleset_versions
  FOR UPDATE
  USING (current_setting('app.actor_type', true) IN ('system', 'platform_admin'));
