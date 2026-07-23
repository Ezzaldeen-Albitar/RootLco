# Phase 1-15 — Deliverable Manifest

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Release group:** Release 3 — Backend Foundation ·
**Phase:** P1-15 — Shared Services Backend ·
**Date:** 2026-07-23 ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent third-party audit.**

---

## 1. How this manifest was produced

Every row comes from one command, run against the branch as committed:

```
git diff --name-status origin/develop...HEAD
```

| Anchor                     | Value                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Protected `origin/develop` | `e50d501`                                                                                                  |
| Feature branch             | `feature/p1-15-shared-services-backend`                                                                    |
| Branch head                | recorded in the pull-request description — a file cannot contain the hash of the commit that introduces it |
| Protected `origin/main`    | `8ca1da2` — untouched by this phase                                                                        |

Nothing is listed from memory or from a plan: a path that is not in that command's output is not in
this manifest. The command above is the authority; the tables below are its categorised form, and the
category totals are what a reviewer should reconcile against.

**Totals:** **112** paths — **96 added (`A`)**, **16 modified (`M`)**, **0 deleted, 0 renamed**.

| Kind                           | Total | Added | Modified |
| ------------------------------ | ----- | ----- | -------- |
| Module source                  | 28    | 28    | 0        |
| Route handlers                 | 20    | 20    | 0        |
| Foundation changes             | 5     | 0     | 5        |
| CI / tooling scripts           | 3     | 1     | 2        |
| Tests                          | 22    | 19    | 3        |
| Documentation and API contract | 31    | 29    | 2        |
| Repository configuration       | 3     | 0     | 3        |

Repository configuration is `package.json` (one script added), `.prettierignore` (the second
generated coverage matrix), and `.github/workflows/ci.yml` (the encoding-hygiene step).

## 2. Migration posture — **P1-15 adds no migration**

Verified, not assumed:

```
git diff --name-only origin/develop...HEAD -- supabase/migrations
```

returns **no output at all** — zero paths under `supabase/migrations` differ between protected
`develop` and the branch head. The migration count on the branch is **117**
(`supabase/migrations/*.sql`), which is exactly the count protected `develop` already carries.

Migration 117 is the remediation for
[DBCR-P1-15-001](../../database/change-requests/DBCR-P1-15-001-shared-services-runtime-write-capabilities.md).
It was merged into protected `develop` through pull request #60 **before** the feature branch was
resumed, so it arrives here through protected history rather than as a duplicate — the parked branch was
rebased onto `e50d501` for precisely that reason
([remediation verification](phase-1-15-remediation-verification.md) §4). The **117-migration contract
is consumed unchanged**: no migration was added, edited, reordered, or reverted, and migrations 1–116
are untouched.

## 3. Module source — `src/modules/shared-services/` (28 added)

### 3.1 Public surface (1)

| Status | Path                                                                                    |
| ------ | --------------------------------------------------------------------------------------- |
| A      | [`src/modules/shared-services/index.ts`](../../../src/modules/shared-services/index.ts) |

The only legal import path for the module. It exports services, result types, pure domain functions,
and the provider ports plus their local adapters — and deliberately **no repository and no pool**,
because handing out a repository would let a caller run SQL under this module's identity and skip the
audit, event, and scope rules only the services apply.

### 3.2 Domain layer (9 added)

Rules only, no I/O — boundary rule **B12**, added by this phase, fails the build if a `domain/` file
reaches a provider.

