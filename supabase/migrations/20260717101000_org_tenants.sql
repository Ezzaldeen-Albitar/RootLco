-- ============================================================================
-- Phase: 1-3 — Tenant, Company, Branch, and Organizational Database
-- Migration: tenant root object and tenant status history
-- Tasks: P1-03-DB-001, P1-03-DB-002, P1-03-SEC-001/002 (tenant surface)
-- Owner module: org
--
-- Purpose
--   The root of the organizational hierarchy: one row per subscribing tenant,
--   plus the append-only lifecycle history of tenant status transitions and
--   the atomic transition function that keeps table and history in one
--   transaction.
--
-- Dependency
--   20260717100000_org_reference_tables.sql (shared.languages,
--   shared.timezones referenced by default_locale / default_timezone) and the
--   Phase 1-2 foundation (0002: schemas, roles, iam.* context readers,
--   shared.touch_row_metadata).
--
-- Rollback classification: ROLLBACK-SAFE while no tenant row exists;
--   roll-forward-only from the moment a real tenant is provisioned (dropping
--   the root of the hierarchy destroys every scope reference below it).
--   Recorded in docs/database/phase-1-3-migration-classification.md.
--
-- Security implications
--   * org.tenants is the ROOT SCOPE OBJECT. It deliberately carries NO
--     tenant_id column: a tenant does not belong to a tenant — its own id IS
--     the scope every other table references. It must not be misread as an
--     ordinary tenant-child table missing its scope column; the automated
--     tenant-column assertion documents it as the explicit root exception.
--   * Runtime tenant sessions must NOT enumerate tenants. The only policy is
--     a self-row SELECT (id = iam.current_tenant_id()); with no context the
--     comparison is against NULL and matches nothing (default deny).
--   * Tenant IDs are internal identifiers, never authorization tokens:
--     knowing an id grants nothing — the transaction context is set
--     server-side (0002) and is the only thing policies trust.
--   * Platform-operator administration (creating tenants, changing status) is
--     NOT granted to app_runtime/app_readonly at all. It runs through the
--     migration/admin role today and through the Phase 1-4/1-14 platform
--     surfaces later. The separation is enforced by the absence of both
--     grants and policies, denied twice over.
--   * History is append-only evidence: INSERT happens only inside the
--     transition function; no UPDATE/DELETE grant or policy exists for any
--     application role.
--
-- Objects created
--   Tables:    org.tenants, org.tenant_status_history
--   Functions: org.guard_immutable_columns(), org.change_tenant_status()
--   Triggers:  tg_tenants_touch_metadata, tg_tenants_immutable_columns
--   Policies:  sel_tenants_self, sel_tenant_status_history_tenant
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Reusable immutable-column guard (used by every org table with immutable
--    natural codes / scope columns). Columns are named as trigger arguments,
--    so one audited function serves the whole module.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION org.guard_immutable_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  col text;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    IF to_jsonb(NEW) -> col IS DISTINCT FROM to_jsonb(OLD) -> col THEN
      RAISE EXCEPTION '%.%: column % is immutable', TG_TABLE_SCHEMA, TG_TABLE_NAME, col
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION org.guard_immutable_columns() IS
  'BEFORE UPDATE guard: rejects any change to the columns named as trigger arguments (ERRCODE check_violation). Enforces the "codes and scope columns are immutable after creation" rule of the organizational model (P1-03-DB-001/016); controlled recoding is soft-delete + recreate, never in-place edit.';

