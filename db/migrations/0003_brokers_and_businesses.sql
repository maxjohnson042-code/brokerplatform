-- Epic 3 / Epic 4: Broker profile and broker business skeleton.
-- Domain model Section 5.3. These two entities are deliberately separate tables with
-- an affiliation join table between them (BusinessAffiliation), not a foreign key on
-- the broker — Section 6.0: "model the affiliation as its own record with role and
-- dates, not a foreign key on the broker", because a broker's business history and
-- cardinality (one business, many brokers; a broker may have several over time) can't
-- be expressed as a single column.

CREATE TYPE profile_status AS ENUM (
  'draft', 'submitted', 'in_verification', 'verified', 'active',
  'incomplete', 'attention_required', 'blacklisted', 'suspended', 'deactivated'
); -- Section 8.1

CREATE TABLE broker_profiles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Identity/auth lives here rather than a separate "users" table for MVP simplicity;
  -- split out if/when brokers need multiple login methods.
  email           CITEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,

  -- Person (Section 5.3) — personal fields per Section 13.1.
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  other_names     TEXT,
  date_of_birth   DATE,
  phone_number    TEXT,
  address         JSONB, -- {line1, line2, city, postcode, state} — see ONB-010 (address lookup, Could-have)

  experience_years NUMERIC, -- ONB-012: drives the mentoring-letter conditional rule

  status          profile_status NOT NULL DEFAULT 'draft',
  attested_terms_at TIMESTAMPTZ, -- ONB-002: attestation gates progress

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE association_memberships (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_profile_id   UUID NOT NULL REFERENCES broker_profiles(id),
  association_name    TEXT NOT NULL, -- MFAA | FBAA | CAFBA | AFCA (Section 2.3)
  membership_number   TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'unconfirmed', -- confirmed by association vs certificate-only (ASN-003)
  confirmed_by_association BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE business_entity_type AS ENUM ('company', 'sole_trader', 'partnership', 'trust');

CREATE TYPE business_status AS ENUM (
  'draft', 'submitted', 'in_verification', 'verified', 'active',
  'incomplete', 'attention_required', 'breach', 'suspended', 'ceased'
); -- Section 8.2

CREATE TABLE broker_businesses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type     business_entity_type NOT NULL,
  legal_name      TEXT NOT NULL,
  trading_name    TEXT,
  abn             TEXT,
  acn             TEXT,
  gst_registered  BOOLEAN,
  trustee_name    TEXT, -- populated where entity_type = 'trust' (BUS-010)
  address         JSONB,
  status          business_status NOT NULL DEFAULT 'draft',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- BUS-007: every principal is a screening subject, whether or not they are a broker.
CREATE TABLE business_principals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_business_id  UUID NOT NULL REFERENCES broker_businesses(id),
  role                TEXT NOT NULL, -- director | secretary | partner | trustee
  first_name          TEXT NOT NULL,
  last_name           TEXT NOT NULL,
  date_of_birth       DATE,
  -- A principal who is also a broker links here; most principals are not.
  broker_profile_id   UUID REFERENCES broker_profiles(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- BusinessAffiliation (Section 5.3): its own record with role and dates, per Section 6.0.
-- "current" (ended_at IS NULL) determines which business's cascade rules currently apply
-- to the broker (BUS-011, BUS-012) — do not infer "current" from created_at ordering.
CREATE TABLE business_affiliations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_profile_id   UUID NOT NULL REFERENCES broker_profiles(id),
  broker_business_id  UUID NOT NULL REFERENCES broker_businesses(id),
  role                TEXT NOT NULL DEFAULT 'broker',
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at            TIMESTAMPTZ, -- NULL = current (BUS-015: history retained, not overwritten)
  end_reason          TEXT
);

CREATE INDEX idx_affiliations_broker ON business_affiliations(broker_profile_id) WHERE ended_at IS NULL;
CREATE INDEX idx_affiliations_business ON business_affiliations(broker_business_id) WHERE ended_at IS NULL;
