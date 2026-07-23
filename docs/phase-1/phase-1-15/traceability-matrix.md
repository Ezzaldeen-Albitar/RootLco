# Phase 1-15 — Traceability Matrix

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

> The [owner gate](phase-1-15-owner-gate.md) for this phase is **Pending**. This matrix records what
> exists and what is proven; it records no decision, and no row here closes a gate condition.

---

## 1. The status vocabulary, and why it has four values rather than two

A matrix whose only statuses are PASS and FAIL forces a lie in the middle of a phase, because most
rows are neither. These four are used, and nothing is rounded up:

| Status                           | Meaning                                                                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Proven**                       | The capability is implemented and a named test that ran demonstrates it at the depth the capability needs.                                                    |
| **Implemented — unit-tier only** | The capability is implemented and its pure rules are demonstrated, but no test exercises it through a route with context, RLS, transaction, audit and outbox. |
| **Implemented — unproven**       | The capability is implemented and no test in this tree exercises it at any depth.                                                                             |
| **Withheld**                     | Deliberately not delivered. The row records why, so nobody reads the absence as an omission.                                                                  |

"Proven" is used for exactly three things in this phase: the database capability boundary, the
normalization mirrors, and the pure-domain rules that have no other depth to be proven at. Everything
that reaches an HTTP route is **Implemented — unit-tier only** or **unproven**, because
`npm run validate:operation-coverage` currently exits `1` and the three backend suites it names do
not exist. See [the test catalogue](test-catalog.md#43-operation-coverage-gate).

---

## 2. Capability → implementation → evidence

### 2.1 Number allocation

| Aspect            | Value                                                                                                                                                                                                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementation    | [`application/number-allocation-service.ts`](../../../src/modules/shared-services/application/number-allocation-service.ts) · [`data/number-sequence-repository.ts`](../../../src/modules/shared-services/data/number-sequence-repository.ts) · [`domain/sequence-registry.ts`](../../../src/modules/shared-services/domain/sequence-registry.ts) |
| Evidence          | [`tests/foundation/p1-15-catalogs.test.ts`](../../../tests/foundation/p1-15-catalogs.test.ts) — exact equality on the eight registered sequence codes (`appointment`, `business_partner`, `invoice`, `quotation`, `receipt`, `reception_visit`, `vehicle`, `work_order`)                                                                          |
| Catalogue entries | **None.** No operation, no audit action, no event. It is an in-process service, by decision — see [API catalogue §7.1](api-catalog.md#71-post-apiv1numbersallocate--number-allocation-as-an-endpoint). Metric `numbering.allocation.count` added.                                                                                                 |
| Status            | **Implemented — unit-tier only.** The registry is pinned; allocation against a live sequence under concurrency is not exercised by any P1-15 suite. Gate condition 7 stays "To be evidenced".                                                                                                                                                     |

The service maps the two SQLSTATEs `shared.next_display_number` raises on purpose — `no_data_found`
to `ERR-RES-001` (recognised sequence, not provisioned in this scope) and `insufficient_privilege` to
`ERR-IAM-001` — so a caller can act on the difference. Neither mapping is currently covered by a test.

### 2.2 Audit recording

| Aspect            | Value                                                                                                                                                                                                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Implementation    | Composes the frozen P1-13 `appendAudit`. P1-15 adds **15 action codes** to [`src/server/auth/audit-actions.ts`](../../../src/server/auth/audit-actions.ts): seven `shared.document.*`, one `shared.notification.enqueued`, five `shared.template.*`, one `shared.export.authorized`, and `org.branch.status_changed`.                            |
| Evidence          | [`tests/foundation/p1-15-catalogs.test.ts`](../../../tests/foundation/p1-15-catalogs.test.ts) — exact-inventory equality on the action catalogue, and a walk of the populated operation registry asserting every declared `auditAction` exists with the declared class                                                                           |
| Catalogue entries | 15 audit actions; each carries its `entityType` (`shared.document`, `shared.document_version`, `shared.document_link`, `shared.outbound_message`, `shared.message_template`, `shared.template_version`, `shared.export_request`, `org.branch`)                                                                                                   |
| Status            | **Implemented — unit-tier only.** That the catalogue is closed and consistent is proven. That a given operation actually writes exactly one audit record at run time is not — that is the `audit` obligation in the missing backend suites. **No second audit store exists**; there is one `appendAudit`, and identity is not a parameter to it. |

### 2.3 Status transitions

| Aspect            | Value                                                                                                                                                                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementation    | [`application/status-transition-service.ts`](../../../src/modules/shared-services/application/status-transition-service.ts) · [`domain/transitions.ts`](../../../src/modules/shared-services/domain/transitions.ts) · [`data/transition-repository.ts`](../../../src/modules/shared-services/data/transition-repository.ts) (`BranchTransitionAdapter`) |
| Evidence          | [`tests/foundation/p1-15-catalogs.test.ts`](../../../tests/foundation/p1-15-catalogs.test.ts) — the transition table is walked and its audit action and event name reconciled against their catalogues, which turns two plain strings into checked references                                                                                           |
| Catalogue entries | Operations `shared.branch-status-read`, `shared.branch-status-change`; audit action `org.branch.status_changed`; event `EVT-ORG-001` / `organization.branch.status.changed`; error `ERR-TRN-001`; metrics `transition.applied.count`, `transition.conflict.count`                                                                                       |
| Status            | **Implemented — unit-tier only.** The graph is registered **in code** — `org.branch`, `active → inactive` and `inactive → active`, and nothing else. There is no client-defined transition graph and no runtime extension point. That the six steps are atomic in one transaction is asserted by construction and not yet by a test.                    |

The engine drives **module-owned** history, not a generic store, because
[`shared.status_history`](#33-generic-status-history-and-status-evidence) is unwritable by every
application role. `EVT-ORG-001` is owned by `shared` although its aggregate is `org.branch`: the
catalogue's `owner` names the module permitted to publish, and no `org` module exists.

### 2.4 Attachment lifecycle

| Aspect            | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementation    | [`application/attachment-service.ts`](../../../src/modules/shared-services/application/attachment-service.ts) — the frozen P1-13 `FileService`, with the signed URL returned by an **additional** method rather than by changing a frozen signature · [`domain/attachment-policy.ts`](../../../src/modules/shared-services/domain/attachment-policy.ts) · [`data/document-repository.ts`](../../../src/modules/shared-services/data/document-repository.ts) |
| Evidence          | [`tests/db/p1-15-shared-services-runtime-capabilities.test.ts`](../../../tests/db/p1-15-shared-services-runtime-capabilities.test.ts) — document creation works, is gated, cannot cross a tenant, cannot forge authorship, is refused with no session; the request role holds no `UPDATE` on `shared.documents` and no `DELETE`; a version is born `pending`; `pending → rejected` is reachable                                                             |
| Catalogue entries | Six operations (see [API catalogue §2](api-catalog.md#2-attachments)); seven audit actions; events `EVT-DOC-002` `document.version.registered` and `EVT-DOC-003` `document.link.changed`; error `ERR-DOC-001`; metric `attachment.authorization.count`                                                                                                                                                                                                      |
| Status            | **Implemented — unit-tier only** at the operation layer; the **capability boundary underneath it is Proven** by the database suite. Gate condition 10 (no IDOR, no traversal, no key collision, no client-chosen key) is partially evidenced: the key rules are proven in the unit tier, the boundary in the database tier, and the route-level IDOR case is not yet exercised.                                                                             |

### 2.5 Storage keys and signed URLs

| Aspect            | Value                                                                                                                                                                                                                                                                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementation    | [`domain/storage-key.ts`](../../../src/modules/shared-services/domain/storage-key.ts) · [`provider/storage-provider.ts`](../../../src/modules/shared-services/provider/storage-provider.ts) (port + `UnconfiguredStorageProvider`) · [`provider/local-storage-provider.ts`](../../../src/modules/shared-services/provider/local-storage-provider.ts) |
| Evidence          | [`tests/foundation/p1-15-storage-key.test.ts`](../../../tests/foundation/p1-15-storage-key.test.ts) (31) · [`tests/foundation/p1-15-signed-urls.test.ts`](../../../tests/foundation/p1-15-signed-urls.test.ts) (24)                                                                                                                                  |
| Catalogue entries | Config keys `STORAGE_PROVIDER`, `STORAGE_BUCKET`, `STORAGE_UPLOAD_URL_TTL_SECONDS`, `STORAGE_DOWNLOAD_URL_TTL_SECONDS`, `STORAGE_MAX_UPLOAD_BYTES`; metrics `storage.signed_url.count`, `storage.signed_url.duration_ms`                                                                                                                             |
| Status            | **Proven** for what it is: a port, a deterministic local adapter, and an `unconfigured` default that refuses to sign. **No production object store is provisioned**, ADR-012 remains open, and no claim is made about any real provider's behaviour. The `.invalid` host is the point — a URL that escapes cannot resolve anywhere.                  |

### 2.6 Notification enqueue

| Aspect            | Value                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Implementation    | [`application/notification-service.ts`](../../../src/modules/shared-services/application/notification-service.ts) — the frozen P1-13 `NotificationService` · [`domain/notification-policy.ts`](../../../src/modules/shared-services/domain/notification-policy.ts) · [`data/notification-repository.ts`](../../../src/modules/shared-services/data/notification-repository.ts) |
| Evidence          | [`tests/foundation/p1-15-notification-policy.test.ts`](../../../tests/foundation/p1-15-notification-policy.test.ts) (34) · database suite — enqueue works for a permitted principal, is refused without `shared.notification.send`, and the request role can neither forge a delivered status nor write provider delivery evidence                                             |
| Catalogue entries | Operation `shared.notification-enqueue`; audit action `shared.notification.enqueued`; event `EVT-NTF-002` `message.enqueued`; error `ERR-NTF-001`; metrics `notification.enqueue.count`, `notification.delivery.count`, `notification.retry.count`, `notification.dead_letter.count`                                                                                           |
| Status            | **Implemented — unit-tier only** at the operation layer; the **delivery boundary is Proven** by the database suite. Enqueue-first is structural — there is no provider call in the source transaction — but the idempotency and outbox obligations are not yet exercised.                                                                                                      |

**Recorded residual risk, not tested away:** rendered content is transient. With no durable transient
content store, content lost from process memory cannot be reproduced by another process. The row
still proves the message was requested and carries its digest and lifecycle; cross-process
redelivery of content is **not implemented and not claimed**.

### 2.7 Message dispatch (worker archetype)

| Aspect            | Value                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementation    | [`application/message-dispatcher.ts`](../../../src/modules/shared-services/application/message-dispatcher.ts) · [`data/message-dispatch-repository.ts`](../../../src/modules/shared-services/data/message-dispatch-repository.ts) · [`provider/message-provider.ts`](../../../src/modules/shared-services/provider/message-provider.ts) (port, local adapter, `UnconfiguredMessageProvider`) |
| Evidence          | Database suite — the worker records a delivery attempt and advances the lifecycle; attempts are append-only (the worker holds no `UPDATE` or `DELETE`); the request role holds neither                                                                                                                                                                                                       |
| Catalogue entries | **No operation.** Dispatch is worker-only, deliberately. Config `NOTIFICATION_PROVIDER`, `NOTIFICATION_PROVIDER_TIMEOUT_MS`, `NOTIFICATION_MAX_RENDERED_CHARS`                                                                                                                                                                                                                               |
| Status            | **Implemented — unproven** at the application layer; the **role separation is Proven** by the database suite. `tests/backend/p1-15-dispatch-and-health.test.ts` is named by the coverage manifest and does not exist, so the digest check, the retry bound, and the dead-letter edge are untested. **No production message provider is provisioned**; the default refuses to deliver.        |

The dispatcher recomputes the rendered content's SHA-256 and compares it with the stored
`body_sha256` before contacting a provider, which is what makes that column load-bearing rather than
decorative. That behaviour is implemented and currently has no test.

### 2.8 Message templates and rendering

| Aspect            | Value                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementation    | [`application/template-service.ts`](../../../src/modules/shared-services/application/template-service.ts) · [`domain/template-rendering.ts`](../../../src/modules/shared-services/domain/template-rendering.ts) · [`data/template-repository.ts`](../../../src/modules/shared-services/data/template-repository.ts)                                                                            |
| Evidence          | [`tests/foundation/p1-15-template-rendering.test.ts`](../../../tests/foundation/p1-15-template-rendering.test.ts) (37) · database suite — tenant templates create, platform templates are immutable from tenant runtime in four separate directions, and `scope`/`tenant_id` are not updatable so a tenant row cannot be promoted                                                              |
| Catalogue entries | Seven operations; five `shared.template.*` audit actions; event `EVT-TPL-001` `message-template.version.changed`; metrics `template.render.count`, `template.render.failure_count`                                                                                                                                                                                                             |
| Status            | **Implemented — unit-tier only** at the operation layer; the **platform/tenant boundary is Proven**. Gate condition 11's SSTI half is Proven in the unit tier — no filesystem path and no module is reachable through a value, and the engine source contains no `import`, `require`, `eval` or `Function`. The lifecycle and stale-version obligations are not yet exercised through a route. |

### 2.9 Events

| Aspect            | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementation    | Composes the frozen P1-13 outbox publisher. P1-15 registers **five events** in [`src/server/events/envelope.ts`](../../../src/server/events/envelope.ts): `EVT-DOC-002`, `EVT-DOC-003`, `EVT-NTF-002`, `EVT-TPL-001`, `EVT-ORG-001`                                                                                                                                                                                                                                                                           |
| Evidence          | [`tests/foundation/p1-15-catalogs.test.ts`](../../../tests/foundation/p1-15-catalogs.test.ts) — exact-inventory equality on the event catalogue                                                                                                                                                                                                                                                                                                                                                               |
| Catalogue entries | Five events, all `schemaVersion: 1`, all `owner: 'shared'`; metric `event.rejected.count`                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Status            | **Implemented — unit-tier only.** Names carry **no version suffix**: the planning text used `….v1`, but the schema version is already a separate column, and duplicating it in the wire name would give two ways to state one fact. Every payload is deliberately thin — no storage key, no checksum, no recipient, no rendered content, no template body. That an event exists **if and only if** its source transaction committed (BR-INT-001) is the P1-13 publisher's property and is not re-proven here. |

### 2.10 Normalization

| Aspect            | Value                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementation    | [`domain/normalization.ts`](../../../src/modules/shared-services/domain/normalization.ts) — `normalizeVin`, `normalizePhoneDigits`, `normalizePhone`, `normalizeEmail`, `normalizeSearchValue`, `searchTokens`                                                                                                                                                                           |
| Evidence          | [`tests/db/p1-15-normalization-parity.test.ts`](../../../tests/db/p1-15-normalization-parity.test.ts) — 8 differential tests over one corpus shared by all three normalizers                                                                                                                                                                                                             |
| Catalogue entries | **None.** Pure functions on the module's public surface. Metric `normalization.rejected.count`                                                                                                                                                                                                                                                                                           |
| Status            | **Proven.** The mirrors agree with `veh.normalize_vin`, `crm.normalize_phone` and `crm.normalize_email` exactly, including the three edge cases a well-meaning reimplementation would "fix": a lone `'+'` survives, Arabic-Indic digits normalize to `NULL`, and `I`/`O`/`Q` are preserved in a VIN. Gate condition 13 is the one this phase can currently claim strongest evidence for. |

VIN plausibility is reported as a **separate, non-mutating** field, so a caller can say "this does not
look like a 17-character VIN" without the normalizer ever silently repairing input. The Arabic-Indic
behaviour is recorded as a **real limitation of the frozen contract**, not fixed in the mirror —
changing it is a database change with its own change request.

### 2.11 Query primitives — pagination, filtering, sorting

| Aspect            | Value                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementation    | [`domain/query-primitives.ts`](../../../src/modules/shared-services/domain/query-primitives.ts), extending the P1-13 [`src/server/db/pagination.ts`](../../../src/server/db/pagination.ts)                                                                                                                                |
| Evidence          | [`tests/foundation/p1-15-query-primitives.test.ts`](../../../tests/foundation/p1-15-query-primitives.test.ts) — 76 tests, asserted against **emitted SQL text**                                                                                                                                                           |
| Catalogue entries | **None.** Metric `query.limit_rejected.count`                                                                                                                                                                                                                                                                             |
| Status            | **Proven** for gate condition 14: bounded, allow-listed and injection-safe, with negative fixtures. Every caller value is a bound parameter, the only single-quoted literal the builder may emit anywhere is the LIKE escape character, and caller strings — including the caller-visible field _name_ — never reach SQL. |

The cursor is **not** a security boundary: it is unsigned base64url JSON, and no authorization
decision may ever be carried in it. What the suite proves is narrower and correct — a cursor is bound
to the query that issued it, so it cannot be replayed against a different filter set or sort.

### 2.12 Export authorization

| Aspect            | Value                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementation    | [`application/export-authorization-service.ts`](../../../src/modules/shared-services/application/export-authorization-service.ts) · [`domain/export-policy.ts`](../../../src/modules/shared-services/domain/export-policy.ts) · [`data/export-repository.ts`](../../../src/modules/shared-services/data/export-repository.ts)             |
| Evidence          | [`tests/foundation/p1-15-export-policy.test.ts`](../../../tests/foundation/p1-15-export-policy.test.ts) (20)                                                                                                                                                                                                                              |
| Catalogue entries | Operations `shared.export-authorize`, `shared.export-catalogue`; audit action `shared.export.authorized` (class `export`); error `ERR-EXP-001`; config `EXPORT_MAX_ROWS`; metric `export.authorization.count`                                                                                                                             |
| Status            | **Implemented — unit-tier only.** The policy half is proven: three registered resources, an unregistered column is not exportable, and omitting the field list does not widen the export. The audited decision through a route is not yet exercised. **No file is produced by this phase** and the response says so (`generated: false`). |

### 2.13 Health

| Aspect            | Value                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementation    | [`application/health-service.ts`](../../../src/modules/shared-services/application/health-service.ts), projecting the P1-13 `foundationReadiness()`                                                                                                                                                                                                                                                             |
| Evidence          | [`tests/foundation/p1-15-health.test.ts`](../../../tests/foundation/p1-15-health.test.ts) (16)                                                                                                                                                                                                                                                                                                                  |
| Catalogue entries | Operations `shared.health-live`, `shared.health-ready`; config `READINESS_TIMEOUT_MS`; metrics `readiness.dependency.count`, `readiness.dependency.duration_ms`                                                                                                                                                                                                                                                 |
| Status            | **Proven** for gate condition 16's disclosure half — the liveness payload is pinned by exact key set, does no I/O, and the readiness projection drops every `detail`, including the database role name. Reconciliation with `/api/health` is Proven: that route is unmodified on this branch and its own test still asserts its seven keys. **No monitoring, alerting, SLO, or probe consumer is provisioned.** |

### 2.14 Module boundaries and composition

| Aspect            | Value                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementation    | [`src/modules/shared-services/index.ts`](../../../src/modules/shared-services/index.ts) — one legal import path, no repository and no pool exported; `installSharedServicesRuntime()` fills the frozen P1-13 `setFileService()` / `setNotificationService()` seams. Rules **B11** and **B12** added to [`scripts/check-module-boundaries.mjs`](../../../scripts/check-module-boundaries.mjs) |
| Evidence          | `npm run validate:module-boundaries` (part of the `gate:p1-13` pipeline); [`tests/foundation/module-boundaries.test.ts`](../../../tests/foundation/module-boundaries.test.ts) exercises the checker itself                                                                                                                                                                                   |
| Catalogue entries | None                                                                                                                                                                                                                                                                                                                                                                                         |
| Status            | **Implemented — unit-tier only.** B11 stops a Route Handler importing a foundation service contract directly; B12 stops a domain file reaching a provider port, which is I/O by definition. Neither new rule has a dedicated negative fixture in this phase.                                                                                                                                 |

### 2.15 Database capability boundary (DBCR-P1-15-001, migration 117)

| Aspect            | Value                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementation    | [`supabase/migrations/20260728090000_shared_services_runtime_write_capabilities.sql`](../../../supabase/migrations/20260728090000_shared_services_runtime_write_capabilities.sql) — the 117th migration, grants and RLS policies only                                                                                                                                                                     |
| Evidence          | [`tests/db/p1-15-shared-services-runtime-capabilities.test.ts`](../../../tests/db/p1-15-shared-services-runtime-capabilities.test.ts) — 51 tests, all passing in the run recorded in [the test catalogue](test-catalog.md#42-database-tier)                                                                                                                                                               |
| Catalogue entries | Permission codes `shared.document.manage` and `shared.notification.send`, asserted to exist exactly once each with the catalogue totalling 45                                                                                                                                                                                                                                                             |
| Records           | [DBCR-P1-15-001](../../database/change-requests/DBCR-P1-15-001-shared-services-runtime-write-capabilities.md) · [capability matrix](../../database/change-requests/DBCR-P1-15-001-capability-matrix.md) · [migration classification](phase-1-15-migration-classification.md) · [protected remediation verification](phase-1-15-remediation-verification.md)                                               |
| Status            | **Proven.** Migrations 1–116 are unchanged; 117 is additive and rollback-safe; no application role gained superuser, `BYPASSRLS`, `LOGIN` or ownership; no `SECURITY DEFINER` routine was introduced; and no `app_runtime` or `app_readonly` write policy uses a bare `true` predicate. Gate conditions 17 and 21 have executable evidence — on this local database, not yet on a final SHA in hosted CI. |

---

## 3. Deliberately withheld capability

Each row is a decision, taken and recorded, not a gap. The relevant tests prove the **absence**: they
assert that the capability cannot be exercised, so a future grant that quietly restores it fails a
test rather than passing unnoticed.

### 3.1 Document acceptance

| Field    | Value                                                                                                                                                                                                                                                                                                                                                                |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reason   | `shared.guard_document_version_transition()` admits a version to `accepted` only when a `clean` row exists in `shared.file_scan_results`, and **no application role may write that table**. **No malware scanner is configured in this phase and none is claimed.** Fabricating a verdict to unblock the lifecycle would convert a security control into decoration. |
| Evidence | Database suite: _"NO role may write `shared.file_scan_results` — the verdict cannot be manufactured"_; _"no application role holds any privilege on `shared.file_scan_results` beyond SELECT"_; _"acceptance is refused because no clean scan exists — the scanner gate holds"_; _"`guard_document_version_transition` is still installed and unmodified"_           |
| Effect   | P1-15 delivers metadata creation, upload authorization, the pre-acceptance version lifecycle, linking, rejection, and download authorization for eligible states. A download of a non-accepted version is `ERR-DOC-001`. Acceptance is an explicit follow-on.                                                                                                        |
| Status   | **Withheld**                                                                                                                                                                                                                                                                                                                                                         |

### 3.2 Document renaming, re-classification, and archival

| Field    | Value                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reason   | `app_runtime` holds **no `UPDATE` grant at all** on `shared.documents`. Shipping an operation whose every call would fail is worse than shipping none. |
| Evidence | Database suite: _"the request role holds no UPDATE privilege on documents at all"_; _"the request role cannot DELETE a document"_                      |
| Status   | **Withheld**                                                                                                                                           |

### 3.3 Generic status history and status evidence

| Field    | Value                                                                                                                                                                                                                                                                                                                                                                                           |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reason   | `shared.status_history` has **no foreign key on `entity_id`** (its only FK is to `org.tenants`), no `entity_type` allow-list, no state vocabulary beyond "from ≠ to", no coherence guard, and **no `company_id` / `branch_id`**, so scope-aware authorization is not expressible over it. Granting a write there would create a forgeable parallel history for every aggregate on the platform. |
| Evidence | Database suite: _"the request role still cannot write `shared.status_history`"_; _"…`shared.status_evidence`"_; _"the worker also cannot write the generic status tables"_; _"no application role holds any write privilege on either status table"_                                                                                                                                            |
| Effect   | The transition engine drives each module's own scope-bound, coherence-guarded history table. **There is no generic writable workflow store and no client-defined transition graph.**                                                                                                                                                                                                            |
| Status   | **Withheld**                                                                                                                                                                                                                                                                                                                                                                                    |

### 3.4 Search projection for the request runtime

| Field    | Value                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reason   | `shared.search_metadata` is a **derived** projection. Granting the request runtime a write on it would let request code publish a search value that no source row supports, so the projection would stop being provably derived from the data it claims to index. It is assigned to `app_worker` — INSERT, a column-restricted UPDATE, and DELETE — with the identity columns excluded from the UPDATE grant. |
| Evidence | Database suite: _"the worker creates a projection row"_; _"the request role cannot insert a projection"_; _"the request role cannot update a projection"_; _"identity columns are excluded from the worker UPDATE grant"_                                                                                                                                                                                     |
| Effect   | P1-15 ships the normalizers and the token builder ([§2.10](#210-normalization)); the projection writer is a worker concern and no P1-15 operation writes one.                                                                                                                                                                                                                                                 |
| Status   | **Withheld** from the request runtime                                                                                                                                                                                                                                                                                                                                                                         |

### 3.5 SMS and WhatsApp channels

| Field    | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reason   | `ck_outbound_messages_channel` and `ck_message_templates_channel` allow **only `email` and `in_app`**. The frozen P1-13 `NotificationChannel` type is wider and cannot be narrowed — later phases compile against it — so `sms` and `whatsapp` type-check and are refused by policy with a stable code. Letting them through would surface as SQLSTATE `23514`, which is neither a contract nor actionable. **No SMS or WhatsApp delivery exists, and no provider for either is provisioned.** |
| Evidence | [`tests/foundation/p1-15-notification-policy.test.ts`](../../../tests/foundation/p1-15-notification-policy.test.ts) — the wider list is constructed as a typed `NotificationChannel[]`, so the conflict is asserted at compile time as well as run time                                                                                                                                                                                                                                        |
| Status   | **Withheld**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### 3.6 Export file generation

| Field    | Value                                                                                                                                                                                                                                                                                                                                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reason   | A generator needs an object store to write to (**none provisioned**), a retention decision for the artefact (**none approved**), and a delivery channel (**none exists**). Shipping the authorization now means the decision is auditable and enforced from the first export, and the generator inherits a settled contract instead of re-deciding it under deadline. |
| Evidence | The boundary is in the response itself: `generated: false`, a field a consumer cannot mistake for a download. [`tests/foundation/p1-15-export-policy.test.ts`](../../../tests/foundation/p1-15-export-policy.test.ts) asserts the field allow-lists that a generator would inherit.                                                                                   |
| Effect   | Formula risk is published as a named, testable predicate (`isFormulaRiskyCell`) for the eventual writer to call. P1-15 writes no file, so it cannot neutralise a `=`-leading cell and does not claim to.                                                                                                                                                              |
| Status   | **Withheld**                                                                                                                                                                                                                                                                                                                                                          |

### 3.7 Signed upload tokens and signed cursors

| Field    | Value                                                                                                                                                                                                                                                                                    |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reason   | Signing either would need key management across instances, which is not provisioned. Both are therefore unsigned and documented as carrying **convenience, never authority**: every field is re-derived and re-checked server-side, and no authorization decision is read out of either. |
| Evidence | [`tests/foundation/p1-15-query-primitives.test.ts`](../../../tests/foundation/p1-15-query-primitives.test.ts) — a cursor is bound to the query that issued it; the attachment service re-derives the storage key rather than trusting the token                                          |
| Status   | **Withheld**, with the compensating control stated rather than the risk hidden                                                                                                                                                                                                           |

---

## 4. Registered operations → evidence obligation

One row per P1-15 operation, mapping it to the backend file the coverage manifest names and the
evidence kinds that file must carry. **Every row's state is the same today**, and it is stated once
rather than repeated 21 times: the named file does not exist, `npm run validate:operation-coverage`
exits `1`, and no operation-depth evidence is claimed.

| Operation                              | Named backend file                           | Required evidence kinds                                   |
| -------------------------------------- | -------------------------------------------- | --------------------------------------------------------- |
| `shared.attachment-upload-authorize`   | `p1-15-attachments-notifications.test.ts`    | success, denial, cross-tenant, audit                      |
| `shared.attachment-version-register`   | `p1-15-attachments-notifications.test.ts`    | success, denial, cross-tenant, audit, outbox              |
| `shared.attachment-version-reject`     | `p1-15-attachments-notifications.test.ts`    | success, denial, audit                                    |
| `shared.attachment-download-authorize` | `p1-15-attachments-notifications.test.ts`    | success, denial, audit                                    |
| `shared.attachment-link-create`        | `p1-15-attachments-notifications.test.ts`    | success, denial, cross-tenant, audit, outbox              |
| `shared.attachment-link-withdraw`      | `p1-15-attachments-notifications.test.ts`    | success, denial, audit                                    |
| `shared.notification-enqueue`          | `p1-15-attachments-notifications.test.ts`    | success, denial, cross-tenant, audit, outbox, idempotency |
| `shared.template-create`               | `p1-15-templates-transitions-export.test.ts` | success, denial, cross-tenant, audit                      |
| `shared.template-update`               | `p1-15-templates-transitions-export.test.ts` | success, denial, audit, stale-version                     |
| `shared.template-version-create`       | `p1-15-templates-transitions-export.test.ts` | success, denial, audit, outbox                            |
| `shared.template-version-revise`       | `p1-15-templates-transitions-export.test.ts` | success, denial, stale-version                            |
| `shared.template-version-approve`      | `p1-15-templates-transitions-export.test.ts` | success, denial, audit, outbox, stale-version             |
| `shared.template-version-retire`       | `p1-15-templates-transitions-export.test.ts` | success, denial, audit, stale-version                     |
| `shared.template-activation-set`       | `p1-15-templates-transitions-export.test.ts` | success, denial, audit, stale-version                     |
| `shared.template-version-preview`      | `p1-15-templates-transitions-export.test.ts` | success                                                   |
| `shared.branch-status-change`          | `p1-15-templates-transitions-export.test.ts` | success, denial, isolation, audit, outbox, stale-version  |
| `shared.branch-status-read`            | `p1-15-templates-transitions-export.test.ts` | _(invocation only — a read that changes nothing)_         |
| `shared.export-authorize`              | `p1-15-templates-transitions-export.test.ts` | success, denial, audit                                    |
| `shared.export-catalogue`              | `p1-15-templates-transitions-export.test.ts` | _(invocation only — registry metadata)_                   |
| `shared.health-live`                   | `p1-15-dispatch-and-health.test.ts`          | success                                                   |
| `shared.health-ready`                  | `p1-15-dispatch-and-health.test.ts`          | success                                                   |

## 5. Gate conditions this matrix speaks to

Only the conditions the artefacts above bear on are listed. Everything else in the
[owner gate](phase-1-15-owner-gate.md) is unchanged, and **every condition remains "To be evidenced"
until the approval owner records a decision on the exact merged SHA.**

| Gate condition                                                    | What exists today                                                                                                             |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1 — every scope item implemented on the existing contracts        | Implemented; composed on P1-5 / P1-13 / P1-14 contracts with no competing framework. Not independently re-verified.           |
| 2–5 — operation-depth, coverage, denial, audit/idempotency/outbox | **Not satisfied.** The three backend suites do not exist and the coverage gate exits `1`.                                     |
| 6 — provider fakes, no production credentials in CI               | Both providers are ports with local adapters; the defaults are `unconfigured`. Timeout and fault behaviour is not yet tested. |
| 7 — number allocation                                             | In-process and transactional by construction; concurrency not exercised in this phase.                                        |
| 8 — audit append-only, catalog-controlled, no second store        | One `appendAudit`; catalogue closed and pinned by exact inventory.                                                            |
| 9 — transitions cannot skip policy or be client-defined           | Graph registered in code; atomicity asserted by construction, not yet by test.                                                |
| 10–11 — attachment safety, notification and template safety       | Key rules, URL bindings and rendering safety Proven in the unit tier; route-level cases outstanding.                          |
| 12 — registered event semantics and naming convention             | Five events registered; catalogue pinned.                                                                                     |
| 13 — normalization does not contradict P1-6 / P1-7                | **Proven** differentially against the live functions.                                                                         |
| 14 — bounded, allow-listed, injection-safe query primitives       | **Proven**, asserted against emitted SQL.                                                                                     |
| 15 — export authorization does not claim generation               | Enforced in the response shape; policy Proven in the unit tier.                                                               |
| 16 — health safe, non-leaking, bounded, reconciled                | **Proven** for disclosure; `/api/health` unmodified on this branch.                                                           |
| 17 / 21 — RLS default-deny, migration posture                     | **Proven** on the local database by the 51-test capability suite. Not yet re-verified in hosted CI on a final SHA.            |
| 22–24 — local, clean-room, and hosted CI validation               | **Not satisfied.** One local partial run is recorded; no clean-room run and no hosted CI run on a final SHA exists.           |
| 25–27 — merge, gate record, no P1-16 work                         | The implementer never merges. The gate record is **Pending**. No P1-16 work has started.                                      |

## 6. Delivery provenance

Commits on `feature/p1-15-shared-services-backend`, oldest first, from `git log --oneline`. The first
five plus the merge are the database remediation, delivered in its own pull request (#60) and merged
by the repository owner before feature work resumed.

| Commit    | Subject                                                                                                                       |
| --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `4c2bad3` | `[P1-15] Raise DBCR-P1-15-001 and decide the shared-services capability matrix`                                               |
| `ffaadb0` | `[P1-15] Add migration 117: tenant-safe shared-services runtime write capabilities`                                           |
| `614d77a` | `[P1-15] Add the migration-117 capability suite and update exact inventories`                                                 |
| `1af4b82` | `[P1-15] Record the remediation, migration classification and P1-15-R-001`                                                    |
| `d39f576` | `[P1-15] Make the migration-count proof portable to the CI database`                                                          |
| `e50d501` | `Merge pull request #60 …` — the owner's merge of the remediation                                                             |
| `4d964c5` | `[P1-15] Open Shared Services Backend phase: Wave 0 audit and Pending owner gate`                                             |
| `d666254` | `[P1-15] Record the protected remediation verification (Waves 1-3)`                                                           |
| `c01db11` | `[P1-15] Record binding implementation decisions where planning met frozen contracts`                                         |
| `231f056` | `[P1-15] Add normalization primitives proven equivalent to the frozen SQL`                                                    |
| `1698b09` | `[P1-15] Implement the shared-services module: numbering, attachments, notifications, templates, transitions, export, health` |
| `bfc56f8` | `[P1-15] Register the 21 shared-services operations and their route handlers`                                                 |

At the time this matrix was written the eight `tests/foundation/p1-15-*` suites and the phase
documentation package — including this file — were **untracked working-tree files**, not yet
committed. Every count and every command result above is a local observation on that tree.
