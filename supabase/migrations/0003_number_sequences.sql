-- ============================================================================
-- Migration 0003 — tenant-scoped display-number foundation
-- (P1-02-DB-004, P1-02-DB-019).
--
-- UUIDs are never public display numbers. Human-facing document numbers
-- (quotation No., work-order No., invoice No. — issued by LATER phases) are
-- allocated from shared.number_sequences via shared.next_display_number().
--
-- There is NO global cross-tenant sequence: every sequence row is owned by a
-- tenant (tenant_id NOT NULL) and optionally narrowed to a company/branch.
-- No tenant-specific rows are seeded here — sequences are provisioned through
-- configuration at tenant onboarding (ADR-008). Benzene is NOT hard-coded.
--
-- Forward-only. Rollback classification: roll-forward-only once any display
-- number has been issued (dropping the table loses allocation state).
-- Standard: docs/database/number-sequence-standard.md.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table
-- ----------------------------------------------------------------------------
CREATE TABLE shared.number_sequences (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  company_id     uuid        NULL,
  branch_id      uuid        NULL,
  sequence_code  text        NOT NULL,
  prefix_template text       NOT NULL DEFAULT '',
  next_value     bigint      NOT NULL DEFAULT 1,
  pad_width      integer     NOT NULL DEFAULT 6,
  period_reset_rule text     NOT NULL DEFAULT 'never',
  current_period text        NULL,
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,

  CONSTRAINT pk_number_sequences PRIMARY KEY (id),

  -- Exactly one sequence row per (tenant, code, company, branch) scope.
  -- NULLS NOT DISTINCT so a tenant-wide sequence (NULL company/branch) is
  -- also unique. Doubles as the tenant-leading access index.
  CONSTRAINT uq_number_sequences_scope
    UNIQUE NULLS NOT DISTINCT (tenant_id, sequence_code, company_id, branch_id),

  CONSTRAINT ck_number_sequences_code_format
    CHECK (sequence_code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_number_sequences_next_value_positive
    CHECK (next_value >= 1),
  CONSTRAINT ck_number_sequences_pad_width_range
    CHECK (pad_width BETWEEN 0 AND 18),
  CONSTRAINT ck_number_sequences_period_reset_rule
    CHECK (period_reset_rule IN ('never', 'yearly', 'monthly', 'daily')),
  -- A branch-scoped sequence must state its company: branch without company is
  -- an undefined scope in the org model.
  CONSTRAINT ck_number_sequences_branch_requires_company
    CHECK (branch_id IS NULL OR company_id IS NOT NULL),
  -- A never-resetting sequence has no period, ever. Closes the rewind bypass
  -- where a writer invents a period change to satisfy the regression guard.
  CONSTRAINT ck_number_sequences_never_has_no_period
    CHECK (period_reset_rule <> 'never' OR current_period IS NULL)
);

COMMENT ON TABLE shared.number_sequences IS
  'Tenant-scoped display-number sequences (P1-02-DB-004/019). Provisioned by configuration at tenant onboarding; allocated via shared.next_display_number(). No global cross-tenant sequence exists. NOTE: tenant_id/company_id/branch_id foreign keys to org.* are added in Phase 1-3 when those tables exist — recorded in the data dictionary.';
COMMENT ON COLUMN shared.number_sequences.prefix_template IS
  'Literal prefix rendered before the padded value. Supported token: {period} (replaced by the current period key, empty when period_reset_rule = never).';
COMMENT ON COLUMN shared.number_sequences.next_value IS
  'Next value to issue. Read and advanced ONLY under SELECT ... FOR UPDATE by shared.next_display_number(). Allocation is transactional: a rollback also rolls back the increment, so the number is re-issued to the next caller (no duplicate, no gap). Gaps that arise at business level (voided documents, period resets) are tolerated and never renumbered — see the number-sequence standard.';
COMMENT ON COLUMN shared.number_sequences.current_period IS
  'Period key of the last allocation for period-resetting sequences (e.g. 2026, 2026-07). NULL for never-resetting sequences.';

-- Metadata trigger (updated_at / updated_by / record_version) — standard 0002.
CREATE TRIGGER tg_number_sequences_touch_metadata
  BEFORE UPDATE ON shared.number_sequences
  FOR EACH ROW
  EXECUTE FUNCTION shared.touch_row_metadata();

-- Integrity guard: next_value may only move backwards when the period key
-- changes (a legitimate period reset). Blocks accidental or malicious
-- rewinding that would re-issue already-issued numbers within a tenant.
-- Hardened against the fake-period bypass: a never-resetting sequence may not
-- change current_period at all (also CHECK-constrained above), so a writer
-- holding the UPDATE column grant cannot invent a period change to sneak a
-- rewind past the guard.
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
  IF NEW.next_value < OLD.next_value
     AND NEW.current_period IS NOT DISTINCT FROM OLD.current_period THEN
    RAISE EXCEPTION 'number_sequences: next_value may not decrease without a period change (sequence %, tenant %)',
      OLD.sequence_code, OLD.tenant_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_number_sequences_guard_regression
  BEFORE UPDATE ON shared.number_sequences
  FOR EACH ROW
  EXECUTE FUNCTION shared.guard_number_sequence_regression();

-- Trigger functions need no caller EXECUTE; strip the PostgreSQL PUBLIC default.
REVOKE EXECUTE ON FUNCTION shared.guard_number_sequence_regression() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 2. Row-Level Security: enabled AND forced (the table owner is not exempt
--    unless the role itself carries BYPASSRLS — see the RLS standard for the
--    honest statement about superusers and Supabase-managed roles).
--    Default deny: no policy exists for INSERT or DELETE for runtime roles,
--    and no permissive fallback policy exists.
-- ----------------------------------------------------------------------------
ALTER TABLE shared.number_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.number_sequences FORCE ROW LEVEL SECURITY;

-- SELECT: a session sees only its own tenant's sequences. With no tenant
-- context, iam.current_tenant_id() is NULL and the comparison matches no rows.
CREATE POLICY sel_number_sequences_tenant
  ON shared.number_sequences
  FOR SELECT
  TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());

