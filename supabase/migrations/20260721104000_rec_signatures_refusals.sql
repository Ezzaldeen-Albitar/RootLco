-- ============================================================================
-- Phase: 1-8 — Appointment and Vehicle Reception Database
-- Migration: reception signatures + refusals (append-only)
-- Tasks: P1-08-DB-017 (signatures), P1-08-DB-018 (refusals)
-- Owner module: rec
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once rows exist. Forward-only — no down script.
--
-- Purpose
--   rec.signatures is the append-only record that a party signed something at
--   reception. It stores WHO signed, in what ROLE, for what PURPOSE, and binds the
--   captured signature to a shared.documents object AND its exact immutable
--   version — never the raw image bytes (those live in the document store). An
--   integrity hash may accompany it. Possession of the document id grants nothing:
--   access to the image is governed by the linked document + permission.
--
--   rec.refusals is the append-only record that a party DECLINED a reception step
--   (an inspection item, a signature, an intake step, an authorization). The reason
--   is a GOVERNED CODE (rec.refusal_reasons) — deliberately not free personal text,
--   so there is no restricted narrative to leak. A witness and evidence may attach.
--
-- Both tables are append-only: SELECT + INSERT only; UPDATE/DELETE raise 42501.
--
-- Dependencies
--   rec.reception_visits (tenant,company,branch,id); crm.business_partners (tenant,id);
--   rec.refusal_reasons (id); shared.documents (tenant,id); shared.document_versions
--   (tenant,id); iam.current_tenant_id / allowed_*_ids; org / shared guards.
--
-- Objects created
--   Tables:    rec.signatures, rec.refusals
--   Functions: rec.guard_signature_version(), rec.guard_refusal_reason()
--   Triggers:  tg_signatures_version, tg_refusals_reason
--   Policies:  sel/ins_signatures_scope, sel/ins_refusals_scope
-- ============================================================================

