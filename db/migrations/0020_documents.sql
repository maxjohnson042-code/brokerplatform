-- Epic 5: two fixes to existing RLS, plus additive columns, all explained here per the
-- plan reviewed before writing this file.
--
-- 1. evidence_visibility (0007) has the exact same bug class Epic 4 fixed in
--    broker_businesses_visibility: the broker_business-subject branch keys off
--    `ba.ended_at IS NULL`, which a merely-pending, unconfirmed affiliation also
--    satisfies (migration 0018 added business_affiliations.status specifically to
--    distinguish these — the two policies fixed in migration 0019 were
--    broker_businesses_*; this one, on evidence, was missed at the time since Epic 4
--    wasn't looking at document visibility).
--
-- 2. Worse: that branch only ever grants visibility to client_user — there is NO
--    branch letting a broker see evidence attached to their own business at all. A
--    broker uploading their own business's PI certificate (this epic's new upload
--    path) could write it but never read it back. Not a new gap this epic
--    introduces — a pre-existing one this epic is the first to actually exercise via
--    a broker-facing HTTP path, same reasoning that justified closing the
--    business_principals/business_affiliations gap in Epic 4 rather than deferring
--    it further. Not self-referential (evidence != business_affiliations), so none
--    of Epic 4's SECURITY DEFINER recursion workaround is needed here.
--
-- 3. evidence has SELECT and INSERT policies (system/platform_admin only, by design —
--    brokers/client_users never insert evidence rows directly) but NO UPDATE policy
--    at all — the exact gap migration 0008 already found and fixed for check_result
--    ("with FORCE ROW LEVEL SECURITY and no applicable policy, Postgres denies the
--    command for every row, silently"). This epic is the first to need an UPDATE on
--    evidence (superseding a document version), so this migration adds
--    evidence_close_out, identical in shape to check_result_close_out (0008).

ALTER POLICY evidence_visibility ON evidence
  USING (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR (
      subject_type = 'broker_profile' AND (
        (current_setting('app.actor_type', true) = 'broker'
         AND subject_id = NULLIF(current_setting('app.actor_id', true), '')::uuid)
        OR (current_setting('app.actor_type', true) = 'client_user' AND EXISTS (
          SELECT 1 FROM relationships r
          WHERE r.broker_profile_id = evidence.subject_id
            AND r.client_organisation_id = NULLIF(current_setting('app.client_organisation_id', true), '')::uuid
            AND r.status = 'active' AND r.effective_to IS NULL
            AND r.type IN ('lender_panel', 'aggregator_membership')
        ))
      )
    )
    OR (
      subject_type = 'broker_business' AND (
        (current_setting('app.actor_type', true) = 'broker' AND EXISTS (
          SELECT 1 FROM business_affiliations ba
          WHERE ba.broker_business_id = evidence.subject_id
            AND ba.broker_profile_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
            AND ba.status = 'active'
        ))
        OR (current_setting('app.actor_type', true) = 'client_user' AND EXISTS (
          SELECT 1 FROM business_affiliations ba
          JOIN relationships r ON r.broker_profile_id = ba.broker_profile_id
          WHERE ba.broker_business_id = evidence.subject_id
            AND ba.status = 'active'
            AND r.client_organisation_id = NULLIF(current_setting('app.client_organisation_id', true), '')::uuid
            AND r.status = 'active' AND r.effective_to IS NULL
            AND r.type IN ('lender_panel', 'aggregator_membership')
        ))
      )
    )
  );

CREATE POLICY evidence_close_out ON evidence
  FOR UPDATE
  USING (current_setting('app.actor_type', true) IN ('system', 'platform_admin'))
  WITH CHECK (current_setting('app.actor_type', true) IN ('system', 'platform_admin'));

-- DOC-001/002/006: broker-uploaded documents are a form of evidence with richer
-- structured metadata (Section 20.4's "payloads and artefacts" already covers both) —
-- these stay NULL for the Sumsub-shaped provider-payload rows Epic 6 will write.
ALTER TABLE evidence ADD COLUMN document_type TEXT;
ALTER TABLE evidence ADD COLUMN issue_date DATE;
ALTER TABLE evidence ADD COLUMN expiry_date DATE; -- DOC-002's currency half; the threshold half needs Epic 9's ruleset data
ALTER TABLE evidence ADD COLUMN issuing_body TEXT;
ALTER TABLE evidence ADD COLUMN mime_type TEXT;
ALTER TABLE evidence ADD COLUMN original_filename TEXT;

-- DOC-006 versioning: identical shape to check_result's valid_to/superseded_by
-- (Section 20.3's worked example) — NULL valid_to = current, never UPDATEd except to
-- close a row out when a new version supersedes it.
ALTER TABLE evidence ADD COLUMN valid_to TIMESTAMPTZ;
ALTER TABLE evidence ADD COLUMN superseded_by UUID REFERENCES evidence(id);

CREATE INDEX idx_evidence_current ON evidence(subject_type, subject_id, document_type) WHERE valid_to IS NULL;
