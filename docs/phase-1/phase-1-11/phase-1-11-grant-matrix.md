# Phase 1-11 — Grant Matrix

Per-object and per-function grants (introspected). Application roles are `NOLOGIN
NOBYPASSRLS`; `app_worker` receives **no** P1-11 grant. USAGE on `sal`/`wty`/`rpt` is
granted to `app_runtime` + `app_readonly` (migration `…090000`); no CREATE is granted to
any application role.

Owner-authorized technical self-review by Eng. Ezzaldeen Al-Bitar under the Solo Developer
Review Policy and the Standing Technical Authorization Policy — not an independent
third-party review.

## Table grants

| Table group                                                                                                                                                                                                                                                                                                                                                                  | `app_runtime`          | `app_readonly` | `app_worker` |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | -------------- | ------------ |
| Mutable masters/config (`invoices`, `invoice_amounts`, `invoice_lines`, `invoice_line_amounts`, `invoice_numbering_configs`, `payment_methods`, `receipts`, `credit_notes`, `receipt_reversals`, `delivery_records`, `delivery_checklist_templates`/`_items`/`_results`, `authorized_receivers`, all `wty.*` except status history, `rpt.report_configurations`/`_versions`) | SELECT, INSERT, UPDATE | SELECT         | —            |
| Append-only ledgers (`invoice_status_history`, `payment_allocations`, `financial_events`, `delivery_signatures`, `delivery_status_history`, `warranty_status_history`)                                                                                                                                                                                                       | SELECT, INSERT         | SELECT         | —            |
| User-owned (`rpt.saved_filters`)                                                                                                                                                                                                                                                                                                                                             | SELECT, INSERT, UPDATE | SELECT         | —            |

**DELETE is granted to no application role on any P1-11 table.** Deletion is always a
soft-delete UPDATE (`deleted_at`); the user-owned `rpt.saved_filters` is likewise
soft-delete only — an owner removes a personal filter via UPDATE `deleted_at`, consistent
with the platform-wide "hard delete is never an application capability" invariant. The
append-only ledgers have no soft-delete and no UPDATE. The restricted amount tables
(`invoice_amounts`, `invoice_line_amounts`) and the finance/delivery-gated tables carry the
table GRANT **and** an RLS permission clause — the GRANT alone is insufficient (a role
without `sal.finance.view` / `sal.delivery.view` sees no rows and cannot write).

## Function grants

All 26 functions are `SECURITY INVOKER`, `SET search_path=''`, `REVOKE EXECUTE FROM
PUBLIC`; **none is `SECURITY DEFINER`**. Guard/stamper functions carry **no** grant (they
run only as triggers). The following primitives and derivations carry an explicit `GRANT
EXECUTE`:

| Function                                                                                                                 | Granted to                    |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| `sal.issue_invoice(p_invoice_id uuid, p_correlation_id uuid)`                                                            | `app_runtime`                 |
| `sal.record_receipt(uuid, uuid, uuid, uuid, text, numeric, uuid, text, uuid)`                                            | `app_runtime`                 |
| `sal.allocate_receipt(p_receipt_id uuid, p_invoice_id uuid, p_amount numeric, p_correlation_id uuid)`                    | `app_runtime`                 |
| `sal.approve_credit_note(p_credit_id uuid, p_correlation_id uuid)`                                                       | `app_runtime`                 |
| `sal.approve_receipt_reversal(p_reversal_id uuid, p_correlation_id uuid)`                                                | `app_runtime`                 |
| `sal.complete_delivery(p_delivery_id uuid, p_final_odometer_value numeric, p_odometer_unit text, p_correlation_id uuid)` | `app_runtime`                 |
| `sal.invoice_open_receivable(p_invoice_id uuid)`                                                                         | `app_runtime`, `app_readonly` |
| `sal.partner_outstanding_balance(p_partner_id uuid)`                                                                     | `app_runtime`, `app_readonly` |
| `sal.receipt_unallocated(p_receipt_id uuid)`                                                                             | `app_runtime`, `app_readonly` |
| `wty.issue_warranty(p_delivery_id uuid, p_policy_id uuid, p_correlation_id uuid, p_idempotency_key text)`                | `app_runtime`                 |

Guard/stamper functions with **no** grant (called only as triggers): `sal.guard_*`
(`guard_invoice_freeze`, `guard_invoice_line_frozen`, `guard_invoice_line_amount_frozen`,
`guard_invoice_totals_reconcile`, `guard_receipt_freeze`, `guard_dual_control_approval`,
`guard_event_completeness`, `guard_financial_event_provenance`, `guard_delivery_coherence`,
`guard_authorized_receiver`), `sal.stamp_dual_control_maker`,
`wty.guard_warranty_record_freeze`, `rpt.guard_report_version_freeze`, and
`rpt.guard_saved_filter_scope`.

## Function-security posture

A `SECURITY INVOKER` function runs with the caller's RLS, so no primitive can bypass
tenant/branch isolation or the finance/delivery permission gates. There is no privileged
write path — financial integrity is enforced by constraints, provenance/completeness
guards, and in-lock derivation. The mutating primitives are `app_runtime`-only; the three
read-only derivations are additionally `app_readonly`.
