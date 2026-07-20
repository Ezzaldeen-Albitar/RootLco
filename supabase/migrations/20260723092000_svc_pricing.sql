-- ============================================================================
-- Phase: 1-10 — Service Catalog, Pricing, Quotation, and Inventory Database
-- Migration: pricing — price lists/versions/rules/assignments, discounts, policies
-- Tasks: P1-10-DB (pricing); FR-SVC-002/003, BR-SVC-001
-- Owner module: svc
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once
--   priced. Forward-only — no down script.
--
-- Purpose
--   The pricing layer (Figure 4.20). Money is NUMERIC(18,4); currency is a
--   currency_code FK to shared.currencies (ISO 4217); tax reuses org.tax_classes/
--   org.tax_rates; approval ceilings reuse iam.approval_limits.
--     * svc.price_lists — named tenant price book in one currency.
--     * svc.price_list_versions — immutable published versions (BR-SVC-001), no
--       overlap (gist EXCLUDE), forward-only close by svc.publish_price_list_version.
--     * svc.price_rules — a rule targets a service and optionally narrows by
--       company/branch/customer-class; inherits the list currency; frozen once the
--       parent version is published (INSERT/UPDATE/DELETE).
--     * svc.price_list_assignments — maps a scope context to exactly one price list
--       so resolution never arbitrates across books.
--     * svc.discount_rules — bounded percentage/amount discounts.
--     * svc.pricing_approval_policies — when approval is required + which permission.
--   svc.resolve_price(service, company, branch, customer_class, as_of) returns the
--   single deterministic winner (assignment -> effective published version -> rule).
--
-- Design gate amendments implemented: H2/H11 (single-book + NULLS NOT DISTINCT +
--   bit-weighted specificity), H12 (currency inherited from list), H13 (INSERT/
--   DELETE freeze), tax-null-when-company-null CHECK, discount bounds.
--
-- Dependencies
--   svc.services; org.tenants; org.tax_classes; shared.currencies;
--   iam.permissions; iam.current_tenant_id; shared.touch_row_metadata;
--   org.guard_immutable_columns; extension btree_gist.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Guard functions
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION svc.guard_price_list_version_freeze()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF OLD.status IN ('published', 'archived') THEN
    IF NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR NEW.notes IS DISTINCT FROM OLD.notes THEN
      RAISE EXCEPTION 'svc.price_list_versions: a % version is frozen', OLD.status USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
      RAISE EXCEPTION 'svc.price_list_versions: effective_to is already closed and cannot change' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'archived' AND NEW.status <> 'archived' THEN
      RAISE EXCEPTION 'svc.price_list_versions: archived is terminal' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'published' AND NEW.status NOT IN ('published', 'archived') THEN
      RAISE EXCEPTION 'svc.price_list_versions: a published version may only be archived' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION svc.guard_price_list_version_freeze() FROM PUBLIC;

-- Freeze price_rules against INSERT/UPDATE/DELETE once the parent version is published.
CREATE OR REPLACE FUNCTION svc.guard_price_rule_parent_frozen()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_status text; v_tenant uuid; v_version uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN v_tenant := OLD.tenant_id; v_version := OLD.price_list_version_id;
  ELSE v_tenant := NEW.tenant_id; v_version := NEW.price_list_version_id; END IF;
  SELECT status INTO v_status FROM svc.price_list_versions WHERE tenant_id = v_tenant AND id = v_version;
  IF FOUND AND v_status IN ('published', 'archived') THEN
    RAISE EXCEPTION 'svc.price_rules: parent price-list version is % and frozen', v_status USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
