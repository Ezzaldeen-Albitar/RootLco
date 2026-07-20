# Phase 1-10 — Service Catalog, Pricing, Quotation, and Inventory Database

**Phase ID:** P1-10 · **Owner module schemas:** `svc` (Service Catalog + Pricing),
`quo` (Quotation + Approvals), `inv` (Inventory + Stock) · **Base:** `origin/develop`
= `abd3362` (after Phase 1-9 closure). · **Branch:**
`feature/p1-10-service-pricing-quotation-inventory-database`.

Phase 1-10 delivers the database foundation for the **commercial and stock layer**
that sits on top of the Phase 1-9 work order: the service catalog and its pricing,
customer quotations and their approvals, and the inventory ledger. It is a
database-only phase: no backend service (P1-20), no inventory backend (P1-21), no UI
(P1-30), no billing/invoice (P1-11), no procurement (PO/PR/goods-receipt/bidding),
and no real or fabricated business data.

## What this phase contains

- **Service Catalog + Pricing (`svc`, 11 tables):** a tenant service taxonomy, the
  stable `svc.services` identity (immutable `service_code`), effective-dated
  `svc.service_versions` with a gist non-overlap `EXCLUDE` on published versions and
  forward-only succession, positive standard labor times, branch availability, and
  the pricing layer — price lists in one currency, immutable published
  `svc.price_list_versions`, deterministic-precedence `svc.price_rules`,
  `svc.price_list_assignments` (one applicable book per context), bounded
  `svc.discount_rules`, and `svc.pricing_approval_policies`. Tax reuses
  `org.tax_classes`/`org.tax_rates`; approval ceilings reuse `iam.approval_limits`.
- **Quotation + Approvals (`quo`, 6 tables):** quotation masters (originating from a
  Phase 1-9 work order), immutable numbered revisions that **capture** the commercial
  amounts (so a later price change never alters an issued quotation), captured items,
  item-granular append-only approval decisions bound to the exact revision and item,
  document-bound evidence, and an append-only status ledger.
- **Inventory + Stock (`inv`, 18 tables):** a dual-scope unit-of-measure catalog, item
  categories, item master (with restricted 1:1 cost detail), branch-scoped stock
  locations, an **immutable append-only stock-movement ledger** with a `GENERATED
signed_qty` and a per-kind provenance guard, coherence-guarded derived balances,
  atomic reservations (single-winner last-unit race), part issues/returns, damaged
  stock (quarantine move), customer-supplied parts (no stock effect), a
  **non-procurement** external-purchase foundation (with restricted cost detail),
  opening inventory, and stock adjustments (with restricted value-impact detail).

## Verified counts (live introspection)

| Metric     | Value                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------- |
| Tables     | 35 (11 `svc` + 6 `quo` + 18 `inv`)                                                        |
| Functions  | 37 (all `SECURITY INVOKER`, `search_path=''`, `REVOKE PUBLIC`; **no `SECURITY DEFINER`**) |
| Triggers   | 84                                                                                        |
| Policies   | 101                                                                                       |
| Indexes    | 155                                                                                       |
| Columns    | 582                                                                                       |
| Migrations | 8 additive, forward-only (`20260723090000` … `20260723097000`)                            |

## Document index

