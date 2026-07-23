# Phase 1-15 — Public operation inventory and acceptance evidence

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Date:** 2026-07-23 ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent third-party audit.**

---

## 1. Why this document exists

An earlier readiness declaration reported operation coverage as a repository-wide aggregate —
"43 with required evidence, 17 invocation-only" — which is true and useless. It does not say
whether a **new** P1-15 operation is one of the seventeen, and seventeen invocation-only
operations is a perfectly good number for a set of P1-14 read endpoints and a catastrophic one
for a set of new public commands.

This document is the per-operation record for the twenty-one operations P1-15 adds. Every
number in it is produced by `node scripts/check-operation-test-coverage.mjs`, which reads the
`defineOperation({...})` registrations out of the source and the `COVERAGE-EVIDENCE`
declarations out of the test files. The machine-readable form is
[`evidence/operation-test-matrix.json`](evidence/operation-test-matrix.json); this document is
the same data with the reasoning attached.

## 2. Result

```
P1-15 registered public operations: 21
P1-15 operation-depth: 21
P1-15 invocation-only: 0
P1-15 pending: 0
P1-15 unit-only: 0
P1-15 unreferenced: 0
P1-15 metadata-only: 0
```

Repository-wide, reported separately and unchanged in model: **60 registered operations · 60
public API surface · 0 internal · 45 with required evidence · 15 invocation-only.** The fifteen
invocation-only operations are all P1-14 `iam.` read and catalogue endpoints plus `meta.ping`;
P1-14's evidence model is the one it was gated with and is not re-interpreted here.

### 2.1 Public or internal — derived, not asserted

The gate classifies an operation as **public API surface** when its `defineOperation({...})`
registration lives in an App Router `route.ts` file, because that is what makes it reachable
over HTTP. All 60 registered operations, and all 21 P1-15 operations, are public API surface.
**No operation was reclassified as internal**, and none needed to be: `internal` is available in
the gate and requires a written `internalReason` in the coverage manifest, so it can never
become a quiet way to escape acceptance evidence.

Two of the twenty-one are additionally **`public: true`** — unauthenticated by declaration. They
are the health probes, and their evidence shape is the mirror image of the other nineteen:
instead of proving a permission gate refuses, they prove the route answers with **no
authenticator installed at all** and discloses nothing a session would have protected.

## 3. What "operation depth" means here

An operation is at operation depth when its evidence includes, at minimum:

| Kind              | What it means                                                                             |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `route`           | the exported HTTP handler is invoked with a real `Request` and its `Response` is asserted |
| `service`         | the wired application service runs on the deployed `app_runtime` identity, under RLS      |
| `authorization`   | a caller lacking the declared permission is refused 403 `ERR-IAM-001`                     |
| `unauthenticated` | (public operations) the route answers with no authenticator and leaks nothing             |
| `success`         | the happy path is asserted end to end                                                     |

and, in addition, every obligation **derived from the operation's own registration**:

| Registration fact                | Obligation it creates |
| -------------------------------- | --------------------- |
| a `{param}` in the path          | `cross-tenant`        |
| `idempotent: true`               | `idempotency`         |
| `versionGuarded: true`           | `stale-version`       |
| `auditClass` other than `none`   | `audit`               |
| `scope` of `company` or `branch` | `isolation`           |

This is the part that matters and it is worth stating plainly: **these obligations are not
written in the manifest, so they cannot be removed by editing the manifest.** Marking an
operation idempotent creates the obligation to prove replay. Declaring an audit class creates
the obligation to prove the record is written. The manifest may only add further obligations
(`outbox`, `denial`, `provider` — things a registration cannot know about). The negative
fixture `tests/foundation/operation-coverage-gate.test.ts` proves the gate fails when each one
is unmet, one category at a time.

## 4. The two evidence files, and why the split

