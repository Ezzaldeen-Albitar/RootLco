# Phase 1-10 — Security Matrix (RLS / branch isolation / grants / classification)

## RLS + branch isolation

Every `svc`/`quo`/`inv` table has RLS **enabled and forced** (101 policies). Policy
shapes:

- **Tenant-scoped catalogs** — `sel`/`ins`/`upd` on `tenant_id =
iam.current_tenant_id()`. Applies to `svc.service_categories`, `svc.services`,
  `svc.service_versions`, `svc.standard_labor_times`, `svc.price_lists`,
  `svc.price_list_versions`, `svc.price_rules`, `svc.price_list_assignments`,
  `svc.discount_rules`, `svc.pricing_approval_policies`, `inv.item_categories`,
  `inv.item_master`, `inv.item_cost_details`.

- **Branch-scoped business tables** — add the branch clause:

  ```
  tenant_id = iam.current_tenant_id()
  AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
  AND (iam.allowed_branch_ids()  IS NULL OR branch_id  = ANY (iam.allowed_branch_ids()))
  ```

  `upd` `WITH CHECK` is tenant-only; company/branch and other immutable columns are
  frozen by immutable-column guards. Branch ⊆ company ⊆ tenant is additionally
  FK-enforced (composite FK to `org.branches`). Applies to `svc.branch_service_availability`,
  all `quo.*`, and all branch-scoped `inv.*` (locations, movements, balances,
  reservations, opening, adjustments, issues, returns, damage, CSP, external-purchase,
  and the two branch-scoped restricted detail tables).

- **Dual-scope UoM catalog** — `sel` visible when `scope='platform' OR tenant_id =
current`; `ins`/`upd` only `scope='tenant' AND tenant_id = current`; **no DELETE
  grant**; `scope`/`tenant_id`/`code` immutable. Platform rows are globally readable
  structural reference and can never be claimed/altered by a tenant (review-response
  Low: UoM write gate). The no-context default-deny claim is scoped to business tables;
  platform reference rows are deliberately globally readable.

- **Restricted 1:1 cost tables** — every policy (`sel`/`ins`/`upd`) additionally
  requires `iam.has_permission('inv.cost.view')`.

- **No-context default-deny** — an unset tenant GUC makes the helpers return NULL and
  the business-table policies false.

## Grants

| Role           | Tenant/branch tables   | Append-only ledgers | Dual-scope UoM                       |
| -------------- | ---------------------- | ------------------- | ------------------------------------ |
| `app_runtime`  | SELECT, INSERT, UPDATE | SELECT, INSERT      | SELECT, INSERT, UPDATE (tenant rows) |
| `app_readonly` | SELECT                 | SELECT              | SELECT                               |
| `app_worker`   | — (no P1-10 grants)    | —                   | —                                    |

**DELETE is granted to no application role on any `svc`/`quo`/`inv` table** — deletion
is a soft-delete UPDATE (the append-only ledgers have no soft-delete at all).
Application roles are `NOLOGIN NOBYPASSRLS`. The worker role gets no P1-10 write
access. Function grants: see [phase-1-10-grant-matrix.md](phase-1-10-grant-matrix.md).

## Restricted-payload gating (3 tables — `inv.cost.view`)

Cost/margin fields live in **separate 1:1 tables** whose whole read/write policy
requires the dedicated `inv.cost.view` permission (not the broad PII
`iam.sensitive.view` — review-response Medium: dead permission / cost-vs-PII
separation). Each restricted column is `classification='restricted'` (immutable).

| Restricted column                              | Table scope   | Gate                              |
| ---------------------------------------------- | ------------- | --------------------------------- |
| `inv.item_cost_details.standard_cost`          | tenant-scoped | `inv.cost.view` on sel/ins/upd    |
| `inv.external_purchase_part_details.unit_cost` | branch-scoped | branch clause AND `inv.cost.view` |
| `inv.stock_adjustment_details.value_impact`    | branch-scoped | branch clause AND `inv.cost.view` |

Operational roles see prices and quantities but never costs/margins without
`inv.cost.view`. Row RLS (not column masking) physically separates the sensitive
columns. `item_cost_details` stays tenant-scoped because its parent `inv.item_master`
is tenant-scoped; the two branch-scoped detail tables carry `company_id`/`branch_id`
and enforce the full branch clause (review-response Medium: cross-branch cost leak).

## Append-only enforcement (4 ledgers)

Grant only SELECT + INSERT (never UPDATE/DELETE): `inv.stock_movements`,
`quo.approval_decisions`, `quo.approval_evidence`, `quo.quotation_status_history`.
Status ledgers are trigger-emitted/server-stamped; evidence binds an exact
`shared.document_versions` row; the movement ledger is additionally provenance-guarded.

## Function security

All 39 functions are `SECURITY INVOKER` with `SET search_path = ''` and `REVOKE
EXECUTE FROM PUBLIC`; **none is `SECURITY DEFINER`** (repo-wide prohibition). A
`SECURITY INVOKER` function runs with the caller's RLS, so a function cannot bypass
branch isolation. Because there is no privileged write path, stock-balance integrity
is enforced by movement provenance + coherence guards, not by a privilege boundary.

## Permissions

P1-10 references the `domain.object.action` permission codes (`svc.service.manage`,
`svc.price.manage`, `svc.price.publish`, `quo.quotation.manage`, `quo.decision.record`,
`inv.item.manage`, `inv.stock.read`, `inv.stock.operate`, `inv.adjustment.approve`,
`inv.cost.view`); `svc.pricing_approval_policies.required_permission_code` is an FK to
`iam.permissions(permission_code)`, and the three restricted tables gate on
`inv.cost.view`. These codes are seeded in the `iam` permission catalog as structural
reference (design §20); a policy-qual test asserts no seeded-but-unreferenced
permission (`inv.cost.view` is live).
