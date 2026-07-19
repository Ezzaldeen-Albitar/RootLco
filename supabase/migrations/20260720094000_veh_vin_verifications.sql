-- ============================================================================
-- Phase: 1-7 — Vehicle Database
-- Migration: append-only VIN verification history
-- Tasks: P1-07-DB-004
-- Owner module: veh
--
-- Purpose
--   veh.vin_verifications records each VIN check performed on a Vehicle
--   (checksum/format/manual/external -> passed/failed/overridden). It is
--   append-only and server-attributed; failed and overridden checks are storable
--   so the controlled alternate-identifier path stays possible. No external
--   verification is performed here and none is fabricated.
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once verifications exist. Forward-only — no down script.
--
-- Dependencies
--   veh.vehicles (20260720092000); org.tenants; iam.current_tenant_id;
--   shared.stamp_status_history (server-stamps actor_id + occurred_at).
--
-- Details
--   Append-only: SELECT+INSERT grants only; UPDATE/DELETE raise 42501. actor_id
--   and occurred_at are server-stamped (forged/backdated attribution impossible).
--   A monotonic seq gives deterministic same-transaction ordering. An 'overridden'
--   result requires a non-blank override_reason.
--
-- Security implications
--   * ENABLE + FORCE RLS; tenant-scoped sel/ins policies; no upd/del.
--
-- Objects created
--   Tables:    veh.vin_verifications
--   Triggers:  tg_vin_verifications_stamp
--   Policies:  sel_vin_verifications_tenant, ins_vin_verifications_tenant
--   Indexes:   ix_vin_verifications_vehicle
-- ============================================================================

CREATE TABLE veh.vin_verifications (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  vehicle_id     uuid        NOT NULL,
  vin_checked    text        NOT NULL,
  check_kind     text        NOT NULL,
  result         text        NOT NULL,
  override_reason text       NULL,
  correlation_id uuid        NULL,
  actor_id       uuid        NOT NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  seq            bigint      GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT pk_vin_verifications PRIMARY KEY (id),
  CONSTRAINT fk_vin_verifications_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_vin_verifications_vehicle
    FOREIGN KEY (tenant_id, vehicle_id)
    REFERENCES veh.vehicles (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_vin_verifications_check_kind
    CHECK (check_kind IN ('checksum', 'format', 'manual', 'external')),
  CONSTRAINT ck_vin_verifications_result
    CHECK (result IN ('passed', 'failed', 'overridden')),
  CONSTRAINT ck_vin_verifications_vin_not_blank CHECK (btrim(vin_checked) <> ''),
  CONSTRAINT ck_vin_verifications_override_reason CHECK (
    (result = 'overridden') = (override_reason IS NOT NULL AND btrim(override_reason) <> '')
  )
);

COMMENT ON TABLE veh.vin_verifications IS
  'Phase 1-7 append-only VIN verification history (P1-07-DB-004). check_kind checksum/format/manual/external; result passed/failed/overridden (override requires a reason). Server-stamped actor_id/occurred_at; no external service is performed or fabricated.';

-- Non-partial index covers both the composite vehicle FK and the tenant FK,
-- and serves latest-first per-vehicle reads.
CREATE INDEX ix_vin_verifications_vehicle
  ON veh.vin_verifications (tenant_id, vehicle_id, occurred_at DESC, seq DESC);

CREATE TRIGGER tg_vin_verifications_stamp
  BEFORE INSERT ON veh.vin_verifications
  FOR EACH ROW EXECUTE FUNCTION shared.stamp_status_history();

ALTER TABLE veh.vin_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE veh.vin_verifications FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_vin_verifications_tenant ON veh.vin_verifications
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_vin_verifications_tenant ON veh.vin_verifications
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT ON veh.vin_verifications TO app_runtime;
GRANT SELECT ON veh.vin_verifications TO app_readonly;
