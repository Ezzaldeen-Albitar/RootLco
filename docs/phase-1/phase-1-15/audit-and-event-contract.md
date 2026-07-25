# Phase 1-15 — Audit and Event Contract

**Company:** RootLco — Root Link Company · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Release group:** Release 3 — Backend Foundation · **Date:** 2026-07-23 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md) — never an
independent third-party audit, and never independent QA).

**Owner gate:** [Phase 1-15 Owner Gate](./phase-1-15-owner-gate.md) — **Pending**. Nothing in this
document records or anticipates a gate decision.

**Implemented by:** [`src/server/audit/audit.ts`](../../../src/server/audit/audit.ts) ·
[`src/server/auth/audit-actions.ts`](../../../src/server/auth/audit-actions.ts) ·
[`src/server/events/envelope.ts`](../../../src/server/events/envelope.ts) ·
[`src/server/events/publisher.ts`](../../../src/server/events/publisher.ts)

**Related:** [Audit Integrity Design](../../security/audit-integrity-design.md) ·
[Event Catalog v0.1](../../standards/event-catalog-v0.1.md) ·
[Queue Processing and Replay Standard](../../standards/queue-processing-and-replay-standard.md) ·
[ADR-014 — Distributed Consistency Model](../../adr/ADR-014-distributed-consistency-model.md) ·
[DBCR-P1-13-001](../../database/change-requests/DBCR-P1-13-001-backend-runtime-write-grants.md) ·
[DBCR-P1-15-001](../../database/change-requests/DBCR-P1-15-001-shared-services-runtime-write-capabilities.md)

---

## 1. One transaction, three writes

An audit record that survives a rolled-back command is a lie. A command that commits without its
audit record is an integrity hole. An event that escapes for a transaction that never committed sends
consumers chasing state that does not exist.

All three problems have the same solution and P1-15 inherits it unchanged from Phase 1-13: the state
change, the audit append, and the outbox insert are issued on the **same `DbHandle`**, inside the same
transaction, so they commit or roll back as one. Neither `appendAudit()` nor `publishEvent()` opens a
connection, and neither has an "after commit" path — that path is exactly the window in which a crash
loses the record.

## 2. The audit contract

### 2.1 The application never builds an audit record

`appendAudit()` calls `iam.audit_append`, which is the only supported way to write
`iam.audit_records`. The application does not construct the canonical form and does not compute the
hash. Doing either in TypeScript would create a second implementation of the chain that could
disagree with the verifier — and a chain whose writer and verifier disagree proves nothing.

Identity is not a parameter. Tenant, actor, and correlation are read off `db.context`, so an audit
record cannot claim a different actor than the one the request authenticated as:

| `iam.audit_append` parameter | Value passed                                                |
| ---------------------------- | ----------------------------------------------------------- |
| `p_tenant`                   | `db.context.principal.tenantId`                             |
| `p_actor`                    | `db.context.principal.userId`                               |
| `p_correlation`              | `db.context.correlationId`                                  |
| `p_request_ref`              | caller's `requestRef`, defaulting to `db.context.operation` |

The caller supplies only what the record is _about_: `action`, `entityType`, `entityId`, optional
`companyId`/`branchId`, `actorKind` (`user` for a human, `system` for a worker or scheduled action),
and the classification-tagged `details`.

### 2.2 The hash chain

Per tenant, `iam.audit_append` does the following inside the caller's transaction:

1. takes `pg_advisory_xact_lock(hashtext('iam.audit:' || tenant))`, held to COMMIT, so concurrent
   appends cannot fork the chain;
2. assigns `seq = max(seq) + 1` from `iam.audit_integrity_links` — the chain, not the record table,
   is the sequence authority;
3. inserts the header row and one `iam.audit_record_details` row per detail entry;
4. reads the previous `record_hash`, defaulting to **32 zero bytes** for a tenant's first record;
5. builds the canonical form with `iam.audit_canonical` — a deterministic JSON object over tenant,
   seq, actor, actor kind, action, entity type and id, company, branch, correlation, request ref, the
   occurrence timestamp rendered in UTC to microseconds, and the details ordered by field name;
