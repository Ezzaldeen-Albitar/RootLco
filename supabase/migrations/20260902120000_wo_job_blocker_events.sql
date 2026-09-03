-- ============================================================================
-- P1-29-W6 — wo.job_blocker_events, the blocker record (Owner requirement 13).
--
-- Rollback classification: DESTRUCTIVE-AFTER-FIRST-WRITE. DROP TABLE is clean and
-- lossless until the first event exists; after that it destroys a record nothing
-- else in the platform holds — a blocker is not derivable from job state, from the
-- status ledger or from the work log. There is no down script, and the window
-- closes the first time a technician raises one.
--
-- Closes the P1-29 canonical plan's W6 second half and reconciles `VHM-16`
-- (docs/product/README.md): "No blocker record … A blocker is currently expressed
-- as `awaiting_parts` or `awaiting_customer` with a mandatory reason". That
-- expression is a WORK-ORDER STATE, and it stays exactly what it is. This table
-- records the fact a job is blocked and why, and the fact it was unblocked and
-- how, WITHOUT moving any state — so a technician can say "waiting for a part"
-- on one job of a three-job order while the order and the other two jobs carry
-- on, which a state on the order cannot express. Before this table:
--
--   grep -rniE "CREATE TABLE (wo|tech|qms|dia)\.[a-z_]*block" supabase/migrations
--
-- returned nothing. The closure "blockers" B1..B6 are COMPUTED closure-gate
-- reasons and not a record; nothing was conflated.
--
-- ## An EVENT ledger, not a row with a status column
--
-- Two event kinds, `raised` and `resolved`, each an append-only row. A resolution
-- REFERENCES the raise it resolves, so the pair is the record and the blocker's
-- status is DERIVED (open while no resolution references the raise). This is
-- selected over a mutable `resolved_at` column on CONTAINMENT grounds: an
-- append-only table needs no UPDATE grant, no record_version, no soft delete and
-- no touch trigger, which is the shape wo.job_work_logs and wo.job_evidence
-- already have and the shape a record of who said what, when, should have.
--
-- ## One resolution per raise, at the CONSTRAINT layer
--
-- `uq_job_blocker_events_single_resolution` is a partial unique index over
-- `resolves_event_id` for `resolved` rows, so two concurrent resolutions of one
-- raise are a `23505` the API maps to a conflict — no row lock, which an
-- append-only grant could not take anyway. `ck_job_blocker_events_reference`
-- makes a raise carry no reference and a resolution carry one, and the guard
-- below makes the reference point at a RAISE of the SAME job.
--
-- ## Append-only, at the GRANT layer
--
-- SELECT and INSERT only. No UPDATE, no DELETE, no record_version, no updated_*,
-- no deleted_*. A blocker record that can be edited is not a record.
--
-- structuralTotals moves (one table, one function, one trigger, two policies) and
-- cannot be reproduced on the Supabase database itself; the figure is taken from
-- a two-database replay in the container, as the Wave B and Wave C notes in
-- .github/ci-baselines/schema-baseline.json describe.
-- ============================================================================

