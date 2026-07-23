-- ============================================================================
-- Phase: 1-15 — Shared Services Backend (post-merge remediation)
-- Migration: harden the display-number period contract against a stale
--            transaction timestamp and against any backwards period move
-- Change request: DBCR-P1-15-002
-- Finding: P1-15-SR-014 (reproduced on protected `develop` = 0b843bf)
-- Owner module: shared
--
-- Rollback classification: ROLLBACK-SAFE. No table, column, constraint, index,
--   policy, grant, role or row is created, altered or destroyed. Two function
--   bodies are replaced; the exact inverse is given at the end of this file.
--   Recorded in docs/phase-1/phase-1-15/phase-1-15-migration-classification.md.
--
-- Dependencies: 0003 (shared.number_sequences, the allocator and the guard).
--
-- The defect, stated exactly
--   `shared.next_display_number()` derived its period key from `now()`, which is
--   *transaction-start* time and does not advance while a transaction is open.
--   A transaction that began before a period boundary and reached the allocation
--   after it therefore computed the OLD period key. Because the reset test is a
--   plain inequality —
--
--       IF period_reset_rule <> 'never' AND v_period IS DISTINCT FROM current_period
--
--   — an *earlier* key is treated exactly like a later one: the run restarts at
--   1 and the earlier key is stamped back onto the row. The regression trigger
--   did not stop it, because its counter check only fires when the period is
--   unchanged.
--
--   Reproduced against this exact contract, as `app_runtime`:
--     * two allocations issued 2026-07-23-000001 and 2026-07-23-000002;
--     * the row was placed in the state a next-period transaction leaves behind
--       (next_value = 2, current_period = 2026-07-24) — the same write the
--       function itself performs;
--     * the next allocation, whose now() still resolved to 2026-07-23, issued
--       **2026-07-23-000001 again** and rewound current_period to 2026-07-23.
--
--   That breaks the invariant the number-sequence standard states in its own
--   words — "unique committed sequence_values per scope and period", and
--   "counters may never be rewound except as part of a period change". A
--   backwards period change is not a period change; it is a rewind wearing one.
--
--   Impact is duplicate human-facing document numbers (invoice, quotation,
--   work-order) inside one tenant scope. It is NOT a tenant-isolation or
--   authorization defect: RLS, the scope checks and the grants are untouched by
--   this migration and were never involved.
--
-- The fix, in two independent layers
--   1. `shared.next_display_number()` now reads `clock_timestamp()` — statement
--      time, evaluated after the row lock is taken — so the key it computes is
--      the period the allocation actually happens in, no matter how long the
--      transaction has been open. Every allocator shares one database clock, so
--      the key is monotonic across concurrent callers by construction.
--   2. `shared.guard_number_sequence_regression()` now refuses any attempt to
--      INVENT a period. On a period-resetting sequence whose reset rule is
--      unchanged, `current_period` may only be left alone or set to the key the
--      database clock yields now — not an earlier key, not a later one, and not
--      NULL.
--
--   Layer 2 is not merely a backstop for layer 1, and "may only move forward"
--   would not have been enough. `next_value` may legitimately decrease *together
--   with* a period change, so a writer holding the ordinary
--   `UPDATE (next_value, current_period)` grant can lower the counter in the same
--   statement that changes the period; both NULL and a far-future key satisfy
--   "not backwards", and either one makes the next allocation restart the run at
--   1 and re-issue numbers that period already used. That was verified as
--   `rootlco_test_runtime` against a forward-only draft of this migration:
--   `SET current_period = NULL` on a yearly sequence at value 42 was accepted,
--   and the next allocation issued `FXY-<year>-001`.
--
--   Comparing against the clock rather than against the old value closes all
--   three. `app_runtime` holds no grant on `period_reset_rule`, so the
--   rule-changed escape is reachable only by an administrator performing a
--   configuration change — which is what it is for — and the first stamp on a
--   fresh sequence still passes because the new value IS the current key.
--
-- Security implications
--   * No role attribute, ownership, grant, policy or RLS setting changes.
--   * Both functions remain SECURITY INVOKER with `SET search_path = ''`.
--   * The allocator's signature, return type, tenant sourcing and scope checks
--     are unchanged, so no caller contract moves.
--   * The guard becomes strictly stricter: every UPDATE it accepted before it
--     still accepts, except a backwards period move, which was the defect.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Allocator — period key from statement time, not transaction-start time.
--    Body is reproduced in full (CREATE OR REPLACE has no partial form); the
--    only change is the `now()` -> `clock_timestamp()` substitution in the
--    period CASE and the comment that explains why.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shared.next_display_number(
  p_sequence_code text,
  p_company_id    uuid DEFAULT NULL,
  p_branch_id     uuid DEFAULT NULL,
  OUT display_number text,
  OUT sequence_value bigint
)
RETURNS record
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id  uuid := iam.current_tenant_id();
  v_companies  uuid[] := iam.allowed_company_ids();
  v_branches   uuid[] := iam.allowed_branch_ids();
  v_row        shared.number_sequences%ROWTYPE;
  v_period     text;
