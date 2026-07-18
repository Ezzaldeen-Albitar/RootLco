-- ============================================================================
-- Phase: 1-4 — Identity, Authorization, Security, and Audit Database
-- Migration: generic status history and status evidence
-- Tasks: P1-04-DB-018, P1-04-DB-019
-- Owner module: shared
--
-- Purpose
--   A reusable append-only status-transition log any module can write to, plus
--   a placeholder for evidence references. P1-04-DB-019 (idempotency) is already
--   satisfied by shared.idempotency_keys (Phase 1-3) — this migration creates NO
--   second idempotency table.
--
-- Dependencies
--   Phase 1-3 org.tenants, 0002 (iam context readers), and the EXISTING
--   shared.idempotency_keys (reused, unchanged).
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once
--   history exists (it is evidence). Recorded in
--   docs/database/phase-1-4-migration-classification.md.
--
-- Security implications
--   * Append-only; actor_id and occurred_at are server-stamped
--     (shared.stamp_status_history) so attribution cannot be forged or
--     backdated. Runtime holds SELECT only.
--   * status_evidence.evidence_ref is a PLACEHOLDER string — there is NO foreign
--     key to a Phase-1-5 document table (that arrives in its own phase).
--
-- Idempotency reconciliation (P1-04-DB-019): shared.idempotency_keys already
--   provides a generic (tenant_id, operation, idempotency_key) scope with
--   fingerprint match/conflict, response snapshot, and expiry. IAM operations
--   reuse it as-is; status = ALREADY SATISFIED. No duplicate is created.
--
-- Objects created
--   Tables:    shared.status_history, shared.status_evidence
--   Functions: shared.stamp_status_history()
--   Triggers:  tg_status_history_stamp
--   Policies:  sel_status_history_tenant, sel_status_evidence_tenant
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. shared.status_history (P1-04-DB-018) — generic append-only transitions.
-- ----------------------------------------------------------------------------
CREATE TABLE shared.status_history (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  entity_type    text        NOT NULL,
  entity_id      uuid        NOT NULL,
  from_state     text        NULL,
  to_state       text        NOT NULL,
  reason         text        NOT NULL,
  actor_id       uuid        NOT NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid        NULL,

  CONSTRAINT pk_status_history PRIMARY KEY (id),
  CONSTRAINT uq_status_history_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_status_history_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT ck_status_history_state_change CHECK (from_state IS DISTINCT FROM to_state),
  CONSTRAINT ck_status_history_entity_type_not_blank CHECK (btrim(entity_type) <> ''),
  CONSTRAINT ck_status_history_reason_not_blank CHECK (btrim(reason) <> '')
);

COMMENT ON TABLE shared.status_history IS
  'Generic append-only status-transition log (P1-04-DB-018). Any module records (entity_type, entity_id) transitions here. actor_id and occurred_at are server-stamped; no application role holds UPDATE or DELETE.';

CREATE INDEX ix_status_history_entity ON shared.status_history (tenant_id, entity_type, entity_id, occurred_at);

CREATE OR REPLACE FUNCTION shared.stamp_status_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.actor_id := iam.current_user_id();
  IF NEW.actor_id IS NULL THEN
    RAISE EXCEPTION 'status history requires an actor in the session context'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.occurred_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION shared.stamp_status_history() IS
  'BEFORE INSERT trigger on shared.status_history: server-stamps actor_id (from iam.current_user_id(); raises if unset) and occurred_at so attribution cannot be forged or backdated.';

REVOKE EXECUTE ON FUNCTION shared.stamp_status_history() FROM PUBLIC;

CREATE TRIGGER tg_status_history_stamp
  BEFORE INSERT ON shared.status_history
  FOR EACH ROW EXECUTE FUNCTION shared.stamp_status_history();

-- ----------------------------------------------------------------------------
-- 2. shared.status_evidence (P1-04-DB-018) — evidence-reference placeholder.
-- ----------------------------------------------------------------------------
CREATE TABLE shared.status_evidence (
  id                uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  status_history_id uuid        NOT NULL,
  evidence_type     text        NOT NULL,
  evidence_ref      text        NOT NULL,
  note              text        NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        NOT NULL,

  CONSTRAINT pk_status_evidence PRIMARY KEY (id),
  CONSTRAINT fk_status_evidence_history
    FOREIGN KEY (tenant_id, status_history_id) REFERENCES shared.status_history (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT ck_status_evidence_type_not_blank CHECK (btrim(evidence_type) <> ''),
  CONSTRAINT ck_status_evidence_ref_not_blank CHECK (btrim(evidence_ref) <> '')
);

COMMENT ON TABLE shared.status_evidence IS
  'Evidence references for a status transition (P1-04-DB-018). evidence_ref is a PLACEHOLDER string — NO foreign key to a Phase-1-5 document table exists yet, by design.';

CREATE INDEX ix_status_evidence_history ON shared.status_evidence (tenant_id, status_history_id);

-- ----------------------------------------------------------------------------
-- 3. Row-Level Security — enabled AND forced; default deny.
-- ----------------------------------------------------------------------------
ALTER TABLE shared.status_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.status_history  FORCE  ROW LEVEL SECURITY;
ALTER TABLE shared.status_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.status_evidence FORCE  ROW LEVEL SECURITY;

CREATE POLICY sel_status_history_tenant ON shared.status_history
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY sel_status_evidence_tenant ON shared.status_evidence
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());

-- ----------------------------------------------------------------------------
-- 4. Grants — explicit, minimal (SELECT only).
-- ----------------------------------------------------------------------------
GRANT SELECT ON shared.status_history  TO app_runtime, app_readonly;
GRANT SELECT ON shared.status_evidence TO app_runtime, app_readonly;
-- Deliberately ABSENT: INSERT/UPDATE/DELETE for both roles on both tables.
