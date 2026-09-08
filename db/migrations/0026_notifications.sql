-- Epic 12: a dedicated notifications log, not a repurposed audit_log — the same
-- reasoning that split accreditation_decisions off from audit_log in Epic 10 applies
-- here (Section 20.5: audit_log is the platform-wide compliance trail, not a
-- structured per-recipient read path NOT-005's preferences and a "my notifications"
-- screen both need).
--
-- Notification CREATION is atomic with the domain write it's about (same transaction,
-- same client, same pattern as recordAuditEvent) — that's what actually fixes NOT-007
-- and the reliability gap three existing call sites already had (see the Epic 12
-- plan). Delivery via EmailSender stays a separate, post-commit, best-effort step —
-- holding real network I/O open inside a DB transaction would be worse, not better.

CREATE TABLE notifications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_type        TEXT NOT NULL CHECK (recipient_type IN ('broker', 'client_user')),
  recipient_id          UUID NOT NULL,
  category              TEXT NOT NULL,
  channel               TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email')),
  subject               TEXT NOT NULL,
  body                  TEXT NOT NULL,
  related_record_type   TEXT,
  related_record_id     UUID,
  suppressed            BOOLEAN NOT NULL DEFAULT false,
  sent_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_recipient ON notifications (recipient_type, recipient_id, created_at DESC);

CREATE TABLE notification_preferences (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type    TEXT NOT NULL CHECK (actor_type IN ('broker', 'client_user')),
  actor_id      UUID NOT NULL,
  category      TEXT NOT NULL,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Absence of a row = enabled (the default). A row only exists once someone opts out
-- (or explicitly re-enables after opting out) — no need to pre-populate one row per
-- category per user.
CREATE UNIQUE INDEX notification_preferences_one_per_category ON notification_preferences (actor_type, actor_id, category);

GRANT SELECT, INSERT, UPDATE ON notifications TO thriski_app;
GRANT SELECT, INSERT, UPDATE ON notification_preferences TO thriski_app;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;

CREATE POLICY notifications_visibility ON notifications
  FOR SELECT
  USING (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR (
      current_setting('app.actor_type', true) = 'broker'
      AND recipient_type = 'broker'
      AND recipient_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
    )
    OR (
      current_setting('app.actor_type', true) = 'client_user'
      AND recipient_type = 'client_user'
      AND recipient_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
    )
  );

-- system only — creation is almost always on behalf of a DIFFERENT actor than the one
-- whose transaction triggered it (a client_user approving an accreditation creates a
-- notification for the broker), so createNotification uses a transaction-scoped
-- SET LOCAL app.actor_type='system' escalation on the caller's own client, same shape
-- as Epic 10's flagPartyChanged. markSent is a standalone system-ctx call.
CREATE POLICY notifications_insert ON notifications
  FOR INSERT
  WITH CHECK (current_setting('app.actor_type', true) = 'system');

CREATE POLICY notifications_update ON notifications
  FOR UPDATE
  USING (current_setting('app.actor_type', true) = 'system');

-- No cross-actor gap here — a user only ever manages their own preferences.
CREATE POLICY notification_preferences_visibility ON notification_preferences
  FOR SELECT
  USING (
    current_setting('app.actor_type', true) IN ('system', 'platform_admin')
    OR actor_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
  );

CREATE POLICY notification_preferences_insert ON notification_preferences
  FOR INSERT
  WITH CHECK (
    current_setting('app.actor_type', true) = 'system'
    OR actor_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
  );

CREATE POLICY notification_preferences_update ON notification_preferences
  FOR UPDATE
  USING (
    current_setting('app.actor_type', true) = 'system'
    OR actor_id = NULLIF(current_setting('app.actor_id', true), '')::uuid
  );
