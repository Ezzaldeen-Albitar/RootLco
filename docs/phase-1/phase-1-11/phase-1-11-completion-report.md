# Phase 1-11 — Completion Report

**Phase ID:** P1-11 · **Scope:** Billing / Payment / Delivery (`sal`), Warranty (`wty`),
Reporting configuration (`rpt`) database foundation.

Owner-authorized technical, QA, security, and adversarial self-review by Eng. Ezzaldeen
Al-Bitar under the Solo Developer Review Policy and the Standing Technical Authorization
Policy — **not** an independent third-party review.

## Summary

Phase 1-11 implements the database layer that closes the operational loop into money and
custody: invoices and lines whose amounts live in restricted 1:1 detail tables, per-tenant
invoice numbering, receipts and allocations that reconcile against a **derived** open
receivable, non-destructive corrections (credit notes and full-receipt reversals) under
dual control, an immutable `financial_events` integration boundary (explicitly **not** a
general ledger), delivery records that close the reception custody chain with a verified
receiver, mandatory checklist, captured final odometer and immutable signatures, warranty
policies with effective-dated coverage and immutable records, and the reporting-
configuration foundation with owner-isolated saved filters. It follows ADR-001 (one schema
per module): `sal`, `wty`, `rpt`. All business tables ship empty; the only structural rows
are the platform payment-method reference. Every correctness invariant is enforced in the
database (constraints, triggers, RLS, provenance/completeness guards, in-lock derivation)
— and **without any `SECURITY DEFINER`**.

## Object counts (live catalog)

| Object         | Count                                                                               |
| -------------- | ----------------------------------------------------------------------------------- |
| Tables         | 27 (19 `sal` + 5 `wty` + 3 `rpt`)                                                   |
| Functions      | 26 (all `SECURITY INVOKER`, `search_path=''`, `REVOKE PUBLIC`; **no `DEFINER`**)    |
| Triggers       | 67                                                                                  |
| Policies       | 75                                                                                  |
| Indexes        | 127 (`sal` 92 + `wty` 22 + `rpt` 13)                                                |
| Columns        | 427 (16 restricted, 0 restricted-searchable)                                        |
| Migrations     | 7 (`20260724090000` … `20260724096000`)                                             |
| P1-11 DB tests | see [phase-1-11-test-catalog.md](phase-1-11-test-catalog.md) (planned P1-11 suites) |

## Key invariants proven

- **One billable invoice per WO (FR-SAL-001).** `uq_invoices_work_order_active` partial
  unique; a number appears only at the atomic `issue_invoice` draft→issued transition
  (`ck_invoices_number_iff_issued`, H-fin-5); header totals recompute+verify from immutable
  lines.
- **Rollback-safe numbering (P1-OD-042).** `issue_invoice` allocates via the FOR-UPDATE
  `shared.next_display_number`; an aborted issue consumes no number; concurrent issues
  serialize. `mode` (`gapless`/`gapped`) documents the legal posture.
- **Allocation cannot overspend/overpay (BR-SAL-002).** `allocate_receipt` locks receipt
  then invoice `FOR UPDATE`; allocation ≤ derived receipt-unallocated and ≤ derived
  invoice-open; `Σ active allocations + unallocated = receipt amount`.
- **Balance is derived, never stored.** `invoice_open_receivable` /
  `partner_outstanding_balance` derive from issued gross − Σ active allocations − Σ approved
  credits (allocations of reversed receipts excluded); no editable balance column.
- **Financial-event trust (TS-002).** `financial_events` is immutable append-only
  (SELECT+INSERT, `seq bigint GENERATED ALWAYS`); single-use `UNIQUE(tenant, source_type,
source_id, event_type)`; provenance guard binds the amount to a valid source; five
  deferred constraint triggers force exactly one event per financial command; no
  debit/credit/account columns.
- **Non-destructive correction under dual control.** Credit notes and receipt reversals
  server-stamp maker≠approver, retain the original, and are immutable once approved.
- **Custody closes exactly once (BR-REC-001).** `complete_delivery` verifies eligibility +
  authorized receiver + mandatory checklist + final-odometer coherence, then writes the
  `rec.custody_history` release once; `uq_custody_history_released` is the additive-forward
  exactly-once backstop (C1). The delivery gates are enforced inside `complete_delivery`; a
  prototyped rec-forward delivery gate was removed, so H-dlv-1 is an accepted residual.
- **Warranty effective-dating (BR-WTY-001).** Eligibility uses coverage effective at the
  service/delivery date; gist `EXCLUDE` no-overlap on active coverage and on live records;
  issued records frozen.
