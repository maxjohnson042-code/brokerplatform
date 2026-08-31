-- Epic 2, AUTH-006: MFA is mandatory for client organisation accounts. client_users
-- already carries a mfa_enrolled flag (migration 0002) so RLS/application checks don't
-- need to touch this table just to know enrolment status; the secret itself lives here,
-- kept out of client_users so an accidental broad SELECT on the identity table never
-- pulls back key material.
--
-- secret_encrypted follows the "iv:ciphertext:authTag" hex convention identity.repository.ts's
-- hashPassword already established for "salt:hash" — same reasoning: AES-256-GCM via
-- Node's built-in crypto rather than adding a KMS dependency to an unreviewed scaffold.
-- Swap for real KMS-backed encryption before this goes near production (same caveat as
-- the scrypt password hashing).

CREATE TABLE client_user_mfa_secrets (
  client_user_id     UUID PRIMARY KEY REFERENCES client_users(id),
  secret_encrypted    TEXT NOT NULL,
  backup_codes_hash   TEXT[] NOT NULL DEFAULT '{}', -- salted hashes of one-time recovery codes; consumed individually
  enrolled_at          TIMESTAMPTZ, -- NULL until the first TOTP code is confirmed (enrolment isn't complete until then)
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON client_user_mfa_secrets TO thriski_app;
