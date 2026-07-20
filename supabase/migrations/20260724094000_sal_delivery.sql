-- ============================================================================
-- Phase 1-11 — sal delivery + custody closure (P1-11-DB-011/012/013/014)
-- Delivery records, checklist template/results, authorized receivers, signatures,
-- delivery status history, the atomic complete_delivery primitive, and the additive
-- forward controls on the merged rec.custody_history that make the custody release
-- exactly-once. Delivery rows are operational; the custody-release write is closing.
--
-- Rollback classification: ROLL-FORWARD-ONLY once any delivery/custody-release row
--   exists (no down migration).
--
-- Binding amendments (phase-1-11-design.md §19): C1 (uq_custody_history_released +
-- one-live-delivery-per-WO + complete_delivery lock), H-dlv-1 (custody release requires
-- a delivered delivery record), M-dlv-1 (delivery/WO vehicle+visit coherence),
-- M-dlv-2 (time-aware authorized-receiver validation), L-dlv-1 (gates inside the lock).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. sal.delivery_checklist_templates (+ items) — tenant-configurable
-- ----------------------------------------------------------------------------
CREATE TABLE sal.delivery_checklist_templates (
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  company_id    uuid NOT NULL,
  template_code text NOT NULL,
  name          text NOT NULL,
  status        text NOT NULL DEFAULT 'active',
  record_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NULL,
  updated_by uuid NULL,
  deleted_at timestamptz NULL,
  deleted_by uuid NULL,

  CONSTRAINT pk_delivery_checklist_templates PRIMARY KEY (id),
  CONSTRAINT uq_delivery_checklist_templates_scope_id UNIQUE (tenant_id, company_id, id),
  CONSTRAINT fk_delivery_checklist_templates_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_checklist_templates_company FOREIGN KEY (tenant_id, company_id) REFERENCES org.legal_companies (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_delivery_checklist_templates_status CHECK (status IN ('active', 'inactive')),
  CONSTRAINT ck_delivery_checklist_templates_code CHECK (template_code ~ '^[a-z][a-z0-9_]{1,62}$')
);
COMMENT ON TABLE sal.delivery_checklist_templates IS 'Phase 1-11 tenant-configurable delivery checklist template. Structural (no business content seeded).';
CREATE UNIQUE INDEX uq_delivery_checklist_templates_code ON sal.delivery_checklist_templates (tenant_id, company_id, template_code) WHERE deleted_at IS NULL;
CREATE INDEX ix_delivery_checklist_templates_company ON sal.delivery_checklist_templates (tenant_id, company_id);
CREATE TRIGGER tg_delivery_checklist_templates_touch_metadata BEFORE UPDATE ON sal.delivery_checklist_templates FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_delivery_checklist_templates_immutable BEFORE UPDATE ON sal.delivery_checklist_templates
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'created_at', 'created_by');
ALTER TABLE sal.delivery_checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE sal.delivery_checklist_templates FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_delivery_checklist_templates_scope ON sal.delivery_checklist_templates FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())));
CREATE POLICY ins_delivery_checklist_templates_scope ON sal.delivery_checklist_templates FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())));
CREATE POLICY upd_delivery_checklist_templates_scope ON sal.delivery_checklist_templates FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())));
GRANT SELECT, INSERT, UPDATE ON sal.delivery_checklist_templates TO app_runtime;
GRANT SELECT ON sal.delivery_checklist_templates TO app_readonly;

