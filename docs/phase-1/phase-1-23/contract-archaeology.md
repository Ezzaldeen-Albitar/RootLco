# P1-23 — contract archaeology

Read before writing any P1-23 code, as the phase mandate requires. Everything
below was read out of the tree at `9f7ef083` (tree `a921cae3`), not recalled.

## The finding that governs the whole phase

**P1-15 already delivered most of the document, template and notification
foundation, and P1-11 delivered the reporting tables.** P1-23 is _additive_: it
must build on those contracts, not re-create them.

Twenty-one `shared.*` operations already exist:

| Area          | Existing operations                                                                                                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files         | `shared.attachment-upload-authorize`, `shared.attachment-version-register`, `shared.attachment-version-reject`, `shared.attachment-download-authorize`, `shared.attachment-link-create`, `shared.attachment-link-withdraw` |
| Templates     | `shared.template-create`, `-update`, `-activation-set`, `shared.template-version-create`, `-revise`, `-approve`, `-retire`, `-preview`                                                                                     |
| Notifications | `shared.notification-enqueue`                                                                                                                                                                                              |
| Exports       | `shared.export-authorize`, `shared.export-catalogue`                                                                                                                                                                       |
| Other         | `shared.branch-status-*`, `shared.health-*`                                                                                                                                                                                |

So the upload/finalize/download/attach lifecycle, the template lifecycle, the
enqueue path and export authorization are **already implemented and gated**.
What P1-23 adds is the _read, observability, retention and reporting_ surface
that P1-15 deliberately left out.

## Database — no migration 120 is required

Every table P1-23 needs already exists. Migrations remain **119**.

### `shared` (P1-05)

| Table                                                   | Role in P1-23                                 |
| ------------------------------------------------------- | --------------------------------------------- |
| `documents`, `document_versions`, `document_categories` | file lifecycle                                |
| `document_links`                                        | entity attachment (allowlisted entity types)  |
| `file_scan_results`                                     | scanner port — evidence table already present |
| `retention_classes`, `legal_holds`                      | **retention foundation exists**               |
| `message_templates`, `template_versions`                | notification templates                        |
| `outbound_messages`, `delivery_attempts`                | notification delivery + retry                 |
| `event_outbox`, `idempotency_keys`, `processed_events`  | events / idempotency                          |

### `rpt` (P1-11)

`report_configurations`, `report_configuration_versions`, `saved_filters`.

`rpt.report_configurations` columns: `report_code` (`^[a-z][a-z0-9_]{1,62}$`),
`name`, `scope_level` ∈ {`branch`,`company`,`tenant`}, **`export_permission_code`
FK → `iam.permissions`**, `owner_user_id`, `status` ∈
{`draft`,`published`,`archived`}, `record_version`, soft delete.

That `export_permission_code` foreign key is the contract's own statement that
**export permission is per-report and separate from view permission** — §20 does
not need inventing, it needs reading.

## The role separation that decides the notification design

This is the single most important contract in the phase, and it is enforced by
grants, not by convention.

| Relation                   | `app_runtime` (request)                                                                          | `app_worker` (dispatcher)                 |
| -------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| `shared.outbound_messages` | SELECT · **INSERT only**, policy pins `status='pending'` and requires `shared.notification.send` | SELECT · UPDATE(`status`,`failure_class`) |
| `shared.delivery_attempts` | SELECT (append-only; **no INSERT**)                                                              | SELECT · INSERT                           |
| `shared.template_versions` | full lifecycle                                                                                   | **nothing at all**                        |

Consequences P1-23 must respect rather than work around:

- A request **can ask** for a message to be sent. It **cannot** claim it was
  sent, forge a delivery attempt, or mark it delivered.
- **Manual retry cannot be a request-runtime UPDATE.** The runtime holds no
  UPDATE on `outbound_messages`. Retry is `failed → queued` and belongs to the
  worker role. A public "retry" operation may therefore only _request_ a retry;
  the transition itself is the worker's.
- The worker cannot read a template body, and `outbound_messages` stores **no
  body** — only `body_sha256`, documented as "integrity digest of rendered
  content that is not persisted here".

### Approved state vocabulary — do not invent

`shared.outbound_messages.status`:
`pending → queued → sending → sent → delivered | failed | cancelled`,
with the transition graph enforced by
`shared.guard_outbound_message_lifecycle()`. **Retry exists only as
`failed → queued`, and it increments `retry_count`.**

`shared.delivery_attempts.status`: `started | accepted | delivered | errored`.

