-- ============================================================================
-- Phase: 1-8 — Appointment and Vehicle Reception Database
-- Migration: Vehicle-Reception walk-in origin reference
-- Tasks: P1-08-DB-004 (walk-in origin)
-- Owner module: rec
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once rows exist. Forward-only — no down script.
--
-- Purpose
--   rec.walk_in_references records an unscheduled arrival at a branch — the
--   walk-in ORIGIN a reception visit can consume when there is no appointment. It
--   is NOT a fake appointment: it has no confirmed window, no lifecycle, no
--   capacity reservation. The Vehicle and requesting partner may be unknown at
--   arrival (both nullable) and are filled in as identification is confirmed.
--
--   Origin-consumption contract: a walk-in is consumed by AT MOST ONE reception
--   visit. That one-to-one is enforced on the reception side (a partial unique on
--   rec.reception_visits.walk_in_id), so a walk-in cannot seed two visits.
--
-- Dependencies
--   org.branches (tenant,company,id); veh.vehicles (tenant,id); crm.business_partners
--   (tenant,id); apt.source_channels (id) — reused intake channel catalog;
--   iam.current_tenant_id / allowed_company_ids / allowed_branch_ids;
--   shared.touch_row_metadata; org.guard_immutable_columns.
--
-- Security implications
--   * ENABLE + FORCE RLS; tenant + company + branch scoped; scope + arrival
--     immutable; source_channel fail-closed to platform-or-same-tenant visibility.
--
-- Objects created
--   Tables:    rec.walk_in_references
--   Functions: rec.guard_walk_in_refs()
--   Triggers:  tg_walk_in_references_refs, tg_walk_in_references_immutable,
--              tg_walk_in_references_touch_metadata
--   Policies:  sel_walk_in_references_scope, ins_walk_in_references_scope,
--              upd_walk_in_references_scope
--   Indexes:   uq_walk_in_references_scope_id, ix_walk_in_references_vehicle,
--              ix_walk_in_references_requester, ix_walk_in_references_source
-- ============================================================================

CREATE TABLE rec.walk_in_references (
  id                   uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL,
  company_id           uuid        NOT NULL,
  branch_id            uuid        NOT NULL,
  vehicle_id           uuid        NULL,
  requester_partner_id uuid        NULL,
  arrived_at           timestamptz NOT NULL DEFAULT now(),
  source_channel_id    uuid        NULL,
  verification_state   text        NOT NULL DEFAULT 'unverified',
  note                 text        NULL,
  record_version       integer     NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid        NOT NULL,
  updated_at           timestamptz NULL,
  updated_by           uuid        NULL,
  deleted_at           timestamptz NULL,
  deleted_by           uuid        NULL,

  CONSTRAINT pk_walk_in_references PRIMARY KEY (id),
  CONSTRAINT uq_walk_in_references_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_walk_in_references_branch
    FOREIGN KEY (tenant_id, company_id, branch_id)
    REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_walk_in_references_vehicle
    FOREIGN KEY (tenant_id, vehicle_id)
    REFERENCES veh.vehicles (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_walk_in_references_requester
    FOREIGN KEY (tenant_id, requester_partner_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_walk_in_references_source
    FOREIGN KEY (source_channel_id) REFERENCES apt.source_channels (id) ON DELETE RESTRICT,
  CONSTRAINT ck_walk_in_references_verification
    CHECK (verification_state IN ('unverified', 'verified')),
  CONSTRAINT ck_walk_in_references_note_not_blank CHECK (note IS NULL OR btrim(note) <> '')
);

COMMENT ON TABLE rec.walk_in_references IS
  'Phase 1-8 walk-in origin reference (P1-08-DB-004). An unscheduled branch arrival a reception visit can consume when there is no appointment. NOT a fake appointment (no window/lifecycle/capacity). Vehicle/partner nullable until identified. Consumed by at most one reception visit (enforced on rec.reception_visits.walk_in_id).';

-- Non-partial FK-covering indexes (P1-03-DB-017). The branch FK is covered by the
-- scope candidate key's leading {tenant,company,branch}.
CREATE INDEX ix_walk_in_references_vehicle ON rec.walk_in_references (tenant_id, vehicle_id);
CREATE INDEX ix_walk_in_references_requester
  ON rec.walk_in_references (tenant_id, requester_partner_id);
CREATE INDEX ix_walk_in_references_source ON rec.walk_in_references (source_channel_id);

-- ----------------------------------------------------------------------------
-- Catalog-reference guard: source_channel must be platform-or-same-tenant visible
-- (a plain FK to the id cannot express dual-scope visibility; SECURITY INVOKER so
-- RLS hides another tenant's private channel -> NOT FOUND -> reject).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rec.guard_walk_in_refs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.source_channel_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM apt.source_channels WHERE id = NEW.source_channel_id) THEN
    RAISE EXCEPTION 'source_channel % is not visible to this tenant', NEW.source_channel_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION rec.guard_walk_in_refs() IS
  'BEFORE INSERT/UPDATE guard on rec.walk_in_references: source_channel must be platform-or-same-tenant visible (fail-closed under RLS).';
REVOKE EXECUTE ON FUNCTION rec.guard_walk_in_refs() FROM PUBLIC;

CREATE TRIGGER tg_walk_in_references_refs
  BEFORE INSERT OR UPDATE OF source_channel_id ON rec.walk_in_references
  FOR EACH ROW EXECUTE FUNCTION rec.guard_walk_in_refs();
CREATE TRIGGER tg_walk_in_references_immutable
  BEFORE UPDATE ON rec.walk_in_references
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'arrived_at', 'created_at', 'created_by');
CREATE TRIGGER tg_walk_in_references_touch_metadata
  BEFORE UPDATE ON rec.walk_in_references
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

ALTER TABLE rec.walk_in_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec.walk_in_references FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_walk_in_references_scope ON rec.walk_in_references
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY ins_walk_in_references_scope ON rec.walk_in_references
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY upd_walk_in_references_scope ON rec.walk_in_references
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  )
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON rec.walk_in_references TO app_runtime;
GRANT SELECT ON rec.walk_in_references TO app_readonly;
