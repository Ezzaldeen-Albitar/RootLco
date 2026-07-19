-- ============================================================================
-- Phase: 1-6 — CRM and Business Partner Database
-- Migration: dated, typed partner roles (the eight mandated automotive-service
--            party distinctions + structural supplier)
-- Tasks: P1-06-DB-005
-- Owner module: crm
--
-- Purpose
--   Create crm.partner_roles — one partner may hold many dated roles; the eight
--   mandated distinctions (customer, vehicle_owner, vehicle_user,
--   service_requester, payer, billing_party, approving_party,
--   authorized_receiver) are all representable and queryable point-in-time, and
--   'supplier' exists as STRUCTURE ONLY (procurement is a later phase). Two
--   intervals of the SAME role_type for the same partner may not overlap
--   (temporal EXCLUDE). Also publishes crm.partner_roles_active_at(...) — the
--   point-in-time resolver the Phase 1-7 vehicle relationships will consume.
--
-- Dependencies
--   crm.business_partners; org.tenants; btree_gist (gist opclasses for the uuid
--   and text equality columns in the EXCLUDE); iam.current_tenant_id;
--   shared.touch_row_metadata / org.guard_immutable_columns.
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once role rows exist.
--
-- Security implications
--   * ENABLE + FORCE RLS; tenant-scoped per-command policies. No DELETE grant —
--     a role is ended by setting valid_to, never deleted (history preserved).
--   * role_type and valid_from are immutable; valid_to is mutable (end-dating).
--   * crm.partner_roles_active_at is SECURITY INVOKER, empty search_path, so it
--     resolves only rows the caller may already see under RLS.
--
-- Objects created
--   Tables:    crm.partner_roles
--   Functions: crm.partner_roles_active_at(uuid, date)
--   Triggers:  tg_partner_roles_touch_metadata, tg_partner_roles_immutable
--   Policies:  sel_partner_roles_tenant, ins_partner_roles_tenant, upd_partner_roles_tenant
--   Indexes:   ex_partner_roles_no_overlap (EXCLUDE), ix_partner_roles_lookup
-- ============================================================================

CREATE TABLE crm.partner_roles (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  partner_id     uuid        NOT NULL,
  role_type      text        NOT NULL,
  -- NOT NULL: a NULL valid_from would make the daterange unbounded-below and
  -- silently change the overlap semantics (Wave 1 review).
  valid_from     date        NOT NULL,
  valid_to       date        NULL,
  source         text        NULL,
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,

  CONSTRAINT pk_partner_roles PRIMARY KEY (id),
  CONSTRAINT uq_partner_roles_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_partner_roles_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_partner_roles_partner
    FOREIGN KEY (tenant_id, partner_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_partner_roles_type CHECK (role_type IN (
    'customer', 'vehicle_owner', 'vehicle_user', 'service_requester',
    'payer', 'billing_party', 'approving_party', 'authorized_receiver', 'supplier'
  )),
  CONSTRAINT ck_partner_roles_valid_range
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT ck_partner_roles_source_not_blank
    CHECK (source IS NULL OR btrim(source) <> ''),
  -- No two intervals of the same role_type for one partner may overlap.
  CONSTRAINT ex_partner_roles_no_overlap EXCLUDE USING gist (
    tenant_id WITH =,
    partner_id WITH =,
    role_type WITH =,
    daterange(valid_from, valid_to, '[)') WITH &&
  )
);

COMMENT ON TABLE crm.partner_roles IS
  'Phase 1-6 dated typed partner roles (P1-06-DB-005, FR-CRM-001). Eight mandated automotive-service party distinctions are queryable point-in-time; supplier is structure-only. Identical role_type intervals may not overlap.';

-- FK support (leading tenant_id, partner_id) + point-in-time lookups.
CREATE INDEX ix_partner_roles_lookup
  ON crm.partner_roles (tenant_id, partner_id, role_type, valid_from);

CREATE TRIGGER tg_partner_roles_touch_metadata
  BEFORE UPDATE ON crm.partner_roles
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_partner_roles_immutable
  BEFORE UPDATE ON crm.partner_roles
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'partner_id', 'role_type', 'valid_from', 'created_at', 'created_by');

-- Point-in-time resolver: the role_types a partner holds on a given date.
-- SECURITY INVOKER + empty search_path -> RLS applies; the caller sees only its
-- own tenant's rows. Consumed by the Phase 1-7 vehicle-relationship contract.
CREATE OR REPLACE FUNCTION crm.partner_roles_active_at(p_partner_id uuid, p_at date)
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT role_type
    FROM crm.partner_roles
   WHERE partner_id = p_partner_id
     AND valid_from <= p_at
     AND (valid_to IS NULL OR valid_to > p_at)
   ORDER BY role_type;
$$;

REVOKE EXECUTE ON FUNCTION crm.partner_roles_active_at(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm.partner_roles_active_at(uuid, date) TO app_runtime, app_readonly;

ALTER TABLE crm.partner_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.partner_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY sel_partner_roles_tenant ON crm.partner_roles
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_partner_roles_tenant ON crm.partner_roles
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_partner_roles_tenant ON crm.partner_roles
  FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON crm.partner_roles TO app_runtime;
GRANT SELECT ON crm.partner_roles TO app_readonly;