CREATE TABLE wo.job_blocker_events (
  id                uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  company_id        uuid        NOT NULL,
  branch_id         uuid        NOT NULL,
  job_id            uuid        NOT NULL,
  event             text        NOT NULL,
  resolves_event_id uuid        NULL,
  note              text        NOT NULL,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        NOT NULL,

  CONSTRAINT pk_job_blocker_events PRIMARY KEY (id),
  CONSTRAINT uq_job_blocker_events_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  -- COMPOSITE, so a cross-branch parentage is structurally impossible rather
  -- than merely unwritten — the same shape every other child in this domain uses.
  CONSTRAINT fk_job_blocker_events_job
    FOREIGN KEY (tenant_id, company_id, branch_id, job_id)
    REFERENCES wo.jobs (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_job_blocker_events_resolves
    FOREIGN KEY (tenant_id, company_id, branch_id, resolves_event_id)
    REFERENCES wo.job_blocker_events (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_job_blocker_events_event CHECK (event IN ('raised', 'resolved')),
  CONSTRAINT ck_job_blocker_events_note_not_blank CHECK (btrim(note) <> ''),
  CONSTRAINT ck_job_blocker_events_reference CHECK (
    (event = 'raised' AND resolves_event_id IS NULL)
    OR (event = 'resolved' AND resolves_event_id IS NOT NULL))
);

COMMENT ON TABLE wo.job_blocker_events IS
  'P1-29-W6 blocker record for a job (Owner requirement 13, VHM-16). An append-only EVENT ledger: a raised row states why the job is blocked, a resolved row references the raise it resolves and states how; the blocker''s status is derived (open while no resolution references the raise). SELECT + INSERT to app_runtime and nothing else. Written under tech.labor.record, because a blocker is the worker''s own statement about the work in front of them, as the work log is. Moves no state: awaiting_parts / awaiting_customer remain work-order states.';
COMMENT ON COLUMN wo.job_blocker_events.resolves_event_id IS
  'For a resolved event, the raised event it resolves — a raise of the SAME job, enforced by wo.guard_job_blocker_event; at most one resolution per raise, enforced by uq_job_blocker_events_single_resolution. NULL on a raised event.';

-- Zero unindexed foreign keys is a MEASURED property of these four schemas. Two
-- new FKs, two covering indexes, and the property is preserved.
CREATE INDEX ix_job_blocker_events_job
  ON wo.job_blocker_events (tenant_id, company_id, branch_id, job_id);
CREATE INDEX ix_job_blocker_events_resolves
  ON wo.job_blocker_events (tenant_id, company_id, branch_id, resolves_event_id);
CREATE UNIQUE INDEX uq_job_blocker_events_single_resolution
  ON wo.job_blocker_events (resolves_event_id) WHERE event = 'resolved';

-- ----------------------------------------------------------------------------
-- Guard: a resolution references a RAISE, of the SAME job. BEFORE INSERT.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION wo.guard_job_blocker_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_event text;
  v_job_id uuid;
BEGIN
  IF NEW.event = 'resolved' THEN
    SELECT e.event, e.job_id INTO v_event, v_job_id
      FROM wo.job_blocker_events e
     WHERE e.tenant_id = NEW.tenant_id AND e.company_id = NEW.company_id
       AND e.branch_id = NEW.branch_id AND e.id = NEW.resolves_event_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'blocker % is not visible in this scope', NEW.resolves_event_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_event <> 'raised' THEN
      RAISE EXCEPTION 'a resolution must reference a raised blocker, not a % event', v_event
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_job_id <> NEW.job_id THEN
      RAISE EXCEPTION 'blocker % belongs to another job', NEW.resolves_event_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION wo.guard_job_blocker_event() IS
  'BEFORE INSERT on wo.job_blocker_events: a resolved event must reference a raised event of the same job. A raise carries no reference (ck_job_blocker_events_reference).';
REVOKE EXECUTE ON FUNCTION wo.guard_job_blocker_event() FROM PUBLIC;

CREATE TRIGGER tg_job_blocker_events_guard BEFORE INSERT ON wo.job_blocker_events
  FOR EACH ROW EXECUTE FUNCTION wo.guard_job_blocker_event();

ALTER TABLE wo.job_blocker_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE wo.job_blocker_events FORCE  ROW LEVEL SECURITY;

CREATE POLICY sel_job_blocker_events_scope ON wo.job_blocker_events FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));

CREATE POLICY ins_job_blocker_events_scope ON wo.job_blocker_events FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));

-- No UPDATE policy and no DELETE policy, deliberately: there is no grant for
-- either, and adding a policy for an ungranted verb would suggest one exists.
GRANT SELECT, INSERT ON wo.job_blocker_events TO app_runtime;
GRANT SELECT ON wo.job_blocker_events TO app_readonly;
