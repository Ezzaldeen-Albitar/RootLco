-- ============================================================================
-- Phase: 1-9 — Work Order, Diagnostics, and Technician Database
-- Migration: append-only Work Order status history + emitter
-- Tasks: P1-09-DB-006 (WO status history)
-- Owner module: wo
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once
--   rows exist (evidence). Forward-only.
--
-- Purpose
--   wo.work_order_status_history is the append-only ledger of work-order state
--   transitions, trigger-emitted from wo.work_orders (one row per real change),
--   coherence-guarded to the live master, server-stamped (actor + time). SELECT +
--   INSERT grants only; no UPDATE/DELETE path.
--
-- Dependencies
--   wo.work_orders; shared.stamp_status_history; iam.current_tenant_id/allowed_*.
--
-- Objects created
--   Tables:    wo.work_order_status_history
--   Functions: wo.guard_work_order_status_coherence(), wo.emit_work_order_status_history()
--   Triggers:  tg_work_order_status_history_coherence, tg_work_order_status_history_stamp,
--              tg_work_orders_status_history
--   Policies:  sel/ins_work_order_status_history_scope
-- ============================================================================

CREATE TABLE wo.work_order_status_history (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  company_id     uuid        NOT NULL,
  branch_id      uuid        NOT NULL,
  work_order_id  uuid        NOT NULL,
  from_state     text        NULL,
  to_state       text        NOT NULL,
  reason         text        NULL,
  correlation_id uuid        NULL,
  actor_id       uuid        NOT NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  seq            bigint      GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT pk_work_order_status_history PRIMARY KEY (id),
  CONSTRAINT fk_work_order_status_history_wo
    FOREIGN KEY (tenant_id, company_id, branch_id, work_order_id)
    REFERENCES wo.work_orders (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_work_order_status_history_state_change CHECK (from_state IS DISTINCT FROM to_state),
  CONSTRAINT ck_work_order_status_history_to_format CHECK (to_state ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_work_order_status_history_from_format CHECK (from_state IS NULL OR from_state ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_work_order_status_history_reason_not_blank CHECK (reason IS NULL OR btrim(reason) <> '')
);
COMMENT ON TABLE wo.work_order_status_history IS
  'Phase 1-9 append-only Work Order status ledger (P1-09-DB-006). Trigger-emitted from wo.work_orders (one row per real change); coherence-guarded to the live master; server-stamped. SELECT+INSERT only.';

CREATE INDEX ix_work_order_status_history_wo
  ON wo.work_order_status_history
     (tenant_id, company_id, branch_id, work_order_id, occurred_at DESC, seq DESC);

CREATE OR REPLACE FUNCTION wo.guard_work_order_status_coherence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_current text;
BEGIN
  SELECT state INTO v_current FROM wo.work_orders
  WHERE tenant_id = NEW.tenant_id AND company_id = NEW.company_id
    AND branch_id = NEW.branch_id AND id = NEW.work_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'work order % not found in this scope', NEW.work_order_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_current IS DISTINCT FROM NEW.to_state THEN
    RAISE EXCEPTION 'status history to_state % does not match the work order current state %',
      NEW.to_state, v_current USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION wo.guard_work_order_status_coherence() IS
  'BEFORE INSERT on wo.work_order_status_history: rejects a row whose to_state does not equal the work order current state (blocks incoherent/forged inserts).';
REVOKE EXECUTE ON FUNCTION wo.guard_work_order_status_coherence() FROM PUBLIC;

CREATE TRIGGER tg_work_order_status_history_coherence
  BEFORE INSERT ON wo.work_order_status_history
  FOR EACH ROW EXECUTE FUNCTION wo.guard_work_order_status_coherence();
CREATE TRIGGER tg_work_order_status_history_stamp
  BEFORE INSERT ON wo.work_order_status_history
  FOR EACH ROW EXECUTE FUNCTION shared.stamp_status_history();

ALTER TABLE wo.work_order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE wo.work_order_status_history FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_work_order_status_history_scope ON wo.work_order_status_history FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_work_order_status_history_scope ON wo.work_order_status_history FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
GRANT SELECT, INSERT ON wo.work_order_status_history TO app_runtime;
GRANT SELECT ON wo.work_order_status_history TO app_readonly;

CREATE OR REPLACE FUNCTION wo.emit_work_order_status_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_correlation uuid := NULLIF(current_setting('app.correlation_id', true), '')::uuid;
  v_reason      text := NULLIF(btrim(current_setting('app.status_reason', true)), '');
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    INSERT INTO wo.work_order_status_history
      (tenant_id, company_id, branch_id, work_order_id, from_state, to_state, reason, correlation_id)
    VALUES
      (NEW.tenant_id, NEW.company_id, NEW.branch_id, NEW.id,
       OLD.state, NEW.state, v_reason, v_correlation);
  END IF;
  RETURN NULL;
END;
$$;
COMMENT ON FUNCTION wo.emit_work_order_status_history() IS
  'AFTER UPDATE trigger on wo.work_orders: writes one append-only status-history row when state actually changes, same transaction.';
REVOKE EXECUTE ON FUNCTION wo.emit_work_order_status_history() FROM PUBLIC;

CREATE TRIGGER tg_work_orders_status_history
  AFTER UPDATE ON wo.work_orders
  FOR EACH ROW EXECUTE FUNCTION wo.emit_work_order_status_history();
