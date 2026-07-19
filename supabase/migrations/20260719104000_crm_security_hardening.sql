-- ============================================================================
-- Phase: 1-6 — CRM and Business Partner Database
-- Migration: forward security hardening from the Wave 5 adversarial review
-- Tasks: P1-06-SEC-002, P1-06-SEC-004
-- Owner module: crm
--
-- Rollback classification: roll-forward-only once history rows exist;
--   rollback-safe while empty. Adds IDENTITY columns and tightens
--   function/trigger validation only — no data rewrite.
--
-- Purpose
--   Forward corrections for three MEDIUM findings from the Wave 5
--   owner-authorized technical/security self-review (adversarial/red-team lens,
--   NOT an independent third-party review) of the committed schema. Migrations
--   are immutable once merged; these are new forward changes, not edits.
--
--   1. Block coherence was enforced only on UPDATE, so a partner could be
--      INSERTED already 'blocked' with no attributable block-history row. Extend
--      crm.guard_partner_block_coherence to BEFORE INSERT OR UPDATE and forbid an
--      initial lifecycle_status of 'blocked' (blocking is only ever an UPDATE
--      accompanied by a block-history row).
--   2. The merge guard validated the transition but not creation, so a partner
--      could be INSERTED already 'merged' with a redirect. Forbid creating a
--      partner already in the merged state (merge is only ever an UPDATE).
--   3. crm.jsonb_no_raw_value_keys was a shallow, case-sensitive, depth-1 check.
--      Replace it with a whole-document, case-insensitive key scan so nested or
--      differently-cased raw-value keys are also rejected. This remains a
--      defensive control; the backend sanitizer is the primary control.
--   4. Deterministic ordering: occurred_at/created_at are stamped with now()
--      (constant within a transaction), so "latest row" resolution that
--      tie-broke on a random uuid id was non-deterministic for events written in
--      the same transaction (e.g. block+unblock, or same-effective-time consents).
--      Add a monotonic IDENTITY seq to crm.customer_block_history and
--      crm.consent_history and resolve by seq, so intra-transaction order is
--      total and deterministic.
--
-- Dependencies: 20260719090000 (business_partners guards), 20260719101000
--   (jsonb_no_raw_value_keys + the match_basis/merge_summary CHECKs that call it).
--
-- Security implications
--   * Strictly reduces the accepted input surface: no new privilege, no relaxation.
--   * The recreated trigger keeps the same name (allow-list unchanged).
--
-- Objects created/changed
--   Columns:   crm.customer_block_history.seq, crm.consent_history.seq (IDENTITY)
--   Functions: crm.guard_partner_block_coherence() (INSERT path + seq ordering),
--              crm.guard_business_partner_merge() (INSERT rejection added),
--              crm.current_consent(...) (seq tie-break),
--              crm.jsonb_no_raw_value_keys(jsonb) (whole-document scan)
--   Triggers:  tg_business_partners_block_coherence recreated as BEFORE INSERT OR UPDATE
-- ============================================================================

-- 0. Monotonic ordering columns for the order-sensitive append-only tables.
ALTER TABLE crm.customer_block_history ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE crm.consent_history ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY;

-- 1. Block coherence on INSERT: a partner cannot be created already blocked.
CREATE OR REPLACE FUNCTION crm.guard_partner_block_coherence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_latest text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.lifecycle_status = 'blocked' THEN
      RAISE EXCEPTION
        'crm.business_partners %: a partner cannot be created already blocked (block only via an update with a block-history row)', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.lifecycle_status <> 'blocked' AND NEW.lifecycle_status = 'blocked' THEN
    SELECT action INTO v_latest FROM crm.customer_block_history
      WHERE tenant_id = NEW.tenant_id AND partner_id = NEW.id
      ORDER BY seq DESC LIMIT 1;
    IF v_latest IS DISTINCT FROM 'blocked' THEN
      RAISE EXCEPTION 'crm.business_partners %: blocking requires a matching block-history row', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF OLD.lifecycle_status = 'blocked' AND NEW.lifecycle_status NOT IN ('blocked', 'merged') THEN
    SELECT action INTO v_latest FROM crm.customer_block_history
      WHERE tenant_id = NEW.tenant_id AND partner_id = NEW.id
      ORDER BY seq DESC LIMIT 1;
    IF v_latest IS DISTINCT FROM 'unblocked' THEN
      RAISE EXCEPTION 'crm.business_partners %: unblocking requires a matching unblock-history row', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_business_partners_block_coherence ON crm.business_partners;
CREATE TRIGGER tg_business_partners_block_coherence
  BEFORE INSERT OR UPDATE ON crm.business_partners
  FOR EACH ROW EXECUTE FUNCTION crm.guard_partner_block_coherence();

-- 2. Merge guard on INSERT: a partner cannot be created already merged.
CREATE OR REPLACE FUNCTION crm.guard_business_partner_merge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_survivor_status text;
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
    SELECT bp.lifecycle_status INTO v_survivor_status
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
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Whole-document, case-insensitive raw-value-key scan.
CREATE OR REPLACE FUNCTION crm.jsonb_no_raw_value_keys(p jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  -- A forbidden key at ANY depth (object key followed by a colon) is rejected,
  -- case-insensitively. Conservative: also rejects such a token inside a string
  -- value, which structured refs/counts never legitimately contain.
  SELECT p::text !~* '"(value|raw|raw_value|national_id|tax|registration|date_of_birth)"\s*:';
$$;

-- 4. Deterministic current-consent resolution: greatest effective_at at or
-- before now(), tie-broken by the monotonic seq (insertion order).
CREATE OR REPLACE FUNCTION crm.current_consent(
  p_partner_id uuid, p_consent_kind text, p_channel text, p_purpose text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT status
    FROM crm.consent_history
   WHERE partner_id = p_partner_id
     AND consent_kind = p_consent_kind
     AND channel = p_channel
     AND purpose = p_purpose
     AND effective_at <= now()
   ORDER BY effective_at DESC, seq DESC
   LIMIT 1;
$$;
