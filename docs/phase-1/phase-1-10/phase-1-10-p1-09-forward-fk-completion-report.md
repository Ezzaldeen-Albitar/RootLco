# Phase 1-10 — P1-09 Forward-FK Completion Report

Phase 1-9 stored three **opaque `uuid`** forward references (no FK, no CHECK) because
their target catalogs did not exist yet (see
`docs/phase-1/phase-1-9/p1-10-structural-contract.md`). Migration
`20260723097000_wo_forward_fks.sql` **additively** resolves them now that P1-10
provides the catalogs. No merged P1-09 migration is edited (forward-only).

## The three resolutions

| P1-09 column                                   | New FK target (P1-10)                                           | FK columns                                                   | On delete | Covering index                                 |
| ---------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------ | --------- | ---------------------------------------------- |
| `wo.work_order_service_lines.service_ref`      | `svc.services(tenant_id, id)`                                   | `(tenant_id, service_ref)`                                   | RESTRICT  | `ix_work_order_service_lines_service_ref`      |
| `wo.required_parts.item_ref`                   | `inv.item_master(tenant_id, id)`                                | `(tenant_id, item_ref)`                                      | RESTRICT  | `ix_required_parts_item_ref`                   |
| `wo.customer_approvals.quotation_revision_ref` | `quo.quotation_revisions(tenant_id, company_id, branch_id, id)` | `(tenant_id, company_id, branch_id, quotation_revision_ref)` | RESTRICT  | `ix_customer_approvals_quotation_revision_ref` |

## Why this stays green

- All three are `MATCH SIMPLE`: a NULL ref stays **unenforced** (opaque/unresolved is
  still valid), so no existing P1-9 row is orphaned and every P1-9 suite stays green.
- Each FK gets a **non-partial covering index** whose leading columns equal the FK
  columns, satisfying the repo FK-index-cover guard.
- The `quotation_revisions` target exists because that table denormalizes
  `tenant_id`/`company_id`/`branch_id` and declares `UNIQUE(tenant_id, company_id,
branch_id, id)` (review-response Low: revision candidate key), giving the full-scope
  forward FK a valid target.

## `wo.jobs` reconciliation

The instruction's `work_job.service_id` does **not** exist. `wo.jobs` carries **no**
service reference — services attach at the service-line level
(`wo.work_order_service_lines.service_ref`). This is a documented reconciliation, not
a missing column.

## Teardown ordering (Medium)

The `wo ↔ quo` forward FK makes the two schemas mutually referencing at the schema
level (the table-level FK graph stays acyclic). `deleteTenantCascade` interleaves
accordingly: `wo.customer_approval_evidence`/`wo.customer_approvals` are deleted before
`quo.*`, and `quo.quotations` before `wo.work_orders`. §1's "no cycles" wording is
corrected to "no cyclic table-level FK graph" (review-response Medium: forward-FK
teardown ordering; Wave 7).

**Tests:** the P1-10 forward-FK suite asserts the three FKs enforce on non-NULL refs,
tolerate NULL, and cover their indexes; the full P1-09 suite must remain green.
