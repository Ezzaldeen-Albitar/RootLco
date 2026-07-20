-- ============================================================================
-- Phase 1-11 — wty warranty (P1-11-DB-015/016/017)
-- Warranty policies, effective-dated coverage (eligibility at the service date —
-- BR-WTY-001), warranty records bound to the delivery's odometer/date, covered items,
-- and append-only status history. Full claim adjudication is deferred to Phase 1-22.
--
-- Rollback classification: ROLL-FORWARD-ONLY once any warranty record exists (no down
--   migration).
--
-- Binding amendments (§19): M-wty-1 (no-overlap active warranty records per
-- vehicle+coverage), M-wty-2 (odometer_at_issue/start bound to the delivery). Final
-- red-team hardening: a structural coherence guard (delivery must be 'delivered' and its
-- vehicle/work order must match) backs the raw-INSERT path; the exact odometer/date VALUE
-- binding remains a wty.issue_warranty invariant (accepted residual M-wty-2b).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. wty.warranty_policies
-- ----------------------------------------------------------------------------
CREATE TABLE wty.warranty_policies (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  company_id  uuid NOT NULL,
  policy_code text NOT NULL,
  name        text NOT NULL,
  status      text NOT NULL DEFAULT 'active',
  record_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NULL,
  updated_by uuid NULL,
  deleted_at timestamptz NULL,
  deleted_by uuid NULL,

  CONSTRAINT pk_warranty_policies PRIMARY KEY (id),
  CONSTRAINT uq_warranty_policies_scope_id UNIQUE (tenant_id, company_id, id),
  CONSTRAINT fk_warranty_policies_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_warranty_policies_company FOREIGN KEY (tenant_id, company_id) REFERENCES org.legal_companies (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_warranty_policies_status CHECK (status IN ('active', 'archived')),
  CONSTRAINT ck_warranty_policies_code CHECK (policy_code ~ '^[a-z][a-z0-9_]{1,62}$')
);
COMMENT ON TABLE wty.warranty_policies IS 'Phase 1-11 warranty policy (tenant/company-scoped). Terms live in effective-dated wty.warranty_coverage. Structural only (no business-content seeds).';
CREATE UNIQUE INDEX uq_warranty_policies_code ON wty.warranty_policies (tenant_id, company_id, policy_code) WHERE deleted_at IS NULL;
CREATE INDEX ix_warranty_policies_company ON wty.warranty_policies (tenant_id, company_id);
CREATE TRIGGER tg_warranty_policies_touch_metadata BEFORE UPDATE ON wty.warranty_policies FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_warranty_policies_immutable BEFORE UPDATE ON wty.warranty_policies
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'created_at', 'created_by');
ALTER TABLE wty.warranty_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE wty.warranty_policies FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_warranty_policies_scope ON wty.warranty_policies FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())));
CREATE POLICY ins_warranty_policies_scope ON wty.warranty_policies FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())));
CREATE POLICY upd_warranty_policies_scope ON wty.warranty_policies FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())));
GRANT SELECT, INSERT, UPDATE ON wty.warranty_policies TO app_runtime;
GRANT SELECT ON wty.warranty_policies TO app_readonly;

