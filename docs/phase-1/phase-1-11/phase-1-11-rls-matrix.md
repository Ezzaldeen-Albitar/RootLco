# Phase 1-11 — RLS Matrix

Every one of the 27 `sal`/`wty`/`rpt` tables has RLS **enabled and forced** (**75
policies** total: `sal` 52, `wty` 14, `rpt` 9). `scope` is the row-visibility predicate;
`gated-by` names any permission clause layered **on top of** tenant/branch scope. All
application roles are `NOLOGIN NOBYPASSRLS`. Introspected from `pg_policies`.

Owner-authorized technical self-review by Eng. Ezzaldeen Al-Bitar under the Solo Developer
Review Policy and the Standing Technical Authorization Policy — not an independent
third-party review.

## Scope shapes

- **branch** = `tenant_id = iam.current_tenant_id() AND (allowed_company_ids() IS NULL OR
company_id = ANY …) AND (allowed_branch_ids() IS NULL OR branch_id = ANY …)`.
- **company** = tenant + `allowed_company_ids()` (no branch column).
- **tenant** = `tenant_id = iam.current_tenant_id()`.
- **dual-scope** = SELECT `scope='platform' OR tenant_id=current`; write `scope='tenant'
AND tenant_id=current`.
- **owner** = tenant + `owner_user_id = iam.current_user_id()` (USING and WITH CHECK).

## `sal` (52 policies)

| Table                               | Policies (cmd)  | Scope      | Gated-by                                                   |
| ----------------------------------- | --------------- | ---------- | ---------------------------------------------------------- |
| `invoices`                          | 3 (sel/ins/upd) | branch     | —                                                          |
| `invoice_amounts`                   | 3 (sel/ins/upd) | branch     | `sal.finance.view` (all commands)                          |
| `invoice_lines`                     | 3 (sel/ins/upd) | branch     | —                                                          |
| `invoice_line_amounts`              | 3 (sel/ins/upd) | branch     | `sal.finance.view` (all commands)                          |
| `invoice_numbering_configs`         | 3 (sel/ins/upd) | company    | —                                                          |
| `invoice_status_history`            | 2 (sel/ins)     | branch     | — (append-only)                                            |
| `payment_methods`                   | 3 (sel/ins/upd) | dual-scope | — (platform read, tenant write)                            |
| `receipts`                          | 3 (sel/ins/upd) | branch     | `sal.finance.view` (whole row)                             |
| `payment_allocations`               | 2 (sel/ins)     | branch     | `sal.finance.view` (whole row, append-only)                |
| `credit_notes`                      | 3 (sel/ins/upd) | branch     | `sal.finance.view` (whole row)                             |
| `receipt_reversals`                 | 3 (sel/ins/upd) | branch     | `sal.finance.view` (whole row)                             |
| `financial_events`                  | 2 (sel/ins)     | branch     | `sal.finance.view` (whole row, append-only)                |
| `delivery_records`                  | 3 (sel/ins/upd) | branch     | —                                                          |
| `delivery_checklist_templates`      | 3 (sel/ins/upd) | company    | —                                                          |
| `delivery_checklist_template_items` | 3 (sel/ins/upd) | company    | —                                                          |
| `delivery_checklist_results`        | 3 (sel/ins/upd) | branch     | —                                                          |
| `authorized_receivers`              | 3 (sel/ins/upd) | branch     | `sal.delivery.view` (sel); `sal.delivery.manage` (ins/upd) |
| `delivery_signatures`               | 2 (sel/ins)     | branch     | `sal.delivery.view` (sel); `sal.delivery.manage` (ins)     |
| `delivery_status_history`           | 2 (sel/ins)     | branch     | — (append-only)                                            |

## `wty` (14 policies)

| Table                     | Policies (cmd)  | Scope   | Gated-by        |
| ------------------------- | --------------- | ------- | --------------- |
| `warranty_policies`       | 3 (sel/ins/upd) | company | —               |
| `warranty_coverage`       | 3 (sel/ins/upd) | company | —               |
| `warranty_records`        | 3 (sel/ins/upd) | branch  | —               |
| `warranty_record_items`   | 3 (sel/ins/upd) | branch  | —               |
| `warranty_status_history` | 2 (sel/ins)     | branch  | — (append-only) |

## `rpt` (9 policies)

| Table                           | Policies (cmd)  | Scope  | Gated-by                                |
| ------------------------------- | --------------- | ------ | --------------------------------------- |
| `report_configurations`         | 3 (sel/ins/upd) | tenant | —                                       |
| `report_configuration_versions` | 3 (sel/ins/upd) | tenant | —                                       |
| `saved_filters`                 | 3 (sel/ins/upd) | owner  | `owner_user_id = iam.current_user_id()` |

## Notes

- **Finance gating (7 tables).** `receipts`, `payment_allocations`, `credit_notes`,
  `receipt_reversals`, `financial_events` gate the **whole row** on `sal.finance.view`;
  the restricted amount tables `invoice_amounts`/`invoice_line_amounts` gate every command
  on `sal.finance.view` (H-priv-1). Base `invoices`/`invoice_lines` remain branch-scoped
  structural rows so non-finance staff see existence/status but not amounts.
- **Delivery gating (2 tables).** `authorized_receivers`/`delivery_signatures` SELECT gate
  on `sal.delivery.view` (receiver identity evidence + signature doc references are
  sensitive); INSERT/UPDATE gate on `sal.delivery.manage`.
- **`saved_filters` removal is soft-delete only.** Its owner-only RLS applies to
  SELECT/INSERT/UPDATE (USING + WITH CHECK); there is **no DELETE grant** — an owner removes
  a filter by soft-delete (UPDATE `deleted_at`), consistent with the platform-wide "hard
  delete is never an application capability" invariant. `owner_user_id` is immutable and
  cannot be reassigned. After this, **no P1-11 table grants DELETE** to any application role.
- **No-context default-deny.** An unset tenant GUC makes the `iam` helpers return NULL and
  the business-table policies false.
