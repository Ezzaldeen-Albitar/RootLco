-- ============================================================================
-- P1-32-PRE-OD-FD16A — what an invoice owed and what a receipt had left at a
-- stated moment, and the request-path instants that answer depends on
-- (Owner decision D16, end-of-period reporting, part 1: as-of amounts).
-- Owner module: sal (billing and payments read surface)
--
-- Rollback classification: ROLLBACK-SAFE. Two read functions and three trigger
--   functions with their three BEFORE INSERT triggers are added; no table, column,
--   grant, policy or row is added or changed. Forward-only — the inverse at the
--   foot of this file is for a rehearsal copy only.
--
-- Purpose
--   D16: "End-of-period reporting is defined and tested; later payments, credits,
--   reversals or backdated entries must not silently change a historical report;
--   as-of versus snapshot is documented; restatements are distinguished; no new
--   accounting subsystem."
--
--   sal.invoice_open_receivable and sal.receipt_unallocated answer for NOW: every
--   allocation, every approved credit note and every approved reversal that exists
--   when they run. A report over last month called them, so a payment allocated,
--   a credit approved or a receipt reversed today changed last month's figures with
--   nothing on the report saying so.
--
--   The two functions added here answer the same question AS OF a moment p_as_of,
--   counting only what had taken effect by then:
--     * an allocation counts when allocated_at <= p_as_of (allocations are
--       append-only, so this is exactly the allocations that existed then);
--     * a receipt counts as reversed when its approved reversal took effect at or
--       before p_as_of — reversed_at, which sal.guard_receipt_reversal_decision
--       stamps with approved_at when the reversal is approved and freezes. A receipt
--       reversed after p_as_of is the receipt it was at p_as_of;
--     * a credit note counts when it is approved and its issued_at — stamped at
--       approval by sal.guard_credit_note_decision and frozen — is <= p_as_of;
--     * an invoice issued after p_as_of, and a receipt received after it, did not
--       exist yet and answer 0, exactly as the live functions answer for a draft.
--   For p_as_of at or after the moment they run, each returns exactly what its live
--   counterpart returns: every instant they compare is stamped by now(), so nothing
--   that exists is later than now, and a receipt is 'reversed' exactly when its
--   approved reversal exists.
--
--   The instants this compares must be the instants things happened. Three of them
--   are column defaults that app_runtime could override, because app_runtime holds
--   table-level INSERT on their tables (measured on a disposable database, recorded
--   in DBCR-P1-32-PRE-OD-FD16A-001): sal.receipts.received_at,
--   sal.payment_allocations.allocated_at and sal.financial_events.occurred_at. A
--   backdated insert there would move money into a past period without anything
--   saying so — the "backdated entries" D16 names. Each is now stamped with now() on
--   INSERT by a BEFORE INSERT trigger for app_runtime and its login members,
--   whatever the writer supplied, as shared.stamp_status_history stamps
--   occurred_at. Every primitive already leaves the three to their defaults, so the
--   request path writes exactly what it wrote before. UPDATE needs no guard:
--   sal.guard_receipt_freeze freezes received_at, and app_runtime holds no UPDATE
--   on sal.payment_allocations or sal.financial_events. The credit-note and
--   reversal instants were already server-stamped and frozen (20260930110000,
--   20261002090000).
--
--   WHO IS HELD TO IT. Exactly the population the request path uses: app_runtime
--   and its login members, which are non-superuser and NOBYPASSRLS. A role that
--   bypasses row security (a superuser, or the provisioning/admin connection) is
--   not, the same boundary as svc.record_pricing_approval_policy_version
--   (20261007150000): that path writes fixture rows and already bypasses every row
--   policy on these tables.
--
-- Existing rows
--   None is read or changed by the migration. A row already written keeps its
--   instant; only a new INSERT is stamped.
--
-- Security implications
--   No new table, role, grant, policy or SECURITY DEFINER. Every function is
--   SECURITY INVOKER with an empty search_path, so the two reads see exactly the
--   rows their caller's row security admits — as the live functions do — and
--   EXECUTE is revoked from PUBLIC. The two reads are granted EXECUTE to
--   app_runtime and app_readonly, as their live counterparts are.
--
-- Dependencies
--   20260724092000 (sal.receipts, sal.payment_allocations, sal.credit_notes,
--   sal.receipt_reversals), 20260724093000 (sal.financial_events and the live
--   functions), 20260930110000 (credit-note decision stamps), 20261002090000
--   (receipt-reversal decision stamps).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. What an invoice owed at a moment.
-- ----------------------------------------------------------------------------
CREATE FUNCTION sal.invoice_open_receivable_as_of(p_invoice_id uuid, p_as_of timestamptz)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_gross numeric(18, 4); v_alloc numeric(18, 4); v_credit numeric(18, 4);
        v_status text; v_tenant uuid; v_issued timestamptz;
