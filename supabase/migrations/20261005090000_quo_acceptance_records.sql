-- ============================================================================
-- P1-32-PRE-OD-FD11 — an auditable acceptance record for each accepted
-- quotation revision (Owner decision D11 of 2026-09-30, ADR-023).
-- Owner module: quo (one table, one trigger function, one trigger)
--
-- Rollback classification: ROLLBACK-SAFE while quo.acceptance_records is
--   empty; roll-forward-only once a record exists, because dropping the table
--   would destroy the only statement of who accepted, through whom, how and on
--   what reference. Forward-only — the inverse at the foot of this file is for
--   a rehearsal copy only.
--
-- Purpose
--   A customer's acceptance of a quotation was recorded only as per-line
--   decisions (quo.approval_decisions): the channel, the staff user and the
--   time of each line, and optional per-line evidence. Nothing stated, for the
--   revision as a whole, who accepted on the customer's side or on what
--   reference. D11 asks for an auditable record of the exact revision, the
--   customer or contact, the channel, the time, the employee who recorded it
--   and the evidence or reference. Recording a telephone call is not required,
--   no evidence is invented, and the record is not an electronic signature.
--
--   quo.acceptance_records holds ONE row per accepted revision, written in the
--   same transaction as the decision that completes the acceptance — the
--   existing decision routes are the only writers; there is no second way to
--   accept. It records:
--     * the revision and its quotation (composite scoped foreign keys);
--     * the customer: the quotation's payer when the person recording said the
--       payer decided, otherwise NULL (never guessed);
--     * the contact: a typed name and an optional typed telephone number of
--       the person who spoke for the customer. The CRM model holds contact
--       CHANNELS of a business partner (crm.contact_points), not contact
--       PERSONS, so there is no person to choose from; the name is what the
--       employee was told, and either may be left empty;
--     * the channel, from the decision vocabulary;
--     * the evidence kind, reference note and document version given with the
--       completing decision, each NULL when none was given;
--     * accepted_at and recorded_by, stamped from the session by the guard
--       below and never taken from the statement.
--
--   Immutable: app_runtime holds SELECT and INSERT only, and the guard refuses
--   every UPDATE. A correction is a new revision and that revision's own
--   acceptance; an earlier record is never rewritten.
--
-- Existing accepted revisions are NOT backfilled
--   A revision accepted before this migration has no record. Who spoke for the
--   customer and on what reference was never captured, and inventing it would
--   be the fabrication D11 forbids. Readers state "not recorded".
--
-- Security implications
--   ENABLE + FORCE RLS; SELECT and INSERT policies scoped by tenant, company
--   and branch like every quo table; the INSERT policy also requires
--   recorded_by to be the session's user. No UPDATE or DELETE grant to any
--   application role; app_readonly reads only. No SECURITY DEFINER.
-- ============================================================================

