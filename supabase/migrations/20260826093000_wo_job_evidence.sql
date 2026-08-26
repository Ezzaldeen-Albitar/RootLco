-- ============================================================================
-- PRE-P1-29-BR-07 — wo.job_evidence, job-level work evidence.
--
-- Rollback classification: DESTRUCTIVE-AFTER-FIRST-WRITE. DROP TABLE is clean and
-- lossless until the first row exists. Afterwards the bound document versions
-- themselves survive — they are `shared` rows with their own lifecycle — but the
-- BINDING is lost and cannot be reconstructed: nothing else records which version
-- evidenced which job. There is no down script, and the window closes the first
-- time a technician attaches a photograph.
--
-- Closes the evidence half of BE-8, finding INS-28, and Owner requirement 12.
--
-- ## What was missing
--
-- A technician could not attach a photograph to the work they did. Evidence
-- binding existed for exactly TWO subjects — a diagnostic report and a customer
-- approval — and for nothing else. There was no job-level, assignment-level or
-- work-order-level evidence anywhere in the platform.
--
-- ## A TRANSCRIPTION, not a design
--
-- `dia.diagnostic_evidence` and `wo.customer_approval_evidence` are
-- field-identical (correction C-09): same scope key, same composite parent FK
-- with RESTRICT, same `(tenant_id, document_version_id)` binding, same
-- `evidence_type`/`note` payload, same created_at/created_by-only metadata, same
-- append-only grants, same two indexes. This table is the third instance of a
-- shape that has shipped twice — which is why a new table is proposed here with
-- more confidence than a new table normally warrants, and why the COMMENT below
-- carries its siblings' sentence verbatim rather than a paraphrase.
--
-- ## Parented on the JOB, and the alternatives were considered
--
--   wo.jobs             SELECTED. Owner requirement 12 is about the work done,
--                       and work is done on a job. A work-order-level read is
--                       then a JOIN rather than a second table.
--   wo.work_orders      rejected — evidence would lose which piece of work it
--                       evidences, which is the whole point of having it.
--   wo.job_assignments  rejected — evidence would vanish when an assignment
--                       ended, and work done by two successive technicians would
--                       split across two parents.
--
-- ## Append-only, and the consequence must be stated rather than discovered
--
-- SELECT and INSERT only: no UPDATE, no DELETE, no record_version, no
-- updated_*, no deleted_*. So **evidence cannot be unbound** — a mis-attached
-- photograph is permanent. That is exactly the property both shipped evidence
-- tables already have, and it is a property a UI must warn about BEFORE
-- submitting rather than a surprise afterwards.
--
-- ## evidence_type stays FREE TEXT, deliberately
--
-- Both existing tables have `evidence_type text NOT NULL` with no vocabulary and
-- no CHECK beyond non-blank, and this one matches them. Adding a CHECK here would
-- give the three tables three different contracts for one field name, and the
-- honest position is that the vocabulary is a CONVENTION the API recommends and
-- not an invariant the database enforces. Claiming otherwise would be claiming a
-- control that does not exist.
--
-- structuralTotals moves (one table, two indexes, three policies) and cannot be
-- reproduced on a developer stack. Take the figure from a CI run.
-- ============================================================================

CREATE TABLE wo.job_evidence (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  company_id          uuid        NOT NULL,
  branch_id           uuid        NOT NULL,
  job_id              uuid        NOT NULL,
  document_version_id uuid        NOT NULL,
  evidence_type       text        NOT NULL,
  note                text        NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        NOT NULL,

  CONSTRAINT pk_job_evidence PRIMARY KEY (id),
  CONSTRAINT uq_job_evidence_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_job_evidence_job
    FOREIGN KEY (tenant_id, company_id, branch_id, job_id)
    REFERENCES wo.jobs (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  -- (tenant_id, document_version_id), exactly as both siblings bind: a version
  -- from another tenant does not exist to be referenced.
  CONSTRAINT fk_job_evidence_version
    FOREIGN KEY (tenant_id, document_version_id)
    REFERENCES shared.document_versions (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_job_evidence_type_not_blank CHECK (btrim(evidence_type) <> ''),
  CONSTRAINT ck_job_evidence_note_not_blank CHECK (note IS NULL OR btrim(note) <> '')
);

-- The sentence is its siblings', word for word. Three tables that behave
-- identically should describe themselves identically; a paraphrase here would
-- invite a reader to look for a difference that is not there.
COMMENT ON TABLE wo.job_evidence IS
  'PRE-P1-29-BR-07 append-only job work evidence (Owner requirement 12, INS-28). Binds an EXACT immutable shared.document_versions row; no substitution. SELECT+INSERT only.';
COMMENT ON COLUMN wo.job_evidence.evidence_type IS
  'Free text, non-blank, matching both sibling evidence tables. The API recommends a vocabulary; the database does not enforce one, and that is deliberate rather than an omission.';

-- One index per foreign key. Zero unindexed FKs is a MEASURED property of these
-- four schemas, not an aspiration.
CREATE INDEX ix_job_evidence_job     ON wo.job_evidence (tenant_id, company_id, branch_id, job_id);
CREATE INDEX ix_job_evidence_version ON wo.job_evidence (tenant_id, document_version_id);

ALTER TABLE wo.job_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE wo.job_evidence FORCE  ROW LEVEL SECURITY;

CREATE POLICY sel_job_evidence_scope ON wo.job_evidence FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));

CREATE POLICY ins_job_evidence_scope ON wo.job_evidence FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));

-- No UPDATE policy and no DELETE policy: there is no grant for either, and a
-- policy for an ungranted verb would suggest one exists.
GRANT SELECT, INSERT ON wo.job_evidence TO app_runtime;
GRANT SELECT ON wo.job_evidence TO app_readonly;
