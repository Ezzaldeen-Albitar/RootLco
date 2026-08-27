-- ============================================================================
-- PRE-P1-29 — the worker's enqueue authority on shared.outbound_messages.
--
-- Rollback classification: REVERSIBLE. The REVOKE and DROP POLICY below are
-- clean and lossless: this migration writes no row, creates no table, and
-- changes no existing grant or policy. Messages already enqueued by the worker
-- are ordinary rows with their own lifecycle and survive the rollback exactly as
-- rows enqueued through the request path do.
--
-- ## The defect, stated precisely, because it has been stated wrongly before
--
-- It is NOT that "no application role can enqueue a notification". `app_runtime`
-- can, and its path is correctly scoped:
--
--   * a COLUMN-level `GRANT INSERT` on thirteen columns, from
--     `20260728090000_shared_services_runtime_write_capabilities.sql:140`, which
--     deliberately EXCLUDES `status` so the `'pending'` default is the only
--     status that path can produce; and
--   * `ins_outbound_messages_enqueue`, requiring
--     `tenant_id = iam.current_tenant_id()`, `created_by = iam.current_user_id()`,
--     `status = 'pending'` and
--     `iam.has_permission_in_scope('shared.notification.send', …)`.
--
-- Two instruments reported that grant as absent and both failed the same way:
-- `information_schema.role_table_grants` cannot see a COLUMN-level grant, and a
-- single-line `grep 'GRANT.*outbound_messages'` cannot see a statement whose
-- target sits on the next line. The live database settles it by ERROR CLASS —
-- `app_runtime` is refused with `new row violates row-level security policy`,
-- which only a statement that PASSED the privilege check can produce, while
-- `app_worker` gets `permission denied for table`.
--
-- The real gap is narrower: that path belongs to the REQUEST runtime, and the
-- `job.assigned` consumer runs on the worker, which holds no INSERT at any
-- granularity and — draining a cross-tenant queue — has no `app.tenant_id`.
--
-- ## Why a grant and a RESTRICTIVE policy, and NOT a SECURITY DEFINER function
--
-- A definer function was written first, and this repository refuses it. Two
-- independent gates enforce that, and they are right to:
--
--   `scripts/ci/migration-replay-checks.mjs:221`
--     "N SECURITY DEFINER function(s) exist; the approved count is 0."
--   `scripts/ci/rls-matrix.mjs:291`
--     "…is SECURITY DEFINER, which runs with the owner's rights and bypasses RLS."
--
-- So the platform's position is not that definer functions are unprecedented
-- here; it is that they are PROHIBITED, because bypassing RLS is the one thing
-- this schema's security model may never do. A function was the wrong answer.
--
-- ## What replaces the check the function was going to make
--
-- The definer function existed to answer one question the worker cannot: does
-- the claimed tenant OWN the claimed recipient? Under the Owner's
-- payload-carries-the-facts decision that question is answered EARLIER and by a
-- role that already has the authority to answer it.
--
-- The `job.assigned` publisher runs as `app_runtime`, inside the tenant's own
-- context, and resolves the recipient from `tech.technician_profiles` at publish
-- time. The resulting outbox row is therefore authored by a tenant-scoped role
-- under its own RLS. The worker does not ASSERT a tenant; it forwards one that
-- was already verified by the only party that could verify it.
--
-- That is a deliberate trade, and it is stated rather than hidden: the database
-- cannot verify the lineage of a payload, so the control lives at publish time.
-- The alternative was to grant the worker `tech` reads so a policy could check
-- it — which widens exactly the privilege the decision forbids, to re-derive a
-- fact the publisher already knew.
--
-- ## Why the new policy is RESTRICTIVE
--
-- `wkr_outbound_messages_dispatch` is `FOR ALL … USING true WITH CHECK true`, and
-- the worker's SELECT depends on it, so it is left untouched. A PERMISSIVE
-- INSERT policy would OR with it and constrain nothing. A RESTRICTIVE policy
-- ANDs, so it narrows the worker's INSERT without altering shipped behaviour for
-- any other statement or role.
-- ============================================================================

-- The same column set the request path holds, minus the columns a worker has no
-- business supplying. `status` is excluded for the same reason it is excluded
-- there: the default is 'pending', so no caller of this grant can enqueue a
-- message in any other state.
GRANT INSERT (id, tenant_id, company_id, branch_id, template_version_id, channel,
              purpose, recipient_digest, recipient_user_id, body_sha256,
              dedupe_key, consent_ref, created_by)
  ON shared.outbound_messages            TO app_worker;

-- Belt AND braces, deliberately. `status` is already unreachable through the
-- column grant above; pinning it here means a future widening of that grant
-- cannot silently also widen the states a worker can produce.
CREATE POLICY wkr_outbound_messages_enqueue_scope
  ON shared.outbound_messages
  AS RESTRICTIVE
  FOR INSERT
  TO app_worker
  WITH CHECK (
    status = 'pending'
    AND tenant_id IS NOT NULL
    AND created_by IS NOT NULL
    AND dedupe_key IS NOT NULL
  );

COMMENT ON POLICY wkr_outbound_messages_enqueue_scope ON shared.outbound_messages IS
  'RESTRICTIVE so it ANDs with wkr_outbound_messages_dispatch rather than ORing '
  'with it: that policy is FOR ALL/USING true and the worker''s SELECT depends on '
  'it, so it is not narrowed. The worker may enqueue only a pending, tenant- and '
  'author-bearing, deduplicable message. Tenant OWNERSHIP of the recipient is '
  'established at publish time by app_runtime, which resolves it under the '
  'tenant''s own RLS; the worker forwards a verified fact rather than asserting '
  'an unverified one.';

-- ----------------------------------------------------------------------------
-- Rollback
-- ----------------------------------------------------------------------------
-- DROP POLICY wkr_outbound_messages_enqueue_scope ON shared.outbound_messages;
-- REVOKE INSERT (id, tenant_id, company_id, branch_id, template_version_id,
--                channel, purpose, recipient_digest, recipient_user_id,
--                body_sha256, dedupe_key, consent_ref, created_by)
--   ON shared.outbound_messages FROM app_worker;
