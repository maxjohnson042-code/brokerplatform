-- Epic 10: the four-party accreditation record (Section 5.2) and the lender review
-- workbench's decision log. Not a broker-to-lender link — a change to any of the four
-- parties (lender, broker, business, aggregator/ACL holder) can invalidate the
-- accreditation, which a simple FK on the broker cannot express.
--
-- accreditation_status is deliberately a NARROW enum: only the values this epic's
-- built workflow can actually reach (requested -> information_required/
-- exception_escalated -> declined, or approved -> pending). web/src/lib/status.ts's
-- ACCREDITATION_STATUS already models the full eventual set (active, suspended,
-- lapsed, withdrawn, etc.) — those belong to Epic 11 (training completion moves
-- pending -> active), monitoring (Release 2) and the black list (Release 3+), none of
-- which this epic builds. Extending the enum later is a normal ALTER TYPE, not a
-- redesign.
--
-- accreditation_decisions is kept separate from audit_log on purpose: audit_log is
-- the platform-wide compliance trail (Section 20.5), not a structured per-record read
-- path. The review workbench (REV-002's "one screen") needs to read a specific
-- accreditation's decision history back, scoped by the same RLS as the accreditation
-- itself — audit_log has never had that kind of read access built for it. Every write
-- here still calls recordAuditEvent in the same transaction, same as everywhere else.

CREATE TYPE accreditation_classification AS ENUM
  ('new_broker_introducer', 'new_referrer_introducer', 'transfer', 'add_on');

CREATE TYPE accreditation_status AS ENUM
  ('requested', 'information_required', 'exception_escalated', 'declined', 'pending', 'party_changed_pending');

CREATE TABLE accreditations (
  id                                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lender_client_organisation_id           UUID NOT NULL REFERENCES client_organisations(id),
  broker_profile_id                       UUID NOT NULL REFERENCES broker_profiles(id),
  broker_business_id                      UUID NOT NULL REFERENCES broker_businesses(id),
  relationship_id                         UUID REFERENCES relationships(id),

  classification                          accreditation_classification NOT NULL,
  brand                                   TEXT NOT NULL,
  role                                    TEXT NOT NULL,
  product_scope                           TEXT NOT NULL,
  pathway                                 TEXT NOT NULL,
  ruleset_version_id                      UUID REFERENCES ruleset_versions(id),

  -- ACR-008/009: licence holder modelled as a fillable role, never assumed to be the
  -- aggregator. 'third_party' has no modelled entity (a rare case per Section 5.1) so
  -- falls back to a free-text name rather than a table this epic has no other use for.
  licence_holder_type                     TEXT NOT NULL CHECK (licence_holder_type IN ('aggregator_organisation', 'broking_business', 'third_party')),
  licence_holder_client_organisation_id   UUID REFERENCES client_organisations(id),
  licence_holder_broker_business_id       UUID REFERENCES broker_businesses(id),
  licence_holder_name                     TEXT,
  is_corporate_credit_representative      BOOLEAN NOT NULL DEFAULT false,

  lender_issued_id                        TEXT,
  previous_lender_issued_ids              JSONB NOT NULL DEFAULT '[]',

  status                                  accreditation_status NOT NULL DEFAULT 'requested',
  current_decision_step                   TEXT NOT NULL DEFAULT 'reviewer' CHECK (current_decision_step IN ('reviewer', 'senior_approver')),
  interview_recommendation                TEXT,
  party_changed_at                        TIMESTAMPTZ,

  requested_at                            TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at                              TIMESTAMPTZ,
  created_at                              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One live (non-declined) accreditation per (broker, lender, brand, role,
-- product_scope) at a time. A declined one can be re-requested; everything else is
-- in flight or in force and blocks a duplicate.
CREATE UNIQUE INDEX accreditations_one_live_per_scope
  ON accreditations (broker_profile_id, lender_client_organisation_id, brand, role, product_scope)
  WHERE status != 'declined';

CREATE INDEX idx_accreditations_business ON accreditations (broker_business_id);
CREATE INDEX idx_accreditations_queue ON accreditations (lender_client_organisation_id, status);

CREATE TABLE accreditation_decisions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accreditation_id  UUID NOT NULL REFERENCES accreditations(id),
  actor_type        TEXT NOT NULL,
  actor_id          UUID,
  decision_type     TEXT NOT NULL CHECK (decision_type IN
                       ('information_requested', 'escalated', 'approved', 'declined', 'interview_recorded')),
  rationale         TEXT,
  itemised_reasons  JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_accreditation_decisions_accreditation ON accreditation_decisions (accreditation_id);

GRANT SELECT, INSERT, UPDATE ON accreditations TO thriski_app;
GRANT SELECT, INSERT ON accreditation_decisions TO thriski_app;

ALTER TABLE accreditations ENABLE ROW LEVEL SECURITY;
ALTER TABLE accreditations FORCE ROW LEVEL SECURITY;
ALTER TABLE accreditation_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE accreditation_decisions FORCE ROW LEVEL SECURITY;

CREATE POLICY accreditations_visibility ON accreditations
  FOR SELECT
  USING (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR (
      current_setting('app.actor_type', true) = 'client_user'
      AND lender_client_organisation_id = NULLIF(current_setting('app.client_organisation_id', true), '')::uuid
    )
    OR (
      current_setting('app.actor_type', true) = 'broker'
      AND broker_profile_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
    )
  );

-- Brokers request their own accreditation; the lender never creates one on a broker's
-- behalf in this epic's built workflow (no such W3 step exists).
CREATE POLICY accreditations_insert ON accreditations
  FOR INSERT
  WITH CHECK (
    current_setting('app.actor_type', true) = 'system'
    OR (
      current_setting('app.actor_type', true) = 'broker'
      AND broker_profile_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
    )
  );

-- Decisions are lender-side (or system, for the party-change flag triggered from
-- businesses.repository.ts's endAffiliation) — a broker never updates their own row.
CREATE POLICY accreditations_update ON accreditations
  FOR UPDATE
  USING (
    current_setting('app.actor_type', true) = 'system'
    OR (
      current_setting('app.actor_type', true) = 'client_user'
      AND lender_client_organisation_id = NULLIF(current_setting('app.client_organisation_id', true), '')::uuid
    )
  );

CREATE POLICY accreditation_decisions_visibility ON accreditation_decisions
  FOR SELECT
  USING (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR EXISTS (
      SELECT 1 FROM accreditations a
      WHERE a.id = accreditation_decisions.accreditation_id
        AND (
          (current_setting('app.actor_type', true) = 'client_user'
           AND a.lender_client_organisation_id = NULLIF(current_setting('app.client_organisation_id', true), '')::uuid)
          OR (current_setting('app.actor_type', true) = 'broker'
              AND a.broker_profile_id = NULLIF(current_setting('app.actor_id', true), '')::uuid)
        )
    )
  );

CREATE POLICY accreditation_decisions_insert ON accreditation_decisions
  FOR INSERT
  WITH CHECK (
    current_setting('app.actor_type', true) = 'system'
    OR (
      current_setting('app.actor_type', true) = 'client_user'
      AND EXISTS (
        SELECT 1 FROM accreditations a
        WHERE a.id = accreditation_decisions.accreditation_id
          AND a.lender_client_organisation_id = NULLIF(current_setting('app.client_organisation_id', true), '')::uuid
      )
    )
  );
