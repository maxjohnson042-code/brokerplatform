-- Epic 1: Audit log and metering. Two of the six non-negotiables (Section 25, #1 and #5).
-- Deliberately two separate tables per BIL-007: "Metering is separate from the audit
-- log; the two must not be conflated, since they have different retention, access and
-- integrity requirements."

-- Section 20.5: append-only, written in the SAME TRANSACTION as the change it records.
-- No separate audit service, no eventual consistency. Partition by month once volume
-- warrants it (declarative partitioning is a straightforward follow-up migration on
-- this table's shape; not worth the operational overhead on day one with near-zero rows).
CREATE TABLE audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_type      TEXT NOT NULL, -- 'broker' | 'client_user' | 'platform_administrator' | 'system'
  actor_id        UUID,
  action          TEXT NOT NULL, -- e.g. 'relationship.consented', 'check_result.recorded', 'evidence.viewed'
  subject_type    TEXT NOT NULL,
  subject_id      UUID NOT NULL,
  client_organisation_id UUID REFERENCES client_organisations(id), -- set when the actor is client-side (AUD-007: record-level access logging)
  detail          JSONB NOT NULL DEFAULT '{}',
  reason          TEXT
);

CREATE INDEX idx_audit_log_subject ON audit_log(subject_type, subject_id, occurred_at);
CREATE INDEX idx_audit_log_client ON audit_log(client_organisation_id, occurred_at);

COMMENT ON TABLE audit_log IS
  'Never UPDATE or DELETE a row here within the retention window (AUD-004). Every '
  'write to a domain table that Section 12.17 cares about must insert a matching row '
  'here inside the SAME database transaction — see src/modules/audit/audit.repository.ts.';

-- BIL-001/BIL-002: every billable event emits an immutable metering record as it
-- happens. "Retrofitting billing telemetry across an audit-bearing system is
-- expensive and error-prone" (Section 1.1) — so this ships in Epic 1 even though
-- invoicing itself (BIL-008) is explicitly out of scope for Release 1.
CREATE TABLE metering_event (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_organisation_id  UUID NOT NULL REFERENCES client_organisations(id),
  broker_profile_id       UUID NOT NULL REFERENCES broker_profiles(id),
  event_type              TEXT NOT NULL, -- 'broker_linked' | 'broker_accredited' | 'broker_actively_monitored' | 'check_performed' | 'check_reused'
  billing_period          TEXT NOT NULL, -- 'YYYY-MM' — simple to start; BIL-005's counting-rule edge cases are Epic-9-adjacent policy, not schema
  detail                  JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX idx_metering_event_period ON metering_event(client_organisation_id, billing_period);