| Status | Path                                                                                                  | Holds                                                                |
| ------ | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| A      | [`domain/normalization.ts`](../../../src/modules/shared-services/domain/normalization.ts)             | VIN / phone / email mirrors of frozen SQL; search normalization      |
| A      | [`domain/transitions.ts`](../../../src/modules/shared-services/domain/transitions.ts)                 | The registered transition graph; aggregates and their history tables |
| A      | [`domain/sequence-registry.ts`](../../../src/modules/shared-services/domain/sequence-registry.ts)     | Sequence definitions and the code pattern                            |
| A      | [`domain/query-primitives.ts`](../../../src/modules/shared-services/domain/query-primitives.ts)       | Allow-listed filtering and sorting; the bound ordering contract      |
| A      | [`domain/storage-key.ts`](../../../src/modules/shared-services/domain/storage-key.ts)                 | Server-built storage keys; safe download filenames                   |
| A      | [`domain/attachment-policy.ts`](../../../src/modules/shared-services/domain/attachment-policy.ts)     | Entity-type and purpose allow-lists; the unsigned upload token       |
| A      | [`domain/template-rendering.ts`](../../../src/modules/shared-services/domain/template-rendering.ts)   | Rendering, variable extraction, canonical rendered form              |
| A      | [`domain/notification-policy.ts`](../../../src/modules/shared-services/domain/notification-policy.ts) | Channel, consent, dedupe-key, and recipient-reference rules          |
| A      | [`domain/export-policy.ts`](../../../src/modules/shared-services/domain/export-policy.ts)             | Export resource registry, field allow-lists, formula-risk definition |

### 3.3 Application layer (8 added)

| Status | Path                                                                                                                              | Delivers                                                       |
| ------ | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| A      | [`application/number-allocation-service.ts`](../../../src/modules/shared-services/application/number-allocation-service.ts)       | In-process allocation on a caller-supplied `DbHandle`          |
| A      | [`application/attachment-service.ts`](../../../src/modules/shared-services/application/attachment-service.ts)                     | The frozen `FileService` implementation                        |
| A      | [`application/notification-service.ts`](../../../src/modules/shared-services/application/notification-service.ts)                 | The frozen `NotificationService` implementation; enqueue-first |
| A      | [`application/message-dispatcher.ts`](../../../src/modules/shared-services/application/message-dispatcher.ts)                     | Worker-side dispatch, on `app_worker` only                     |
| A      | [`application/template-service.ts`](../../../src/modules/shared-services/application/template-service.ts)                         | Template and version lifecycle                                 |
| A      | [`application/status-transition-service.ts`](../../../src/modules/shared-services/application/status-transition-service.ts)       | The transition engine over module-owned histories              |
| A      | [`application/export-authorization-service.ts`](../../../src/modules/shared-services/application/export-authorization-service.ts) | Export authorization; `generated: false` always                |
| A      | [`application/health-service.ts`](../../../src/modules/shared-services/application/health-service.ts)                             | Liveness and a stripped, bounded readiness projection          |

### 3.4 Data layer (7 added)

| Status | Path                                                                                                              |
| ------ | ----------------------------------------------------------------------------------------------------------------- |
| A      | [`data/document-repository.ts`](../../../src/modules/shared-services/data/document-repository.ts)                 |
| A      | [`data/template-repository.ts`](../../../src/modules/shared-services/data/template-repository.ts)                 |
| A      | [`data/notification-repository.ts`](../../../src/modules/shared-services/data/notification-repository.ts)         |
| A      | [`data/message-dispatch-repository.ts`](../../../src/modules/shared-services/data/message-dispatch-repository.ts) |
| A      | [`data/number-sequence-repository.ts`](../../../src/modules/shared-services/data/number-sequence-repository.ts)   |
| A      | [`data/export-repository.ts`](../../../src/modules/shared-services/data/export-repository.ts)                     |
| A      | [`data/transition-repository.ts`](../../../src/modules/shared-services/data/transition-repository.ts)             |

### 3.5 Provider layer (3 added)

| Status | Path                                                                                                            | Default behaviour                                           |
| ------ | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| A      | [`provider/storage-provider.ts`](../../../src/modules/shared-services/provider/storage-provider.ts)             | `unconfigured` — refuses to sign, surfaces `ERR-SYS-001`    |
| A      | [`provider/local-storage-provider.ts`](../../../src/modules/shared-services/provider/local-storage-provider.ts) | Selected explicitly; signs against a `.invalid` host        |
| A      | [`provider/message-provider.ts`](../../../src/modules/shared-services/provider/message-provider.ts)             | `unconfigured` — refuses to deliver; local adapter included |

