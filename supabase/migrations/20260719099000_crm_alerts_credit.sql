-- ============================================================================
-- Phase: 1-6 — CRM and Business Partner Database
-- Migration: customer alerts and credit-profile foundation
-- Tasks: P1-06-DB-013, P1-06-DB-014
-- Owner module: crm
--
-- Purpose
--   crm.customer_alerts — attributable, effective-dated alerts on a partner with
--   an acknowledgement path and an active-alert index. crm.customer_credit_profiles
--   — a foundation-only credit profile (one per partner); approved status
--   requires approver attribution. No commerce/enforcement/billing behavior.
--
-- Dependencies
--   crm.business_partners, shared.currencies; org.tenants;
--   shared.touch_row_metadata / org.guard_immutable_columns; iam.current_tenant_id.
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once rows exist.
--
-- Security implications
--   * ENABLE + FORCE RLS; tenant-scoped policies; no DELETE grant (alerts are
--     deactivated/end-dated, credit profiles updated in place).
--   * Approved credit status is CHECK-gated on approver + approval reference.
--
-- Objects created
--   Tables:    crm.customer_alerts, crm.customer_credit_profiles
--   Triggers:  tg_customer_alerts_touch_metadata, tg_customer_alerts_immutable,
--              tg_customer_credit_profiles_touch_metadata, tg_customer_credit_profiles_immutable
--   Policies:  sel/ins/upd for both tables
--   Indexes:   ix_customer_alerts_active
-- ============================================================================

CREATE TABLE crm.customer_alerts (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  partner_id      uuid        NOT NULL,
  alert_type      text        NOT NULL,
  severity        text        NOT NULL,
  message         text        NOT NULL,
  active          boolean     NOT NULL DEFAULT true,
  effective_from  date        NOT NULL,
  effective_to    date        NULL,
  acknowledged_by uuid        NULL,
  acknowledged_at timestamptz NULL,
  record_version  integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL,
  updated_at      timestamptz NULL,
  updated_by      uuid        NULL,

  CONSTRAINT pk_customer_alerts PRIMARY KEY (id),
  CONSTRAINT fk_customer_alerts_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_customer_alerts_partner
    FOREIGN KEY (tenant_id, partner_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_customer_alerts_type CHECK (alert_type IN ('operational', 'financial', 'safety', 'other')),
  CONSTRAINT ck_customer_alerts_severity CHECK (severity IN ('info', 'warning', 'critical')),
  CONSTRAINT ck_customer_alerts_message_not_blank CHECK (btrim(message) <> ''),
  CONSTRAINT ck_customer_alerts_effective_range
    CHECK (effective_to IS NULL OR effective_to > effective_from),
  -- Acknowledgement is all-or-nothing.
  CONSTRAINT ck_customer_alerts_ack_coherent
    CHECK ((acknowledged_by IS NULL) = (acknowledged_at IS NULL))
);

COMMENT ON TABLE crm.customer_alerts IS
  'Phase 1-6 partner alerts (P1-06-DB-013). Deactivated/end-dated, never deleted; acknowledgement is attributable.';

CREATE INDEX ix_customer_alerts_active
  ON crm.customer_alerts (tenant_id, partner_id, alert_type)
  WHERE active AND effective_to IS NULL;

CREATE TRIGGER tg_customer_alerts_touch_metadata
  BEFORE UPDATE ON crm.customer_alerts
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_customer_alerts_immutable
  BEFORE UPDATE ON crm.customer_alerts
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'partner_id', 'alert_type', 'message', 'effective_from', 'created_at', 'created_by');

ALTER TABLE crm.customer_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.customer_alerts FORCE ROW LEVEL SECURITY;
CREATE POLICY sel_customer_alerts_tenant ON crm.customer_alerts
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_customer_alerts_tenant ON crm.customer_alerts
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_customer_alerts_tenant ON crm.customer_alerts
  FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON crm.customer_alerts TO app_runtime;
GRANT SELECT ON crm.customer_alerts TO app_readonly;

-- ---------------------------------------------------------------------------
CREATE TABLE crm.customer_credit_profiles (
  id                 uuid          NOT NULL DEFAULT gen_random_uuid(),
  tenant_id          uuid          NOT NULL,
  partner_id         uuid          NOT NULL,
  credit_limit       numeric(18, 4) NULL,
  currency_code      text          NULL,
  risk_note          text          NULL,
  payment_terms_code text          NULL,
  status             text          NOT NULL DEFAULT 'none',
  approved_by        uuid          NULL,
  approval_ref       text          NULL,
  record_version     integer       NOT NULL DEFAULT 1,
  created_at         timestamptz   NOT NULL DEFAULT now(),
  created_by         uuid          NOT NULL,
  updated_at         timestamptz   NULL,
  updated_by         uuid          NULL,

  CONSTRAINT pk_customer_credit_profiles PRIMARY KEY (id),
  CONSTRAINT uq_customer_credit_profiles_partner UNIQUE (tenant_id, partner_id),
  CONSTRAINT fk_customer_credit_profiles_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_customer_credit_profiles_partner
    FOREIGN KEY (tenant_id, partner_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_customer_credit_profiles_currency
    FOREIGN KEY (currency_code) REFERENCES shared.currencies (code) ON DELETE RESTRICT,
  CONSTRAINT ck_customer_credit_profiles_status
    CHECK (status IN ('none', 'requested', 'approved', 'suspended')),
  CONSTRAINT ck_customer_credit_profiles_limit_nonneg
    CHECK (credit_limit IS NULL OR credit_limit >= 0),
  -- Approved status requires approver attribution (BR-new).
  CONSTRAINT ck_customer_credit_profiles_approved_attribution
    CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND btrim(coalesce(approval_ref, '')) <> ''))
);

COMMENT ON TABLE crm.customer_credit_profiles IS
  'Phase 1-6 credit-profile foundation (P1-06-DB-014). One per partner; approved requires approver + approval_ref. No enforcement/billing.';

CREATE TRIGGER tg_customer_credit_profiles_touch_metadata
  BEFORE UPDATE ON crm.customer_credit_profiles
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_customer_credit_profiles_immutable
  BEFORE UPDATE ON crm.customer_credit_profiles
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'partner_id', 'created_at', 'created_by');

ALTER TABLE crm.customer_credit_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.customer_credit_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY sel_customer_credit_profiles_tenant ON crm.customer_credit_profiles
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_customer_credit_profiles_tenant ON crm.customer_credit_profiles
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_customer_credit_profiles_tenant ON crm.customer_credit_profiles
  FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON crm.customer_credit_profiles TO app_runtime;
GRANT SELECT ON crm.customer_credit_profiles TO app_readonly;
