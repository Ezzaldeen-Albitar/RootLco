# Event Catalog v0.1

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Binding standard — reserved-name registry and envelope contract for every domain event from Phase 1-13 onward ·
**Date:** 2026-07-21 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (under the
[Standing Technical Authorization Policy](../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../governance/solo-developer-review-policy.md) —
owner-authorized technical self-review, never an independent third-party audit) ·
**Task IDs:** P1-13-BE-015, P1-13-BE-017, P1-13-DOC-002 ·
**Related:** [Queue Processing and Replay Standard](./queue-processing-and-replay-standard.md) ·
[Backend Architecture and Shared Foundation](./backend-architecture-and-shared-foundation.md) ·
[Transaction and Concurrency Standard](../database/transaction-and-concurrency-standard.md) ·
[ADR-014 Distributed Consistency Model](../adr/ADR-014-distributed-consistency-model.md) ·
Implementation: [`src/server/events/envelope.ts`](../../src/server/events/envelope.ts),
[`src/server/events/publisher.ts`](../../src/server/events/publisher.ts)

---

## 1. What this document is, and what it is not

This is a **reserved-name registry** and an **envelope contract**.

> **Phase 1-13 publishes no domain events.** The catalog fixes names, schema versions, and owning
> modules so that Phases 1-14 … 1-23 cannot invent conflicting ones. Every entry in §3 carries
> `implementedIn: null`, which means exactly what it says: **no code publishes it, and no consumer
> subscribes to it.** Registering a name does not publish it.

Two further facts are stated here rather than discovered later:

- **No message broker is introduced.** `shared.event_outbox` is the queue and the database is the
  source of truth in this phase. See the
  [Queue Processing and Replay Standard](./queue-processing-and-replay-standard.md) for why.
- **The request path may publish, and may not dispatch.** The `app_runtime` archetype holds
  tenant-scoped SELECT and INSERT on `shared.event_outbox`
  ([DBCR-P1-13-001](../database/change-requests/DBCR-P1-13-001-backend-runtime-write-grants.md)),
  so a producer can write its envelope inside its own transaction. It holds no UPDATE, no DELETE,
  and no EXECUTE on the claim, complete, or fail routines: advancing an envelope's lifecycle
  belongs to `app_worker` alone. Where the capability is not present on the connection,
  `publishEvent()` fails closed rather than degrading.

## 2. The envelope

The envelope mirrors `shared.event_outbox` exactly, because **the outbox row is the envelope**.
There is no second serialization that could drift from it. `buildEventEnvelope()` reproduces the
frozen column contracts in TypeScript so a bad envelope fails with a readable message instead of as
a constraint violation from four layers down.

| Envelope field     | Column                         | Contract enforced before insert                                                 |
| ------------------ | ------------------------------ | ------------------------------------------------------------------------------- |
| `eventKey`         | `event_key`                    | 1–255 non-blank characters. **Unique per tenant** (`uq_event_outbox_event_key`) |
| `eventType`        | `event_type`                   | `^[a-z][a-z0-9_.-]{1,62}$`, **and** must be registered in the catalog           |
| `schemaVersion`    | `schema_version`               | Taken from the catalog entry, never from the caller                             |
| `aggregateType`    | `aggregate_type`               | `^[a-z][a-z0-9_.-]{1,62}$`; taken from the catalog entry                        |
| `aggregateId`      | `aggregate_id`                 | The identifier of the aggregate the event is about                              |
| `aggregateVersion` | `aggregate_version` (`bigint`) | Integer ≥ 1                                                                     |
| `producer`         | `producer`                     | `^[a-z][a-z0-9_.-]{1,62}$`                                                      |
| `occurredAt`       | `occurred_at`                  | Defaults to the build instant                                                   |
| `correlationId`    | `correlation_id`               | **Always from the request context**, never from the caller                      |
| `causationId`      | `causation_id`                 | From the caller or the request context; `null` is legitimate                    |
| `payload`          | `payload` (`jsonb`)            | Object; serialized once at insert                                               |
| `headers`          | `headers` (`jsonb`)            | Object; defaults to `{}`                                                        |
| `companyId`        | `company_id`                   | Nullable                                                                        |
| `branchId`         | `branch_id`                    | Nullable                                                                        |
| —                  | `tenant_id`                    | From the request context, never from the caller                                 |
| —                  | `created_by`                   | From the request context principal                                              |

Columns the worker reads and the producer never writes: `id`, `status`
(`pending` / `claimed` / `dead_letter`), and `attempt_count`, which the database increments on
claim.

### 2.1 Rules the envelope enforces, and why

- **An unregistered event type is rejected.** An event nobody declared is an event no consumer can
  be written against.
- **`schemaVersion` and `aggregateType` come from the catalog, not the call site.** Two producers
  of the same event name cannot disagree about its shape.
- **The correlation ID always comes from the request context.** An event that claims a different
  correlation than the request that produced it breaks the trace it exists to provide.
- **`event_key` is unique per tenant, so publication is idempotent at the database level** rather
  than by convention. A producer that retries its own command cannot emit the same event twice. A
  duplicate key surfaces as `ERR-INT-001` rather than being swallowed, because the unique violation
  aborts the transaction and the caller must decide.
- **The row is written inside the producer's transaction** (BR-INT-001). There is no "publish after
  commit" path, because that is precisely the window in which a crash loses the event.
