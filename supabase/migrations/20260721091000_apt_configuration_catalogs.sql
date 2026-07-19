-- ============================================================================
-- Phase: 1-8 — Appointment and Vehicle Reception Database
-- Migration: Appointment dual-scope configuration catalogs
-- Tasks: P1-08 Wave 2 (appointment reference configuration)
-- Owner module: apt
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once rows exist. Forward-only — no down script.
--
-- Purpose
--   Three tenant-extensible configuration catalogs the appointment master
--   references: appointment types, intake source channels, and cancellation
--   reasons. Each is DUAL-SCOPE (veh-catalog precedent, P1-07-DB-006): a
--   platform default row (scope='platform', tenant_id NULL) OR a tenant
--   extension (scope='tenant', tenant_id NOT NULL). Zero rows ship (no-fake-data);
--   platform rows are provisioned admin-side and tenant rows at runtime. No
--   Benzene identifiers or real operational values are seeded or defaulted.
--
--   No-show reasons are NOT a separate catalog in this phase: the no-show event
--   is recorded on the appointment master and in the append-only status history
--   (free-text reason), pending any P1-OD-018 policy that would make them a
--   governed code list.
--
-- Dependencies
--   org.tenants; iam.current_tenant_id; shared.touch_row_metadata;
--   org.guard_immutable_columns; the apt schema (20260721090000).
--
-- Security implications
--   * ENABLE + FORCE RLS; platform rows visible to every tenant, tenant rows
--     only to their owner; a tenant may only write scope='tenant' rows of its
--     own tenant (platform rows are admin-only) — the UPDATE policy is
--     USING (scope='tenant' AND tenant_id = current), so a platform row can
--     never be claimed or edited by a tenant.
--   * scope, tenant_id, code, created_at, created_by immutable.
--
-- Objects created
--   Tables:    apt.appointment_types, apt.source_channels, apt.cancellation_reasons
--   Triggers:  tg_<t>_touch_metadata, tg_<t>_immutable (per table)
--   Policies:  sel_<t>_visible, ins_<t>_tenant, upd_<t>_tenant (per table)
--   Indexes:   ix_<t>_tenant, uq_<t>_platform_code, uq_<t>_tenant_code (per table)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. apt.appointment_types
-- ----------------------------------------------------------------------------
CREATE TABLE apt.appointment_types (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  scope          text        NOT NULL,
  tenant_id      uuid        NULL,
  code           text        NOT NULL,
  name           text        NOT NULL,
  status         text        NOT NULL DEFAULT 'active',
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid        NULL,

  CONSTRAINT pk_appointment_types PRIMARY KEY (id),
  CONSTRAINT fk_appointment_types_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT ck_appointment_types_scope CHECK (scope IN ('platform', 'tenant')),
  CONSTRAINT ck_appointment_types_scope_tenant CHECK (
    (scope = 'platform' AND tenant_id IS NULL)
    OR (scope = 'tenant' AND tenant_id IS NOT NULL)
  ),
  CONSTRAINT ck_appointment_types_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_appointment_types_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_appointment_types_status CHECK (status IN ('active', 'inactive'))
);
COMMENT ON TABLE apt.appointment_types IS
  'Phase 1-8 appointment type catalog. Dual-scope (platform default or tenant extension). Zero rows shipped (no-fake-data).';
CREATE INDEX ix_appointment_types_tenant ON apt.appointment_types (tenant_id);
CREATE UNIQUE INDEX uq_appointment_types_platform_code
  ON apt.appointment_types (code) WHERE scope = 'platform' AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_appointment_types_tenant_code
  ON apt.appointment_types (tenant_id, code) WHERE scope = 'tenant' AND deleted_at IS NULL;
CREATE TRIGGER tg_appointment_types_touch_metadata
  BEFORE UPDATE ON apt.appointment_types
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_appointment_types_immutable
  BEFORE UPDATE ON apt.appointment_types
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'scope', 'tenant_id', 'code', 'created_at', 'created_by');
ALTER TABLE apt.appointment_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE apt.appointment_types FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_appointment_types_visible ON apt.appointment_types
  FOR SELECT TO app_runtime, app_readonly
  USING (scope = 'platform' OR tenant_id = iam.current_tenant_id());
CREATE POLICY ins_appointment_types_tenant ON apt.appointment_types
  FOR INSERT TO app_runtime
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
CREATE POLICY upd_appointment_types_tenant ON apt.appointment_types
  FOR UPDATE TO app_runtime
  USING (scope = 'tenant' AND tenant_id = iam.current_tenant_id())
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON apt.appointment_types TO app_runtime;
GRANT SELECT ON apt.appointment_types TO app_readonly;

