# Phase 1-7 — Vehicle Database

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-7 — Vehicle Database ·
**Date:** 2026-07-20 · **Branch:** `feature/p1-07-vehicle-database`
(base `develop` @ `416cf9e`; first phase commit `ab7113f`) ·
**Author:** Eng. Ezzaldeen Al-Bitar, under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)

This folder is the closeout package for Phase 1-7. This README is its entry
point; every other file is linked from the [document index](#3-document-index).

## 1. What Phase 1-7 delivers

Phase 1-7 builds the Vehicle **database foundation**: an independent Vehicle
master whose identity survives every owner, plate, and engine change (zero
partner/owner columns on the master — FR-VEH-001); VIN normalization with
tenant-scoped active uniqueness and a controlled missing-VIN activation
contract; a typed, classification-gated identifier ledger; append-only VIN
verification and attribute history; mutable-temporal engine, transmission,
plate, ownership, and relationship intervals with EXCLUDE non-overlap and
point-in-time resolvers; EV profiles coupled to the powertrain in both
directions plus battery masters and append-only readings; a forward-only
odometer series with reasoned anomaly-flagged corrections; a trigger-emitted,
forgery-proof status ledger; Vehicle alerts; explainable duplicate candidates
with a positive-schema match basis; and an atomic, append-only Vehicle merge
primitive with survivor resolution — delivered as **23 tables, 320 columns,
29 functions, 57 triggers, 62 RLS policies, and 91 indexes** (plus 54 foreign
keys, 104 check constraints, and 7 EXCLUDE constraints), created across 16
forward-only veh migrations (`20260720090000`–`20260720105000`, the last being
the red-team forward correction) and verified by live schema introspection. The generated
[object inventory](./veh-object-inventory.md) is the authoritative count table,
the [data dictionary annex](./veh-data-dictionary.md) is the column-level
reference, and the [ERD](../../database/erd/phase-1-7-vehicle.mmd) shows the
relationships.

## 2. What Phase 1-7 deliberately does NOT build

- **No application or API layer** — the schema is the deliverable. Review,
  orchestration, and API write paths are Phase 1-15/1-17.
- **No reception, appointment, or work-order objects** — Phase 1-8 scope,
  asserted absent by
  [`veh-structural-contract.test.ts`](../../../tests/db/veh-structural-contract.test.ts).
- **No VIN checksum engine, no external VIN decoding service** — check
  RESULTS are storable (`vin_verifications`); performing checks is a later
  concern. Nothing is fabricated.
- **No jurisdiction-specific plate format engine** — normalization + country
  dimension only (see the [plate contract](./veh-plate-normalization-contract.md)).
- **No duplicate scoring engine** — candidate STORAGE with explainable,
  PII-free basis only (Phase 1-16 scores).
- **No forensic audit integration** — `iam.audit_append` is not granted to any
  app role (Phase 1-16); the attributable record at this layer is the
  append-only history set (see the
  [audit and history matrix](./veh-audit-and-history-matrix.md)).
- **No real or fake business data** — veh ships **zero** rows of any kind; the
  no-fake-data guard and the extended seed-state validator both sweep veh.

## 3. Document index

| Document                                                                                                         | Content                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [veh-object-inventory.md](./veh-object-inventory.md)                                                             | Generated live object counts (authoritative)                                                                                      |
| [veh-data-dictionary.md](./veh-data-dictionary.md)                                                               | Generated column/constraint/behavior annex (central [data dictionary](../../database/data-dictionary.md) holds business meanings) |
| [veh-vin-normalization-contract.md](./veh-vin-normalization-contract.md)                                         | VIN normalization, uniqueness, verification boundaries                                                                            |
| [veh-plate-normalization-contract.md](./veh-plate-normalization-contract.md)                                     | Plate normalization, Unicode/Arabic, jurisdiction dimension                                                                       |
| [veh-catalog-hierarchy-contract.md](./veh-catalog-hierarchy-contract.md)                                         | Make/model/trim/body/powertrain dual-scope rules                                                                                  |
| [veh-relationship-taxonomy.md](./veh-relationship-taxonomy.md)                                                   | The 7 Vehicle roles + ownership kinds vs CRM partner roles                                                                        |
| [veh-interval-semantics-matrix.md](./veh-interval-semantics-matrix.md)                                           | Temporal model for all 5 interval tables + battery                                                                                |
| [veh-rls-policy-matrix.md](./veh-rls-policy-matrix.md)                                                           | Generated live RLS policy matrix                                                                                                  |
| [veh-grant-matrix.md](./veh-grant-matrix.md)                                                                     | Generated live grant matrix (tables + functions)                                                                                  |
| [veh-classification-matrix.md](./veh-classification-matrix.md)                                                   | Classification summary over the validator-enforced registry                                                                       |
| [veh-audit-and-history-matrix.md](./veh-audit-and-history-matrix.md)                                             | What is recorded where; forensic-audit boundary                                                                                   |
| [veh-shared-services-contract.md](./veh-shared-services-contract.md)                                             | number_sequences / search_metadata / documents / IAM usage                                                                        |
| [../../database/veh-search-contract.md](../../database/veh-search-contract.md)                                   | Search field allow-list + PII exclusions (DB-019)                                                                                 |
| [../../database/veh-index-query-plan-review.md](../../database/veh-index-query-plan-review.md)                   | Index audit + 24 query plans (DB-020)                                                                                             |
| [../../database/veh-ownership-visibility-matrix.md](../../database/veh-ownership-visibility-matrix.md)           | SEC-001 crown-jewel visibility matrix                                                                                             |
| [../../database/veh-authorized-person-scope-contract.md](../../database/veh-authorized-person-scope-contract.md) | SEC-002 scope contract                                                                                                            |
| [../../database/veh-abuse-case-record.md](../../database/veh-abuse-case-record.md)                               | SEC-004 53-case abuse ledger                                                                                                      |
| [../../database/veh-personal-data-classification.json](../../database/veh-personal-data-classification.json)     | SEC-003 classification registry (validator-enforced)                                                                              |
| [../../database/phase-1-7-migration-classification.md](../../database/phase-1-7-migration-classification.md)     | Roll-forward/rollback classification of all 15 migrations                                                                         |
| [phase-1-7-test-catalog.md](./phase-1-7-test-catalog.md)                                                         | Every Vehicle test file with runner-verified counts                                                                               |
| [phase-1-7-traceability.md](./phase-1-7-traceability.md)                                                         | Requirements → migrations → objects → tests → docs                                                                                |
| [phase-1-7-evidence-register.md](./phase-1-7-evidence-register.md)                                               | Claim-by-claim evidence (SHA, command, exit code)                                                                                 |
| [phase-1-7-completion-report.md](./phase-1-7-completion-report.md)                                               | Status: Implementation Complete — Pending Feature PR Merge                                                                        |
| [phase-1-7-owner-gate.md](./phase-1-7-owner-gate.md)                                                             | **Decision: Pending**                                                                                                             |
| [phase-1-7-review-response.md](./phase-1-7-review-response.md)                                                   | Red-team findings and dispositions                                                                                                |
| [phase-1-7-change-log.md](./phase-1-7-change-log.md)                                                             | Commit-level change log                                                                                                           |
| [veh-target-data-model-phase-1-35.md](./veh-target-data-model-phase-1-35.md)                                     | Legacy Vehicle migration target model (P1-35)                                                                                     |
| [p1-08-structural-contract.md](./p1-08-structural-contract.md)                                                   | The stable surface Phase 1-8 builds on (contract-tested)                                                                          |

## 4. Controlled change requests (new business rules introduced by P1-07)

Three rules were established during design/red-team and are recorded here as
controlled additions to the business-rule register:

1. **CR-VEH-01 — Merged Vehicle is read-only.** After a merge, the source
   Vehicle row is frozen except audit/soft-delete metadata and permanently
   redirects to its survivor (`veh.guard_vehicle_merge`).
2. **CR-VEH-02 — A lower odometer value exists only as a linked, reasoned,
   anomaly-flagged correction** referencing an earlier reading of the same
   Vehicle (`veh.guard_odometer_reading` + CHECKs).
3. **CR-VEH-03 — An active Vehicle without a VIN must carry at least one
   controlled alternate identifier** (`veh.guard_vehicle_activation` /
   `veh.guard_vehicle_identity_removal`).

## 5. Release boundary

> With P1-07 green, the CRM + Vehicle Core Business Database foundation is
> available for P1-08 through P1-12.

No operational phase (reception, work orders, invoicing, APIs, frontend)
exists yet; this phase adds database foundation only.

## 6. Current status

**Technical gate recorded: Go — Technical Gate Passed** (2026-07-19). Feature PR
[#33](https://github.com/Ezzaldeen-Albitar/RootLco/pull/33) was merged into
`develop` (merge commit `47d0b9b`; final feature SHA `4c9697a` contained in
protected `develop`; all four required hosted checks green on that SHA). The
[owner gate](./phase-1-7-owner-gate.md) records **Decision: Go — Technical Gate
Passed** with the full merge-evidence block; the earlier **Pending** status
(correct when written, before the merge) is preserved there for audit. The
separate `docs/p1-07-record-technical-gate` PR carries this gate record and
**remains pending until the owner merges it**; formal protected-history closure
is declared only after that merge. Review model: owner-authorized technical,
QA, security, and adversarial self-review under the Standing Technical
Authorization + Solo Developer Review policies — **not** an independent
third-party review.
