# Phase 1-11 — Billing, Payment, Delivery, Warranty, and Reporting Database

**Phase ID:** P1-11 · **Owner module schemas:** `sal` (Billing / Payment / Delivery), `wty`
(Warranty), `rpt` (Reporting configuration) · **Base:** `origin/develop` = `3221b94` (P1-10
gate merge #42). · **Branch:**
`feature/p1-11-billing-payment-delivery-warranty-reporting-database`.

Phase 1-11 delivers the database foundation for the **closing commercial chain** that sits on
top of the Phase 1-9 work order and the Phase 1-10 commercial/stock layer: invoices and
payments, non-destructive corrections, the immutable financial-event integration boundary,
delivery/custody closure, warranty, and the reporting-configuration foundation. It is a
database-only phase: **no general ledger** (journal/chart-of-accounts/period/posting rule), no
online-payment gateway, no backend (P1-22), no reporting backend (P1-23), no UI (P1-30/1-31),
no P1-35 execution, and no real or fabricated business data.

## What this phase contains

- **Billing / Payment / Delivery (`sal`, 19 tables):** invoices (one live per work order) with
  money in a **restricted 1:1 `invoice_amounts`** table; lines with a **restricted 1:1
  `invoice_line_amounts`** carrying the `customer_pay + warranty_pay = gross` payer split;
  per-tenant invoice numbering (gapless/gapped configuration, rollback-safe allocator);
  dual-scope payment methods; receipts that freeze once recorded; append-only allocations
  bounded by a **derived** open receivable; credit notes and full-receipt reversals under
  server-stamped dual control; the **immutable `financial_events`** ledger (single-use,
  provenance-guarded, completeness-enforced, **no journal columns**); and the delivery slice —
  records, checklists, authorized receivers, hash-anchored signatures, and status history — that
  closes the reception custody chain exactly once.
- **Warranty (`wty`, 5 tables):** policies, effective-dated coverage (gist `EXCLUDE`
  no-overlap), immutable records bound to the delivery, covered items, and append-only status
  history; eligibility uses coverage effective at the service date.
- **Reporting configuration (`rpt`, 3 tables):** versioned report configurations (published
  immutable), and user-owned saved filters (owner-only RLS, export scope ≤ report scope).

## Verified counts (live introspection)

| Metric     | Value                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------- |
| Tables     | 27 (19 `sal` + 5 `wty` + 3 `rpt`)                                                         |
| Functions  | 26 (all `SECURITY INVOKER`, `search_path=''`, `REVOKE PUBLIC`; **no `SECURITY DEFINER`**) |
| Triggers   | 67                                                                                        |
| Policies   | 75                                                                                        |
| Indexes    | 127 (`sal` 92 + `wty` 22 + `rpt` 13)                                                      |
| Columns    | 427 (16 restricted, 0 restricted-searchable)                                              |
| Migrations | 7 additive, forward-only (`20260724090000` … `20260724096000`)                            |

## Document index

| Document                                                                                                       | Purpose                                                                   |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [phase-1-11-design.md](phase-1-11-design.md)                                                                   | Architecture + design gate (round-1 §17 + round-2 §19 binding amendments) |
| [phase-1-11-review-response.md](phase-1-11-review-response.md)                                                 | Adversarial gate ledger — 1 C, 8 H, 12 M, 4 L resolved                    |
| [phase-1-11-owner-gate.md](phase-1-11-owner-gate.md)                                                           | Owner gate record (**Decision: Pending** — feature PR not yet merged)     |
| [phase-1-11-completion-report.md](phase-1-11-completion-report.md)                                             | Implementation summary + object counts + key invariants                   |
| [phase-1-11-object-inventory.md](phase-1-11-object-inventory.md)                                               | Tables/functions/triggers/policies/indexes/migrations per schema          |
| [phase-1-11-data-dictionary-sal.md](phase-1-11-data-dictionary-sal.md)                                         | `sal` per-column dictionary                                               |
| [phase-1-11-data-dictionary-wty.md](phase-1-11-data-dictionary-wty.md)                                         | `wty` per-column dictionary                                               |
| [phase-1-11-data-dictionary-rpt.md](phase-1-11-data-dictionary-rpt.md)                                         | `rpt` per-column dictionary                                               |
| [phase-1-11-invoice-identity-contract.md](phase-1-11-invoice-identity-contract.md)                             | One invoice per WO; atomic issue; freeze (FR-SAL-001)                     |
| [phase-1-11-invoice-numbering-contract.md](phase-1-11-invoice-numbering-contract.md)                           | Gapless/gapped config; rollback-safe allocator (P1-OD-042)                |
| [phase-1-11-invoice-line-payer-split-contract.md](phase-1-11-invoice-line-payer-split-contract.md)             | Line money + `customer_pay+warranty_pay=gross` (FR-WTY-004)               |
| [phase-1-11-invoice-issue-idempotency-contract.md](phase-1-11-invoice-issue-idempotency-contract.md)           | DB business keys + in-lock short-circuit (BR-SAL-001)                     |
| [phase-1-11-payment-method-contract.md](phase-1-11-payment-method-contract.md)                                 | Dual-scope methods; no gateway kinds (ASM-14)                             |
| [phase-1-11-receipt-contract.md](phase-1-11-receipt-contract.md)                                               | Receipt record + freeze-on-record (H-fin-4)                               |
| [phase-1-11-allocation-locking-contract.md](phase-1-11-allocation-locking-contract.md)                         | Fixed-order locks; no overspend/overpay (BR-SAL-002)                      |
| [phase-1-11-outstanding-balance-derivation-contract.md](phase-1-11-outstanding-balance-derivation-contract.md) | Derived, never stored; property test (TC-P1-11-004)                       |
| [phase-1-11-credit-note-contract.md](phase-1-11-credit-note-contract.md)                                       | Invoice-linked credit; dual control (FR-SAL-004)                          |
| [phase-1-11-receipt-reversal-contract.md](phase-1-11-receipt-reversal-contract.md)                             | Full-receipt reversal; original retained (H-fin-1)                        |
| [phase-1-11-financial-event-catalogue.md](phase-1-11-financial-event-catalogue.md)                             | The 6 event types + source binding                                        |
| [phase-1-11-financial-event-provenance-contract.md](phase-1-11-financial-event-provenance-contract.md)         | Single-use + provenance + completeness (TS-002)                           |
| [phase-1-11-no-general-ledger-boundary.md](phase-1-11-no-general-ledger-boundary.md)                           | No journal/CoA/period/posting; source-fact boundary                       |
| [phase-1-11-delivery-eligibility-contract.md](phase-1-11-delivery-eligibility-contract.md)                     | Delivery coherence; eligible-state config (P1-OD-023)                     |
| [phase-1-11-authorized-receiver-contract.md](phase-1-11-authorized-receiver-contract.md)                       | Receiver validated vs party roles (M-dlv-2)                               |
| [phase-1-11-delivery-checklist-contract.md](phase-1-11-delivery-checklist-contract.md)                         | Mandatory checklist gate (L-dlv-1)                                        |
| [phase-1-11-delivery-signature-evidence-contract.md](phase-1-11-delivery-signature-evidence-contract.md)       | Append-only signatures; sha256 anchor                                     |
| [phase-1-11-custody-closure-contract.md](phase-1-11-custody-closure-contract.md)                               | Exactly-once custody release (C1); H-dlv-1 accepted residual              |
| [phase-1-11-warranty-policy-version-contract.md](phase-1-11-warranty-policy-version-contract.md)               | Effective-dated coverage; no-overlap (BR-WTY-001)                         |
| [phase-1-11-warranty-eligibility-contract.md](phase-1-11-warranty-eligibility-contract.md)                     | Terms at service date; backdating neutralized                             |
| [phase-1-11-warranty-record-contract.md](phase-1-11-warranty-record-contract.md)                               | Record bound to delivery; immutable; status history (FR-WTY-002/003)      |
| [phase-1-11-reporting-configuration-contract.md](phase-1-11-reporting-configuration-contract.md)               | Config foundation; published immutable (FR-RPT-001)                       |
| [phase-1-11-saved-filter-ownership-contract.md](phase-1-11-saved-filter-ownership-contract.md)                 | Owner-only RLS; scope ceiling (BR-RPT-001)                                |
| [phase-1-11-financial-precision-currency-contract.md](phase-1-11-financial-precision-currency-contract.md)     | `NUMERIC(18,4)`; currency FK; round-then-sum; RESTRICT                    |
| [phase-1-11-rls-matrix.md](phase-1-11-rls-matrix.md)                                                           | Per-table policies / scope / gated-by                                     |
| [phase-1-11-grant-matrix.md](phase-1-11-grant-matrix.md)                                                       | Per-object and per-function grants (all functions SECURITY INVOKER)       |
| [phase-1-11-classification-matrix.md](phase-1-11-classification-matrix.md)                                     | 16 restricted columns + gating permission                                 |
| [phase-1-11-append-only-immutability-matrix.md](phase-1-11-append-only-immutability-matrix.md)                 | Per-table mutability contract                                             |
| [phase-1-11-index-evidence.md](phase-1-11-index-evidence.md)                                                   | FK-cover + query-family indexes                                           |
| [phase-1-11-abuse-case-ledger.md](phase-1-11-abuse-case-ledger.md)                                             | Threat → control → suite → residual                                       |
| [phase-1-11-test-catalog.md](phase-1-11-test-catalog.md)                                                       | Planned P1-11 database test suites                                        |
| [phase-1-11-migration-classification.md](phase-1-11-migration-classification.md)                               | Per-migration class; roll-forward-only for financial                      |
| [phase-1-11-roll-forward-only-recovery-note.md](phase-1-11-roll-forward-only-recovery-note.md)                 | Why + how financial tables are roll-forward-only                          |
| [phase-1-11-evidence-register.md](phase-1-11-evidence-register.md)                                             | Base SHA, migration list, counts, gate checklist (CI/merge pending)       |
| [phase-1-11-traceability.md](phase-1-11-traceability.md)                                                       | FR/BR + task → migration → object → suite → doc                           |
| [phase-1-11-change-log.md](phase-1-11-change-log.md)                                                           | Chronological change log (waves + migrations)                             |
| [phase-1-11-od-linkage.md](phase-1-11-od-linkage.md)                                                           | P1-OD-007/023/024/042 + DEP-07/11 handling                                |
| [phase-1-11-p1-12-integration-gate-contract.md](phase-1-11-p1-12-integration-gate-contract.md)                 | What the P1-12 gate must accept                                           |
| [phase-1-11-p1-22-backend-contract.md](phase-1-11-p1-22-backend-contract.md)                                   | DB primitives P1-22 will call + outbox contracts                          |
| [phase-1-11-p1-23-reporting-backend-contract.md](phase-1-11-p1-23-reporting-backend-contract.md)               | Reporting backend read model + export gating                              |
| [phase-1-11-p1-30-31-frontend-data-contract.md](phase-1-11-p1-30-31-frontend-data-contract.md)                 | Frontend read-model + permission-shaped UI expectations                   |
| [phase-1-11-p1-35-migration-target-model.md](phase-1-11-p1-35-migration-target-model.md)                       | Additive, forward-only target model for P1-35                             |

The Phase 1-11 §SAL/§WTY/§RPT section is also appended to the platform
[`docs/database/data-dictionary.md`](../../database/data-dictionary.md).

## Governance

Reviewed under the **Solo Developer Review Policy** and the **Standing Technical Authorization
Policy** — owner-authorized technical, QA, security, and adversarial self-review by
Eng. Ezzaldeen Al-Bitar; **not** an independent third-party review. The user performs every
merge. The owner gate for this phase is **Decision: Pending**: the feature pull request is not
yet merged, so final hosted-CI and merge/containment evidence is not yet recorded. See the
[owner gate](phase-1-11-owner-gate.md) and the [evidence register](phase-1-11-evidence-register.md)
for what completes the gate.
