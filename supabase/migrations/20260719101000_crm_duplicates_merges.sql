-- ============================================================================
-- Phase: 1-6 — CRM and Business Partner Database
-- Migration: duplicate candidates and partner merge history
-- Tasks: P1-06-DB-016, P1-06-DB-017
-- Owner module: crm
--
-- Purpose
--   crm.duplicate_candidates — explainable, tenant-scoped candidate pairs for
--   duplicate review (canonical a<b ordering; one open candidate per pair). No
--   scoring engine (Phase 1-16). crm.partner_merges — the append-only merge
--   record with same-tenant source/survivor and a lossless summary. The redirect
--   integrity (source becomes merged, no cross-tenant survivor, no cycle, no
--   re-merge) is enforced on crm.business_partners (P1-06-DB-001). Row-transfer
--   ORCHESTRATION (moving identifiers/roles/contacts to the survivor) is the
--   Phase-1-16 backend responsibility; this phase owns storage + integrity + the
--   survivor resolver.
--
--   match_basis / merge_summary jsonb MUST NOT contain raw sensitive values;
--   crm.jsonb_no_raw_value_keys(...) rejects the obvious raw-value keys as a
--   defensive control (the backend sanitizer is the primary control).
--
-- Dependencies
--   crm.business_partners; org.tenants; shared.touch_row_metadata /
--   org.guard_immutable_columns; iam.current_tenant_id / iam.current_user_id.
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once rows exist.
--
-- Security implications
--   * Composite peer FKs constrain both candidate partners and both merge
--     partners to the SAME tenant (cross-tenant pairing/merge is a FK violation).
--   * partner_merges is append-only; merged_by/merged_at are server-stamped.
--   * jsonb PII-containment CHECKs + backend-sanitizer contract.
--   * ENABLE + FORCE RLS; tenant-scoped.
--
-- Objects created
--   Tables:    crm.duplicate_candidates, crm.partner_merges
--   Functions: crm.jsonb_no_raw_value_keys(jsonb), crm.stamp_partner_merge(),
--              crm.resolve_partner_survivor(uuid)
--   Triggers:  tg_duplicate_candidates_touch_metadata, tg_duplicate_candidates_immutable,
--              tg_partner_merges_stamp
--   Policies:  sel/ins/upd for duplicate_candidates; sel/ins for partner_merges
--   Indexes:   uq_duplicate_candidates_open, ix_duplicate_candidates_status,
--              ix_duplicate_candidates_a, ix_duplicate_candidates_b,
--              ix_partner_merges_source, ix_partner_merges_survivor
-- ============================================================================

-- Defensive: reject the obvious raw-value keys in explainability/summary jsonb.
CREATE OR REPLACE FUNCTION crm.jsonb_no_raw_value_keys(p jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT NOT EXISTS (
    SELECT 1
      FROM jsonb_object_keys(CASE WHEN jsonb_typeof(p) = 'object' THEN p ELSE '{}'::jsonb END) k
     WHERE k IN ('value', 'raw', 'raw_value', 'national_id', 'tax', 'registration', 'date_of_birth')
  )
  AND NOT EXISTS (
    SELECT 1
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p) = 'array' THEN p ELSE '[]'::jsonb END) e
     WHERE jsonb_typeof(e) = 'object'
       AND EXISTS (
         SELECT 1 FROM jsonb_object_keys(e) k
          WHERE k IN ('value', 'raw', 'raw_value', 'national_id', 'tax', 'registration', 'date_of_birth')
       )
  );
$$;
REVOKE EXECUTE ON FUNCTION crm.jsonb_no_raw_value_keys(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm.jsonb_no_raw_value_keys(jsonb) TO app_runtime, app_readonly;

CREATE TABLE crm.duplicate_candidates (
  id             uuid          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid          NOT NULL,
  partner_id_a   uuid          NOT NULL,
  partner_id_b   uuid          NOT NULL,
  match_score    numeric(5, 4) NOT NULL,
  match_basis    jsonb         NOT NULL DEFAULT '[]'::jsonb,
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
    FOREIGN KEY (tenant_id, partner_id_a) REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_duplicate_candidates_b
    FOREIGN KEY (tenant_id, partner_id_b) REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  -- Canonical ordering also forbids self-pairs and reversed duplicates.
  CONSTRAINT ck_duplicate_candidates_order CHECK (partner_id_a < partner_id_b),
  CONSTRAINT ck_duplicate_candidates_score CHECK (match_score >= 0 AND match_score <= 1),
  CONSTRAINT ck_duplicate_candidates_status CHECK (status IN ('open', 'dismissed', 'merged')),
  CONSTRAINT ck_duplicate_candidates_basis
    CHECK (jsonb_typeof(match_basis) = 'array' AND crm.jsonb_no_raw_value_keys(match_basis)),
  CONSTRAINT ck_duplicate_candidates_review
    CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL))
);

