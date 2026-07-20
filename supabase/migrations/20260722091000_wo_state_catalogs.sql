-- ============================================================================
-- Phase: 1-9 — Work Order, Diagnostics, and Technician Database
-- Migration: configurable Work Order + Job state graphs (dual-scope catalogs)
-- Tasks: P1-09-DB-001 (WO state graph), P1-09-DB-002 (Job state graph)
-- Owner module: wo
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only);
--   roll-forward-only once configured. Forward-only — no down script.
--
-- Purpose
--   The Work Order and Job lifecycles are CONFIGURABLE transition graphs, not a
--   hard-coded enum: a tenant may add intermediate routing states/transitions.
--   But configurability must never let a tenant disable a mandatory closure
--   control (design F1). So two invariants are enforced structurally here:
--     1. The set of TERMINAL / CLOSED / CANCELLATION states is platform-governed:
--        a tenant-scope state may not set any of those flags (CHECK). Tenants add
--        only non-terminal routing states.
--     2. Flag coherence: closed ⇒ terminal; cancellation ⇒ closed + terminal.
--   The closure gate (later migration) fires on the transition INTO any terminal
--   state and reads these flags structurally; a tenant graph can route work but
--   cannot route AROUND the gate. A transition is valid only if an ACTIVE row for
--   it exists in the visible (platform-or-own-tenant) graph.
--
-- Dependencies
--   org.tenants; iam.current_tenant_id; shared.touch_row_metadata;
--   org.guard_immutable_columns.
--
-- Security implications
--   * Dual-scope: platform defaults visible to all tenants; a tenant may add
--     tenant-scope rows only. sel = platform-or-own-tenant; ins/upd = tenant-only.
--   * ENABLE + FORCE RLS; app roles NOBYPASSRLS; no DELETE grant (soft delete).
--   * Closure-critical flags (is_terminal/is_closed/is_cancellation) are immutable
--     once created so terminality cannot be flipped under live work orders.
--
-- Objects created
--   Tables:   wo.work_order_states, wo.work_order_transitions,
--             wo.job_states, wo.job_transitions
--   Triggers: tg_<t>_touch_metadata, tg_<t>_immutable  (each of the four)
--   Policies: sel/ins/upd_<t>_*  (each of the four)
--   Indexes:  per-scope partial-unique code/edge indexes + tenant FK-cover
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. wo.work_order_states — the configurable Work Order state definitions.
-- ----------------------------------------------------------------------------
CREATE TABLE wo.work_order_states (
  id                     uuid    NOT NULL DEFAULT gen_random_uuid(),
  scope                  text    NOT NULL,
  tenant_id              uuid    NULL,
  code                   text    NOT NULL,
  name                   text    NOT NULL,
  is_terminal            boolean NOT NULL DEFAULT false,
  is_closed              boolean NOT NULL DEFAULT false,
  is_cancellation        boolean NOT NULL DEFAULT false,
  reason_required        boolean NOT NULL DEFAULT false,
  allows_jobs            boolean NOT NULL DEFAULT false,
  allows_labor           boolean NOT NULL DEFAULT false,
  allows_additional_work boolean NOT NULL DEFAULT false,
  requires_qc            boolean NOT NULL DEFAULT false,
  is_reopenable          boolean NOT NULL DEFAULT false,
  status                 text    NOT NULL DEFAULT 'active',
  record_version         integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid    NOT NULL,
  updated_at             timestamptz NULL,
  updated_by             uuid    NULL,
  deleted_at             timestamptz NULL,
  deleted_by             uuid    NULL,

  CONSTRAINT pk_work_order_states PRIMARY KEY (id),
  CONSTRAINT fk_work_order_states_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT ck_work_order_states_scope CHECK (scope IN ('platform', 'tenant')),
  CONSTRAINT ck_work_order_states_scope_tenant CHECK (
    (scope = 'platform' AND tenant_id IS NULL)
    OR (scope = 'tenant' AND tenant_id IS NOT NULL)
  ),
  -- F1: terminal/closed/cancellation states are platform-governed only.
  CONSTRAINT ck_work_order_states_tenant_not_terminal CHECK (
    scope = 'platform'
    OR (is_terminal = false AND is_closed = false AND is_cancellation = false)
  ),
  -- F1: flag coherence. closed ⇒ terminal; cancellation ⇒ closed + terminal.
  CONSTRAINT ck_work_order_states_closed_terminal CHECK (is_closed = false OR is_terminal = true),
  CONSTRAINT ck_work_order_states_cancellation CHECK (
    is_cancellation = false OR (is_terminal = true AND is_closed = true)
  ),
  CONSTRAINT ck_work_order_states_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_work_order_states_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_work_order_states_status CHECK (status IN ('active', 'inactive'))
);
COMMENT ON TABLE wo.work_order_states IS
  'Phase 1-9 configurable Work Order state definitions (P1-09-DB-001). Dual-scope (platform default OR tenant extension). Terminal/closed/cancellation states are platform-only (F1); the closure gate reads these flags structurally.';