-- ----------------------------------------------------------------------------
-- 2. apt.source_channels
-- ----------------------------------------------------------------------------
CREATE TABLE apt.source_channels (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  scope          text        NOT NULL,
  tenant_id      uuid        NULL,
  code           text        NOT NULL,
  name           text        NOT NULL,
  status         text        NOT NULL DEFAULT 'active',
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid        NULL,

  CONSTRAINT pk_source_channels PRIMARY KEY (id),
  CONSTRAINT fk_source_channels_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT ck_source_channels_scope CHECK (scope IN ('platform', 'tenant')),
  CONSTRAINT ck_source_channels_scope_tenant CHECK (
    (scope = 'platform' AND tenant_id IS NULL)
    OR (scope = 'tenant' AND tenant_id IS NOT NULL)
  ),
  CONSTRAINT ck_source_channels_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_source_channels_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_source_channels_status CHECK (status IN ('active', 'inactive'))
);
COMMENT ON TABLE apt.source_channels IS
  'Phase 1-8 intake source-channel catalog (phone/walk-in/online/… — provisioned, never seeded). Dual-scope. Reused by rec.walk_ins.';
CREATE INDEX ix_source_channels_tenant ON apt.source_channels (tenant_id);
CREATE UNIQUE INDEX uq_source_channels_platform_code
  ON apt.source_channels (code) WHERE scope = 'platform' AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_source_channels_tenant_code
  ON apt.source_channels (tenant_id, code) WHERE scope = 'tenant' AND deleted_at IS NULL;
CREATE TRIGGER tg_source_channels_touch_metadata
  BEFORE UPDATE ON apt.source_channels
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_source_channels_immutable
  BEFORE UPDATE ON apt.source_channels
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'scope', 'tenant_id', 'code', 'created_at', 'created_by');
ALTER TABLE apt.source_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE apt.source_channels FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_source_channels_visible ON apt.source_channels
  FOR SELECT TO app_runtime, app_readonly
  USING (scope = 'platform' OR tenant_id = iam.current_tenant_id());
CREATE POLICY ins_source_channels_tenant ON apt.source_channels
  FOR INSERT TO app_runtime
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
CREATE POLICY upd_source_channels_tenant ON apt.source_channels
  FOR UPDATE TO app_runtime
  USING (scope = 'tenant' AND tenant_id = iam.current_tenant_id())
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON apt.source_channels TO app_runtime;
GRANT SELECT ON apt.source_channels TO app_readonly;

-- ----------------------------------------------------------------------------
-- 3. apt.cancellation_reasons
-- ----------------------------------------------------------------------------
CREATE TABLE apt.cancellation_reasons (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  scope          text        NOT NULL,
  tenant_id      uuid        NULL,
  code           text        NOT NULL,
  name           text        NOT NULL,
  status         text        NOT NULL DEFAULT 'active',
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid        NULL,

  CONSTRAINT pk_cancellation_reasons PRIMARY KEY (id),
  CONSTRAINT fk_cancellation_reasons_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT ck_cancellation_reasons_scope CHECK (scope IN ('platform', 'tenant')),
  CONSTRAINT ck_cancellation_reasons_scope_tenant CHECK (
    (scope = 'platform' AND tenant_id IS NULL)
    OR (scope = 'tenant' AND tenant_id IS NOT NULL)
  ),
  CONSTRAINT ck_cancellation_reasons_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_cancellation_reasons_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_cancellation_reasons_status CHECK (status IN ('active', 'inactive'))
);
COMMENT ON TABLE apt.cancellation_reasons IS
  'Phase 1-8 appointment cancellation-reason catalog. Dual-scope. A cancellation requires a reason from this catalog (apt.appointments). Zero rows shipped.';
CREATE INDEX ix_cancellation_reasons_tenant ON apt.cancellation_reasons (tenant_id);
CREATE UNIQUE INDEX uq_cancellation_reasons_platform_code
  ON apt.cancellation_reasons (code) WHERE scope = 'platform' AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_cancellation_reasons_tenant_code
  ON apt.cancellation_reasons (tenant_id, code) WHERE scope = 'tenant' AND deleted_at IS NULL;
CREATE TRIGGER tg_cancellation_reasons_touch_metadata
  BEFORE UPDATE ON apt.cancellation_reasons
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_cancellation_reasons_immutable
  BEFORE UPDATE ON apt.cancellation_reasons
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'scope', 'tenant_id', 'code', 'created_at', 'created_by');
ALTER TABLE apt.cancellation_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE apt.cancellation_reasons FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_cancellation_reasons_visible ON apt.cancellation_reasons
  FOR SELECT TO app_runtime, app_readonly
  USING (scope = 'platform' OR tenant_id = iam.current_tenant_id());
CREATE POLICY ins_cancellation_reasons_tenant ON apt.cancellation_reasons
  FOR INSERT TO app_runtime
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
CREATE POLICY upd_cancellation_reasons_tenant ON apt.cancellation_reasons
  FOR UPDATE TO app_runtime
  USING (scope = 'tenant' AND tenant_id = iam.current_tenant_id())
  WITH CHECK (scope = 'tenant' AND tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON apt.cancellation_reasons TO app_runtime;
GRANT SELECT ON apt.cancellation_reasons TO app_readonly;
