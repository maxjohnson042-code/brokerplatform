-- Epic 1 / Epic 2: Client organisations and users.
-- Domain model Section 5.3: ClientOrganisation (type: Lender | Aggregator | Association).
-- PLT-001: data model supports multiple client organisations of these three types.
-- PLT-004: each client organisation has independent configuration, users, roles and branding.

CREATE TYPE client_organisation_type AS ENUM ('lender', 'aggregator', 'association');

CREATE TABLE client_organisations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type          client_organisation_type NOT NULL,
  name          TEXT NOT NULL,
  -- Per-client configuration (branding, product scopes, monitoring cadence defaults) is
  -- free-form on purpose (Section 20.1: jsonb for config without schema churn). The
  -- ruleset itself lives in a separate versioned table once Epic 9 (ruleset engine) lands.
  settings      JSONB NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE client_user_role AS ENUM (
  'reviewer',          -- REV-*: assess and accredit brokers
  'relationship_manager',
  'senior_approver',   -- exceptions and adverse findings
  'compliance_officer',
  'client_admin'       -- AUTH-008: provisions users, roles
);

CREATE TABLE client_users (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_organisation_id UUID NOT NULL REFERENCES client_organisations(id),
  email                  CITEXT,
  role                   client_user_role NOT NULL,
  password_hash          TEXT NOT NULL,
  mfa_enrolled           BOOLEAN NOT NULL DEFAULT false, -- AUTH-006: MFA mandatory for client orgs
  is_active              BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_client_users_org ON client_users(client_organisation_id);

-- Thriski platform administrators (Section 4.3) — distinct from client_users, since
-- PLT-006 requires their access to broker data to be logged and justified, not ambient.
CREATE TABLE platform_administrators (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          CITEXT,
  password_hash  TEXT NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
