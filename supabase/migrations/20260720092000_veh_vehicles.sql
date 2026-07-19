-- ============================================================================
-- Phase: 1-7 — Vehicle Database
-- Migration: the independent Vehicle master
-- Tasks: P1-07-DB-001 (master), P1-07-DB-002 (active VIN uniqueness),
--        P1-07-DB-019 foundation (display-number wiring)
-- Owner module: veh
--
-- Purpose
--   veh.vehicles is the independent master whose identity survives every owner,
--   plate, and engine change. It carries ZERO partner/owner/customer column —
--   participation lives only in the temporal ownership/relationship tables. See
--   the Security and Objects sections below for the guards and generated VIN.
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once vehicles exist. Forward-only — no down script.
--
-- Dependencies
--   veh.makes/models/trims/body_types/powertrain_types (20260720091000);
--   veh.normalize_vin (20260720090000); org.tenants; iam.current_tenant_id;
--   shared.touch_row_metadata; org.guard_immutable_columns;
--   shared.next_display_number (consumed at runtime, not in DDL).
--
-- Details
--   vin_normalized is STORED-generated from veh.normalize_vin(vin_raw) so the
--   normalized form and its uniqueness never drift from the raw value. Catalog
--   references are nullable single-column FKs guarded for platform-or-same-tenant
--   visibility, make->model->trim hierarchy, and powertrain category consistency.
--   lifecycle_status and workshop_status are distinct axes. A merged vehicle is
--   frozen and redirected to a live same-tenant survivor (self-merge, cycles,
--   chaining, deleted survivor, and post-merge mutation are all rejected). No rows
--   are created; display_number is allocated at runtime via
--   shared.next_display_number('vehicle') (sequence provisioned admin-side).
--
-- Security implications
--   * ENABLE + FORCE RLS; default-deny tenant policies; app roles NOBYPASSRLS.
--   * tenant_id, created_at, created_by immutable; merged vehicles frozen.
--   * Catalog-scope guard is SECURITY INVOKER and fail-closed: a cross-tenant
--     catalog row hidden by RLS is NOT FOUND and rejected (a plain FK to the
--     catalog id cannot express platform-or-same-tenant).
--
-- Objects created
--   Tables:    veh.vehicles
--   Functions: veh.guard_vehicle_catalog_refs(), veh.guard_vehicle_merge()
--   Triggers:  tg_vehicles_catalog_refs, tg_vehicles_immutable,
--              tg_vehicles_merge_guard, tg_vehicles_touch_metadata
--   Policies:  sel_vehicles_tenant, ins_vehicles_tenant, upd_vehicles_tenant
--   Indexes:   uq_vehicles_tenant_id, uq_vehicles_active_vin,
--              uq_vehicles_active_display_number, ix_vehicles_make/model/trim/
--              body_type/powertrain_type/merged_into, ix_vehicles_lifecycle/workshop
-- ============================================================================

