-- ============================================================================
-- Phase: 1-10 — Service Catalog, Pricing, Quotation, and Inventory Database
-- Migration: quotations — masters, revisions, items, decisions, evidence, history
-- Tasks: P1-10-DB (quo); FR-QUO-001/002/003/004, BR-QUO-001/002
-- Owner module: quo
--
-- Rollback classification: roll-forward-only once quotations exist.
--
-- Purpose
--   Customer quotations originating from a Phase 1-9 work order. Immutable numbered
--   revisions with captured commercial amounts (a later price change never alters an
--   issued quotation), item-level append-only approval decisions bound to the exact
--   revision and item, evidence, and an append-only status ledger.
--
-- Design gate amendments: single-issued invariant (H3), issue-time totals recompute
--   + zero-item ban + deferred totals-identity trigger (H4/H13), composite decision->
--   item FK (H5), append-only + one-decision-per-item (H6), currency coherence (H12),
--   INSERT/UPDATE/DELETE item freeze (H13), document-bound evidence, branch-scoped
--   quotation-number uniqueness.
--
-- Dependencies
--   wo.work_orders; svc.services; inv.item_master; shared.currencies;
--   shared.document_versions; shared.stamp_status_history; shared.touch_row_metadata;
--   org.guard_immutable_columns; iam.*.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. quo.quotations — master.
-- ----------------------------------------------------------------------------
CREATE TABLE quo.quotations (
  id                  uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid    NOT NULL,
  company_id          uuid    NOT NULL,
  branch_id           uuid    NOT NULL,
  work_order_id       uuid    NOT NULL,
  quotation_number    text    NOT NULL,
  currency_code       text    NOT NULL,
  payer_partner_ref   uuid    NULL,
  current_revision_id uuid    NULL,
  status              text    NOT NULL DEFAULT 'draft',
  record_version      integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid    NOT NULL,
  updated_at          timestamptz NULL,
  updated_by          uuid    NULL,
  deleted_at          timestamptz NULL,
  deleted_by          uuid    NULL,

  CONSTRAINT pk_quotations PRIMARY KEY (id),
  CONSTRAINT uq_quotations_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_quotations_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_quotations_work_order FOREIGN KEY (tenant_id, company_id, branch_id, work_order_id) REFERENCES wo.work_orders (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_quotations_currency FOREIGN KEY (currency_code) REFERENCES shared.currencies (code) ON DELETE RESTRICT,
  CONSTRAINT ck_quotations_number_not_blank CHECK (btrim(quotation_number) <> ''),
  CONSTRAINT ck_quotations_status CHECK (status IN ('draft', 'active', 'accepted', 'rejected', 'expired', 'cancelled'))
);
COMMENT ON TABLE quo.quotations IS 'Phase 1-10 quotation master (originates from a Phase 1-9 work order). quotation_number allocated by shared.next_display_number(''quotation'', company, branch). Branch-scoped uniqueness.';
CREATE UNIQUE INDEX uq_quotations_number ON quo.quotations (tenant_id, company_id, branch_id, quotation_number) WHERE deleted_at IS NULL;
CREATE INDEX ix_quotations_branch ON quo.quotations (tenant_id, company_id, branch_id);
CREATE INDEX ix_quotations_work_order ON quo.quotations (tenant_id, company_id, branch_id, work_order_id);
CREATE INDEX ix_quotations_currency ON quo.quotations (currency_code);
CREATE TRIGGER tg_quotations_touch_metadata BEFORE UPDATE ON quo.quotations
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_quotations_immutable BEFORE UPDATE ON quo.quotations
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'work_order_id', 'quotation_number', 'currency_code', 'created_at', 'created_by');
ALTER TABLE quo.quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE quo.quotations FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_quotations_scope ON quo.quotations FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_quotations_scope ON quo.quotations FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_quotations_scope ON quo.quotations FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON quo.quotations TO app_runtime;
GRANT SELECT ON quo.quotations TO app_readonly;

