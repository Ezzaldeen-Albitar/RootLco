-- ============================================================================
-- Phase: 1-7 — Vehicle Database
-- Migration: plate history (mutable-temporal intervals)
-- Tasks: P1-07-DB-010
-- Owner module: veh
--
-- Purpose
--   veh.plate_history records effective-dated plate assignments per Vehicle.
--   Mutable-temporal (end-datable valid_to, close-only); plate_normalized is
--   STORED-generated from veh.normalize_plate(plate_raw). Two invariants:
--   (a) a Vehicle holds at most one plate at any instant (per-vehicle EXCLUDE);
--   (b) a plate is on at most one Vehicle at any instant, per country
--   (cross-vehicle EXCLUDE over the interval — this closes the future-dated-plate
--   duplication gap a `WHERE valid_to IS NULL` unique would miss). Historical
--   reuse of a plate is allowed once its prior interval closes. No DELETE.
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once plates exist. Forward-only — no down script.
--
-- Dependencies
--   veh.vehicles (20260720092000); veh.normalize_plate (20260720090000);
--   veh.guard_temporal_close (20260720096000); org.tenants; btree_gist;
--   iam.current_tenant_id; shared.touch_row_metadata; org.guard_immutable_columns.
--
-- Details
--   No jurisdiction-specific plate-format engine; country_code is an uppercase
--   2-3 letter code. Search projects plate_normalized (backend/admin write path;
--   Wave 6). Point-in-time resolver veh.plate_at.
--
-- Security implications
--   * ENABLE + FORCE RLS; tenant sel/ins/upd; no DELETE grant.
--   * Identity + valid_from immutable; valid_to close-only.
--
-- Objects created
--   Tables:    veh.plate_history
--   Functions: veh.plate_at(uuid, date)
--   Triggers:  tg_plate_history_touch_metadata/_immutable/_close
--   Policies:  sel_/ins_/upd_plate_history_tenant
--   Indexes:   ix_plate_history_vehicle, ex_plate_history_no_overlap,
--              ex_plate_history_active_plate
-- ============================================================================

CREATE TABLE veh.plate_history (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  vehicle_id      uuid        NOT NULL,
  country_code    text        NOT NULL,
  plate_raw       text        NOT NULL,
  plate_normalized text       GENERATED ALWAYS AS (veh.normalize_plate(plate_raw)) STORED,
  valid_from      date        NOT NULL,
  valid_to        date        NULL,
  source          text        NULL,
  record_version  integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL,
  updated_at      timestamptz NULL,
  updated_by      uuid        NULL,

  CONSTRAINT pk_plate_history PRIMARY KEY (id),
  CONSTRAINT fk_plate_history_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_plate_history_vehicle
    FOREIGN KEY (tenant_id, vehicle_id)
    REFERENCES veh.vehicles (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_plate_history_country CHECK (country_code ~ '^[A-Z]{2,3}$'),
  CONSTRAINT ck_plate_history_raw_not_blank CHECK (btrim(plate_raw) <> ''),
  CONSTRAINT ck_plate_history_normalized_present
    CHECK (veh.normalize_plate(plate_raw) IS NOT NULL),
  CONSTRAINT ck_plate_history_valid_range CHECK (valid_to IS NULL OR valid_to > valid_from),
  -- A Vehicle holds at most one plate at any instant.
  CONSTRAINT ex_plate_history_no_overlap EXCLUDE USING gist (
    tenant_id WITH =, vehicle_id WITH =, daterange(valid_from, valid_to, '[)') WITH &&
  ),
  -- A plate (per country) is on at most one Vehicle at any instant.
  CONSTRAINT ex_plate_history_active_plate EXCLUDE USING gist (
    tenant_id WITH =, country_code WITH =, plate_normalized WITH =,
    daterange(valid_from, valid_to, '[)') WITH &&
  )
);
COMMENT ON TABLE veh.plate_history IS
  'Phase 1-7 mutable-temporal plate history (P1-07-DB-010). plate_normalized generated from veh.normalize_plate. Per-vehicle non-overlap + cross-vehicle active-plate uniqueness (both over the interval, closing the future-dated gap). Historical reuse allowed after an interval closes; end-datable valid_to (close-only); no DELETE.';

CREATE INDEX ix_plate_history_vehicle ON veh.plate_history (tenant_id, vehicle_id, valid_from);

CREATE TRIGGER tg_plate_history_touch_metadata
  BEFORE UPDATE ON veh.plate_history
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_plate_history_immutable
  BEFORE UPDATE ON veh.plate_history
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'vehicle_id', 'country_code', 'plate_raw', 'valid_from', 'source',
    'created_at', 'created_by');
CREATE TRIGGER tg_plate_history_close
  BEFORE UPDATE ON veh.plate_history
  FOR EACH ROW EXECUTE FUNCTION veh.guard_temporal_close();

CREATE OR REPLACE FUNCTION veh.plate_at(p_vehicle_id uuid, p_at date)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT id FROM veh.plate_history
   WHERE vehicle_id = p_vehicle_id
     AND valid_from <= p_at
     AND (valid_to IS NULL OR valid_to > p_at)
   LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION veh.plate_at(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION veh.plate_at(uuid, date) TO app_runtime, app_readonly;

ALTER TABLE veh.plate_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE veh.plate_history FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_plate_history_tenant ON veh.plate_history
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_plate_history_tenant ON veh.plate_history
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_plate_history_tenant ON veh.plate_history
  FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON veh.plate_history TO app_runtime;
GRANT SELECT ON veh.plate_history TO app_readonly;
