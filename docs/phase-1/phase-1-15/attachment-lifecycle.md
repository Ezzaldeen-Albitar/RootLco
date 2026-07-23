# Phase 1-15 — Attachment Lifecycle

**Company:** RootLco — Root Link Company · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Release group:** Release 3 — Backend Foundation · **Date:** 2026-07-23 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md) — never an
independent third-party audit) ·
**Owner gate:** [Phase 1-15 Owner Gate](./phase-1-15-owner-gate.md) — **Pending**.

**Related:** [Binding implementation decisions](./phase-1-15-implementation-decisions.md) ·
[Database remediation record (DBCR-P1-15-001)](./phase-1-15-database-remediation-record.md) ·
[Storage keys and signed URLs](./storage-and-signed-urls.md) ·
[Document Access and File Security (P1-5)](../phase-1-5/document-access-and-file-security.md) ·
[Storage-Key Convention](../../database/storage-key-convention.md)

**Implementation:** [`src/modules/shared-services/application/attachment-service.ts`](../../../src/modules/shared-services/application/attachment-service.ts) ·
[`src/modules/shared-services/data/document-repository.ts`](../../../src/modules/shared-services/data/document-repository.ts) ·
[`src/modules/shared-services/domain/attachment-policy.ts`](../../../src/modules/shared-services/domain/attachment-policy.ts) ·
[`src/server/contracts/file-service.ts`](../../../src/server/contracts/file-service.ts)

---

## 1. What an attachment is in this phase

An attachment is **metadata plus a reservation**. Phase 1-5 built the document tables and stored no
bytes; Phase 1-15 adds the application path that creates a document row, reserves a storage key,
hands out a short-lived signed URL, records the uploaded object as a _pending_ version, and attaches
that document to a business entity.

What it does **not** add is a byte path. No request in this phase reads or writes file content: the
transfer happens between the client and whatever object store the signed URL names, and no object
store is provisioned (see [storage and signed URLs](./storage-and-signed-urls.md) §1 and §9). The database
remains the authority on _who may reach which document_; the bytes are addressed by a key that
grants nothing on its own.

The design consequence worth stating up front is that **the lifecycle stops one state short of
useful**. A version can be created and rejected. It cannot be accepted, and therefore — because
acceptance is the only downloadable state — nothing that this phase uploads can be downloaded
through it. §4 explains why that is a deliberate, documented boundary rather than a missing branch.

## 2. The implemented lifecycle

```
  ┌──────────────────────────┐
  │ (nothing)                │
  └───────────┬──────────────┘
              │  POST /attachments/upload-authorizations
              │  · category resolved and checked
              │  · content type checked against the category allow-list
              │  · size checked against min(category ceiling, platform ceiling)
              │  · storage key BUILT from environment + tenant + new ids
              │  · document row INSERTed (status defaults to `pending`)
              │  · signed PUT URL issued, upload token encoded
              ▼
  ┌──────────────────────────┐        the client PUTs the bytes to the signed URL.
  │ document (pending)       │        Nothing in this platform observes that transfer.
  │ storage key reserved     │
  └───────────┬──────────────┘
              │  POST /attachments/versions   (upload token presented)
              │  · every token field re-derived or re-checked (§5)
              │  · document re-loaded under RLS
              │  · storage key REBUILT, never read from the token
              ▼
  ┌──────────────────────────┐
  │ document_version         │────────► rejected   POST /attachments/versions/{id}/rejection
  │ status = 'pending'       │                     (terminal; the only transition held)
  └───────────┬──────────────┘
              │                        ┌──────────────────────────────────────────┐
              │                   ✗    │ accepted — UNAVAILABLE. Requires a clean │
              │  ────────────────────► │ row in shared.file_scan_results, which   │
              │                        │ no application role may write, and no    │
              │                        │ scanner exists. See §4.                  │
              │                        └──────────────────────────────────────────┘
              │  POST /attachments/documents/{documentId}/links
              ▼
  ┌──────────────────────────┐
  │ document_link (live)     │────────► withdrawn  DELETE /attachments/links/{linkId}
  │ reachability established │                     (soft: deleted_at is stamped)
  └──────────────────────────┘
```

Each stage as an operation, read from the route modules under
[`src/app/api/v1/attachments/`](../../../src/app/api/v1/attachments):