REVOKE EXECUTE ON FUNCTION svc.guard_price_rule_parent_frozen() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 1. svc.price_lists
-- ----------------------------------------------------------------------------
CREATE TABLE svc.price_lists (
  id              uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       uuid    NOT NULL,
  price_list_code text    NOT NULL,
  name            text    NOT NULL,
  currency_code   text    NOT NULL,
  description     text    NULL,
  status          text    NOT NULL DEFAULT 'active',
  record_version  integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid    NOT NULL,
  updated_at      timestamptz NULL,
  updated_by      uuid    NULL,
  deleted_at      timestamptz NULL,
  deleted_by      uuid    NULL,

  CONSTRAINT pk_price_lists PRIMARY KEY (id),
  CONSTRAINT uq_price_lists_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_price_lists_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_price_lists_currency FOREIGN KEY (currency_code) REFERENCES shared.currencies (code) ON DELETE RESTRICT,
  CONSTRAINT ck_price_lists_code_format CHECK (price_list_code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,62}$'),
  CONSTRAINT ck_price_lists_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_price_lists_desc_not_blank CHECK (description IS NULL OR btrim(description) <> ''),
  CONSTRAINT ck_price_lists_status CHECK (status IN ('active', 'inactive'))
);
COMMENT ON TABLE svc.price_lists IS 'Phase 1-10 named tenant price book in a single currency (currency_code -> shared.currencies).';
CREATE UNIQUE INDEX uq_price_lists_code ON svc.price_lists (tenant_id, price_list_code) WHERE deleted_at IS NULL;
CREATE INDEX ix_price_lists_currency ON svc.price_lists (currency_code);
CREATE TRIGGER tg_price_lists_touch_metadata BEFORE UPDATE ON svc.price_lists
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_price_lists_immutable BEFORE UPDATE ON svc.price_lists
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'price_list_code', 'currency_code', 'created_at', 'created_by');
ALTER TABLE svc.price_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE svc.price_lists FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_price_lists_tenant ON svc.price_lists FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_price_lists_tenant ON svc.price_lists FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_price_lists_tenant ON svc.price_lists FOR UPDATE TO app_runtime USING (tenant_id = iam.current_tenant_id()) WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON svc.price_lists TO app_runtime;
GRANT SELECT ON svc.price_lists TO app_readonly;

-- ----------------------------------------------------------------------------
-- 2. svc.price_list_versions
-- ----------------------------------------------------------------------------
CREATE TABLE svc.price_list_versions (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid    NOT NULL,
  price_list_id  uuid    NOT NULL,
  version_no     integer NOT NULL,
  effective_from date    NOT NULL,
  effective_to   date    NULL,
  status         text    NOT NULL DEFAULT 'draft',
  notes          text    NULL,
  record_version integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid    NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid    NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid    NULL,

  CONSTRAINT pk_price_list_versions PRIMARY KEY (id),
  CONSTRAINT uq_price_list_versions_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT uq_price_list_versions_no UNIQUE (tenant_id, price_list_id, version_no),
  CONSTRAINT fk_price_list_versions_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_price_list_versions_list FOREIGN KEY (tenant_id, price_list_id) REFERENCES svc.price_lists (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_price_list_versions_no CHECK (version_no > 0),
  CONSTRAINT ck_price_list_versions_range CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT ck_price_list_versions_status CHECK (status IN ('draft', 'published', 'archived')),
  CONSTRAINT ck_price_list_versions_notes_not_blank CHECK (notes IS NULL OR btrim(notes) <> ''),
  CONSTRAINT ex_price_list_versions_no_published_overlap EXCLUDE USING gist (
    tenant_id WITH =, price_list_id WITH =, daterange(effective_from, effective_to, '[)') WITH &&
  ) WHERE (status = 'published' AND deleted_at IS NULL)
);
COMMENT ON TABLE svc.price_list_versions IS 'Phase 1-10 immutable published price-list versions (BR-SVC-001). No overlap; forward-only close by svc.publish_price_list_version.';
CREATE INDEX ix_price_list_versions_list ON svc.price_list_versions (tenant_id, price_list_id);
CREATE TRIGGER tg_price_list_versions_touch_metadata BEFORE UPDATE ON svc.price_list_versions
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_price_list_versions_freeze BEFORE UPDATE ON svc.price_list_versions
  FOR EACH ROW EXECUTE FUNCTION svc.guard_price_list_version_freeze();
CREATE TRIGGER tg_price_list_versions_immutable BEFORE UPDATE ON svc.price_list_versions
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'price_list_id', 'version_no', 'created_at', 'created_by');
ALTER TABLE svc.price_list_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE svc.price_list_versions FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_price_list_versions_tenant ON svc.price_list_versions FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_price_list_versions_tenant ON svc.price_list_versions FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_price_list_versions_tenant ON svc.price_list_versions FOR UPDATE TO app_runtime USING (tenant_id = iam.current_tenant_id()) WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON svc.price_list_versions TO app_runtime;
GRANT SELECT ON svc.price_list_versions TO app_readonly;