CREATE INDEX ix_work_order_states_tenant ON wo.work_order_states (tenant_id);
CREATE UNIQUE INDEX uq_work_order_states_platform_code
  ON wo.work_order_states (code) WHERE scope = 'platform' AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_work_order_states_tenant_code
  ON wo.work_order_states (tenant_id, code) WHERE scope = 'tenant' AND deleted_at IS NULL;

CREATE TRIGGER tg_work_order_states_touch_metadata
  BEFORE UPDATE ON wo.work_order_states
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_work_order_states_immutable
  BEFORE UPDATE ON wo.work_order_states
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'scope', 'tenant_id', 'code', 'is_terminal', 'is_closed', 'is_cancellation',
    'created_at', 'created_by');

ALTER TABLE wo.work_order_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE wo.work_order_states FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_work_order_states_visible ON wo.work_order_states
  FOR SELECT TO app_runtime, app_readonly
  USING (scope = 'platform' OR tenant_id = iam.current_tenant_id());
CREATE POLICY ins_work_order_states_tenant ON wo.work_order_states
  FOR INSERT TO app_runtime
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
CREATE POLICY upd_work_order_states_tenant ON wo.work_order_states
  FOR UPDATE TO app_runtime
  USING (scope = 'tenant' AND tenant_id = iam.current_tenant_id())
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON wo.work_order_states TO app_runtime;
GRANT SELECT ON wo.work_order_states TO app_readonly;