BEGIN
  IF p_as_of IS NULL THEN
    RAISE EXCEPTION 'sal.invoice_open_receivable_as_of: the moment is required' USING ERRCODE = 'null_value_not_allowed';
  END IF;
  SELECT i.status, i.tenant_id, i.issued_at, a.gross_total INTO v_status, v_tenant, v_issued, v_gross
    FROM sal.invoices i LEFT JOIN sal.invoice_amounts a
      ON a.tenant_id = i.tenant_id AND a.company_id = i.company_id AND a.branch_id = i.branch_id AND a.invoice_id = i.id AND a.deleted_at IS NULL
    WHERE i.id = p_invoice_id;
  IF v_status IS NULL OR v_status IN ('draft', 'void_before_issue') THEN
    RETURN 0;
  END IF;
  -- Not issued yet at that moment: it owed nothing then, as a draft owes nothing now.
  IF v_issued IS NULL OR v_issued > p_as_of THEN
    RETURN 0;
  END IF;
  v_gross := COALESCE(v_gross, 0);
  -- H-fin-1 as of the moment: an allocation of a receipt counts unless the receipt's
  -- reversal had taken effect by then.
  SELECT COALESCE(sum(pa.amount), 0) INTO v_alloc
    FROM sal.payment_allocations pa JOIN sal.receipts r
      ON r.tenant_id = pa.tenant_id AND r.company_id = pa.company_id AND r.branch_id = pa.branch_id AND r.id = pa.receipt_id
    WHERE pa.tenant_id = v_tenant AND pa.invoice_id = p_invoice_id
      AND pa.allocated_at <= p_as_of
      AND (r.status <> 'reversed' OR EXISTS (
        SELECT 1 FROM sal.receipt_reversals rr
         WHERE rr.tenant_id = r.tenant_id AND rr.company_id = r.company_id AND rr.branch_id = r.branch_id
           AND rr.original_receipt_id = r.id AND rr.approval_state = 'approved'
           AND rr.reversed_at > p_as_of));
  SELECT COALESCE(sum(amount), 0) INTO v_credit FROM sal.credit_notes
    WHERE tenant_id = v_tenant AND invoice_id = p_invoice_id AND approval_state = 'approved'
      AND issued_at <= p_as_of;
  RETURN round(v_gross - v_alloc - v_credit, 4);
END; $$;
COMMENT ON FUNCTION sal.invoice_open_receivable_as_of(uuid, timestamptz) IS
  'sal.invoice_open_receivable as of p_as_of (P1-32-PRE-OD-FD16A, Owner decision D16): 0 for a draft, a voided invoice and an invoice issued after p_as_of; otherwise gross less the allocations made at or before p_as_of of receipts not reversed by then (an approved reversal counts from its reversed_at) and less the approved credit notes issued at or before p_as_of. For p_as_of at or after now() it equals sal.invoice_open_receivable. SECURITY INVOKER: the caller''s row security applies.';
