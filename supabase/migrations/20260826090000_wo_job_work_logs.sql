-- ============================================================================
-- PRE-P1-29-BR-06 — wo.job_work_logs, the progressive work log.
--
-- Rollback classification: DESTRUCTIVE-AFTER-FIRST-WRITE. DROP TABLE is clean and
-- lossless until the first entry exists; after that it destroys a record nothing
-- else in the platform holds — the work log is not derivable from job state, from
-- labour sessions or from the status history. There is no down script, and the
-- window closes the first time a technician uses it.
--
-- Closes Owner requirement 8 and finding INS-27. Before this table there was no
-- work-log or note table anywhere in the four schemas:
--
--   grep -rniE "CREATE TABLE (wo|tech|qms|dia)\.[a-z_]*(log|note|comment)"
--
-- returned nothing, and no note was bound to a job or an assignment. A technician
-- had no way to record what they had done beyond the state a job sits in and the
-- clock a labour session runs — neither of which is a narration.
--
-- ## Why a TYPED table and not shared.notes
--
-- `shared.notes` addresses rows by (entity_type, entity_id) with NULLABLE
-- company_id and branch_id, while every operational table in this domain carries
-- UNIQUE (tenant_id, company_id, branch_id, id) and every child joins on the full
-- composite. A job note written into shared.notes could therefore carry a NULL
-- branch, and branch containment would have to be enforced by the application on
-- every read and every write — in a domain whose entire integrity story is that
-- it does not have to be. The typed form is selected on CONTAINMENT grounds, not
-- on taste (correction C-08).
--
-- ## Append-only, at the GRANT layer
--
-- SELECT and INSERT only. No UPDATE, no DELETE, no record_version, no updated_*,
-- no deleted_*. A progress log that can be edited is not a log, and the way to
-- mean that is to withhold the grant rather than to write it in a comment —
-- matching dia.diagnostic_evidence and wo.customer_approval_evidence, this
-- domain's two existing append-only tables. There is deliberately no soft-delete
-- column: both of those carry none either.
--
-- ## logged_at is NOT created_at
--
-- A technician recording at 16:00 the work they did at 14:00 is the normal case,
-- not the exception. Conflating the two would make the log unusable for the one
-- thing it exists for, so `logged_at` is the caller's claim about WHEN and
-- `created_at` is the server's record of when it was told. `created_by` is the
-- server's record of WHO, stamped from the session and never from the body.
--
-- ## Rollback
--
-- DROP TABLE, and it is safe ONLY until the first entry is written. After that,
-- dropping destroys a record nothing else in the platform holds: the work log is
-- not derivable from job state, from labour sessions or from the status history.
-- That window closes the first time a technician uses it.
--
-- structuralTotals moves (one table, one index) and cannot be reproduced on a
-- developer stack, because Supabase's own schemas inflate it. Take the figure
-- from a CI run.
-- ============================================================================

CREATE TABLE wo.job_work_logs (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  company_id     uuid        NOT NULL,
  branch_id      uuid        NOT NULL,
  job_id         uuid        NOT NULL,
  entry          text        NOT NULL,
  logged_at      timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,

  CONSTRAINT pk_job_work_logs PRIMARY KEY (id),
  CONSTRAINT uq_job_work_logs_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  -- COMPOSITE, so a cross-branch parentage is structurally impossible rather
  -- than merely unwritten — the same shape every other child in this domain uses.
  CONSTRAINT fk_job_work_logs_job
    FOREIGN KEY (tenant_id, company_id, branch_id, job_id)
    REFERENCES wo.jobs (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_job_work_logs_entry_not_blank CHECK (btrim(entry) <> '')
);

COMMENT ON TABLE wo.job_work_logs IS
  'PRE-P1-29-BR-06 progressive work log for a job (Owner requirement 8, INS-27). APPEND-ONLY at the grant layer: SELECT + INSERT to app_runtime and nothing else, so an entry cannot be edited or removed. logged_at is the technician''s claim about when the work happened; created_at is when the platform was told; created_by is stamped from the session. Written under tech.labor.record, because the log is the technician''s narration of the labour they are already recording.';
COMMENT ON COLUMN wo.job_work_logs.logged_at IS
  'When the work described happened, as claimed by the caller. Bounded by the API: not in the future, and not before the job existed. Distinct from created_at on purpose.';

-- Zero unindexed foreign keys is a MEASURED property of these four schemas, not
-- an aspiration. One new FK, one covering index, and the property is preserved.
CREATE INDEX ix_job_work_logs_job ON wo.job_work_logs (tenant_id, company_id, branch_id, job_id);

ALTER TABLE wo.job_work_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE wo.job_work_logs FORCE  ROW LEVEL SECURITY;

CREATE POLICY sel_job_work_logs_scope ON wo.job_work_logs FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));

CREATE POLICY ins_job_work_logs_scope ON wo.job_work_logs FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));

-- No UPDATE policy and no DELETE policy, deliberately: there is no grant for
-- either, and adding a policy for an ungranted verb would suggest one exists.
GRANT SELECT, INSERT ON wo.job_work_logs TO app_runtime;
GRANT SELECT ON wo.job_work_logs TO app_readonly;