| Document                                                                                                             | Purpose                                                                               |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [phase-1-10-design.md](phase-1-10-design.md)                                                                         | Architecture and design gate (fixed before any migration)                             |
| [phase-1-10-review-response.md](phase-1-10-review-response.md)                                                       | Adversarial self-review ledger — 38 findings resolved (2 C, 14 H, 20 M, 2 L)          |
| [phase-1-10-owner-gate.md](phase-1-10-owner-gate.md)                                                                 | Owner gate record (**Decision: Pending** — feature PR not yet merged)                 |
| [phase-1-10-completion-report.md](phase-1-10-completion-report.md)                                                   | Implementation summary + object counts                                                |
| [phase-1-10-object-inventory.md](phase-1-10-object-inventory.md)                                                     | Tables, functions, triggers, policies, indexes per schema                             |
| [phase-1-10-service-data-dictionary.md](phase-1-10-service-data-dictionary.md)                                       | `svc` catalog column dictionary (categories/services/versions/labor/availability)     |
| [phase-1-10-pricing-data-dictionary.md](phase-1-10-pricing-data-dictionary.md)                                       | `svc` pricing column dictionary (lists/versions/rules/assignments/discounts/policies) |
| [phase-1-10-quotation-data-dictionary.md](phase-1-10-quotation-data-dictionary.md)                                   | `quo` column dictionary                                                               |
| [phase-1-10-inventory-data-dictionary.md](phase-1-10-inventory-data-dictionary.md)                                   | `inv` column dictionary                                                               |
| [phase-1-10-service-version-contract.md](phase-1-10-service-version-contract.md)                                     | Stable identity + effective-dated succession                                          |
| [phase-1-10-branch-availability-contract.md](phase-1-10-branch-availability-contract.md)                             | Where a service is offered; archived-service block                                    |
| [phase-1-10-price-precedence-contract.md](phase-1-10-price-precedence-contract.md)                                   | Deterministic single-winner price resolution                                          |
| [phase-1-10-published-version-immutability-contract.md](phase-1-10-published-version-immutability-contract.md)       | Published-version + child freeze (BR-SVC-001)                                         |
| [phase-1-10-tax-configuration-contract.md](phase-1-10-tax-configuration-contract.md)                                 | Tax reuses `org.tax_*`; capture at quotation                                          |
| [phase-1-10-discount-approval-limit-contract.md](phase-1-10-discount-approval-limit-contract.md)                     | Discounts + approval-authority reuse                                                  |
| [phase-1-10-quotation-revision-contract.md](phase-1-10-quotation-revision-contract.md)                               | Numbered immutable revisions; single-issued invariant                                 |
| [phase-1-10-item-approval-contract.md](phase-1-10-item-approval-contract.md)                                         | Item-granular append-only decisions (BR-QUO-001/002)                                  |
| [phase-1-10-money-precision-currency-contract.md](phase-1-10-money-precision-currency-contract.md)                   | `NUMERIC(18,4)`; currency FK; coherence                                               |
| [phase-1-10-movement-ledger-contract.md](phase-1-10-movement-ledger-contract.md)                                     | Immutable movements + provenance (BR-INV-002)                                         |
| [phase-1-10-balance-derivation-contract.md](phase-1-10-balance-derivation-contract.md)                               | `on_hand`/`reserved`/`available` coherence (BR-INV-001)                               |
| [phase-1-10-reservation-locking-contract.md](phase-1-10-reservation-locking-contract.md)                             | Atomic reservation single-winner (FR-INV-002)                                         |
| [phase-1-10-issue-return-contract.md](phase-1-10-issue-return-contract.md)                                           | Part issue/return + return ceiling                                                    |
| [phase-1-10-damage-quarantine-contract.md](phase-1-10-damage-quarantine-contract.md)                                 | Damaged-stock quarantine move                                                         |
| [phase-1-10-customer-supplied-part-contract.md](phase-1-10-customer-supplied-part-contract.md)                       | Customer-owned, never valued stock                                                    |
| [phase-1-10-external-purchase-non-procurement-contract.md](phase-1-10-external-purchase-non-procurement-contract.md) | Non-procurement boundary (`is_procurement=false`)                                     |
| [phase-1-10-opening-inventory-contract.md](phase-1-10-opening-inventory-contract.md)                                 | Opening batch approval → movements                                                    |
| [phase-1-10-adjustment-approval-contract.md](phase-1-10-adjustment-approval-contract.md)                             | Adjustment approval + maker≠approver                                                  |
| [phase-1-10-p1-09-forward-fk-completion-report.md](phase-1-10-p1-09-forward-fk-completion-report.md)                 | Resolution of the three P1-09 opaque forward refs                                     |
| [phase-1-10-security-matrix.md](phase-1-10-security-matrix.md)                                                       | RLS / branch isolation / grants / restricted gating                                   |
| [phase-1-10-classification-matrix.md](phase-1-10-classification-matrix.md)                                           | Column classification + restricted cost tables                                        |
| [phase-1-10-append-only-immutability-matrix.md](phase-1-10-append-only-immutability-matrix.md)                       | Per-table mutability contract                                                         |
| [phase-1-10-abuse-case-ledger.md](phase-1-10-abuse-case-ledger.md)                                                   | Threat → control → test → residual ledger                                             |
| [phase-1-10-migration-classification.md](phase-1-10-migration-classification.md)                                     | Per-migration schema/security/function/index/reference class                          |
| [phase-1-10-index-evidence.md](phase-1-10-index-evidence.md)                                                         | Index list per table (FK-cover + query indexes)                                       |
| [phase-1-10-grant-matrix.md](phase-1-10-grant-matrix.md)                                                             | Per-object and per-function grants                                                    |
| [phase-1-10-evidence-register.md](phase-1-10-evidence-register.md)                                                   | Base SHA, migration list, counts, gate checklist (CI/merge pending)                   |
| [phase-1-10-traceability.md](phase-1-10-traceability.md)                                                             | FR/BR → migration → object → test/doc mapping                                         |
| [phase-1-10-test-catalog.md](phase-1-10-test-catalog.md)                                                             | Planned P1-10 database test suites                                                    |
| [phase-1-10-open-decisions.md](phase-1-10-open-decisions.md)                                                         | P1-OD-007/020/021/022/041/042 + DEP-05/06 handling                                    |
| [phase-1-10-change-log.md](phase-1-10-change-log.md)                                                                 | Chronological change log (waves + migrations)                                         |
| [p1-11-structural-contract.md](p1-11-structural-contract.md)                                                         | What P1-11 (invoice/billing) may reference; no duplication                            |
| [p1-20-backend-contract.md](p1-20-backend-contract.md)                                                               | Backend (P1-20) DB primitives + event contracts                                       |
| [p1-21-inventory-backend-contract.md](p1-21-inventory-backend-contract.md)                                           | Inventory backend (P1-21): expiry scheduler, transfers                                |
| [p1-30-frontend-contract.md](p1-30-frontend-contract.md)                                                             | Frontend (P1-30) read-model expectations                                              |
| [p1-35-migration-target-model.md](p1-35-migration-target-model.md)                                                   | Additive, forward-only target model for P1-35                                         |
| [procurement-exclusion-note.md](procurement-exclusion-note.md)                                                       | The procurement (PRC) exclusion boundary                                              |

## Governance

Reviewed under the **Solo Developer Review Policy** and the **Standing Technical
Authorization Policy** — owner-authorized technical, QA, security, and adversarial
self-review by Eng. Ezzaldeen Al-Bitar; **not** an independent third-party review.
The user performs every merge. The owner gate for this phase is **Decision: Pending**:
the feature pull request is not yet merged, so final hosted-CI and merge/containment
evidence is not yet recorded. See the [owner gate](phase-1-10-owner-gate.md) and the
[evidence register](phase-1-10-evidence-register.md) for what completes the gate.