-- ----------------------------------------------------------------------------
-- 2. wo.work_order_transitions — the configurable directed edges.
-- ----------------------------------------------------------------------------
CREATE TABLE wo.work_order_transitions (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  scope          text    NOT NULL,
  tenant_id      uuid    NULL,
  from_state     text    NOT NULL,
  to_state       text    NOT NULL,
  requires_reason boolean NOT NULL DEFAULT false,
  is_active      boolean NOT NULL DEFAULT true,
  record_version integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid    NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid    NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid    NULL,

  CONSTRAINT pk_work_order_transitions PRIMARY KEY (id),
  CONSTRAINT fk_work_order_transitions_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT ck_work_order_transitions_scope CHECK (scope IN ('platform', 'tenant')),
  CONSTRAINT ck_work_order_transitions_scope_tenant CHECK (
    (scope = 'platform' AND tenant_id IS NULL)
    OR (scope = 'tenant' AND tenant_id IS NOT NULL)
  ),
  CONSTRAINT ck_work_order_transitions_from_format CHECK (from_state ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_work_order_transitions_to_format CHECK (to_state ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_work_order_transitions_no_self CHECK (from_state <> to_state)
);
COMMENT ON TABLE wo.work_order_transitions IS
  'Phase 1-9 configurable Work Order transition edges (P1-09-DB-001). A WO transition is valid only if an active edge (visible: platform or own-tenant) exists for (from_state,to_state). Terminal-origin edges are ignored by the guard (BR-WO-002).';

CREATE INDEX ix_work_order_transitions_tenant ON wo.work_order_transitions (tenant_id);
CREATE UNIQUE INDEX uq_work_order_transitions_platform_edge
  ON wo.work_order_transitions (from_state, to_state)
  WHERE scope = 'platform' AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_work_order_transitions_tenant_edge
  ON wo.work_order_transitions (tenant_id, from_state, to_state)
  WHERE scope = 'tenant' AND deleted_at IS NULL;
CREATE INDEX ix_work_order_transitions_lookup
  ON wo.work_order_transitions (from_state, to_state) WHERE is_active AND deleted_at IS NULL;

CREATE TRIGGER tg_work_order_transitions_touch_metadata
  BEFORE UPDATE ON wo.work_order_transitions
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_work_order_transitions_immutable
  BEFORE UPDATE ON wo.work_order_transitions
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'scope', 'tenant_id', 'from_state', 'to_state', 'created_at', 'created_by');

ALTER TABLE wo.work_order_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE wo.work_order_transitions FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_work_order_transitions_visible ON wo.work_order_transitions
  FOR SELECT TO app_runtime, app_readonly
  USING (scope = 'platform' OR tenant_id = iam.current_tenant_id());
CREATE POLICY ins_work_order_transitions_tenant ON wo.work_order_transitions
  FOR INSERT TO app_runtime
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
CREATE POLICY upd_work_order_transitions_tenant ON wo.work_order_transitions
  FOR UPDATE TO app_runtime
  USING (scope = 'tenant' AND tenant_id = iam.current_tenant_id())
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON wo.work_order_transitions TO app_runtime;
GRANT SELECT ON wo.work_order_transitions TO app_readonly;

-- ----------------------------------------------------------------------------
-- 3. wo.job_states — the configurable Job state definitions.
-- ----------------------------------------------------------------------------
CREATE TABLE wo.job_states (
  id                  uuid    NOT NULL DEFAULT gen_random_uuid(),
  scope               text    NOT NULL,
  tenant_id           uuid    NULL,
  code                text    NOT NULL,
  name                text    NOT NULL,
  is_terminal         boolean NOT NULL DEFAULT false,
  reason_required     boolean NOT NULL DEFAULT false,
  assignment_required boolean NOT NULL DEFAULT false,
  labor_allowed       boolean NOT NULL DEFAULT false,
  closure_eligible    boolean NOT NULL DEFAULT false,
  status              text    NOT NULL DEFAULT 'active',
  record_version      integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid    NOT NULL,
  updated_at          timestamptz NULL,
  updated_by          uuid    NULL,
  deleted_at          timestamptz NULL,
  deleted_by          uuid    NULL,

  CONSTRAINT pk_job_states PRIMARY KEY (id),
  CONSTRAINT fk_job_states_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT ck_job_states_scope CHECK (scope IN ('platform', 'tenant')),
  CONSTRAINT ck_job_states_scope_tenant CHECK (
    (scope = 'platform' AND tenant_id IS NULL)
    OR (scope = 'tenant' AND tenant_id IS NOT NULL)
  ),
  CONSTRAINT ck_job_states_tenant_not_terminal CHECK (
    scope = 'platform' OR is_terminal = false
  ),
  CONSTRAINT ck_job_states_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_job_states_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_job_states_status CHECK (status IN ('active', 'inactive'))
);
COMMENT ON TABLE wo.job_states IS
  'Phase 1-9 configurable Job state definitions (P1-09-DB-002). Dual-scope; terminal states are platform-only. Flags drive assignment/labor/closure eligibility.';

CREATE INDEX ix_job_states_tenant ON wo.job_states (tenant_id);
CREATE UNIQUE INDEX uq_job_states_platform_code
  ON wo.job_states (code) WHERE scope = 'platform' AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_job_states_tenant_code
  ON wo.job_states (tenant_id, code) WHERE scope = 'tenant' AND deleted_at IS NULL;

CREATE TRIGGER tg_job_states_touch_metadata
  BEFORE UPDATE ON wo.job_states
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_job_states_immutable
  BEFORE UPDATE ON wo.job_states
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'scope', 'tenant_id', 'code', 'is_terminal', 'created_at', 'created_by');

