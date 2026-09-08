-- Epic 11: training confirmation, not delivery. Explicit user steer: no in-platform
-- training content, no broker self-report — the platform's job is letting the lender
-- confirm a broker's relevant training is done (however that happened, off-platform),
-- track a deadline for it, and let the lender activate the accreditation once
-- satisfied. Confirming a kind and activating are independent lender actions — the
-- platform never auto-activates on "both kinds confirmed," since "relevant" is the
-- lender's own judgement, not a platform-enforced rule.

ALTER TYPE accreditation_status ADD VALUE 'active';
ALTER TYPE accreditation_status ADD VALUE 'lapsed';

ALTER TABLE accreditations ADD COLUMN training_deadline_at TIMESTAMPTZ;
ALTER TABLE accreditations ADD COLUMN activated_at TIMESTAMPTZ;

CREATE TABLE training_confirmations (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accreditation_id              UUID NOT NULL REFERENCES accreditations(id),
  kind                          TEXT NOT NULL CHECK (kind IN ('platform', 'product')),
  confirmed_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_by_client_user_id   UUID,
  notes                         TEXT,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX training_confirmations_one_per_kind ON training_confirmations (accreditation_id, kind);

GRANT SELECT, INSERT ON training_confirmations TO thriski_app;

ALTER TABLE training_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_confirmations FORCE ROW LEVEL SECURITY;

-- Joined through accreditations, same pattern accreditation_decisions already uses.
-- No broker branch on the INSERT policy at all — only the lender ever confirms.
-- Because the confirming/activating actor (client_user) already has
-- accreditations_update rights, activateAccreditation needs no RLS escalation trick,
-- unlike Epic 10's flagPartyChanged/getOutstandingItems (a broker's own action needing
-- to write accreditations does not occur anywhere in this epic).
CREATE POLICY training_confirmations_visibility ON training_confirmations
  FOR SELECT
  USING (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR EXISTS (
      SELECT 1 FROM accreditations a
      WHERE a.id = training_confirmations.accreditation_id
        AND (
          (current_setting('app.actor_type', true) = 'client_user'
           AND a.lender_client_organisation_id = NULLIF(current_setting('app.client_organisation_id', true), '')::uuid)
          OR (current_setting('app.actor_type', true) = 'broker'
              AND a.broker_profile_id = NULLIF(current_setting('app.actor_id', true), '')::uuid)
        )
    )
  );

CREATE POLICY training_confirmations_insert ON training_confirmations
  FOR INSERT
  WITH CHECK (
    current_setting('app.actor_type', true) = 'system'
    OR (
      current_setting('app.actor_type', true) = 'client_user'
      AND EXISTS (
        SELECT 1 FROM accreditations a
        WHERE a.id = training_confirmations.accreditation_id
          AND a.lender_client_organisation_id = NULLIF(current_setting('app.client_organisation_id', true), '')::uuid
      )
    )
  );