CREATE TABLE veh.vehicles (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  display_number      text        NULL,
  vin_raw             text        NULL,
  vin_normalized      text        GENERATED ALWAYS AS (veh.normalize_vin(vin_raw)) STORED,
  make_id             uuid        NULL,
  model_id            uuid        NULL,
  trim_id             uuid        NULL,
  model_year          integer     NULL,
  body_type_id        uuid        NULL,
  powertrain_type_id  uuid        NULL,
  powertrain_category text        NOT NULL DEFAULT 'ice',
  color               text        NULL,
  lifecycle_status    text        NOT NULL DEFAULT 'draft',
  workshop_status     text        NOT NULL DEFAULT 'none',
  merged_into_id      uuid        NULL,
  record_version      integer     NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        NOT NULL,
  updated_at          timestamptz NULL,
  updated_by          uuid        NULL,
  deleted_at          timestamptz NULL,
  deleted_by          uuid        NULL,

  CONSTRAINT pk_vehicles PRIMARY KEY (id),
  CONSTRAINT uq_vehicles_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_vehicles_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_vehicles_make
    FOREIGN KEY (make_id) REFERENCES veh.makes (id) ON DELETE RESTRICT,
  CONSTRAINT fk_vehicles_model
    FOREIGN KEY (model_id) REFERENCES veh.models (id) ON DELETE RESTRICT,
  CONSTRAINT fk_vehicles_trim
    FOREIGN KEY (trim_id) REFERENCES veh.trims (id) ON DELETE RESTRICT,
  CONSTRAINT fk_vehicles_body_type
    FOREIGN KEY (body_type_id) REFERENCES veh.body_types (id) ON DELETE RESTRICT,
  CONSTRAINT fk_vehicles_powertrain_type
    FOREIGN KEY (powertrain_type_id) REFERENCES veh.powertrain_types (id) ON DELETE RESTRICT,
  CONSTRAINT fk_vehicles_merged_into
    FOREIGN KEY (tenant_id, merged_into_id)
    REFERENCES veh.vehicles (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_vehicles_powertrain_category
    CHECK (powertrain_category IN ('ice', 'ev', 'hybrid', 'phev', 'other')),
  CONSTRAINT ck_vehicles_lifecycle
    CHECK (lifecycle_status IN ('draft', 'active', 'inactive', 'merged', 'scrapped')),
  CONSTRAINT ck_vehicles_workshop
    CHECK (workshop_status IN ('none', 'in_workshop', 'awaiting_parts', 'ready_for_delivery')),
  CONSTRAINT ck_vehicles_model_year
    CHECK (model_year IS NULL OR (model_year BETWEEN 1900 AND 2100)),
  CONSTRAINT ck_vehicles_color_not_blank CHECK (color IS NULL OR btrim(color) <> ''),
  CONSTRAINT ck_vehicles_vin_raw_not_blank CHECK (vin_raw IS NULL OR btrim(vin_raw) <> ''),
  CONSTRAINT ck_vehicles_display_number_not_blank
    CHECK (display_number IS NULL OR btrim(display_number) <> ''),
  -- A merged vehicle has a redirect and vice-versa.
  CONSTRAINT ck_vehicles_merged_coherent
    CHECK ((lifecycle_status = 'merged') = (merged_into_id IS NOT NULL)),
  CONSTRAINT ck_vehicles_merged_not_self
    CHECK (merged_into_id IS NULL OR merged_into_id <> id),
  -- A terminal vehicle (merged or scrapped) is not operationally in a workshop.
  CONSTRAINT ck_vehicles_terminal_workshop
    CHECK (lifecycle_status NOT IN ('merged', 'scrapped') OR workshop_status = 'none')
);

COMMENT ON TABLE veh.vehicles IS
  'Phase 1-7 independent Vehicle master (P1-07-DB-001, FR-VEH-001). Carries NO partner/owner column — ownership is temporal (veh.ownership_history / veh.vehicle_relationships). vin_normalized is generated from veh.normalize_vin(vin_raw). lifecycle_status and workshop_status are distinct axes. Merged vehicles are frozen and redirected to a live same-tenant survivor.';
COMMENT ON COLUMN veh.vehicles.vin_normalized IS
  'Generated (STORED) from veh.normalize_vin(vin_raw); authoritative for tenant-scoped active VIN uniqueness and search. Never set directly.';
COMMENT ON COLUMN veh.vehicles.powertrain_category IS
  'Authoritative powertrain class (ice/ev/hybrid/phev/other) that drives the EV-profile invariant. If powertrain_type_id is set, its catalog category must match.';
COMMENT ON COLUMN veh.vehicles.display_number IS
  'Tenant-scoped human reference, allocated at runtime via shared.next_display_number(''vehicle''). Nullable until allocated; the per-tenant sequence row is provisioned admin-side at onboarding, never seeded.';

-- Candidate key uq_vehicles_tenant_id (tenant_id, id) is non-partial and covers
-- the single-column fk_vehicles_tenant (leading column tenant_id).
-- Active VIN uniqueness (P1-07-DB-002): merged and soft-deleted vehicles excluded.
CREATE UNIQUE INDEX uq_vehicles_active_vin
  ON veh.vehicles (tenant_id, vin_normalized)
  WHERE vin_normalized IS NOT NULL AND deleted_at IS NULL AND lifecycle_status <> 'merged';
CREATE UNIQUE INDEX uq_vehicles_active_display_number
  ON veh.vehicles (tenant_id, display_number)
  WHERE display_number IS NOT NULL AND deleted_at IS NULL;

-- Non-partial FK covering indexes (P1-03-DB-017).
CREATE INDEX ix_vehicles_make ON veh.vehicles (make_id);
CREATE INDEX ix_vehicles_model ON veh.vehicles (model_id);
CREATE INDEX ix_vehicles_trim ON veh.vehicles (trim_id);
CREATE INDEX ix_vehicles_body_type ON veh.vehicles (body_type_id);
CREATE INDEX ix_vehicles_powertrain_type ON veh.vehicles (powertrain_type_id);
CREATE INDEX ix_vehicles_merged_into ON veh.vehicles (tenant_id, merged_into_id);
-- Lifecycle / workshop lookups.
CREATE INDEX ix_vehicles_lifecycle ON veh.vehicles (tenant_id, lifecycle_status);
CREATE INDEX ix_vehicles_workshop ON veh.vehicles (tenant_id, workshop_status);

-- ----------------------------------------------------------------------------
-- Catalog-reference guard: fail-closed visibility + hierarchy + powertrain
-- category consistency. Runs SECURITY INVOKER so RLS hides cross-tenant catalog
-- rows (a hidden row is NOT FOUND -> reject).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION veh.guard_vehicle_catalog_refs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_model_make uuid;
  v_trim_model uuid;
  v_pt_category text;
  v_found boolean;
BEGIN
  IF NEW.make_id IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM veh.makes WHERE id = NEW.make_id) INTO v_found;
    IF NOT v_found THEN
      RAISE EXCEPTION 'veh make % is not visible to this tenant', NEW.make_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  IF NEW.body_type_id IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM veh.body_types WHERE id = NEW.body_type_id) INTO v_found;
    IF NOT v_found THEN
      RAISE EXCEPTION 'veh body_type % is not visible to this tenant', NEW.body_type_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  IF NEW.model_id IS NOT NULL THEN
    SELECT make_id INTO v_model_make FROM veh.models WHERE id = NEW.model_id;
    IF v_model_make IS NULL THEN
      RAISE EXCEPTION 'veh model % is not visible to this tenant', NEW.model_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF NEW.make_id IS NOT NULL AND v_model_make <> NEW.make_id THEN
      RAISE EXCEPTION 'veh model % does not belong to make %', NEW.model_id, NEW.make_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.trim_id IS NOT NULL THEN
    SELECT model_id INTO v_trim_model FROM veh.trims WHERE id = NEW.trim_id;
    IF v_trim_model IS NULL THEN
      RAISE EXCEPTION 'veh trim % is not visible to this tenant', NEW.trim_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF NEW.model_id IS NOT NULL AND v_trim_model <> NEW.model_id THEN
      RAISE EXCEPTION 'veh trim % does not belong to model %', NEW.trim_id, NEW.model_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.powertrain_type_id IS NOT NULL THEN
    SELECT category INTO v_pt_category FROM veh.powertrain_types WHERE id = NEW.powertrain_type_id;
    IF v_pt_category IS NULL THEN
      RAISE EXCEPTION 'veh powertrain_type % is not visible to this tenant', NEW.powertrain_type_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_pt_category <> NEW.powertrain_category THEN
      RAISE EXCEPTION 'powertrain_type category % conflicts with vehicle powertrain_category %',
        v_pt_category, NEW.powertrain_category USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION veh.guard_vehicle_catalog_refs() IS
  'BEFORE INSERT/UPDATE guard on veh.vehicles: catalog refs must be platform-or-same-tenant (fail-closed under RLS), model belongs to make, trim belongs to model, and powertrain_type category matches powertrain_category.';