-- ----------------------------------------------------------------------------
-- 2. quo.quotation_revisions — immutable numbered revisions.
-- ----------------------------------------------------------------------------
CREATE TABLE quo.quotation_revisions (
  id                     uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id              uuid    NOT NULL,
  company_id             uuid    NOT NULL,
  branch_id              uuid    NOT NULL,
  quotation_id           uuid    NOT NULL,
  revision_number        integer NOT NULL,
  status                 text    NOT NULL DEFAULT 'draft',
  currency_code          text    NOT NULL,
  issued_at              timestamptz NULL,
  expires_at             timestamptz NULL,
  captured_subtotal      numeric(18, 4) NOT NULL DEFAULT 0,
  captured_discount_total numeric(18, 4) NOT NULL DEFAULT 0,
  captured_tax_total     numeric(18, 4) NOT NULL DEFAULT 0,
  captured_grand_total   numeric(18, 4) NOT NULL DEFAULT 0,
  record_version         integer NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid    NOT NULL,
  updated_at             timestamptz NULL,
  updated_by             uuid    NULL,
  deleted_at             timestamptz NULL,
  deleted_by             uuid    NULL,

  CONSTRAINT pk_quotation_revisions PRIMARY KEY (id),
  CONSTRAINT uq_quotation_revisions_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT uq_quotation_revisions_number UNIQUE (tenant_id, company_id, branch_id, quotation_id, revision_number),
  CONSTRAINT fk_quotation_revisions_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_quotation_revisions_quotation FOREIGN KEY (tenant_id, company_id, branch_id, quotation_id) REFERENCES quo.quotations (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_quotation_revisions_currency FOREIGN KEY (currency_code) REFERENCES shared.currencies (code) ON DELETE RESTRICT,
  CONSTRAINT ck_quotation_revisions_number CHECK (revision_number > 0),
  CONSTRAINT ck_quotation_revisions_status CHECK (status IN ('draft', 'issued', 'superseded', 'rejected', 'expired')),
  CONSTRAINT ck_quotation_revisions_issued CHECK ((status = 'draft') OR (issued_at IS NOT NULL)),
  CONSTRAINT ck_quotation_revisions_totals CHECK (captured_grand_total = captured_subtotal - captured_discount_total + captured_tax_total),
  CONSTRAINT ck_quotation_revisions_nonneg CHECK (captured_subtotal >= 0 AND captured_discount_total >= 0 AND captured_tax_total >= 0 AND captured_grand_total >= 0)
);
COMMENT ON TABLE quo.quotation_revisions IS 'Phase 1-10 immutable numbered quotation revisions (FR-QUO-001). At most one issued revision per quotation. Frozen once issued; captured totals reproduce the item lines.';
-- single issued revision per quotation (H3)
CREATE UNIQUE INDEX uq_quotation_revisions_one_issued ON quo.quotation_revisions (tenant_id, quotation_id) WHERE status = 'issued' AND deleted_at IS NULL;
CREATE INDEX ix_quotation_revisions_quotation ON quo.quotation_revisions (tenant_id, company_id, branch_id, quotation_id);
CREATE INDEX ix_quotation_revisions_currency ON quo.quotation_revisions (currency_code);
CREATE TRIGGER tg_quotation_revisions_touch_metadata BEFORE UPDATE ON quo.quotation_revisions
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_quotation_revisions_immutable BEFORE UPDATE ON quo.quotation_revisions
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'quotation_id', 'revision_number', 'currency_code', 'created_at', 'created_by');
ALTER TABLE quo.quotation_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE quo.quotation_revisions FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_quotation_revisions_scope ON quo.quotation_revisions FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_quotation_revisions_scope ON quo.quotation_revisions FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_quotation_revisions_scope ON quo.quotation_revisions FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON quo.quotation_revisions TO app_runtime;
GRANT SELECT ON quo.quotation_revisions TO app_readonly;