- **Reporting isolation (BR-RPT-001).** `saved_filters` owner-only RLS (USING + WITH
  CHECK, non-reassignable); `scope_level ≤ report scope`.
- **Financial precision.** Money `NUMERIC(18,4)`, quantity `NUMERIC(12,3)`; zero float
  columns; currency via `shared.currencies` FK; every financial FK `ON DELETE RESTRICT`.
- **Column-level financial privacy (NFR-PRV-001).** 16 restricted columns physically
  isolated in RLS-gated tables (14 gated by `sal.finance.view`, 2 by `sal.delivery.view`);
  0 restricted-searchable.
- **No fabricated data.** Every business table empty after a clean migration; only the
  platform payment-method catalog seeded (structural, tenant-neutral, idempotent).

## Security findings

The round-1 design gate (ten lenses) resolved ten findings (design §17). The round-2
adversarial gate raised **1 Critical, 8 High, 12 Medium, 4 Low**, all adopted as binding
amendments before the migrations were finalized (see
[phase-1-11-review-response.md](phase-1-11-review-response.md)). Documented residuals
(O(n) balance derivation; delivery eligible-state set / numbering mode; warranty claim
adjudication) are deferred to P1-22/P1-23. At implementation, **zero unresolved Critical or
High** remain.

A **final red-team (PART S)** pass then probed raw single-statement SQL that bypasses the
sanctioned functions and raised **3 High (one borderline Critical), 1 Medium, 1 Low**, all
resolved **additively** (two new guard functions `sal.guard_invoice_amount_frozen` and
`wty.guard_warranty_record_coherence` + two new triggers `tg_invoice_amounts_frozen` and
`tg_warranty_records_coherence`; the rest folded into existing guards). This bumps the live
counts to **26 functions / 67 triggers**:

- **[HIGH-1, borderline Critical]** a raw `UPDATE sal.receipts SET status='reversed'` could
  unwind a payment with no reversal record, dual control, or `receipt_reversed` event
  (silently re-opening a paid invoice). **Fixed:** `sal.guard_receipt_freeze` now allows
  `reversed` only when an **approved** `sal.receipt_reversals` row exists (i.e. only via
  `sal.approve_receipt_reversal`, which now approves the reversal **before** flipping the
  receipt).
- **[HIGH-2]** issued invoice header totals (`invoice_amounts.net/tax/gross_total`) were
  mutable post-issue. **Fixed:** `sal.guard_invoice_amount_frozen` + `tg_invoice_amounts_frozen`
  freeze them once the invoice leaves draft.
- **[HIGH-3]** a raw INSERT of a born-`issued` invoice bypassed the gapless allocator and the
  `invoice_issued` event. **Fixed:** `sal.guard_invoice_freeze` now also fires BEFORE INSERT,
  requiring a new invoice to be born `status='draft'`.
- **[MED / M-wty-2]** a raw INSERT into `wty.warranty_records` was unbounded. **Fixed
  structurally:** `wty.guard_warranty_record_coherence` + `tg_warranty_records_coherence`
  (BEFORE INSERT) require a `delivered` delivery with matching `vehicle_id`/`work_order_id`.
  **Accepted residual M-wty-2b:** the finer `odometer_at_issue`/`start_date` value binding
  stays inside `wty.issue_warranty` (claim adjudication out of P1-11 scope).
- **[LOW / L-fin-4]** a line-amount's denormalized `invoice_id` could differ from its parent
  line's. **Fixed:** coherence check folded into `sal.guard_invoice_line_amount_frozen`
  (raises `23503`).

Every Critical/High is Fixed; the Medium is Fixed structurally with M-wty-2b an accepted
documented residual; the Low is Fixed. **Zero unresolved Critical or High remain.**

## Review model and gate status

The owner gate is **Decision: Pending** — the feature pull request is not yet merged, so
final hosted-CI and merge/containment evidence is not yet recorded (see
[phase-1-11-owner-gate.md](phase-1-11-owner-gate.md)).

## Out of scope (by design)

No general ledger (journal/chart-of-accounts/period/posting rule), no online-payment
gateway/settlement, no backend/API (P1-22), no reporting backend/export (P1-23), no UI
(P1-30/1-31), no P1-35 migration execution, and no real or fabricated business data. See
[phase-1-11-no-general-ledger-boundary.md](phase-1-11-no-general-ledger-boundary.md),
[phase-1-11-p1-22-backend-contract.md](phase-1-11-p1-22-backend-contract.md),
[phase-1-11-p1-23-reporting-backend-contract.md](phase-1-11-p1-23-reporting-backend-contract.md),
and [phase-1-11-p1-30-31-frontend-data-contract.md](phase-1-11-p1-30-31-frontend-data-contract.md).