-- ----------------------------------------------------------------------------
-- 2. wty.warranty_coverage — effective-dated terms (no-overlap per policy+scope)
-- ----------------------------------------------------------------------------
CREATE TABLE wty.warranty_coverage (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  company_id     uuid NOT NULL,
  policy_id      uuid NOT NULL,
  covered_scope  text NOT NULL,
  duration_months integer NOT NULL,
  odometer_limit integer NULL,
  effective_from date NOT NULL,
  effective_to   date NULL,
  status         text NOT NULL DEFAULT 'active',
  record_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NULL,
  updated_by uuid NULL,
  deleted_at timestamptz NULL,
  deleted_by uuid NULL,

  CONSTRAINT pk_warranty_coverage PRIMARY KEY (id),
  CONSTRAINT uq_warranty_coverage_scope_id UNIQUE (tenant_id, company_id, id),
  CONSTRAINT fk_warranty_coverage_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_warranty_coverage_policy FOREIGN KEY (tenant_id, company_id, policy_id) REFERENCES wty.warranty_policies (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_warranty_coverage_scope CHECK (covered_scope IN ('all', 'service', 'part')),
  CONSTRAINT ck_warranty_coverage_duration CHECK (duration_months > 0),
  CONSTRAINT ck_warranty_coverage_odometer CHECK (odometer_limit IS NULL OR odometer_limit > 0),
  CONSTRAINT ck_warranty_coverage_status CHECK (status IN ('active', 'archived')),
  CONSTRAINT ck_warranty_coverage_effective CHECK (effective_to IS NULL OR effective_to > effective_from),
  -- BR-WTY-001: no two active coverages for the same policy+scope overlap in time.
  CONSTRAINT ex_warranty_coverage_no_overlap EXCLUDE USING gist (
    tenant_id WITH =, company_id WITH =, policy_id WITH =, covered_scope WITH =,
    daterange(effective_from, effective_to, '[)') WITH &&
  ) WHERE (status = 'active' AND deleted_at IS NULL)
);
COMMENT ON TABLE wty.warranty_coverage IS 'Phase 1-11 effective-dated warranty coverage (BR-WTY-001). Eligibility uses the coverage effective at the service/delivery date; a backdated coverage cannot change historical interpretation (gist EXCLUDE no-overlap on active coverage).';
CREATE INDEX ix_warranty_coverage_policy ON wty.warranty_coverage (tenant_id, company_id, policy_id);
CREATE TRIGGER tg_warranty_coverage_touch_metadata BEFORE UPDATE ON wty.warranty_coverage FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_warranty_coverage_immutable BEFORE UPDATE ON wty.warranty_coverage
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'policy_id', 'effective_from', 'created_at', 'created_by');
ALTER TABLE wty.warranty_coverage ENABLE ROW LEVEL SECURITY;
ALTER TABLE wty.warranty_coverage FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_warranty_coverage_scope ON wty.warranty_coverage FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())));
CREATE POLICY ins_warranty_coverage_scope ON wty.warranty_coverage FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())));
CREATE POLICY upd_warranty_coverage_scope ON wty.warranty_coverage FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())));
GRANT SELECT, INSERT, UPDATE ON wty.warranty_coverage TO app_runtime;
GRANT SELECT ON wty.warranty_coverage TO app_readonly;

