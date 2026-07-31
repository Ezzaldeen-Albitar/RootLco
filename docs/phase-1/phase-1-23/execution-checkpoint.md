# P1-23 — execution checkpoint

## Baseline (verified, not recalled)

|                                    |                                                           |
| ---------------------------------- | --------------------------------------------------------- |
| `P1_23_BASE_SHA`                   | `9f7ef083ba90be3343aec2be1c721e3826070946`                |
| `P1_23_BASE_TREE`                  | `a921cae307dd9310fa5f51b7431a6ebe0d4d08ee`                |
| `origin/main` at start             | `5f30902d4a19241eded98e0f675301edb0ee5669`                |
| develop/main synchronized at start | **yes** — trees identical, ancestry exit 0, diff 0 files  |
| Branch                             | `feature/p1-23-documents-notifications-reporting-backend` |
| Worktree                           | `C:/Users/EZZALD~1/AppData/Local/Temp/claude/p23`         |
| Migrations                         | 119, no 120                                               |
| Prior closure                      | Pre-P1-23 Dependency Maintenance Batch — 100/100 VERIFIED |

Open PR at start: **#138** (Dependabot re-proposing `hadolint-action` 3.4.0),
closed as a duplicate of the tracked deferral **#136**. Open PRs then **0**.

## Commits so far

| SHA        | Wave | Contents                                                         |
| ---------- | ---- | ---------------------------------------------------------------- |
| `5e779a5e` | 0    | archaeology + operation-coverage namespace repair                |
| `b47ea34b` | 2a   | notification read repository + service                           |
| `6377d621` | 2b   | notification routes and operations                               |
| `9fedd2c7` | 1    | document read + retention evaluation                             |
| `4cd02aa0` | 1b   | document routes, error catalog                                   |
| `6045d481` | 3    | reporting module, catalogue and definition reads                 |
| `2bdc177d` | fix  | real document schema (category_id, no `active` status)           |
| `f084398d` | fix  | document lifecycle reproduced; retention ladder                  |
| `75511e5e` | 4    | **27-task phase gate** + the 4 missing permission codes it found |
| `b91b8a85` | fix  | ladder corrected to APPROVED class data; catalog pin 100→104     |
| `b3497eb7` | fix  | ladder derived from class row; generator writes through prettier |
| `c183d3e9` | fix  | schema-baseline permissionCount 100→104                          |

## Status