- **`aggregate_version` arrives from the driver as a string** (it is a `bigint`) and is converted at
  the worker boundary, so the consumer contract stays numeric without a precision surprise.

## 3. Reserved event names

Seven names are reserved. `EVT-` codes come from the Chapter 4 Table 4.5 allocation in the canonical
documents (see [canonical-documents.md](../governance/canonical-documents.md); those documents live
outside this repository by owner decision).

| Code            | Event type                     | Schema version | Aggregate type            | Owner module | `implementedIn` | Description                                                       |
| --------------- | ------------------------------ | -------------- | ------------------------- | ------------ | --------------- | ----------------------------------------------------------------- |
| **EVT-IAM-001** | `access.grant.changed`         | 1              | `iam.role_grant`          | `iam`        | **`null`**      | A role grant was created, modified, or revoked for a user.        |
| **EVT-CRM-001** | `business-partner.merged`      | 1              | `crm.business_partner`    | `crm`        | **`null`**      | Two business partners were merged; the survivor is the aggregate. |
| **EVT-VEH-001** | `vehicle.relationship.changed` | 1              | `veh.vehicle`             | `veh`        | **`null`**      | A vehicle ownership or authorised-person relationship changed.    |
| **EVT-APT-001** | `appointment.changed`          | 1              | `apt.appointment`         | `apt`        | **`null`**      | An appointment was booked, rescheduled, or cancelled.             |
| **EVT-REC-001** | `vehicle.checked-in`           | 1              | `rec.reception_visit`     | `rec`        | **`null`**      | A vehicle was received and custody was accepted.                  |
| **EVT-DOC-001** | `document.accepted`            | 1              | `shared.document`         | `shared`     | **`null`**      | A document version passed scanning and was accepted.              |
| **EVT-NTF-001** | `message.delivery.changed`     | 1              | `shared.outbound_message` | `shared`     | **`null`**      | An outbound message changed delivery state.                       |

`implementedIn: null` is the honest state of all seven: **reserved only**. Nothing publishes them,
nothing consumes them, and no payload schema for them exists yet. The phase that implements a name
sets `implementedIn` to its own identifier in the same change that adds the producer.

The `owner` column is enforced, not documentary: the owning module is the only module that may
publish that event.

## 4. Registration process

Reserving or implementing an event is a change to `src/server/events/envelope.ts` and to this
document, in the same pull request.

1. **Choose the wire name.** Lower-case, dot- and hyphen-separated, in the shape
   `<subject>.<change>` (`appointment.changed`) or `<subject>.<state>` (`vehicle.checked-in`). It
   must satisfy `^[a-z][a-z0-9_.-]{1,62}$`. Name the **fact that happened**, in the past tense —
   not the command that caused it and not the reaction expected from it.
2. **Take an `EVT-` code** in the owning module's allocation.
3. **Name the aggregate type** as `<schema>.<table>` for the aggregate the event is about. It must
   satisfy the same format regex.
4. **Set `schemaVersion: 1`** for a new name.
5. **Set `implementedIn`.** Use `null` while the name is reserved only. Set it to the phase
   identifier in the change that adds a real producer — never before.
6. **Write the description** as a single sentence stating what happened, including which entity is
   the aggregate when that is ambiguous (as `business-partner.merged` does).
7. **Add the row to §3 of this document.**
8. **When implementing publication**, add the producer in the owning module's application service,
   inside the business transaction, with an `event_key` derived from the command so a retry
   deduplicates. Consumers register through `registerConsumer()` and must declare their supported
   schema versions.

### 4.1 Schema versioning

- **Bump `schemaVersion` for an incompatible payload change**: a removed field, a renamed field, a
  narrowed type, or a changed meaning.
- **Adding an optional field is compatible** and does not require a bump, provided every registered
  consumer ignores unknown fields.
- **Consumers declare `supportedSchemaVersions` explicitly.** A version no consumer declares is
  treated as a **poison message** — reported rather than applied, because silently ignoring a
  payload shape you do not understand is how a consumer skips half a migration and nobody notices.
  See the [Queue Processing and Replay Standard](./queue-processing-and-replay-standard.md).
- **During a version transition**, a consumer declares both versions until every in-flight and
  dead-lettered event of the old version is drained.

### 4.2 Immutability rules

- **A wire name is never reused for a different fact**, and an `EVT-` code is never renumbered.
- **The owning module of a name does not change** without a superseding record; the owner is the
  authority for that event's meaning.
- **Retiring a name** means marking the row in §3 as retired with the date and the reason, after
  no producer emits it and no consumer subscribes. The name is not made available again.

### 4.3 What must not go in a payload

An event payload is a business fact, not a document dump.

- No values classified restricted in the personal-data registries. Reference them by identifier.
- No credentials, tokens, or authorization headers.
- No file or document contents.
- No unbounded collections. If a consumer needs the full set, it reads it under its own
  authorization; the event carries the identifiers.

The outbox has no RLS-scoped read for the runtime archetype and is drained by an all-tenant worker
role, so a payload is visible to the dispatcher regardless of the tenant that produced it. That is
the reason the rules above are rules and not preferences.

## 5. Review and governance

Nothing reached protected develop outside the approved pull-request and hosted-CI flow. The work
was reviewed under the Standing Technical Authorization and Solo Developer Review policies.

Owner: Eng. Ezzaldeen Al-Bitar. No independent third-party review, external audit, or separation of
duties exists or is claimed.
