# Phase 1-11 — Change Log

Chronological by wave. All schema changes are additive and forward-only; no merged
migration was edited.

Owner-authorized technical self-review by Eng. Ezzaldeen Al-Bitar under the Solo Developer
Review Policy and the Standing Technical Authorization Policy — not an independent
third-party review.

## Waves

| Wave | Theme                                                      | What landed                                                                                                                                                                                                                                                                                              |
| ---- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Baseline                                                   | Cut `feature/p1-11-billing-payment-delivery-warranty-reporting-database` from `origin/develop` = `3221b94` (P1-10 gate merge #42); confirmed clean baseline (no `sal`/`wty`/`rpt` objects).                                                                                                              |
| 1    | Design gate (round 1) + adversarial round 2                | Fixed [phase-1-11-design.md](phase-1-11-design.md); ten-lens round-1 gate (§17) resolved; round-2 gate (§19) surfaced 1 C, 8 H, 12 M, 4 L, all adopted as binding amendments (see [review-response](phase-1-11-review-response.md)); reserved the three schemas + additive custody backstop (`…090000`). |
| 2    | Invoices                                                   | `sal.invoices` (+restricted `invoice_amounts`), `invoice_lines` (+restricted `invoice_line_amounts`), numbering configs, status history; `issue_invoice` (`…091000`).                                                                                                                                    |
| 3    | Payments                                                   | `sal.payment_methods` (dual-scope), `receipts` (freeze), `payment_allocations`; `record_receipt`, `allocate_receipt`; derivation functions (`…092000`).                                                                                                                                                  |
| 4    | Financial events + corrections                             | `sal.financial_events` (provenance + single-use + completeness); `credit_notes`, `receipt_reversals` (dual control); `approve_credit_note`, `approve_receipt_reversal` (`…093000`).                                                                                                                      |
| 5    | Delivery + custody closure                                 | `sal.delivery_records`, checklist templates/items/results, authorized receivers, signatures, status history; `complete_delivery`; the exactly-once custody-release backstop (`uq_custody_history_released`) enforced (`…094000`).                                                                        |
| 6    | Warranty                                                   | `wty` policies, effective-dated coverage (gist EXCLUDE), records + items, status history; `issue_warranty` (`…095000`).                                                                                                                                                                                  |
| 7    | Reporting configuration                                    | `rpt` report configurations + versions (published-immutable), user-owned saved filters (`…096000`).                                                                                                                                                                                                      |
| 8    | Classification, isolation, concurrency, rollback, seed, CI | Classification registry + validator; auto-enumerated security; isolation; concurrency; idempotency; rollback/clean-room; platform payment-method structural seed; no-fake-data schema list extended to `sal`/`wty`/`rpt`; CI wiring; P1-11 test suites.                                                  |
| 9    | Docs, clean-room                                           | This `docs/phase-1/phase-1-11/` package; appended `docs/database/data-dictionary.md` §SAL/§WTY/§RPT; clean-room from-zero apply; owner-gate record left **Pending** (feature PR not yet merged).                                                                                                         |

## Migrations (7, forward-only)

| Migration                      | Change                                                                                                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `…090000_salwtyrpt_schemas`    | Reserve `sal`/`wty`/`rpt` module schemas; USAGE grants; additive `rec.custody_history` exactly-once release backstop (`uq_custody_history_released`, C1)                                                            |
| `…091000_sal_invoices`         | Invoices (one-live-per-WO, number-iff-issued) + restricted `invoice_amounts`; lines + restricted `invoice_line_amounts` (payer split); numbering configs; status history; `issue_invoice` + freeze/reconcile guards |
| `…092000_sal_payments`         | Dual-scope payment methods; receipts (freeze-on-record); append-only allocations; `record_receipt`, `allocate_receipt`; `invoice_open_receivable`/`partner_outstanding_balance`/`receipt_unallocated`               |
| `…093000_sal_financial_events` | Immutable `financial_events` (single-use, provenance, 5 completeness triggers); credit notes + receipt reversals (server-stamped dual control); `approve_credit_note`, `approve_receipt_reversal`                   |
| `…094000_sal_delivery`         | Delivery records (one-live-per-WO); checklist templates/items/results (mandatory gate); authorized receivers; signatures (sha256 bind); status history; `complete_delivery`                                         |
| `…095000_wty_warranty`         | Warranty policies; effective-dated coverage (gist EXCLUDE no-overlap); records (immutable) + items; status history; `issue_warranty`                                                                                |
| `…096000_rpt_reporting`        | Report configurations + versions (published-immutable); user-owned saved filters (owner-only RLS, scope ceiling)                                                                                                    |

## Non-migration changes

- `docs/database/data-dictionary.md` — appended a Phase 1-11 §SAL/§WTY/§RPT section
  (restricted columns labelled).
- `docs/database/sal-wty-rpt-personal-data-classification.json` — classification registry
  for all 427 `sal`/`wty`/`rpt` columns (16 restricted, 0 searchable) + validator.
- No-fake-data schema list extended to `sal`/`wty`/`rpt`; platform payment-method structural
  seed; CI step wiring; the P1-11 test suites; this docs package.
