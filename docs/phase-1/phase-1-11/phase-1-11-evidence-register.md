# Phase 1-11 — Evidence Register

**Base:** `origin/develop` = `3221b94` (P1-10 gate merge #42). **Branch:**
`feature/p1-11-billing-payment-delivery-warranty-reporting-database`.

Owner-authorized technical, QA, security, and adversarial self-review by Eng. Ezzaldeen
Al-Bitar under the Solo Developer Review Policy and the Standing Technical Authorization
Policy — **not** an independent third-party review.

> **Merge/CI evidence is PENDING.** The feature pull request is not yet merged, so
> hosted-CI results on the final feature SHA, the merge commit/parents, and the containment
> proof are **not yet recorded**. This register captures the implemented-and-tested state on
> the feature branch; the merge rows below are placeholders completed by the gate-record
> pull request. See [phase-1-11-owner-gate.md](phase-1-11-owner-gate.md).

## Commit ledger (feature branch, by migration intent)

| Wave | Migration | Intent                                                                                                                                             |
| ---- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `…090000` | Reserve `sal`/`wty`/`rpt` schemas + USAGE grants; additive `rec.custody_history` exactly-once release backstop (`uq_custody_history_released`, C1) |
| 2    | `…091000` | Invoices + restricted `invoice_amounts`; lines + restricted `invoice_line_amounts`; numbering configs; status history; `issue_invoice`             |
| 3    | `…092000` | Payment methods; receipts; allocations; `record_receipt`/`allocate_receipt`; open-receivable/receipt-unallocated derivations                       |
| 4    | `…093000` | Immutable `financial_events` (provenance + single-use + completeness); credit notes; receipt reversals; `approve_*`                                |
| 5    | `…094000` | Delivery records; checklist templates/items/results; authorized receivers; signatures; status history; `complete_delivery`                         |
| 6    | `…095000` | Warranty policies; effective-dated coverage (gist EXCLUDE); records + items; status history; `issue_warranty`                                      |
| 7    | `…096000` | Report configurations + versions (published-immutable); user-owned saved filters                                                                   |

Additional non-migration work: classification registry
(`sal-wty-rpt-personal-data-classification.json`) + validator; no-fake-data schema list
extended to `sal`/`wty`/`rpt`; platform payment-method structural seed; auto-enumerated
security/isolation/concurrency/idempotency/rollback test suites; CI wiring; this docs
package; the appended `docs/database/data-dictionary.md` §SAL/§WTY/§RPT section.

## Verified counts (live catalog)

| Metric         | Value                                                                               |
| -------------- | ----------------------------------------------------------------------------------- |
| Tables         | 27 (19 `sal` + 5 `wty` + 3 `rpt`)                                                   |
| Functions      | 26 (all `SECURITY INVOKER`; **no `SECURITY DEFINER`**)                              |
| Triggers       | 67                                                                                  |
| Policies       | 75                                                                                  |
| Indexes        | 127 (`sal` 92 + `wty` 22 + `rpt` 13)                                                |
| Columns        | 427 (16 restricted, 0 restricted-searchable)                                        |
| Migrations     | 7 (`20260724090000`..`20260724096000`)                                              |
| P1-11 DB tests | see [phase-1-11-test-catalog.md](phase-1-11-test-catalog.md) (planned P1-11 suites) |

## Gate checklist

Implemented and tested on the feature branch:

- [x] Every P1-11 DB task implemented, registered in the foundation allow-lists, documented,
      tested (see [phase-1-11-traceability.md](phase-1-11-traceability.md)).
- [x] No FK-index gaps; no duplicate indexes on `sal`/`wty`/`rpt`.
- [x] All 427 columns classified; 16 restricted (14 gated by `sal.finance.view`, 2 by
      `sal.delivery.view`), 0 searchable; validator green.
- [x] No fabricated business data: business tables empty after clean migration; only the
      platform payment-method structural reference seeded; seeds idempotent.
- [x] Append-only ledgers reject UPDATE/DELETE; forged financial events rejected; exactly
      one event per financial command (deferred completeness triggers).
- [x] Money `NUMERIC(18,4)`, quantity `NUMERIC(12,3)`; precision scan green; no float
      columns; every financial FK `ON DELETE RESTRICT`.
- [x] Single-winner concurrency proven (numbering race, duplicate-issue, allocation ×5,
      concurrent reversal, double custody release); idempotent replay returns the original.
- [x] Outstanding-balance derivation equals fact-level recomputation; no editable balance.
- [x] Custody released exactly once (`uq_custody_history_released`); the delivery gates are
      enforced inside `sal.complete_delivery` (rec-forward gate removed; H-dlv-1 accepted
      residual).
- [x] No general-ledger / gateway / backend / frontend table; no P1-35 execution.
- [x] Zero unresolved Critical/High at design and implementation (round-2: 1 C, 8 H, 12 M,
      4 L, all adopted).

Pending (completed by the gate-record pull request, from evidenced facts):

- [ ] Feature PR number, state **Merged**, final feature SHA.
- [ ] Merge target `develop`, strategy (merge commit, two parents), merge commit SHA +
      parents, merge author (Eng. Ezzaldeen Al-Bitar), merge timestamp.
- [ ] Hosted CI green on the exact final feature SHA (all required checks).
- [ ] Containment proof: the final feature SHA is an ancestor of `origin/develop`.
- [ ] `main` untouched by this work.