6. computes `sha256(prev_hash || canonical)` and writes the link row.

Two design choices are worth naming. The canonical form is built by **reading back the row that was
just written**, so the hash covers what the database actually stored rather than what the caller
intended; where the caller cannot read that row back, the function raises `insufficient_privilege`
with a message naming the cause instead of failing later on a NOT NULL violation. And the details are
ordered by field name inside the canonical form, so two appends with the same facts in a different
argument order hash identically.

### 2.3 Classification-tagged details, and masking

Each detail entry carries a `classification`, and the classification decides what is stored:

| Classification | Stored by `iam.audit_mask` |
| -------------- | -------------------------- |
| `public`       | the value, intact          |
| `internal`     | the value, intact          |
| `restricted`   | `***`                      |
| `secret`       | `***`                      |

The raw value of a restricted or secret field **never lands in the audit tables** — masking happens
inside the append, not on the way out at read time, so there is no configuration in which a reader
sees the original. `AUDIT_CLASSIFICATIONS` in TypeScript lists exactly the four values
`ck_audit_record_details_class` accepts. Offering a fifth would not widen the contract; it would abort
the whole command on a CHECK violation, and the rejected row — raw values included — would surface in
the PostgreSQL error DETAIL before any masking had run.

One translation step matters more than it looks. The database reads `field`, `old`, `new`, and
`class` out of each JSON element, so `toDetailEnvelope()` renames the TypeScript shape before it goes
in. Passing the TypeScript shape through unchanged would leave all three of `old`, `new`, and `class`
undefined, and the function would store the field name with NULL values at the default `internal`
classification — an audit record saying a field changed while recording neither what it changed from
nor to.

### 2.4 The privilege surface, measured

Queried against the local Supabase PostgreSQL container on 2026-07-23,
`information_schema.role_table_grants` for `iam.audit_records`, `iam.audit_record_details`, and
`iam.audit_integrity_links` returns, for the runtime archetypes, exactly `SELECT` and `INSERT` for
`app_runtime` and `SELECT` for `app_readonly` on each of the three tables. **No `UPDATE` and no
`DELETE` appears for any application role.** `iam.audit_append`, `iam.audit_mask`, `iam.audit_hash`,
and `iam.audit_canonical` all report `prosecdef = false` — they are `SECURITY INVOKER`, so none of
them is a privilege escalation path.

### 2.5 The capability gate fails closed

`appendAudit()` calls `requireCapability(db, 'audit.append')` before it writes, and `publishEvent()`
calls `requireCapability(db, 'outbox.publish')`. The probe asks PostgreSQL what the current connection
may actually do rather than assuming a migration was applied, and there is deliberately **no "skip
the audit record and continue" branch**. A refused command is better than a state change with no
evidence, because the second kind of failure is invisible until an investigation needs the record
that was never written.

## 3. The audit-action catalog

Before [`audit-actions.ts`](../../../src/server/auth/audit-actions.ts) existed, `auditAction` was a
free-form string validated only for presence. Two operations could record the same fact under
`iam.role.granted` and `iam.grant.created`, and a query written against either spelling would silently
miss half the evidence. An audit trail nobody can query completely is not an audit trail.

The catalog fixes three things per action and makes them checkable: the **code** that lands in
`iam.audit_records.action`; the **audit class** the producing operation must declare; and the
**entity type** written to `entity_type`, so it is consistent across every producer of the same fact.

Enforcement sits in two places on purpose. `defineOperation()` rejects an unregistered code — or one
whose declared class disagrees with the catalog — at module load, which surfaces in tests and in the
build. `scripts/check-authorization-coverage.mjs` re-checks the same thing by reading the source, so
an operation no test ever imports still fails CI.

