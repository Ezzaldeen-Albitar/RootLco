# Phase 1-15 — Change Log

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

## 1. Scope of this log

Grouped by area rather than chronologically, because the interesting question about a shared-services
phase is _which contract moved_, not _which day it moved_. Commit subjects are quoted verbatim from
`git log --oneline` so a reader can locate any statement in history.

Two branch states matter and are kept separate throughout:

| State                                                      | Value                                   |
| ---------------------------------------------------------- | --------------------------------------- |
| Protected `origin/develop` this branch is measured against | `e50d501`                               |
| Feature branch                                             | `feature/p1-15-shared-services-backend` |
| Branch head this log describes                             | `6ae38db`                               |
| Protected `origin/main`                                    | `8ca1da2` — **untouched by this phase** |

The P1-15 owner gate is **Pending**. Nothing below is a claim that the phase is complete or approved.

## 2. Commits on the feature branch

Seven commits, oldest first, from `git log --oneline origin/develop..HEAD`:

| SHA       | Subject                                                                                                                       |
| --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `4d964c5` | `[P1-15] Open Shared Services Backend phase: Wave 0 audit and Pending owner gate`                                             |
| `d666254` | `[P1-15] Record the protected remediation verification (Waves 1-3)`                                                           |
| `c01db11` | `[P1-15] Record binding implementation decisions where planning met frozen contracts`                                         |
| `231f056` | `[P1-15] Add normalization primitives proven equivalent to the frozen SQL`                                                    |
| `1698b09` | `[P1-15] Implement the shared-services module: numbering, attachments, notifications, templates, transitions, export, health` |
| `bfc56f8` | `[P1-15] Register the 21 shared-services operations and their route handlers`                                                 |
| `6ae38db` | `[P1-15] Add the pure-unit test suites, the coverage manifest and the security review`                                        |

The branch is still in execution and the head advances; every count below is stated for `6ae38db`.

### 2.1 P1-15 work already on protected `develop`

The database remediation this phase depends on was merged before the feature branch was resumed, so it
is P1-15 work that is **not** in the feature diff. It is listed here because a change log that omitted
it would misrepresent what the phase did.

| SHA       | Subject                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------- |
| `4c2bad3` | `[P1-15] Raise DBCR-P1-15-001 and decide the shared-services capability matrix`                      |
| `ffaadb0` | `[P1-15] Add migration 117: tenant-safe shared-services runtime write capabilities`                  |
| `614d77a` | `[P1-15] Add the migration-117 capability suite and update exact inventories`                        |
| `1af4b82` | `[P1-15] Record the remediation, migration classification and P1-15-R-001`                           |
| `d39f576` | `[P1-15] Make the migration-count proof portable to the CI database`                                 |
| `e50d501` | `Merge pull request #60 from Ezzaldeen-Albitar/fix/p1-15-shared-services-runtime-write-capabilities` |

Migration 117 arrives on the feature branch **through protected history**, not as a duplicate — see
[the remediation verification](phase-1-15-remediation-verification.md) §4.

## 3. Added

### 3.1 The `shared-services` module

A new module under `src/modules/shared-services/`, composed through
[`index.ts`](../../../src/modules/shared-services/index.ts) as its single legal import path. Its
internal layers follow the existing convention exactly — `domain/` for rules, `application/` for
services, `data/` for repositories, `provider/` for ports — and the public surface deliberately exports
**no repository and no pool**, because handing out a repository would let a caller run SQL under this
module's identity and skip the audit, event, and scope rules only the services apply.

