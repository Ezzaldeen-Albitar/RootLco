-- ============================================================================
-- PRE-P1-29 — shared.enqueue_notification, the worker's enqueue authority.
--
-- Rollback classification: REVERSIBLE. `DROP FUNCTION` plus the REVOKE is clean
-- and lossless: this migration writes no row, creates no table and changes no
-- existing grant or policy. Messages already enqueued through the function are
-- ordinary `shared.outbound_messages` rows with their own lifecycle, and they
-- survive the drop exactly as rows enqueued through the request path do.
--
-- ## The defect, stated precisely, because it has been stated wrongly before
--
-- It is NOT that "no application role can enqueue a notification". `app_runtime`
-- can, and does, and its path is correctly scoped:
--
--   * a column-level `GRANT INSERT` on thirteen columns, from
--     `20260728090000_shared_services_runtime_write_capabilities.sql:140`, which
--     deliberately EXCLUDES `status` so the default `'pending'` is the only
--     status a caller can produce; and
--   * `ins_outbound_messages_enqueue`, which requires
--     `tenant_id = iam.current_tenant_id()`, `created_by = iam.current_user_id()`,
--     `status = 'pending'` and `iam.has_permission_in_scope('shared.notification.send', …)`.
--
-- Two separate instruments reported that grant as absent, and both were wrong in
-- the same direction: `information_schema.role_table_grants` cannot see a
-- COLUMN-level grant, and a single-line `grep 'GRANT.*outbound_messages'` cannot
-- see a statement whose target sits on the next line. Probing the live database
-- as `app_runtime` settles it by error class — the enqueue is refused with
-- `new row violates row-level security policy`, which only a statement that
-- PASSED the privilege check can produce.
--
-- The real defect is narrower: that path belongs to the REQUEST runtime, and it
-- is unusable by the worker for two independent reasons.
--
--   1. `app_worker` holds no INSERT on `shared.outbound_messages` at any
--      granularity, and probing it yields `permission denied for table`.
--   2. Even with a grant it could not satisfy the policy. The worker has no
--      `app.tenant_id` and no `app.user_id` — it drains a cross-tenant queue —
--      so `iam.current_tenant_id()` is NULL for it by design.
--
-- ## Why a function, and not a grant plus a policy
--
-- Grant + RLS is this repository's established model, and it was the first thing
-- tried. It cannot express this constraint for this caller.
--
-- A permissive INSERT policy for `app_worker` would OR with the existing
-- `wkr_outbound_messages_dispatch`, which is `FOR ALL … USING true WITH CHECK
-- true`, so it would constrain nothing. A RESTRICTIVE policy could AND with it
-- and pin `status = 'pending'` — and then stop, because the only tenant fact
-- available inside a policy is `iam.current_tenant_id()`, which the worker does
-- not have. Nothing in the policy layer can check that a claimed tenant OWNS the
-- claimed recipient, because the worker may not read `tech` and must not be
-- granted it.
--
-- A `SECURITY DEFINER` function can, and that single check is its whole reason
-- for existing. It runs as the owner, reads `tech.technician_profiles`, and
-- refuses a recipient who is not a live technician of the tenant named in the
-- argument — validating precisely what the caller is forbidden to see, which is
-- the only thing a definer function should ever be used for.
--
-- This is the FIRST application-owned `SECURITY DEFINER` function in this
-- repository; the six that exist belong to Supabase infrastructure. That is
-- stated rather than glossed, because a precedent gets cited later as though it
-- had always been the pattern.
--
-- ## What it deliberately does NOT do
--
-- It does not replace the request path. `app_runtime` keeps its direct INSERT
-- and its policy, and gains nothing here. Routing both callers through one
-- definer function would have BYPASSED `ins_outbound_messages_enqueue` for the
-- request path — losing the tenant, actor, status and permission checks — which
-- is a security regression wearing the costume of a simplification.
--
-- It does not own idempotency. `ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`
-- is the same clause the runtime repository already uses, so a replayed event
-- deduplicates where the platform already deduplicates rather than in a second
-- mechanism the consumer would have to keep correct.
--
-- It does not widen the worker anywhere else. `app_worker` gains EXECUTE on this
-- one function: no `wo` USAGE, no `tech` USAGE, no table INSERT, no policy
-- change.
-- ============================================================================