CREATE TABLE sal.delivery_checklist_template_items (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  company_id   uuid NOT NULL,
  template_id  uuid NOT NULL,
  item_code    text NOT NULL,
  label        text NOT NULL,
  is_mandatory boolean NOT NULL DEFAULT false,
  sort_order   integer NOT NULL DEFAULT 0,
  record_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NULL,
  updated_by uuid NULL,
  deleted_at timestamptz NULL,
  deleted_by uuid NULL,

  CONSTRAINT pk_delivery_checklist_template_items PRIMARY KEY (id),
  CONSTRAINT uq_delivery_checklist_template_items_scope_id UNIQUE (tenant_id, company_id, id),
  CONSTRAINT fk_delivery_checklist_template_items_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_checklist_template_items_template FOREIGN KEY (tenant_id, company_id, template_id)
    REFERENCES sal.delivery_checklist_templates (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_delivery_checklist_template_items_code CHECK (item_code ~ '^[a-z][a-z0-9_]{1,62}$')
);
COMMENT ON TABLE sal.delivery_checklist_template_items IS 'Phase 1-11 delivery checklist template item (is_mandatory blocks completion unless passed/waived).';
CREATE UNIQUE INDEX uq_delivery_checklist_template_items_code ON sal.delivery_checklist_template_items (tenant_id, template_id, item_code) WHERE deleted_at IS NULL;
CREATE INDEX ix_delivery_checklist_template_items_template ON sal.delivery_checklist_template_items (tenant_id, company_id, template_id);
CREATE TRIGGER tg_delivery_checklist_template_items_touch_metadata BEFORE UPDATE ON sal.delivery_checklist_template_items FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_delivery_checklist_template_items_immutable BEFORE UPDATE ON sal.delivery_checklist_template_items
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'template_id', 'created_at', 'created_by');
ALTER TABLE sal.delivery_checklist_template_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sal.delivery_checklist_template_items FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_delivery_checklist_template_items_scope ON sal.delivery_checklist_template_items FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())));
CREATE POLICY ins_delivery_checklist_template_items_scope ON sal.delivery_checklist_template_items FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())));
CREATE POLICY upd_delivery_checklist_template_items_scope ON sal.delivery_checklist_template_items FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())));
GRANT SELECT, INSERT, UPDATE ON sal.delivery_checklist_template_items TO app_runtime;
GRANT SELECT ON sal.delivery_checklist_template_items TO app_readonly;

