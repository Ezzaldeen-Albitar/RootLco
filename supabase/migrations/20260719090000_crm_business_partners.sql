-- ============================================================================
-- Phase: 1-6 — CRM and Business Partner Database
-- Migration: business partner party master with lifecycle, commercial status,
--            and lossless merge redirect
-- Tasks: P1-06-DB-001, P1-06-DB-020 (display-number allocation contract)
-- Owner module: crm
--
-- Purpose
--   Create crm.business_partners — the tenant-scoped party master that exists
--   independently of any role (FR-CRM-001). Every CRM child (profiles,
--   identifiers, roles, contacts, ...) references this table via the
--   (tenant_id, id) candidate key so a cross-tenant link is a foreign-key
--   violation, not a filtered row. This migration establishes the party master
--   plus the merge-survivor redirect and its integrity guards.
--
--   Deliberately NOT here: the profiles/identifiers/roles children (later
--   migrations), the operational merge orchestration (row transfer to survivor
--   is Phase 1-16 backend — this phase owns storage + integrity primitives),
--   and the per-tenant 'partner' number-sequence row (tenant-onboarding
--   provisioning, never a seed — see the display-number contract below).
--
-- Dependencies
--   org.tenants (20260717101000); iam.current_tenant_id / iam.current_user_id
--   (0002_base_schemas); shared.touch_row_metadata / org.guard_immutable_columns
--   (0002, 20260717101000); shared.next_display_number (0003) — invoked by the
--   backend/seed path, not by this migration.
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once partner rows exist. Forward-only per the migration
--   standard — no down script.
--
-- Security implications
--   * ENABLE + FORCE RLS; default-deny; per-command tenant policies keyed on
--     iam.current_tenant_id(). No DELETE grant (soft delete is an UPDATE).
--   * merged_into_id is a composite self-FK (tenant_id, merged_into_id) so a
--     survivor in another tenant is structurally impossible. A guard trigger
--     forbids pointing at an already-merged survivor (blocks merge cycles and
--     chains-into-a-merged-node at set time) and freezes a merged row
--     (blocks re-merge and survivor hijack). Multi-hop cycle prevention and
--     merged_into_id<->partner_merges atomicity are a Phase-1-16 single-tx
--     backend responsibility (documented).
--   * party_type is immutable (guards profile exclusivity established later).
--
-- Objects created
--   Tables:    crm.business_partners
--   Functions: crm.guard_business_partner_merge()
--   Triggers:  tg_business_partners_touch_metadata, tg_business_partners_immutable,
--              tg_business_partners_merge_guard
--   Policies:  sel_business_partners_tenant, ins_business_partners_tenant,
--              upd_business_partners_tenant
--   Indexes:   uq_business_partners_tenant_display_number_active,
--              ix_business_partners_merged_into, ix_business_partners_tenant_lifecycle
-- ============================================================================

