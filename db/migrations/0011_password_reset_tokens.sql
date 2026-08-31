-- Epic 2, AUTH-005: password reset via a token emailed to the address of record.
--
-- token_hash is sha256, not scrypt: the raw token is a crypto.randomBytes(32) value
-- generated server-side, already high-entropy, so a slow KDF buys nothing and would
-- slow down every redemption check for no security benefit (unlike a user-chosen
-- password, which scrypt/argon2 protect against low-entropy input).
--
-- Single-use is enforced by the application setting used_at inside the SAME
-- transaction as the password UPDATE (identity.repository.ts's redeemPasswordResetToken),
-- not by a trigger — consistent with how every other append-only-ish table in this
-- schema keeps invariants in the repository layer, not the database.

CREATE TABLE password_reset_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type   TEXT NOT NULL CHECK (actor_type IN ('broker', 'client_user', 'platform_admin')),
  actor_id     UUID NOT NULL,
  token_hash   TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_password_reset_tokens_hash ON password_reset_tokens(token_hash);
CREATE INDEX idx_password_reset_tokens_actor ON password_reset_tokens(actor_type, actor_id);

GRANT SELECT, INSERT, UPDATE ON password_reset_tokens TO thriski_app;
