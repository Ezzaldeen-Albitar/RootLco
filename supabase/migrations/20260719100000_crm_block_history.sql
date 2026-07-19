-- ============================================================================
-- Phase: 1-6 — CRM and Business Partner Database
-- Migration: append-only block/unblock history with lifecycle coherence
-- Tasks: P1-06-DB-015
-- Owner module: crm
--
-- Purpose
--   crm.customer_block_history — the append-only, server-attributed record of
--   block/unblock decisions (mandatory reason, optional same-partner restriction
--   and approval reference). Plus the smallest atomic DB primitive keeping the
--   partner's lifecycle_status and its block history coherent: a partner cannot
--   become 'blocked' (or leave 'blocked') without a matching latest block-history
--   row written first in the same transaction. Full orchestration is Phase 1-16.
--
-- Dependencies
--   crm.business_partners, crm.customer_restrictions; shared.stamp_status_history
--   (reused); iam.current_tenant_id / iam.current_user_id.
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once rows exist.
--
-- Security implications
--   * Append-only (GRANT SELECT, INSERT only -> 42501); actor_id/occurred_at
--     server-stamped (a caller cannot forge attribution or backdate).
--   * A new BEFORE UPDATE trigger on crm.business_partners enforces block <->
--     history coherence (history-first ordering; latest-state check). The
--     'blocked' -> 'merged' transition is exempt (handled by the merge guard).
--   * ENABLE + FORCE RLS; tenant-scoped.
--
-- Objects created
--   Tables:    crm.customer_block_history
--   Functions: crm.guard_partner_block_coherence()
--   Triggers:  tg_customer_block_history_stamp, tg_business_partners_block_coherence
--   Policies:  sel_customer_block_history_tenant, ins_customer_block_history_tenant
--   Indexes:   ix_customer_block_history_partner_time
-- ============================================================================

CREATE TABLE crm.customer_block_history (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  partner_id     uuid        NOT NULL,
  action         text        NOT NULL,
  reason         text        NOT NULL,
  restriction_id uuid        NULL,
  approval_ref   text        NULL,
  actor_id       uuid        NOT NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  correlation_id uuid        NULL,

  CONSTRAINT pk_customer_block_history PRIMARY KEY (id),
  CONSTRAINT fk_customer_block_history_partner
    FOREIGN KEY (tenant_id, partner_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  -- Same-partner restriction (nullable, MATCH SIMPLE).
  CONSTRAINT fk_customer_block_history_restriction
    FOREIGN KEY (tenant_id, partner_id, restriction_id)
    REFERENCES crm.customer_restrictions (tenant_id, partner_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_customer_block_history_action CHECK (action IN ('blocked', 'unblocked')),
  CONSTRAINT ck_customer_block_history_reason_not_blank CHECK (btrim(reason) <> ''),
  CONSTRAINT ck_customer_block_history_approval_not_blank
    CHECK (approval_ref IS NULL OR btrim(approval_ref) <> '')
);

COMMENT ON TABLE crm.customer_block_history IS
  'Phase 1-6 append-only block/unblock history (P1-06-DB-015). Server-attributed; coherence with business_partners.lifecycle_status enforced by trigger.';

CREATE INDEX ix_customer_block_history_partner_time
  ON crm.customer_block_history (tenant_id, partner_id, occurred_at DESC);

CREATE TRIGGER tg_customer_block_history_stamp
  BEFORE INSERT ON crm.customer_block_history
  FOR EACH ROW EXECUTE FUNCTION shared.stamp_status_history();

ALTER TABLE crm.customer_block_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.customer_block_history FORCE ROW LEVEL SECURITY;
CREATE POLICY sel_customer_block_history_tenant ON crm.customer_block_history
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_customer_block_history_tenant ON crm.customer_block_history
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT ON crm.customer_block_history TO app_runtime;
GRANT SELECT ON crm.customer_block_history TO app_readonly;

-- ---------------------------------------------------------------------------
-- Block <-> history coherence. On a change in blocked-ness, require the latest
-- block-history row to match (history-first ordering). 'blocked' -> 'merged' is
-- exempt (the merge path ends the lifecycle; the merge guard owns it).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm.guard_partner_block_coherence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_latest text;
BEGIN
  IF OLD.lifecycle_status <> 'blocked' AND NEW.lifecycle_status = 'blocked' THEN
    SELECT action INTO v_latest FROM crm.customer_block_history
      WHERE tenant_id = NEW.tenant_id AND partner_id = NEW.id
      ORDER BY occurred_at DESC, id DESC LIMIT 1;
    IF v_latest IS DISTINCT FROM 'blocked' THEN
      RAISE EXCEPTION 'crm.business_partners %: blocking requires a matching block-history row', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF OLD.lifecycle_status = 'blocked' AND NEW.lifecycle_status NOT IN ('blocked', 'merged') THEN
    SELECT action INTO v_latest FROM crm.customer_block_history
      WHERE tenant_id = NEW.tenant_id AND partner_id = NEW.id
      ORDER BY occurred_at DESC, id DESC LIMIT 1;
    IF v_latest IS DISTINCT FROM 'unblocked' THEN
      RAISE EXCEPTION 'crm.business_partners %: unblocking requires a matching unblock-history row', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION crm.guard_partner_block_coherence() FROM PUBLIC;

CREATE TRIGGER tg_business_partners_block_coherence
  BEFORE UPDATE ON crm.business_partners
  FOR EACH ROW EXECUTE FUNCTION crm.guard_partner_block_coherence();
