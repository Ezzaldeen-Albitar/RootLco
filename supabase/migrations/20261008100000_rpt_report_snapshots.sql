-- ============================================================================
-- P1-32-PRE-OD-FD16B — frozen report snapshots and distinguished restatements
-- (Owner decision D16, end-of-period reporting, part 2).
-- Owner module: rpt (one table, one trigger function, one trigger)
--
-- Rollback classification: ROLLBACK-SAFE while rpt.report_snapshots is empty;
--   roll-forward-only once a snapshot exists, because dropping the table would
--   destroy the only frozen copy of a report as it was saved. Forward-only — the
--   inverse at the foot of this file is for a rehearsal copy only.
--
-- Purpose
--   D16: "End-of-period reporting is defined and tested; later payments, credits,
--   reversals or backdated entries must not silently change a historical report;
--   as-of versus snapshot is documented; restatements are distinguished; no new
--   accounting subsystem."
--
--   Part 1 (20261008090000) made the invoice and payment report answer AS OF a
--   moment from immutable event times. That is a recomputation: it is repeatable,
--   but nothing kept the figures a person actually saw and relied on. This table
--   keeps them. A snapshot is a frozen copy of ONE run of a report — its period,
--   its zone, the moment its amounts were computed as of, the filters, the
--   columns and every row — written once and never changed.
--
--   A restatement is a later snapshot of the SAME report, scope, period and
--   filters that names the snapshot it replaces (restates_snapshot_id), states
--   why (restatement_reason, required exactly then) and carries a summary of what
--   changed (difference). The snapshot it replaces stays as it was. The chain is
--   linear: at most one original per (scope, report, period, filters) and at most
--   one restatement of any snapshot, so the latest snapshot of a period is the
--   one nothing restates.
--
--   Nothing is computed here that the application computes: the rows are the
--   report's own rows, stored as published. The database stamps what must not be
--   chosen by the writer — who saved it and when, the row count, and the sha256
--   digests of the canonical (jsonb text) serialisation of the rows and of the
--   filters — so the record says what it holds.
--
-- Who is held to the stamps
--   Exactly the population the request path uses: app_runtime and its login
--   members, which are non-superuser and NOBYPASSRLS, whose generated_by and
--   generated_at are the session's user and the transaction's now() whatever the
--   statement supplied. A role that bypasses row security (a superuser, the
--   provisioning connection) is not, the boundary of 20261007150000 and
--   20261008090000. The digests and the row count are stamped for every writer.
--
-- Security implications
--   ENABLE + FORCE RLS. The SELECT policy admits a row in the caller's tenant,
--   company and branch reach only when the caller holds rpt.report.read AND every
--   permission code the snapshot froze at creation (required_permissions — the
--   dataset's own codes, sal.finance.view for the invoice and payment report),
--   each evaluated in the snapshot's own company and branch by
--   iam.has_permission_in_scope. The INSERT policy also requires rpt.export and
--   generated_by to be the session's user. app_runtime holds SELECT and INSERT
--   only; app_readonly SELECT only; no UPDATE or DELETE for any application role,
--   and the guard refuses every UPDATE. No SECURITY DEFINER.
--
-- Not in this change
--   Period close and financial statements (no accounting subsystem). A dedicated
--   snapshot permission code is an open Owner question; until it is answered a
--   snapshot is saved under rpt.export and read under rpt.report.read.
-- ============================================================================

CREATE TABLE rpt.report_snapshots (
  id                    uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL,
  company_id            uuid        NOT NULL,
  branch_id             uuid        NOT NULL,
  report_code           text        NOT NULL,
  period_from           date        NOT NULL,
  period_to_exclusive   date        NOT NULL,
  timezone_name         text        NOT NULL,
  as_of                 timestamptz NOT NULL,
  parameters            jsonb       NOT NULL,
  parameters_digest     text        NOT NULL,
  required_permissions  text[]      NOT NULL,
  columns               jsonb       NOT NULL,
  rows                  jsonb       NOT NULL,
  row_count             integer     NOT NULL,
  rows_digest           text        NOT NULL,
  generated_at          timestamptz NOT NULL DEFAULT now(),
  generated_by          uuid        NOT NULL,
  restates_snapshot_id  uuid        NULL,
  restatement_reason    text        NULL,
  difference            jsonb       NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid        NOT NULL,

  CONSTRAINT pk_report_snapshots PRIMARY KEY (id),
  CONSTRAINT uq_report_snapshots_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  -- At most one restatement of any snapshot: the chain is linear. NULLs are
  -- distinct, so originals are not constrained by this.
  CONSTRAINT uq_report_snapshots_restates
    UNIQUE (tenant_id, company_id, branch_id, restates_snapshot_id),
  CONSTRAINT fk_report_snapshots_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_report_snapshots_branch
    FOREIGN KEY (tenant_id, company_id, branch_id)
    REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_report_snapshots_restates
    FOREIGN KEY (tenant_id, company_id, branch_id, restates_snapshot_id)
    REFERENCES rpt.report_snapshots (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_report_snapshots_code CHECK (report_code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_report_snapshots_period CHECK (period_from < period_to_exclusive),
  CONSTRAINT ck_report_snapshots_timezone
    CHECK (char_length(timezone_name) BETWEEN 1 AND 64),
  CONSTRAINT ck_report_snapshots_parameters CHECK (jsonb_typeof(parameters) = 'object'),
  CONSTRAINT ck_report_snapshots_columns CHECK (jsonb_typeof(columns) = 'array'),
  CONSTRAINT ck_report_snapshots_rows
    CHECK (jsonb_typeof(rows) = 'array' AND row_count = jsonb_array_length(rows)),
  CONSTRAINT ck_report_snapshots_digests
    CHECK (rows_digest ~ '^[0-9a-f]{64}$' AND parameters_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_report_snapshots_not_self
    CHECK (restates_snapshot_id IS NULL OR restates_snapshot_id <> id),
  -- A reason exactly when the row restates another, and never a blank one.
  CONSTRAINT ck_report_snapshots_reason
    CHECK ((restates_snapshot_id IS NULL AND restatement_reason IS NULL)
           OR (restates_snapshot_id IS NOT NULL AND restatement_reason IS NOT NULL
               AND btrim(restatement_reason) <> '' AND char_length(restatement_reason) <= 500)),
  -- A difference exactly when the row restates another.
  CONSTRAINT ck_report_snapshots_difference
    CHECK ((restates_snapshot_id IS NULL) = (difference IS NULL)
           AND (difference IS NULL OR jsonb_typeof(difference) = 'object'))
);

COMMENT ON TABLE rpt.report_snapshots IS
  'P1-32-PRE-OD-FD16B (Owner decision D16): a frozen copy of ONE run of a report — period, zone, as-of moment, filters, columns and rows — written once and never changed (SELECT+INSERT only; every UPDATE refused). A restatement is a later snapshot of the same report, scope, period and filters that names the one it replaces, with a required reason and a difference summary; at most one original per period and filters and one restatement per snapshot, so the chain is linear. Readable only with rpt.report.read and every code in required_permissions.';
COMMENT ON COLUMN rpt.report_snapshots.as_of IS
  'The moment the stored amounts were computed as of (the run''s as-of, ISO instant). The rows were read in one consistent transaction at this moment.';
COMMENT ON COLUMN rpt.report_snapshots.parameters IS
  'The filters the run used (company, branch, period), as a JSON object; parameters_digest is the sha256 of its canonical jsonb text, stamped by rpt.guard_report_snapshot.';
COMMENT ON COLUMN rpt.report_snapshots.required_permissions IS
  'The dataset''s own permission codes, frozen at creation. A reader needs rpt.report.read and every one of them in the snapshot''s company and branch (row-level security).';
COMMENT ON COLUMN rpt.report_snapshots.rows IS
  'Every row of the run as published (cells of key, label, value; amounts as decimal strings). row_count and rows_digest (sha256 of the canonical jsonb text) are stamped by rpt.guard_report_snapshot.';
COMMENT ON COLUMN rpt.report_snapshots.generated_by IS
  'The signed-in person who saved the snapshot; stamped from iam.current_user_id() for app_runtime and its login members, never supplied.';
COMMENT ON COLUMN rpt.report_snapshots.generated_at IS
  'The database time of the transaction that saved the snapshot; stamped for app_runtime and its login members, never supplied.';
COMMENT ON COLUMN rpt.report_snapshots.restates_snapshot_id IS
  'The snapshot this one restates (same scope, report, period and filters), or NULL for an original. Unique: a snapshot is restated at most once.';
COMMENT ON COLUMN rpt.report_snapshots.restatement_reason IS
  'Why the restatement was made; required and non-blank exactly when restates_snapshot_id is set, at most 500 characters.';
COMMENT ON COLUMN rpt.report_snapshots.difference IS
  'For a restatement, a summary of what changed from the restated snapshot: rows added, removed and changed, and totals per currency before and after. NULL for an original.';

-- One original per scope, report, period and filters.
CREATE UNIQUE INDEX uq_report_snapshots_original
  ON rpt.report_snapshots (tenant_id, company_id, branch_id, report_code, period_from,
                           period_to_exclusive, parameters_digest)
  WHERE restates_snapshot_id IS NULL;
-- The list order: newest first within a report and branch.
CREATE INDEX ix_report_snapshots_list
  ON rpt.report_snapshots (tenant_id, company_id, branch_id, report_code, generated_at DESC, id DESC);

-- ----------------------------------------------------------------------------
-- The guard: stamps, digests, a restatement of the same report and period, and
-- no change ever.
-- ----------------------------------------------------------------------------
CREATE FUNCTION rpt.guard_report_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_code text; v_from date; v_to date; v_digest text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'report_snapshot_immutable: report snapshot % cannot be changed; a correction is a restatement', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Stamped, never supplied, for the request path's population.
  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles
        WHERE rolname = current_user AND (rolsuper OR rolbypassrls))
     AND pg_catalog.pg_has_role(current_user, 'app_runtime', 'MEMBER') THEN
    NEW.generated_by := iam.current_user_id();
    IF NEW.generated_by IS NULL THEN
      RAISE EXCEPTION 'report_snapshot_no_user: a snapshot is saved by a signed-in person'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.generated_at := now();
    NEW.created_by := NEW.generated_by;
    NEW.created_at := now();
  END IF;

  -- What the record holds, stated by the database for every writer.
  IF NEW.rows IS NULL OR jsonb_typeof(NEW.rows) <> 'array' THEN
    RAISE EXCEPTION 'report_snapshot_rows_invalid: the rows of a snapshot are a JSON array'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.row_count := jsonb_array_length(NEW.rows);
  NEW.rows_digest := encode(sha256(convert_to(NEW.rows::text, 'UTF8')), 'hex');
  NEW.parameters_digest := encode(sha256(convert_to(NEW.parameters::text, 'UTF8')), 'hex');

  IF NEW.restates_snapshot_id IS NOT NULL THEN
    SELECT s.report_code, s.period_from, s.period_to_exclusive, s.parameters_digest
      INTO v_code, v_from, v_to, v_digest
      FROM rpt.report_snapshots s
     WHERE s.tenant_id = NEW.tenant_id AND s.company_id = NEW.company_id
       AND s.branch_id = NEW.branch_id AND s.id = NEW.restates_snapshot_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'report_snapshot_restated_missing: snapshot % not found in scope', NEW.restates_snapshot_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_code <> NEW.report_code OR v_from <> NEW.period_from OR v_to <> NEW.period_to_exclusive
       OR v_digest <> NEW.parameters_digest THEN
      RAISE EXCEPTION 'report_snapshot_restatement_mismatch: a restatement covers the same report, period and filters as snapshot %', NEW.restates_snapshot_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION rpt.guard_report_snapshot() IS
  'BEFORE INSERT OR UPDATE on rpt.report_snapshots (P1-32-PRE-OD-FD16B, Owner decision D16): refuses every UPDATE; for app_runtime and its login members stamps generated_by and created_by from iam.current_user_id() and generated_at and created_at from now(); for every writer stamps row_count and the sha256 digests of the rows and the filters; admits a restatement only of a snapshot of the same report, period and filters in the same scope.';
REVOKE EXECUTE ON FUNCTION rpt.guard_report_snapshot() FROM PUBLIC;

CREATE TRIGGER tg_report_snapshots_guard BEFORE INSERT OR UPDATE ON rpt.report_snapshots
  FOR EACH ROW EXECUTE FUNCTION rpt.guard_report_snapshot();

ALTER TABLE rpt.report_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE rpt.report_snapshots FORCE  ROW LEVEL SECURITY;
-- Read: tenant and branch reach, rpt.report.read, and every frozen dataset code,
-- each in the snapshot's own company and branch.
CREATE POLICY sel_report_snapshots_scope ON rpt.report_snapshots FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
    AND iam.has_permission_in_scope('rpt.report.read', company_id, branch_id, NULL)
    AND NOT EXISTS (
      SELECT 1 FROM unnest(required_permissions) AS required(code)
       WHERE NOT iam.has_permission_in_scope(required.code, company_id, branch_id, NULL)));
-- Write: the same, plus rpt.export, and the saver is the signed-in person.
CREATE POLICY ins_report_snapshots_scope ON rpt.report_snapshots FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
    AND generated_by = iam.current_user_id()
    AND iam.has_permission_in_scope('rpt.export', company_id, branch_id, NULL)
    AND iam.has_permission_in_scope('rpt.report.read', company_id, branch_id, NULL)
    AND NOT EXISTS (
      SELECT 1 FROM unnest(required_permissions) AS required(code)
       WHERE NOT iam.has_permission_in_scope(required.code, company_id, branch_id, NULL)));
GRANT SELECT, INSERT ON rpt.report_snapshots TO app_runtime;
GRANT SELECT ON rpt.report_snapshots TO app_readonly;

-- ----------------------------------------------------------------------------
-- Exact inverse (rehearsal copy only — refused once a snapshot exists)
--
--   DO $$ BEGIN
--     IF EXISTS (SELECT 1 FROM rpt.report_snapshots) THEN
--       RAISE EXCEPTION 'report snapshots exist; this migration is forward-only';
--     END IF;
--   END $$;
--   DROP TABLE rpt.report_snapshots;
--   DROP FUNCTION rpt.guard_report_snapshot();
-- ----------------------------------------------------------------------------