-- ----------------------------------------------------------------------------
-- 3. quo.quotation_items — captured lines (frozen once revision issued).
-- ----------------------------------------------------------------------------
CREATE TABLE quo.quotation_items (
  id                       uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id                uuid    NOT NULL,
  company_id               uuid    NOT NULL,
  branch_id                uuid    NOT NULL,
  quotation_revision_id    uuid    NOT NULL,
  line_number              integer NOT NULL,
  item_kind                text    NOT NULL,
  service_id               uuid    NULL,
  item_ref                 uuid    NULL,
  source_service_line_ref  uuid    NULL,
  source_required_part_ref uuid    NULL,
  price_rule_ref           uuid    NULL,
  description              text    NULL,
  currency_code            text    NOT NULL,
  captured_unit_price      numeric(18, 4) NOT NULL,
  captured_quantity        numeric(12, 3) NOT NULL,
  captured_discount        numeric(18, 4) NOT NULL DEFAULT 0,
  captured_tax_rate        numeric(9, 6)  NOT NULL DEFAULT 0,
  captured_tax_amount      numeric(18, 4) NOT NULL,
  captured_line_total      numeric(18, 4) NOT NULL,
  record_version           integer NOT NULL DEFAULT 1,
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid    NOT NULL,
  updated_at               timestamptz NULL,
  updated_by               uuid    NULL,
  deleted_at               timestamptz NULL,
  deleted_by               uuid    NULL,

  CONSTRAINT pk_quotation_items PRIMARY KEY (id),
  CONSTRAINT uq_quotation_items_decision_key UNIQUE (tenant_id, company_id, branch_id, quotation_revision_id, id),
  CONSTRAINT uq_quotation_items_line UNIQUE (tenant_id, company_id, branch_id, quotation_revision_id, line_number),
  CONSTRAINT fk_quotation_items_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_quotation_items_revision FOREIGN KEY (tenant_id, company_id, branch_id, quotation_revision_id) REFERENCES quo.quotation_revisions (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_quotation_items_service FOREIGN KEY (tenant_id, service_id) REFERENCES svc.services (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_quotation_items_item FOREIGN KEY (tenant_id, item_ref) REFERENCES inv.item_master (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_quotation_items_currency FOREIGN KEY (currency_code) REFERENCES shared.currencies (code) ON DELETE RESTRICT,
  CONSTRAINT ck_quotation_items_kind CHECK (item_kind IN ('service', 'part')),
  CONSTRAINT ck_quotation_items_target CHECK (service_id IS NOT NULL OR item_ref IS NOT NULL OR description IS NOT NULL),
  CONSTRAINT ck_quotation_items_line_number CHECK (line_number > 0),
  CONSTRAINT ck_quotation_items_unit_price CHECK (captured_unit_price >= 0),
  CONSTRAINT ck_quotation_items_quantity CHECK (captured_quantity > 0),
  CONSTRAINT ck_quotation_items_discount CHECK (captured_discount >= 0 AND captured_discount <= captured_unit_price * captured_quantity),
  CONSTRAINT ck_quotation_items_tax_rate CHECK (captured_tax_rate >= 0 AND captured_tax_rate <= 1),
  CONSTRAINT ck_quotation_items_tax_amount CHECK (captured_tax_amount = round((captured_unit_price * captured_quantity - captured_discount) * captured_tax_rate, 4)),
  CONSTRAINT ck_quotation_items_line_total CHECK (captured_line_total = round(captured_unit_price * captured_quantity - captured_discount + captured_tax_amount, 4)),
  CONSTRAINT ck_quotation_items_line_total_nonneg CHECK (captured_line_total >= 0)
);
COMMENT ON TABLE quo.quotation_items IS 'Phase 1-10 captured quotation lines. Per-line arithmetic is CHECK-enforced (line_total = round(unit*qty - discount + tax, 4)); currency matches the revision; frozen once the revision is issued.';
CREATE INDEX ix_quotation_items_revision ON quo.quotation_items (tenant_id, company_id, branch_id, quotation_revision_id);
CREATE INDEX ix_quotation_items_service ON quo.quotation_items (tenant_id, service_id);
CREATE INDEX ix_quotation_items_item ON quo.quotation_items (tenant_id, item_ref);
CREATE INDEX ix_quotation_items_currency ON quo.quotation_items (currency_code);

CREATE OR REPLACE FUNCTION quo.guard_quotation_item()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_status text; v_currency text; v_tenant uuid; v_rev uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN v_tenant := OLD.tenant_id; v_rev := OLD.quotation_revision_id;
  ELSE v_tenant := NEW.tenant_id; v_rev := NEW.quotation_revision_id; END IF;
  SELECT status, currency_code INTO v_status, v_currency FROM quo.quotation_revisions WHERE tenant_id = v_tenant AND id = v_rev;
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'quo.quotation_items: parent revision is % and frozen', COALESCE(v_status, 'missing') USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP <> 'DELETE' AND NEW.currency_code <> v_currency THEN
    RAISE EXCEPTION 'quo.quotation_items: currency % must match the revision currency %', NEW.currency_code, v_currency USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
REVOKE EXECUTE ON FUNCTION quo.guard_quotation_item() FROM PUBLIC;

-- Fires on INSERT/UPDATE only: app_runtime holds no DELETE grant on quotation
-- items, so a frozen (issued-revision) line cannot be removed by the runtime; the
-- admin/owner cascade (teardown, migrations) must remain able to delete.
CREATE TRIGGER tg_quotation_items_guard BEFORE INSERT OR UPDATE ON quo.quotation_items
  FOR EACH ROW EXECUTE FUNCTION quo.guard_quotation_item();
CREATE TRIGGER tg_quotation_items_touch_metadata BEFORE UPDATE ON quo.quotation_items
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_quotation_items_immutable BEFORE UPDATE ON quo.quotation_items
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'quotation_revision_id', 'created_at', 'created_by');
ALTER TABLE quo.quotation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE quo.quotation_items FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_quotation_items_scope ON quo.quotation_items FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_quotation_items_scope ON quo.quotation_items FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_quotation_items_scope ON quo.quotation_items FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON quo.quotation_items TO app_runtime;
GRANT SELECT ON quo.quotation_items TO app_readonly;

-- Deferred totals-identity: an issued revision's captured totals must equal its items.
CREATE OR REPLACE FUNCTION quo.guard_revision_totals()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid; v_rev uuid; v_status text;
        v_sub numeric(18,4); v_disc numeric(18,4); v_tax numeric(18,4); v_grand numeric(18,4);
        a_sub numeric(18,4); a_disc numeric(18,4); a_tax numeric(18,4); a_grand numeric(18,4);
BEGIN
  IF TG_OP = 'DELETE' THEN v_tenant := OLD.tenant_id; v_rev := OLD.quotation_revision_id;
  ELSE v_tenant := NEW.tenant_id; v_rev := NEW.quotation_revision_id; END IF;
  SELECT status, captured_subtotal, captured_discount_total, captured_tax_total, captured_grand_total
    INTO v_status, v_sub, v_disc, v_tax, v_grand
    FROM quo.quotation_revisions WHERE tenant_id = v_tenant AND id = v_rev;
  IF v_status IS DISTINCT FROM 'issued' THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(captured_unit_price * captured_quantity), 0), COALESCE(SUM(captured_discount), 0),
         COALESCE(SUM(captured_tax_amount), 0), COALESCE(SUM(captured_line_total), 0)
    INTO a_sub, a_disc, a_tax, a_grand
    FROM quo.quotation_items WHERE tenant_id = v_tenant AND quotation_revision_id = v_rev AND deleted_at IS NULL;
  -- An issued revision always has >= 1 item (issue_revision forbids zero); a live
  -- sum of zero means the revision's items are being torn down (cascade/migration),
  -- so skip the identity check rather than block a legitimate teardown.
  IF a_grand = 0 THEN RETURN NULL; END IF;
  IF v_sub <> a_sub OR v_disc <> a_disc OR v_tax <> a_tax OR v_grand <> a_grand THEN
    RAISE EXCEPTION 'quo: issued revision % totals do not reconcile with its items', v_rev USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END; $$;
REVOKE EXECUTE ON FUNCTION quo.guard_revision_totals() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER tg_quotation_items_totals AFTER INSERT OR UPDATE OR DELETE ON quo.quotation_items
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION quo.guard_revision_totals();

-- ----------------------------------------------------------------------------
-- 4. quo.approval_decisions — append-only, item-granular (BR-QUO-001/002).
-- ----------------------------------------------------------------------------
CREATE TABLE quo.approval_decisions (
  id                    uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id             uuid    NOT NULL,
  company_id            uuid    NOT NULL,
  branch_id             uuid    NOT NULL,
  quotation_revision_id uuid    NOT NULL,
  quotation_item_id     uuid    NOT NULL,
  decision              text    NOT NULL,
  decided_by            uuid    NOT NULL,
  decision_channel      text    NOT NULL,
  decided_at            timestamptz NOT NULL DEFAULT now(),
  evidence_ref          uuid    NULL,
  seq                   bigint  GENERATED ALWAYS AS IDENTITY,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid    NOT NULL,

  CONSTRAINT pk_approval_decisions PRIMARY KEY (id),
  CONSTRAINT fk_approval_decisions_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_approval_decisions_item FOREIGN KEY (tenant_id, company_id, branch_id, quotation_revision_id, quotation_item_id)
    REFERENCES quo.quotation_items (tenant_id, company_id, branch_id, quotation_revision_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_approval_decisions_decision CHECK (decision IN ('approved', 'rejected')),
  CONSTRAINT ck_approval_decisions_channel CHECK (decision_channel IN ('in_person', 'phone', 'portal', 'email', 'system'))
);
COMMENT ON TABLE quo.approval_decisions IS 'Phase 1-10 append-only, item-granular approval decision bound to the EXACT revision and item (BR-QUO-001). One authoritative decision per revision-item; a change of mind requires a new revision (BR-QUO-002).';
CREATE UNIQUE INDEX uq_approval_decisions_item ON quo.approval_decisions (tenant_id, company_id, branch_id, quotation_revision_id, quotation_item_id);
-- decided_by / decided_at are set explicitly by quo.record_item_decision; the
-- append-only ledger carries no shared status-history stamp (it has no actor_id).
ALTER TABLE quo.approval_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE quo.approval_decisions FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_approval_decisions_scope ON quo.approval_decisions FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_approval_decisions_scope ON quo.approval_decisions FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
GRANT SELECT, INSERT ON quo.approval_decisions TO app_runtime;
GRANT SELECT ON quo.approval_decisions TO app_readonly;

-- ----------------------------------------------------------------------------
-- 5. quo.approval_evidence — append-only; document-bound.
-- ----------------------------------------------------------------------------
CREATE TABLE quo.approval_evidence (
  id                   uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id            uuid    NOT NULL,
  company_id           uuid    NOT NULL,
  branch_id            uuid    NOT NULL,
  approval_decision_id uuid    NOT NULL,
  evidence_kind        text    NOT NULL,
  document_version_id  uuid    NULL,
  reference_note       text    NULL,
  seq                  bigint  GENERATED ALWAYS AS IDENTITY,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid    NOT NULL,

  CONSTRAINT pk_approval_evidence PRIMARY KEY (id),
  CONSTRAINT fk_approval_evidence_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_approval_evidence_decision FOREIGN KEY (approval_decision_id) REFERENCES quo.approval_decisions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_approval_evidence_document FOREIGN KEY (tenant_id, document_version_id) REFERENCES shared.document_versions (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_approval_evidence_kind CHECK (evidence_kind IN ('document', 'verbal', 'portal', 'email')),
  CONSTRAINT ck_approval_evidence_document CHECK ((evidence_kind = 'document') = (document_version_id IS NOT NULL)),
  CONSTRAINT ck_approval_evidence_note CHECK (reference_note IS NULL OR btrim(reference_note) <> '')
);
COMMENT ON TABLE quo.approval_evidence IS 'Phase 1-10 append-only approval evidence. Document evidence binds an EXACT immutable shared.document_versions row (no substitution).';
CREATE INDEX ix_approval_evidence_decision ON quo.approval_evidence (approval_decision_id);
CREATE INDEX ix_approval_evidence_document ON quo.approval_evidence (tenant_id, document_version_id);
ALTER TABLE quo.approval_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE quo.approval_evidence FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_approval_evidence_scope ON quo.approval_evidence FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_approval_evidence_scope ON quo.approval_evidence FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
GRANT SELECT, INSERT ON quo.approval_evidence TO app_runtime;
GRANT SELECT ON quo.approval_evidence TO app_readonly;

-- ----------------------------------------------------------------------------
-- 6. quo.quotation_status_history — append-only ledger.
-- ----------------------------------------------------------------------------
CREATE TABLE quo.quotation_status_history (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid    NOT NULL,
  company_id     uuid    NOT NULL,
  branch_id      uuid    NOT NULL,
  quotation_id   uuid    NOT NULL,
  from_status    text    NULL,
  to_status      text    NOT NULL,
  reason         text    NULL,
  actor_id       uuid    NOT NULL,
  occurred_at    timestamptz NOT NULL,
  correlation_id uuid    NULL,
  seq            bigint  GENERATED ALWAYS AS IDENTITY,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid    NOT NULL,

  CONSTRAINT pk_quotation_status_history PRIMARY KEY (id),
  CONSTRAINT fk_quotation_status_history_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_quotation_status_history_quotation FOREIGN KEY (tenant_id, company_id, branch_id, quotation_id) REFERENCES quo.quotations (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_quotation_status_history_reason CHECK (reason IS NULL OR btrim(reason) <> '')
);
COMMENT ON TABLE quo.quotation_status_history IS 'Phase 1-10 append-only quotation status ledger (actor + time server-stamped).';
CREATE INDEX ix_quotation_status_history_quotation ON quo.quotation_status_history (tenant_id, company_id, branch_id, quotation_id, occurred_at DESC, seq DESC);
CREATE TRIGGER tg_quotation_status_history_stamp BEFORE INSERT ON quo.quotation_status_history
  FOR EACH ROW EXECUTE FUNCTION shared.stamp_status_history();
ALTER TABLE quo.quotation_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE quo.quotation_status_history FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_quotation_status_history_scope ON quo.quotation_status_history FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_quotation_status_history_scope ON quo.quotation_status_history FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids())) AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
GRANT SELECT, INSERT ON quo.quotation_status_history TO app_runtime;
GRANT SELECT ON quo.quotation_status_history TO app_readonly;

CREATE OR REPLACE FUNCTION quo.emit_quotation_status_history()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_reason text := NULLIF(btrim(current_setting('app.status_reason', true)), '');
        v_corr uuid := NULLIF(current_setting('app.correlation_id', true), '')::uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO quo.quotation_status_history (tenant_id, company_id, branch_id, quotation_id, from_status, to_status, reason, correlation_id, created_by)
      VALUES (NEW.tenant_id, NEW.company_id, NEW.branch_id, NEW.id, OLD.status, NEW.status, v_reason, v_corr, iam.current_user_id());
  END IF;
  RETURN NULL;
END; $$;
REVOKE EXECUTE ON FUNCTION quo.emit_quotation_status_history() FROM PUBLIC;
CREATE TRIGGER tg_quotations_status_history AFTER UPDATE ON quo.quotations
  FOR EACH ROW EXECUTE FUNCTION quo.emit_quotation_status_history();

-- ----------------------------------------------------------------------------
-- 7. Operation functions.
-- ----------------------------------------------------------------------------
-- Issue a draft revision: recompute totals from items, forbid zero items,
-- supersede the prior issued revision, repoint current_revision_id (all under lock).
CREATE OR REPLACE FUNCTION quo.issue_revision(p_revision_id uuid, p_expires_at timestamptz DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); rev quo.quotation_revisions%ROWTYPE; v_count int;
        v_sub numeric(18,4); v_disc numeric(18,4); v_tax numeric(18,4); v_grand numeric(18,4);
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  SELECT * INTO rev FROM quo.quotation_revisions WHERE tenant_id = v_tenant AND id = p_revision_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'quotation revision % not found', p_revision_id USING ERRCODE = 'foreign_key_violation'; END IF;
  -- serialize on the parent quotation
  PERFORM 1 FROM quo.quotations WHERE tenant_id = v_tenant AND id = rev.quotation_id FOR UPDATE;
  IF rev.status <> 'draft' THEN RAISE EXCEPTION 'revision % is % (must be draft)', p_revision_id, rev.status USING ERRCODE = 'check_violation'; END IF;
  SELECT count(*), COALESCE(SUM(captured_unit_price * captured_quantity), 0), COALESCE(SUM(captured_discount), 0),
         COALESCE(SUM(captured_tax_amount), 0), COALESCE(SUM(captured_line_total), 0)
    INTO v_count, v_sub, v_disc, v_tax, v_grand
    FROM quo.quotation_items WHERE tenant_id = v_tenant AND quotation_revision_id = p_revision_id AND deleted_at IS NULL;
  IF v_count = 0 THEN RAISE EXCEPTION 'cannot issue a revision with no items' USING ERRCODE = 'check_violation'; END IF;
  -- supersede the prior issued revision first (keeps the single-issued unique satisfied)
  UPDATE quo.quotation_revisions SET status = 'superseded'
    WHERE tenant_id = v_tenant AND quotation_id = rev.quotation_id AND status = 'issued';
  UPDATE quo.quotation_revisions
    SET status = 'issued', issued_at = now(), expires_at = p_expires_at,
        captured_subtotal = v_sub, captured_discount_total = v_disc, captured_tax_total = v_tax, captured_grand_total = v_grand
    WHERE tenant_id = v_tenant AND id = p_revision_id;
  UPDATE quo.quotations SET current_revision_id = p_revision_id, status = 'active'
    WHERE tenant_id = v_tenant AND id = rev.quotation_id;
END; $$;
REVOKE EXECUTE ON FUNCTION quo.issue_revision(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION quo.issue_revision(uuid, timestamptz) TO app_runtime;

-- Record an item decision only against the current issued revision.
CREATE OR REPLACE FUNCTION quo.record_item_decision(
  p_item_id uuid, p_decision text, p_channel text, p_evidence_ref uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); it quo.quotation_items%ROWTYPE; v_rev_status text; v_current uuid; v_qid uuid; v_dec uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  SELECT * INTO it FROM quo.quotation_items WHERE tenant_id = v_tenant AND id = p_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'quotation item % not found', p_item_id USING ERRCODE = 'foreign_key_violation'; END IF;
  SELECT quotation_id INTO v_qid FROM quo.quotation_revisions WHERE tenant_id = v_tenant AND id = it.quotation_revision_id;
  -- serialize on the parent quotation, then re-read current revision under the lock
  PERFORM 1 FROM quo.quotations WHERE tenant_id = v_tenant AND id = v_qid FOR UPDATE;
  SELECT current_revision_id INTO v_current FROM quo.quotations WHERE tenant_id = v_tenant AND id = v_qid;
  SELECT status INTO v_rev_status FROM quo.quotation_revisions WHERE tenant_id = v_tenant AND id = it.quotation_revision_id;
  IF it.quotation_revision_id <> v_current OR v_rev_status <> 'issued' THEN
    RAISE EXCEPTION 'decisions may be recorded only against the current issued revision' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO quo.approval_decisions (tenant_id, company_id, branch_id, quotation_revision_id, quotation_item_id, decision, decided_by, decision_channel, evidence_ref, created_by)
    VALUES (v_tenant, it.company_id, it.branch_id, it.quotation_revision_id, p_item_id, p_decision, iam.current_user_id(), p_channel, p_evidence_ref, iam.current_user_id())
    RETURNING id INTO v_dec;
  RETURN v_dec;
END; $$;
REVOKE EXECUTE ON FUNCTION quo.record_item_decision(uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION quo.record_item_decision(uuid, text, text, uuid) TO app_runtime;