BEGIN
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'next_display_number: no tenant context (app.tenant_id is not set in this transaction)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_company_id IS NOT NULL AND v_companies IS NOT NULL
     AND NOT (p_company_id = ANY (v_companies)) THEN
    RAISE EXCEPTION 'next_display_number: company % is outside the allowed company scope of this session', p_company_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_branch_id IS NOT NULL AND v_branches IS NOT NULL
     AND NOT (p_branch_id = ANY (v_branches)) THEN
    RAISE EXCEPTION 'next_display_number: branch % is outside the allowed branch scope of this session', p_branch_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Row lock: concurrent allocators for the same scope queue here. RLS
  -- guarantees the row (if visible at all) belongs to the session's tenant;
  -- tenant_id is matched explicitly anyway (defence in depth).
  SELECT * INTO v_row
  FROM shared.number_sequences ns
  WHERE ns.tenant_id = v_tenant_id
    AND ns.sequence_code = p_sequence_code
    AND ns.company_id IS NOT DISTINCT FROM p_company_id
    AND ns.branch_id  IS NOT DISTINCT FROM p_branch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'next_display_number: no sequence is configured for code % in this scope (provisioning is a configuration action — see docs/database/number-sequence-standard.md)', p_sequence_code
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Period key (UTC) for period-resetting sequences.
  --
  -- clock_timestamp(), NOT now(): now() is transaction-start time and does not
  -- advance while the transaction is open, so a transaction that began before a
  -- period boundary and reached this point after it would compute the OLD key.
  -- The reset test below is a plain inequality, so an older key restarts the run
  -- at 1 and stamps itself back onto the row — re-issuing numbers that period
  -- already used (P1-15-SR-014, DBCR-P1-15-002). clock_timestamp() is evaluated
  -- here, after the row lock, so it names the period the allocation is actually
  -- committing in. Every allocator reads the same database clock, so the key is
  -- monotonic across concurrent callers.
  v_period := CASE v_row.period_reset_rule
    WHEN 'never'   THEN NULL
    WHEN 'yearly'  THEN to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY')
    WHEN 'monthly' THEN to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM')
    WHEN 'daily'   THEN to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD')
  END;

  IF v_row.period_reset_rule <> 'never'
     AND v_period IS DISTINCT FROM v_row.current_period THEN
    sequence_value := 1;
  ELSE
    sequence_value := v_row.next_value;
  END IF;

  UPDATE shared.number_sequences
  SET next_value = sequence_value + 1,
      current_period = v_period
  WHERE id = v_row.id;

  -- Zero-pad to pad_width, WIDENING (never truncating) once the value outgrows
  -- the pad: plain lpad(text, n) truncates on the right when length(text) > n,
  -- which would render colliding display numbers at 10^pad_width. greatest()
  -- keeps the full value in that case. pad_width = 0 means no padding.
  display_number :=
    replace(v_row.prefix_template, '{period}', COALESCE(v_period, ''))
    || lpad(
         sequence_value::text,
         greatest(v_row.pad_width, length(sequence_value::text)),
         '0'
       );

  RETURN;
END;
$$;

COMMENT ON FUNCTION shared.next_display_number(text, uuid, uuid) IS
  'Allocates the next display number for a tenant-scoped sequence inside the caller''s transaction. SECURITY INVOKER (RLS applies). SELECT ... FOR UPDATE serialises concurrent allocation. The period key is taken from clock_timestamp() after the lock, never from now(), so a transaction open across a period boundary cannot rewind the run (DBCR-P1-15-002). Rollback discards the number (gap-tolerant by design). Tenant comes from iam.current_tenant_id() only — never from a parameter.';

