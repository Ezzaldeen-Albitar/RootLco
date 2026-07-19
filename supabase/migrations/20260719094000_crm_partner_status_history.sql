-- ============================================================================
-- Phase: 1-6 — CRM and Business Partner Database
-- Migration: append-only partner lifecycle/commercial status history
-- Tasks: P1-06-DB-006
-- Owner module: crm
--
-- Purpose
--   Create crm.partner_status_history — the append-only, attributable record of
--   every lifecycle and commercial status transition of a business partner.
--   This IS the Phase 1-6 DB-layer attributable change record (forensic
--   iam.audit_append integration is Phase-1-16 backend — the runtime role
--   deliberately holds no audit grant). Attribution is server-stamped, so a
--   caller cannot forge the actor or backdate the timestamp.
--
-- Dependencies
--   crm.business_partners; shared.stamp_status_history (20260718096000) —
--   reused verbatim; iam.current_tenant_id / iam.current_user_id.
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once history rows exist.
--
-- Security implications
--   * Append-only: GRANT SELECT, INSERT only (no UPDATE/DELETE grant, no upd/del
--     policy) -> a mutation attempt fails with SQLSTATE 42501.
--   * BEFORE INSERT stamp (shared.stamp_status_history) sets actor_id :=
--     iam.current_user_id() (RAISE if NULL) and occurred_at := now(); caller
--     values for these are ignored (Wave 1 C2 finding — otherwise runtime, which
--     holds INSERT, could spoof attribution / backdate).
--   * from_state IS DISTINCT FROM to_state prevents a no-op update writing false
--     history; reason is mandatory and non-blank.
--   * ENABLE + FORCE RLS; tenant-scoped read/insert policies.
--
-- Objects created
--   Tables:    crm.partner_status_history
--   Triggers:  tg_partner_status_history_stamp
--   Policies:  sel_partner_status_history_tenant, ins_partner_status_history_tenant
--   Indexes:   ix_partner_status_history_partner_time
-- ============================================================================

CREATE TABLE crm.partner_status_history (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  partner_id     uuid        NOT NULL,
  status_kind    text        NOT NULL,
  from_state     text        NULL,
  to_state       text        NOT NULL,
  reason         text        NOT NULL,
  actor_id       uuid        NOT NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid        NULL,

  CONSTRAINT pk_partner_status_history PRIMARY KEY (id),
  CONSTRAINT fk_partner_status_history_partner
    FOREIGN KEY (tenant_id, partner_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_partner_status_history_kind
    CHECK (status_kind IN ('lifecycle', 'commercial')),
  -- No no-op history rows.
  CONSTRAINT ck_partner_status_history_state_change
    CHECK (from_state IS DISTINCT FROM to_state),
  -- Valid states per kind, on both the from (nullable) and to sides.
  CONSTRAINT ck_partner_status_history_states CHECK (
    (
      status_kind = 'lifecycle'
      AND to_state IN ('prospect', 'active', 'inactive', 'blocked', 'merged')
      AND (from_state IS NULL OR from_state IN ('prospect', 'active', 'inactive', 'blocked', 'merged'))
    )
    OR (
      status_kind = 'commercial'
      AND to_state IN ('normal', 'watch', 'hold')
      AND (from_state IS NULL OR from_state IN ('normal', 'watch', 'hold'))
    )
  ),
  CONSTRAINT ck_partner_status_history_reason_not_blank CHECK (btrim(reason) <> '')
);

COMMENT ON TABLE crm.partner_status_history IS
  'Phase 1-6 append-only partner lifecycle/commercial status history (P1-06-DB-006). Attribution is server-stamped; this is the DB-layer attributable record (forensic audit is Phase 1-16).';

CREATE INDEX ix_partner_status_history_partner_time
  ON crm.partner_status_history (tenant_id, partner_id, occurred_at DESC);

-- Server-stamps actor_id + occurred_at (reused shared primitive).
CREATE TRIGGER tg_partner_status_history_stamp
  BEFORE INSERT ON crm.partner_status_history
  FOR EACH ROW EXECUTE FUNCTION shared.stamp_status_history();

ALTER TABLE crm.partner_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.partner_status_history FORCE ROW LEVEL SECURITY;
CREATE POLICY sel_partner_status_history_tenant ON crm.partner_status_history
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_partner_status_history_tenant ON crm.partner_status_history
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());

GRANT SELECT, INSERT ON crm.partner_status_history TO app_runtime;
GRANT SELECT ON crm.partner_status_history TO app_readonly;