REVOKE EXECUTE ON FUNCTION sal.invoice_open_receivable_as_of(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.invoice_open_receivable_as_of(uuid, timestamptz) TO app_runtime, app_readonly;

-- ----------------------------------------------------------------------------
-- 2. What a receipt had left to allocate at a moment.
-- ----------------------------------------------------------------------------
CREATE FUNCTION sal.receipt_unallocated_as_of(p_receipt_id uuid, p_as_of timestamptz)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_amount numeric(18, 4); v_alloc numeric(18, 4); v_status text; v_tenant uuid;
        v_company uuid; v_branch uuid; v_received timestamptz;
BEGIN
  IF p_as_of IS NULL THEN
    RAISE EXCEPTION 'sal.receipt_unallocated_as_of: the moment is required' USING ERRCODE = 'null_value_not_allowed';
  END IF;
  SELECT amount, status, tenant_id, company_id, branch_id, received_at
    INTO v_amount, v_status, v_tenant, v_company, v_branch, v_received
    FROM sal.receipts WHERE id = p_receipt_id;
  IF v_amount IS NULL OR v_received > p_as_of THEN RETURN 0; END IF;
  -- Reversed by then unless the reversal took effect after the moment.
  IF v_status = 'reversed' AND NOT EXISTS (
    SELECT 1 FROM sal.receipt_reversals rr
     WHERE rr.tenant_id = v_tenant AND rr.company_id = v_company AND rr.branch_id = v_branch
       AND rr.original_receipt_id = p_receipt_id AND rr.approval_state = 'approved'
       AND rr.reversed_at > p_as_of) THEN
    RETURN 0;
  END IF;
  SELECT COALESCE(sum(amount), 0) INTO v_alloc FROM sal.payment_allocations
    WHERE tenant_id = v_tenant AND receipt_id = p_receipt_id AND allocated_at <= p_as_of;
  RETURN round(v_amount - v_alloc, 4);
END; $$;
COMMENT ON FUNCTION sal.receipt_unallocated_as_of(uuid, timestamptz) IS
  'sal.receipt_unallocated as of p_as_of (P1-32-PRE-OD-FD16A, Owner decision D16): 0 for a receipt received after p_as_of and for one whose approved reversal took effect (reversed_at) at or before p_as_of; otherwise its amount less the allocations made at or before p_as_of. For p_as_of at or after now() it equals sal.receipt_unallocated. SECURITY INVOKER: the caller''s row security applies.';
REVOKE EXECUTE ON FUNCTION sal.receipt_unallocated_as_of(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sal.receipt_unallocated_as_of(uuid, timestamptz) TO app_runtime, app_readonly;

-- ----------------------------------------------------------------------------
-- 3. The request path cannot backdate the instants the two reads compare.
-- ----------------------------------------------------------------------------
CREATE FUNCTION sal.stamp_receipt_received_at()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles
        WHERE rolname = current_user AND (rolsuper OR rolbypassrls))
     AND pg_catalog.pg_has_role(current_user, 'app_runtime', 'MEMBER') THEN
    NEW.received_at := now();
  END IF;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION sal.stamp_receipt_received_at() IS
  'BEFORE INSERT on sal.receipts (P1-32-PRE-OD-FD16A, Owner decision D16): for app_runtime and its login members, received_at is now() whatever the writer supplied, so a receipt cannot be backdated into a past period. A role that bypasses row security is not held to it.';
REVOKE EXECUTE ON FUNCTION sal.stamp_receipt_received_at() FROM PUBLIC;
CREATE TRIGGER tg_receipts_received_at BEFORE INSERT ON sal.receipts
  FOR EACH ROW EXECUTE FUNCTION sal.stamp_receipt_received_at();

CREATE FUNCTION sal.stamp_payment_allocation_allocated_at()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles
        WHERE rolname = current_user AND (rolsuper OR rolbypassrls))
     AND pg_catalog.pg_has_role(current_user, 'app_runtime', 'MEMBER') THEN
    NEW.allocated_at := now();
  END IF;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION sal.stamp_payment_allocation_allocated_at() IS
  'BEFORE INSERT on sal.payment_allocations (P1-32-PRE-OD-FD16A, Owner decision D16): for app_runtime and its login members, allocated_at is now() whatever the writer supplied, so an allocation cannot be backdated into a past period. A role that bypasses row security is not held to it.';
REVOKE EXECUTE ON FUNCTION sal.stamp_payment_allocation_allocated_at() FROM PUBLIC;
CREATE TRIGGER tg_payment_allocations_allocated_at BEFORE INSERT ON sal.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION sal.stamp_payment_allocation_allocated_at();

CREATE FUNCTION sal.stamp_financial_event_occurred_at()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles
        WHERE rolname = current_user AND (rolsuper OR rolbypassrls))
     AND pg_catalog.pg_has_role(current_user, 'app_runtime', 'MEMBER') THEN
    NEW.occurred_at := now();
  END IF;
  RETURN NEW;
END; $$;
COMMENT ON FUNCTION sal.stamp_financial_event_occurred_at() IS
  'BEFORE INSERT on sal.financial_events (P1-32-PRE-OD-FD16A, Owner decision D16): for app_runtime and its login members, occurred_at is now() whatever the writer supplied, so a financial event cannot be backdated. A role that bypasses row security is not held to it.';
REVOKE EXECUTE ON FUNCTION sal.stamp_financial_event_occurred_at() FROM PUBLIC;
CREATE TRIGGER tg_financial_events_occurred_at BEFORE INSERT ON sal.financial_events
  FOR EACH ROW EXECUTE FUNCTION sal.stamp_financial_event_occurred_at();

-- ----------------------------------------------------------------------------
-- Exact inverse (rehearsal copy only)
--
--   DROP TRIGGER tg_financial_events_occurred_at ON sal.financial_events;
--   DROP FUNCTION sal.stamp_financial_event_occurred_at();
--   DROP TRIGGER tg_payment_allocations_allocated_at ON sal.payment_allocations;
--   DROP FUNCTION sal.stamp_payment_allocation_allocated_at();
--   DROP TRIGGER tg_receipts_received_at ON sal.receipts;
--   DROP FUNCTION sal.stamp_receipt_received_at();
--   DROP FUNCTION sal.receipt_unallocated_as_of(uuid, timestamptz);
--   DROP FUNCTION sal.invoice_open_receivable_as_of(uuid, timestamptz);
-- ----------------------------------------------------------------------------
