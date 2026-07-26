# Phase 1-18 — Appointment and Reception Backend — Owner Gate (P1-G18)

Date decided: —
Decided by: —

## Decision: **Pending**

This gate is **not** a pass. It is the record that the phase is in execution and
that no owner decision has been made. Nothing in the repository may be read as a
P1-18 gate approval while this line says Pending.

## Protected starting state

Recorded so condition 20 has a baseline to be verified against, in the form both
prior phases use.

| Anchor           | Value                                                           |
| ---------------- | --------------------------------------------------------------- |
| `origin/develop` | `9d685e3855ff067529891a9ff4fb01b04fbb0d99` (P1-17 gate, PR #74) |
| `origin/main`    | `3e2c44d9e32e609186f4a6b9f9bfd246cdccda1a` (untouched)          |
| P1-17 gate       | **Go — P1-17 Vehicle Backend Gate Passed**                      |
| Migrations       | 119 (consumed unchanged; P1-18 adds none)                       |
| Feature branch   | `feature/p1-18-appointment-reception-backend`                   |

The anchors above are the state at phase start and are left as recorded. They
are no longer the state the gate will be verified against, because the phase's
feature branch merged and was then remediated three times. The current anchors:

| Anchor           | Value                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------- |
| `origin/develop` | `7caafbee0faf17183a19ca76f85ebc16d8e85c54` (after PR #79, third remediation merged)    |
| `origin/main`    | `3e2c44d9e32e609186f4a6b9f9bfd246cdccda1a` (still untouched by this phase)             |
| Merged           | PR #75 (feature), #76, #77, and **#79 (third remediation)** — push CI #202 Success 4/4 |
| Current branch   | evidence remediation on top of the merged third remediation                            |
| Migrations       | 119 (still consumed unchanged; P1-18 adds none)                                        |

The third remediation exists because the final review of PR #77 proved that ten
id-addressed branch-scoped operations were still authorized scope-blind. See
README §0 and §4.1. Conditions 7, 8, 9, 10, 12, 15, 16, 17 and 18 must be
re-verified against the third remediation's candidate SHA, not against any
evidence produced before it.

## 1. What this gate governs

The backend for appointment booking and vehicle reception on the frozen Phase 1-8
`apt`/`rec` schema and the Phase 1-9 `wo` schema: appointment creation,
rescheduling, cancellation and no-show; walk-in handling; appointment conversion;
reception creation, validation, party-role selection and authorization
verification; complaint capture; visual inspection; damage records; contents;
media; signatures; refusals; reception approval; and reception-to-work-order
conversion.

It governs no database change. P1-18 adds no migration.

## 2. Conditions

Each condition is **Pending** until the evidence exists and has been verified on
the exact candidate SHA.

| #   | Condition                                                                                                                                                                                                                                   | Status      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | Feature branch based on protected `develop` with a byte-identical starting tree                                                                                                                                                             | **Pending** |
| 2   | Database capability audit completed through the real runtime role, verdict recorded                                                                                                                                                         | **Pending** |
| 3   | No migration added or modified; 119 migrations, no migration 120                                                                                                                                                                            | **Pending** |
| 4   | All 19 backend tasks (P1-18-BE-001…019) implemented and mapped to operations — evidence: `evidence/task-traceability.md`                                                                                                                    | **Pending** |
| 5   | Every operation registered with permissions, scope, audit class and action                                                                                                                                                                  | **Pending** |
| 6   | Permission catalog, event catalog, audit-action catalog and error catalog synchronized                                                                                                                                                      | **Pending** |
| 7   | Operation coverage: P1-18 registered == operation-depth, 0 pending / unit-only / metadata-only                                                                                                                                              | **Pending** |
| 8   | Every declared evidence kind backed by an assertion that fails when the protection is weakened                                                                                                                                              | **Pending** |
| 9   | Mutation testing on authorization, tenant isolation, company/branch scope, idempotency, concurrency, append-only evidence, approval prerequisite and conversion exactly-once — evidence: `evidence/scoped-authorization-mutation-proofs.md` | **Pending** |
| 10  | Security review (P1-18-SEC-001…004) with zero Critical and zero High outstanding — evidence: `evidence/security-review.md`                                                                                                                  | **Pending** |
| 11  | QA completion (P1-18-QA-001…005) with real tenant-B principals and runtime roles — evidence: `evidence/qa-evidence.md`                                                                                                                      | **Pending** |
| 12  | Test floors held or exceeded: Unit ≥ 746, DB ≥ 1547, Backend ≥ 693 (raised from 733/1547/567 by the merges of PR #75, #76 and #77)                                                                                                          | **Pending** |
| 13  | Observability and DevOps (P1-18-DO-001…002) with no sensitive value logged — evidence: `evidence/devops-observability.md`                                                                                                                   | **Pending** |
| 14  | Documentation (P1-18-DOC-001…002) synchronized, including recorded canonical drift — evidence: `evidence/documentation-evidence.md`                                                                                                         | **Pending** |
| 15  | Full local gate battery green in CI-equivalent order                                                                                                                                                                                        | **Pending** |
| 16  | Generated artifacts stable across regeneration (no drift)                                                                                                                                                                                   | **Pending** |
| 17  | Exact-SHA PostgreSQL 17 clean room from an empty database — evidence: `evidence/local-release-candidate-validation.md` §5 and §8                                                                                                            | **Pending** |
| 18  | Independent correctness, security, QA and architecture reviews resolved                                                                                                                                                                     | **Pending** |
| 19  | Feature pull request open to `develop`, conflict-free, all hosted checks green                                                                                                                                                              | **Pending** |
| 20  | `origin/main` untouched by this phase                                                                                                                                                                                                       | **Pending** |
| 21  | The ten id-addressed branch-scoped operations re-authorize against the LOCKED row inside the request transaction, and an empty deferred target fails closed                                                                                 | **Pending** |
| 22  | Each of the ten runs under its OWN operation declaration, pinned by an assertion rather than by the authorization coverage gate, which does not check this                                                                                  | **Pending** |

## 3. Exclusions

No production deployment. No Benzene legacy-data migration. No Zoom services. No
unapproved country, tax, currency, payment or retention defaults. No
product-name finalization — the name remains
`[PRODUCT NAME — Pending Final Approval]`. No frontend. No P1-19.

## 4. Decision record

No decision has been recorded. The approval owner is the RootLco Product Owner,
with the technical, security, QA, data and release sign-offs P1-G18 requires.
Benzene input is advisory unless a named pilot decision is explicitly assigned to
it.

Until this document records a decision other than Pending, P1-18 remains
**Planned / in execution** and authorizes no dependent work.