| Stage                    | Operation id                           | Method + path                                                      | Audit class · action                                 | Notable failures                                                    |
| ------------------------ | -------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------- |
| Metadata + authorization | `shared.attachment-upload-authorize`   | `POST /attachments/upload-authorizations`                          | **security** · `shared.document.upload_authorized`   | `ERR-VAL-001`, `ERR-RES-001`, `ERR-IAM-001`, `ERR-DEP-001`          |
| Register pending version | `shared.attachment-version-register`   | `POST /attachments/versions`                                       | privileged · `shared.document.version_registered`    | `ERR-VAL-001`, `ERR-RES-001`, `ERR-RES-002` (replay), `ERR-IAM-001` |
| Link to an entity        | `shared.attachment-link-create`        | `POST /attachments/documents/{documentId}/links`                   | privileged · `shared.document.linked`                | `ERR-VAL-001`, `ERR-RES-001`, `ERR-IAM-001`                         |
| Reject a pending version | `shared.attachment-version-reject`     | `POST /attachments/versions/{versionId}/rejection`                 | privileged · `shared.document.version_rejected`      | `ERR-RES-001`, `ERR-TRN-001`                                        |
| Withdraw a link          | `shared.attachment-link-withdraw`      | `DELETE /attachments/links/{linkId}`                               | privileged · `shared.document.unlinked`              | `ERR-RES-001`, `ERR-IAM-001`                                        |
| Authorize a download     | `shared.attachment-download-authorize` | `POST /attachments/documents/{documentId}/download-authorizations` | **security** · `shared.document.download_authorized` | `ERR-RES-001`, **`ERR-DOC-001`**, `ERR-SYS-001`, `ERR-DEP-001`      |

Every one of the six declares `permissions: ['shared.document.manage']`, `scope: 'tenant'`,
`cacheCategory: 'never'`, and `rateLimitPolicy: 'standard-command'`. Two of them —
upload and download authorization — are classified **security** rather than privileged, and the
reason is recorded in [`audit-actions.ts`](../../../src/server/auth/audit-actions.ts): issuing a
signed URL hands out a bearer capability to bytes, so the audit record is the only durable evidence
that it happened and it must be triaged alongside authentication and grant changes.

Three design choices in that table deserve their rationale rather than a restatement.

**Both authorizations are `POST`, and both are non-cacheable.** A `GET` that mints a capability
lands in browser history, proxy logs, and referrer headers. Modelling the authorization as a created
resource keeps the capability out of a URL that anything else will store.

**The three creating operations declare `idempotent: true`.** Upload authorization, version
registration, and link creation each both create a row and — in the first case — hand out a
capability, so a retried request must not mint a second one. Rejection and withdrawal do not declare
it: each is a transition whose repetition is already refused by the state itself.

**Withdrawal is `DELETE` on the link but is not a delete.** `app_runtime` holds no `DELETE`
privilege on `shared.document_links` and should not: the fact that a document _was_ attached to a
work order is itself evidence. The verb describes the caller's intent; the implementation stamps
`deleted_at` and the row survives.

## 3. The privilege surface, as observed

The application code is written against privileges, not against assumptions about them. The table
below was read from the **live local catalog** on 2026-07-23 — 117 applied migrations, the same
tree that carries migration
[`20260728090000_shared_services_runtime_write_capabilities.sql`](../../../supabase/migrations/20260728090000_shared_services_runtime_write_capabilities.sql).
Three queries were used: `information_schema.column_privileges` for the column-scoped grants,
`information_schema.role_table_grants` for anything table-wide, and `pg_policies` for the policy
inventory.

### 3.1 What the grant catalog says

| Relation                     | `app_runtime`                                                                                                                                                | `app_worker` | `app_readonly` |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ | -------------- |
| `shared.document_categories` | `SELECT`                                                                                                                                                     | _nothing_    | `SELECT`       |
| `shared.documents`           | `SELECT` · `INSERT (id, tenant_id, company_id, branch_id, category_id, title, classification, retention_class, created_by)`                                  | _nothing_    | `SELECT`       |
| `shared.document_versions`   | `SELECT` · `INSERT (id, tenant_id, document_id, version_number, storage_key, content_type, size_bytes, sha256, uploaded_by, created_by)` · `UPDATE (status)` | _nothing_    | `SELECT`       |
| `shared.document_links`      | `SELECT` · `INSERT (id, tenant_id, document_id, entity_type, entity_id, link_purpose, linked_by, created_by)` · `UPDATE (deleted_at)`                        | _nothing_    | `SELECT`       |
| `shared.file_scan_results`   | `SELECT` **only**                                                                                                                                            | _nothing_    | `SELECT`       |

