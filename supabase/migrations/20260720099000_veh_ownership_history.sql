-- ============================================================================
-- Phase: 1-7 — Vehicle Database
-- Migration: ownership history (mutable-temporal, CRM partner-linked)
-- Tasks: P1-07-DB-011
-- Owner module: veh
--
-- Purpose
--   veh.ownership_history records effective-dated Vehicle ownership by a CRM
--   business partner. It stores ONLY the opaque partner_id link (plus dates,
--   kind, reason) — never any prior-owner PII — so the ownership-transfer privacy
--   contract (FR-VEH-004 / BR-VEH-002) holds by non-duplication. Mutable-temporal
--   (end-datable valid_to, close-only). No DELETE. created_by is the recorder.
--
--   Ownership-kind interval matrix (explicit, not a blanket exclusion):
--     * registered_owner — AUTHORITATIVE: at most one per Vehicle at any instant.
--     * beneficial / fleet — may coexist with a registered owner and each other;
--       only a duplicate SAME-partner SAME-kind overlap is rejected.
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once ownership exists. Forward-only — no down script.
--
-- Dependencies
--   veh.vehicles (20260720092000); crm.business_partners (Phase 1-6) + its
--   uq_business_partners_tenant_id candidate key + crm.resolve_partner_survivor;
--   veh.guard_temporal_close; org.tenants; btree_gist; iam.current_tenant_id;
--   shared.touch_row_metadata; org.guard_immutable_columns.
--
-- Details
--   Point-in-time owner: veh.owner_at returns the registered owner's SURVIVING
--   partner_id (via crm.resolve_partner_survivor) — a uuid only, never PII. The
--   atomic ownership-transfer transaction (close prior + open new) is a documented
--   Phase-1-17 backend contract; this layer provides storage + integrity only.
--
-- Security implications
--   * ENABLE + FORCE RLS; tenant sel/ins/upd; no DELETE grant.
--   * Identity + valid_from immutable; valid_to close-only. No PII stored.
--
-- Objects created
--   Tables:    veh.ownership_history
--   Functions: veh.owner_at(uuid, date)
--   Triggers:  tg_ownership_history_touch_metadata/_immutable/_close
--   Policies:  sel_/ins_/upd_ownership_history_tenant
--   Indexes:   ix_ownership_history_vehicle, ix_ownership_history_partner,
--              ex_ownership_history_same_role, ex_ownership_history_registered
-- ============================================================================

CREATE TABLE veh.ownership_history (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  vehicle_id      uuid        NOT NULL,
  partner_id      uuid        NOT NULL,
  ownership_kind  text        NOT NULL,
  valid_from      date        NOT NULL,
  valid_to        date        NULL,
  transfer_reason text        NULL,
  record_version  integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL,
  updated_at      timestamptz NULL,
  updated_by      uuid        NULL,

  CONSTRAINT pk_ownership_history PRIMARY KEY (id),
  CONSTRAINT fk_ownership_history_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_ownership_history_vehicle
    FOREIGN KEY (tenant_id, vehicle_id)
    REFERENCES veh.vehicles (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ownership_history_partner
    FOREIGN KEY (tenant_id, partner_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_ownership_history_kind
    CHECK (ownership_kind IN ('registered_owner', 'beneficial', 'fleet')),
  CONSTRAINT ck_ownership_history_valid_range CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT ck_ownership_history_reason_not_blank
    CHECK (transfer_reason IS NULL OR btrim(transfer_reason) <> ''),
  -- No duplicate same-partner same-kind overlapping interval on a Vehicle.
  CONSTRAINT ex_ownership_history_same_role EXCLUDE USING gist (
    tenant_id WITH =, vehicle_id WITH =, partner_id WITH =, ownership_kind WITH =,
    daterange(valid_from, valid_to, '[)') WITH &&
  ),
  -- At most one authoritative registered owner per Vehicle at any instant.
  CONSTRAINT ex_ownership_history_registered EXCLUDE USING gist (
    tenant_id WITH =, vehicle_id WITH =, daterange(valid_from, valid_to, '[)') WITH &&
  ) WHERE (ownership_kind = 'registered_owner')
);
COMMENT ON TABLE veh.ownership_history IS
  'Phase 1-7 mutable-temporal Vehicle ownership (P1-07-DB-011, FR-VEH-003/004). Stores only the partner_id link (no PII). registered_owner is authoritative (non-overlap); beneficial/fleet may coexist. End-datable valid_to (close-only); no DELETE. Merged partners resolve via crm.resolve_partner_survivor.';

CREATE INDEX ix_ownership_history_vehicle ON veh.ownership_history (tenant_id, vehicle_id, valid_from);
CREATE INDEX ix_ownership_history_partner ON veh.ownership_history (tenant_id, partner_id);

CREATE TRIGGER tg_ownership_history_touch_metadata
  BEFORE UPDATE ON veh.ownership_history
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_ownership_history_immutable
  BEFORE UPDATE ON veh.ownership_history
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'vehicle_id', 'partner_id', 'ownership_kind', 'valid_from',
    'transfer_reason', 'created_at', 'created_by');
CREATE TRIGGER tg_ownership_history_close
  BEFORE UPDATE ON veh.ownership_history
  FOR EACH ROW EXECUTE FUNCTION veh.guard_temporal_close();

-- Point-in-time registered owner, resolved to the surviving partner (uuid only).
CREATE OR REPLACE FUNCTION veh.owner_at(p_vehicle_id uuid, p_at date)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT crm.resolve_partner_survivor(partner_id)
    FROM veh.ownership_history
   WHERE vehicle_id = p_vehicle_id
     AND ownership_kind = 'registered_owner'
     AND valid_from <= p_at
     AND (valid_to IS NULL OR valid_to > p_at)
   LIMIT 1;
$$;
COMMENT ON FUNCTION veh.owner_at(uuid, date) IS
  'Point-in-time registered owner of a Vehicle as a surviving partner_id (uuid only, never PII). Resolves merged partners via crm.resolve_partner_survivor. SECURITY INVOKER — RLS applies.';
REVOKE EXECUTE ON FUNCTION veh.owner_at(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION veh.owner_at(uuid, date) TO app_runtime, app_readonly;

ALTER TABLE veh.ownership_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE veh.ownership_history FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_ownership_history_tenant ON veh.ownership_history
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_ownership_history_tenant ON veh.ownership_history
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_ownership_history_tenant ON veh.ownership_history
  FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON veh.ownership_history TO app_runtime;
GRANT SELECT ON veh.ownership_history TO app_readonly;