-- The explicit grant remains the only execute path; restated so a reviewer can
-- confirm the replacement did not widen it. CREATE OR REPLACE preserves existing
-- privileges, so these two statements are assertions of intent, not changes.
REVOKE EXECUTE ON FUNCTION shared.next_display_number(text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION shared.next_display_number(text, uuid, uuid) TO app_runtime;

-- ----------------------------------------------------------------------------
-- 2. Regression guard — a backwards period move is a rewind, and is refused.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shared.guard_number_sequence_regression()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.period_reset_rule = 'never'
     AND NEW.current_period IS DISTINCT FROM OLD.current_period THEN
    RAISE EXCEPTION 'number_sequences: a never-resetting sequence has no period to change (sequence %, tenant %)',
      OLD.sequence_code, OLD.tenant_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- A period key may not be INVENTED. On a period-resetting sequence whose reset
  -- rule is unchanged, `current_period` may only be left exactly as it is, or set
  -- to the key the database clock yields right now. Not an earlier key, not a
  -- later one, and not NULL.
  --
  -- "May only move forward" is the obvious rule and it is not enough. `next_value`
  -- may legitimately decrease *together with* a period change, so a writer holding
  -- the ordinary column grant can lower the counter in the same statement that
  -- changes the period — and both NULL and a far-future key satisfy "not
  -- backwards". Either one makes the next allocation see a period different from
  -- the stored one, restart the run at 1, and re-issue numbers that period already
  -- used. Verified as `rootlco_test_runtime` against the forward-only draft of this
  -- migration: `SET current_period = NULL` on a yearly sequence at value 42 was
  -- accepted, and the next allocation issued `FXY-<year>-001`.
  --
  -- So the guard compares against the clock rather than against the old value.
  -- `app_runtime` holds `UPDATE (next_value, current_period)` and **not**
  -- `period_reset_rule`, so the rule-changed escape below is reachable only by an
  -- administrator performing a configuration change — which is what it is for.
  -- The first stamp on a fresh sequence (NULL -> current key) still passes,
  -- because the new value *is* the current key.
  IF NEW.period_reset_rule <> 'never'
     AND NEW.period_reset_rule = OLD.period_reset_rule
     AND NEW.current_period IS DISTINCT FROM OLD.current_period
     AND NEW.current_period IS DISTINCT FROM (
           CASE NEW.period_reset_rule
             WHEN 'yearly'  THEN to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY')
             WHEN 'monthly' THEN to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM')
             WHEN 'daily'   THEN to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD')
           END) THEN
    RAISE EXCEPTION 'number_sequences: current_period may only be advanced to the current period key (sequence %, tenant %, % -> %)',
      OLD.sequence_code, OLD.tenant_id, COALESCE(OLD.current_period, '<null>'), COALESCE(NEW.current_period, '<null>')
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.next_value < OLD.next_value
     AND NEW.current_period IS NOT DISTINCT FROM OLD.current_period THEN
    RAISE EXCEPTION 'number_sequences: next_value may not decrease without a period change (sequence %, tenant %)',
      OLD.sequence_code, OLD.tenant_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION shared.guard_number_sequence_regression() IS
  'BEFORE UPDATE guard on shared.number_sequences. Refuses: any current_period change on a never-resetting sequence; any current_period set to anything other than the clock''s current key on a period-resetting sequence whose reset rule is unchanged (DBCR-P1-15-002 — closes NULL, backwards and future forgery, each of which restarts the run and re-issues numbers); and any next_value decrease without a period change. Raises SQLSTATE 23514.';

REVOKE EXECUTE ON FUNCTION shared.guard_number_sequence_regression() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 3. Exact inverse (rollback), for the record. Restores the migration-0003
--    bodies verbatim. Running it reinstates P1-15-SR-014 and is therefore a
--    decision, not a routine operation.
-- ----------------------------------------------------------------------------
-- CREATE OR REPLACE FUNCTION shared.next_display_number(...) -- 0003 body with
--   to_char(now() AT TIME ZONE 'UTC', ...) in the period CASE.
-- CREATE OR REPLACE FUNCTION shared.guard_number_sequence_regression() -- 0003
--   body without the backwards-period branch.
