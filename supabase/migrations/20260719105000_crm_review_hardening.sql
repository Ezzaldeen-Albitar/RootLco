-- ============================================================================
-- Phase: 1-6 — CRM and Business Partner Database
-- Migration: forward hardening from the Wave 7 owner-authorized red-team review
-- Tasks: P1-06-SEC-004 (identifier gate), P1-06-DB-016/017 (merge), P1-06-DB-019 (timeline)
-- Owner module: crm
--
-- Rollback classification: roll-forward-only once rows exist; rollback-safe
--   while the affected tables are empty. Adds IDENTITY columns, one UNIQUE
--   constraint, one trigger, and tightens policy/function checks only — no data
--   rewrite.
--
-- Purpose
--   Forward corrections for findings from the Wave 7 owner-authorized
--   technical/security self-review (five-lens adversarial/red-team pass, NOT an
--   independent third-party review). Migrations are immutable once merged; these
--   are new forward changes, not edits to prior files.
--
--   1. Restricted-identifier existence oracle. ins_partner_identifiers_tenant
--      gated only tenant_id, while sel_/upd_ (and the sibling
--      partner_sensitive_attributes INSERT policy) gate on
--      iam.has_permission('iam.sensitive.view'). An app_runtime session WITHOUT
--      that permission could INSERT a national_id/registration/tax row it can
--      never read and infer existence from a 23505. Gate the restricted-INSERT
--      path to match sel_/upd_, closing the DB-layer oracle now.
--   2. Single-merge-per-source. crm.partner_merges had only a non-unique index
--      on (tenant_id, source_partner_id); a stray/duplicate insert could record
--      the same source merged twice. Enforce it with a UNIQUE constraint (a
--      source can only ever be merged once — it becomes frozen).
--   3. Merge-into-soft-deleted survivor. guard_business_partner_merge validated
--      the survivor is same-tenant and not itself merged, but not that it is
--      live. Reject a redirect into a soft-deleted survivor.
--   4. Deterministic same-tx ordering, remainder. The Wave 5 hardening added a
--      monotonic seq to block/consent history; apply the same to
--      partner_status_history and timeline_events (occurred_at = now() is
--      constant within a transaction, so same-tx events need a total order for
--      deterministic reads/keyset pagination).
--   5. Timeline attribution integrity. timeline_events had a direct app_runtime
--      INSERT grant with no server-stamp, so actor_id/occurred_at were
--      caller-controlled on the direct path. Add a BEFORE INSERT trigger that
--      server-stamps actor_id := iam.current_user_id() and occurred_at := now(),
--      matching the emit path and the append-only history tables. (Full
--      lock-out of direct writes would require SECURITY DEFINER, which this
--      project forbids; event_type/title remain caller-shaped on the direct
--      path — the customer-facing timeline is distinct from the Phase-1-16
--      forensic audit trail.)
--
-- Dependencies: 20260719091000 (partner_identifiers policies), 20260719101000
--   (partner_merges), 20260719094000 (partner_status_history), 20260719102000
--   (timeline_events + emit), 20260719104000 (guard_business_partner_merge).
--
-- Security implications
--   * Strictly reduces accepted input surface; no new privilege, no relaxation.
--   * Recreated function/trigger keep append-only, SECURITY INVOKER posture.
--
-- Objects created/changed
--   Policies:   ins_partner_identifiers_tenant (recreated with sensitive gate)
--   Constraints: crm.partner_merges uq_partner_merges_source (UNIQUE)
--   Indexes:    ix_partner_merges_source (dropped; superseded by the UNIQUE index),
--               ix_timeline_events_partner_time / ix_partner_status_history_partner_time (recreated incl. seq)
--   Columns:    crm.partner_status_history.seq, crm.timeline_events.seq (IDENTITY)
--   Functions:  crm.guard_business_partner_merge() (rejects soft-deleted survivor),
--               crm.stamp_timeline_event() (NEW — server-stamp)
--   Triggers:   tg_timeline_events_stamp (NEW — BEFORE INSERT)
-- ============================================================================

-- 1. Gate restricted-identifier INSERT on the sensitive-view permission.
DROP POLICY ins_partner_identifiers_tenant ON crm.partner_identifiers;
CREATE POLICY ins_partner_identifiers_tenant ON crm.partner_identifiers
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (classification = 'internal' OR iam.has_permission('iam.sensitive.view'))
  );

-- 2. Single-merge-per-source at the storage layer (replaces the non-unique index).
DROP INDEX IF EXISTS crm.ix_partner_merges_source;
ALTER TABLE crm.partner_merges
  ADD CONSTRAINT uq_partner_merges_source UNIQUE (tenant_id, source_partner_id);

-- 3. Reject a redirect into a soft-deleted survivor (extends the merge guard).
CREATE OR REPLACE FUNCTION crm.guard_business_partner_merge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_survivor_status  text;
  v_survivor_deleted timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.lifecycle_status = 'merged' THEN
    RAISE EXCEPTION
      'crm.business_partners %: a merged partner is read-only (redirect resolution and audit only)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.merged_into_id IS NOT NULL THEN
    RAISE EXCEPTION
      'crm.business_partners %: a partner cannot be created already merged (merge is only ever an update)', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.merged_into_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.merged_into_id IS DISTINCT FROM NEW.merged_into_id) THEN
    SELECT bp.lifecycle_status, bp.deleted_at INTO v_survivor_status, v_survivor_deleted
      FROM crm.business_partners bp
      WHERE bp.tenant_id = NEW.tenant_id AND bp.id = NEW.merged_into_id
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'crm.business_partners %: merge survivor % not found in tenant', NEW.id, NEW.merged_into_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_survivor_status = 'merged' THEN
      RAISE EXCEPTION
        'crm.business_partners %: merge survivor % is itself merged (redirect cycle/chain-into-merged not allowed)', NEW.id, NEW.merged_into_id
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_survivor_deleted IS NOT NULL THEN
      RAISE EXCEPTION
        'crm.business_partners %: merge survivor % is soft-deleted (cannot redirect into a deleted partner)', NEW.id, NEW.merged_into_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 4. Monotonic ordering columns for the remaining order-sensitive tables.
ALTER TABLE crm.partner_status_history ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE crm.timeline_events ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY;

DROP INDEX crm.ix_partner_status_history_partner_time;
CREATE INDEX ix_partner_status_history_partner_time
  ON crm.partner_status_history (tenant_id, partner_id, occurred_at DESC, seq DESC);

DROP INDEX crm.ix_timeline_events_partner_time;
CREATE INDEX ix_timeline_events_partner_time
  ON crm.timeline_events (tenant_id, partner_id, occurred_at DESC, seq DESC);

-- 5. Server-stamp timeline attribution and time, even on the direct-insert path.
CREATE OR REPLACE FUNCTION crm.stamp_timeline_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.actor_id := iam.current_user_id();
  NEW.occurred_at := now();
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION crm.stamp_timeline_event() FROM PUBLIC;

CREATE TRIGGER tg_timeline_events_stamp
  BEFORE INSERT ON crm.timeline_events
  FOR EACH ROW EXECUTE FUNCTION crm.stamp_timeline_event();