**Codes are permanent.** An action code is written into an append-only, hash-chained table; renaming
it would orphan every historical record, and the chain cannot be rewritten to follow. A code is
retired by removing its producer, never by reuse for a different fact.

The catalog holds **41** action codes in total. **15** were added by P1-15; the remaining 26 belong to
Phase 1-14 identity, authorization, and organization-settings administration and are unchanged.

## 4. The P1-15 audit actions

| Code                                  | Class        | `entityType`              | What the record captures                                                                                                                                                                                                                              |
| ------------------------------------- | ------------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `org.branch.status_changed`           | privileged   | `org.branch`              | A branch moved between active and inactive through the status-transition engine. Details: `status` previous → new, and the operator's `reason`, both `internal`.                                                                                      |
| `shared.document.created`             | privileged   | `shared.document`         | Document metadata created; no bytes exist yet. **See the note below — this code has no producer in the committed tree.**                                                                                                                              |
| `shared.document.upload_authorized`   | **security** | `shared.document`         | A storage key was reserved and a short-lived signed upload URL issued. Details: `category_code`, `content_type` (public), `byte_size`, `entity_type` (internal), and `storage_key_issued = true` — the key itself is never audited.                   |
| `shared.document.version_registered`  | privileged   | `shared.document_version` | A version was registered as **pending**. Details: `document_id` (internal), `version_number`, `content_type` (public), `size_bytes` (internal), `checksum_recorded = true`.                                                                           |
| `shared.document.version_rejected`    | privileged   | `shared.document_version` | A pending version was rejected; the state is terminal. Details: `status` `pending` → `rejected` (public) and a `reason` (internal, truncated).                                                                                                        |
| `shared.document.download_authorized` | **security** | `shared.document_version` | A short-lived signed download URL was issued for an accepted version. Details: `document_id` (internal), `version_number` and `ttl_seconds` (public).                                                                                                 |
| `shared.document.linked`              | privileged   | `shared.document_link`    | A document became reachable from a business entity. Details: `document_id`, `entity_id` (internal), `entity_type`, `link_purpose` (public).                                                                                                           |
| `shared.document.unlinked`            | privileged   | `shared.document_link`    | A link was withdrawn; reachability through that entity ends. Details: `document_id` (internal), `entity_type` (public).                                                                                                                               |
| `shared.notification.enqueued`        | privileged   | `shared.outbound_message` | A message was enqueued from an approved template version. Details: `channel`, `purpose`, `locale` (public), `template_version_id`, `consent_record_id` (internal), and `dedupe_key` + `recipient_ref` as **`restricted`**, so both are stored masked. |
| `shared.template.created`             | privileged   | `shared.message_template` | A tenant template was created. Details: `template_code`, `channel`, `purpose`, `locale_code`, all public.                                                                                                                                             |
| `shared.template.updated`             | privileged   | `shared.message_template` | Name, description, status, or active version changed. Details carry previous → new for the changed fields; `active_version_id` is `internal`.                                                                                                         |
| `shared.template.version_created`     | privileged   | `shared.template_version` | A draft version was created, or its draft content revised.                                                                                                                                                                                            |
| `shared.template.version_approved`    | approval     | `shared.template_version` | A draft version was approved. Approved content is immutable and is what messages are sent from — hence the `approval` class rather than `privileged`.                                                                                                 |
| `shared.template.version_retired`     | privileged   | `shared.template_version` | An approved version was retired and can no longer become active.                                                                                                                                                                                      |
| `shared.export.authorized`            | export       | `shared.export_request`   | An export was authorized: `resource`, `fields`, `filter_count` (public), `estimated_rows`, `sensitive_fields_included` (internal), and the operator's `reason` as **`restricted`**.                                                                   |

Two honest notes on this table.

`shared.export.authorized` records `entityId = null`. No export-request table exists in the frozen
schema, so there is no row to point at; **the audit record is the artefact**. Minting an identifier
that references nothing would look tidier and mean less. Nothing in P1-15 generates an export file —
the action records an authorization decision only.