CREATE TABLE rec.signatures (
  id                          uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id                   uuid        NOT NULL,
  company_id                  uuid        NOT NULL,
  branch_id                   uuid        NOT NULL,
  reception_visit_id          uuid        NOT NULL,
  signer_role                 text        NOT NULL,
  signer_partner_id           uuid        NULL,
  signature_document_id       uuid        NOT NULL,
  signature_document_version_id uuid      NOT NULL,
  capture_method              text        NOT NULL,
  purpose                     text        NOT NULL,
  signature_hash              bytea       NULL,
  signed_at                   timestamptz NOT NULL DEFAULT now(),
  correlation_id              uuid        NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid        NOT NULL,

  CONSTRAINT pk_signatures PRIMARY KEY (id),
  CONSTRAINT fk_signatures_visit
    FOREIGN KEY (tenant_id, company_id, branch_id, reception_visit_id)
    REFERENCES rec.reception_visits (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_signatures_signer
    FOREIGN KEY (tenant_id, signer_partner_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_signatures_document
    FOREIGN KEY (tenant_id, signature_document_id)
    REFERENCES shared.documents (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_signatures_document_version
    FOREIGN KEY (tenant_id, signature_document_version_id)
    REFERENCES shared.document_versions (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_signatures_role CHECK (signer_role IN (
    'service_requester', 'vehicle_owner', 'authorized_receiver', 'payer',
    'approving_party', 'receiving_employee', 'other')),
  CONSTRAINT ck_signatures_capture CHECK (capture_method IN ('drawn', 'typed', 'uploaded', 'biometric')),
  CONSTRAINT ck_signatures_purpose CHECK (purpose IN (
    'reception_acknowledgement', 'custody_acceptance', 'authorization',
    'refusal_witness', 'condition_agreement', 'other')),
  CONSTRAINT ck_signatures_hash_len CHECK (signature_hash IS NULL OR octet_length(signature_hash) <= 64)
);

COMMENT ON TABLE rec.signatures IS
  'Phase 1-8 append-only reception signatures (P1-08-DB-017). Binds a signature to a document + its exact version (never raw bytes in rec); document-id possession grants no access. SELECT+INSERT only.';

CREATE INDEX ix_signatures_visit
  ON rec.signatures (tenant_id, company_id, branch_id, reception_visit_id);
CREATE INDEX ix_signatures_signer ON rec.signatures (tenant_id, signer_partner_id);
CREATE INDEX ix_signatures_document ON rec.signatures (tenant_id, signature_document_id);
CREATE INDEX ix_signatures_document_version
  ON rec.signatures (tenant_id, signature_document_version_id);

CREATE OR REPLACE FUNCTION rec.guard_signature_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_doc uuid;
BEGIN
  SELECT document_id INTO v_doc FROM shared.document_versions
    WHERE tenant_id = NEW.tenant_id AND id = NEW.signature_document_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'signature document version % is not visible to this tenant',
      NEW.signature_document_version_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_doc IS DISTINCT FROM NEW.signature_document_id THEN
    RAISE EXCEPTION 'signature version % does not belong to document %',
      NEW.signature_document_version_id, NEW.signature_document_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION rec.guard_signature_version() IS
  'BEFORE INSERT on rec.signatures: the bound signature version must belong to the bound signature document (exact-version integrity).';
REVOKE EXECUTE ON FUNCTION rec.guard_signature_version() FROM PUBLIC;

CREATE TRIGGER tg_signatures_version
  BEFORE INSERT ON rec.signatures
  FOR EACH ROW EXECUTE FUNCTION rec.guard_signature_version();

ALTER TABLE rec.signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec.signatures FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_signatures_scope ON rec.signatures
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY ins_signatures_scope ON rec.signatures
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
GRANT SELECT, INSERT ON rec.signatures TO app_runtime;
GRANT SELECT ON rec.signatures TO app_readonly;

-- ----------------------------------------------------------------------------
-- rec.refusals — append-only refusal records (governed reason code, no free text).
-- ----------------------------------------------------------------------------
CREATE TABLE rec.refusals (
  id                   uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL,
  company_id           uuid        NOT NULL,
  branch_id            uuid        NOT NULL,
  reception_visit_id   uuid        NOT NULL,
  refusal_type         text        NOT NULL,
  refusal_reason_id    uuid        NULL,
  refusing_partner_id  uuid        NULL,
  witness_employee_id  uuid        NULL,
  evidence_document_id uuid        NULL,
  occurred_at          timestamptz NOT NULL DEFAULT now(),
  correlation_id       uuid        NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid        NOT NULL,

  CONSTRAINT pk_refusals PRIMARY KEY (id),
  CONSTRAINT fk_refusals_visit
    FOREIGN KEY (tenant_id, company_id, branch_id, reception_visit_id)
    REFERENCES rec.reception_visits (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_refusals_reason
    FOREIGN KEY (refusal_reason_id) REFERENCES rec.refusal_reasons (id) ON DELETE RESTRICT,
  CONSTRAINT fk_refusals_partner
    FOREIGN KEY (tenant_id, refusing_partner_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_refusals_evidence
    FOREIGN KEY (tenant_id, evidence_document_id)
    REFERENCES shared.documents (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_refusals_type CHECK (refusal_type IN (
    'inspection_item', 'signature', 'intake_step', 'authorization', 'other'))
);

COMMENT ON TABLE rec.refusals IS
  'Phase 1-8 append-only reception refusals (P1-08-DB-018). Reason is a governed code (rec.refusal_reasons), not free personal text, so there is no restricted narrative. SELECT+INSERT only.';

CREATE INDEX ix_refusals_visit
  ON rec.refusals (tenant_id, company_id, branch_id, reception_visit_id);
CREATE INDEX ix_refusals_reason ON rec.refusals (refusal_reason_id);
CREATE INDEX ix_refusals_partner ON rec.refusals (tenant_id, refusing_partner_id);
CREATE INDEX ix_refusals_evidence ON rec.refusals (tenant_id, evidence_document_id);

CREATE OR REPLACE FUNCTION rec.guard_refusal_reason()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_status text;
BEGIN
  IF NEW.refusal_reason_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT status INTO v_status FROM rec.refusal_reasons WHERE id = NEW.refusal_reason_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refusal_reason % is not visible to this tenant', NEW.refusal_reason_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'refusal_reason % is not active and cannot be newly selected', NEW.refusal_reason_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION rec.guard_refusal_reason() IS
  'BEFORE INSERT on rec.refusals: when set, the reason must be platform-or-same-tenant visible AND active.';
REVOKE EXECUTE ON FUNCTION rec.guard_refusal_reason() FROM PUBLIC;

CREATE TRIGGER tg_refusals_reason
  BEFORE INSERT ON rec.refusals
  FOR EACH ROW EXECUTE FUNCTION rec.guard_refusal_reason();

ALTER TABLE rec.refusals ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec.refusals FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_refusals_scope ON rec.refusals
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY ins_refusals_scope ON rec.refusals
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
GRANT SELECT, INSERT ON rec.refusals TO app_runtime;
GRANT SELECT ON rec.refusals TO app_readonly;
