-- ============================================================================
-- Phase: 1-4 — Identity, Authorization, Security, and Audit Database
-- Migration: user accounts, profiles, employee links, and user status history
-- Tasks: P1-04-DB-001, P1-04-DB-002, P1-04-DB-003, P1-04-DB-004
-- Owner module: iam
--
-- Purpose
--   The identity anchor of the platform: one account row per human principal
--   within a tenant, a 1:1 profile, an effective-dated employee-reference link
--   (placeholder — the HR employee master is Phase 1-9), and the append-only
--   lifecycle history of account status transitions.
--
-- Dependencies
--   Phase 1-2 foundation (0002: schemas, roles, iam.* context readers,
--   shared.touch_row_metadata), Phase 1-3 org.tenants (tenant scope) and the
--   shared reference tables (shared.languages / shared.timezones), and the
--   reusable org.guard_immutable_columns guard (20260717101000).
--
-- Rollback classification: ROLLBACK-SAFE while no account row exists;
--   roll-forward-only once real identities are provisioned (accounts anchor
--   every later grant, session, and audit record). Recorded in
--   docs/database/phase-1-4-migration-classification.md.
--
-- Security implications
--   * CREDENTIALS ARE NEVER STORED HERE. An account references its external
--     identity by (identity_provider, provider_subject) only — no password,
--     no password hash, no MFA secret, no provider/refresh/session token. The
--     identity provider remains the credential authority (ADR / security
--     baseline). mfa_required is a policy FLAG, not a secret.
--   * Tenant-scoped: every table carries tenant_id and a composite
--     (tenant_id, id/user_id) key so children carry the tenant through their
--     FKs — a cross-tenant reference is an FK violation, not a filtered row.
--   * Runtime sessions may READ accounts/profiles/links within their own
--     tenant (colleague directory) and the status history of their tenant.
--     They hold NO INSERT/UPDATE/DELETE grant or policy: identity provisioning
--     and lifecycle are platform operations (admin/migration role now; the
--     authorized Phase 1-14 surfaces later) — denied by absent grants AND
--     absent policies.
--   * user_status_history is append-only evidence: rows are written only by
--     iam.change_user_status(); a BEFORE INSERT stamp trigger sets actor_id
--     (from the session context) and occurred_at server-side, so a forged
--     actor or backdated timestamp is impossible even for a direct inserter.
--   * The employee link NEVER modifies account state (no trigger touches
--     iam.user_accounts); it is descriptive metadata with overlap-free
--     effective-dated intervals per user.
--   * Contact fields (email, profile phone) are classified Restricted in the
--     data-classification standard; field-level masking is governed later by
--     iam.sensitive_data_permissions (Increment D).
--
-- Objects created
--   Tables:    iam.user_accounts, iam.user_profiles,
--              iam.user_employee_links, iam.user_status_history
--   Functions: iam.change_user_status(), iam.stamp_user_status_history()
--   Triggers:  tg_user_accounts_touch_metadata, tg_user_accounts_immutable,
--              tg_user_profiles_touch_metadata, tg_user_profiles_immutable,
--              tg_user_employee_links_touch_metadata,
--              tg_user_employee_links_immutable,
--              tg_user_status_history_stamp
--   Policies:  sel_user_accounts_tenant, sel_user_profiles_tenant,
--              sel_user_employee_links_tenant, sel_user_status_history_tenant
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. iam.user_accounts (P1-04-DB-001)
-- ----------------------------------------------------------------------------
CREATE TABLE iam.user_accounts (
  id                uuid              NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         uuid              NOT NULL,
  identity_provider text              NOT NULL,
  provider_subject  text              NOT NULL,
  email             extensions.citext NOT NULL,
  display_name      text              NOT NULL,
  status            text              NOT NULL DEFAULT 'invited',
  mfa_required      boolean           NOT NULL DEFAULT false,
  deleted_at        timestamptz       NULL,
  record_version    integer           NOT NULL DEFAULT 1,
  created_at        timestamptz       NOT NULL DEFAULT now(),
  created_by        uuid              NOT NULL,
  updated_at        timestamptz       NULL,
  updated_by        uuid              NULL,

  CONSTRAINT pk_user_accounts PRIMARY KEY (id),
  CONSTRAINT uq_user_accounts_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_user_accounts_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT ck_user_accounts_provider_format
    CHECK (identity_provider ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_user_accounts_provider_subject_not_blank
    CHECK (btrim(provider_subject) <> ''),
  CONSTRAINT ck_user_accounts_email_shape
    CHECK (email OPERATOR(extensions.~) '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CONSTRAINT ck_user_accounts_display_name_not_blank
    CHECK (btrim(display_name) <> ''),
  CONSTRAINT ck_user_accounts_status
    CHECK (status IN ('invited', 'active', 'locked', 'archived'))
);

COMMENT ON TABLE iam.user_accounts IS
  'One account per human principal within a tenant (P1-04-DB-001). References the external identity by (identity_provider, provider_subject) ONLY — no credential, hash, MFA secret, or token is ever stored; the identity provider is the credential authority. Lifecycle status invited|active|locked|archived changes only through iam.change_user_status(). Soft-deletable (deleted_at). Runtime reads within-tenant; provisioning/lifecycle is a platform operation (no application-role write grant or policy).';
COMMENT ON COLUMN iam.user_accounts.identity_provider IS 'Name of the external identity provider (reference, immutable). NOT a credential.';
COMMENT ON COLUMN iam.user_accounts.provider_subject IS 'Opaque external subject id at the provider (reference, immutable). NOT a credential/token.';
COMMENT ON COLUMN iam.user_accounts.email IS 'Case-insensitive contact email (Restricted classification). Unique per tenant among non-deleted rows.';
COMMENT ON COLUMN iam.user_accounts.mfa_required IS 'Policy flag only — whether the provider must enforce MFA for this principal. Never an MFA secret.';

-- Active-only uniqueness (soft-delete-aware): a live tenant cannot hold two
-- accounts with the same email or the same external identity.
CREATE UNIQUE INDEX uq_user_accounts_tenant_email_active
  ON iam.user_accounts (tenant_id, email) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_user_accounts_provider_identity_active
  ON iam.user_accounts (identity_provider, provider_subject) WHERE deleted_at IS NULL;

CREATE TRIGGER tg_user_accounts_touch_metadata
  BEFORE UPDATE ON iam.user_accounts
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_user_accounts_immutable
  BEFORE UPDATE ON iam.user_accounts
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'identity_provider', 'provider_subject', 'created_at', 'created_by');

-- ----------------------------------------------------------------------------
-- 2. iam.user_profiles (P1-04-DB-002) — 1:1 with the account.
-- ----------------------------------------------------------------------------
CREATE TABLE iam.user_profiles (
  user_id        uuid        NOT NULL,
  tenant_id      uuid        NOT NULL,
  full_name      text        NULL,
  phone_contact  text        NULL,
  locale_code    text        NULL,
  timezone_name  text        NULL,
  avatar_ref     text        NULL,
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,

  CONSTRAINT pk_user_profiles PRIMARY KEY (user_id),
  CONSTRAINT fk_user_profiles_user
    FOREIGN KEY (tenant_id, user_id) REFERENCES iam.user_accounts (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_user_profiles_locale
    FOREIGN KEY (locale_code) REFERENCES shared.languages (locale_code),
  CONSTRAINT fk_user_profiles_timezone
    FOREIGN KEY (timezone_name) REFERENCES shared.timezones (zone_name)
);

COMMENT ON TABLE iam.user_profiles IS
  'Exactly one profile per account (PK = user_id) (P1-04-DB-002). Carries display/contact attributes; phone_contact is Restricted classification. Composite FK (tenant_id, user_id) keeps the tenant scope intact.';

-- (tenant_id, user_id) leads so it covers the composite FK to user_accounts
-- and serves tenant-scoped lookups; PK(user_id) alone would not cover the FK.
CREATE INDEX ix_user_profiles_tenant ON iam.user_profiles (tenant_id, user_id);
CREATE INDEX ix_user_profiles_locale ON iam.user_profiles (locale_code);
CREATE INDEX ix_user_profiles_timezone ON iam.user_profiles (timezone_name);

CREATE TRIGGER tg_user_profiles_touch_metadata
  BEFORE UPDATE ON iam.user_profiles
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_user_profiles_immutable
  BEFORE UPDATE ON iam.user_profiles
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'user_id', 'tenant_id', 'created_at', 'created_by');

-- ----------------------------------------------------------------------------
-- 3. iam.user_employee_links (P1-04-DB-003) — placeholder, no Phase 1-9 FK.
-- ----------------------------------------------------------------------------
CREATE TABLE iam.user_employee_links (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  user_id        uuid        NOT NULL,
  employee_ref   text        NOT NULL,
  valid_from     date        NOT NULL,
  valid_to       date        NULL,
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,

  CONSTRAINT pk_user_employee_links PRIMARY KEY (id),
  CONSTRAINT fk_user_employee_links_user
    FOREIGN KEY (tenant_id, user_id) REFERENCES iam.user_accounts (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_user_employee_links_ref_not_blank CHECK (btrim(employee_ref) <> ''),
  CONSTRAINT ck_user_employee_links_dates CHECK (valid_to IS NULL OR valid_to > valid_from),
  -- One active employment reference per user at any instant (no overlap).
  CONSTRAINT ex_user_employee_links_no_overlap
    EXCLUDE USING gist (
      user_id WITH =,
      daterange(valid_from, valid_to, '[)') WITH &&
    )
);

COMMENT ON TABLE iam.user_employee_links IS
  'Effective-dated link from an account to an external employee reference (P1-04-DB-003). employee_ref is a PLACEHOLDER string — the HR employee master and its FK arrive in Phase 1-9. Intervals per user cannot overlap. This table never modifies account state.';
COMMENT ON COLUMN iam.user_employee_links.employee_ref IS 'Placeholder external employee identifier. NO foreign key to a Phase 1-9 employee table exists yet, by design.';

CREATE INDEX ix_user_employee_links_user ON iam.user_employee_links (tenant_id, user_id);

CREATE TRIGGER tg_user_employee_links_touch_metadata
  BEFORE UPDATE ON iam.user_employee_links
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_user_employee_links_immutable
  BEFORE UPDATE ON iam.user_employee_links
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'user_id', 'valid_from', 'created_at', 'created_by');

-- ----------------------------------------------------------------------------
-- 4. iam.user_status_history (P1-04-DB-004) — append-only evidence.
-- ----------------------------------------------------------------------------
CREATE TABLE iam.user_status_history (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  user_id        uuid        NOT NULL,
  from_state     text        NULL,
  to_state       text        NOT NULL,
  reason         text        NOT NULL,
  actor_id       uuid        NOT NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid        NULL,

  CONSTRAINT pk_user_status_history PRIMARY KEY (id),
  CONSTRAINT fk_user_status_history_user
    FOREIGN KEY (tenant_id, user_id) REFERENCES iam.user_accounts (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_user_status_history_state_change CHECK (from_state IS DISTINCT FROM to_state),
  CONSTRAINT ck_user_status_history_states CHECK (
    to_state IN ('invited', 'active', 'locked', 'archived')
    AND (from_state IS NULL OR from_state IN ('invited', 'active', 'locked', 'archived'))
  ),
  CONSTRAINT ck_user_status_history_reason_not_blank CHECK (btrim(reason) <> '')
);

COMMENT ON TABLE iam.user_status_history IS
  'Append-only account lifecycle evidence (P1-04-DB-004): one row per transition, written atomically with the status change by iam.change_user_status(). actor_id and occurred_at are server-stamped (tg_user_status_history_stamp) so attribution cannot be forged. No application role holds UPDATE or DELETE.';

CREATE INDEX ix_user_status_history_user_occurred
  ON iam.user_status_history (tenant_id, user_id, occurred_at);

-- Server-stamp trigger: forbid forged actor/backdated time on history inserts.
CREATE OR REPLACE FUNCTION iam.stamp_user_status_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.actor_id := iam.current_user_id();
  IF NEW.actor_id IS NULL THEN
    RAISE EXCEPTION 'user status history requires an actor in the session context'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.occurred_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION iam.stamp_user_status_history() IS
  'BEFORE INSERT trigger on iam.user_status_history: overwrites actor_id with iam.current_user_id() (raises if the session set no actor) and occurred_at with now(), so a caller cannot forge attribution or backdate a transition.';

REVOKE EXECUTE ON FUNCTION iam.stamp_user_status_history() FROM PUBLIC;

CREATE TRIGGER tg_user_status_history_stamp
  BEFORE INSERT ON iam.user_status_history
  FOR EACH ROW EXECUTE FUNCTION iam.stamp_user_status_history();

-- ----------------------------------------------------------------------------
-- 5. Atomic account status transition (P1-04-DB-004).
--    SECURITY INVOKER: application roles lack UPDATE on iam.user_accounts, so
--    they cannot use it — account lifecycle is a platform/Phase-1-14 operation.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION iam.change_user_status(
  p_user_id        uuid,
  p_to_state       text,
  p_reason         text,
  p_correlation_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_from    text;
  v_tenant  uuid;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'user status transition requires a reason' USING ERRCODE = 'check_violation';
  END IF;
  IF iam.current_user_id() IS NULL THEN
    RAISE EXCEPTION 'user status transition requires an actor in the session context'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT status, tenant_id INTO v_from, v_tenant
    FROM iam.user_accounts WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user % does not exist', p_user_id USING ERRCODE = 'no_data_found';
  END IF;
  IF v_from = p_to_state THEN
    RAISE EXCEPTION 'user % is already %', p_user_id, p_to_state USING ERRCODE = 'check_violation';
  END IF;

  -- Valid lifecycle graph; archived is terminal.
  IF NOT (
       (v_from = 'invited' AND p_to_state IN ('active', 'archived'))
    OR (v_from = 'active'  AND p_to_state IN ('locked', 'archived'))
    OR (v_from = 'locked'  AND p_to_state IN ('active', 'archived'))
  ) THEN
    RAISE EXCEPTION 'invalid user status transition % -> %', v_from, p_to_state
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE iam.user_accounts SET status = p_to_state WHERE id = p_user_id;

  INSERT INTO iam.user_status_history (tenant_id, user_id, from_state, to_state, reason, actor_id, correlation_id)
  VALUES (v_tenant, p_user_id, v_from, p_to_state, p_reason, iam.current_user_id(), p_correlation_id);
END;
$$;

COMMENT ON FUNCTION iam.change_user_status(uuid, text, text, uuid) IS
  'Atomic account lifecycle transition (P1-04-DB-004): row lock, graph validation (archived terminal), status UPDATE and append-only history INSERT in one transaction. SECURITY INVOKER — application roles without UPDATE on iam.user_accounts cannot use it.';

REVOKE EXECUTE ON FUNCTION iam.change_user_status(uuid, text, text, uuid) FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 6. Row-Level Security — enabled AND forced; default deny.
-- ----------------------------------------------------------------------------
ALTER TABLE iam.user_accounts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.user_accounts        FORCE  ROW LEVEL SECURITY;
ALTER TABLE iam.user_profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.user_profiles        FORCE  ROW LEVEL SECURITY;
ALTER TABLE iam.user_employee_links  ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.user_employee_links  FORCE  ROW LEVEL SECURITY;
ALTER TABLE iam.user_status_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.user_status_history  FORCE  ROW LEVEL SECURITY;

CREATE POLICY sel_user_accounts_tenant ON iam.user_accounts
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());
CREATE POLICY sel_user_profiles_tenant ON iam.user_profiles
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());
CREATE POLICY sel_user_employee_links_tenant ON iam.user_employee_links
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());
CREATE POLICY sel_user_status_history_tenant ON iam.user_status_history
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());

COMMENT ON POLICY sel_user_accounts_tenant ON iam.user_accounts IS
  'Within-tenant read only. No context → NULL comparison → zero rows (default deny). No INSERT/UPDATE/DELETE policy: identity provisioning and lifecycle are platform operations in this phase.';

-- ----------------------------------------------------------------------------
-- 7. Grants — explicit, minimal (SELECT only; writes are platform operations).
-- ----------------------------------------------------------------------------
GRANT SELECT ON iam.user_accounts       TO app_runtime, app_readonly;
GRANT SELECT ON iam.user_profiles       TO app_runtime, app_readonly;
GRANT SELECT ON iam.user_employee_links TO app_runtime, app_readonly;
GRANT SELECT ON iam.user_status_history TO app_runtime, app_readonly;
-- Deliberately ABSENT: INSERT/UPDATE/DELETE for both roles on all four tables.