REVOKE EXECUTE ON FUNCTION veh.guard_vehicle_catalog_refs() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- Merge-redirect guard: mirrors crm.guard_business_partner_merge. A merged
-- vehicle is frozen (only audit/soft-delete may change). Establishing a redirect
-- requires a live, non-merged, same-tenant survivor; both rows are locked in a
-- deterministic order so concurrent/symmetric merges serialize to one winner.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION veh.guard_vehicle_merge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_survivor_lifecycle text;
  v_survivor_deleted   timestamptz;
  v_low  uuid;
  v_high uuid;
BEGIN
  -- Frozen: once merged, only audit/soft-delete metadata may change.
  IF OLD.lifecycle_status = 'merged' THEN
    IF (to_jsonb(NEW) - 'updated_at' - 'updated_by' - 'record_version' - 'deleted_at' - 'deleted_by')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'updated_at' - 'updated_by' - 'record_version' - 'deleted_at' - 'deleted_by')
    THEN
      RAISE EXCEPTION 'vehicle % is merged and read-only (only audit/soft-delete may change)', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- Establishing a redirect: validate and lock the survivor.
  IF NEW.merged_into_id IS NOT NULL AND OLD.merged_into_id IS NULL THEN
    IF NEW.lifecycle_status <> 'merged' THEN
      RAISE EXCEPTION 'setting a merge redirect requires lifecycle_status = merged (vehicle %)', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.id < NEW.merged_into_id THEN
      v_low := NEW.id; v_high := NEW.merged_into_id;
    ELSE
      v_low := NEW.merged_into_id; v_high := NEW.id;
    END IF;
    PERFORM 1 FROM veh.vehicles WHERE tenant_id = NEW.tenant_id AND id = v_low FOR UPDATE;
    PERFORM 1 FROM veh.vehicles WHERE tenant_id = NEW.tenant_id AND id = v_high FOR UPDATE;

    SELECT lifecycle_status, deleted_at
      INTO v_survivor_lifecycle, v_survivor_deleted
      FROM veh.vehicles WHERE tenant_id = NEW.tenant_id AND id = NEW.merged_into_id;

    IF v_survivor_lifecycle IS NULL THEN
      RAISE EXCEPTION 'merge survivor % not found in this tenant', NEW.merged_into_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_survivor_deleted IS NOT NULL THEN
      RAISE EXCEPTION 'merge survivor % is soft-deleted', NEW.merged_into_id
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_survivor_lifecycle = 'merged' THEN
      RAISE EXCEPTION 'merge survivor % is itself merged (no chaining into a merged vehicle)', NEW.merged_into_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION veh.guard_vehicle_merge() IS
  'BEFORE UPDATE guard on veh.vehicles: freezes a merged vehicle (audit/soft-delete only), and on establishing a redirect validates a live non-merged same-tenant survivor under a deterministic dual-row lock. Blocks self-merge (CHECK), cycles, chaining, deleted survivor, double-merge, and hijack.';
REVOKE EXECUTE ON FUNCTION veh.guard_vehicle_merge() FROM PUBLIC;

CREATE TRIGGER tg_vehicles_catalog_refs
  BEFORE INSERT OR UPDATE OF make_id, model_id, trim_id, body_type_id, powertrain_type_id,
    powertrain_category, tenant_id ON veh.vehicles
  FOR EACH ROW EXECUTE FUNCTION veh.guard_vehicle_catalog_refs();
CREATE TRIGGER tg_vehicles_immutable
  BEFORE UPDATE ON veh.vehicles
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'created_at', 'created_by');
CREATE TRIGGER tg_vehicles_merge_guard
  BEFORE UPDATE ON veh.vehicles
  FOR EACH ROW EXECUTE FUNCTION veh.guard_vehicle_merge();
CREATE TRIGGER tg_vehicles_touch_metadata
  BEFORE UPDATE ON veh.vehicles
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

ALTER TABLE veh.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE veh.vehicles FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_vehicles_tenant ON veh.vehicles
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_vehicles_tenant ON veh.vehicles
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_vehicles_tenant ON veh.vehicles
  FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON veh.vehicles TO app_runtime;
GRANT SELECT ON veh.vehicles TO app_readonly;
