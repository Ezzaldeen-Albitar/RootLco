# Phase 1-11 — Financial-Event Catalogue

**Requirement:** TS-002, P1-11-DB-009, Figure 4.29 (financial integration direction).
Owner-authorized technical self-review by Eng. Ezzaldeen Al-Bitar under the Solo Developer
Review Policy and the Standing Technical Authorization Policy — not an independent third-party
review.

## The six event types and their source binding

`sal.financial_events.event_type` CHECK IN the six values below; `source_type` CHECK IN
`('invoice','receipt','payment_allocation','credit_note','receipt_reversal')`. Exactly one
event is emitted per successful financial command, by the primitive named, with the amount
**bound to the source** by the provenance guard.

| `event_type`              | `source_type`        | Emitted by                     | Amount bound to                        |
| ------------------------- | -------------------- | ------------------------------ | -------------------------------------- |
| `invoice_issued`          | `invoice`            | `sal.issue_invoice`            | issued invoice `gross_total`           |
| `warranty_split_recorded` | `invoice`            | `sal.issue_invoice` (when > 0) | Σ line `warranty_pay_amount` (M-wty-3) |
| `receipt_recorded`        | `receipt`            | `sal.record_receipt`           | recorded receipt `amount`              |
| `payment_allocated`       | `payment_allocation` | `sal.allocate_receipt`         | allocation `amount`                    |
| `credit_note_issued`      | `credit_note`        | `sal.approve_credit_note`      | approved credit `amount`               |
| `receipt_reversed`        | `receipt_reversal`   | `sal.approve_receipt_reversal` | reversal `amount` (= original receipt) |

Note `warranty_split_recorded` and `invoice_issued` both bind to the **invoice** source but
are distinct `event_type`s, so both are permitted for one invoice under the single-use
constraint `uq_financial_events_source (tenant_id, source_type, source_id, event_type)`.

## Shape (immutable append-only, not a journal)

`(tenant, company, branch)`, `amount NUMERIC(18,4)` (>=0, **restricted**, `sal.finance.view`),
`currency_code` (→ `shared.currencies`), `occurred_at`, `actor_id`, `correlation_id`,
`idempotency_key`, `seq bigint GENERATED ALWAYS`. Grants are SELECT+INSERT only (no
UPDATE/DELETE). **No `debit`/`credit`/`account` columns** — this is a source-fact integration
boundary, not a general ledger (see
[phase-1-11-no-general-ledger-boundary.md](phase-1-11-no-general-ledger-boundary.md)).

## Completeness (H-fin-3)

Five `DEFERRABLE INITIALLY DEFERRED` constraint triggers
(`tg_invoices_event_completeness`, `tg_receipts_event_completeness`,
`tg_payment_allocations_event_completeness`, `tg_credit_notes_event_completeness`,
`tg_receipt_reversals_event_completeness`) make the matching event a **commit-time
constraint** — a financial command that fails to write its event aborts.

**Tests:** `sal-financial-event` (TC-P1-11-005).
