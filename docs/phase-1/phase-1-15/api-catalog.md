# Phase 1-15 — API Catalogue

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Release group:** Release 3 — Backend Foundation ·
**Phase:** P1-15 — Shared Services Backend ·
**Date:** 2026-07-23 ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent third-party audit.**

> The [owner gate](phase-1-15-owner-gate.md) for this phase is **Pending**. Nothing in this
> catalogue is a gate decision, and the presence of an operation here is a statement that it is
> registered and routed — not that its evidence obligation is discharged. See
> [§6](#6-what-the-coverage-gate-currently-reports).

---

## 1. How to read this catalogue

Every row below is transcribed from a `defineOperation({...})` literal in a Route Handler under
[`src/app/api/v1`](../../../src/app/api/v1), and reconciled against the two checkers that read the
same registry at run time. No value here is a design intention: if a column says `idempotent`, the
literal says `idempotent: true`, and `defineOperation()` would have thrown at module load had the
declaration been internally inconsistent.

Totals, from commands run against this working tree on 2026-07-23:

| Command                                                                                        | Result                                                        |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [`npm run validate:authorization-coverage`](../../../scripts/check-authorization-coverage.mjs) | `60 registered operation(s), 49 API route file(s)` — exit `0` |
| [`npm run validate:openapi`](../../../scripts/check-openapi.mjs)                               | `OpenAPI: 3.1.0, 49 path(s), 60 operation(s)` — exit `0`      |

Of those 60 operations, **21 belong to `shared-services`** and are new in this phase; they occupy
**20 of the 49 paths** (`/organization/branches/{branchId}/status` carries both a `GET` and a
`POST`). The other 39 — 38 `iam.*` plus the `meta.ping` reference endpoint — were delivered by
Phase 1-13 and Phase 1-14 and are unchanged here.

**Path prefix.** The `path` column holds the value as declared in the registry. Every operation is
served under `/api/v1`, so `/notifications` is reachable at `/api/v1/notifications`.

**Columns.**

- **Scope** — the declared authorization scope (`tenant` or `branch`). It is the scope the operation
  requires, not a claim about how a caller obtained it.
- **Audit** — `auditClass` and, where the class is not `none`, the `auditAction` code. Every action
  code is registered in [`src/server/auth/audit-actions.ts`](../../../src/server/auth/audit-actions.ts);
  `defineOperation()` refuses an action that is absent from that catalogue or whose registered class
  disagrees with the declaration.
- **Idem** — `idempotent: true`. The operation participates in the P1-13 idempotency-key mechanism.
- **Ver** — `versionGuarded: true`. The operation requires an `If-Match` record version and fails a
  stale one.
- **Rate limit** / **Cache** — the declared `rateLimitPolicy` and `cacheCategory` names, defined in
  [`src/server/http/rate-limit.ts`](../../../src/server/http/rate-limit.ts) and
  [`src/server/cache/eligibility.ts`](../../../src/server/cache/eligibility.ts).

The three rate-limit policies used by this phase, as declared in the source:

| Policy              | Limit / window    | Key dimensions          | Used for                                                            |
| ------------------- | ----------------- | ----------------------- | ------------------------------------------------------------------- |
| `standard-command`  | 120 per 60 000 ms | operation, tenant, user | Every P1-15 write, and the template preview                         |
| `expensive-read`    | 30 per 60 000 ms  | operation, tenant, user | Export authorization only                                           |
| `low-risk-metadata` | 600 per 60 000 ms | operation, tenant       | The two health probes, the export catalogue, the branch-status read |

**Every P1-15 operation declares `cacheCategory: 'never'`.** That is not caution for its own sake:
`CACHE_CATEGORIES.never` has `allowed: false`, so `assertCacheable()` throws if anything later tries
to cache one of these responses. Commands are not reads, and idempotent replay is served from
`shared.idempotency_keys` — a durable, tenant-scoped, audited record — rather than from a cache. The
reads this phase adds are either a probe (whose whole value is freshness) or a per-caller projection
of a permission set, which is exactly the thing the caching standard forbids caching.

---

## 2. Attachments

Six operations implementing the pre-acceptance half of the document lifecycle. All six require
`shared.document.manage`, a permission code introduced by
[DBCR-P1-15-001](../../database/change-requests/DBCR-P1-15-001-shared-services-runtime-write-capabilities.md)
and gated by the same RLS policies the operation-level check names, so the two layers agree by
construction. They are implemented by
[`AttachmentService`](../../../src/modules/shared-services/application/attachment-service.ts).

| Operation id                           | Method · path                                                      | Permissions              | Scope  | Audit                                               | Idem | Ver | Rate limit         | Cache   | What it does                                                                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------ | ------------------------ | ------ | --------------------------------------------------- | ---- | --- | ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared.attachment-upload-authorize`   | `POST /attachments/upload-authorizations`                          | `shared.document.manage` | tenant | `security` · `shared.document.upload_authorized`    | ✓    | —   | `standard-command` | `never` | Creates the `shared.documents` row, builds the storage key server-side, and returns an opaque upload token plus a short-lived signed `PUT` URL bound to method, key, expiry and content. Returns `201`. |
| `shared.attachment-version-register`   | `POST /attachments/versions`                                       | `shared.document.manage` | tenant | `privileged` · `shared.document.version_registered` | ✓    | —   | `standard-command` | `never` | Turns an uploaded object into a **`pending`** document version after re-deriving the key from the token rather than trusting it, and publishes `document.version.registered`.                           |
| `shared.attachment-version-reject`     | `POST /attachments/versions/{versionId}/rejection`                 | `shared.document.manage` | tenant | `privileged` · `shared.document.version_rejected`   | —    | —   | `standard-command` | `never` | Moves a pending version to `rejected` — the only version transition the request role holds an UPDATE grant for. The state is terminal.                                                                  |
| `shared.attachment-download-authorize` | `POST /attachments/documents/{documentId}/download-authorizations` | `shared.document.manage` | tenant | `security` · `shared.document.download_authorized`  | —    | —   | `standard-command` | `never` | Issues a short-lived signed `GET` URL for a version in a downloadable state. A version that is not accepted is refused with `ERR-DOC-001`.                                                              |
| `shared.attachment-link-create`        | `POST /attachments/documents/{documentId}/links`                   | `shared.document.manage` | tenant | `privileged` · `shared.document.linked`             | ✓    | —   | `standard-command` | `never` | Links a document to an allow-listed business entity, which is what makes it reachable from that entity. Publishes `document.link.changed`.                                                              |
| `shared.attachment-link-withdraw`      | `DELETE /attachments/links/{linkId}`                               | `shared.document.manage` | tenant | `privileged` · `shared.document.unlinked`           | —    | —   | `standard-command` | `never` | Withdraws a link by stamping `deleted_at`. The row survives, because the fact that an attachment was once reachable is itself evidence.                                                                 |

Two absences are deliberate and are recorded rather than implied:

- **There is no acceptance operation.** `shared.guard_document_version_transition()` admits a version
  to `accepted` only when a `clean` row exists in `shared.file_scan_results`, and **no application
  role may write that table**. **No malware scanner is configured in this phase and none is
  claimed.** Acceptance is an explicit follow-on, not an oversight.
- **There is no document update or delete operation.** The request runtime holds no `UPDATE` grant at
  all on `shared.documents`, so renaming, re-classification and archival are outside reach. Shipping
  an endpoint that could only ever fail would be worse than not shipping one.

## 3. Notifications

| Operation id                  | Method · path         | Permissions                | Scope  | Audit                                         | Idem | Ver | Rate limit         | Cache   | What it does                                                                                                                                                                                                                      |
| ----------------------------- | --------------------- | -------------------------- | ------ | --------------------------------------------- | ---- | --- | ------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared.notification-enqueue` | `POST /notifications` | `shared.notification.send` | tenant | `privileged` · `shared.notification.enqueued` | ✓    | —   | `standard-command` | `never` | Renders an approved template version, stores only its SHA-256 digest, and writes one `pending` `shared.outbound_messages` row. Publishes `message.enqueued`. Returns `202`, or `200` when the dedupe key matched an existing row. |

The handler calls `queueMessage`, not `queueMessageWithRendering`, so the rendered content never
crosses the HTTP boundary. **No provider call happens inside the request transaction** — delivery is
the worker's job, on a different database role, and there is no HTTP operation for it. The frozen
P1-13 `NotificationChannel` type admits `sms` and `whatsapp`; the database CHECK constraints admit
only `email` and `in_app`, so those two channels are accepted by the type and refused by policy with
a stable code. **No SMS or WhatsApp delivery exists.**

## 4. Message templates

Seven operations, all requiring `org.settings.manage` — the same permission the relevant RLS
`WITH CHECK` clauses require, reused rather than invented because template content _is_
organization configuration. Implemented by
[`TemplateService`](../../../src/modules/shared-services/application/template-service.ts).

| Operation id                      | Method · path                                        | Permissions           | Scope  | Audit                                            | Idem | Ver | Rate limit         | Cache   | What it does                                                                                                                                |
| --------------------------------- | ---------------------------------------------------- | --------------------- | ------ | ------------------------------------------------ | ---- | --- | ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared.template-create`          | `POST /message-templates`                            | `org.settings.manage` | tenant | `privileged` · `shared.template.created`         | ✓    | —   | `standard-command` | `never` | Creates a tenant-scoped template. A platform-scoped template cannot be created from here, and the service refuses before the database does. |
| `shared.template-update`          | `PATCH /message-templates/{templateId}`              | `org.settings.manage` | tenant | `privileged` · `shared.template.updated`         | —    | ✓   | `standard-command` | `never` | Renames, re-describes or disables a template within the grantable column set, under `If-Match`.                                             |
| `shared.template-version-create`  | `POST /message-templates/{templateId}/versions`      | `org.settings.manage` | tenant | `privileged` · `shared.template.version_created` | ✓    | —   | `standard-command` | `never` | Creates the next version of a template. A version is always born a draft.                                                                   |
| `shared.template-version-revise`  | `PATCH /template-versions/{versionId}`               | `org.settings.manage` | tenant | `privileged` · `shared.template.version_created` | —    | ✓   | `standard-command` | `never` | Revises the content of a **draft** version and recomputes its content hash. Approved content is immutable.                                  |
| `shared.template-version-approve` | `POST /template-versions/{versionId}/approval`       | `org.settings.manage` | tenant | `approval` · `shared.template.version_approved`  | —    | ✓   | `standard-command` | `never` | Approves a draft. The approver is taken from the session, never from the body, and approved content can no longer be revised.               |
| `shared.template-version-retire`  | `POST /template-versions/{versionId}/retirement`     | `org.settings.manage` | tenant | `privileged` · `shared.template.version_retired` | —    | ✓   | `standard-command` | `never` | Retires an approved version.                                                                                                                |
| `shared.template-activation-set`  | `PUT /message-templates/{templateId}/active-version` | `org.settings.manage` | tenant | `privileged` · `shared.template.updated`         | —    | ✓   | `standard-command` | `never` | Sets or clears the template's active version. Only an approved version may become active.                                                   |
| `shared.template-version-preview` | `POST /template-versions/{versionId}/preview`        | `org.settings.manage` | tenant | `none`                                           | —    | —   | `standard-command` | `never` | Renders a version with caller-supplied sample values and returns the result. Sends nothing, writes nothing, enqueues nothing.               |

`shared.template-version-revise` shares the `shared.template.version_created` audit action with
`shared.template-version-create`, and `shared.template-activation-set` shares
`shared.template.updated` with `shared.template-update`. That is intentional: an audit action names
the _fact recorded about an entity_, and a draft's content changing is the same fact whether the
draft was just made or edited a minute later. The operation id is what distinguishes the two, and it
is on the record already.

The preview is deliberately unaudited. It is a pure render of content the caller is already
authorized to read, with values the caller supplied, and it produces no durable effect; recording it
would add volume to the audit trail without adding a fact anyone can act on. It is still rate
limited under `standard-command`, because rendering is work.

## 5. Transitions, exports, and health

| Operation id                  | Method · path                                   | Permissions           | Scope  | Audit                                      | Idem | Ver | Rate limit          | Cache   | What it does                                                                                                                                                                                                 |
| ----------------------------- | ----------------------------------------------- | --------------------- | ------ | ------------------------------------------ | ---- | --- | ------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `shared.branch-status-read`   | `GET /organization/branches/{branchId}/status`  | `org.branch.read`     | branch | `none`                                     | —    | —   | `low-risk-metadata` | `never` | Reports a branch's current state and the states reachable from it, computed from the transition graph registered in code.                                                                                    |
| `shared.branch-status-change` | `POST /organization/branches/{branchId}/status` | `org.settings.manage` | branch | `privileged` · `org.branch.status_changed` | —    | ✓   | `standard-command`  | `never` | Activates or deactivates a branch through the transition engine: state move, module-owned history row, audit record and one outbox event, all in one transaction.                                            |
| `shared.export-authorize`     | `POST /exports/authorizations`                  | `rpt.export`          | tenant | `export` · `shared.export.authorized`      | —    | —   | `expensive-read`    | `never` | Decides whether this caller may export this resource, with these fields, under these filters, at this estimated size — and records the decision. **Produces no file**; the response says `generated: false`. |
| `shared.export-catalogue`     | `GET /exports/resources`                        | `rpt.export`          | tenant | `none`                                     | —    | —   | `low-risk-metadata` | `never` | Lists the three registered export resources (`documents`, `outbound_messages`, `branches`) and the fields this caller may emit from each.                                                                    |
| `shared.health-live`          | `GET /health/live`                              | _(public)_            | tenant | `none`                                     | —    | —   | `low-risk-metadata` | `never` | Returns exactly `status` and `uptimeSeconds`, synchronously. No database, no provider, no configuration read.                                                                                                |
| `shared.health-ready`         | `GET /health/ready`                             | _(public)_            | tenant | `none`                                     | —    | —   | `low-risk-metadata` | `never` | Bounded readiness probe projecting **check names and booleans only** — no role, host, bucket, database name, or driver message.                                                                              |

Notes on these six:

- **`shared.branch-status-change` is version guarded and `shared.branch-status-read` is not**, which
  is the whole point of splitting them: the read is what a client uses to discover the legal next
  states and the current `record_version`, and the write refuses a stale one. A repeat of a
  transition already applied is `ERR-TRN-001`, not a silent success — distinct from `ERR-CON-001`,
  because re-reading and retrying fixes a version conflict and cannot fix this.
- **`shared.export-authorize` carries the `export` audit class**, which is the class the audit
  standard reserves for disclosure. It reads the caller's permission set inside the same transaction
  as the row estimate and the audit record, so an authorization cannot be granted against a
  permission revoked an instant earlier. It remains a decision about _now_: the response carries an
  expiry, and a future generator must re-check at use time.
- **Both health operations declare `public: true` with a recorded `publicReason`.** For
  `shared.health-live` that reason is that an orchestrator calls it before any credential exists and
  it performs no I/O; for `shared.health-ready`, that a load balancer and an orchestrator call it
  without a session and the response carries check names and booleans only. Both still declare
  `scope: 'tenant'` in the registry. **No load balancer, orchestrator, monitoring system, or alert
  route is provisioned by this phase** — these are endpoints that would answer such a caller
  correctly, nothing more.

## 6. What the coverage gate reports

[`npm run validate:operation-coverage`](../../../scripts/check-operation-test-coverage.mjs) reconciles
every registered operation against the test files the manifest names for it, and — for the P1-15
`shared.` surface — against the obligations **derived from each operation's own
`defineOperation({...})` registration**. It exits `0`:

```text
Operation-to-test coverage (STRICT): 60 registered operation(s)
  public API surface: 60 · internal: 0
  with required evidence: 45 · invocation-only (read/catalogue): 15

P1-15 registered public operations: 21
P1-15 operation-depth: 21
P1-15 invocation-only: 0
P1-15 pending: 0
P1-15 unit-only: 0
P1-15 unreferenced: 0
P1-15 metadata-only: 0
```

**Every one of the 21 P1-15 operations carries operation-depth evidence**: its exported route handler
is invoked with a real `Request` and its `Response` asserted, its wired service runs on the deployed
`app_runtime` identity under RLS, and a caller lacking the declared permission is refused — plus
every obligation the registration creates (a `{param}` in the path implies cross-tenant, `idempotent`
implies idempotency, `versionGuarded` implies stale-version, an audit class implies audit, branch
scope implies isolation).

The per-operation record, with the file and the property proved for each, is
[`operation-inventory.md`](operation-inventory.md); the machine-readable form is
[`evidence/operation-test-matrix.json`](evidence/operation-test-matrix.json).

The 15 invocation-only operations are all P1-14 `iam.` read and catalogue endpoints plus
`meta.ping`. P1-14's evidence model is the one it was gated with and is not re-interpreted here.

The two structural checkers establish something narrower, and it is still worth stating precisely:
every operation is registered, guarded by declared permissions or an explicit public reason, matched
to a route file, and present in [the OpenAPI document](../../api/openapi.v1.json).

## 7. Planned operations that were deliberately not implemented

### 7.1 `POST /api/v1/numbers:allocate` — number allocation as an endpoint

**Not implemented, for two independent reasons, either of which would be sufficient.**

The first is mechanical: the operation registry's `PATH_PATTERN` is
`/^(?:\/(?:[a-z0-9-]+|\{[a-z][a-zA-Z0-9]*\}))+$/`, which admits a lower-case literal or a
`{camelCase}` parameter per segment and **rejects a colon outright**. `defineOperation()` would throw
at module load.

The second is the one that would still apply if the grammar were widened.
[The Number Sequence and Display Number Standard](../../database/number-sequence-standard.md) binds
allocation to _the same transaction as the business write that consumes the number_ (rule 5). A
standalone endpoint commits a counter advance that no business row consumes, so every call that is
not followed by a successful write leaves a permanent gap — in a sequence whose entire purpose is to
be gapless on issued documents, and while _appearing_ to promise gaplessness. `shared.next_display_number`
also takes no tenant parameter; the tenant comes only from `iam.current_tenant_id()`, so there is
nothing for an HTTP caller to usefully supply beyond the sequence code.

**Delivered instead:** an in-process application service,
[`NumberAllocationService.allocate(db, input)`](../../../src/modules/shared-services/application/number-allocation-service.ts),
which takes the caller's already-open `DbHandle`. Rollback takes the allocation with it, because the
counter advance and the business insert are the same transaction. The gapless guarantee is claimed
only where it holds: for committed allocations. `isProvisioned()` lets a module fail early rather
than discover a missing sequence after expensive work.

### 7.2 The colon-verb paths generally

The phase directive proposed the planning labels `POST /api/v1/numbers:allocate` and
`POST /api/v1/attachments:authorize-upload`. **No colon-verb path exists anywhere in this codebase**,
and none was added. The established convention — visible across the whole P1-14 surface in
`/auth/password-reset/completion`, `/iam/invitations/{userId}/activation` and
`/iam/users/{userId}/status` — is that an action becomes a **noun sub-resource**. P1-15 follows it:

| Planning label                              | Registered path                                                    |
| ------------------------------------------- | ------------------------------------------------------------------ |
| `POST /api/v1/attachments:authorize-upload` | `POST /attachments/upload-authorizations`                          |
| _(download equivalent)_                     | `POST /attachments/documents/{documentId}/download-authorizations` |
| _(version rejection)_                       | `POST /attachments/versions/{versionId}/rejection`                 |
| _(template approval)_                       | `POST /template-versions/{versionId}/approval`                     |
| _(template retirement)_                     | `POST /template-versions/{versionId}/retirement`                   |
| _(export authorization)_                    | `POST /exports/authorizations`                                     |

The planning labels are treated as intent, not as literal paths. An authorization is a resource
worth naming, and naming it makes the audit trail and the OpenAPI document read the same way.

### 7.3 Other capability with no HTTP operation, by design

| Capability                 | Why there is no endpoint                                                                                                                                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document **acceptance**    | Requires a `clean` row in `shared.file_scan_results`, which no application role may write. **No scanner is configured and none is claimed.**                                                                                             |
| Export **file generation** | Needs an object store to write to (none provisioned), a retention decision for the artefact (none approved), and a delivery channel (none exists). The decision ships; the generator does not.                                           |
| Message **dispatch**       | Runs on the `app_worker` archetype, which is the only role granted `shared.delivery_attempts` and the `outbound_messages` lifecycle UPDATE. A request **cannot** claim a message was sent, and that separation is the security property. |
| Generic **status history** | `shared.status_history` and `shared.status_evidence` are unwritable by every application role, deliberately. There is no generic writable workflow store and no client-defined transition graph.                                         |
| Search **projection**      | Assigned to `app_worker` only. The request runtime holds no write on `shared.search_metadata`.                                                                                                                                           |

### 7.4 `GET /api/health` is unchanged

The Phase 1-1 route at [`src/app/api/health/route.ts`](../../../src/app/api/health/route.ts) is
asserted by [`tests/health.test.ts`](../../../tests/health.test.ts) to return exactly seven keys, and
is the container healthcheck in `docker-compose.yml` under `curl -fsS`, which fails on any non-2xx.
Changing its shape would break a probe to gain nothing. P1-15 adds its probes at **new** versioned
paths and leaves that route byte-identical.