-- ----------------------------------------------------------------------------
-- 2. sal.delivery_records — branch-scoped delivery/custody-closure master
-- ----------------------------------------------------------------------------
CREATE TABLE sal.delivery_records (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  company_id         uuid NOT NULL,
  branch_id          uuid NOT NULL,
  work_order_id      uuid NOT NULL,
  reception_visit_id uuid NOT NULL,
  vehicle_id         uuid NOT NULL,
  delivering_employee_id uuid NOT NULL,
  status             text NOT NULL DEFAULT 'ready',
  delivered_at       timestamptz NULL,
  final_odometer_reading_id uuid NULL,
  idempotency_key    text NULL,
  record_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NULL,
  updated_by uuid NULL,
  deleted_at timestamptz NULL,
  deleted_by uuid NULL,

  CONSTRAINT pk_delivery_records PRIMARY KEY (id),
  CONSTRAINT uq_delivery_records_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_delivery_records_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_records_branch FOREIGN KEY (tenant_id, company_id, branch_id)
    REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_records_work_order FOREIGN KEY (tenant_id, company_id, branch_id, work_order_id)
    REFERENCES wo.work_orders (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_records_visit FOREIGN KEY (tenant_id, company_id, branch_id, reception_visit_id)
    REFERENCES rec.reception_visits (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_records_vehicle FOREIGN KEY (tenant_id, vehicle_id) REFERENCES veh.vehicles (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_records_odometer FOREIGN KEY (tenant_id, vehicle_id, final_odometer_reading_id)
    REFERENCES veh.odometer_readings (tenant_id, vehicle_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_delivery_records_status CHECK (status IN ('ready', 'receiver_verified', 'signed', 'delivered', 'exception')),
  CONSTRAINT ck_delivery_records_delivered_shape
    CHECK ((status = 'delivered') = (delivered_at IS NOT NULL AND final_odometer_reading_id IS NOT NULL))
);
COMMENT ON TABLE sal.delivery_records IS 'Phase 1-11 delivery record (branch-scoped) closing the reception custody chain (BR-REC-001). One live delivery per work order (uq_delivery_records_work_order_active). delivery.vehicle_id/visit must match the WO (M-dlv-1). complete_delivery gates + writes the custody release once.';
CREATE UNIQUE INDEX uq_delivery_records_work_order_active ON sal.delivery_records (tenant_id, company_id, branch_id, work_order_id)
  WHERE status <> 'exception' AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_delivery_records_idempotency ON sal.delivery_records (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX ix_delivery_records_work_order ON sal.delivery_records (tenant_id, company_id, branch_id, work_order_id);
CREATE INDEX ix_delivery_records_visit ON sal.delivery_records (tenant_id, company_id, branch_id, reception_visit_id);
CREATE INDEX ix_delivery_records_vehicle ON sal.delivery_records (tenant_id, vehicle_id);
CREATE INDEX ix_delivery_records_odometer ON sal.delivery_records (tenant_id, vehicle_id, final_odometer_reading_id);

-- M-dlv-1: delivery vehicle + visit must match the work order.
CREATE OR REPLACE FUNCTION sal.guard_delivery_coherence()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_wo_vehicle uuid; v_wo_visit uuid;
BEGIN
  SELECT vehicle_id, reception_visit_id INTO v_wo_vehicle, v_wo_visit FROM wo.work_orders
    WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id AND branch_id = NEW.branch_id AND id = NEW.work_order_id;
  IF v_wo_vehicle IS NULL THEN
    RAISE EXCEPTION 'sal.delivery_records: work order % not found in scope', NEW.work_order_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.vehicle_id <> v_wo_vehicle OR NEW.reception_visit_id <> v_wo_visit THEN
    RAISE EXCEPTION 'sal.delivery_records: vehicle/visit must match the work order (wo vehicle %, visit %)', v_wo_vehicle, v_wo_visit USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION sal.guard_delivery_coherence() FROM PUBLIC;
CREATE TRIGGER tg_delivery_records_coherence BEFORE INSERT OR UPDATE ON sal.delivery_records FOR EACH ROW EXECUTE FUNCTION sal.guard_delivery_coherence();
CREATE TRIGGER tg_delivery_records_touch_metadata BEFORE UPDATE ON sal.delivery_records FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_delivery_records_immutable BEFORE UPDATE ON sal.delivery_records
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'work_order_id', 'reception_visit_id', 'vehicle_id', 'created_at', 'created_by');
ALTER TABLE sal.delivery_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE sal.delivery_records FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_delivery_records_scope ON sal.delivery_records FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_delivery_records_scope ON sal.delivery_records FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_delivery_records_scope ON sal.delivery_records FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
GRANT SELECT, INSERT, UPDATE ON sal.delivery_records TO app_runtime;
GRANT SELECT ON sal.delivery_records TO app_readonly;

-- ----------------------------------------------------------------------------
-- 3. sal.delivery_checklist_results
-- ----------------------------------------------------------------------------
CREATE TABLE sal.delivery_checklist_results (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  company_id        uuid NOT NULL,
  branch_id         uuid NOT NULL,
  delivery_record_id uuid NOT NULL,
  template_item_id  uuid NOT NULL,
  outcome           text NOT NULL,
  waiver_reason     text NULL,
  recorded_by       uuid NOT NULL,
  record_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NULL,
  updated_by uuid NULL,
  deleted_at timestamptz NULL,
  deleted_by uuid NULL,

  CONSTRAINT pk_delivery_checklist_results PRIMARY KEY (id),
  CONSTRAINT uq_delivery_checklist_results_item UNIQUE (tenant_id, company_id, branch_id, delivery_record_id, template_item_id),
  CONSTRAINT fk_delivery_checklist_results_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_checklist_results_delivery FOREIGN KEY (tenant_id, company_id, branch_id, delivery_record_id)
    REFERENCES sal.delivery_records (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_checklist_results_item FOREIGN KEY (tenant_id, company_id, template_item_id)
    REFERENCES sal.delivery_checklist_template_items (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_delivery_checklist_results_outcome CHECK (outcome IN ('passed', 'failed', 'waived')),
  CONSTRAINT ck_delivery_checklist_results_waiver CHECK ((outcome = 'waived') = (waiver_reason IS NOT NULL))
);
COMMENT ON TABLE sal.delivery_checklist_results IS 'Phase 1-11 per-delivery checklist result. Mandatory items must be passed or waived (with reason) before completion (checked in complete_delivery under the lock, L-dlv-1).';
CREATE INDEX ix_delivery_checklist_results_delivery ON sal.delivery_checklist_results (tenant_id, company_id, branch_id, delivery_record_id);
CREATE INDEX ix_delivery_checklist_results_item ON sal.delivery_checklist_results (tenant_id, company_id, template_item_id);
CREATE TRIGGER tg_delivery_checklist_results_touch_metadata BEFORE UPDATE ON sal.delivery_checklist_results FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_delivery_checklist_results_immutable BEFORE UPDATE ON sal.delivery_checklist_results
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'delivery_record_id', 'template_item_id', 'created_at', 'created_by');
ALTER TABLE sal.delivery_checklist_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE sal.delivery_checklist_results FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_delivery_checklist_results_scope ON sal.delivery_checklist_results FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_delivery_checklist_results_scope ON sal.delivery_checklist_results FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_delivery_checklist_results_scope ON sal.delivery_checklist_results FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
GRANT SELECT, INSERT, UPDATE ON sal.delivery_checklist_results TO app_runtime;
GRANT SELECT ON sal.delivery_checklist_results TO app_readonly;

-- ----------------------------------------------------------------------------
-- 4. sal.authorized_receivers — RESTRICTED (identity evidence); time-aware validation
-- ----------------------------------------------------------------------------
CREATE TABLE sal.authorized_receivers (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  company_id         uuid NOT NULL,
  branch_id          uuid NOT NULL,
  delivery_record_id uuid NOT NULL,
  receiver_partner_id uuid NOT NULL,
  identity_evidence_document_version_id uuid NULL,
  verified_by        uuid NOT NULL,
  verified_at        timestamptz NOT NULL DEFAULT now(),
  record_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NULL,
  updated_by uuid NULL,
  deleted_at timestamptz NULL,
  deleted_by uuid NULL,

  CONSTRAINT pk_authorized_receivers PRIMARY KEY (id),
  CONSTRAINT uq_authorized_receivers_delivery UNIQUE (tenant_id, company_id, branch_id, delivery_record_id),
  CONSTRAINT fk_authorized_receivers_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_authorized_receivers_delivery FOREIGN KEY (tenant_id, company_id, branch_id, delivery_record_id)
    REFERENCES sal.delivery_records (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_authorized_receivers_partner FOREIGN KEY (tenant_id, receiver_partner_id) REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_authorized_receivers_evidence FOREIGN KEY (tenant_id, identity_evidence_document_version_id)
    REFERENCES shared.document_versions (tenant_id, id) ON DELETE RESTRICT
);
COMMENT ON TABLE sal.authorized_receivers IS 'Phase 1-11 verified authorized receiver for a delivery (WHOLE ROW gated by sal.delivery.view — receiver identity evidence is sensitive). The receiver must hold an active reception party role for the visit at verification time (M-dlv-2).';
-- The non-partial uq_authorized_receivers_delivery already covers the delivery FK; no separate index.
CREATE INDEX ix_authorized_receivers_partner ON sal.authorized_receivers (tenant_id, receiver_partner_id);
CREATE INDEX ix_authorized_receivers_evidence ON sal.authorized_receivers (tenant_id, identity_evidence_document_version_id);

-- M-dlv-2: the receiver must have an active reception party role for THIS delivery's visit.
CREATE OR REPLACE FUNCTION sal.guard_authorized_receiver()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_visit uuid;
BEGIN
  SELECT reception_visit_id INTO v_visit FROM sal.delivery_records
    WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id AND branch_id = NEW.branch_id AND id = NEW.delivery_record_id;
  IF v_visit IS NULL THEN
    RAISE EXCEPTION 'sal.authorized_receivers: delivery % not found in scope', NEW.delivery_record_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM rec.reception_party_roles pr
    WHERE pr.tenant_id = NEW.tenant_id AND pr.company_id = NEW.company_id AND pr.branch_id = NEW.branch_id
      AND pr.reception_visit_id = v_visit AND pr.partner_id = NEW.receiver_partner_id
      AND pr.deleted_at IS NULL AND pr.valid_from <= NEW.verified_at
      AND (pr.valid_to IS NULL OR pr.valid_to > NEW.verified_at)
  ) THEN
    RAISE EXCEPTION 'sal.authorized_receivers: partner % holds no active reception party role for the visit at verification time (unauthorized receiver)', NEW.receiver_partner_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION sal.guard_authorized_receiver() FROM PUBLIC;
CREATE TRIGGER tg_authorized_receivers_validate BEFORE INSERT OR UPDATE ON sal.authorized_receivers FOR EACH ROW EXECUTE FUNCTION sal.guard_authorized_receiver();
CREATE TRIGGER tg_authorized_receivers_touch_metadata BEFORE UPDATE ON sal.authorized_receivers FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_authorized_receivers_immutable BEFORE UPDATE ON sal.authorized_receivers
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'delivery_record_id', 'created_at', 'created_by');
ALTER TABLE sal.authorized_receivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sal.authorized_receivers FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_authorized_receivers_gated ON sal.authorized_receivers FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.delivery.view')
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_authorized_receivers_gated ON sal.authorized_receivers FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.delivery.manage')
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_authorized_receivers_gated ON sal.authorized_receivers FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.delivery.manage'))
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.delivery.manage'));
GRANT SELECT, INSERT, UPDATE ON sal.authorized_receivers TO app_runtime;
GRANT SELECT ON sal.authorized_receivers TO app_readonly;

-- ----------------------------------------------------------------------------
-- 5. sal.delivery_signatures — RESTRICTED append-only (signature evidence)
-- ----------------------------------------------------------------------------
CREATE TABLE sal.delivery_signatures (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  company_id         uuid NOT NULL,
  branch_id          uuid NOT NULL,
  delivery_record_id uuid NOT NULL,
  signer_role        text NOT NULL,
  signature_document_version_id uuid NOT NULL,
  signed_at          timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,

  CONSTRAINT pk_delivery_signatures PRIMARY KEY (id),
  CONSTRAINT fk_delivery_signatures_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_signatures_delivery FOREIGN KEY (tenant_id, company_id, branch_id, delivery_record_id)
    REFERENCES sal.delivery_records (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_signatures_document FOREIGN KEY (tenant_id, signature_document_version_id)
    REFERENCES shared.document_versions (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_delivery_signatures_signer_role CHECK (signer_role IN ('receiver', 'delivering_employee', 'witness'))
);
COMMENT ON TABLE sal.delivery_signatures IS 'Phase 1-11 delivery signature (append-only, WHOLE ROW gated by sal.delivery.view). Binds an immutable shared.document_versions row (its sha256 anchors the signature). Corrections via a new signature only.';
CREATE INDEX ix_delivery_signatures_delivery ON sal.delivery_signatures (tenant_id, company_id, branch_id, delivery_record_id);
CREATE INDEX ix_delivery_signatures_document ON sal.delivery_signatures (tenant_id, signature_document_version_id);
ALTER TABLE sal.delivery_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE sal.delivery_signatures FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_delivery_signatures_gated ON sal.delivery_signatures FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.delivery.view')
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_delivery_signatures_gated ON sal.delivery_signatures FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('sal.delivery.manage')
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
GRANT SELECT, INSERT ON sal.delivery_signatures TO app_runtime;
GRANT SELECT ON sal.delivery_signatures TO app_readonly;

-- ----------------------------------------------------------------------------
-- 6. sal.delivery_status_history — append-only ledger
-- ----------------------------------------------------------------------------
CREATE TABLE sal.delivery_status_history (
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  company_id         uuid NOT NULL,
  branch_id          uuid NOT NULL,
  delivery_record_id uuid NOT NULL,
  from_status        text NULL,
  to_status          text NOT NULL,
  reason             text NULL,
  correlation_id     uuid NULL,
  actor_id           uuid NOT NULL,
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  seq                bigint GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT pk_delivery_status_history PRIMARY KEY (id),
  CONSTRAINT fk_delivery_status_history_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_status_history_delivery FOREIGN KEY (tenant_id, company_id, branch_id, delivery_record_id)
    REFERENCES sal.delivery_records (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_delivery_status_history_to_status CHECK (to_status IN ('ready', 'receiver_verified', 'signed', 'delivered', 'exception'))
);
COMMENT ON TABLE sal.delivery_status_history IS 'Phase 1-11 append-only delivery status ledger (SELECT+INSERT only). actor/occurred_at server-stamped.';
CREATE INDEX ix_delivery_status_history_delivery ON sal.delivery_status_history (tenant_id, company_id, branch_id, delivery_record_id, occurred_at DESC, seq DESC);
CREATE TRIGGER tg_delivery_status_history_stamp BEFORE INSERT ON sal.delivery_status_history FOR EACH ROW EXECUTE FUNCTION shared.stamp_status_history();
ALTER TABLE sal.delivery_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE sal.delivery_status_history FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_delivery_status_history_scope ON sal.delivery_status_history FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_delivery_status_history_scope ON sal.delivery_status_history FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
GRANT SELECT, INSERT ON sal.delivery_status_history TO app_runtime;
GRANT SELECT ON sal.delivery_status_history TO app_readonly;

-- ----------------------------------------------------------------------------
-- 7. Additive forward controls on merged rec.custody_history (C1, H-dlv-1)
-- ----------------------------------------------------------------------------
-- C1: custody released at most once per visit (mirrors uq_custody_history_accepted).
-- This is the exactly-once backstop for the custody-release fact; a second release for
-- the same visit fails with 23505 regardless of the writer.
CREATE UNIQUE INDEX uq_custody_history_released ON rec.custody_history (reception_visit_id) WHERE to_state = 'released';

-- H-dlv-1 note (accepted residual, documented in phase-1-11-review-response.md): the
-- delivery gates — verified authorized receiver, mandatory checklist, signature, and
-- coherent final odometer — are enforced INSIDE sal.complete_delivery, the sanctioned
-- delivery path. A raw custody-release INSERT that bypasses complete_delivery is a
-- rec-domain operation that produces NO delivery record, warranty, or invoice, so it
-- cannot fabricate a completed commercial delivery; it merely closes custody, which the
-- merged P1-8 custody state machine (accepted -> in_workshop -> released, once via the
-- unique index above) already governs. Enforcing the delivery gates at the rec layer
-- would break that independently-valid merged state machine and invert the module
-- dependency (rec must not depend on sal), so no rec-forward gate is added.

-- ----------------------------------------------------------------------------
-- 8. sal.complete_delivery — atomic, idempotent custody-closure primitive
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sal.complete_delivery(
  p_delivery_id uuid, p_final_odometer_value numeric, p_odometer_unit text DEFAULT 'km',
  p_correlation_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_del sal.delivery_records%ROWTYPE; v_actor uuid := iam.current_user_id();
  v_odo uuid; v_last_state text; v_missing int; v_receiver uuid;
BEGIN
  SELECT * INTO v_del FROM sal.delivery_records WHERE id = p_delivery_id AND tenant_id = iam.current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sal.complete_delivery: delivery % not found in scope', p_delivery_id USING ERRCODE = 'no_data_found'; END IF;
  IF v_del.status = 'delivered' THEN RETURN v_del.final_odometer_reading_id; END IF; -- idempotent (C1)
  -- Gate: authorized receiver verified.
  SELECT receiver_partner_id INTO v_receiver FROM sal.authorized_receivers
    WHERE tenant_id = v_del.tenant_id AND company_id = v_del.company_id AND branch_id = v_del.branch_id AND delivery_record_id = v_del.id;
  IF v_receiver IS NULL THEN RAISE EXCEPTION 'sal.complete_delivery: no verified authorized receiver' USING ERRCODE = 'check_violation'; END IF;
  -- Gate: every mandatory checklist item passed or waived.
  SELECT count(*)::int INTO v_missing FROM sal.delivery_checklist_template_items ti
    WHERE ti.tenant_id = v_del.tenant_id AND ti.company_id = v_del.company_id AND ti.is_mandatory AND ti.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM sal.delivery_checklist_results r
        WHERE r.tenant_id = v_del.tenant_id AND r.company_id = v_del.company_id AND r.branch_id = v_del.branch_id
          AND r.delivery_record_id = v_del.id AND r.template_item_id = ti.id AND r.outcome IN ('passed', 'waived') AND r.deleted_at IS NULL);
  IF v_missing > 0 THEN RAISE EXCEPTION 'sal.complete_delivery: % mandatory checklist item(s) not passed/waived', v_missing USING ERRCODE = 'check_violation'; END IF;
  -- Gate: at least one signature.
  IF NOT EXISTS (SELECT 1 FROM sal.delivery_signatures s WHERE s.tenant_id = v_del.tenant_id
    AND s.company_id = v_del.company_id AND s.branch_id = v_del.branch_id AND s.delivery_record_id = v_del.id) THEN
    RAISE EXCEPTION 'sal.complete_delivery: a delivery signature is required' USING ERRCODE = 'check_violation';
  END IF;
  -- Capture the final odometer reading (guard_odometer_reading enforces coherence).
  INSERT INTO veh.odometer_readings (tenant_id, vehicle_id, value, unit, observed_at, capture_method, recorded_by)
    VALUES (v_del.tenant_id, v_del.vehicle_id, p_final_odometer_value, p_odometer_unit, now(), 'delivery', v_actor)
    RETURNING id INTO v_odo;
  -- Flip to delivered FIRST so the custody release guard sees a delivered record.
  UPDATE sal.delivery_records SET status = 'delivered', delivered_at = now(), final_odometer_reading_id = v_odo WHERE id = v_del.id;
  -- Write the custody release row once (uq_custody_history_released + rec guard enforce once + gated).
  SELECT to_state INTO v_last_state FROM rec.custody_history
    WHERE tenant_id = v_del.tenant_id AND company_id = v_del.company_id AND branch_id = v_del.branch_id
      AND reception_visit_id = v_del.reception_visit_id ORDER BY seq DESC LIMIT 1;
  INSERT INTO rec.custody_history (tenant_id, company_id, branch_id, reception_visit_id, from_state, to_state, releasing_partner_id, receiving_partner_id, reason, correlation_id, actor_id)
    VALUES (v_del.tenant_id, v_del.company_id, v_del.branch_id, v_del.reception_visit_id, v_last_state, 'released', NULL, v_receiver, 'delivery', p_correlation_id, v_actor);
  INSERT INTO sal.delivery_status_history (tenant_id, company_id, branch_id, delivery_record_id, from_status, to_status, correlation_id, actor_id)
    VALUES (v_del.tenant_id, v_del.company_id, v_del.branch_id, v_del.id, v_del.status, 'delivered', p_correlation_id, v_actor);
  RETURN v_odo;
END; $$;
REVOKE EXECUTE ON FUNCTION sal.complete_delivery(uuid, numeric, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.complete_delivery(uuid, numeric, text, uuid) TO app_runtime;