**7 operations** (not 8 — `shared.notification-enqueue` is P1-15's), all `[OK]`
in the coverage gate. Phase gate **27/27**. Local tiers: unit 1267, db 1636,
backend 1648. Migrations **119**, no 120, schema hash unchanged.

## Wave 0 — baseline and archaeology · COMPLETE

Findings that changed the shape of the phase:

**P1-15 already built most of this phase's write lifecycles.** Twenty-one
`shared.*` operations exist covering upload authorization, version
register/reject, download authorization, entity links, the full template
lifecycle, notification enqueue and export authorization. P1-23 is _additive_ —
it supplies the **read, observability, retention and reporting** surface those
phases deliberately left out.

**No migration 120 is required.** Every table exists — see
[`contract-archaeology.md`](contract-archaeology.md).

**The role split decides the notification design.** `app_runtime` may only
INSERT a `pending` message, holds **no** UPDATE on `outbound_messages` and
**nothing** on `delivery_attempts`; `app_worker` owns the status transition and
attempt INSERT. **Manual retry cannot be a request-runtime UPDATE** — a public
retry operation may only _request_ one.

**Operation-coverage derivation repaired before any operation was declared.**
`shared.` was already derived; `rpt.` was not, and both hooks
(`DERIVED_PREFIXES` and the `parseProvidedFlags` alternation) were extended
together and mutation-proven. Gate suite 97/97.

## Wave 2a — notification read layer · COMPLETE

`data/notification-read-repository.ts` and
`application/notification-read-service.ts`. Typecheck and lint clean. **No route
registered yet, so no operation is declared and the operation inventory is
unchanged.**

Contract details the compiler taught, both now respected:

- `RequestContext` exposes the tenant as `principal.tenantId`.
- **`SafeDetails` is a closed shape.** It refuses arbitrary keys by design, so
  the not-found failure carries no `safeDetails` rather than widening the type
  to admit an id — an error body is exactly where identifiers drift into logs.

## Reconciled conventions (do not re-derive)

- **Route grammar is noun/sub-resource**, never colon actions:
  `/attachments/upload-authorizations`,
  `/attachments/documents/{documentId}/download-authorizations`,
  `/exports/authorizations`, `/exports/resources`.
- **Existing permissions to reuse:** `shared.document.manage` (documents,
  scope `tenant`, `auditClass: 'security'`), `rpt.export` (exports, scope
  `tenant`, `auditClass: 'export'`), `shared.notification.send` (enqueue).
- **New codes follow `domain.resource.action`.** ~~permissions are tenant rows,
  not migration seeds~~ — **CORRECTED (measured, 2026-07-31).** Permissions are
  PLATFORM catalog rows in `supabase/seeds/04_iam_permission_catalog.sql`, which
  is idempotent and additive and is not a migration. A tenant grants them via
  `iam.role_permissions` + `iam.role_grants`, but the CODE must exist in the
  platform catalog first. Four codes were added there:
  `shared.notification.read` (inbox), `shared.notification.delivery.read`
  (privileged inspection), `shared.document.archive` (guards retention
  evaluation as well as archival), `rpt.report.read`.
- **A denial-only authorization test proves nothing.** All four codes above were
  absent from the catalog while every denial test in the phase passed — a
  permission that does not exist cannot be held by anybody. Assert the POSITIVE
  direction (`tests/backend/p1-23-authorization.test.ts`): a principal who holds
  the permission is ALLOWED. Verified by mutation — deleting one code fails 3
  assertions there while the denial-only reporting suite stays 10/10 green.
- **`P1_23_PREFIXES = ['rpt.']`** in `scripts/check-operation-test-coverage.mjs`.
  The `rpt.` namespace had never carried an operation, so it had to join
  `DERIVED_PREFIXES` _and_ the declaration alternation together — a prefix in one
  but not the other reports a vacuous 0/0 that reads like passing coverage.
  `shared.` needed no new hook; it was already opted in by P1-15.
- Route shape: `defineOperation({...})` + `handleOperation(OP, request, fn)`,
  `export const runtime = 'nodejs'` and `dynamic = 'force-dynamic'`.
- `ERR-NTF-001`, `ERR-DOC-001`, `ERR-EXP-001` already exist in the catalog.

## Traps this phase has already paid for — do not re-derive

- **A denial-only authorization suite proves nothing.** Four declared permission
  codes were missing from the platform catalog and every denial test passed,
  because a code that does not exist cannot be held. Assert the positive
  direction.
- **The local database is not an oracle for reference data.**
  `tests/db/shared-retention.test.ts:59` forces `operational = 0` and
  `evidence-audit = 3650` and never restores them, so any suite sharing that
  database afterwards sees invented retention periods. CI hides it (separate
  containers per tier). Verify reference data against `supabase/seeds/` and
  `npm run validate:seed-state`.
- **`shared.documents` has no `active` status** — the set is
  `pending / accepted / quarantined / archived`, and a BEFORE INSERT guard
  requires `pending`, so the lifecycle must be reproduced, not short-circuited.
- **`uq_document_categories_tenant_code` is PARTIAL**, so `ON CONFLICT
(tenant_id, category_code)` does not resolve. Conflict on the primary key.
- **Run the doc generator LAST, or make it prettier-stable.** `prettier --write
docs` re-pads generated tables; the generator now writes through prettier so
  `--check` and `format:check` cannot contradict each other.
- **Two count pins move with the catalog**, and both are deliberate:
  `tests/db/p1-15-shared-services-runtime-capabilities.test.ts` (100→104) and
  `.github/ci-baselines/schema-baseline.json` `permissionCount` (100→104).

## Merge chain — COMPLETE

Every merge used a MERGE COMMIT (`develop` permits `merge` only); none is a squash.

| PR   | Head       | Merge      | Contents                                                   |
| ---- | ---------- | ---------- | ---------------------------------------------------------- |
| #139 | `c2f89d91` | `12a80c9e` | the phase — seven operations                               |
| #140 | `222d363e` | `efe800d9` | novelty check pinned to the phase baseline (see below)     |
| #141 | `d98922d4` | `a247c78b` | adversarial-review findings; the mutation matrix made real |

`develop` tree after #139 was `971557bf`, **predicted with `git merge-tree` before the
merge and matched after**.

## What each post-merge fix was for

**#140 — the gate destroyed itself.** Check 6 compared the phase allowlist against
`origin/develop`. That passed on all nineteen green PR runs, because while the phase was
in review `origin/develop` WAS the baseline. The instant #139 merged, the seven operations
existed there and four checks went red. A green pull request could not have revealed it.
`BASE_REF` is now the immovable phase baseline `9f7ef083`.

**#141 — the mutation matrix was measuring nothing.** It reported 9/9 caught. `runSuite`
scored ANY non-zero exit as CAUGHT, and the runner could not start at all — `execFileSync`
on a `.cmd` throws `EINVAL` under Node 24 on Windows. Rewritten with a green baseline and
a requirement that the failure be an ASSERTION; crash signatures are STILLBORN and fail the
run. The honest matrix then found two real survivors, both fixed, and a third that is
recorded rather than fixed.

## Invariants at closure

migrations **119** · no 120 · schema hash `a677eb05…` unchanged · permissions **104** ·
CodeQL full-tree **0 Critical / 0 High** · no deployment · no tag · P1-24 not started ·
no real email sent · no real customer document uploaded · no business data seeded.
