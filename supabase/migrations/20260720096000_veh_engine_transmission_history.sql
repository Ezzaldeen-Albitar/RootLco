-- ============================================================================
-- Phase: 1-7 — Vehicle Database
-- Migration: engine and transmission history (mutable-temporal intervals)
-- Tasks: P1-07-DB-007
-- Owner module: veh
--
-- Purpose
--   veh.engine_history and veh.transmission_history record effective-dated
--   mechanical unit intervals per Vehicle. They are MUTABLE-TEMPORAL (the
--   crm.partner_roles pattern), NOT append-only: an open interval is closed by
--   end-dating valid_to, and every other column is immutable. A close-only guard
--   allows valid_to to move ONLY NULL -> date (never reopen, never re-date), so
--   granting UPDATE cannot erase or backdate history. No DELETE.
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once intervals exist. Forward-only — no down script.
--
-- Dependencies
--   veh.vehicles (20260720092000); org.tenants; iam.current_tenant_id;
--   btree_gist (temporal EXCLUDE); shared.touch_row_metadata;
--   org.guard_immutable_columns.
--
-- Details
--   Reconciliation (recorded for the evidence register): P1-07-DB-007 lists an
--   "engine number" field. The restricted engine number is recorded in
--   veh.vehicle_identifiers (type engine_no, restricted, gated) — the single
--   gated home for restricted identifiers under the no-column-masking model — so
--   engine_history carries only INTERNAL engine attributes (displacement, power,
--   fuel note) plus the effective interval. Evidence documents attach through the
--   shared.document_links contract (entity_type 'veh.engine_history' /
--   'veh.transmission_history'); no payload is copied into veh.
--
-- Security implications
--   * ENABLE + FORCE RLS; tenant sel/ins/upd; no DELETE grant.
--   * Identity/measurement columns + valid_from + created_* immutable; valid_to
--     close-only. All functions SECURITY INVOKER, search_path='', REVOKE PUBLIC.
--
-- Objects created
--   Tables:    veh.engine_history, veh.transmission_history
--   Functions: veh.guard_temporal_close(), veh.engine_at(uuid,date),
--              veh.transmission_at(uuid,date)
--   Triggers:  tg_engine_history_touch_metadata/_immutable/_close,
--              tg_transmission_history_touch_metadata/_immutable/_close
--   Policies:  sel_/ins_/upd_engine_history_tenant, sel_/ins_/upd_transmission_history_tenant
--   Indexes:   ix_engine_history_vehicle, ix_transmission_history_vehicle,
--              ex_engine_history_no_overlap, ex_transmission_history_no_overlap
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Shared close-only guard for every veh mutable-temporal interval table.
-- valid_to may transition only NULL -> a date; once closed it is immutable.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION veh.guard_temporal_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF OLD.valid_to IS NOT NULL AND NEW.valid_to IS DISTINCT FROM OLD.valid_to THEN
    RAISE EXCEPTION 'valid_to is immutable once the interval is closed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION veh.guard_temporal_close() IS
  'BEFORE UPDATE guard for veh mutable-temporal interval tables: valid_to may move only NULL -> date; a closed interval''s valid_to is immutable (no reopen, no re-date).';
REVOKE EXECUTE ON FUNCTION veh.guard_temporal_close() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 1. veh.engine_history
-- ----------------------------------------------------------------------------
CREATE TABLE veh.engine_history (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  vehicle_id      uuid        NOT NULL,
  displacement_cc integer     NULL,
  power_kw        numeric(7, 2) NULL,
  fuel_note       text        NULL,
  valid_from      date        NOT NULL,
  valid_to        date        NULL,
  reason          text        NULL,
  record_version  integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL,
  updated_at      timestamptz NULL,
  updated_by      uuid        NULL,

  CONSTRAINT pk_engine_history PRIMARY KEY (id),
  CONSTRAINT fk_engine_history_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_engine_history_vehicle
    FOREIGN KEY (tenant_id, vehicle_id)
    REFERENCES veh.vehicles (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_engine_history_valid_range
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT ck_engine_history_displacement CHECK (displacement_cc IS NULL OR displacement_cc > 0),
  CONSTRAINT ck_engine_history_power CHECK (power_kw IS NULL OR power_kw >= 0),
  CONSTRAINT ck_engine_history_fuel_not_blank CHECK (fuel_note IS NULL OR btrim(fuel_note) <> ''),
  CONSTRAINT ex_engine_history_no_overlap EXCLUDE USING gist (
    tenant_id WITH =, vehicle_id WITH =, daterange(valid_from, valid_to, '[)') WITH &&
  )
);
COMMENT ON TABLE veh.engine_history IS
  'Phase 1-7 mutable-temporal engine interval history (P1-07-DB-007). Internal engine attributes only; the restricted engine number lives in veh.vehicle_identifiers. Non-overlapping per Vehicle; end-datable valid_to (close-only); no DELETE.';

CREATE INDEX ix_engine_history_vehicle
  ON veh.engine_history (tenant_id, vehicle_id, valid_from);

CREATE TRIGGER tg_engine_history_touch_metadata
  BEFORE UPDATE ON veh.engine_history
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_engine_history_immutable
  BEFORE UPDATE ON veh.engine_history
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'vehicle_id', 'displacement_cc', 'power_kw', 'fuel_note',
    'valid_from', 'reason', 'created_at', 'created_by');
