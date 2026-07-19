-- ============================================================================
-- Phase: 1-7 — Vehicle Database
-- Migration: duplicate candidates and Vehicle merge history
-- Tasks: P1-07-DB-017, P1-07-DB-018
-- Owner module: veh
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once rows exist. Forward-only — no down script.
--
-- Purpose
--   veh.duplicate_candidates — explainable, tenant-scoped candidate Vehicle pairs
--   for duplicate review (canonical a<b; one open per pair). match_basis is a
--   POSITIVE-schema jsonb array (veh.valid_match_basis): approved keys only,
--   approved basis categories only, restricted categories cannot be downgraded,
--   and nested/case-variant sensitive keys are rejected — no raw VIN/plate/
--   identifier values are stored. No scoring engine here (Phase 1-16).
--   veh.vehicle_merges — the append-only merge record. Inserting a record IS the
--   atomic merge primitive: an AFTER INSERT trigger transitions the source Vehicle
--   to merged and redirects it to the survivor in the SAME transaction; the
--   veh.vehicles merge guard validates a live, non-merged, same-tenant survivor
--   under a deterministic dual-row lock. A failed merge leaves no partial state.
--
-- Dependencies
--   veh.vehicles (20260720092000, incl. veh.guard_vehicle_merge); org.tenants;
--   shared.touch_row_metadata / org.guard_immutable_columns; iam.current_tenant_id
--   / iam.current_user_id.
--
-- Security implications
--   * Composite peer FKs constrain both candidates and both merge Vehicles to the
--     SAME tenant (cross-tenant pairing/merge is a FK violation).
--   * vehicle_merges is append-only; merged_by/merged_at server-stamped; one
--     merge per source (unique). Source→merged transition is DB-owned and atomic.
--   * match_basis / merge_summary jsonb reject sensitive keys and oversized blobs.
--   * ENABLE + FORCE RLS; tenant-scoped.
--
-- Objects created
--   Tables:    veh.duplicate_candidates, veh.vehicle_merges
--   Functions: veh.jsonb_no_raw_values(jsonb), veh.valid_match_basis(jsonb),
--              veh.stamp_vehicle_merge(), veh.apply_vehicle_merge(),
--              veh.resolve_vehicle_survivor(uuid)
--   Triggers:  tg_duplicate_candidates_immutable, tg_duplicate_candidates_touch_metadata,
--              tg_vehicle_merges_stamp, tg_vehicle_merges_apply
--   Policies:  sel/ins/upd_duplicate_candidates_tenant; sel/ins_vehicle_merges_tenant
--   Indexes:   uq_duplicate_candidates_open, ix_duplicate_candidates_status,
--              ix_duplicate_candidates_a, ix_duplicate_candidates_b,
--              uq_vehicle_merges_source, ix_vehicle_merges_survivor
-- ============================================================================

