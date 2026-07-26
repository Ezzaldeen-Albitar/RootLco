# Phase 1-18 Gate — Appointment and Reception Backend

**Phase:** 1-18 — Appointment and Reception Backend · **Gate package:** post-merge gate record ·
**Review model:** the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)
under the [Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md).
**This is not an independent third-party review and is never represented as one.**
**Date opened:** 2026-07-25 · **Date decided:** 2026-07-26 (Asia/Amman).

---

## Decision: **Go — P1-18 Appointment and Reception Backend Gate Passed**

Decided against the protected merge commit `a13ff8b`, not against any local
candidate. Every number below was produced by a command run on that commit and is
recorded in `evidence/post-merge-gate-reproof.md`.

## 1. What this gate governs

The backend for appointment booking and vehicle reception on the frozen Phase 1-8
`apt`/`rec` schema and the Phase 1-9 `wo` schema: appointment creation,
rescheduling, cancellation and no-show; walk-in handling; appointment conversion;
reception creation, validation, party-role selection and authorization
verification; complaint capture; visual inspection; damage records; contents;
media; signatures; refusals; reception approval; and reception-to-work-order
conversion.

It governs no database change. P1-18 adds no migration.

## 2. Verified state at decision

| Anchor                   | Value                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `origin/develop`         | `a13ff8b8b1f4002ff60a9112ce8f21d7920f444d` (PR #80 merge)                                                        |
| Merge parents            | `7caafbe` + `d1ea977`                                                                                            |
| Merge tree               | `167fb6fa459fa7b8d1d74276dcdc0f654623ff1d` — identical to `d1ea977^{tree}`, zero drift                           |
| `origin/main`            | `3e2c44d9e32e609186f4a6b9f9bfd246cdccda1a` — untouched; P1-18 is **not** on `main`                               |
| Authoritative CI         | Push run **#205** (`30192246332`) — event `push`, branch `develop`, SHA `a13ff8b`, **Success 4/4**               |
| Merged                   | PR #75 (feature), #76, #77, #79, #80                                                                             |
| Migrations               | 119 — none added, none modified, no `120`                                                                        |
| Only `supabase/` change  | `seeds/04_iam_permission_catalog.sql` (+37 / −1) — the nine `apt.`/`rec.` permission codes                       |
| Clean-room `schema_hash` | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c` — byte-identical to the frozen P1-17 baseline |
| Test totals              | Unit **829** · DB **1547** · Backend **771**                                                                     |

## 3. Conditions

All 22 conditions verified on `a13ff8b`. Evidence paths are relative to
`docs/phase-1/phase-1-18/`.

| #   | Condition                                                                                                                                                   | Status  | Verified by                                                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Feature branch based on protected `develop` with a byte-identical starting tree                                                                             | **Met** | PR #75 merge-base equal to `9d685e3`; every subsequent merge tree equal to its branch-head tree                                                                                  |
| 2   | Database capability audit completed through the real runtime role, verdict recorded                                                                         | **Met** | `README` §2; clean room confirms `app_runtime` INSERT 29 / SELECT 29 / UPDATE 23 / **DELETE 0** on apt/rec                                                                       |
| 3   | No migration added or modified; 119 migrations, no migration 120                                                                                            | **Met** | `post-merge-gate-reproof.md` §3 and §7 — 119 at both `9d685e3` and `a13ff8b`, no `120` in the clean room                                                                         |
| 4   | All 19 backend tasks (P1-18-BE-001…019) implemented and mapped to operations                                                                                | **Met** | `evidence/task-traceability.md` — `BE-001`…`BE-019` all present and mapped                                                                                                       |
| 5   | Every operation registered with permissions, scope, audit class and action                                                                                  | **Met** | 12 operations, all `scope: 'branch'`, audit classes **10 `privileged` + 2 `approval`**                                                                                           |
| 6   | Permission catalog, event catalog, audit-action catalog and error catalog synchronized                                                                      | **Met** | Clean room: `iam.permissions` = **71**, of which **9** are `apt.`/`rec.`                                                                                                         |
| 7   | Operation coverage: P1-18 registered == operation-depth, 0 pending / unit-only / metadata-only                                                              | **Met** | `validate:operation-coverage` — 12 registered, 12 operation-depth, all other categories 0                                                                                        |
| 8   | Every declared evidence kind backed by an assertion that fails when the protection is weakened                                                              | **Met** | `evidence/qa-evidence.md`; the one exception is stated, not hidden — see `P1-18-R-06` in §5                                                                                      |
| 9   | Mutation testing on the authorization and company/branch scope areas                                                                                        | **Met** | `evidence/scoped-authorization-mutation-proofs.md` M1–M6, re-run at the final candidate                                                                                          |
| 10  | Security review (P1-18-SEC-001…004), zero Critical and zero High outstanding                                                                                | **Met** | `evidence/security-review.md`; post-merge review found no cross-branch or cross-tenant write                                                                                     |
| 11  | QA completion (P1-18-QA-001…005) with real tenant-B principals and runtime roles                                                                            | **Met** | `evidence/qa-evidence.md`; containment suite uses a branch-only `PRINCIPAL_UNION`                                                                                                |
| 12  | Test floors held: Unit ≥ 746, DB ≥ 1547, Backend ≥ 693                                                                                                      | **Met** | **829 / 1547 / 771** — all floors exceeded                                                                                                                                       |
| 13  | Observability and DevOps (P1-18-DO-001…002) with no sensitive value logged                                                                                  | **Met** | `evidence/devops-observability.md`, corrected in this record — see §4                                                                                                            |
| 14  | Documentation (P1-18-DOC-001…002) synchronized, including recorded canonical drift                                                                          | **Met** | `evidence/documentation-evidence.md`; `validate:canonical-docs` verified 2 documents unmodified                                                                                  |
| 15  | Full local gate battery green in CI-equivalent order                                                                                                        | **Met** | `post-merge-gate-reproof.md` §4 — 19 gates run serially on `a13ff8b`                                                                                                             |
| 16  | Generated artifacts stable across regeneration (no drift)                                                                                                   | **Met** | `post-merge-gate-reproof.md` §5 — each generator run twice and compared                                                                                                          |
| 17  | Exact-SHA PostgreSQL 17 clean room from an empty database                                                                                                   | **Met** | `post-merge-gate-reproof.md` §7 — PG 17.6, 119 migrations + 7 seeds, `schema_hash a677eb05…`                                                                                     |
| 18  | Independent correctness, security, QA and architecture reviews resolved                                                                                     | **Met** | Four read-only reviews at `a13ff8b`; the single High is resolved in this record — §4                                                                                             |
| 19  | Feature pull request open to `develop`, conflict-free, all hosted checks green                                                                              | **Met** | PRs #75/#76/#77/#79/#80 all merged; authoritative push CI **#205 Success 4/4** on `a13ff8b`                                                                                      |
| 20  | `origin/main` untouched by this phase                                                                                                                       | **Met** | `origin/main` = `3e2c44d`; `git merge-base --is-ancestor a13ff8b origin/main` is false                                                                                           |
| 21  | The ten id-addressed branch-scoped operations re-authorize against the LOCKED row inside the request transaction, and an empty deferred target fails closed | **Met** | `p1-18-scope-containment.test.ts` (76 tests) and `p1-18-scoped-authorization.test.ts` F2; independently re-traced in the post-merge security review across all four choke points |
| 22  | Each of the ten runs under its OWN operation declaration, pinned by an assertion rather than by the authorization coverage gate, which does not check this  | **Met** | `p1-18-scoped-authorization.test.ts` F10 — discovery is dynamic by path parameter, and an eleventh id-addressed operation fails it                                               |

## 4. The High raised after merge, and its resolution

The post-merge review round raised **one High, and it was in this phase's own
evidence rather than in its code.**

`evidence/devops-observability.md` and `evidence/security-review.md` both stated
that persisting authorization denials to `iam.security_events` "requires a write
privilege `app_runtime` does not hold (DBCR-P1-13-001)". **That is false, and was
false when written.** `af240f0` (P1-13, 2026-07-21) added both
`GRANT INSERT ON iam.security_events TO app_runtime` and the policy
`ins_security_events_runtime`; `recordSecurityEvent` probes that capability before
writing; and P1-13's own gate row `ADV-07` records the capability as **proven**.

Both files are corrected in this gate record. The true cause is narrower and is
not a privilege at all: `noteDenial` — the only bridge from a denial to
`recordSecurityEvent` — has **no call site anywhere in the repository**. It is
carried forward as `P1-18-R-03`.

Recording why this matters rather than burying it: this is the **fourth** review
round in this phase to find a factual error in evidence written by the executing
engineer, after three earlier rounds found missing condition evidence, stale
mutation provenance, a self-contradicting clean-room chronology, and eleven
further errors introduced while fixing those. The pattern is consistent — the
code has held up under adversarial review far better than the prose describing it.
Every citation added in this gate record was re-verified against the source before
being written, and the specific claims that failed verification are named above
rather than silently amended.

## 5. Findings disposition

**0 Critical · 0 High · 3 Medium open · 9 Low open.** No Critical or High remains.

| ID                  | Sev    | Finding                                                                                                                                                                            | Origin                              |
| ------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `P1-18-R-03`        | Medium | Authorization denials are never persisted — `noteDenial` has no call site, so a refused cross-branch probe leaves only a stdout line and an in-memory counter that exports nowhere | Pre-existing since P1-13 (`ADV-07`) |
| `P1-18-R-06`        | Medium | `apt.appointment-create` has no branch-only behavioural scope proof: its only scoped principal holds a `company` grant row, so the 403 comes from RLS, not the permission check    | P1-18                               |
| `P1-18-R-08`        | Medium | Six gate scripts (`validate:canonical-docs`, `:schema-inventory`, `:structural-review`, `:upgrade-matrix`, `:baseline-manifest`, `gate:p1-12`) are declared but never run by CI    | Pre-existing, platform-wide         |
| `P1-18-R-04`        | Low    | A refusal logs the operation but never the scope it was refused against                                                                                                            | P1-18                               |
| `P1-18-R-05`        | Low    | Denials are counted twice into one metric series                                                                                                                                   | Pre-existing                        |
| `P1-18-R-07`        | Low    | A fixture docstring and three test titles claim branch containment they do not prove                                                                                               | P1-18                               |
| `P1-18-R-09`        | Low    | `resolveOrigin`'s residual 422-vs-404 appointment-existence signal                                                                                                                 | P1-18                               |
| `P1-18-R-10`        | Low    | The nine permission codes ship in a seed, which runs only on a full database reset — a forward deploy onto a populated database leaves every P1-18 operation dead with CI green    | Platform pattern                    |
| `P1-18-R-11`        | Low    | The migration-immutability CI step is guarded by `if: github.event_name == 'pull_request'` while the workflow also triggers on `push`                                              | Pre-existing                        |
| `P1-05-SEEDRESIDUE` | Low    | `validate:seed-state` fails on a developer database after the DB suite — a value mutation left by `tests/db/shared-retention.test.ts`, absent in the clean room                    | Pre-existing since P1-05            |

Carried forward unchanged: `P1-18-REPLAY-001`, `P1-18-ORACLE-001`,
`P1-18-DEPT-001`, `P1-18-SEC-ROLEPROBE`, `P1-18-GATE-IDENTITY`, and
`PLAT-BRANCHTARGET-001` (owned by P1-14/P1-15).

Every open finding above is either pre-existing platform debt or an evidence and
test-labelling gap. None of them permits a cross-branch or cross-tenant write, and
the post-merge security review specifically failed to construct one.

## 6. What this phase actually fixed

The defect that justified three remediations: ten id-addressed operations declared
`scope: 'branch'` but passed no `authorizationTarget`. `requiresScopedEvaluation`
returns false on an empty target **regardless of the declared scope**, so the
check fell through to scope-blind `iam.has_permission`, which never consults
`iam.grant_scopes`. RLS could not contain it, because `app.branch_ids` is the
**permission-blind union** of every ACTIVE grant. A caller scoped to branch A
could write in branch B.

The remediation defers the scoped check to after the row is locked
`FOR UPDATE`, evaluating `iam.has_permission_in_scope` against the **locked row's
own** company and branch, on the transaction-bound handle, at four choke points:
`requireAppointment`, `requireVisit`, `requireRecordableVisit`, and
`convertToWorkOrder`. It fails closed in both directions — an empty target is
refused before any statement is issued, and a supplied target forces scoped
evaluation even where the declaration says `tenant`, because `defineOperation`
defaults a missing scope to `'tenant'`.

## 7. Decision record

- **Decision:** **Go — P1-18 Appointment and Reception Backend Gate Passed**
- **Basis:** protected merge `a13ff8b` verified (parents, tree equality, zero
  drift); authoritative push CI **#205 Success 4/4** on that exact SHA;
  19-gate serial battery green with Unit 829 / DB 1547 / Backend 771; 12/12
  operation-depth with zero pending; generated artifacts stable; exact-SHA
  PostgreSQL 17.6 clean room reproducing `schema_hash a677eb05…` byte-identical
  to the frozen P1-17 baseline with 0 `SECURITY DEFINER`, 0 unforced RLS, every
  apt/rec table RLS-forced with no DELETE policy, `app_readonly` SELECT-only and
  every business table empty; four independent read-only reviews resolved to
  **0 Critical / 0 High**, with 3 Mediums and 9 Lows recorded open in §5.
- **Approval owner:** RootLco Product Owner, with the technical, security, QA,
  data and release sign-offs P1-G18 requires. Benzene input is advisory unless a
  named pilot decision is explicitly assigned to it.
- **Date:** 2026-07-26 (Asia/Amman)

Dependent work (Phase 1-19) may begin only after this gate-record pull request is
merged into protected `develop` and that protected merge is separately verified.
Until then P1-18 is **not** formally closed.

## 8. Exclusions

No production deployment. No Benzene legacy-data migration. No Zoom services. No
unapproved country, tax, currency, payment or retention defaults. No
product-name finalization — the name remains
`[PRODUCT NAME — Pending Final Approval]`. No frontend. No P1-19.

## 9. Preserved Pending record (byte-verbatim)

The complete text of this gate as it shipped in **Pending**, preserved unaltered.
The decision above was made against this record; it is not rewritten here.

```markdown
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

| #   | Condition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Status      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | Feature branch based on protected `develop` with a byte-identical starting tree                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **Pending** |
| 2   | Database capability audit completed through the real runtime role, verdict recorded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | **Pending** |
| 3   | No migration added or modified; 119 migrations, no migration 120                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **Pending** |
| 4   | All 19 backend tasks (P1-18-BE-001…019) implemented and mapped to operations — evidence: `evidence/task-traceability.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **Pending** |
| 5   | Every operation registered with permissions, scope, audit class and action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **Pending** |
| 6   | Permission catalog, event catalog, audit-action catalog and error catalog synchronized                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **Pending** |
| 7   | Operation coverage: P1-18 registered == operation-depth, 0 pending / unit-only / metadata-only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **Pending** |
| 8   | Every declared evidence kind backed by an assertion that fails when the protection is weakened                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **Pending** |
| 9   | Mutation testing on authorization, tenant isolation, company/branch scope, idempotency, concurrency, append-only evidence, approval prerequisite and conversion exactly-once — mutation evidence for the **authorization and company/branch scope** areas is `evidence/scoped-authorization-mutation-proofs.md` (M1–M6); the remaining areas — tenant isolation, idempotency, concurrency, append-only evidence, approval prerequisite and conversion exactly-once — are covered behaviourally by the suites recorded in `evidence/qa-evidence.md` and are **not** mutation-proved | **Pending** |
| 10  | Security review (P1-18-SEC-001…004) with zero Critical and zero High outstanding — evidence: `evidence/security-review.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **Pending** |
| 11  | QA completion (P1-18-QA-001…005) with real tenant-B principals and runtime roles — evidence: `evidence/qa-evidence.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                             | **Pending** |
| 12  | Test floors held or exceeded: Unit ≥ 746, DB ≥ 1547, Backend ≥ 693 (raised from 733/1547/567 by the merges of PR #75, #76 and #77)                                                                                                                                                                                                                                                                                                                                                                                                                                                 | **Pending** |
| 13  | Observability and DevOps (P1-18-DO-001…002) with no sensitive value logged — evidence: `evidence/devops-observability.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **Pending** |
| 14  | Documentation (P1-18-DOC-001…002) synchronized, including recorded canonical drift — evidence: `evidence/documentation-evidence.md`                                                                                                                                                                                                                                                                                                                                                                                                                                                | **Pending** |
| 15  | Full local gate battery green in CI-equivalent order                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | **Pending** |
| 16  | Generated artifacts stable across regeneration (no drift)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | **Pending** |
| 17  | Exact-SHA PostgreSQL 17 clean room from an empty database — evidence: `evidence/local-release-candidate-validation.md` §5 and §8                                                                                                                                                                                                                                                                                                                                                                                                                                                   | **Pending** |
| 18  | Independent correctness, security, QA and architecture reviews resolved                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | **Pending** |
| 19  | Feature pull request open to `develop`, conflict-free, all hosted checks green                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **Pending** |
| 20  | `origin/main` untouched by this phase                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **Pending** |
| 21  | The ten id-addressed branch-scoped operations re-authorize against the LOCKED row inside the request transaction, and an empty deferred target fails closed                                                                                                                                                                                                                                                                                                                                                                                                                        | **Pending** |
| 22  | Each of the ten runs under its OWN operation declaration, pinned by an assertion rather than by the authorization coverage gate, which does not check this                                                                                                                                                                                                                                                                                                                                                                                                                         | **Pending** |

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
```