CREATE TRIGGER tg_engine_history_close
  BEFORE UPDATE ON veh.engine_history
  FOR EACH ROW EXECUTE FUNCTION veh.guard_temporal_close();

ALTER TABLE veh.engine_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE veh.engine_history FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_engine_history_tenant ON veh.engine_history
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_engine_history_tenant ON veh.engine_history
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_engine_history_tenant ON veh.engine_history
  FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON veh.engine_history TO app_runtime;
GRANT SELECT ON veh.engine_history TO app_readonly;

-- ----------------------------------------------------------------------------
-- 2. veh.transmission_history
-- ----------------------------------------------------------------------------
CREATE TABLE veh.transmission_history (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  vehicle_id          uuid        NOT NULL,
  transmission_type   text        NOT NULL,
  transmission_number text        NULL,
  valid_from          date        NOT NULL,
  valid_to            date        NULL,
  reason              text        NULL,
  record_version      integer     NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        NOT NULL,
  updated_at          timestamptz NULL,
  updated_by          uuid        NULL,

  CONSTRAINT pk_transmission_history PRIMARY KEY (id),
  CONSTRAINT fk_transmission_history_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_transmission_history_vehicle
    FOREIGN KEY (tenant_id, vehicle_id)
    REFERENCES veh.vehicles (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_transmission_history_type CHECK (transmission_type IN (
    'manual', 'automatic', 'cvt', 'dct', 'automated_manual', 'direct_drive', 'other'
  )),
  CONSTRAINT ck_transmission_history_number_not_blank
    CHECK (transmission_number IS NULL OR btrim(transmission_number) <> ''),
  CONSTRAINT ck_transmission_history_valid_range
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT ex_transmission_history_no_overlap EXCLUDE USING gist (
    tenant_id WITH =, vehicle_id WITH =, daterange(valid_from, valid_to, '[)') WITH &&
  )
);
COMMENT ON TABLE veh.transmission_history IS
  'Phase 1-7 mutable-temporal transmission interval history (P1-07-DB-007). transmission_type taxonomy manual/automatic/cvt/dct/automated_manual/direct_drive/other; transmission_number internal. Non-overlapping per Vehicle; end-datable valid_to (close-only); no DELETE.';

CREATE INDEX ix_transmission_history_vehicle
  ON veh.transmission_history (tenant_id, vehicle_id, valid_from);

CREATE TRIGGER tg_transmission_history_touch_metadata
  BEFORE UPDATE ON veh.transmission_history
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_transmission_history_immutable
  BEFORE UPDATE ON veh.transmission_history
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'vehicle_id', 'transmission_type', 'transmission_number',
    'valid_from', 'reason', 'created_at', 'created_by');
CREATE TRIGGER tg_transmission_history_close
  BEFORE UPDATE ON veh.transmission_history
  FOR EACH ROW EXECUTE FUNCTION veh.guard_temporal_close();

ALTER TABLE veh.transmission_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE veh.transmission_history FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_transmission_history_tenant ON veh.transmission_history
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_transmission_history_tenant ON veh.transmission_history
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_transmission_history_tenant ON veh.transmission_history
  FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON veh.transmission_history TO app_runtime;
GRANT SELECT ON veh.transmission_history TO app_readonly;

-- ----------------------------------------------------------------------------
-- Point-in-time resolvers (RLS applies; caller sees only its tenant).
-- Half-open [) semantics: valid_from <= at AND (valid_to IS NULL OR valid_to > at).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION veh.engine_at(p_vehicle_id uuid, p_at date)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT id FROM veh.engine_history
   WHERE vehicle_id = p_vehicle_id
     AND valid_from <= p_at
     AND (valid_to IS NULL OR valid_to > p_at)
   LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION veh.engine_at(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION veh.engine_at(uuid, date) TO app_runtime, app_readonly;

CREATE OR REPLACE FUNCTION veh.transmission_at(p_vehicle_id uuid, p_at date)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT id FROM veh.transmission_history
   WHERE vehicle_id = p_vehicle_id
     AND valid_from <= p_at
     AND (valid_to IS NULL OR valid_to > p_at)
   LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION veh.transmission_at(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION veh.transmission_at(uuid, date) TO app_runtime, app_readonly;
