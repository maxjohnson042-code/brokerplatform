-- Epic 13 / AUD-003: audit_log has never had RLS (migration 0024's own comment flags
-- this: "audit_log has never had that kind of read access built for it"). GRANTs
-- already exist (migration 0007) — this migration is policies only.

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

-- SELECT: broker sees (a) evidence.viewed rows about their OWN profile's evidence —
-- joined through evidence, since logEvidenceAccess records subject_type='evidence',
-- subject_id=evidence.id, NOT the evidence's own subject_type/subject_id — and
-- (b) the full action history of their OWN accreditations, which AUD-005's
-- reconstruction replays as this same broker. Broker-business/business-principal
-- evidence access is a DELIBERATE CUT (shared across multiple affiliated brokers,
-- its own visibility question, not asked for by AUD-003's literal "own profile").
CREATE POLICY audit_log_visibility ON audit_log
  FOR SELECT
  USING (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR (
      current_setting('app.actor_type', true) = 'broker'
      AND (
        (
          subject_type = 'evidence' AND action = 'evidence.viewed'
          AND EXISTS (
            SELECT 1 FROM evidence e
            WHERE e.id = audit_log.subject_id
              AND e.subject_type = 'broker_profile'
              AND e.subject_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
          )
        )
        OR (
          subject_type = 'accreditation'
          AND EXISTS (
            SELECT 1 FROM accreditations a
            WHERE a.id = audit_log.subject_id
              AND a.broker_profile_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
          )
        )
      )
    )
  );

-- INSERT: recordAuditEvent is called from dozens of existing sites under whatever
-- actor context is legitimately active — MUST stay permissive across all four types
-- or every mutation in the app starts failing the moment FORCE RLS applies.
-- Enumerated explicitly (not WITH CHECK (true)) so an unset actor_type fails closed,
-- matching every other permissive-INSERT policy in this schema.
CREATE POLICY audit_log_insert ON audit_log
  FOR INSERT
  WITH CHECK (current_setting('app.actor_type', true) IN ('system', 'broker', 'client_user', 'platform_admin'));

-- No UPDATE policy — FORCE RLS + zero policies denies every UPDATE outright, which is
-- exactly the append-only guarantee this table's own migration comment asked for and
-- never had enforced. Nothing in the codebase issues UPDATE audit_log (confirmed).
