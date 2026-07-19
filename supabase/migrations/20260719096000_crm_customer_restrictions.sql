-- ============================================================================
-- Phase: 1-6 — CRM and Business Partner Database
-- Migration: customer restrictions (dated, never destructively removed)
-- Tasks: P1-06-DB-008
-- Owner module: crm
--
-- Purpose
--   crm.customer_restrictions — dated restrictions on a partner (no_credit,
--   prepay_only, no_service, contact_restriction, other) with a mandatory
--   reason and attribution. Lifting a restriction end-dates it (effective_to);
--   historical decisions are never deleted. Later order/billing gates query
--   active restrictions in one indexed lookup.
--
-- Dependencies
--   crm.business_partners; org.tenants; shared.touch_row_metadata /
--   org.guard_immutable_columns; iam.current_tenant_id.
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once
--   restriction rows exist.
--
-- Security implications
--   * ENABLE + FORCE RLS; tenant-scoped policies; no DELETE grant (a restriction
--     is lifted by end-dating, never deleted).
--   * The identity/reason/attribution are immutable; only effective_to changes.
--   * A same-partner candidate key (tenant_id, partner_id, id) lets the block
--     history reference a restriction of the SAME partner (P1-06-DB-015).
--
-- Objects created
--   Tables:    crm.customer_restrictions
--   Triggers:  tg_customer_restrictions_touch_metadata, tg_customer_restrictions_immutable
--   Policies:  sel/ins/upd
--   Indexes:   ix_customer_restrictions_active, ix_customer_restrictions_open
-- ============================================================================

CREATE TABLE crm.customer_restrictions (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  partner_id       uuid        NOT NULL,
  restriction_type text        NOT NULL,
  reason           text        NOT NULL,
  imposed_by       uuid        NOT NULL,
  effective_from   date        NOT NULL,
  effective_to     date        NULL,
  approval_ref     text        NULL,
  record_version   integer     NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_at       timestamptz NULL,
  updated_by       uuid        NULL,

  CONSTRAINT pk_customer_restrictions PRIMARY KEY (id),
  CONSTRAINT uq_customer_restrictions_tenant_partner_id UNIQUE (tenant_id, partner_id, id),
  CONSTRAINT fk_customer_restrictions_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_customer_restrictions_partner
    FOREIGN KEY (tenant_id, partner_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_customer_restrictions_type CHECK (restriction_type IN (
    'no_credit', 'prepay_only', 'no_service', 'contact_restriction', 'other')),
  CONSTRAINT ck_customer_restrictions_reason_not_blank CHECK (btrim(reason) <> ''),
  CONSTRAINT ck_customer_restrictions_effective_range
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT ck_customer_restrictions_approval_not_blank
    CHECK (approval_ref IS NULL OR btrim(approval_ref) <> '')
);

COMMENT ON TABLE crm.customer_restrictions IS
  'Phase 1-6 dated partner restrictions (P1-06-DB-008). Lifted by end-dating (effective_to); never deleted.';

-- Lookup by partner + type + interval (also FK support via leading columns).
CREATE INDEX ix_customer_restrictions_active
  ON crm.customer_restrictions (tenant_id, partner_id, restriction_type, effective_from);
-- Currently-open restrictions (effective_to still NULL).
CREATE INDEX ix_customer_restrictions_open
  ON crm.customer_restrictions (tenant_id, partner_id, restriction_type)
  WHERE effective_to IS NULL;

CREATE TRIGGER tg_customer_restrictions_touch_metadata
  BEFORE UPDATE ON crm.customer_restrictions
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_customer_restrictions_immutable
  BEFORE UPDATE ON crm.customer_restrictions
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'partner_id', 'restriction_type', 'reason', 'imposed_by',
    'effective_from', 'approval_ref', 'created_at', 'created_by');

ALTER TABLE crm.customer_restrictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.customer_restrictions FORCE ROW LEVEL SECURITY;
CREATE POLICY sel_customer_restrictions_tenant ON crm.customer_restrictions
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_customer_restrictions_tenant ON crm.customer_restrictions
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_customer_restrictions_tenant ON crm.customer_restrictions
  FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON crm.customer_restrictions TO app_runtime;
GRANT SELECT ON crm.customer_restrictions TO app_readonly;