**No production object store and no production message provider is provisioned.** Both defaults refuse
rather than pretending otherwise.

## 4. Route handlers — `src/app/api/v1/` (20 added, 21 operations)

Twenty files; the branch-status path carries two operations (`GET` and `POST`), so `defineOperation()`
appears **21** times across the twenty files.

| Status | Path                                                                                                               | Operation                              | Method   |
| ------ | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | -------- |
| A      | [`attachments/upload-authorizations/route.ts`](../../../src/app/api/v1/attachments/upload-authorizations/route.ts) | `shared.attachment-upload-authorize`   | `POST`   |
| A      | [`attachments/versions/route.ts`](../../../src/app/api/v1/attachments/versions/route.ts)                           | `shared.attachment-version-register`   | `POST`   |
| A      | `attachments/versions/[versionId]/rejection/route.ts`                                                              | `shared.attachment-version-reject`     | `POST`   |
| A      | `attachments/documents/[documentId]/download-authorizations/route.ts`                                              | `shared.attachment-download-authorize` | `POST`   |
| A      | `attachments/documents/[documentId]/links/route.ts`                                                                | `shared.attachment-link-create`        | `POST`   |
| A      | `attachments/links/[linkId]/route.ts`                                                                              | `shared.attachment-link-withdraw`      | `DELETE` |
| A      | [`message-templates/route.ts`](../../../src/app/api/v1/message-templates/route.ts)                                 | `shared.template-create`               | `POST`   |
| A      | `message-templates/[templateId]/route.ts`                                                                          | `shared.template-update`               | `PATCH`  |
| A      | `message-templates/[templateId]/versions/route.ts`                                                                 | `shared.template-version-create`       | `POST`   |
| A      | `message-templates/[templateId]/active-version/route.ts`                                                           | `shared.template-activation-set`       | `PUT`    |
| A      | `template-versions/[versionId]/route.ts`                                                                           | `shared.template-version-revise`       | `PATCH`  |
| A      | `template-versions/[versionId]/approval/route.ts`                                                                  | `shared.template-version-approve`      | `POST`   |
| A      | `template-versions/[versionId]/retirement/route.ts`                                                                | `shared.template-version-retire`       | `POST`   |
| A      | `template-versions/[versionId]/preview/route.ts`                                                                   | `shared.template-version-preview`      | `POST`   |
| A      | [`notifications/route.ts`](../../../src/app/api/v1/notifications/route.ts)                                         | `shared.notification-enqueue`          | `POST`   |
| A      | `organization/branches/[branchId]/status/route.ts`                                                                 | `shared.branch-status-read`            | `GET`    |
| A      | _(same file)_                                                                                                      | `shared.branch-status-change`          | `POST`   |
| A      | [`exports/resources/route.ts`](../../../src/app/api/v1/exports/resources/route.ts)                                 | `shared.export-catalogue`              | `GET`    |
| A      | [`exports/authorizations/route.ts`](../../../src/app/api/v1/exports/authorizations/route.ts)                       | `shared.export-authorize`              | `POST`   |
| A      | [`health/live/route.ts`](../../../src/app/api/v1/health/live/route.ts)                                             | `shared.health-live`                   | `GET`    |
| A      | [`health/ready/route.ts`](../../../src/app/api/v1/health/ready/route.ts)                                           | `shared.health-ready`                  | `GET`    |

Paths containing a `[param]` segment are given as plain text rather than as links, because a bracketed
segment is not a portable Markdown link target.

**No operation was created for number allocation.** The colon-verb planning label is rejected by the
registry's path grammar, and a standalone endpoint would commit a number that no business row consumes.

## 5. Foundation changes (5 modified)

All additive. No existing entry was edited, removed, or repurposed.