REVOKE EXECUTE ON FUNCTION org.guard_immutable_columns() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 2. org.tenants (P1-03-DB-001)
--    Lifecycle: status-driven (provisioning → active ⇄ suspended → closed).
--    No soft-delete columns: a tenant is never deleted, it is CLOSED — closure
--    is itself evidence and the row remains the anchor of all historical data.
-- ----------------------------------------------------------------------------
CREATE TABLE org.tenants (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_code      text        NOT NULL,
  display_name     text        NOT NULL,
  status           text        NOT NULL DEFAULT 'provisioning',
  default_locale   text        NOT NULL,
  default_timezone text        NOT NULL,
  record_version   integer     NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_at       timestamptz NULL,
  updated_by       uuid        NULL,

  CONSTRAINT pk_tenants PRIMARY KEY (id),
  CONSTRAINT uq_tenants_tenant_code UNIQUE (tenant_code),
  CONSTRAINT ck_tenants_code_format CHECK (tenant_code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_tenants_display_name_not_blank CHECK (btrim(display_name) <> ''),
  CONSTRAINT ck_tenants_status
    CHECK (status IN ('provisioning', 'active', 'suspended', 'closed')),
  CONSTRAINT fk_tenants_default_locale
    FOREIGN KEY (default_locale) REFERENCES shared.languages (locale_code),
  CONSTRAINT fk_tenants_default_timezone
    FOREIGN KEY (default_timezone) REFERENCES shared.timezones (zone_name)
);

COMMENT ON TABLE org.tenants IS
  'Root of the organizational hierarchy: one row per subscribing tenant (P1-03-DB-001). ROOT-SCOPE EXCEPTION: deliberately carries NO tenant_id column — a tenant does not belong to a tenant; its own id is the scope value every tenant-owned table references. Not an ordinary tenant-child table. Lifecycle is status-driven (provisioning|active|suspended|closed); a tenant is closed, never deleted. Tenant ids are internal identifiers, never authorization tokens. Runtime sessions see only their own row; platform administration is not granted to application roles in this phase (Phase 1-4/1-14).';
COMMENT ON COLUMN org.tenants.tenant_code IS
  'Stable machine-readable natural key. Unique and IMMUTABLE (tg_tenants_immutable_columns). User-supplied at provisioning, never edited afterwards.';
COMMENT ON COLUMN org.tenants.status IS
  'provisioning | active | suspended | closed. Deterministic initial state is provisioning (column default). Every transition goes through org.change_tenant_status(), which records the append-only history row in the same transaction. Queryable by the future session layer (Phase 1-4) to refuse suspended/closed tenants.';

-- FK-support indexes for the platform-reference FKs (documented non-tenant-
-- leading justification: they support reference FKs, not tenant query paths).
CREATE INDEX ix_tenants_default_locale ON org.tenants (default_locale);
CREATE INDEX ix_tenants_default_timezone ON org.tenants (default_timezone);

CREATE TRIGGER tg_tenants_touch_metadata
  BEFORE UPDATE ON org.tenants
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

CREATE TRIGGER tg_tenants_immutable_columns
  BEFORE UPDATE ON org.tenants
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_code');

-- ----------------------------------------------------------------------------
-- 3. org.tenant_status_history (P1-03-DB-002) — append-only evidence.
-- ----------------------------------------------------------------------------
CREATE TABLE org.tenant_status_history (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  from_state     text        NULL,
  to_state       text        NOT NULL,
  reason         text        NOT NULL,
  actor_id       uuid        NOT NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid        NULL,

  CONSTRAINT pk_tenant_status_history PRIMARY KEY (id),
  CONSTRAINT fk_tenant_status_history_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT ck_tenant_status_history_state_change
    CHECK (from_state IS DISTINCT FROM to_state),
  CONSTRAINT ck_tenant_status_history_states
    CHECK (
      to_state IN ('provisioning', 'active', 'suspended', 'closed')
      AND (from_state IS NULL
           OR from_state IN ('provisioning', 'active', 'suspended', 'closed'))
    ),
  CONSTRAINT ck_tenant_status_history_reason_not_blank CHECK (btrim(reason) <> '')
);

COMMENT ON TABLE org.tenant_status_history IS
  'Append-only tenant lifecycle evidence (P1-03-DB-002): one row per transition, written atomically with the status change by org.change_tenant_status(). Every transition requires a non-blank reason. No application role holds UPDATE or DELETE — denied by absent grants AND absent policies. Lifecycle class: immutable/append-only.';

CREATE INDEX ix_tenant_status_history_tenant_id_occurred_at
  ON org.tenant_status_history (tenant_id, occurred_at);

-- ----------------------------------------------------------------------------
-- 4. Atomic transition function (P1-03-DB-002).
--    SECURITY INVOKER: it acts with the caller's privileges, so a runtime
--    session (no UPDATE grant on org.tenants) cannot use it to escalate —
--    tenant lifecycle is a platform operation in this phase. The valid
--    transition graph is enforced here; `closed` is terminal.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION org.change_tenant_status(
  p_tenant_id      uuid,
  p_to_state       text,
  p_reason         text,
  p_actor_id       uuid DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_from  text;
  v_actor uuid;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'tenant status transition requires a reason'
      USING ERRCODE = 'check_violation';
  END IF;

  v_actor := COALESCE(iam.current_user_id(), p_actor_id);
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'tenant status transition requires an actor (session context or p_actor_id)'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT status INTO v_from FROM org.tenants WHERE id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant % does not exist', p_tenant_id USING ERRCODE = 'no_data_found';
  END IF;

  IF v_from = p_to_state THEN
    RAISE EXCEPTION 'tenant % is already %', p_tenant_id, p_to_state
      USING ERRCODE = 'check_violation';
  END IF;

  -- Valid lifecycle graph; closed is terminal.
  IF NOT (
       (v_from = 'provisioning' AND p_to_state IN ('active', 'closed'))
    OR (v_from = 'active'       AND p_to_state IN ('suspended', 'closed'))
    OR (v_from = 'suspended'    AND p_to_state IN ('active', 'closed'))
  ) THEN
    RAISE EXCEPTION 'invalid tenant status transition % -> %', v_from, p_to_state
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE org.tenants SET status = p_to_state WHERE id = p_tenant_id;

  INSERT INTO org.tenant_status_history
    (tenant_id, from_state, to_state, reason, actor_id, correlation_id)
  VALUES
    (p_tenant_id, v_from, p_to_state, p_reason, v_actor, p_correlation_id);
END;
$$;

COMMENT ON FUNCTION org.change_tenant_status(uuid, text, text, uuid, uuid) IS
  'Atomic tenant lifecycle transition (P1-03-DB-002): row lock, graph validation (closed is terminal), status UPDATE and append-only history INSERT in one transaction — a failure of either rolls back both. SECURITY INVOKER: callers without UPDATE on org.tenants (all application roles in this phase) cannot use it; platform operations run it via the admin/migration role until Phase 1-4/1-14 build the authorized surfaces.';

REVOKE EXECUTE ON FUNCTION org.change_tenant_status(uuid, text, text, uuid, uuid) FROM PUBLIC;
-- Deliberately NOT granted to app_runtime/app_readonly: tenant lifecycle is a
-- platform operation. (SECURITY INVOKER would deny them anyway — two layers.)

-- ----------------------------------------------------------------------------
-- 5. Row-Level Security — enabled AND forced; default deny.
-- ----------------------------------------------------------------------------
ALTER TABLE org.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE org.tenant_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.tenant_status_history FORCE ROW LEVEL SECURITY;

-- Minimum safe self-tenant projection: a session sees exactly its own tenant
-- row. No context → NULL comparison → zero rows. No enumeration exists.
CREATE POLICY sel_tenants_self ON org.tenants
  FOR SELECT TO app_runtime, app_readonly
  USING (id = iam.current_tenant_id());

CREATE POLICY sel_tenant_status_history_tenant ON org.tenant_status_history
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());

COMMENT ON POLICY sel_tenants_self ON org.tenants IS
  'Self-row projection only: runtime sessions can read their own tenant (status, defaults) and nothing else. Tenant enumeration is structurally impossible for application roles. No INSERT/UPDATE/DELETE policy exists — platform administration is not an application-role capability in this phase.';

-- ----------------------------------------------------------------------------
-- 6. Grants — explicit, minimal.
-- ----------------------------------------------------------------------------
GRANT SELECT ON org.tenants TO app_runtime, app_readonly;
GRANT SELECT ON org.tenant_status_history TO app_runtime, app_readonly;

-- Deliberately ABSENT: INSERT/UPDATE/DELETE on both tables for both roles.
-- Tenant provisioning and lifecycle are platform operations (admin/migration
-- role now; authorized Phase 1-4/1-14 surfaces later).
