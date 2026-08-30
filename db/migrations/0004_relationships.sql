-- Epic 8: Relationships. Domain model Section 5.3 — the explicit, consented link
-- between one broker and one client organisation. Section 2.1: "the relationship is
-- the visibility boundary" — every later authorisation check (Epic 1's tenancy layer)
-- ultimately resolves to "does an active row exist here".

CREATE TYPE relationship_type AS ENUM ('lender_panel', 'aggregator_membership', 'association_membership');

CREATE TYPE relationship_status AS ENUM (
  'requested', 'pending_acceptance', 'active', 'declined', 'revoked', 'ended'
);

CREATE TABLE relationships (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_profile_id       UUID NOT NULL REFERENCES broker_profiles(id),
  client_organisation_id  UUID NOT NULL REFERENCES client_organisations(id),
  type                    relationship_type NOT NULL,
  status                  relationship_status NOT NULL DEFAULT 'requested',

  -- Section 2.2: sharing scope varies by client TYPE, not by field — so this records
  -- which scope applied at consent time, for later audit, rather than a per-field ACL.
  shared_data_scope       TEXT NOT NULL, -- 'lender_full' | 'aggregator_full' | 'association_membership_only'

  -- REL-002 / REL-010: broker must be shown what will be shared before consenting,
  -- and every grant/revocation is timestamped, versioned and auditable.
  consented_at            TIMESTAMPTZ,
  consent_version         TEXT,

  effective_from          TIMESTAMPTZ,
  effective_to            TIMESTAMPTZ, -- NULL = still active
  end_reason              TEXT,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (broker_profile_id, client_organisation_id, type, effective_from)
);

CREATE INDEX idx_relationships_broker ON relationships(broker_profile_id) WHERE effective_to IS NULL;
CREATE INDEX idx_relationships_client ON relationships(client_organisation_id) WHERE effective_to IS NULL;

COMMENT ON TABLE relationships IS
  'PLT-002/PLT-003 depend on this table: a client organisation may read broker data '
  'only where a row here is active. The authorisation-context repository layer '
  '(src/db/authorization-context.ts) and the RLS policies in migration 0007 both key '
  'off this table — see Section 20.2, "two layers, both mandatory".';