| Status | Path                                                                                  | Added                                                                                       |
| ------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| M      | [`src/server/auth/audit-actions.ts`](../../../src/server/auth/audit-actions.ts)       | **15** audit action codes                                                                   |
| M      | [`src/server/errors/catalog.ts`](../../../src/server/errors/catalog.ts)               | **4** error codes (`ERR-DOC-001`, `ERR-NTF-001`, `ERR-EXP-001`, `ERR-TRN-001`) and 4 owners |
| M      | [`src/server/events/envelope.ts`](../../../src/server/events/envelope.ts)             | **5** event catalog entries; one existing entry marked `implementedIn: 'P1-15'`             |
| M      | [`src/server/config/backend-config.ts`](../../../src/server/config/backend-config.ts) | **11** settings; both provider settings default to `unconfigured`                           |
| M      | [`src/server/observability/metrics.ts`](../../../src/server/observability/metrics.ts) | **19** instrument names in the existing `METRICS` object                                    |

Counts verified by counting added catalog lines per file in `git diff origin/develop...HEAD`.

## 6. CI / tooling (2 modified)

| Status | Path                                                                                              | Change                                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| M      | [`scripts/check-module-boundaries.mjs`](../../../scripts/check-module-boundaries.mjs)             | Rules **B11** (a handler may not import a foundation service contract) and **B12** (a domain layer may not reach a provider) |
| M      | [`scripts/check-operation-test-coverage.mjs`](../../../scripts/check-operation-test-coverage.mjs) | Coverage manifest entries declaring the required evidence depth for all 21 P1-15 operations                                  |

A third script was added: [`scripts/check-encoding.mjs`](../../../scripts/check-encoding.mjs), which
refuses a byte-order mark, a U+FFFD replacement character, or a mojibake signature in any tracked
text file, and runs in the CI `quality` job.

The coverage script no longer merely records obligations. For the `shared.` surface it **derives**
them from each operation's own `defineOperation({...})` — `idempotent` implies idempotency,
`versionGuarded` implies stale-version, an audit class implies audit, a `{param}` implies
cross-tenant, branch scope implies isolation — so the obligation cannot be weakened by editing the
manifest. It prints a P1-15 breakdown separately from the repository aggregate, and every failure
category it can report is proved by
[the negative fixture](../../../tests/foundation/operation-coverage-gate.test.ts).

## 7. Tests (9 added, 2 modified)

| Status | Path                                                                                                                | Covers                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| A      | [`tests/db/p1-15-normalization-parity.test.ts`](../../../tests/db/p1-15-normalization-parity.test.ts)               | Differential parity of the TypeScript mirrors against the three frozen SQL functions            |
| A      | [`tests/foundation/p1-15-catalogs.test.ts`](../../../tests/foundation/p1-15-catalogs.test.ts)                       | Error, audit-action, event, and metric catalogs; sequence registry; transition graph            |
| A      | [`tests/foundation/p1-15-storage-key.test.ts`](../../../tests/foundation/p1-15-storage-key.test.ts)                 | Key construction, tenant binding, well-formedness, filename sanitisation                        |
| A      | [`tests/foundation/p1-15-signed-urls.test.ts`](../../../tests/foundation/p1-15-signed-urls.test.ts)                 | Issuance, verification, refusals, simulated faults, the unconfigured default                    |
| A      | [`tests/foundation/p1-15-template-rendering.test.ts`](../../../tests/foundation/p1-15-template-rendering.test.ts)   | Determinism, strict variable contract, escaping, single-pass substitution, no path/module reach |
| A      | [`tests/foundation/p1-15-notification-policy.test.ts`](../../../tests/foundation/p1-15-notification-policy.test.ts) | Channels, recipient references, dedupe keys, consent, template usability, digests               |
| A      | [`tests/foundation/p1-15-query-primitives.test.ts`](../../../tests/foundation/p1-15-query-primitives.test.ts)       | Parameter binding, bounds, injection payloads, sensitive fields, cursor binding                 |
| A      | [`tests/foundation/p1-15-export-policy.test.ts`](../../../tests/foundation/p1-15-export-policy.test.ts)             | Resource registry, field resolution, never-exportable columns, formula risk                     |
| A      | [`tests/foundation/p1-15-health.test.ts`](../../../tests/foundation/p1-15-health.test.ts)                           | Liveness disclosure, readiness detail-dropping, `/api/health` unchanged                         |
| M      | [`tests/foundation/event-envelope.test.ts`](../../../tests/foundation/event-envelope.test.ts)                       | Extended for the new catalog entries                                                            |
| M      | [`tests/openapi-contract.test.ts`](../../../tests/openapi-contract.test.ts)                                         | Published contract against the registered operations                                            |