CREATE TABLE quo.acceptance_records (
  id                           uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id                    uuid        NOT NULL,
  company_id                   uuid        NOT NULL,
  branch_id                    uuid        NOT NULL,
  quotation_id                 uuid        NOT NULL,
  quotation_revision_id        uuid        NOT NULL,
  customer_partner_id          uuid        NULL,
  contact_name                 text        NULL,
  contact_phone                text        NULL,
  channel                      text        NOT NULL,
  evidence_kind                text        NULL,
  reference_note               text        NULL,
  evidence_document_version_id uuid        NULL,
  accepted_at                  timestamptz NOT NULL DEFAULT now(),
  recorded_by                  uuid        NOT NULL,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  created_by                   uuid        NOT NULL,

  CONSTRAINT pk_acceptance_records PRIMARY KEY (id),
  CONSTRAINT uq_acceptance_records_revision UNIQUE (tenant_id, quotation_revision_id),
  CONSTRAINT fk_acceptance_records_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_acceptance_records_quotation
    FOREIGN KEY (tenant_id, company_id, branch_id, quotation_id)
    REFERENCES quo.quotations (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_acceptance_records_revision
    FOREIGN KEY (tenant_id, company_id, branch_id, quotation_revision_id)
    REFERENCES quo.quotation_revisions (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_acceptance_records_document
    FOREIGN KEY (tenant_id, evidence_document_version_id)
    REFERENCES shared.document_versions (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_acceptance_records_channel
    CHECK (channel IN ('in_person', 'phone', 'portal', 'email', 'system')),
  CONSTRAINT ck_acceptance_records_evidence_kind
    CHECK (evidence_kind IS NULL OR evidence_kind IN ('document', 'verbal', 'portal', 'email')),
  CONSTRAINT ck_acceptance_records_document
    CHECK ((evidence_kind IS NOT DISTINCT FROM 'document') = (evidence_document_version_id IS NOT NULL)),
  CONSTRAINT ck_acceptance_records_note
    CHECK (reference_note IS NULL
           OR (evidence_kind IS NOT NULL AND btrim(reference_note) <> ''
               AND char_length(reference_note) <= 2000)),
  CONSTRAINT ck_acceptance_records_contact_name
    CHECK (contact_name IS NULL
           OR (btrim(contact_name) = contact_name AND contact_name <> ''
               AND char_length(contact_name) <= 200)),
  CONSTRAINT ck_acceptance_records_contact_phone
    CHECK (contact_phone IS NULL OR contact_phone ~ '^\+?[0-9]{3,20}$')
);

COMMENT ON TABLE quo.acceptance_records IS
  'P1-32-PRE-OD-FD11 (ADR-023 D11): one auditable record per ACCEPTED quotation revision — the customer, the contact who spoke for them, the channel, the time, the employee who recorded it and the reference or evidence given. Written only by the decision that completes the acceptance, in its transaction; append-only (SELECT+INSERT, every UPDATE refused). Not an electronic signature. Revisions accepted before 20261005090000 have no record and are not backfilled.';
COMMENT ON COLUMN quo.acceptance_records.customer_partner_id IS
  'The quotation''s payer, recorded only when the employee said the payer decided (the decision''s deciding party, validated against quo.quotations.payer_partner_ref by the service and by quo.guard_acceptance_record). NULL when the decision was not attributed to the payer.';
COMMENT ON COLUMN quo.acceptance_records.contact_name IS
  'The name, as the employee was told it, of the person who accepted for the customer; trimmed, at most 200 characters, NULL when not given. Typed, because the CRM model records contact channels, not contact persons.';
COMMENT ON COLUMN quo.acceptance_records.contact_phone IS
  'The telephone number of that person, normalised (an optional leading + and 3 to 20 ASCII digits, Arabic-Indic digits folded); NULL when not given. Recording the call itself is not required.';
COMMENT ON COLUMN quo.acceptance_records.reference_note IS
  'The free-text reference given with the completing decision''s evidence — a call or message reference — copied from it; NULL when none was given. Never a placeholder.';
COMMENT ON COLUMN quo.acceptance_records.accepted_at IS
  'The database time of the transaction that completed the acceptance; stamped by quo.guard_acceptance_record, never supplied.';
COMMENT ON COLUMN quo.acceptance_records.recorded_by IS
  'The signed-in employee who recorded the acceptance; stamped by quo.guard_acceptance_record from iam.current_user_id(), never supplied.';

CREATE INDEX ix_acceptance_records_quotation
  ON quo.acceptance_records (tenant_id, company_id, branch_id, quotation_id);
CREATE INDEX ix_acceptance_records_revision
  ON quo.acceptance_records (tenant_id, company_id, branch_id, quotation_revision_id);
CREATE INDEX ix_acceptance_records_document
  ON quo.acceptance_records (tenant_id, evidence_document_version_id);

-- ----------------------------------------------------------------------------
-- The guard: a record exists only for an accepted revision, carries the
-- session's own user and time, and never changes.
-- ----------------------------------------------------------------------------
CREATE FUNCTION quo.guard_acceptance_record()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_revision_quotation uuid; v_revision_status text;
  v_current uuid; v_quotation_status text; v_payer uuid;
  v_items integer; v_approved integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'acceptance_record_immutable: acceptance record % cannot be changed; a correction is a new revision and its own acceptance', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Stamped, never supplied: whatever the statement said is overwritten.
  NEW.recorded_by := iam.current_user_id();
  NEW.created_by := NEW.recorded_by;
  NEW.accepted_at := now();
  NEW.created_at := now();

  SELECT r.quotation_id, r.status INTO v_revision_quotation, v_revision_status
    FROM quo.quotation_revisions r
   WHERE r.tenant_id = NEW.tenant_id AND r.company_id = NEW.company_id
     AND r.branch_id = NEW.branch_id AND r.id = NEW.quotation_revision_id
     AND r.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'acceptance_record_revision_missing: revision % not found in scope', NEW.quotation_revision_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_revision_quotation <> NEW.quotation_id THEN
    RAISE EXCEPTION 'acceptance_record_revision_mismatch: revision % belongs to another quotation', NEW.quotation_revision_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT q.current_revision_id, q.status, q.payer_partner_ref
    INTO v_current, v_quotation_status, v_payer
    FROM quo.quotations q
   WHERE q.tenant_id = NEW.tenant_id AND q.id = NEW.quotation_id AND q.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'acceptance_record_revision_missing: quotation % not found', NEW.quotation_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_current IS DISTINCT FROM NEW.quotation_revision_id OR v_revision_status <> 'issued'
     OR v_quotation_status <> 'accepted' THEN
    RAISE EXCEPTION 'acceptance_record_not_accepted: revision % is not the accepted current revision of its quotation', NEW.quotation_revision_id
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(i.id), count(d.id) FILTER (WHERE d.decision = 'approved')
    INTO v_items, v_approved
    FROM quo.quotation_items i
    LEFT JOIN quo.approval_decisions d
      ON d.tenant_id = i.tenant_id AND d.quotation_item_id = i.id
   WHERE i.tenant_id = NEW.tenant_id AND i.quotation_revision_id = NEW.quotation_revision_id
     AND i.deleted_at IS NULL;
  IF v_items = 0 OR v_approved <> v_items THEN
    RAISE EXCEPTION 'acceptance_record_not_accepted: not every line of revision % is approved', NEW.quotation_revision_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.customer_partner_id IS NOT NULL AND NEW.customer_partner_id IS DISTINCT FROM v_payer THEN
    RAISE EXCEPTION 'acceptance_record_customer_mismatch: the customer named is not the payer of quotation %', NEW.quotation_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION quo.guard_acceptance_record() FROM PUBLIC;

CREATE TRIGGER tg_acceptance_records_guard BEFORE INSERT OR UPDATE ON quo.acceptance_records
  FOR EACH ROW EXECUTE FUNCTION quo.guard_acceptance_record();

ALTER TABLE quo.acceptance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE quo.acceptance_records FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_acceptance_records_scope ON quo.acceptance_records FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
-- The recorder is the signed-in person, never a value the caller chose.
CREATE POLICY ins_acceptance_records_scope ON quo.acceptance_records FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
    AND recorded_by = iam.current_user_id());
GRANT SELECT, INSERT ON quo.acceptance_records TO app_runtime;
GRANT SELECT ON quo.acceptance_records TO app_readonly;

-- ----------------------------------------------------------------------------
-- Exact inverse (rehearsal copy only — refused once a record exists)
--
--   DO $$ BEGIN
--     IF EXISTS (SELECT 1 FROM quo.acceptance_records) THEN
--       RAISE EXCEPTION 'acceptance records exist; this migration is forward-only';
--     END IF;
--   END $$;
--   DROP TABLE quo.acceptance_records;
--   DROP FUNCTION quo.guard_acceptance_record();
-- ----------------------------------------------------------------------------