`shared.document.created` is registered in the catalog but **no code in the tree records it**. The
document row and the upload authorization are created in the same operation, and that operation
records `shared.document.upload_authorized`. The registration is therefore a reserved code awaiting a
producer, not evidence that a "document created" record will appear in the trail. It is listed here
because omitting it would misrepresent the catalog, and annotated because listing it silently would
misrepresent the behaviour.

## 5. Why upload and download authorization are SECURITY, not PRIVILEGED

Every other attachment action in the table is `privileged` — ordinary administration by someone who
holds the permission. The two authorization actions are `security`, and the difference is deliberate.

Issuing a signed URL **hands out a bearer capability to bytes**. Whoever holds the URL can read or
write the object for its lifetime, outside RLS, outside the session, and outside any subsequent
permission change: revoking the grant does not revoke the URL. The audit record is the only durable
evidence that the capability was ever issued, to whom, and when.

Filing it as `security` therefore changes how it is triaged: it belongs beside authentication events
and grant changes, in the same review surface people already watch for signs of exfiltration, rather
than in the ordinary-administration stream where a burst of download authorizations would read as
routine activity. The class is not decoration — `defineOperation()` refuses an operation whose
declared class disagrees with the catalog, so the classification cannot be quietly downgraded at the
call site.

The corollary is what the records deliberately omit. The **storage key is never audited**: it is a
locator that travels outside RLS into every downstream system, and an audit trail is one of those
systems. The upload record states `storage_key_issued = true` and stops there. Likewise the version
checksum is recorded as `checksum_recorded = true` rather than as a value, because a reader could
otherwise confirm content they are not permitted to read.

One qualification, so the reasoning is not mistaken for a claim about deployed infrastructure. **No
production object store is provisioned by this phase.** Storage is a port whose default is
`unconfigured` — it refuses to sign rather than returning a URL that leads nowhere — with a
deterministic local adapter, selected explicitly, that signs against a `.invalid` host so an issued
URL can be asserted in a test and can never resolve in the world. The `security` classification is
set for the property the action would have wherever it runs, not because a store exists to point at.

## 6. The event contract

### 6.1 The envelope is the outbox row

`buildEventEnvelope()` mirrors `shared.event_outbox` exactly. There is no second serialization that
could drift from the table, and the frozen column CHECKs are reproduced in TypeScript so a bad
envelope fails with a readable message rather than as a constraint violation from four layers down.

| Envelope field          | Origin                                         | Contract enforced before insert                                                           |
| ----------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `eventKey`              | caller                                         | 1–255 non-blank characters; unique per tenant (§6.3)                                      |
| `eventType`             | caller                                         | `^[a-z][a-z0-9_.-]{1,62}$` **and** registered in the catalog                              |
| `schemaVersion`         | **catalog entry**                              | never taken from the caller                                                               |
| `aggregateType`         | **catalog entry**                              | `^[a-z][a-z0-9_.-]{1,62}$`                                                                |
| `aggregateId`           | caller                                         | the aggregate the event is about                                                          |
| `aggregateVersion`      | caller                                         | integer ≥ 1                                                                               |
| `producer`              | caller                                         | `^[a-z][a-z0-9_.-]{1,62}$`, and its leading segment must equal the catalog `owner` (§6.2) |
| `occurredAt`            | caller, defaulting to now                      | —                                                                                         |
| `correlationId`         | **`db.context.correlationId`**                 | impossible to supply — omitted from `publishEvent()`'s input type                         |
| `causationId`           | caller, defaulting to `db.context.causationId` | —                                                                                         |
| `payload`, `headers`    | caller                                         | serialized as `jsonb`                                                                     |
| `companyId`, `branchId` | caller, defaulting to `null`                   | —                                                                                         |

Correlation is not negotiable for the same reason actor identity is not negotiable in an audit
record: an event that claims a different correlation than the request that produced it breaks the
trace it exists to provide.

