-- Epic 2: session management for AUTH-002/003 (sign in / sign out).
--
-- Access tokens are short-lived, stateless JWTs (see src/modules/identity/identity.service.ts)
-- and are never persisted here. This table exists only for the piece that must be
-- revocable: the refresh token that mints a new access token. Rotated on every use
-- (replaced_by chains the old row to the new one) so a stolen-and-reused refresh token
-- is detectable — see the reuse-detection check in identity.service.ts.
--
-- Only ever touched as actorType: 'system' from inside the identity module (it is
-- session infrastructure, not tenant-scoped domain data), but every access still goes
-- through withAuthorizationContext per Section 20.2 — no module is exempt from that
-- rule just because a table has no RLS.

CREATE TABLE refresh_tokens (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type    TEXT NOT NULL CHECK (actor_type IN ('broker', 'client_user', 'platform_admin')),
  actor_id      UUID NOT NULL,
  token_hash    TEXT NOT NULL, -- sha256 of the opaque token; the raw token is never stored
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  replaced_by   UUID REFERENCES refresh_tokens(id), -- rotation chain
  user_agent    TEXT,
  ip_address    TEXT
);

CREATE UNIQUE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_tokens_actor ON refresh_tokens(actor_type, actor_id) WHERE revoked_at IS NULL;

-- No DELETE grant, same reasoning as audit_log/metering_event (0007's comment):
-- a session is revoked by setting revoked_at, never removed, so a reuse-detection
-- check always has the full chain to inspect.
GRANT SELECT, INSERT, UPDATE ON refresh_tokens TO thriski_app;
