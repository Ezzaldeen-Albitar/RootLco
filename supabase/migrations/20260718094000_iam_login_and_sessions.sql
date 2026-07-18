-- ============================================================================
-- Phase: 1-4 — Identity, Authorization, Security, and Audit Database
-- Migration: login audit and session metadata
-- Tasks: P1-04-DB-012, P1-04-DB-013
-- Owner module: iam
--
-- Purpose
--   An append-only record of authentication events and a table of session
--   METADATA. Neither stores a credential, token, plaintext IP, or plaintext
--   user-agent — session issuance and invalidation are Phase-1-14 services;
--   this phase only defines the durable, access-controlled shapes.
--
-- Dependencies
--   Increment A (iam.user_accounts), 0002 guards.
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once
--   populated (login audit is evidence). Recorded in
--   docs/database/phase-1-4-migration-classification.md.
--
-- Security implications
--   * NO password, password hash, MFA secret, session token, refresh token, or
--     provider token is stored. Client network context is kept ONLY as opaque
--     hashes (ip_hash, user_agent_hash) — never plaintext.
--   * login_audit is append-only; occurred_at is server-stamped so events
--     cannot be backdated. tenant_id/user_id are nullable ONLY for failed
--     attempts against an unknown principal; success/lockout/logout require a
--     known user (and therefore a tenant).
--   * A user reads only their OWN login history and their OWN sessions
--     (user_id = iam.current_user_id()); security-wide viewing requires an
--     explicit permission added in Increment I. Runtime never writes either
--     table.
--
-- Objects created
--   Tables:    iam.login_audit, iam.user_sessions
--   Functions: iam.stamp_login_audit()
--   Triggers:  tg_login_audit_stamp, tg_user_sessions_touch_metadata,
--              tg_user_sessions_immutable
--   Policies:  sel_login_audit_own, sel_user_sessions_own
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. iam.login_audit (P1-04-DB-012) — append-only authentication events.
-- ----------------------------------------------------------------------------
CREATE TABLE iam.login_audit (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       uuid        NULL,
  user_id         uuid        NULL,
  event_type      text        NOT NULL,
  ip_hash         text        NULL,
  user_agent_hash text        NULL,
  detail          text        NULL,
  correlation_id  uuid        NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_login_audit PRIMARY KEY (id),
  CONSTRAINT fk_login_audit_user
    FOREIGN KEY (tenant_id, user_id) REFERENCES iam.user_accounts (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_login_audit_event
    CHECK (event_type IN ('success', 'failure', 'lockout', 'logout')),
  -- Only a failed attempt may be anonymous; every other event names a user.
  CONSTRAINT ck_login_audit_known_user CHECK (event_type = 'failure' OR user_id IS NOT NULL),
  -- A known user implies a known tenant.
  CONSTRAINT ck_login_audit_tenant CHECK (user_id IS NULL OR tenant_id IS NOT NULL)
);

COMMENT ON TABLE iam.login_audit IS
  'Append-only authentication events (P1-04-DB-012): success|failure|lockout|logout. No credential/token is stored; client context is hashed only (ip_hash, user_agent_hash). occurred_at is server-stamped. tenant_id/user_id are nullable ONLY for a failed attempt against an unknown principal. A user reads only their own events.';
COMMENT ON COLUMN iam.login_audit.ip_hash IS 'Opaque hash of the client IP (Restricted). Never the plaintext address.';
COMMENT ON COLUMN iam.login_audit.user_agent_hash IS 'Opaque hash of the client user-agent (Restricted). Never the plaintext string.';

CREATE INDEX ix_login_audit_user_occurred ON iam.login_audit (tenant_id, user_id, occurred_at);

CREATE OR REPLACE FUNCTION iam.stamp_login_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.occurred_at := now(); -- server-stamped; events cannot be backdated
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION iam.stamp_login_audit() IS
  'BEFORE INSERT trigger on iam.login_audit: forces occurred_at = now() so an authentication event cannot be backdated by the writer.';

REVOKE EXECUTE ON FUNCTION iam.stamp_login_audit() FROM PUBLIC;

CREATE TRIGGER tg_login_audit_stamp
  BEFORE INSERT ON iam.login_audit
  FOR EACH ROW EXECUTE FUNCTION iam.stamp_login_audit();

-- ----------------------------------------------------------------------------
-- 2. iam.user_sessions (P1-04-DB-013) — session METADATA, never tokens.
-- ----------------------------------------------------------------------------
CREATE TABLE iam.user_sessions (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  user_id         uuid        NOT NULL,
  session_ref     text        NOT NULL,
  ip_hash         text        NULL,
  user_agent_hash text        NULL,
  issued_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NULL,
  expires_at      timestamptz NULL,
  revoked_at      timestamptz NULL,
  revoke_reason   text        NULL,
  correlation_id  uuid        NULL,
  record_version  integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL,
  updated_at      timestamptz NULL,
  updated_by      uuid        NULL,

  CONSTRAINT pk_user_sessions PRIMARY KEY (id),
  CONSTRAINT uq_user_sessions_session_ref UNIQUE (session_ref),
  CONSTRAINT fk_user_sessions_user
    FOREIGN KEY (tenant_id, user_id) REFERENCES iam.user_accounts (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_user_sessions_ref_not_blank CHECK (btrim(session_ref) <> ''),
  CONSTRAINT ck_user_sessions_revoke_reason
    CHECK (revoked_at IS NULL OR btrim(COALESCE(revoke_reason, '')) <> '')
);

COMMENT ON TABLE iam.user_sessions IS
  'Session METADATA (P1-04-DB-013) — NOT tokens. session_ref is an opaque unique handle; no session/refresh/provider token, no credential is stored. Client context is hashed only. Issuance, refresh, and revocation are Phase-1-14 services; this phase stores and access-controls the shape. A user sees only their own sessions.';
COMMENT ON COLUMN iam.user_sessions.session_ref IS 'Opaque unique session handle (NOT the session token).';

CREATE INDEX ix_user_sessions_user ON iam.user_sessions (tenant_id, user_id);
-- Active-session lookups (not yet revoked).
CREATE INDEX ix_user_sessions_active ON iam.user_sessions (tenant_id, user_id) WHERE revoked_at IS NULL;

CREATE TRIGGER tg_user_sessions_touch_metadata
  BEFORE UPDATE ON iam.user_sessions
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_user_sessions_immutable
  BEFORE UPDATE ON iam.user_sessions
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'user_id', 'session_ref', 'issued_at', 'created_at', 'created_by');

-- ----------------------------------------------------------------------------
-- 3. Row-Level Security — enabled AND forced; default deny (own rows only).
-- ----------------------------------------------------------------------------
ALTER TABLE iam.login_audit   ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.login_audit   FORCE  ROW LEVEL SECURITY;
ALTER TABLE iam.user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.user_sessions FORCE  ROW LEVEL SECURITY;

CREATE POLICY sel_login_audit_own ON iam.login_audit
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND user_id = iam.current_user_id());
CREATE POLICY sel_user_sessions_own ON iam.user_sessions
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND user_id = iam.current_user_id());

COMMENT ON POLICY sel_login_audit_own ON iam.login_audit IS
  'Own login history only. Anonymous failed attempts (user_id NULL) are visible to no application session. Security-wide viewing requires an explicit permission (Increment I).';

-- ----------------------------------------------------------------------------
-- 4. Grants — explicit, minimal (SELECT only).
-- ----------------------------------------------------------------------------
GRANT SELECT ON iam.login_audit   TO app_runtime, app_readonly;
GRANT SELECT ON iam.user_sessions TO app_runtime, app_readonly;
-- Deliberately ABSENT: INSERT/UPDATE/DELETE for both roles on both tables.