CREATE OR REPLACE FUNCTION svc.publish_price_list_version(p_price_list_id uuid, p_version_id uuid, p_effective_from date)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_status text; v_prior uuid; v_prior_from date;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'svc.publish_price_list_version requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  PERFORM 1 FROM svc.price_lists WHERE tenant_id = v_tenant AND id = p_price_list_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'price list % not found in tenant', p_price_list_id USING ERRCODE = 'foreign_key_violation'; END IF;
  SELECT status INTO v_status FROM svc.price_list_versions WHERE tenant_id = v_tenant AND id = p_version_id AND price_list_id = p_price_list_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'version % not found for price list %', p_version_id, p_price_list_id USING ERRCODE = 'foreign_key_violation'; END IF;
  IF v_status <> 'draft' THEN RAISE EXCEPTION 'only a draft version can be published (found %)', v_status USING ERRCODE = 'check_violation'; END IF;
  SELECT id, effective_from INTO v_prior, v_prior_from FROM svc.price_list_versions
    WHERE tenant_id = v_tenant AND price_list_id = p_price_list_id AND status = 'published' AND effective_to IS NULL AND deleted_at IS NULL FOR UPDATE;
  IF FOUND THEN
    IF p_effective_from <= v_prior_from THEN
      RAISE EXCEPTION 'new effective_from % must be after the current published version effective_from %', p_effective_from, v_prior_from USING ERRCODE = 'check_violation';
    END IF;
    UPDATE svc.price_list_versions SET effective_to = p_effective_from WHERE tenant_id = v_tenant AND id = v_prior;
  END IF;
  UPDATE svc.price_list_versions SET status = 'published', effective_from = p_effective_from WHERE tenant_id = v_tenant AND id = p_version_id;