CREATE OR REPLACE FUNCTION shared.enqueue_notification(
  p_tenant_id            uuid,
  p_company_id           uuid,
  p_branch_id            uuid,
  p_template_version_id  uuid,
  p_channel              text,
  p_purpose              text,
  p_recipient_user_id    uuid,
  p_body_sha256          bytea,
  p_dedupe_key           text,
  p_consent_ref          text,
  p_created_by           uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
-- `pg_catalog` first and `public` absent: nothing in this body may resolve to an
-- object a caller planted on a schema it controls. `pg_temp` is last by
-- convention and holds nothing this function names.
SET search_path = pg_catalog, shared, tech, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Every identifier below is a literal in this file. No dynamic SQL, no
  -- `EXECUTE`, no caller-supplied schema, table or column name anywhere.
  IF p_tenant_id IS NULL OR p_recipient_user_id IS NULL OR p_created_by IS NULL THEN
    RAISE EXCEPTION 'enqueue_notification requires tenant, recipient and author'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- THE CHECK THIS FUNCTION EXISTS FOR.
  --
  -- The worker names a tenant and a recipient taken from an event payload. That
  -- payload is trustworthy — `shared.event_outbox` rows are written by the
  -- request runtime under its own RLS — but trustworthy is not the same as
  -- verified, and a consumer defect must not be able to address a notification
  -- into another tenant. `uq_technician_profiles_active_user` is unique on
  -- (tenant_id, user_id), so this resolves at most one row and answers exactly
  -- the question the caller cannot ask for itself.
  IF NOT EXISTS (
    SELECT 1
      FROM tech.technician_profiles p
     WHERE p.tenant_id = p_tenant_id
       AND p.user_id   = p_recipient_user_id
       AND p.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'recipient % is not a live technician of tenant %',
      p_recipient_user_id, p_tenant_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- `status` is omitted, exactly as the request path omits it: the column
  -- default is 'pending', and leaving it to the default means no caller of this
  -- function can enqueue a message in any other state.
  INSERT INTO shared.outbound_messages
    (tenant_id, company_id, branch_id, template_version_id, channel, purpose,
     recipient_user_id, body_sha256, dedupe_key, consent_ref, created_by)
  VALUES
    (p_tenant_id, p_company_id, p_branch_id, p_template_version_id, p_channel,
     p_purpose, p_recipient_user_id, p_body_sha256, p_dedupe_key, p_consent_ref,
     p_created_by)
  ON CONFLICT (tenant_id, dedupe_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    -- Deduplicated. Return the existing row so the caller can report the same
    -- message id it would have reported on the first delivery of this event.
    SELECT m.id INTO v_id
      FROM shared.outbound_messages m
     WHERE m.tenant_id = p_tenant_id
       AND m.dedupe_key = p_dedupe_key;
  END IF;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION shared.enqueue_notification(
  uuid, uuid, uuid, uuid, text, text, uuid, bytea, text, text, uuid
) IS
  'Enqueue one outbound notification on behalf of a caller that has no tenant '
  'context. Verifies the recipient is a live technician of the named tenant — '
  'the check a policy cannot make for `app_worker`, which may not read `tech`. '
  'Status is left to its ''pending'' default; idempotency is the existing '
  '(tenant_id, dedupe_key) conflict. The request path does NOT use this: '
  '`app_runtime` keeps its direct INSERT and `ins_outbound_messages_enqueue`.';

-- PostgreSQL grants EXECUTE to PUBLIC on a new function. Revoke first, then
-- grant to exactly one role — the convention every function in this schema
-- already follows.
REVOKE EXECUTE ON FUNCTION shared.enqueue_notification(
  uuid, uuid, uuid, uuid, text, text, uuid, bytea, text, text, uuid
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION shared.enqueue_notification(
  uuid, uuid, uuid, uuid, text, text, uuid, bytea, text, text, uuid
) TO app_worker;

-- ----------------------------------------------------------------------------
-- Rollback
-- ----------------------------------------------------------------------------
-- REVOKE EXECUTE ON FUNCTION shared.enqueue_notification(
--   uuid, uuid, uuid, uuid, text, text, uuid, bytea, text, text, uuid
-- ) FROM app_worker;
-- DROP FUNCTION shared.enqueue_notification(
--   uuid, uuid, uuid, uuid, text, text, uuid, bytea, text, text, uuid
-- );
