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

| SHA        | Wave | Contents                                          |
| ---------- | ---- | ------------------------------------------------- |
| `5e779a5e` | 0    | archaeology + operation-coverage namespace repair |
| `b47ea34b` | 2a   | notification read repository + service            |

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
- **New codes follow `domain.resource.action`** and are created like every other
  code (permissions are tenant rows, not migration seeds):
  `shared.notification.read` (inbox), `shared.notification.delivery.read`
  (privileged inspection), `rpt.report.read`.
- Route shape: `defineOperation({...})` + `handleOperation(OP, request, fn)`,
  `export const runtime = 'nodejs'` and `dynamic = 'force-dynamic'`.
- `ERR-NTF-001`, `ERR-DOC-001`, `ERR-EXP-001` already exist in the catalog.

## Next exact actions

1. Register the three notification routes and declare their operations:
   - `GET /notifications` → `shared.notification-list`
   - `GET /notifications/{notificationId}` → `shared.notification-read`
   - `GET /notifications/{notificationId}/deliveries` →
     `shared.notification-delivery-list` (privileged, audited)
     Wire `NotificationReadService` into `installSharedServicesRuntime()`.
2. Wave 1 — document read + retention evaluation (dry-run, non-destructive,
   refusing to act when policy is absent).
3. Wave 3 — `rpt.` report catalogue/read and export request/status.
4. Waves 4–7 — isolation and abuse tests, evidence suites, the 27-task gate
   script, OpenAPI regeneration, hostile mutation matrix, adversarial reviews,
   feature PR → merge, documentation-only gate PR → merge, promotion to main.

## Invariants to re-check at every wave

migrations 119 · no 120 · schema hash `a677eb05…` · production audit 0 ·
application CodeQL Critical 0 / High 0 · no deployment · no tag · P1-24 not
started · no real email sent · no real customer document uploaded.
