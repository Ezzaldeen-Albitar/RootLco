# P1-24 — task traceability

Twenty-seven tasks. Each row names the requirement it serves, the artifact that
satisfies it, and — where the task is a VERIFICATION rather than a delivery — says so
plainly instead of implying new work.

That distinction is the honest one for this phase. P1-24 is the integration and
release gate, not a feature phase: most of its tasks are satisfied by _proving_ that
coverage delivered in P1-13…P1-23 holds against this exact tree, and the useful
deliverable is the mechanism that makes the proof repeatable. Where a task turned up a
genuine gap, the gap is a finding with a fix and a regression test; where it did not,
the row says "verified, no gap" rather than inventing a deliverable.

## The mechanism most rows rest on

The derived-evidence floor. What an operation owes is computed from its own
`defineOperation({...})` registration:

| Registration property            | Obligation it creates                          |
| -------------------------------- | ---------------------------------------------- |
| every non-public operation       | `route`, `service`, `success`, `authorization` |
| `public: true`                   | `unauthenticated` instead of `authorization`   |
| a `{param}` in the path          | `cross-tenant`                                 |
| `idempotent: true`               | `idempotency`                                  |
| `versionGuarded: true`           | `stale-version`                                |
| `auditClass` other than `none`   | `audit`                                        |
| `scope` of `company` or `branch` | `isolation`                                    |

P1-24 extended that floor to `iam.` and `meta.`, the last two namespaces outside it
(**P1-24-F-001**). It now covers **226 of 226** operations, so several tasks below are
discharged for the WHOLE surface at once rather than per operation — and are reported
that way instead of as 226 individual claims.

## Backend

| Task                                 | Requirement              | Artifact                                                                                          | Result                                                                                                                          |
| ------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| P1-24-BE-001 API contract validation | FR-INT-001 · TC-API-001  | `scripts/p1-24-operation-register.mjs`, `npm run validate:openapi`                                | 226 operations reconciled against OpenAPI, the permission seed, the audit catalog and the coverage manifest. 0 failures.        |
| P1-24-BE-002 Domain integration      | FR-INT-001 · TC-INT-001  | `tests/backend/p1-24-cross-domain-journey.test.ts`                                                | New. One work order from reception to warranty; the seams asserted, not the operations.                                         |
| P1-24-BE-003 Transaction tests       | NFR-DAT-001              | derived floor + `tests/backend/transaction.test.ts`, `p1-17-transaction-conformance.test.ts`      | Verified, no gap. Rollback and atomicity evidence exists per domain; the floor makes `audit`/`outbox` obligations un-droppable. |
| P1-24-BE-004 RLS tests               | NFR-SEC-001 · TC-RLS-001 | `tests/db/**` (138 files), `scripts/ci/rls-matrix.mjs`                                            | Verified, no gap.                                                                                                               |
| P1-24-BE-005 Authorization tests     | FR-IAM-002               | `tests/backend/p1-24-iam-route-depth.test.ts`                                                     | **Gap found and closed.** 39 operations had no route-layer authorization evidence.                                              |
| P1-24-BE-006 Error-path tests        | FR-INT-001               | same suite + `src/server/errors/catalog.ts`                                                       | **Gap found and closed** (P1-24-F-002): every public operation bypassed the error pipeline.                                     |
| P1-24-BE-007 Concurrency tests       | NFR-DAT-001 · TC-CON-001 | `tests/backend/p1-19-concurrency.test.ts`, `p1-22-concurrency.test.ts`                            | Verified, no gap.                                                                                                               |
| P1-24-BE-008 Idempotency tests       | FR-INT-002               | derived floor (`idempotent: true` ⇒ `idempotency`) + `p1-14-idempotency-replay.test.ts` + journey | Verified; the journey adds a duplicate-command case on a real aggregate.                                                        |
| P1-24-BE-009 Performance tests       | NFR-PERF-01              | `tests/backend/p1-24-read-path-shape.test.ts`, `evidence/performance-baseline.md`                 | New. Shape asserted (no N+1, bounded pages, throttle fires); time RECORDED, not asserted — no approved threshold exists.        |
| P1-24-BE-010 Audit verification      | FR-AUD-001               | derived floor (`auditClass` ⇒ `audit`) + the two privileged-read cases in the IAM suite           | Verified; the audit trail's own reads are now proven audited at route depth.                                                    |
| P1-24-BE-011 Event delivery          | FR-INT-001               | event coverage matrix in `evidence/operation-register.md`                                         | 50 catalogued, 47 produced, 3 reserved, 0 foreign outbox writers.                                                               |
| P1-24-BE-012 File security           | NFR-SEC-001              | `tests/backend/p1-15-operation-routes.test.ts`, `p1-23-document-retention.test.ts`                | Verified, no gap. Limitations preserved: no scanner exists and none is claimed.                                                 |
| P1-24-BE-013 OpenAPI completion      | FR-INT-001               | `tests/openapi-contract.test.ts`, `scripts/check-openapi.mjs`                                     | **Gap found and closed** (P1-24-F-003): the document understated its own scope by nine phases.                                  |
| P1-24-BE-014 Backend documentation   | NFR-MNT-001              | this file, `findings.md`, `execution-checkpoint.md`, `performance-baseline.md`                    | Complete.                                                                                                                       |