| File                                                                                                                                                                       | What it carries                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/backend/p1-15-operation-routes.test.ts`                                                                                                                             | **101 tests.** Every operation driven through its exported route handler: status codes, problem documents, ETags, `Idempotency-Key`, `If-Match`, the 403 verdict, and bidirectional cross-tenant proofs against rows tenant B created through the same routes. |
| `tests/backend/p1-15-attachments-notifications.test.ts`<br>`tests/backend/p1-15-templates-transitions-export.test.ts`<br>`tests/backend/p1-15-dispatch-and-health.test.ts` | The service-depth properties: repository behaviour, rollback, provider fakes, worker separation, denial _shapes_ observed at the database.                                                                                                                     |

The gate requires the operation id to be referenced in **every** file its manifest entry names,
outside the `COVERAGE-EVIDENCE` block, so a stale reference fails rather than passing quietly.
Flags are unioned across files — no single file has to carry everything.

---

## 5. Per-operation record

Notation: **A** = authenticated, permission required · **U** = unauthenticated by declaration.
"Repository" names the data-layer class the service reaches through; "provider" names the
deterministic local adapter exercised. Evidence entries name the property proved, not merely
the flag.

### 5.1 `shared.attachment-upload-authorize`

|                    |                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Method · path      | `POST /attachments/upload-authorizations`                                                                                       |
| Classification     | public API surface · **A**                                                                                                      |
| Permission · scope | `shared.document.manage` · tenant                                                                                               |
| Route invocation   | `p1-15-operation-routes.test.ts` → `POST` — 201, `method: PUT`, `Cache-Control: no-store, private`, correlation id echoed       |
| Service invocation | `AttachmentService.authorizeUploadDetailed` on `app_runtime`                                                                    |
| Repository         | `DocumentRepository.findCategoryByCode`, `insertDocument`                                                                       |
| Provider fake      | `LocalStorageProvider.signUpload`; the issued URL is **verified** by the same provider and contains an RFC 2606 `.invalid` host |
| Permission denial  | unpermitted caller → 403 `ERR-IAM-001`, `requiredPermissions` equals the registration, and the document count is unchanged      |
| Cross-tenant       | a tenant-B category code is invisible from tenant A → 404 `ERR-RES-001`                                                         |
| Company/branch     | n/a (tenant scope)                                                                                                              |
| Audit              | `shared.document.upload_authorized` counted = 1 against the new document id                                                     |
| Idempotency        | same `Idempotency-Key` twice → one document, one audit record, same id returned                                                 |
| Concurrency        | n/a (not version-guarded)                                                                                                       |
| Outbox             | none — this command publishes no event, and the manifest does not claim one                                                     |
| Provider failure   | n/a; the signing failure path is covered in the storage suite                                                                   |
| **Classification** | **operation depth**                                                                                                             |

Also proved: the **storage key never appears in the response body**, and a missing
`Idempotency-Key` is refused 400 `ERR-INT-002` before any row is written.

### 5.2 `shared.attachment-version-register`

|                    |                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Method · path      | `POST /attachments/versions`                                                                                                                                             |
| Classification     | public API surface · **A**                                                                                                                                               |
| Permission · scope | `shared.document.manage` · tenant                                                                                                                                        |
| Route invocation   | 201 with `{documentId, versionId, versionNumber}`                                                                                                                        |
| Service invocation | `AttachmentService.registerVersion`                                                                                                                                      |
| Repository         | `DocumentRepository.findDocument`, `nextVersionNumber` (advisory lock), `insertVersion`                                                                                  |
| Provider fake      | n/a                                                                                                                                                                      |
| Permission denial  | 403 `ERR-IAM-001`                                                                                                                                                        |
| Cross-tenant       | **a genuine tenant-B upload token**, obtained by tenant B from this same route, is presented in tenant A → 404 `ERR-RES-001`, and nothing lands on the tenant-B document |
| Audit              | `shared.document.version_registered` = 1                                                                                                                                 |
| Idempotency        | replayed key → one version row, one event                                                                                                                                |
| Outbox             | `event_key = document.version:{versionId}` counted = 1                                                                                                                   |
| **Classification** | **operation depth**                                                                                                                                                      |

This is the regression lock for the defect this phase found: `nextVersionNumber()` took a
row-lock that requires UPDATE privilege in order to perform a read, and registration was refused
with SQLSTATE 42501 on a caller that held the permission.

### 5.3 `shared.attachment-version-reject`

|                    |                                                                   |
| ------------------ | ----------------------------------------------------------------- |
| Method · path      | `POST /attachments/versions/{versionId}/rejection`                |
| Classification     | public API surface · **A**                                        |
| Permission · scope | `shared.document.manage` · tenant                                 |
| Route invocation   | 200, `status: 'rejected'`, database status read back              |
| Service invocation | `AttachmentService.rejectVersion`                                 |
| Repository         | `DocumentRepository.findVersion`, `rejectVersion`                 |
| Permission denial  | 403, and the version stays `pending`                              |
| Cross-tenant       | a real tenant-B pending version → 404, still `pending` afterwards |
| Audit              | `shared.document.version_rejected` = 1                            |
| Denial             | a second rejection → 409 `ERR-TRN-001`; rejection is terminal     |
| **Classification** | **operation depth**                                               |

### 5.4 `shared.attachment-download-authorize`

|                    |                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------- |
| Method · path      | `POST /attachments/documents/{documentId}/download-authorizations`                  |
| Classification     | public API surface · **A**                                                          |
| Permission · scope | `shared.document.manage` · tenant                                                   |
| Route invocation   | 200 with `{url, expiresAt}`                                                         |
| Service invocation | `AttachmentService.requestDownload`                                                 |
| Repository         | `DocumentRepository.findVersion` / `findLatestVersion`                              |
| Provider fake      | `LocalStorageProvider.signDownload`; the URL **verifies** and expires in the future |
| Permission denial  | 403                                                                                 |
| Cross-tenant       | a real tenant-B document id → 404                                                   |
| Audit              | `shared.document.download_authorized` = 1, recorded against the **version** signed  |
| Denial             | a `pending` version → 409 `ERR-DOC-001`; only an accepted version may be signed     |
| **Classification** | **operation depth**                                                                 |

The accepted precondition is created by the admin connection, because no application role may
write `shared.file_scan_results`. That withholding is the subject of §7.

### 5.5 `shared.attachment-link-create`

|                    |                                                                    |
| ------------------ | ------------------------------------------------------------------ |
| Method · path      | `POST /attachments/documents/{documentId}/links`                   |
| Classification     | public API surface · **A**                                         |
| Permission · scope | `shared.document.manage` · tenant                                  |
| Route invocation   | 201 with `{linkId}`                                                |
| Service invocation | `AttachmentService.link`                                           |
| Repository         | `DocumentRepository.findDocument`, `insertLink`                    |
| Permission denial  | 403                                                                |
| Cross-tenant       | a real tenant-B document → 404                                     |
| Audit              | `shared.document.linked` = 1                                       |
| Idempotency        | replayed key → one link row                                        |
| Outbox             | `document.link:{linkId}:linked` = 1                                |
| Denial             | an entity type outside `LINKABLE_ENTITY_TYPES` → 422 `ERR-VAL-001` |
| **Classification** | **operation depth**                                                |

### 5.6 `shared.attachment-link-withdraw`

|                    |                                                                                |
| ------------------ | ------------------------------------------------------------------------------ |
| Method · path      | `DELETE /attachments/links/{linkId}`                                           |
| Classification     | public API surface · **A**                                                     |
| Permission · scope | `shared.document.manage` · tenant                                              |
| Route invocation   | 200; **the row survives** and carries a withdrawal stamp (`deleted_at`)        |
| Service invocation | `AttachmentService.unlink`                                                     |
| Repository         | `DocumentRepository.findLink`, `withdrawLink` (only `deleted_at` is grantable) |
| Permission denial  | 403, and the link is still live afterwards                                     |
| Cross-tenant       | a real tenant-B link → refused, still live afterwards                          |
| Audit              | `shared.document.unlinked` = 1                                                 |
| Outbox             | `document.link:{linkId}:unlinked` = 1                                          |
| **Classification** | **operation depth**                                                            |

### 5.7 `shared.notification-enqueue`

|                    |                                                                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Method · path      | `POST /notifications`                                                                                                                                |
| Classification     | public API surface · **A**                                                                                                                           |
| Permission · scope | `shared.notification.send` · tenant                                                                                                                  |
| Route invocation   | 202 on first enqueue, 200 on a deduplicated repeat                                                                                                   |
| Service invocation | `SharedNotificationService.queueMessage` — the route deliberately calls the variant that does **not** return rendered content                        |
| Repository         | `NotificationRepository.enqueue`, `isTenantUser`; `TemplateRepository.findVersion`                                                                   |
| Provider fake      | `LocalMessageProvider` is installed and its call count is asserted **unchanged** — enqueue must not reach a provider inside the business transaction |
| Permission denial  | 403                                                                                                                                                  |
| Cross-tenant       | a template version approved by tenant B → 404                                                                                                        |
| Audit              | `shared.notification.enqueued` = 1                                                                                                                   |
| Idempotency        | the dedupe key deduplicates: second call returns the same message id, `deduplicated: true`, one outbox row                                           |
| Outbox             | `message.enqueued:{messageId}` = 1                                                                                                                   |
| Denial             | consent not granted → 409 `ERR-NTF-001`; `sms` → 422 `ERR-VAL-001` with the frozen interface unchanged                                               |
| **Classification** | **operation depth**                                                                                                                                  |

Also proved: **the response body carries neither the rendered content nor the recipient** — its
keys are exactly `messageId` and `deduplicated`.

### 5.8 `shared.template-create`

|                    |                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Method · path      | `POST /message-templates`                                                                                                 |
| Classification     | public API surface · **A**                                                                                                |
| Permission · scope | `org.settings.manage` · tenant                                                                                            |
| Route invocation   | 201 with `{templateId}`; the row is tenant-scoped                                                                         |
| Service invocation | `TemplateService.createTemplate`                                                                                          |
| Repository         | `TemplateRepository.insertTemplate`                                                                                       |
| Permission denial  | 403                                                                                                                       |
| Cross-tenant       | both tenants may own the **same template code** without colliding — the identity is per tenant, proved with two real rows |
| Audit              | `shared.template.created` = 1                                                                                             |
| Idempotency        | replayed key → one template                                                                                               |
| Denial             | a duplicate identity inside one tenant is refused 4xx                                                                     |
| **Classification** | **operation depth**                                                                                                       |

### 5.9 `shared.template-update`

|                    |                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------- |
| Method · path      | `PATCH /message-templates/{templateId}`                                            |
| Classification     | public API surface · **A**                                                         |
| Permission · scope | `org.settings.manage` · tenant                                                     |
| Route invocation   | 200 with `ETag: "2"`; the new name is read back from the database                  |
| Service invocation | `TemplateService.updateTemplate`                                                   |
| Permission denial  | 403                                                                                |
| Cross-tenant       | a tenant-B template → 404                                                          |
| Audit              | `shared.template.updated` = 1                                                      |
| Stale version      | `If-Match: "99"` → 409 `ERR-CON-001`; **no `If-Match` at all → 428 `ERR-CON-002`** |
| **Classification** | **operation depth**                                                                |

### 5.10 `shared.template-version-create`

|                    |                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| Method · path      | `POST /message-templates/{templateId}/versions`                                                  |
| Classification     | public API surface · **A**                                                                       |
| Permission · scope | `org.settings.manage` · tenant                                                                   |
| Route invocation   | 201; **`status: 'draft'` whatever the caller asks for**; `variables: ['name']`                   |
| Service invocation | `TemplateService.createVersion`                                                                  |
| Permission denial  | 403                                                                                              |
| Cross-tenant       | a tenant-B template → 404                                                                        |
| Audit              | `shared.template.version_created` = 1                                                            |
| Idempotency        | replayed key → one version                                                                       |
| Outbox             | `template.change:{templateId}:version_created:1` = 1                                             |
| Denial             | content that could not be rendered within the configured ceiling → 422, and **no row is stored** |
| **Classification** | **operation depth**                                                                              |

### 5.11 `shared.template-version-revise`

|                    |                                                                                  |
| ------------------ | -------------------------------------------------------------------------------- |
| Method · path      | `PATCH /template-versions/{versionId}`                                           |
| Classification     | public API surface · **A**                                                       |
| Permission · scope | `org.settings.manage` · tenant                                                   |
| Route invocation   | 200 with a bumped ETag; the revised body is read back                            |
| Service invocation | `TemplateService.reviseDraft`                                                    |
| Permission denial  | 403                                                                              |
| Cross-tenant       | a tenant-B draft → 404                                                           |
| Audit              | `shared.template.version_created` = 2 (creation, then revision)                  |
| Stale version      | wrong `If-Match` → 409 `ERR-CON-001`                                             |
| Denial             | revising **approved** content → 409 `ERR-TRN-001`; approved content is immutable |
| **Classification** | **operation depth**                                                              |

### 5.12 `shared.template-version-approve`

|                    |                                                                   |
| ------------------ | ----------------------------------------------------------------- |
| Method · path      | `POST /template-versions/{versionId}/approval`                    |
| Classification     | public API surface · **A**                                        |
| Permission · scope | `org.settings.manage` · tenant                                    |
| Route invocation   | 200, `status: 'approved'`                                         |
| Service invocation | `TemplateService.approveVersion`                                  |
| Permission denial  | 403                                                               |
| Cross-tenant       | a tenant-B draft → 404                                            |
| Audit              | `shared.template.version_approved` = 1                            |
| Stale version      | wrong `If-Match` → 409                                            |
| Outbox             | `template.change:{templateId}:version_approved:1` = 1             |
| Denial             | approving a version that is no longer a draft → 409 `ERR-TRN-001` |
| **Classification** | **operation depth**                                               |

Also proved: **`approved_by` is the resolved session principal**, read back from the database and
compared to the fixture user id. It is never a request field.

### 5.13 `shared.template-version-retire`

|                    |                                                                     |
| ------------------ | ------------------------------------------------------------------- |
| Method · path      | `POST /template-versions/{versionId}/retirement`                    |
| Classification     | public API surface · **A**                                          |
| Permission · scope | `org.settings.manage` · tenant                                      |
| Route invocation   | 200, `status: 'retired'`                                            |
| Service invocation | `TemplateService.retireVersion`                                     |
| Permission denial  | 403                                                                 |
| Cross-tenant       | a tenant-B approved version → 404                                   |
| Audit              | `shared.template.version_retired` = 1                               |
| Stale version      | wrong `If-Match` → 409                                              |
| Outbox             | `template.change:{templateId}:version_retired:1` = 1                |
| Denial             | retiring the version a template still points at → 409 `ERR-TRN-001` |
| **Classification** | **operation depth**                                                 |

### 5.14 `shared.template-activation-set`

|                    |                                                           |
| ------------------ | --------------------------------------------------------- |
| Method · path      | `PUT /message-templates/{templateId}/active-version`      |
| Classification     | public API surface · **A**                                |
| Permission · scope | `org.settings.manage` · tenant                            |
| Route invocation   | 200 with `ETag: "2"`; `active_version_id` read back       |
| Service invocation | `TemplateService.setActiveVersion`                        |
| Permission denial  | 403                                                       |
| Cross-tenant       | a tenant-B template → 404                                 |
| Audit              | `shared.template.updated` = 1                             |
| Stale version      | wrong `If-Match` → 409                                    |
| Denial             | activating a version that is still a draft is refused 4xx |
| **Classification** | **operation depth**                                       |

### 5.15 `shared.template-version-preview`

|                    |                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Method · path      | `POST /template-versions/{versionId}/preview`                                                                               |
| Classification     | public API surface · **A**                                                                                                  |
| Permission · scope | `org.settings.manage` · tenant                                                                                              |
| Route invocation   | 200 with the rendered subject and body                                                                                      |
| Service invocation | `TemplateService.previewVersion`                                                                                            |
| Provider           | **none is called** — the message provider's call count is asserted unchanged, and no `shared.outbound_messages` row appears |
| Permission denial  | 403                                                                                                                         |
| Cross-tenant       | a tenant-B version → 404                                                                                                    |
| Audit              | none — `auditClass: 'none'`, so the gate derives no audit obligation                                                        |
| Denial             | a missing variable → 422 `ERR-VAL-001`; **a placeholder named after an `Object.prototype` member → 422, not 500**           |
| **Classification** | **operation depth**                                                                                                         |

The prototype case is the regression lock for the second defect this phase found.

### 5.16 `shared.branch-status-read`

|                          |                                                                                                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Method · path            | `GET /organization/branches/{branchId}/status`                                                                                                                                                        |
| Classification           | public API surface · **A**                                                                                                                                                                            |
| Permission · scope       | `org.branch.read` · **branch**                                                                                                                                                                        |
| Route invocation         | 200 with `{state, recordVersion, nextStates}` and an `ETag` equal to the record version                                                                                                               |
| Service invocation       | `StatusTransitionService.describe`                                                                                                                                                                    |
| Repository               | `BranchTransitionAdapter.load`                                                                                                                                                                        |
| Permission denial        | 403 with `requiredPermissions` = `['org.branch.read']`                                                                                                                                                |
| Cross-tenant             | a real tenant-B branch → refused                                                                                                                                                                      |
| Company/branch isolation | a caller whose **grant is narrowed to one branch** reads that branch (200) and is refused the sibling branch (403 `ERR-IAM-001`) — the scope comes from the database grant, not from the test context |
| **Classification**       | **operation depth**                                                                                                                                                                                   |

### 5.17 `shared.branch-status-change`

|                          |                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| Method · path            | `POST /organization/branches/{branchId}/status`                                                         |
| Classification           | public API surface · **A**                                                                              |
| Permission · scope       | `org.settings.manage` · **branch**                                                                      |
| Route invocation         | 200 with `{from, to, recordVersion, nextStates}`                                                        |
| Service invocation       | `StatusTransitionService.apply`                                                                         |
| Repository               | `BranchTransitionAdapter.applyState`, `recordHistory`                                                   |
| Permission denial        | 403, and the branch status is unchanged                                                                 |
| Cross-tenant             | a tenant-B branch → refused, still `active` afterwards                                                  |
| Company/branch isolation | the branch-scoped caller is refused out of scope, and neither branch moves                              |
| Audit                    | `org.branch.status_changed` = 1                                                                         |
| Stale version            | `If-Match: "99"` → 409 `ERR-CON-001`, status unchanged                                                  |
| Outbox                   | `org.branch:{branchId}:{newVersion}` = 1                                                                |
| Denial                   | repeating a transition already made → 409 `ERR-TRN-001`; an over-long reason → 422 with no state change |
| **Classification**       | **operation depth**                                                                                     |

Also proved: the **module-owned history row** (`org.branch_status_history`) is written with the
new state in the same transaction as the state change.

### 5.18 `shared.export-authorize`

|                    |                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| Method · path      | `POST /exports/authorizations`                                                                            |
| Classification     | public API surface · **A**                                                                                |
| Permission · scope | `rpt.export` · tenant                                                                                     |
| Route invocation   | 200 with `generated: false` — **P1-15 produces no export file**                                           |
| Service invocation | `ExportAuthorizationService.authorize`                                                                    |
| Repository         | `ExportRepository`                                                                                        |
| Permission denial  | 403, and **no audit record is written**                                                                   |
| Cross-tenant       | n/a — no caller-supplied resource identifier; the tenant comes from the resolved context                  |
| Audit              | an export-class record is written; the count increases by exactly one                                     |
| Denial             | an unregistered resource → 422; a filter on a non-filterable free-text field → 422; an empty reason → 422 |
| **Classification** | **operation depth**                                                                                       |

### 5.19 `shared.export-catalogue`

|                    |                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| Method · path      | `GET /exports/resources`                                                                             |
| Classification     | public API surface · **A**                                                                           |
| Permission · scope | `rpt.export` · tenant                                                                                |
| Route invocation   | 200 listing exactly `branches`, `documents`, `outbound_messages`; `Cache-Control: no-store, private` |
| Service invocation | `ExportAuthorizationService.catalogue`                                                               |
| Permission denial  | 403                                                                                                  |
| Audit              | none — `auditClass: 'none'`                                                                          |
| **Classification** | **operation depth**                                                                                  |

### 5.20 `shared.health-live`

|                    |                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| Method · path      | `GET /health/live`                                                                                     |
| Classification     | public API surface · **U** (`public: true`)                                                            |
| Permission · scope | none · tenant (unused)                                                                                 |
| Route invocation   | 200 with **exactly** `{status, uptimeSeconds}`                                                         |
| Service invocation | `HealthService.liveness`                                                                               |
| Unauthenticated    | invoked with the authenticator **reset**, so the route genuinely answers with no session               |
| Declaration        | `public: true` with a non-empty `publicReason`; `auditClass: 'none'`; `permissions: []` — all asserted |
| Leakage            | the serialized body contains no database name, role, host or port                                      |
| **Classification** | **operation depth**                                                                                    |

### 5.21 `shared.health-ready`

|                    |                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Method · path      | `GET /health/ready`                                                                                                           |
| Classification     | public API surface · **U** (`public: true`)                                                                                   |
| Permission · scope | none · tenant (unused)                                                                                                        |
| Route invocation   | 200 or 503; `status` in `{ready, degraded, unavailable}`; `Cache-Control: no-store, private`                                  |
| Service invocation | `HealthService.readiness` (bounded probe)                                                                                     |
| Unauthenticated    | invoked with the authenticator **reset**                                                                                      |
| Declaration        | `public: true` with a non-empty `publicReason`; `auditClass: 'none'`; `permissions: []`                                       |
| Leakage            | every check entry has **exactly** the keys `name` and `ok`; the body contains no role, host, port, driver message or password |
| **Classification** | **operation depth**                                                                                                           |

The 503 path with an unreachable database, and the absence of any driver message on it, is
additionally proved in `tests/backend/p1-15-dispatch-and-health.test.ts`.

---

## 6. `/api/health` is untouched

The Phase 1-13 endpoint `GET /api/health` is not modified, not moved, not wrapped, and not
re-registered. The two P1-15 probes are new paths under `/api/v1/health/`. This is asserted in
`tests/foundation/p1-15-health.test.ts` by reading the existing route's source rather than by
importing it, so the assertion cannot itself perturb the module it is checking.

## 7. What is deliberately absent, and why it is not a coverage gap

- **Document acceptance.** `guard_document_version_transition` accepts a version only against a
  `clean` row in `shared.file_scan_results`, and **no application role may write that table**.
  No malware scanner exists, none is implemented, and none is claimed. No production code path
  produces a scan verdict. The download route therefore refuses a non-accepted version with
  `ERR-DOC-001`, which is the correct behaviour for a platform with no scanner.
- **`shared.status_history` / `shared.status_evidence`** stay unwritable by every application
  role. The branch transition engine writes the module-owned `org.branch_status_history`.
- **Search projection for the request runtime** and **export file generation** are out of scope.
- **`sms` / `whatsapp`** are refused with a stable code; the frozen `NotificationService`
  interface is unchanged.

None of these is an operation, so none of them is an uncovered operation.

## 8. How to reproduce every number in this document

```bash
node scripts/check-operation-test-coverage.mjs
```

```bash
npx vitest run --config vitest.config.backend.ts tests/backend/p1-15-operation-routes.test.ts
```

```bash
npx vitest run tests/foundation/operation-coverage-gate.test.ts
```

The first prints the P1-15 breakdown in §2 and rewrites
[`evidence/operation-test-matrix.json`](evidence/operation-test-matrix.json). The second runs the
101 route-level assertions this document describes. The third proves the gate fails, one
category at a time, when any of them is missing.

The Phase 1-15 owner gate remains **Pending**.