END; $$;
REVOKE EXECUTE ON FUNCTION svc.publish_price_list_version(uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION svc.publish_price_list_version(uuid, uuid, date) TO app_runtime;

-- ----------------------------------------------------------------------------
-- 3. svc.price_rules
-- ----------------------------------------------------------------------------
CREATE TABLE svc.price_rules (
  id                    uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id             uuid    NOT NULL,
  price_list_version_id uuid    NOT NULL,
  service_id            uuid    NOT NULL,
  company_id            uuid    NULL,
  branch_id             uuid    NULL,
  customer_class        text    NULL,
  amount                numeric(18, 4) NOT NULL,
  tax_class_id          uuid    NULL,
  priority              integer NOT NULL DEFAULT 0,
  status                text    NOT NULL DEFAULT 'active',
  record_version        integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid    NOT NULL,
  updated_at            timestamptz NULL,
  updated_by            uuid    NULL,
  deleted_at            timestamptz NULL,
  deleted_by            uuid    NULL,

  CONSTRAINT pk_price_rules PRIMARY KEY (id),
  CONSTRAINT fk_price_rules_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_price_rules_version FOREIGN KEY (tenant_id, price_list_version_id) REFERENCES svc.price_list_versions (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_price_rules_service FOREIGN KEY (tenant_id, service_id) REFERENCES svc.services (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_price_rules_tax_class FOREIGN KEY (tenant_id, company_id, tax_class_id) REFERENCES org.tax_classes (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_price_rules_amount CHECK (amount >= 0),
  CONSTRAINT ck_price_rules_priority CHECK (priority >= 0),
  CONSTRAINT ck_price_rules_customer_class CHECK (customer_class IS NULL OR customer_class ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_price_rules_status CHECK (status IN ('active', 'inactive')),
  CONSTRAINT ck_price_rules_tax_needs_company CHECK (company_id IS NOT NULL OR tax_class_id IS NULL)
);
COMMENT ON TABLE svc.price_rules IS 'Phase 1-10 price rule (targets a service; optional company/branch/customer-class narrowing). Inherits the list currency. Deterministic precedence via svc.resolve_price. Frozen once the parent version is published.';
-- anti-ambiguity: exactly one rule per full signature within a version (NULLS NOT DISTINCT).
CREATE UNIQUE INDEX uq_price_rules_signature ON svc.price_rules
  (price_list_version_id, service_id, company_id, branch_id, customer_class, priority) NULLS NOT DISTINCT
  WHERE deleted_at IS NULL;
CREATE INDEX ix_price_rules_version ON svc.price_rules (tenant_id, price_list_version_id);
CREATE INDEX ix_price_rules_service ON svc.price_rules (tenant_id, service_id);
CREATE INDEX ix_price_rules_tax_class ON svc.price_rules (tenant_id, company_id, tax_class_id);
-- Fires on INSERT/UPDATE only: app_runtime holds no DELETE grant, so a published
-- rule cannot be removed by the runtime; the admin/owner cascade must stay able to.
CREATE TRIGGER tg_price_rules_parent_frozen BEFORE INSERT OR UPDATE ON svc.price_rules
  FOR EACH ROW EXECUTE FUNCTION svc.guard_price_rule_parent_frozen();
CREATE TRIGGER tg_price_rules_touch_metadata BEFORE UPDATE ON svc.price_rules
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_price_rules_immutable BEFORE UPDATE ON svc.price_rules
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'price_list_version_id', 'service_id', 'created_at', 'created_by');
ALTER TABLE svc.price_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE svc.price_rules FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_price_rules_tenant ON svc.price_rules FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_price_rules_tenant ON svc.price_rules FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_price_rules_tenant ON svc.price_rules FOR UPDATE TO app_runtime USING (tenant_id = iam.current_tenant_id()) WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON svc.price_rules TO app_runtime;
GRANT SELECT ON svc.price_rules TO app_readonly;

-- ----------------------------------------------------------------------------
-- 4. svc.price_list_assignments — one applicable book per context.
-- ----------------------------------------------------------------------------
CREATE TABLE svc.price_list_assignments (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid    NOT NULL,
  price_list_id  uuid    NOT NULL,
  company_id     uuid    NULL,
  branch_id      uuid    NULL,
  customer_class text    NULL,
  priority       integer NOT NULL DEFAULT 0,
  effective_from date    NOT NULL,
  effective_to   date    NULL,
  status         text    NOT NULL DEFAULT 'active',
  record_version integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid    NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid    NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid    NULL,

  CONSTRAINT pk_price_list_assignments PRIMARY KEY (id),
  CONSTRAINT fk_price_list_assignments_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_price_list_assignments_list FOREIGN KEY (tenant_id, price_list_id) REFERENCES svc.price_lists (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_price_list_assignments_priority CHECK (priority >= 0),
  CONSTRAINT ck_price_list_assignments_range CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT ck_price_list_assignments_customer_class CHECK (customer_class IS NULL OR customer_class ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_price_list_assignments_status CHECK (status IN ('active', 'inactive'))
);
COMMENT ON TABLE svc.price_list_assignments IS 'Phase 1-10 maps a scope context (company/branch/customer-class) to exactly one price list so svc.resolve_price never arbitrates across books.';
CREATE UNIQUE INDEX uq_price_list_assignments_signature ON svc.price_list_assignments
  (tenant_id, company_id, branch_id, customer_class, priority) NULLS NOT DISTINCT
  WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX ix_price_list_assignments_list ON svc.price_list_assignments (tenant_id, price_list_id);
CREATE TRIGGER tg_price_list_assignments_touch_metadata BEFORE UPDATE ON svc.price_list_assignments
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_price_list_assignments_immutable BEFORE UPDATE ON svc.price_list_assignments
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'created_at', 'created_by');
ALTER TABLE svc.price_list_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE svc.price_list_assignments FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_price_list_assignments_tenant ON svc.price_list_assignments FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_price_list_assignments_tenant ON svc.price_list_assignments FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_price_list_assignments_tenant ON svc.price_list_assignments FOR UPDATE TO app_runtime USING (tenant_id = iam.current_tenant_id()) WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON svc.price_list_assignments TO app_runtime;
GRANT SELECT ON svc.price_list_assignments TO app_readonly;

-- ----------------------------------------------------------------------------
-- 5. svc.discount_rules
-- ----------------------------------------------------------------------------
CREATE TABLE svc.discount_rules (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid    NOT NULL,
  discount_code  text    NOT NULL,
  name           text    NOT NULL,
  discount_type  text    NOT NULL,
  value          numeric(18, 4) NOT NULL,
  currency_code  text    NULL,
  company_id     uuid    NULL,
  branch_id      uuid    NULL,
  customer_class text    NULL,
  service_id     uuid    NULL,
  effective_from date    NOT NULL,
  effective_to   date    NULL,
  status         text    NOT NULL DEFAULT 'active',
  record_version integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid    NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid    NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid    NULL,

  CONSTRAINT pk_discount_rules PRIMARY KEY (id),
  CONSTRAINT fk_discount_rules_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_discount_rules_currency FOREIGN KEY (currency_code) REFERENCES shared.currencies (code) ON DELETE RESTRICT,
  CONSTRAINT fk_discount_rules_service FOREIGN KEY (tenant_id, service_id) REFERENCES svc.services (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_discount_rules_code_format CHECK (discount_code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,62}$'),
  CONSTRAINT ck_discount_rules_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_discount_rules_customer_class CHECK (customer_class IS NULL OR customer_class ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_discount_rules_range CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT ck_discount_rules_status CHECK (status IN ('active', 'inactive')),
  CONSTRAINT ck_discount_rules_type_value CHECK (
    (discount_type = 'percentage' AND value >= 0 AND value <= 100 AND currency_code IS NULL)
    OR (discount_type = 'amount' AND value >= 0 AND currency_code IS NOT NULL))
);
COMMENT ON TABLE svc.discount_rules IS 'Phase 1-10 bounded discount rules (percentage 0..100 or amount>=0 with currency). Approval threshold detection via svc.pricing_approval_policies + iam.approval_limits.';
CREATE UNIQUE INDEX uq_discount_rules_code ON svc.discount_rules (tenant_id, discount_code) WHERE deleted_at IS NULL;
CREATE INDEX ix_discount_rules_currency ON svc.discount_rules (currency_code);
CREATE INDEX ix_discount_rules_service ON svc.discount_rules (tenant_id, service_id);
CREATE TRIGGER tg_discount_rules_touch_metadata BEFORE UPDATE ON svc.discount_rules
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_discount_rules_immutable BEFORE UPDATE ON svc.discount_rules
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'discount_code', 'created_at', 'created_by');
ALTER TABLE svc.discount_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE svc.discount_rules FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_discount_rules_tenant ON svc.discount_rules FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_discount_rules_tenant ON svc.discount_rules FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_discount_rules_tenant ON svc.discount_rules FOR UPDATE TO app_runtime USING (tenant_id = iam.current_tenant_id()) WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON svc.discount_rules TO app_runtime;
GRANT SELECT ON svc.discount_rules TO app_readonly;

-- ----------------------------------------------------------------------------
-- 6. svc.pricing_approval_policies — when approval is required + which permission.
-- ----------------------------------------------------------------------------
CREATE TABLE svc.pricing_approval_policies (
  id                      uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id               uuid    NOT NULL,
  company_id              uuid    NULL,
  policy_type             text    NOT NULL,
  threshold_kind          text    NOT NULL,
  threshold_value         numeric(18, 4) NOT NULL,
  currency_code           text    NULL,
  required_permission_code text   NOT NULL,
  maker_approver_distinct boolean NOT NULL DEFAULT true,
  effective_from          date    NOT NULL,
  effective_to            date    NULL,
  status                  text    NOT NULL DEFAULT 'active',
  record_version          integer NOT NULL DEFAULT 1,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid    NOT NULL,
  updated_at              timestamptz NULL,
  updated_by              uuid    NULL,
  deleted_at              timestamptz NULL,
  deleted_by              uuid    NULL,

  CONSTRAINT pk_pricing_approval_policies PRIMARY KEY (id),
  CONSTRAINT fk_pricing_approval_policies_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_pricing_approval_policies_currency FOREIGN KEY (currency_code) REFERENCES shared.currencies (code) ON DELETE RESTRICT,
  CONSTRAINT fk_pricing_approval_policies_permission FOREIGN KEY (required_permission_code) REFERENCES iam.permissions (permission_code) ON DELETE RESTRICT,
  CONSTRAINT ck_pricing_approval_policies_type CHECK (policy_type IN ('discount', 'quotation_total', 'price_override')),
  CONSTRAINT ck_pricing_approval_policies_threshold_value CHECK (threshold_value >= 0),
  CONSTRAINT ck_pricing_approval_policies_range CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT ck_pricing_approval_policies_status CHECK (status IN ('active', 'inactive')),
  CONSTRAINT ck_pricing_approval_policies_kind CHECK (
    (threshold_kind = 'percentage' AND currency_code IS NULL)
    OR (threshold_kind = 'amount' AND currency_code IS NOT NULL))
);
COMMENT ON TABLE svc.pricing_approval_policies IS 'Phase 1-10 stores WHEN pricing/discount approval is required and WHICH permission authorizes it (P1-20 owns the workflow; iam.approval_limits owns the monetary ceiling).';
CREATE UNIQUE INDEX uq_pricing_approval_policies_scope ON svc.pricing_approval_policies (tenant_id, company_id, policy_type) NULLS NOT DISTINCT WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX ix_pricing_approval_policies_tenant ON svc.pricing_approval_policies (tenant_id);
CREATE INDEX ix_pricing_approval_policies_currency ON svc.pricing_approval_policies (currency_code);
CREATE INDEX ix_pricing_approval_policies_permission ON svc.pricing_approval_policies (required_permission_code);
CREATE TRIGGER tg_pricing_approval_policies_touch_metadata BEFORE UPDATE ON svc.pricing_approval_policies
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_pricing_approval_policies_immutable BEFORE UPDATE ON svc.pricing_approval_policies
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'created_at', 'created_by');
ALTER TABLE svc.pricing_approval_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE svc.pricing_approval_policies FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_pricing_approval_policies_tenant ON svc.pricing_approval_policies FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_pricing_approval_policies_tenant ON svc.pricing_approval_policies FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_pricing_approval_policies_tenant ON svc.pricing_approval_policies FOR UPDATE TO app_runtime USING (tenant_id = iam.current_tenant_id()) WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON svc.pricing_approval_policies TO app_runtime;
GRANT SELECT ON svc.pricing_approval_policies TO app_readonly;

-- ----------------------------------------------------------------------------
-- Deterministic single-winner price resolver (FR-SVC-003).
--   assignment (one book) -> effective published version -> one rule.
--   Specificity is a strict bit-weighted total order: branch(4) > company(2) >
--   customer-class(1); ties broken by priority DESC then id.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION svc.resolve_price(
  p_service_id uuid, p_company_id uuid, p_branch_id uuid, p_customer_class text, p_as_of date)
RETURNS TABLE (price_rule_id uuid, amount numeric, currency_code text, tax_class_id uuid)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_list uuid; v_currency text; v_version uuid;
BEGIN
  IF v_tenant IS NULL THEN RETURN; END IF;
  SELECT a.price_list_id INTO v_list
  FROM svc.price_list_assignments a
  WHERE a.tenant_id = v_tenant AND a.status = 'active' AND a.deleted_at IS NULL
    AND a.effective_from <= p_as_of AND (a.effective_to IS NULL OR a.effective_to > p_as_of)
    AND (a.company_id IS NULL OR a.company_id = p_company_id)
    AND (a.branch_id IS NULL OR a.branch_id = p_branch_id)
    AND (a.customer_class IS NULL OR a.customer_class = p_customer_class)
  ORDER BY (CASE WHEN a.branch_id IS NOT NULL THEN 4 ELSE 0 END
          + CASE WHEN a.company_id IS NOT NULL THEN 2 ELSE 0 END
          + CASE WHEN a.customer_class IS NOT NULL THEN 1 ELSE 0 END) DESC, a.priority DESC, a.id
  LIMIT 1;
  IF v_list IS NULL THEN RETURN; END IF;
  SELECT pl.currency_code INTO v_currency FROM svc.price_lists pl WHERE pl.tenant_id = v_tenant AND pl.id = v_list;
  SELECT plv.id INTO v_version
  FROM svc.price_list_versions plv
  WHERE plv.tenant_id = v_tenant AND plv.price_list_id = v_list AND plv.status = 'published' AND plv.deleted_at IS NULL
    AND plv.effective_from <= p_as_of AND (plv.effective_to IS NULL OR plv.effective_to > p_as_of)
  ORDER BY plv.effective_from DESC LIMIT 1;
  IF v_version IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT r.id, r.amount, v_currency, r.tax_class_id
  FROM svc.price_rules r
  WHERE r.tenant_id = v_tenant AND r.price_list_version_id = v_version AND r.service_id = p_service_id
    AND r.status = 'active' AND r.deleted_at IS NULL
    AND (r.company_id IS NULL OR r.company_id = p_company_id)
    AND (r.branch_id IS NULL OR r.branch_id = p_branch_id)
    AND (r.customer_class IS NULL OR r.customer_class = p_customer_class)
  ORDER BY (CASE WHEN r.branch_id IS NOT NULL THEN 4 ELSE 0 END
          + CASE WHEN r.company_id IS NOT NULL THEN 2 ELSE 0 END
          + CASE WHEN r.customer_class IS NOT NULL THEN 1 ELSE 0 END) DESC, r.priority DESC, r.id
  LIMIT 1;
END; $$;
REVOKE EXECUTE ON FUNCTION svc.resolve_price(uuid, uuid, uuid, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION svc.resolve_price(uuid, uuid, uuid, text, date) TO app_runtime, app_readonly;