| Layer          | What landed                                                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain/`      | Normalization mirrors, the transition graph, the sequence registry, query primitives, storage-key construction, attachment allow-lists and the upload token, template rendering, notification policy, export policy |
| `application/` | Number allocation, attachment lifecycle, notification enqueue, template lifecycle, status transitions, export authorization, health projections, worker-side message dispatch                                       |
| `data/`        | Seven repositories: documents, templates, notifications, number sequences, exports, message dispatch, and the branch transition adapter                                                                             |
| `provider/`    | The storage port with its `unconfigured` default and a deterministic local adapter; the message-delivery port with its `unconfigured` default and a deterministic in-process adapter                                |

### 3.2 Twenty-one operations across twenty route files

Every operation is declared with `defineOperation()` inside the route that serves it, so the existing
authorization-coverage checker reconciles route and registration. The counts are exact:
`grep -c defineOperation` across the twenty added route files totals **21** — the branch-status route
carries two (a `GET` and a `POST` on the same path).

| Area              | Operations                                                                                                                                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Attachments (6)   | `attachment-upload-authorize`, `attachment-version-register`, `attachment-version-reject`, `attachment-download-authorize`, `attachment-link-create`, `attachment-link-withdraw`                         |
| Templates (8)     | `template-create`, `template-update`, `template-version-create`, `template-version-revise`, `template-version-approve`, `template-version-retire`, `template-version-preview`, `template-activation-set` |
| Notifications (1) | `notification-enqueue`                                                                                                                                                                                   |
| Transitions (2)   | `branch-status-read`, `branch-status-change`                                                                                                                                                             |
| Export (2)        | `export-catalogue`, `export-authorize`                                                                                                                                                                   |
| Health (2)        | `health-live`, `health-ready`                                                                                                                                                                            |

Colon-verb paths from the planning text (`POST /api/v1/numbers:allocate`,
`POST /api/v1/attachments:authorize-upload`) are **not** implemented: the operation registry's path
grammar rejects a colon, and no colon path exists anywhere in the codebase. The established convention
— an action becomes a noun sub-resource — was followed instead, which is why the paths read
`/attachments/upload-authorizations` and `/template-versions/{versionId}/approval`.

### 3.3 Normalization primitives

`normalizeVin`, `normalizePhoneDigits`, and `normalizeEmail` mirror `veh.normalize_vin`,
`crm.normalize_phone`, and `crm.normalize_email` character for character, **including the edge cases
that look like defects** — a lone `+` survives as `'+'`, Arabic-Indic digits normalize away to `NULL`,
and `I`/`O`/`Q` in a VIN are preserved. `normalizeSearchValue` is the one genuinely new primitive.

Validation is reported _alongside_ the normalized value and never applied to it, because silent repair
is how a typo becomes a different vehicle.

### 3.4 Test suites

Nine test files were added and two extended. Ten of the eleven are **pure-unit or catalog** suites —
storage keys, signed URLs, template rendering, notification policy, query primitives, export policy,
health projections, and the four catalogs plus the sequence registry and transition graph. One
(`tests/db/p1-15-normalization-parity.test.ts`) requires a database and is differential: the same
corpus goes through the three frozen SQL functions and through the TypeScript mirrors, and every pair
must match.

**No integration suite exercising a registered operation end-to-end is committed.** The coverage
manifest added to `scripts/check-operation-test-coverage.mjs` declares the required evidence depth for
all 21 operations and names three backend suites that do not yet exist — an obligation, not evidence.
[The evidence index](evidence-index.md) lists every resulting unbacked claim by name.

### 3.5 Documentation

Five records were added by the feature branch: the [Wave 0 initial audit](phase-1-15-initial-audit.md),
the [Pending owner gate](phase-1-15-owner-gate.md), the
[remediation verification](phase-1-15-remediation-verification.md), the
[binding implementation decisions](phase-1-15-implementation-decisions.md), and the
[security and adversarial review](security-review.md). The gate was created **at the opening of the
phase, in the Pending state**, so the omission P1-14 recorded against itself cannot recur.

## 4. Changed

Five foundation files and one CI script were extended. Every one was extended **additively**: no
existing entry was edited, removed, or repurposed.

| File                                                                                                                                         | Change                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`src/server/auth/audit-actions.ts`](../../../src/server/auth/audit-actions.ts)                                                              | Fifteen shared-service audit actions added to the controlled catalog. Upload and download authorization are classed **`security`**, not `privileged`: issuing a signed URL hands out a bearer capability to bytes, and it should be triaged beside grant changes |
| [`src/server/errors/catalog.ts`](../../../src/server/errors/catalog.ts)                                                                      | Four codes added — `ERR-DOC-001`, `ERR-NTF-001`, `ERR-EXP-001`, `ERR-TRN-001` — each because no existing class of failure fitted. `ERR-DEP-001`'s description was widened to name the two new provider kinds                                                     |
| [`src/server/events/envelope.ts`](../../../src/server/events/envelope.ts)                                                                    | Five catalog entries added and `message.delivery.state.changed` marked `implementedIn: 'P1-15'`. Names carry **no** `.v1` suffix — the schema version is its own column, and duplicating it would give two ways to express one fact                              |
| [`src/server/config/backend-config.ts`](../../../src/server/config/backend-config.ts)                                                        | Eleven settings for storage, delivery, readiness, and export. `STORAGE_PROVIDER` and `NOTIFICATION_PROVIDER` default to **`unconfigured`**, which says nothing is provisioned rather than quietly selecting something                                            |
| [`src/server/observability/metrics.ts`](../../../src/server/observability/metrics.ts)                                                        | Nineteen instrument names added as keys in the existing `METRICS` object. Labels are catalogue metadata only — never an id, key, recipient, VIN, or tenant                                                                                                       |
| [`scripts/check-module-boundaries.mjs`](../../../scripts/check-module-boundaries.mjs)                                                        | Two rules added: **B11** (a route handler may not import a foundation service contract directly) and **B12** (a module's `domain/` layer may not reach a provider, which is I/O by definition)                                                                   |
| [`scripts/check-operation-test-coverage.mjs`](../../../scripts/check-operation-test-coverage.mjs)                                            | Coverage-manifest entries declaring the required evidence depth for each of the 21 operations — `success`, `denial`, `cross-tenant`, `audit`, `outbox`, `stale-version`, `idempotency` as applicable                                                             |
| [`docs/api/openapi.v1.json`](../../../docs/api/openapi.v1.json), `tests/openapi-contract.test.ts`, `tests/foundation/event-envelope.test.ts` | Regenerated and extended for the twenty-one new operations and the new catalog entries                                                                                                                                                                           |

### 4.1 The two frozen P1-13 seams are now filled

P1-13 froze `FileService` and `NotificationService` and left `setFileService()` / `setNotificationService()`
as the seams. `installSharedServicesRuntime()` fills them at module composition, so every earlier caller
written against those contracts starts working without changing a line and the `ERR-STB-001` stub stops
being reachable. Neither interface signature changed. Where the frozen shape had no field for something
P1-15 produces — the signed upload URL, the rendered message body — an **additional** method returns it
and the frozen method delegates and narrows.

## 5. Deliberately not changed

This section is the point of the log. Each item below was reachable and was left alone on purpose.

| Not changed                                            | Why                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`supabase/migrations/` — no migration added**        | `git diff --name-only origin/develop...HEAD -- supabase/migrations` returns **nothing**. The 117-migration contract delivered through PR #60 is consumed unchanged                                                                                                          |
| **`/api/health`**                                      | Asserted to return exactly seven keys and used as the container healthcheck with `curl -fsS`, which fails on any non-2xx. Changing its shape would break a probe to gain nothing; P1-15 added `/api/v1/health/live` and `/api/v1/health/ready` at new paths                 |
| **`veh.normalize_vin` semantics**                      | The frozen function performs no length check, no character rejection, and no check-digit validation, and `veh.vehicles` carries a generated column derived from it. A stricter mirror would disagree with stored data                                                       |
| **`crm.normalize_phone` semantics**                    | The lone-`+` and Arabic-Indic behaviours are reproduced, not fixed. Changing them is a database change with its own change request                                                                                                                                          |
| **`crm.normalize_email` semantics**                    | Trim and lowercase only. Dots and `+tags` are preserved; no P1-15 code strips either                                                                                                                                                                                        |
| **`shared.status_history` / `shared.status_evidence`** | Remain unwritable by every application role. The transition engine drives module-owned, scope-bound, coherence-guarded history tables instead of a generic store with no FK, no entity allow-list, and no guard                                                             |
| **`shared.file_scan_results`**                         | Remains unwritable by every role, so no verdict can be fabricated — and document **acceptance stays unavailable** as a direct consequence. No scanner exists and none is claimed                                                                                            |
| **`shared.search_metadata`**                           | No search projection is written. Search normalization is delivered as a primitive; nothing in P1-15 populates the table                                                                                                                                                     |
| **The redaction rules**                                | `redaction.ts` matches `key`, `auth`, `session`, `signature`, and `token` as case-insensitive substrings, which would redact `storageKey`/`dedupeKey`/`objectKey`. Treated as correct-by-default: P1-15 logs the _fact_ (`hasStorageKey: true`) instead of weakening a rule |
| **A standalone number-allocation endpoint**            | Not implemented. The colon path is rejected by the grammar, and a standalone endpoint would commit a number no business row consumes — a business-level gap while appearing to promise gaplessness                                                                          |
| **`origin/main`**                                      | Untouched at `8ca1da2`                                                                                                                                                                                                                                                      |

## 6. Governance

Nothing reached protected `develop` outside the approved pull-request and hosted-CI flow. The
implementer never merges. The P1-15 owner gate remains **Pending** and may be converted only by the
approval owner, after the feature is merged into protected history and the protected post-merge state
is re-verified.