COMMENT ON TABLE crm.duplicate_candidates IS
  'Phase 1-6 explainable duplicate candidate pairs (P1-06-DB-016, FR-CRM-002 storage). a<b canonical; one open per pair; match_basis carries no raw sensitive values.';

CREATE UNIQUE INDEX uq_duplicate_candidates_open
  ON crm.duplicate_candidates (tenant_id, partner_id_a, partner_id_b)
  WHERE status = 'open';
CREATE INDEX ix_duplicate_candidates_status ON crm.duplicate_candidates (tenant_id, status);
CREATE INDEX ix_duplicate_candidates_a ON crm.duplicate_candidates (tenant_id, partner_id_a);
CREATE INDEX ix_duplicate_candidates_b ON crm.duplicate_candidates (tenant_id, partner_id_b);

CREATE TRIGGER tg_duplicate_candidates_touch_metadata
  BEFORE UPDATE ON crm.duplicate_candidates
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_duplicate_candidates_immutable
  BEFORE UPDATE ON crm.duplicate_candidates
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'partner_id_a', 'partner_id_b', 'match_score', 'match_basis',
    'detected_at', 'created_at', 'created_by');

ALTER TABLE crm.duplicate_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.duplicate_candidates FORCE ROW LEVEL SECURITY;
CREATE POLICY sel_duplicate_candidates_tenant ON crm.duplicate_candidates
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_duplicate_candidates_tenant ON crm.duplicate_candidates
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_duplicate_candidates_tenant ON crm.duplicate_candidates
  FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON crm.duplicate_candidates TO app_runtime;
GRANT SELECT ON crm.duplicate_candidates TO app_readonly;

-- ---------------------------------------------------------------------------
CREATE TABLE crm.partner_merges (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  source_partner_id   uuid        NOT NULL,
  survivor_partner_id uuid        NOT NULL,
  merge_summary       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  preview_ref         text        NULL,
  approval_ref        text        NOT NULL,
  merged_by           uuid        NOT NULL,
  merged_at           timestamptz NOT NULL DEFAULT now(),
  correlation_id      uuid        NULL,

  CONSTRAINT pk_partner_merges PRIMARY KEY (id),
  CONSTRAINT fk_partner_merges_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_partner_merges_source
    FOREIGN KEY (tenant_id, source_partner_id) REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_partner_merges_survivor
    FOREIGN KEY (tenant_id, survivor_partner_id) REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_partner_merges_distinct CHECK (source_partner_id <> survivor_partner_id),
  CONSTRAINT ck_partner_merges_approval_not_blank CHECK (btrim(approval_ref) <> ''),
  CONSTRAINT ck_partner_merges_summary
    CHECK (jsonb_typeof(merge_summary) = 'object' AND crm.jsonb_no_raw_value_keys(merge_summary))
);

COMMENT ON TABLE crm.partner_merges IS
  'Phase 1-6 append-only merge record (P1-06-DB-017, BR-CRM-001, FR-CRM-003). Same-tenant source/survivor; redirect integrity on business_partners; row-transfer is Phase 1-16.';

CREATE INDEX ix_partner_merges_source ON crm.partner_merges (tenant_id, source_partner_id);
CREATE INDEX ix_partner_merges_survivor ON crm.partner_merges (tenant_id, survivor_partner_id);

CREATE OR REPLACE FUNCTION crm.stamp_partner_merge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.merged_by := iam.current_user_id();
  IF NEW.merged_by IS NULL THEN
    RAISE EXCEPTION 'partner merge requires an actor in the session context'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.merged_at := now();
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION crm.stamp_partner_merge() FROM PUBLIC;

CREATE TRIGGER tg_partner_merges_stamp
  BEFORE INSERT ON crm.partner_merges
  FOR EACH ROW EXECUTE FUNCTION crm.stamp_partner_merge();

-- Follow the redirect chain to the ultimate live survivor, cycle-safe.
CREATE OR REPLACE FUNCTION crm.resolve_partner_survivor(p_partner_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_current uuid := p_partner_id;
  v_next    uuid;
  v_hops    integer := 0;
BEGIN
  LOOP
    SELECT merged_into_id INTO v_next FROM crm.business_partners WHERE id = v_current;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    IF v_next IS NULL THEN
      RETURN v_current;
    END IF;
    v_hops := v_hops + 1;
    IF v_hops > 64 THEN
      RAISE EXCEPTION 'partner survivor resolution exceeded max hops (cycle?)'
        USING ERRCODE = 'check_violation';
    END IF;
    v_current := v_next;
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION crm.resolve_partner_survivor(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm.resolve_partner_survivor(uuid) TO app_runtime, app_readonly;

ALTER TABLE crm.partner_merges ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.partner_merges FORCE ROW LEVEL SECURITY;
CREATE POLICY sel_partner_merges_tenant ON crm.partner_merges
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_partner_merges_tenant ON crm.partner_merges
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT ON crm.partner_merges TO app_runtime;
GRANT SELECT ON crm.partner_merges TO app_readonly;