-- ----------------------------------------------------------------------------
-- 3. wty.warranty_records — issued per delivered work; bound to delivery odometer/date
-- ----------------------------------------------------------------------------
CREATE TABLE wty.warranty_records (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  company_id       uuid NOT NULL,
  branch_id        uuid NOT NULL,
  vehicle_id       uuid NOT NULL,
  work_order_id    uuid NOT NULL,
  delivery_record_id uuid NOT NULL,
  policy_id        uuid NOT NULL,
  coverage_id      uuid NOT NULL,
  start_date       date NOT NULL,
  expiry_date      date NOT NULL,
  odometer_at_issue integer NOT NULL,
  odometer_limit   integer NULL,
  status           text NOT NULL DEFAULT 'issued',
  idempotency_key  text NULL,
  record_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NULL,
  updated_by uuid NULL,
  deleted_at timestamptz NULL,
  deleted_by uuid NULL,

  CONSTRAINT pk_warranty_records PRIMARY KEY (id),
  CONSTRAINT uq_warranty_records_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_warranty_records_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_warranty_records_branch FOREIGN KEY (tenant_id, company_id, branch_id) REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_warranty_records_vehicle FOREIGN KEY (tenant_id, vehicle_id) REFERENCES veh.vehicles (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_warranty_records_work_order FOREIGN KEY (tenant_id, company_id, branch_id, work_order_id) REFERENCES wo.work_orders (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_warranty_records_delivery FOREIGN KEY (tenant_id, company_id, branch_id, delivery_record_id) REFERENCES sal.delivery_records (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_warranty_records_policy FOREIGN KEY (tenant_id, company_id, policy_id) REFERENCES wty.warranty_policies (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_warranty_records_coverage FOREIGN KEY (tenant_id, company_id, coverage_id) REFERENCES wty.warranty_coverage (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_warranty_records_status CHECK (status IN ('issued', 'active', 'expired', 'voided', 'claimed_against')),
  CONSTRAINT ck_warranty_records_dates CHECK (expiry_date > start_date),
  CONSTRAINT ck_warranty_records_odometer CHECK (odometer_at_issue >= 0 AND (odometer_limit IS NULL OR odometer_limit >= odometer_at_issue)),
  -- M-wty-1: no two live warranty records overlap for the same vehicle + coverage.
  CONSTRAINT ex_warranty_records_no_overlap EXCLUDE USING gist (
    tenant_id WITH =, vehicle_id WITH =, coverage_id WITH =,
    daterange(start_date, expiry_date, '[]') WITH &&
  ) WHERE (status IN ('issued', 'active') AND deleted_at IS NULL)
);
COMMENT ON TABLE wty.warranty_records IS 'Phase 1-11 warranty record (branch-scoped). odometer_at_issue/start_date bound to the delivery (M-wty-2). Immutable after issue (freeze guard). No overlapping live record per vehicle+coverage (M-wty-1). Full claim adjudication deferred to Phase 1-22.';
CREATE UNIQUE INDEX uq_warranty_records_idempotency ON wty.warranty_records (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX ix_warranty_records_vehicle ON wty.warranty_records (tenant_id, vehicle_id);
CREATE INDEX ix_warranty_records_work_order ON wty.warranty_records (tenant_id, company_id, branch_id, work_order_id);
CREATE INDEX ix_warranty_records_delivery ON wty.warranty_records (tenant_id, company_id, branch_id, delivery_record_id);
CREATE INDEX ix_warranty_records_policy ON wty.warranty_records (tenant_id, company_id, policy_id);
CREATE INDEX ix_warranty_records_coverage ON wty.warranty_records (tenant_id, company_id, coverage_id);
CREATE INDEX ix_warranty_records_expiry ON wty.warranty_records (tenant_id, company_id, branch_id, expiry_date);

-- Freeze the issued warranty record (identity + terms immutable; status may advance).
CREATE OR REPLACE FUNCTION wty.guard_warranty_record_freeze()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.vehicle_id <> OLD.vehicle_id OR NEW.work_order_id <> OLD.work_order_id OR NEW.delivery_record_id <> OLD.delivery_record_id
     OR NEW.policy_id <> OLD.policy_id OR NEW.coverage_id <> OLD.coverage_id OR NEW.start_date <> OLD.start_date
     OR NEW.expiry_date <> OLD.expiry_date OR NEW.odometer_at_issue <> OLD.odometer_at_issue
     OR NEW.odometer_limit IS DISTINCT FROM OLD.odometer_limit THEN
    RAISE EXCEPTION 'wty.warranty_records: an issued warranty record''s terms are frozen (corrections via a linked record)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION wty.guard_warranty_record_freeze() FROM PUBLIC;
CREATE TRIGGER tg_warranty_records_freeze BEFORE UPDATE ON wty.warranty_records FOR EACH ROW EXECUTE FUNCTION wty.guard_warranty_record_freeze();
CREATE TRIGGER tg_warranty_records_touch_metadata BEFORE UPDATE ON wty.warranty_records FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_warranty_records_immutable BEFORE UPDATE ON wty.warranty_records
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'created_at', 'created_by');

-- Structural coherence guard (M-wty-2 hardening): app_runtime holds raw INSERT here, so a
-- warranty record must not be fabricated against a delivery that was never completed or that
-- belongs to a different vehicle/work order. The delivery is the structural source of truth.
-- The finer odometer_at_issue/start_date VALUE binding stays enforced inside
-- wty.issue_warranty (accepted residual M-wty-2b: the downstream claim adjudication is out of
-- P1-11 scope, and binding the exact values at the constraint layer would replicate the issue
-- derivation and fix warranty policy the phase deliberately leaves open).
CREATE OR REPLACE FUNCTION wty.guard_warranty_record_coherence()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_del sal.delivery_records%ROWTYPE;
BEGIN
  SELECT * INTO v_del FROM sal.delivery_records
    WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id AND branch_id = NEW.branch_id AND id = NEW.delivery_record_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wty.warranty_records: delivery % not found in scope', NEW.delivery_record_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_del.status <> 'delivered' THEN
    RAISE EXCEPTION 'wty.warranty_records: delivery % is % (a warranty may only be issued against a delivered vehicle)', NEW.delivery_record_id, v_del.status USING ERRCODE = 'check_violation';
  END IF;
  IF v_del.vehicle_id <> NEW.vehicle_id OR v_del.work_order_id <> NEW.work_order_id THEN
    RAISE EXCEPTION 'wty.warranty_records: vehicle/work order must match delivery %', NEW.delivery_record_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION wty.guard_warranty_record_coherence() FROM PUBLIC;
CREATE TRIGGER tg_warranty_records_coherence BEFORE INSERT ON wty.warranty_records FOR EACH ROW EXECUTE FUNCTION wty.guard_warranty_record_coherence();

ALTER TABLE wty.warranty_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE wty.warranty_records FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_warranty_records_scope ON wty.warranty_records FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_warranty_records_scope ON wty.warranty_records FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_warranty_records_scope ON wty.warranty_records FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
GRANT SELECT, INSERT, UPDATE ON wty.warranty_records TO app_runtime;
GRANT SELECT ON wty.warranty_records TO app_readonly;

-- ----------------------------------------------------------------------------
-- 4. wty.warranty_record_items
-- ----------------------------------------------------------------------------
CREATE TABLE wty.warranty_record_items (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  company_id         uuid NOT NULL,
  branch_id          uuid NOT NULL,
  warranty_record_id uuid NOT NULL,
  item_kind          text NOT NULL,
  source_job_id      uuid NULL,
  source_part_id     uuid NULL,
  description        text NOT NULL,
  record_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NULL,
  updated_by uuid NULL,
  deleted_at timestamptz NULL,
  deleted_by uuid NULL,

  CONSTRAINT pk_warranty_record_items PRIMARY KEY (id),
  CONSTRAINT fk_warranty_record_items_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_warranty_record_items_record FOREIGN KEY (tenant_id, company_id, branch_id, warranty_record_id)
    REFERENCES wty.warranty_records (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_warranty_record_items_kind CHECK (item_kind IN ('service', 'part'))
);
COMMENT ON TABLE wty.warranty_record_items IS 'Phase 1-11 covered job/part on a warranty record (FR-WTY-002 traceability).';
CREATE INDEX ix_warranty_record_items_record ON wty.warranty_record_items (tenant_id, company_id, branch_id, warranty_record_id);
CREATE TRIGGER tg_warranty_record_items_touch_metadata BEFORE UPDATE ON wty.warranty_record_items FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_warranty_record_items_immutable BEFORE UPDATE ON wty.warranty_record_items
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'warranty_record_id', 'created_at', 'created_by');
ALTER TABLE wty.warranty_record_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE wty.warranty_record_items FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_warranty_record_items_scope ON wty.warranty_record_items FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_warranty_record_items_scope ON wty.warranty_record_items FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_warranty_record_items_scope ON wty.warranty_record_items FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
GRANT SELECT, INSERT, UPDATE ON wty.warranty_record_items TO app_runtime;
GRANT SELECT ON wty.warranty_record_items TO app_readonly;

-- ----------------------------------------------------------------------------
-- 5. wty.warranty_status_history — append-only
-- ----------------------------------------------------------------------------
CREATE TABLE wty.warranty_status_history (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  company_id         uuid NOT NULL,
  branch_id          uuid NOT NULL,
  warranty_record_id uuid NOT NULL,
  from_status        text NULL,
  to_status          text NOT NULL,
  reason             text NULL,
  correlation_id     uuid NULL,
  actor_id           uuid NOT NULL,
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  seq                bigint GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT pk_warranty_status_history PRIMARY KEY (id),
  CONSTRAINT fk_warranty_status_history_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_warranty_status_history_record FOREIGN KEY (tenant_id, company_id, branch_id, warranty_record_id)
    REFERENCES wty.warranty_records (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_warranty_status_history_to_status CHECK (to_status IN ('issued', 'active', 'expired', 'voided', 'claimed_against'))
);
COMMENT ON TABLE wty.warranty_status_history IS 'Phase 1-11 append-only warranty status ledger (SELECT+INSERT only). Aligned to the Figure 4.25 claim-history pattern (FR-WTY-003).';
CREATE INDEX ix_warranty_status_history_record ON wty.warranty_status_history (tenant_id, company_id, branch_id, warranty_record_id, occurred_at DESC, seq DESC);
CREATE TRIGGER tg_warranty_status_history_stamp BEFORE INSERT ON wty.warranty_status_history FOR EACH ROW EXECUTE FUNCTION shared.stamp_status_history();
ALTER TABLE wty.warranty_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE wty.warranty_status_history FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_warranty_status_history_scope ON wty.warranty_status_history FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_warranty_status_history_scope ON wty.warranty_status_history FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
GRANT SELECT, INSERT ON wty.warranty_status_history TO app_runtime;
GRANT SELECT ON wty.warranty_status_history TO app_readonly;

-- ----------------------------------------------------------------------------
-- 6. wty.issue_warranty — bind terms to the delivery (M-wty-2), effective-date coverage
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wty.issue_warranty(
  p_delivery_id uuid, p_policy_id uuid, p_correlation_id uuid DEFAULT NULL, p_idempotency_key text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_del sal.delivery_records%ROWTYPE; v_actor uuid := iam.current_user_id(); v_tenant uuid := iam.current_tenant_id();
  v_start date; v_odo integer; v_cov wty.warranty_coverage%ROWTYPE; v_id uuid; v_existing uuid;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM wty.warranty_records WHERE tenant_id = v_tenant AND idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;
  SELECT * INTO v_del FROM sal.delivery_records WHERE id = p_delivery_id AND tenant_id = v_tenant AND status = 'delivered';
  IF NOT FOUND THEN RAISE EXCEPTION 'wty.issue_warranty: delivery % not found or not delivered', p_delivery_id USING ERRCODE = 'check_violation'; END IF;
  SELECT o.value::integer, v_del.delivered_at::date INTO v_odo, v_start FROM veh.odometer_readings o
    WHERE o.tenant_id = v_del.tenant_id AND o.vehicle_id = v_del.vehicle_id AND o.id = v_del.final_odometer_reading_id;
  IF v_odo IS NULL THEN RAISE EXCEPTION 'wty.issue_warranty: delivery has no final odometer reading' USING ERRCODE = 'check_violation'; END IF;
  -- BR-WTY-001: the coverage effective at the service (delivery) date.
  SELECT * INTO v_cov FROM wty.warranty_coverage
    WHERE tenant_id = v_tenant AND company_id = v_del.company_id AND policy_id = p_policy_id AND status = 'active' AND deleted_at IS NULL
      AND effective_from <= v_start AND (effective_to IS NULL OR effective_to > v_start)
    ORDER BY effective_from DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'wty.issue_warranty: no coverage effective at % for policy %', v_start, p_policy_id USING ERRCODE = 'check_violation'; END IF;
  INSERT INTO wty.warranty_records (tenant_id, company_id, branch_id, vehicle_id, work_order_id, delivery_record_id,
    policy_id, coverage_id, start_date, expiry_date, odometer_at_issue, odometer_limit, status, idempotency_key, created_by)
    VALUES (v_tenant, v_del.company_id, v_del.branch_id, v_del.vehicle_id, v_del.work_order_id, v_del.id,
      p_policy_id, v_cov.id, v_start, (v_start + (v_cov.duration_months || ' months')::interval)::date,
      v_odo, CASE WHEN v_cov.odometer_limit IS NULL THEN NULL ELSE v_odo + v_cov.odometer_limit END,
      'issued', p_idempotency_key, v_actor)
    RETURNING id INTO v_id;
  INSERT INTO wty.warranty_status_history (tenant_id, company_id, branch_id, warranty_record_id, from_status, to_status, correlation_id, actor_id)
    VALUES (v_tenant, v_del.company_id, v_del.branch_id, v_id, NULL, 'issued', p_correlation_id, v_actor);
  RETURN v_id;
END; $$;
REVOKE EXECUTE ON FUNCTION wty.issue_warranty(uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wty.issue_warranty(uuid, uuid, uuid, text) TO app_runtime;