What was observed, stated exactly: the table-level query returned **ten rows, every one of them
`SELECT`** — so no application role holds a table-wide `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`,
`REFERENCES`, or `TRIGGER` privilege on any of the five relations. The column-level query returned
**fifteen rows**, and `app_worker` appears in none of them: the asynchronous worker has no
capability whatsoever on the document surface, which is correct — nothing in the document path is a
queue the worker drains. All five relations report `relrowsecurity = true` **and**
`relforcerowsecurity = true`, so the policies apply even to a table owner.

### 3.2 What the policy catalog says

`pg_policies` returns exactly ten policies across the five relations:

| Relation                     | Policies                                                                                                                    |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `shared.document_categories` | `sel_document_categories_visible` (SELECT)                                                                                  |
| `shared.documents`           | `sel_documents_tenant` (SELECT) · `ins_documents_scoped` (INSERT)                                                           |
| `shared.document_versions`   | `sel_document_versions_tenant` (SELECT) · `ins_document_versions_scoped` (INSERT) · `upd_document_versions_reject` (UPDATE) |
| `shared.document_links`      | `sel_document_links_tenant` (SELECT) · `ins_document_links_scoped` (INSERT) · `upd_document_links_unlink` (UPDATE)          |
| `shared.file_scan_results`   | `sel_file_scan_results_tenant` (SELECT) — **and nothing else**                                                              |

Three consequences follow directly, and the application is built around them rather than around a
hope that they hold.

- **There is no `UPDATE` grant on `shared.documents` at all.** A document cannot be renamed,
  re-classified, moved to another retention class, archived, soft-deleted, or released from legal
  hold through the request path. `legal_hold` in particular is the absolute deletion blocker, and a
  request role that could clear it would make retention advisory.
  [`DocumentRepository`](../../../src/modules/shared-services/data/document-repository.ts) therefore
  exposes no update method for documents — not one that fails, one that does not exist.
- **The only version transition available is `pending → rejected`.** `upd_document_versions_reject`
  pins the source state to `pending` in its `USING` clause and the destination to `rejected` in its
  `WITH CHECK`, so acceptance and quarantine are refused at the policy layer _before_
  `shared.guard_document_version_transition` is ever consulted.
- **Unlinking is the only link mutation.** `UPDATE (deleted_at)` is the whole grant, so a link's
  document, entity, or purpose can never be re-pointed after the fact.

Each write policy is anchored on `tenant_id = iam.current_tenant_id()`, pins authorship to
`iam.current_user_id()`, and evaluates `iam.has_permission_in_scope('shared.document.manage', …)` in
the **owning document's own company/branch scope** — not the tenant-wide `iam.has_permission`.
`shared.document.manage` is one of exactly two `shared.*` permission codes in the catalog; the other
is `shared.notification.send`.

The repository adds a belt to that brace: every statement carries an explicit `tenant_id = $1`
predicate _in addition_ to RLS, and issues SQL only through the bound-parameter helpers on
`Repository`. RLS is the guarantee; the predicate states the intent and makes a zero-row result mean
"not in scope" rather than "policy silently filtered it".

## 4. Acceptance is unavailable, and exactly why

This is the single most important boundary in the phase, so it is stated without softening.

**No document version created by this phase can reach `accepted`, and therefore no document created
by this phase can be downloaded through it.**

The mechanism is a chain of four facts, each independently verified:

1. `shared.guard_document_version_transition()` — read verbatim from the live catalog — refuses the
   `accepted` target unless it finds, for the same `(tenant_id, version_id)`, **at least one row in
   `shared.file_scan_results` with `scan_status = 'clean'`** and **no row with
   `scan_status = 'infected'`**. Both conditions raise `check_violation` when unmet.
2. `shared.file_scan_results` grants **`SELECT` only**, to `app_runtime` and `app_readonly`, and
   nothing at all to `app_worker`. There is no `INSERT` privilege for any application role.
