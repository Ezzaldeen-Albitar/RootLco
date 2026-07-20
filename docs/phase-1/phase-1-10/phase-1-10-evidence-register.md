# Phase 1-10 — Evidence Register

**Base:** `origin/develop` = `abd3362` (after Phase 1-9 closure). **Branch:**
`feature/p1-10-service-pricing-quotation-inventory-database`.

> **Merge/CI evidence is PENDING.** The feature pull request is not yet merged, so
> hosted-CI results on the final feature SHA, the merge commit/parents, and the
> containment proof are **not yet recorded**. This register captures the
> implemented-and-tested state on the feature branch; the merge rows below are
> placeholders completed by the gate-record pull request. See
> [phase-1-10-owner-gate.md](phase-1-10-owner-gate.md).

## Commit ledger (feature branch, by migration intent)

The feature branch carries the 8 migrations, the test suites, the seed/allow-list/
classification changes, and this documentation package. Per-migration rows record
intent.

| Wave | Migration | Intent                                                                                                                               |
| ---- | --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | `…090000` | Reserve `svc`/`quo`/`inv` module schemas + USAGE grants                                                                              |
| 2    | `…091000` | `svc` catalog: categories, services, versions (+succession), labor, availability                                                     |
| 3    | `…092000` | `svc` pricing: lists/versions/rules/assignments, discounts, policies (+`resolve_price`)                                              |
| 4    | `…093000` | `inv` reference: UoM (dual-scope), item categories, item master (+restricted cost), locations                                        |
| 5    | `…094000` | `inv` ledger: movements (immutable), balances (+coherence), reservations (+primitives)                                               |
| 6    | `…095000` | `inv` operations: opening, adjustments (+restricted), issues/returns, damage, CSP, external-purchase (+restricted), provenance guard |
| 7    | `…096000` | `quo`: quotations, revisions, items, decisions, evidence, status history (+`issue_revision`, `record_item_decision`)                 |
| 8    | `…097000` | Resolve the three P1-09 forward refs (service/item/quotation-revision) additively                                                    |

Additional non-migration work: classification registry + validator; no-fake-data
schema list extended to `svc`/`quo`/`inv`; platform UoM structural seed; auto-enumerated
security/isolation/concurrency/rollback test suites; CI wiring; this docs package.

## Verified counts (live catalog)

| Metric         | Value                                                                               |
| -------------- | ----------------------------------------------------------------------------------- |
| Tables         | 35 (11 `svc` + 6 `quo` + 18 `inv`)                                                  |
| Functions      | 37 (all `SECURITY INVOKER`; **no `SECURITY DEFINER`**)                              |
| Triggers       | 84                                                                                  |
| Policies       | 101                                                                                 |
| Indexes        | 155                                                                                 |
| Columns        | 582 (3 restricted, 0 restricted-searchable)                                         |
| Migrations     | 8 (`20260723090000`..`20260723097000`)                                              |
| P1-10 DB tests | see [phase-1-10-test-catalog.md](phase-1-10-test-catalog.md) (planned P1-10 suites) |

## Gate checklist

Implemented and tested on the feature branch:

- [x] Every P1-10 DB task implemented, registered in the foundation allow-lists,
      documented, tested (see [phase-1-10-traceability.md](phase-1-10-traceability.md)).
- [x] No FK-index gaps; no duplicate indexes on `svc`/`quo`/`inv`.
- [x] All 582 columns classified; 3 restricted (cost, gated by `inv.cost.view`), 0
      searchable; validator green.
- [x] No fabricated business data: business tables empty after clean migration; only
      the platform UoM structural reference seeded; seeds idempotent.
- [x] Append-only ledgers reject UPDATE/DELETE; forged/incoherent movements rejected;
      a raw-insert movement bypass is rejected by the provenance/single-use constraints.
- [x] Money `NUMERIC(18,4)`, quantity `NUMERIC(12,3)`, tax `NUMERIC(9,6)`; precision
      scan green; no float columns.
- [x] Single-winner concurrency races proven (last-unit reservation, single-issued
      revision, approval races, idempotent replay).
- [x] The three P1-09 forward FKs resolved additively; P1-09 suites remain green.
- [x] No P1-11 invoice/billing, P1-20/P1-21 backend, P1-30 frontend, or procurement
      table; `is_procurement=false` enforced.
- [x] Zero unresolved Critical/High at design and implementation (38 findings resolved).

Pending (completed by the gate-record pull request, from evidenced facts):

- [ ] Feature PR number, state **Merged**, final feature SHA.
- [ ] Merge target `develop`, strategy (merge commit, two parents), merge commit SHA +
      parents, merge author (Eng. Ezzaldeen Al-Bitar), merge timestamp.
- [ ] Hosted CI green on the exact final feature SHA (all required checks).
- [ ] Containment proof: the final feature SHA is an ancestor of `origin/develop`.
- [ ] `main` untouched by this work.

## Review model

Owner-authorized technical, QA, security, and adversarial self-review by
Eng. Ezzaldeen Al-Bitar under the Solo Developer Review Policy and the Standing
Technical Authorization Policy — **not** an independent third-party review.
