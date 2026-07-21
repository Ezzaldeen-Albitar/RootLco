# Phase 1-4 — IAM Helper Usage Guide

**Company:** RootLco · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential · **Phase:** 1-4 · **Date:** 2026-07-18

How a future consumer (Phase-1-5+ schema, or the Phase-1-14 backend) uses the
authorization contract. All helpers are `SECURITY INVOKER`, trust only the
server-set transaction context, and default to **deny**.

## The context contract (set server-side, per transaction)

```sql
SELECT set_config('app.tenant_id',   '<uuid>', true);
SELECT set_config('app.user_id',     '<uuid>', true);
SELECT set_config('app.company_ids', '<uuid,uuid>', true); -- optional narrowing
SELECT set_config('app.branch_ids',  '<uuid,uuid>', true); -- optional narrowing
```

Client-supplied identifiers are validation inputs only; knowing an id grants
nothing.

## The contract functions

| Function                                                         | Returns | Use                                |
| ---------------------------------------------------------------- | ------- | ---------------------------------- |
| `iam.current_tenant_id()` / `current_user_id()`                  | uuid    | the acting scope (NULL when unset) |
| `iam.current_company_ids()` / `current_branch_ids()`             | uuid[]  | optional narrowing sets            |
| `iam.has_permission(code)`                                       | boolean | tenant-wide permission check       |
| `iam.has_permission_in_scope(code, company, branch, department)` | boolean | scoped permission check            |

Resolution: `allow AND NOT deny` across the user's ACTIVE grants; a scoped grant
applies only where a scope matches; inactive users, expired/revoked grants,
unset/invalid context, and cross-tenant claims all return `false`.

## Using it in an RLS policy (the intended pattern)

```sql
CREATE POLICY sel_thing_permitted ON <schema>.<thing>
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('<domain>.<thing>.read'));

CREATE POLICY upd_thing_scoped ON <schema>.<thing>
  FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
         AND iam.has_permission_in_scope('<domain>.<thing>.manage', company_id, branch_id, NULL));
```

This exact pattern is exercised by a **test-only** synthetic consumer policy on a
disposable fixture table (§19.G) — **no Phase-1-5 business schema is created** to
validate the guide.

## Writing an audit entry

```sql
SELECT iam.audit_append(
  p_tenant := iam.current_tenant_id(),
  p_actor  := iam.current_user_id(),
  p_actor_kind := 'user',
  p_action := 'update',
  p_entity_type := '<schema>.<thing>',
  p_entity_id := <id>,
  p_details := '[{"field":"amount","old":"1","new":"2","class":"internal"}]'::jsonb
);
```

`audit_append` is the sole writer. Since DBCR-P1-13-001 (migration
`20260725090000`) `app_runtime` holds `EXECUTE` on it — and, because it is
`SECURITY INVOKER`, on its three helpers `iam.audit_mask`, `iam.audit_canonical`
and `iam.audit_hash` — plus tenant-scoped `INSERT` on the three audit tables. No
`SECURITY DEFINER` wrapper was introduced; the count of definer routines is still
zero. Restricted/secret detail values are masked automatically.

Being able to append is **not** being able to read: reading committed audit
history still requires the `iam.audit.view` permission through
`sel_audit_*_permitted`. The writer's own reads go through
`sel_audit_records_unlinked` / `sel_audit_record_details_unlinked`, which match
only a record with no chain link yet — the row under construction, never a
committed one. `app_readonly` gained nothing, and no role gained `UPDATE`,
`DELETE` or `EXECUTE` on `iam.audit_verify_chain`.