3. `pg_policies` reports exactly one policy on that relation — `sel_file_scan_results_tenant`, a
   `SELECT` policy. Even if a privilege appeared, `FORCE` RLS with no write policy would still admit
   no row.
4. **No scanner exists.** None is configured, none is implemented in this phase, and no code path
   fabricates a verdict.

The withholding in (2) and (3) is deliberate and is recorded in
[DBCR-P1-15-001](../../database/change-requests/DBCR-P1-15-001-shared-services-runtime-write-capabilities.md)
and the [database remediation record](./phase-1-15-database-remediation-record.md) §11. The reasoning
is worth repeating because it is the reason this limitation is a feature: a `clean` row is the sole
positive evidence the guard accepts, and `shared.file_scan_results` carries no triggers — so a role
that could insert a verdict could also insert a _false_ one, and a role that could update would be
able to rewrite an `infected` verdict into a `clean` one. Granting the capability to make acceptance
work would remove the only thing acceptance means.

The application refuses to paper over this in three places:

- `DOWNLOADABLE_STATES` is `['accepted']` and nothing else, so
  `AttachmentService.requestDownload()` refuses any other state with `ERR-DOC-001` ("Document
  version not available") **before** any URL is signed, and increments
  `attachment.authorization.count{purpose=download,result=refused}`.
- `AttachmentService.scanState()` is deliberately a _report_, not a gate that can be satisfied. It
  returns the version's status and whatever verdicts exist, with `scannerAvailable` **hard-coded
  `false`** — because no scanner is configured and returning anything else would be the exact
  misrepresentation the withholding exists to prevent.
- The event catalog entry `EVT-DOC-001` (`document.accepted`) carries `implementedIn: null` in
  [`envelope.ts`](../../../src/server/events/envelope.ts). The event is _catalogued_ — a later phase
  will publish it — and is **not** published by this one.

Introducing acceptance is a follow-on that needs three things together: a scanner, a role that may
write verdicts (which is a schema change with its own change request), and an operational contract
for what happens to a version that scans `infected`. None of the three exists, and none is claimed.

## 5. The upload token carries convenience, never authority

`uploadToken` is base64url-encoded JSON. It is **not signed**, it is **not a bearer credential**, and
nothing in the request pipeline consults it to make an authorization decision. Saying so plainly
matters, because the word "token" invites precisely the opposite assumption.

Its purpose is to carry, across the round trip during which the client uploads bytes, the identity
of the document and version the server already created and the constraints the server already
decided. It is a note the server wrote to itself and asked the client to hold.

A client can forge it. Forging it achieves nothing, because
[`registerVersion()`](../../../src/modules/shared-services/application/attachment-service.ts)
re-derives or re-checks **every field**:

| Token field   | What happens at registration                                                                                                                                                                                                                                                                                                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v`           | Must be exactly `1`. Any other value is rejected as `unsupported_version`, so a later format change is detectable rather than silent.                                                                                                                                                                                                                                                                       |
| `documentId`  | Must match the UUID pattern, is lower-cased, and — when the caller also names a document in the body — the two must agree, or `token_mismatch`. The document is then **re-loaded through `findDocument()` under RLS plus an explicit tenant predicate**: a forged id naming another tenant's document resolves to nothing and answers `ERR-RES-001`, the same "not found" every out-of-scope read produces. |
| `versionId`   | UUID-checked and lower-cased. It is used as the **primary key of the new row**, never to look one up — so replaying a token collides on the key and is reported as `ERR-RES-002` rather than silently returning the existing version, whose checksum may differ from the one the caller is presenting.                                                                                                      |
| `contentType` | Must match `^[a-z0-9]+/[a-z0-9][a-z0-9.+-]*$`, and it is this re-validated value — not the request body — that is stored on the version row. The category allow-list was applied when the document was created; registration re-checks the **shape** and does not re-read the category.                                                                                                                     |
| `maxBytes`    | Never trusted on its own. The effective ceiling is `min(token.maxBytes, STORAGE_MAX_UPLOAD_BYTES)`, so inflating the token cannot raise the platform cap. The declared `byteSize` must then be an integer in `[1, ceiling]`.                                                                                                                                                                                |
| `exp`         | Re-checked against the server clock. An expired authorization answers `ERR-VAL-001` with rule `expired` and the caller must request a new one.                                                                                                                                                                                                                                                              |

And one field the token deliberately does **not** carry:

> **The storage key is not in the token, and is not read from the request.** It is _rebuilt_ from
> `NEXT_PUBLIC_APP_ENV`, the session-resolved `tenantId`, and the token's document and version ids,
> then asserted to sit under the caller's own tenant prefix by `keyBelongsToTenant()`. A caller
> therefore cannot name a key at all — which is what makes traversal and cross-tenant collision
> structurally impossible rather than filtered. The assertion that follows is unreachable while
> `buildStorageKey()` derives the tenant from context; it is kept because it is the check that would
> matter on the day that stopped being true.

Decoding is bounded before anything is parsed (empty or over 1024 characters is refused), and every
decode failure is reported as `ERR-VAL-001` with a machine-readable `rule`, because a malformed
token is a client defect the caller can fix by re-requesting authorization.

The honest counterpart: signing the token would need a key shared across instances, and **no key
management is provisioned**. That is recorded as an open decision rather than half-built. Nothing is
lost by leaving it unsigned, because the token was never the control — the operation's declared
permission, the RLS policies, and the re-derivation above are.

One further observation from the code, recorded rather than glossed: `AuthorizeUploadInput` carries
an `entityId`, and `authorizeUploadDetailed()` **validates `entityType` against the allow-list but
never reads `entityId`**. Authorization creates no link. Linking is a separate, separately audited
operation, and until it is called the document is reachable only by its own identifier within the
tenant.

## 6. The allow-lists

`ck_document_links_entity_type_format` constrains only the _shape_ of `entity_type` (`schema.table`),
because Phase 1-5 had no cross-domain foreign key to check against and still has none. Left at that,
`entity_type` would accept `zz.anything`, and the link-derived access contract would be reachable
from an entity nobody models. The application therefore carries the list, in
[`attachment-policy.ts`](../../../src/modules/shared-services/domain/attachment-policy.ts):

| `LINKABLE_ENTITY_TYPES` (8) | `LINK_PURPOSES` (7) |
| --------------------------- | ------------------- |
| `apt.appointments`          | `attachment`        |
| `crm.business_partners`     | `evidence`          |
| `org.legal_companies`       | `identity_document` |
| `quo.quotations`            | `inspection_media`  |
| `rec.reception_visits`      | `issued_document`   |
| `sal.invoices`              | `signature`         |
| `veh.vehicles`              | `supporting_report` |
| `wo.work_orders`            |                     |

Both lists are frozen at module load and are checked on the way in: `authorizeUploadDetailed()` and
`link()` each reject an unknown entity type with `unknown_entity_type`, and `link()` rejects an
unregistered purpose with `unknown_link_purpose`. All eight entity types were resolved against the
live catalog with `to_regclass` on 2026-07-23 and each names a table that exists.

Two limitations, stated rather than implied:

- **Membership of the list is not, today, asserted against `information_schema` by a committed
  test.** The module docblock describes such an assertion; no `tests/db/p1-15-attachments.test.ts`
  exists in the tree. Until one does, the list is kept correct by review, and drift between the list
  and the catalog would not be caught mechanically.
- **`entity_id` existence is not verified.** `link()` checks the type and the purpose and confirms
  the _document_ is in scope; it does not confirm that a row with that id exists in the named table.
  The Phase 1-5 residual — "a link may name a non-existent or wrong-domain `entity_id`", Medium,
  mitigated by the per-domain validation contract — therefore **remains open** in P1-15. This
  service is the generic attachment path; the contract in
  [document access and file security §4.1](../phase-1-5/document-access-and-file-security.md) binds
  the owning domain to validate the entity before it asks for a link.

## 7. The link-derived access contract

A document is reachable through a **live link to an entity the principal may see** — never by merely
knowing an identifier. That contract was established in Phase 1-5 and P1-15 composes it rather than
replacing it:

- `shared.document_links` is tenant-scoped with a composite `(tenant_id, document_id)` foreign key,
  so a cross-tenant link is structurally impossible.
- `shared.document_ids_for_entity(entity_type, entity_id)` is `SECURITY INVOKER` with an empty
  `search_path`, so it runs under the caller's own RLS and returns nothing across tenants and nothing
  for a withdrawn link.
- Withdrawal is a soft close. `AttachmentService.unlink()` stamps `deleted_at` through the only
  updatable column, the row remains for audit, and re-linking the same
  `(document, entity, purpose)` is permitted afterwards.
- Both link changes publish `document.link.changed` (`EVT-DOC-003`) with the `change` and the
  `entityType` — one event for both directions, because consumers react to the resulting
  _reachability_, not to the verb.

Possessing a `document_id`, a `version_id`, a `storage_key`, or a `sha256` grants **no access**. The
[storage-key convention §5](../../database/storage-key-convention.md) says so, and the download path
enforces it: `requestDownload()` resolves the version under RLS, refuses a state that is not
`accepted`, and — before signing anything — asserts that the stored key sits under the resolved
tenant's prefix. A row that passed RLS but whose key names another tenant is treated as a data
integrity fault (`ERR-SYS-001`), not as a row to serve, because signing it _would be_ the
cross-tenant read.

## 8. What is written to the audit trail, and what is deliberately withheld

Every stage appends an audit record through `appendAudit`, which reads tenant, actor, and
correlation from the handle — they cannot be supplied by a caller, because the type has no parameter
for them. Two values are recorded as _facts_ rather than as values:

| Value                    | Recorded as                   | Why                                                                                                                                                                                           |
| ------------------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The reserved storage key | `storage_key_issued = "true"` | A key is a locator that travels outside RLS in every downstream system — and the audit record is one of them. Recording that one was issued proves the event without propagating the locator. |
| The version's SHA-256    | `checksum_recorded = "true"`  | The checksum is an integrity value, not a secret, but it is also not useful in an audit trail, and storing it would let a reader confirm content they cannot otherwise read.                  |

The signed URL itself appears in no audit record, no log, no event, and no error. The download audit
record carries the document id, the version number, and the TTL — enough to reconstruct that a
capability was issued, and not the capability.

Events follow the same rule. `document.version.registered` (`EVT-DOC-002`) carries the version
number, content type, and `status: 'pending'` — **no storage key and no checksum**, because an event
travels further than a row and a consumer that needs either should read it under its own
authorization.

## 9. What Phase 1-15 does not deliver

Stated as a list so that no reader has to infer it from silence.

| Not delivered                 | Why, precisely                                                                                                                                                                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rename**                    | No `UPDATE` grant on `shared.documents`. `title` is set at creation and is not updatable by the request runtime.                                                                                                                                                           |
| **Re-classification**         | Same. `classification` and `retention_class` are taken from the category's defaults at creation and cannot be changed here.                                                                                                                                                |
| **Archival / soft delete**    | Same. `archived_at` and `deleted_at` on `shared.documents` are not grantable, and `guard_document_initial_state` refuses a row that arrives with either already set.                                                                                                       |
| **Retention enforcement**     | No disposition job, no legal-hold administration, no scheduled deletion. The retention _metadata_ is written; nothing acts on it.                                                                                                                                          |
| **Acceptance and quarantine** | §4. Refused twice over: by `upd_document_versions_reject`'s `WITH CHECK`, and by the scan-evidence guard.                                                                                                                                                                  |
| **Malware scanning**          | No scanner is configured or implemented. `scanState()` reports `scannerAvailable: false`.                                                                                                                                                                                  |
| **Byte transfer**             | No request handler reads or writes file content. The platform issues a URL; the transfer is between the client and an object store this phase does not provision.                                                                                                          |
| **Content-type verification** | The declared content type is trusted as a _request_, bounded by the category allow-list — never as a _fact_ about the bytes. Nothing here reads a byte, and no sniffing is claimed. Verifying that a stored object matches its declared type belongs to whatever scans it. |
| **Hard deletion of anything** | No `DELETE` privilege on any of the five relations for any application role.                                                                                                                                                                                               |
| **`document.accepted` event** | Catalogued as `EVT-DOC-001` with `implementedIn: null`. Not published by this phase.                                                                                                                                                                                       |

## 10. Governance

This document describes the committed implementation as read on 2026-07-23 against the working tree
and the local database at 117 applied migrations. It records owner-authorized technical self-review
under the Standing Technical Authorization and Solo Developer Review policies, and is **never**
represented as an independent review, independent QA, or a third-party audit.

**The Phase 1-15 owner gate is [Pending](./phase-1-15-owner-gate.md).** No production readiness,
availability, throughput, monitoring provisioning, or deployment outcome is claimed anywhere in this
document, and none is implied by anything in it.