The table above lists the suites the phase opened with. The full set is **22 test paths — 19 added,
3 modified** — and the complete per-file inventory with test counts is
[the test catalogue](test-catalog.md) §2. What has changed most since the phase opened is the depth:

| Tier              | Files  | Tests   |
| ----------------- | ------ | ------- |
| Unit / foundation | 10     | 303     |
| Database          | 8      | 246     |
| Backend           | 4      | 204     |
| **P1-15 total**   | **22** | **753** |

The backend tier includes
[`tests/backend/p1-15-operation-routes.test.ts`](../../../tests/backend/p1-15-operation-routes.test.ts),
which drives **all 21 registered operations through their exported route handlers** — so gate
conditions 2–6 now have artefacts rather than obligations. The per-operation record is
[the operation inventory](operation-inventory.md).

## 8. Documentation and API contract (5 added, 1 modified)

| Status | Path                                                                                                       |
| ------ | ---------------------------------------------------------------------------------------------------------- |
| A      | [`docs/phase-1/phase-1-15/phase-1-15-initial-audit.md`](phase-1-15-initial-audit.md)                       |
| A      | [`docs/phase-1/phase-1-15/phase-1-15-owner-gate.md`](phase-1-15-owner-gate.md)                             |
| A      | [`docs/phase-1/phase-1-15/phase-1-15-remediation-verification.md`](phase-1-15-remediation-verification.md) |
| A      | [`docs/phase-1/phase-1-15/phase-1-15-implementation-decisions.md`](phase-1-15-implementation-decisions.md) |
| A      | [`docs/phase-1/phase-1-15/security-review.md`](security-review.md)                                         |
| M      | [`docs/api/openapi.v1.json`](../../../docs/api/openapi.v1.json)                                            |

Two further P1-15 records — [the database remediation record](phase-1-15-database-remediation-record.md)
and [the migration classification](phase-1-15-migration-classification.md) — are **not** in this
manifest because they already reached protected `develop` through pull request #60.

## 9. Working tree at the time of writing

Recorded because a manifest that silently presented a dirty tree as the deliverable would be inaccurate.
At **2026-07-23 11:12** local, `git status --porcelain` reported one modified file
(`docs/phase-1/phase-1-14/evidence/operation-test-matrix.json`) and a set of untracked Phase 1-15
documentation records, including this one, still being written.

The working tree was **actively changing** while this manifest was produced — the branch head advanced
from `bfc56f8` to `6ae38db` mid-writing. Two consequences follow, and both are stated rather than
smoothed over:

1. This manifest is accurate **for `6ae38db`** and must be regenerated at the final SHA before the
   pull request is opened.
2. **No claim in any P1-15 document may rest on an uncommitted file**, and none does — the evidence
   index treats every claim that would depend on one as unbacked.

## 10. Status

The P1-15 owner gate is **Pending**. This manifest describes what exists on an **unpushed, unmerged**
feature branch — no remote branch for it exists, so no hosted CI run exists for it either. It is not a
statement that the deliverable is complete, evidenced, or approved. `origin/main` is untouched at
`8ca1da2`, and nothing reached protected `develop` outside the approved pull-request and hosted-CI flow.