CREATE TABLE crm.business_partners (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  party_type       text        NOT NULL,
  display_name     text        NOT NULL,
  -- Nullable until a display number is allocated (shared.next_display_number,
  -- backend/seed path). The sequence table does not store issued numbers, so
  -- this column carries its own tenant-scoped uniqueness (partial index below).
  display_number   text        NULL,
  lifecycle_status text        NOT NULL DEFAULT 'prospect',
  commercial_status text       NOT NULL DEFAULT 'normal',
  -- Merge survivor redirect. NULL for a live partner; set to the survivor when
  -- this partner is merged away. The row is retained (never deleted) so history
  -- never disappears with a duplicate (BR-CRM-001, FR-CRM-003).
  merged_into_id   uuid        NULL,
  record_version   integer     NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_at       timestamptz NULL,
  updated_by       uuid        NULL,
  deleted_at       timestamptz NULL,
  deleted_by       uuid        NULL,

  CONSTRAINT pk_business_partners PRIMARY KEY (id),
  -- Candidate key children reference so the tenant travels through every FK.
  CONSTRAINT uq_business_partners_tenant_id UNIQUE (tenant_id, id),
  -- Discriminator candidate key: profile children FK (tenant_id, partner_id,
  -- party_type) so an individual_profile can attach only to an individual
  -- partner and a company_profile only to an organization — declaratively.
  CONSTRAINT uq_business_partners_tenant_id_party_type UNIQUE (tenant_id, id, party_type),
  CONSTRAINT fk_business_partners_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  -- Composite self-FK: a merge survivor is always in the same tenant.
  CONSTRAINT fk_business_partners_merged_into
    FOREIGN KEY (tenant_id, merged_into_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,

  CONSTRAINT ck_business_partners_party_type
    CHECK (party_type IN ('individual', 'organization')),
  CONSTRAINT ck_business_partners_lifecycle_status
    CHECK (lifecycle_status IN ('prospect', 'active', 'inactive', 'blocked', 'merged')),
  CONSTRAINT ck_business_partners_commercial_status
    CHECK (commercial_status IN ('normal', 'watch', 'hold')),
  CONSTRAINT ck_business_partners_display_name_not_blank
    CHECK (btrim(display_name) <> ''),
  CONSTRAINT ck_business_partners_display_number_not_blank
    CHECK (display_number IS NULL OR btrim(display_number) <> ''),
  -- No self-redirect.
  CONSTRAINT ck_business_partners_merged_not_self
    CHECK (merged_into_id IS NULL OR merged_into_id <> id),
  -- Coherence: lifecycle_status = 'merged' IFF a survivor redirect is set.
  CONSTRAINT ck_business_partners_merged_coherent
    CHECK ((lifecycle_status = 'merged') = (merged_into_id IS NOT NULL))
);

COMMENT ON TABLE crm.business_partners IS
  'Phase 1-6 party master (FR-CRM-001). Tenant-scoped; exists independently of any role. A merged partner is retained with lifecycle_status=merged and merged_into_id pointing at its survivor. Row-transfer orchestration is Phase 1-16.';
COMMENT ON COLUMN crm.business_partners.merged_into_id IS
  'Survivor redirect (same-tenant composite self-FK). Set only on merge; immutable and frozen thereafter. Multi-hop chains resolve via a recursive resolver; cycles are structurally impossible (a redirect may only target a live, non-merged partner).';

-- Tenant-scoped uniqueness of the display number among live (non-deleted) rows.
CREATE UNIQUE INDEX uq_business_partners_tenant_display_number_active
  ON crm.business_partners (tenant_id, display_number)
  WHERE deleted_at IS NULL AND display_number IS NOT NULL;

-- FK-support for the self-redirect (partial: most rows are not merged).
CREATE INDEX ix_business_partners_merged_into
  ON crm.business_partners (tenant_id, merged_into_id)
  WHERE merged_into_id IS NOT NULL;

-- Gate/list lookup: active partners by lifecycle within a tenant.
CREATE INDEX ix_business_partners_tenant_lifecycle
  ON crm.business_partners (tenant_id, lifecycle_status);

-- ----------------------------------------------------------------------------
-- Merge-redirect integrity guard. BEFORE INSERT OR UPDATE.
--   * A merged row is frozen (read-only) — blocks re-merge, survivor hijack,
--     and any post-merge mutation. Redirect resolution is a SELECT; audit is
--     external — neither is a row UPDATE.
--   * A newly set redirect must target a LIVE (non-merged) survivor. Because a
--     partner becomes merged only by pointing at a live node, and can never
--     point at a merged node, redirect CYCLES are structurally impossible;
--     redirect CHAINS (A->B->C) are allowed and resolved recursively.
--   * The survivor row is locked FOR UPDATE so a concurrent symmetric merge
--     serializes (and the loser sees the survivor already merged, or the pair
--     deadlocks and one aborts) — a 2-cycle can never commit.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm.guard_business_partner_merge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_survivor_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.lifecycle_status = 'merged' THEN
    RAISE EXCEPTION
      'crm.business_partners %: a merged partner is read-only (redirect resolution and audit only)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.merged_into_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.merged_into_id IS DISTINCT FROM NEW.merged_into_id) THEN
    -- Lock the survivor to serialize concurrent symmetric merges.
    SELECT bp.lifecycle_status INTO v_survivor_status
      FROM crm.business_partners bp
      WHERE bp.tenant_id = NEW.tenant_id AND bp.id = NEW.merged_into_id
      FOR UPDATE;
    IF NOT FOUND THEN
      -- Also enforced by the composite FK; kept for a precise error.
      RAISE EXCEPTION 'crm.business_partners %: merge survivor % not found in tenant', NEW.id, NEW.merged_into_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_survivor_status = 'merged' THEN
      RAISE EXCEPTION
        'crm.business_partners %: merge survivor % is itself merged (redirect cycle/chain-into-merged not allowed)', NEW.id, NEW.merged_into_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION crm.guard_business_partner_merge() FROM PUBLIC;

CREATE TRIGGER tg_business_partners_touch_metadata
  BEFORE UPDATE ON crm.business_partners
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

CREATE TRIGGER tg_business_partners_immutable
  BEFORE UPDATE ON crm.business_partners
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'party_type', 'created_at', 'created_by');

CREATE TRIGGER tg_business_partners_merge_guard
  BEFORE INSERT OR UPDATE ON crm.business_partners
  FOR EACH ROW EXECUTE FUNCTION crm.guard_business_partner_merge();

-- ----------------------------------------------------------------------------
-- RLS: default-deny; tenant-scoped per-command policies. No DELETE (soft delete).
-- ----------------------------------------------------------------------------
ALTER TABLE crm.business_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.business_partners FORCE ROW LEVEL SECURITY;

CREATE POLICY sel_business_partners_tenant ON crm.business_partners
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());

CREATE POLICY ins_business_partners_tenant ON crm.business_partners
  FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id());

CREATE POLICY upd_business_partners_tenant ON crm.business_partners
  FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON crm.business_partners TO app_runtime;
GRANT SELECT ON crm.business_partners TO app_readonly;
