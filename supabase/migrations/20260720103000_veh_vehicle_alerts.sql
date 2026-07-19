-- ============================================================================
-- Phase: 1-7 — Vehicle Database
-- Migration: Vehicle alerts (safety / technical / commercial / other)
-- Tasks: P1-07-DB-016
-- Owner module: veh
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once alerts exist. Forward-only — no down script.
--
-- Purpose
--   veh.vehicle_alerts holds tenant-authored advisories attached to a Vehicle
--   (safety/technical/commercial/other) with a severity, an effective window, an
--   explicit active flag, and acknowledgement attribution. Alerts are soft-deleted
--   (historical decisions are never silently removed) and are NEVER part of an
--   unrestricted search projection. Alert message text is tenant-internal and must
--   not carry prior-owner PII — that is a backend authoring responsibility; the
--   database classifies the column internal and keeps it out of search.
--
-- Dependencies
--   veh.vehicles (20260720092000); org.tenants; shared.touch_row_metadata;
--   org.guard_immutable_columns; iam.current_tenant_id.
--
-- Details
--   Same-tenant composite Vehicle FK. Valid effective interval (effective_to is
--   open or not before effective_from). Acknowledgement is coherent
--   ((acknowledged_by IS NULL) = (acknowledged_at IS NULL)). is_active + the
--   window drive "currently in effect" reads; a non-partial Vehicle index and a
--   partial active index serve lookups. tenant_id, vehicle_id, alert_type,
--   effective_from, created_at, created_by are immutable.
--
-- Security implications
--   * ENABLE + FORCE RLS; tenant-scoped sel/ins/upd; no del (soft delete only).
--   * message classified internal; excluded from the shared search projection.
--
-- Objects created
--   Tables:    veh.vehicle_alerts
--   Triggers:  tg_vehicle_alerts_immutable, tg_vehicle_alerts_touch_metadata
--   Policies:  sel_vehicle_alerts_tenant, ins_vehicle_alerts_tenant, upd_vehicle_alerts_tenant
--   Indexes:   ix_vehicle_alerts_vehicle, ix_vehicle_alerts_active
-- ============================================================================

CREATE TABLE veh.vehicle_alerts (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  vehicle_id      uuid        NOT NULL,
  alert_type      text        NOT NULL,
  severity        text        NOT NULL,
  message         text        NOT NULL,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz NULL,
  is_active       boolean     NOT NULL DEFAULT true,
  acknowledged_by uuid        NULL,
  acknowledged_at timestamptz NULL,
  record_version  integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL,
  updated_at      timestamptz NULL,
  updated_by      uuid        NULL,
  deleted_at      timestamptz NULL,
  deleted_by      uuid        NULL,

  CONSTRAINT pk_vehicle_alerts PRIMARY KEY (id),
  CONSTRAINT fk_vehicle_alerts_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_vehicle_alerts_vehicle
    FOREIGN KEY (tenant_id, vehicle_id)
    REFERENCES veh.vehicles (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_vehicle_alerts_type
    CHECK (alert_type IN ('safety', 'technical', 'commercial', 'other')),
  CONSTRAINT ck_vehicle_alerts_severity
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT ck_vehicle_alerts_message_not_blank CHECK (btrim(message) <> ''),
  CONSTRAINT ck_vehicle_alerts_interval
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT ck_vehicle_alerts_ack_coherent
    CHECK ((acknowledged_by IS NULL) = (acknowledged_at IS NULL))
);

COMMENT ON TABLE veh.vehicle_alerts IS
  'Phase 1-7 Vehicle alerts (P1-07-DB-016). safety/technical/commercial/other with severity low/medium/high/critical, an effective window, an explicit active flag, and coherent acknowledgement attribution. Soft-deleted (never silently removed); message is internal and excluded from search — it must not carry prior-owner PII (backend authoring responsibility).';
COMMENT ON COLUMN veh.vehicle_alerts.message IS
  'Internal-classified free text. Must not contain prior-owner PII; excluded from the shared search projection.';

-- Non-partial index covers the composite Vehicle FK (and the tenant FK via its
-- leading column) and serves per-Vehicle/type reads.
CREATE INDEX ix_vehicle_alerts_vehicle
  ON veh.vehicle_alerts (tenant_id, vehicle_id, alert_type);
-- Active-alert lookup.
CREATE INDEX ix_vehicle_alerts_active
  ON veh.vehicle_alerts (tenant_id, vehicle_id)
  WHERE is_active AND deleted_at IS NULL;

CREATE TRIGGER tg_vehicle_alerts_immutable
  BEFORE UPDATE ON veh.vehicle_alerts
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'vehicle_id', 'alert_type', 'effective_from', 'created_at', 'created_by');
CREATE TRIGGER tg_vehicle_alerts_touch_metadata
  BEFORE UPDATE ON veh.vehicle_alerts
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

ALTER TABLE veh.vehicle_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE veh.vehicle_alerts FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_vehicle_alerts_tenant ON veh.vehicle_alerts
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_vehicle_alerts_tenant ON veh.vehicle_alerts
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_vehicle_alerts_tenant ON veh.vehicle_alerts
  FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON veh.vehicle_alerts TO app_runtime;
GRANT SELECT ON veh.vehicle_alerts TO app_readonly;
