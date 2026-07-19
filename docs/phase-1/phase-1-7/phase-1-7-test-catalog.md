# Phase 1-7 Test Catalog

Counts are taken from actual Vitest runner output (`vitest run --config
vitest.config.db.ts`, per-file `(N tests)` lines) at the recorded evidence SHA
— see the [evidence register](./phase-1-7-evidence-register.md) for the run
records. **15 Vehicle test files, 183 tests**, plus the phase's additions to
the repo-wide guards and the P1-08 contract suite.

## Vehicle suites (15 files, 183 tests)

| File                               | Tests | Proves                                                                                                                                                                                          |
| ---------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `veh-catalogs.test.ts`             | 11    | Dual-scope catalogs: platform/tenant uniqueness, scope CHECKs, hierarchy fail-closed guards, platform-row immutability from runtime                                                             |
| `veh-vehicles.test.ts`             | 19    | Independent master: generated `vin_normalized`, active-VIN uniqueness, catalog-ref/powertrain guards, lifecycle/workshop CHECKs, merge-guard basics, immutable identity                         |
| `veh-identifiers.test.ts`          | 12    | Typed identifier ledger: type↔classification coupling, restricted read/write gate, active/primary uniqueness, missing-VIN activation + identity-removal contract                                |
| `veh-history.test.ts`              | 7     | Append-only VIN verifications (override reason) + trigger-emitted attribute history (no-op safe, server-stamped, 42501 mutation)                                                                |
| `veh-mechanical.test.ts`           | 15    | Engine/transmission mutable-temporal (close-only, EXCLUDE, resolvers), EV↔powertrain coupling both directions, battery masters + append-only readings                                           |
| `veh-ownership.test.ts`            | 15    | Plate history (incl. cross-Vehicle active EXCLUDE), ownership compatibility matrix, relationships + authorization scope validation, evidence linkage, **crown-jewel prior-owner privacy proof** |
| `veh-odometer.test.ts`             | 16    | Forward-only series, canonical `value_km`, correction chain rules, deterministic latest/at, mutation denial, RLS, per-Vehicle lock race                                                         |
| `veh-status-alerts.test.ts`        | 16    | Trigger-emitted status ledger (one row per real change, no-op safe, coherence-anchored anti-forgery, atomic), alerts (types, severity, windows, ack coherence, soft delete)                     |
| `veh-duplicates-merges.test.ts`    | 25    | Positive-schema match basis (9 rejection shapes), one-open-per-pair, atomic merge primitive, cycle/double/deleted-survivor rejection, survivor chain, VIN release, same-source race             |
| `veh-security.test.ts`             | 7     | Auto-enumerating RLS/FORCE + policy shape + grant + function-security + ownership inventory over every live veh object                                                                          |
| `veh-search.test.ts`               | 5     | Runtime read-only search projection, normalization reuse, tenant isolation of projected rows, registry searchable-set pin                                                                       |
| `veh-isolation.test.ts`            | 5     | Auto-enumerating two-tenant isolation: completeness gate, no-context deny, cross-tenant write-denial per table, populated read isolation, FK containment                                        |
| `veh-concurrency.test.ts`          | 18    | QA-008: the 18 documented races on genuinely parallel connections (single-winner SQLSTATEs + serialize-both invariants)                                                                         |
| `veh-classification-guard.test.ts` | 6     | The canonical classification validator passes the real registry and fails 5 tampered fixtures                                                                                                   |
| `veh-review-hardening.test.ts`     | 6     | Red-team regressions: RT-1 VIN-removal re-validation on an active Vehicle; RT-2 EV-profile un-soft-delete re-validation (plus the still-allowed paths)                                          |

## Contract + guard additions

| File                              | Tests        | Role                                                                                                                            |
| --------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `veh-structural-contract.test.ts` | 6            | The P1-08 hand-off surface + explicit no-reception/appointment/work-order assertion                                             |
| `foundation.test.ts`              | (repo guard) | Exact allow-lists extended: +23 tables, +29 routines, +57 triggers, +62 policies                                                |
| `org-security.test.ts`            | (repo guard) | FK-index coverage, duplicate-index, tenant-column, data-dictionary sweeps auto-cover veh; +5 nullable-tenant catalog exceptions |
| `shared-hardening.test.ts`        | (repo guard) | The former "no Phase 1-7 tables" assertion flipped when veh became the deliverable                                              |
| `no-fake-data.test.ts`            | (repo guard) | veh added to the empty-business-tables schema sweep                                                                             |

## Concurrency evidence

`veh-concurrency.test.ts` runs 5 controlled times per the QA-008 protocol; the
run table (SHA, run number, duration, exit code) lives in the
[evidence register](./phase-1-7-evidence-register.md).