-- Recursive defensive scan: reject sensitive KEYS (case-insensitive, at any depth)
-- and oversized string leaves. Complements the backend sanitizer (primary control).
CREATE OR REPLACE FUNCTION veh.jsonb_no_raw_values(p jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  k text;
  v jsonb;
BEGIN
  IF p IS NULL THEN
    RETURN true;
  END IF;
  CASE jsonb_typeof(p)
    WHEN 'object' THEN
      FOR k, v IN SELECT key, value FROM jsonb_each(p) LOOP
        IF lower(k) ~ '(vin|plate|chassis|engine|value|raw|national|passport|tax|registr|dob|birth|ssn|iban|phone|email|address|name|consent|credit|contact)' THEN
          RETURN false;
        END IF;
        IF NOT veh.jsonb_no_raw_values(v) THEN
          RETURN false;
        END IF;
      END LOOP;
    WHEN 'array' THEN
      FOR v IN SELECT jsonb_array_elements(p) LOOP
        IF NOT veh.jsonb_no_raw_values(v) THEN
          RETURN false;
        END IF;
      END LOOP;
    WHEN 'string' THEN
      IF length(p #>> '{}') > 128 THEN
        RETURN false;
      END IF;
    ELSE
      NULL; -- number / boolean / null are safe scalars
  END CASE;
  RETURN true;
END;
$$;
COMMENT ON FUNCTION veh.jsonb_no_raw_values(jsonb) IS
  'Defensive: recursively rejects sensitive keys (case-insensitive, any depth) and string leaves over 128 chars. Backend sanitizer is the primary control.';
REVOKE EXECUTE ON FUNCTION veh.jsonb_no_raw_values(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION veh.jsonb_no_raw_values(jsonb) TO app_runtime, app_readonly;

-- Positive-schema validator for duplicate match evidence.
CREATE OR REPLACE FUNCTION veh.valid_match_basis(p jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  elem    jsonb;
  k       text;
  v_basis text;
  v_class text;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'array' OR jsonb_array_length(p) = 0 THEN
    RETURN false;
  END IF;
  FOR elem IN SELECT jsonb_array_elements(p) LOOP
    IF jsonb_typeof(elem) <> 'object' THEN
      RETURN false;
    END IF;
    -- Approved top-level keys only (exact match rejects case variants).
    FOR k IN SELECT jsonb_object_keys(elem) LOOP
      IF k NOT IN ('basis', 'classification', 'weight', 'evidence') THEN
        RETURN false;
      END IF;
    END LOOP;
    v_basis := elem ->> 'basis';
    IF v_basis IS NULL OR v_basis NOT IN
       ('vin_collision', 'plate_collision', 'identifier_collision', 'make_model_year_similarity', 'other')
    THEN
      RETURN false;
    END IF;
    v_class := elem ->> 'classification';
    IF v_class IS NOT NULL AND v_class NOT IN ('restricted', 'internal', 'public') THEN
      RETURN false;
    END IF;
    -- Restricted evidence categories cannot be downgraded.
    IF v_basis IN ('vin_collision', 'plate_collision', 'identifier_collision')
       AND v_class IS NOT NULL AND v_class <> 'restricted' THEN
      RETURN false;
    END IF;
    IF (elem ? 'weight') AND jsonb_typeof(elem -> 'weight') <> 'number' THEN
      RETURN false;
    END IF;
    IF (elem ? 'evidence') THEN
      IF jsonb_typeof(elem -> 'evidence') <> 'object' THEN
        RETURN false;
      END IF;
      IF NOT veh.jsonb_no_raw_values(elem -> 'evidence') THEN
        RETURN false;
      END IF;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;
COMMENT ON FUNCTION veh.valid_match_basis(jsonb) IS
  'Positive-schema validator for veh.duplicate_candidates.match_basis: a non-empty array of objects with approved keys (basis/classification/weight/evidence) and approved basis categories; restricted categories cannot be downgraded; evidence rejects sensitive keys. No raw identifier values.';
REVOKE EXECUTE ON FUNCTION veh.valid_match_basis(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION veh.valid_match_basis(jsonb) TO app_runtime, app_readonly;

-- ---------------------------------------------------------------------------
CREATE TABLE veh.duplicate_candidates (
  id             uuid          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid          NOT NULL,
  vehicle_id_a   uuid          NOT NULL,
  vehicle_id_b   uuid          NOT NULL,
  match_score    numeric(5, 4) NOT NULL,
  match_basis    jsonb         NOT NULL,
  status         text          NOT NULL DEFAULT 'open',
  detected_at    timestamptz   NOT NULL DEFAULT now(),
  reviewed_by    uuid          NULL,
  reviewed_at    timestamptz   NULL,
  record_version integer       NOT NULL DEFAULT 1,
  created_at     timestamptz   NOT NULL DEFAULT now(),
  created_by     uuid          NOT NULL,
  updated_at     timestamptz   NULL,
  updated_by     uuid          NULL,

  CONSTRAINT pk_duplicate_candidates PRIMARY KEY (id),
  CONSTRAINT fk_duplicate_candidates_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_duplicate_candidates_a
    FOREIGN KEY (tenant_id, vehicle_id_a) REFERENCES veh.vehicles (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_duplicate_candidates_b
    FOREIGN KEY (tenant_id, vehicle_id_b) REFERENCES veh.vehicles (tenant_id, id) ON DELETE RESTRICT,
  -- Canonical ordering also forbids self-pairs and reversed duplicates.
  CONSTRAINT ck_duplicate_candidates_order CHECK (vehicle_id_a < vehicle_id_b),
  CONSTRAINT ck_duplicate_candidates_score CHECK (match_score >= 0 AND match_score <= 1),
  CONSTRAINT ck_duplicate_candidates_status CHECK (status IN ('open', 'dismissed', 'merged')),
  CONSTRAINT ck_duplicate_candidates_basis CHECK (veh.valid_match_basis(match_basis)),
  CONSTRAINT ck_duplicate_candidates_review
    CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL))
);

COMMENT ON TABLE veh.duplicate_candidates IS
  'Phase 1-7 explainable duplicate Vehicle candidate pairs (P1-07-DB-017). a<b canonical; one open per pair; match_basis is positive-schema (approved categories, no raw identifier values, no classification downgrade).';

CREATE UNIQUE INDEX uq_duplicate_candidates_open
  ON veh.duplicate_candidates (tenant_id, vehicle_id_a, vehicle_id_b)
  WHERE status = 'open';
CREATE INDEX ix_duplicate_candidates_status ON veh.duplicate_candidates (tenant_id, status);
CREATE INDEX ix_duplicate_candidates_a ON veh.duplicate_candidates (tenant_id, vehicle_id_a);
CREATE INDEX ix_duplicate_candidates_b ON veh.duplicate_candidates (tenant_id, vehicle_id_b);

CREATE TRIGGER tg_duplicate_candidates_immutable
  BEFORE UPDATE ON veh.duplicate_candidates
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'vehicle_id_a', 'vehicle_id_b', 'match_score', 'match_basis',
    'detected_at', 'created_at', 'created_by');
CREATE TRIGGER tg_duplicate_candidates_touch_metadata
  BEFORE UPDATE ON veh.duplicate_candidates
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

ALTER TABLE veh.duplicate_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE veh.duplicate_candidates FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_duplicate_candidates_tenant ON veh.duplicate_candidates
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_duplicate_candidates_tenant ON veh.duplicate_candidates
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_duplicate_candidates_tenant ON veh.duplicate_candidates
  FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON veh.duplicate_candidates TO app_runtime;
GRANT SELECT ON veh.duplicate_candidates TO app_readonly;

-- ---------------------------------------------------------------------------
CREATE TABLE veh.vehicle_merges (
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  source_vehicle_id  uuid        NOT NULL,
  survivor_vehicle_id uuid       NOT NULL,
  merge_summary      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  approval_ref       text        NOT NULL,
  merged_by          uuid        NOT NULL,
  merged_at          timestamptz NOT NULL DEFAULT now(),
  correlation_id     uuid        NULL,
  seq                bigint      GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT pk_vehicle_merges PRIMARY KEY (id),
  -- One merge record per source Vehicle (also covers the source FK + tenant FK).
  CONSTRAINT uq_vehicle_merges_source UNIQUE (tenant_id, source_vehicle_id),
  CONSTRAINT fk_vehicle_merges_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_vehicle_merges_source
    FOREIGN KEY (tenant_id, source_vehicle_id) REFERENCES veh.vehicles (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_vehicle_merges_survivor
    FOREIGN KEY (tenant_id, survivor_vehicle_id) REFERENCES veh.vehicles (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_vehicle_merges_distinct CHECK (source_vehicle_id <> survivor_vehicle_id),
  CONSTRAINT ck_vehicle_merges_approval_not_blank CHECK (btrim(approval_ref) <> ''),
  CONSTRAINT ck_vehicle_merges_summary
    CHECK (jsonb_typeof(merge_summary) = 'object' AND veh.jsonb_no_raw_values(merge_summary))
);

COMMENT ON TABLE veh.vehicle_merges IS
  'Phase 1-7 append-only Vehicle merge record (P1-07-DB-018). Same-tenant source/survivor; one merge per source. Inserting a record atomically transitions the source Vehicle to merged and redirects it to the survivor (veh.apply_vehicle_merge); the veh.vehicles merge guard validates the survivor. Row-transfer orchestration is Phase 1-17.';

CREATE INDEX ix_vehicle_merges_survivor ON veh.vehicle_merges (tenant_id, survivor_vehicle_id);

-- Server-stamp merge attribution.
CREATE OR REPLACE FUNCTION veh.stamp_vehicle_merge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.merged_by := iam.current_user_id();
  IF NEW.merged_by IS NULL THEN
    RAISE EXCEPTION 'vehicle merge requires an actor in the session context'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.merged_at := now();
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION veh.stamp_vehicle_merge() IS
  'BEFORE INSERT on veh.vehicle_merges: server-stamps merged_by (from iam.current_user_id(); raises if unset) and merged_at.';
REVOKE EXECUTE ON FUNCTION veh.stamp_vehicle_merge() FROM PUBLIC;

-- Atomic merge primitive: transition the source Vehicle to merged/redirected in
-- the same transaction as the record insert. The veh.vehicles merge guard runs on
-- this UPDATE and validates a live, non-merged, same-tenant survivor under a
-- deterministic dual-row lock; any rejection aborts the whole insert (no partial
-- state). A source already merged updates zero rows -> double-merge rejected.
CREATE OR REPLACE FUNCTION veh.apply_vehicle_merge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE veh.vehicles
     SET lifecycle_status = 'merged',
         merged_into_id = NEW.survivor_vehicle_id
   WHERE tenant_id = NEW.tenant_id
     AND id = NEW.source_vehicle_id
     AND lifecycle_status <> 'merged';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'source vehicle % is already merged or not found in this tenant', NEW.source_vehicle_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
COMMENT ON FUNCTION veh.apply_vehicle_merge() IS
  'AFTER INSERT on veh.vehicle_merges: atomically sets the source Vehicle lifecycle_status=merged and merged_into_id=survivor (guarded by veh.guard_vehicle_merge). Zero rows updated => already-merged/not-found => reject. Failed merge leaves no partial state.';
REVOKE EXECUTE ON FUNCTION veh.apply_vehicle_merge() FROM PUBLIC;

CREATE TRIGGER tg_vehicle_merges_stamp
  BEFORE INSERT ON veh.vehicle_merges
  FOR EACH ROW EXECUTE FUNCTION veh.stamp_vehicle_merge();
CREATE TRIGGER tg_vehicle_merges_apply
  AFTER INSERT ON veh.vehicle_merges
  FOR EACH ROW EXECUTE FUNCTION veh.apply_vehicle_merge();

-- Follow the redirect chain to the ultimate live survivor, cycle-safe.
CREATE OR REPLACE FUNCTION veh.resolve_vehicle_survivor(p_vehicle_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_current uuid := p_vehicle_id;
  v_next    uuid;
  v_hops    integer := 0;
BEGIN
  LOOP
    SELECT merged_into_id INTO v_next FROM veh.vehicles WHERE id = v_current;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    IF v_next IS NULL THEN
      RETURN v_current;
    END IF;
    v_hops := v_hops + 1;
    IF v_hops > 64 THEN
      RAISE EXCEPTION 'vehicle survivor resolution exceeded max hops (cycle?)'
        USING ERRCODE = 'check_violation';
    END IF;
    v_current := v_next;
  END LOOP;
END;
$$;
COMMENT ON FUNCTION veh.resolve_vehicle_survivor(uuid) IS
  'Follows veh.vehicles.merged_into_id to the ultimate live survivor (cycle-safe, max 64 hops). SECURITY INVOKER — RLS/context apply.';
REVOKE EXECUTE ON FUNCTION veh.resolve_vehicle_survivor(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION veh.resolve_vehicle_survivor(uuid) TO app_runtime, app_readonly;

ALTER TABLE veh.vehicle_merges ENABLE ROW LEVEL SECURITY;
ALTER TABLE veh.vehicle_merges FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_vehicle_merges_tenant ON veh.vehicle_merges
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_vehicle_merges_tenant ON veh.vehicle_merges
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT ON veh.vehicle_merges TO app_runtime;
GRANT SELECT ON veh.vehicle_merges TO app_readonly;