-- UPDATE: allocation advances next_value inside the caller's tenant only.
-- WITH CHECK prevents re-pointing a row at another tenant.
CREATE POLICY upd_number_sequences_tenant
  ON shared.number_sequences
  FOR UPDATE
  TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());

-- INSERT / DELETE: deliberately NO policy and NO grant for runtime roles.
-- Sequence provisioning and retirement are administrative configuration
-- actions (tenant onboarding), executed by the migration/admin path and
-- auditable there.

-- ----------------------------------------------------------------------------
-- 3. Grants (least privilege, per the role-and-grant standard).
--    Column-restricted UPDATE: the runtime role can only touch the columns the
--    allocator actually writes; metadata columns are written by the trigger.
-- ----------------------------------------------------------------------------
GRANT SELECT ON shared.number_sequences TO app_runtime, app_readonly;
GRANT UPDATE (next_value, current_period) ON shared.number_sequences TO app_runtime;

-- ----------------------------------------------------------------------------
-- 4. Allocation function (P1-02-DB-019).
--
--    * SECURITY INVOKER: runs with the caller's rights — RLS applies in full;
--      this function is NOT an RLS bypass.
--    * Runs in the CALLER's transaction: the issued number commits or rolls
--      back atomically with the business change that consumed it. On rollback
--      the increment also rolls back, so the number is simply re-issued to the
--      next caller — no duplicate and no gap from rollbacks. The trade-off is
--      serialisation on the sequence row (documented in the standard). Gaps
--      from later business events (voided documents, period resets) are
--      tolerated and never renumbered.
--    * SELECT ... FOR UPDATE serialises concurrent allocation per sequence
--      row: two transactions can never read the same next_value.
--    * The tenant is taken EXCLUSIVELY from the server-resolved context —
--      there is no tenant parameter, by design. Company/branch parameters
--      select a narrower sequence scope and are validated against the
--      session's allowed lists when those are set.
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
  v_period := CASE v_row.period_reset_rule
    WHEN 'never'   THEN NULL
    WHEN 'yearly'  THEN to_char(now() AT TIME ZONE 'UTC', 'YYYY')
    WHEN 'monthly' THEN to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM')
    WHEN 'daily'   THEN to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')
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
  'Allocates the next display number for a tenant-scoped sequence inside the caller''s transaction. SECURITY INVOKER (RLS applies). SELECT ... FOR UPDATE serialises concurrent allocation. Rollback discards the number (gap-tolerant by design). Tenant comes from iam.current_tenant_id() only — never from a parameter.';

-- Strip the PostgreSQL PUBLIC-EXECUTE default so the explicit grant below is
-- the ONLY execute path: allocation is an app_runtime capability, full stop.
REVOKE EXECUTE ON FUNCTION shared.next_display_number(text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION shared.next_display_number(text, uuid, uuid) TO app_runtime;
