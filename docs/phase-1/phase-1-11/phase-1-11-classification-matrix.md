# Phase 1-11 — Classification Matrix

Every one of the 427 `sal`/`wty`/`rpt` columns is classified against the taxonomy
`public` / `internal` / `restricted` / `secret` and reconciled to the live schema by the
project classification validator (registry:
`docs/database/sal-wty-rpt-personal-data-classification.json`). **411 internal, 16
restricted, 0 public/secret, 0 restricted-searchable.** The validator fails on a missing,
stale, duplicate, invalid, restricted-searchable, or type-drifted entry.

Owner-authorized technical self-review by Eng. Ezzaldeen Al-Bitar under the Solo Developer
Review Policy and the Standing Technical Authorization Policy — not an independent
third-party review.

## Restricted columns (16)

### Financial amounts (14) — gated by `sal.finance.view`

| Restricted column                              | Type            | Table gating                       |
| ---------------------------------------------- | --------------- | ---------------------------------- |
| `sal.invoice_amounts.net_total`                | `numeric(18,4)` | whole-table RLS `sal.finance.view` |
| `sal.invoice_amounts.tax_total`                | `numeric(18,4)` | whole-table RLS `sal.finance.view` |
| `sal.invoice_amounts.gross_total`              | `numeric(18,4)` | whole-table RLS `sal.finance.view` |
| `sal.invoice_line_amounts.unit_price`          | `numeric(18,4)` | whole-table RLS `sal.finance.view` |
| `sal.invoice_line_amounts.net_amount`          | `numeric(18,4)` | whole-table RLS `sal.finance.view` |
| `sal.invoice_line_amounts.tax_amount`          | `numeric(18,4)` | whole-table RLS `sal.finance.view` |
| `sal.invoice_line_amounts.gross_amount`        | `numeric(18,4)` | whole-table RLS `sal.finance.view` |
| `sal.invoice_line_amounts.customer_pay_amount` | `numeric(18,4)` | whole-table RLS `sal.finance.view` |
| `sal.invoice_line_amounts.warranty_pay_amount` | `numeric(18,4)` | whole-table RLS `sal.finance.view` |
| `sal.receipts.amount`                          | `numeric(18,4)` | whole-row RLS `sal.finance.view`   |
| `sal.payment_allocations.amount`               | `numeric(18,4)` | whole-row RLS `sal.finance.view`   |
| `sal.credit_notes.amount`                      | `numeric(18,4)` | whole-row RLS `sal.finance.view`   |
| `sal.receipt_reversals.amount`                 | `numeric(18,4)` | whole-row RLS `sal.finance.view`   |
| `sal.financial_events.amount`                  | `numeric(18,4)` | whole-row RLS `sal.finance.view`   |

### Delivery identity evidence (2) — gated by `sal.delivery.view`

| Restricted column                                                | Type   | Table gating                      |
| ---------------------------------------------------------------- | ------ | --------------------------------- |
| `sal.authorized_receivers.identity_evidence_document_version_id` | `uuid` | whole-row RLS `sal.delivery.view` |
| `sal.delivery_signatures.signature_document_version_id`          | `uuid` | whole-row RLS `sal.delivery.view` |

**0 restricted columns are searchable.** Financial amounts live in the restricted 1:1
tables `sal.invoice_amounts`/`sal.invoice_line_amounts` (whose whole read/write policy
requires `sal.finance.view`, with an immutable `classification='restricted'` marker column,
CHECK-enforced) and in the finance-gated pure-financial tables. Receiver identity evidence
and signature document references are in `sal.delivery.view`-gated tables. This is genuine
row-level gating, not a column-masking view.

## Not restricted (deliberately)

- **Payer / receiver identity** (`invoices.payer_partner_id`, `receipts.payer_partner_id`,
  `authorized_receivers.receiver_partner_id`) are opaque `crm.business_partners`
  references classified `internal`; customer PII is owned by `crm`.
- **Invoice/receipt/credit numbers, statuses, dates, currency codes, lifecycle flags** are
  `internal` — operational, visible in scope. A non-finance role sees an invoice exists and
  its status, but not its amounts.
- **Warranty terms** (`duration_months`, `odometer_limit`, dates, covered scope) and
  **reporting configuration** (`report_code`, `parameter_schema`, `filter_definition`) are
  `internal` operational configuration.
- **Delivery checklist labels / results / reasons** are `internal`; only the receiver
  identity evidence and signature document references are restricted.

## Export mapping (Table 3.10, recorded for P1-23)

Amount-bearing payloads and payer splits map to `sal.finance.view` and the Table 3.10
sensitive-export row; `rpt.report_configurations.export_permission_code` (FK →
`iam.permissions`) records the per-report export gate for P1-23. No export backend is built
in P1-11.

## Boundary

No salary, government ID, medical, payroll, or personal contact data is stored in any
`sal`/`wty`/`rpt` table. Employee data remains in `iam`/`tech`; customer identity remains
in `crm`; document blobs and their `sha256` remain in `shared.document_versions`.