That vocabulary already answers §16 exactly: `accepted` (provider took it) is a
different state from `delivered` (provider evidence of delivery). Collapsing
them would contradict the schema, not merely the mandate.

### Recipient and content safety are structural

- `recipient_digest bytea` — exactly 32 bytes (SHA-256), or `recipient_user_id`
  (tenant-bound composite FK). `ck_outbound_messages_recipient_present` requires
  at least one. **No plaintext address is storable.**
- `body_sha256 bytea` — 32 bytes. No body column exists.
- `uq_outbound_messages_dedupe UNIQUE (tenant_id, dedupe_key)` — idempotency is
  a database constraint, and `NotificationRepository.enqueue` uses
  `ON CONFLICT DO NOTHING` plus a follow-up read, deliberately never touching an
  existing row (it may already be `sending`).
- `channel` ∈ {`email`,`in_app`} · `purpose` ∈
  {`transactional`,`marketing`,`system`}.
- `delivery_attempts` has **no UPDATE/DELETE grant or policy** — append-only by
  construction, with `uq_delivery_attempts_message_number` preventing duplicate
  attempt numbers.

## Existing application surface

| Concern                      | Module path                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| Attachment service / policy  | `shared-services/application/attachment-service.ts`, `domain/attachment-policy.ts`                    |
| Object key construction      | `shared-services/domain/storage-key.ts`                                                               |
| Storage port + local adapter | `provider/storage-provider.ts`, `provider/local-storage-provider.ts`                                  |
| Document data access         | `data/document-repository.ts`                                                                         |
| Template rendering           | `domain/template-rendering.ts`, `application/template-service.ts`                                     |
| Notification (request side)  | `application/notification-service.ts`, `data/notification-repository.ts`                              |
| Notification (worker side)   | `data/message-dispatch-repository.ts`, `provider/message-provider.ts`                                 |
| Export authorization         | `application/export-authorization-service.ts`, `domain/export-policy.ts`, `data/export-repository.ts` |
| Outbox worker                | `server/worker/outbox-worker.ts`, `consumer-registry.ts`, `worker-db.ts`, `backoff.ts`                |
| Public ports                 | `server/contracts/file-service.ts`, `server/contracts/notification-service.ts`                        |

## Gaps P1-23 must close

Reading the existing surface against the 14 backend tasks, the missing pieces
are **reads, observability, retention and reporting** — not the write lifecycles:

1. **File/document detail read** — no operation exposes document metadata.
2. **In-app notification list/detail** — only `notification-enqueue` exists;
   nothing lets a recipient read their notifications.
3. **Delivery-log list** — `delivery_attempts` has a SELECT grant and no reader.
4. **Manual retry request** — constrained as above; worker owns the transition.
5. **Report catalogue / execution** — `rpt.report_configurations` exists with no
   operation reading or executing a report.
6. **Export request / status / download** — `export-authorize` exists;
   request-and-status lifecycle does not.
7. **Retention evaluation** — `retention_classes` and `legal_holds` exist with
   no evaluator; must be **dry-run and non-destructive** (§12).

## Limitations to record rather than paper over

- **Retention defaults are an open decision.** `retention_classes` exists but the
  phase must not invent durations. The safe implementation is evaluation +
  `pending-expiry` reporting + a controlled configuration error when policy is
  absent, and a port for future deletion execution.
- **No email provider is approved.** `provider/message-provider.ts` is the port;
  where unconfigured, the correct behaviour is a controlled configuration state,
  never a silent drop and never a claimed delivery.
- **Content inspection / antivirus is not present** beyond
  `shared.file_scan_results` as an evidence table. Accepted file categories must
  stay limited, downloads must use attachment disposition, and no claim of
  malware scanning may be made.
- **Manual retry at request runtime is not grantable** without changing roles —
  recorded as a contract boundary, not a defect.

## Route grammar

Existing routes use noun/sub-resource segments, **not** colon actions:
`/api/v1/attachments/upload-authorizations`,
`/api/v1/attachments/documents/{documentId}/download-authorizations`,
`/api/v1/attachments/documents/{documentId}/links`,
`/api/v1/exports/authorizations`, `/api/v1/exports/resources`,
`/api/v1/message-templates/{templateId}/versions`,
`/api/v1/template-versions/{versionId}/approval`.

So the plan's illustrative `POST /api/v1/files:authorize-upload` grammar is
**not** canonical here; the repository's noun form is, and P1-23 follows it.

## Migration blockers

**None.** Every required table, constraint, policy and protected function
already exists. Migrations stay at **119**, migration 120 absent, schema hash
`a677eb05…` unchanged.