ALTER TABLE wo.job_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE wo.job_states FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_job_states_visible ON wo.job_states
  FOR SELECT TO app_runtime, app_readonly
  USING (scope = 'platform' OR tenant_id = iam.current_tenant_id());
CREATE POLICY ins_job_states_tenant ON wo.job_states
  FOR INSERT TO app_runtime
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
CREATE POLICY upd_job_states_tenant ON wo.job_states
  FOR UPDATE TO app_runtime
  USING (scope = 'tenant' AND tenant_id = iam.current_tenant_id())
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON wo.job_states TO app_runtime;
GRANT SELECT ON wo.job_states TO app_readonly;

-- ----------------------------------------------------------------------------
-- 4. wo.job_transitions — the configurable Job directed edges.
-- ----------------------------------------------------------------------------
CREATE TABLE wo.job_transitions (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  scope          text    NOT NULL,
  tenant_id      uuid    NULL,
  from_state     text    NOT NULL,
  to_state       text    NOT NULL,
  requires_reason boolean NOT NULL DEFAULT false,
  is_active      boolean NOT NULL DEFAULT true,
  record_version integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid    NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid    NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid    NULL,

  CONSTRAINT pk_job_transitions PRIMARY KEY (id),
  CONSTRAINT fk_job_transitions_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT ck_job_transitions_scope CHECK (scope IN ('platform', 'tenant')),
  CONSTRAINT ck_job_transitions_scope_tenant CHECK (
    (scope = 'platform' AND tenant_id IS NULL)
    OR (scope = 'tenant' AND tenant_id IS NOT NULL)
  ),
  CONSTRAINT ck_job_transitions_from_format CHECK (from_state ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_job_transitions_to_format CHECK (to_state ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_job_transitions_no_self CHECK (from_state <> to_state)
);
COMMENT ON TABLE wo.job_transitions IS
  'Phase 1-9 configurable Job transition edges (P1-09-DB-002). A job transition is valid only if an active edge (platform or own-tenant) exists; terminal-origin edges are ignored by the guard.';

CREATE INDEX ix_job_transitions_tenant ON wo.job_transitions (tenant_id);
CREATE UNIQUE INDEX uq_job_transitions_platform_edge
  ON wo.job_transitions (from_state, to_state)
  WHERE scope = 'platform' AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_job_transitions_tenant_edge
  ON wo.job_transitions (tenant_id, from_state, to_state)
  WHERE scope = 'tenant' AND deleted_at IS NULL;
CREATE INDEX ix_job_transitions_lookup
  ON wo.job_transitions (from_state, to_state) WHERE is_active AND deleted_at IS NULL;

CREATE TRIGGER tg_job_transitions_touch_metadata
  BEFORE UPDATE ON wo.job_transitions
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_job_transitions_immutable
  BEFORE UPDATE ON wo.job_transitions
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'scope', 'tenant_id', 'from_state', 'to_state', 'created_at', 'created_by');

ALTER TABLE wo.job_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE wo.job_transitions FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_job_transitions_visible ON wo.job_transitions
  FOR SELECT TO app_runtime, app_readonly
  USING (scope = 'platform' OR tenant_id = iam.current_tenant_id());
CREATE POLICY ins_job_transitions_tenant ON wo.job_transitions
  FOR INSERT TO app_runtime
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
CREATE POLICY upd_job_transitions_tenant ON wo.job_transitions
  FOR UPDATE TO app_runtime
  USING (scope = 'tenant' AND tenant_id = iam.current_tenant_id())
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON wo.job_transitions TO app_runtime;
GRANT SELECT ON wo.job_transitions TO app_readonly;