### 6.2 Catalog ownership is enforced, not documentary

An event type absent from the catalog is refused outright — an event nobody declared is an event no
consumer can be written against. Beyond that, the catalog's `owner` column is **checked at publish
time**: the producer id is `<module>` or `<module>.<component>`, and its leading segment must equal
the owning module.

The owning module is the authority for what an event name _means_. If a second module could publish
the same name, the meaning would be ambiguous and no consumer could tell which producer it was
reacting to. Phase 1-13 wrote this rule into the Event Catalog standard without implementing it;
it is implemented rather than left as a security-shaped claim with nothing behind it.

This is why every P1-15 entry is owned by `shared`, **including `organization.branch.status.changed`,
whose aggregate lives in `org`**. The P1-15 status-transition engine is the publisher, and `owner`
names the module permitted to publish — not the schema the aggregate belongs to. Assigning it to
`org` would mean no module could ever publish it, because no `org` module exists.

### 6.3 `event_key` is the idempotency boundary

`uq_event_outbox_event_key` is `UNIQUE (tenant_id, event_key)` — verified against the live catalog.
Deduplication is therefore a database property rather than a convention a producer might forget: a
command that retries cannot emit the same event twice.

The unique violation still aborts the transaction it occurs in, so `publishEvent()` does not swallow
it. It surfaces as `ERR-INT-001` naming the key, and the caller decides what a repeat means for its
own command. Silently returning success would leave the caller believing a write happened inside a
transaction PostgreSQL had already doomed.

Keys are constructed from identity plus the discriminator that makes a repeat meaningful — for
example `document.link:<linkId>:linked` and `document.link:<linkId>:unlinked` are distinct keys for
the same link, and the transition engine keys on `<aggregate>:<id>:<newVersion>`, so a replay of the
same version is refused while a genuine later transition is not.

### 6.4 The transactional outbox and BR-INT-001

`publishEvent()` writes one row into `shared.event_outbox` on the caller's handle. That is the whole
pattern, and it is what makes **BR-INT-001** true: _an event exists if and only if the transaction
that produced it committed._

Dispatch to consumers is the worker's job. Measured on 2026-07-23, `app_runtime` holds `SELECT` and
`INSERT` on `shared.event_outbox` and nothing else, while `app_worker` additionally holds `UPDATE` —
so a request can write its envelope but **cannot** advance an envelope's lifecycle or mark it
dispatched.

**No message broker exists.** The database outbox is the queue in this phase. A broker cannot enlist
in the producer's transaction, so adding one would place an unproven delivery path beside a proven
one, and no availability, ordering, or delivery-latency property is claimed for what is there.

## 7. The P1-15 events

The catalog holds **15** reserved names in total; **5** were added by P1-15, and one earlier entry
(`message.delivery.changed`) is marked as implemented by this phase.