## Security

| Task                                              | Requirement | Artifact                                                                        | Result                                                                               |
| ------------------------------------------------- | ----------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| P1-24-SEC-001 Permission and resolved scope       | NFR-SEC-001 | IAM route-depth suite; register reconciles every declared code against the seed | 12 distinct codes across 39 operations, each proven to refuse a caller without it.   |
| P1-24-SEC-002 Sensitive data, export, file access | NFR-SEC-001 | `p1-15-*`, `p1-23-document-retention`, export authorization suites              | Verified, no gap.                                                                    |
| P1-24-SEC-003 Abuse cases and escalation          | NFR-SEC-001 | IAM route-depth suite + `scripts/p1-24-mutation-matrix.mjs`                     | Forged scope, cross-scope ids, partial-conjunction disclosure. 6/6 mutations caught. |
| P1-24-SEC-004 Security audit coverage             | FR-AUD-001  | `iam.audit.viewed` asserted as a delta on both privileged reads                 | Verified.                                                                            |

## QA

| Task                                           | Requirement                    | Artifact                                                                           | Result                                                           |
| ---------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| P1-24-QA-001 Unit and component coverage       | NFR-MNT-001                    | `npm run test`                                                                     | 1285 tests, 58 files.                                            |
| P1-24-QA-002 API/contract and error paths      | FR-INT-001 · TC-API-001        | register + IAM route-depth suite                                                   | 226/226 operations classified Covered against the uniform floor. |
| P1-24-QA-003 Tenant/company/branch isolation   | NFR-SEC-001 · TC-RLS-001       | IAM route-depth suite (real tenant-B rows) + journey (four domains, one aggregate) | **Gap found and closed** for `iam.`/`meta.`                      |
| P1-24-QA-004 Concurrency and idempotency       | FR-INT-002 · TC-CON-001        | derived floor + existing concurrency suites + journey                              | Verified.                                                        |
| P1-24-QA-005 Regression and evidence packaging | NFR-MNT-001 · TC-P1-24-001/002 | mutation matrix, register, this directory                                          | Complete.                                                        |

## DevOps

| Task                                            | Requirement | Artifact                                                                                        | Result                                                                                                           |
| ----------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| P1-24-DO-001 CI quality gate                    | NFR-MNT-001 | `validate:p1-24-register` in static quality; `validate:p1-24-mutations` in the integration tier | Both wired; `ci-gate` inherits them through `needs`.                                                             |
| P1-24-DO-002 Logging, monitoring, alert routing | NFR-OBS-001 | `src/server/observability/**`, correlation propagation asserted per public route                | Verified for what exists. **No deployment exists, so no claim is made about production monitoring or alerting.** |

## Documentation

| Task                                          | Requirement | Artifact                                                            | Result    |
| --------------------------------------------- | ----------- | ------------------------------------------------------------------- | --------- |
| P1-24-DOC-001 Contract, catalog, traceability | NFR-MNT-001 | `evidence/operation-register.md` (generated), this file             | Complete. |
| P1-24-DOC-002 Operator/developer guidance     | NFR-MNT-001 | `findings.md`, `performance-baseline.md`, `execution-checkpoint.md` | Complete. |

## Test-case references

| Reference      | Where it is discharged                                                 |
| -------------- | ---------------------------------------------------------------------- |
| `TC-API-001`   | `scripts/p1-24-operation-register.mjs`, `npm run validate:openapi`     |
| `TC-RLS-001`   | `tests/db/**` plus the cross-tenant block of the IAM route-depth suite |
| `TC-CON-001`   | `p1-19-concurrency.test.ts`, `p1-22-concurrency.test.ts`               |
| `TC-INT-001`   | `p1-24-cross-domain-journey.test.ts` — the full journey                |
| `TC-P1-24-001` | same file — an invalid lifecycle order leaves no row and no event      |
| `TC-P1-24-002` | same file — a duplicate command commits once                           |

## What this phase does NOT claim

- **No production monitoring or alerting.** Nothing is deployed; `NFR-OBS-001` is
  discharged for the code that exists, not for an operating system.
- **No performance threshold.** `NFR-PERF-01` has no approved figure and
  `P1-OD-027` / `NFR-SCL` is unresolved. Numbers are recorded, never passed.
- **No malware scanning.** No scanner exists in the tree; the document lifecycle
  states this and P1-24 does not soften it.
- **No claim about which of two layers guards company scope.** Both do, and no test
  written against the API can attribute a refusal to one — recorded in the mutation
  matrix rather than resolved by assertion.
