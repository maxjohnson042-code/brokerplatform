-- Epic 5 / Epic 6 / Epic 7: Evidence store metadata and the append-only check_result
-- table. This is the single most consequential migration in the schema — Section 20.3
-- calls temporality "the decision that cannot be deferred", and this table is the
-- worked example the master document gives verbatim.

-- Section 20.4: provider payloads and artefacts go to OBJECT STORAGE, not the database.
-- This table holds only metadata, hashes and pointers.
CREATE TABLE evidence (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type    TEXT NOT NULL, -- 'broker_profile' | 'broker_business' | 'business_principal'
  subject_id      UUID NOT NULL,
  source          TEXT NOT NULL, -- e.g. 'sumsub', 'asic_professional_register'
  method          TEXT,          -- e.g. 'kyc_individual', 'kyb_business', 'register_lookup'
  object_key      TEXT NOT NULL, -- pointer into object storage — never the payload itself
  content_hash    TEXT NOT NULL, -- AUD-006: content-hashed at capture, verified on retrieval
  captured_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  retained_until  TIMESTAMPTZ NOT NULL, -- NFR-PRV-4: 7 years from capture or relationship end
  -- Evidence rows are never updated or deleted ahead of retained_until (Section 20.4:
  -- "write-once"). Enforce this with a bucket-level object lock on the storage side and
  -- an application rule here; do not rely on this table's constraints alone.
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_evidence_subject ON evidence(subject_type, subject_id);

-- The worked example from Section 20.3, verbatim in shape:
--   check_result
--     id, subject_id, check_type, provider
--     valid_from timestamptz, valid_to timestamptz   -- null = current
--     outcome, evidence_id
--     superseded_by uuid
--
-- "Current state is a view (valid_to IS NULL). Historical state is the same query
-- with a timestamp predicate." Nothing here is ever UPDATEd once valid_to is set —
-- superseding a result means INSERTing a new row and setting valid_to + superseded_by
-- on the old one, in the same transaction.
CREATE TABLE check_result (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type    TEXT NOT NULL,
  subject_id      UUID NOT NULL,
  check_type      TEXT NOT NULL, -- from the catalogue, Section 7.1, e.g. 'identity_verification_kyc'
  provider        TEXT NOT NULL, -- 'sumsub', a register name, a bureau name, or 'manual' (Section 24 fallback)

  valid_from      TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to        TIMESTAMPTZ, -- NULL = current

  outcome         TEXT NOT NULL, -- normalised convenience view; never a substitute for evidence (Section 2.4)
  evidence_id     UUID REFERENCES evidence(id),
  superseded_by   UUID REFERENCES check_result(id),

  -- SCR-009: asynchronous checks are jobs, not synchronous calls.
  job_status      TEXT NOT NULL DEFAULT 'completed', -- requested | in_flight | completed | failed | timed_out

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_check_result_current
  ON check_result(subject_type, subject_id, check_type)
  WHERE valid_to IS NULL;

COMMENT ON TABLE check_result IS
  'Append-only / temporal per Section 20.3. Do not add an ORM or migration that '
  'generates UPDATE statements against valid rows of this table. Mutable-in-place is '
  'fine elsewhere for genuinely current-only data (Section 20.3 last line) — this '
  'table specifically is not that.';

-- Exception handling (SCR-004, SCR-005, Section 7.2): adverse results create a task
-- routed to the client's approver. Kept intentionally simple in Epic 1 — the full
-- routing configuration comes with the ruleset engine (Epic 9).
CREATE TYPE exception_decision AS ENUM ('proceed', 'proceed_with_condition', 'decline');

CREATE TABLE check_exceptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  check_result_id   UUID NOT NULL REFERENCES check_result(id),
  client_organisation_id UUID NOT NULL REFERENCES client_organisations(id),
  raised_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at       TIMESTAMPTZ,
  decision          exception_decision,
  rationale         TEXT, -- mandatory once decision is set — enforced in application code
  decided_by_client_user_id UUID REFERENCES client_users(id)
);