| Code          | Wire name                            | Aggregate                 | Producer               | Payload, and what it deliberately omits                                                                                                                                                                                                         |
| ------------- | ------------------------------------ | ------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EVT-DOC-002` | `document.version.registered`        | `shared.document`         | `shared.attachments`   | `{ versionNumber, contentType, status: 'pending' }`. **No storage key and no checksum** — a consumer needing either reads the row under its own authorization.                                                                                  |
| `EVT-DOC-003` | `document.link.changed`              | `shared.document`         | `shared.attachments`   | `{ change, entityType }`. One name covers link and unlink because consumers react to the resulting reachability.                                                                                                                                |
| `EVT-NTF-002` | `message.enqueued`                   | `shared.outbound_message` | `shared.notifications` | `{ channel, purpose, locale }`. **No recipient, no rendered content, no dedupe key.**                                                                                                                                                           |
| `EVT-TPL-001` | `message-template.version.changed`   | `shared.message_template` | `shared.templates`     | `{ change }` for created / approved / retired / activated. **No subject and no body** — template content is tenant configuration.                                                                                                               |
| `EVT-ORG-001` | `organization.branch.status.changed` | `org.branch`              | `shared.transitions`   | `{ from, to }`. **No reason** — the free text stays in the history table, readable under the reader's own authorization.                                                                                                                        |
| `EVT-NTF-001` | `message.delivery.changed`           | `shared.outbound_message` | —                      | Reserved and marked `implementedIn: 'P1-15'`, but **no `publishEvent()` call site for this name exists in the tree**. Delivery state is written by the worker to the message row and `shared.delivery_attempts`; no envelope is emitted for it. |

The omissions in the right-hand column are the same decision repeated: **an event travels further
than the row it describes.** It is written once and may be read by any consumer, replayed, retained,
and copied into systems with their own access rules. So a payload carries the minimum a consumer needs
to decide whether to act, and anything sensitive stays behind a read the consumer must perform under
its own authorization.

## 8. Why no event name carries a `.v1` suffix

The planning text used names such as `document.version.registered.v1`. No name in the catalog carries
a version suffix, and this is enforced: a foundation test asserts that no `eventType` matches
`/\.v\d+$/` and that none contains `.v1`.

The payload version is already a first-class field. `schema_version` is a column on
`shared.event_outbox` and is taken **from the catalog entry, never from the caller**. Putting the same
number in the wire name would create two ways to express one fact, and two ways to express one fact
are two things that can disagree.

The failure mode is concrete rather than theoretical. If the name carried the version, a compatible
payload change that bumped `schema_version` to 2 would either force a new wire name — and every
consumer subscribed to the old one silently receives nothing, with no error anywhere — or force the
name and the column to disagree. Keeping the version in the column means a consumer subscribes to a
stable name and inspects `schema_version` to decide how to read the payload, which is the case the
field exists for.

An incompatible payload change bumps `schema_version` on the existing entry. A genuinely different
fact gets a genuinely different name.

## 9. What this document does not claim

- **No independent review.** Everything above is owner-authorized technical self-review. No
  third-party audit, external QA, or independent verification of any kind was performed.
- **No malware scanning.** No scanner is configured, and no application role may write
  `shared.file_scan_results`, which the version-transition guard requires before a version may become
  `accepted`. Document acceptance is therefore unavailable in this phase, and
  `shared.document.download_authorized` can only ever be recorded for a version that something
  outside this application accepted.
- **No monitoring or alerting.** Audit and event records are written; nothing is provisioned to watch
  them, alert on them, or retain them beyond the database. No SLO, throughput, or delivery-latency
  figure is stated.
- **No broker, no replication, no failover.** The outbox is the queue and the database is the source
  of truth in this phase.
- **No chain verification schedule.** The hash chain makes tampering _detectable_; detecting it
  requires someone to run a verification, and no scheduled verification job is provisioned here.
- **The two annotated gaps in §4 and §7 are real** — a registered audit code with no producer, and a
  catalog entry marked as implemented by this phase with no publisher — and are recorded rather than
  smoothed over.

## 10. Related documents

- [Audit Integrity Design](../../security/audit-integrity-design.md) — the tamper-evidence goal, the
  structures, and the writer/reader model the chain in §2.2 implements.
- [Event Catalog v0.1](../../standards/event-catalog-v0.1.md) — the reserved-name registry and the
  envelope contract §6 implements.
- [Queue Processing and Replay Standard](../../standards/queue-processing-and-replay-standard.md) —
  why the outbox is the queue and why no broker is introduced.
- [ADR-014 — Distributed Consistency Model](../../adr/ADR-014-distributed-consistency-model.md) —
  where BR-INT-001 is defined.
- [Binding implementation decisions](./phase-1-15-implementation-decisions.md) §2.5 and §2.8 — the
  rules that audit actions are extended rather than invented at the call site, and that document
  acceptance remains unavailable.
- [Phase 1-15 Owner Gate](./phase-1-15-owner-gate.md) — **Pending**.
