# Phase 1-15 — Notification Architecture

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Release group:** Release 3 — Backend Foundation ·
**Phase:** P1-15 — Shared Services Backend ·
**Date:** 2026-07-23 ·
**Owner gate:** **Pending** — this document records design and behaviour, not a gate decision. ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent review, independent QA, or a third-party audit.**

**Related:** [Binding implementation decisions](./phase-1-15-implementation-decisions.md) ·
[Template policy](./template-policy.md) ·
[P1-15 owner gate](./phase-1-15-owner-gate.md) ·
[DBCR-P1-15-001](../../database/change-requests/DBCR-P1-15-001-shared-services-runtime-write-capabilities.md) ·
[Notification data contract (P1-5)](../phase-1-5/notification-data-contract.md) ·
[Backend Architecture and Shared Foundation](../../standards/backend-architecture-and-shared-foundation.md)

---

## 1. What this document is about

Phase 1-13 froze [`NotificationService`](../../../src/server/contracts/notification-service.ts) as a
contract and shipped a stub that answered `ERR-STB-001`. Phase 1-15 fills it. This record explains
how the implementation behaves, why it is shaped that way, and — in §11 — precisely what it does
**not** guarantee.

Every statement below was checked against the merged source or against the live local PostgreSQL
catalogue. Where a claim comes from the database it is stated as the database states it.

## 2. Enqueue-first, and why no provider is contacted in the source transaction

The durable outcome of a successful `queueMessage()` call is **one row in
`shared.outbound_messages` with `status = 'pending'`**. Nothing is delivered, and no provider is
contacted, anywhere in the caller's transaction. Everything after the row belongs to a worker
process running on a different database role.

Inside the caller's transaction,
[`SharedNotificationService.queueMessageWithRendering()`](../../../src/modules/shared-services/application/notification-service.ts)
does exactly this, in order:

| Step | What happens                                                               | Why it is here and not later                                                                          |
| ---- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1    | Channel, dedupe key, recipient reference and consent are checked in memory | Pure decisions; a refusal costs no database work and names the offending field                        |
| 2    | The template version is read and checked against the request               | A message must come from an approved, immutable version — see [template policy](./template-policy.md) |
| 3    | The content is rendered once                                               | Rendering is deterministic, so its digest is meaningful (§11)                                         |
| 4    | The row is inserted, with the digest and never the content                 | The insert is the commitment; the content is not part of it                                           |
| 5    | An audit entry is appended on the same handle                              | Same transaction, so the audit exists if and only if the message does                                 |
| 6    | `message.enqueued` is published through the transactional outbox           | Same commit, for the same reason — see [`publisher.ts`](../../../src/server/events/publisher.ts)      |

A provider call placed inside step 4 would hold a database transaction open across a network round
trip, and would make the _business_ write's durability depend on a third party's availability. The
enqueue-first split removes both properties. It also means a message survives a total absence of
delivery capability: with `NOTIFICATION_PROVIDER` at its default (`unconfigured`), enqueueing still
succeeds, because the row is the record and delivery is a separate concern.

The HTTP surface preserves the split. [`POST /api/v1/notifications`](../../../src/app/api/v1/notifications/route.ts)
answers **202** for a newly enqueued message and **200** when the dedupe key matched an existing
one — an accepted request, not a delivered message. It calls `queueMessage()` rather than
`queueMessageWithRendering()`, so rendered content never crosses the HTTP boundary.

## 3. The lifecycle graph the database guard accepts

`shared.guard_outbound_message_lifecycle()` is the authority. It rejects an **INSERT** whose status
is anything but `pending`, whose `retry_count` is not zero, or which carries a `failure_class` or any
of the six lifecycle stamps (`queued_at`, `sending_at`, `sent_at`, `delivered_at`, `failed_at`,
`cancelled_at`). On **UPDATE** it accepts exactly these edges:

| From      | To          | Guard behaviour                                                                                    | Used by the dispatcher             |
| --------- | ----------- | -------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `pending` | `queued`    | stamps `queued_at`                                                                                 | yes — `promotePending()`           |
| `pending` | `cancelled` | stamps `cancelled_at`                                                                              | no                                 |
| `queued`  | `sending`   | stamps `sending_at`                                                                                | yes                                |
| `queued`  | `cancelled` | stamps `cancelled_at`                                                                              | no                                 |
| `sending` | `sent`      | stamps `sent_at`                                                                                   | yes                                |
| `sending` | `failed`    | **requires** a non-blank `failure_class`; stamps `failed_at`                                       | yes                                |
| `sent`    | `delivered` | stamps `delivered_at`                                                                              | yes                                |
| `sent`    | `failed`    | **requires** a non-blank `failure_class`; stamps `failed_at`                                       | declared, not reached in this code |
| `failed`  | `queued`    | increments `retry_count`, clears `failure_class` and every downstream stamp, re-stamps `queued_at` | yes — the retry edge               |
| `failed`  | `cancelled` | stamps `cancelled_at`; `failure_class` may stand                                                   | yes — the dead-letter edge         |

Anything else raises `invalid outbound message transition: X to Y` as a `check_violation`. Two
further properties matter more than the edge list:

- **Timestamps are server-owned.** Any statement that changes a lifecycle stamp itself is refused
  (`outbound lifecycle timestamps are server-controlled`), and a same-status update that touches a
  lifecycle field is refused too. The application therefore writes `status` — and, where the guard
  demands it, `failure_class` — and nothing else.
- **`retry_count` is server-owned.** It changes only on `failed → queued`, and only by the guard.
  A caller cannot inflate it and cannot reset it, which is what makes the retry budget in §8 a real
  bound rather than a suggestion.

The dispatcher's edge table,
[`DISPATCH_TRANSITIONS`](../../../src/modules/shared-services/data/message-dispatch-repository.ts),
declares eight of the ten edges. The two `cancelled` edges out of `pending` and `queued` are
accepted by the database but are not exercised by any code in this phase; they exist for an operator
path that has not been built.

Concurrency is handled by the `status = $from` predicate on every UPDATE: two dispatchers that both
believe a message is `queued` cannot both move it to `sending`, because the second matches zero rows
and is reported as `skipped: lost-race`. Claiming uses `FOR UPDATE SKIP LOCKED`, so a row another
worker holds is skipped rather than waited for.

## 4. The request runtime cannot forge a delivery

The split is enforced by table and column privileges, verified against the live catalogue:

| Relation                   | `app_runtime` (request path)                                      | `app_worker` (dispatch path)                      |
| -------------------------- | ----------------------------------------------------------------- | ------------------------------------------------- |
| `shared.outbound_messages` | SELECT · INSERT on 13 columns — **no `status` column, no UPDATE** | SELECT · UPDATE on `status`, `failure_class` only |
| `shared.delivery_attempts` | **SELECT only**                                                   | SELECT · INSERT                                   |
| `shared.template_versions` | SELECT · INSERT · UPDATE (permission-gated, §template policy)     | **no privilege at all**                           |

Read that first row carefully: `status` is not in the runtime's INSERT grant. The value comes from
the column default, and the RLS `WITH CHECK` on `ins_outbound_messages_enqueue` independently
requires `status = 'pending'`, together with `tenant_id = iam.current_tenant_id()`,
`created_by = iam.current_user_id()`, and
`iam.has_permission_in_scope('shared.notification.send', company_id, branch_id)`. So a request can
_ask_ for a message to be sent, in its own tenant, in a scope it holds the permission for, and can
express nothing else about the message's fate.

What follows is not a matter of discipline:

- a request **cannot mark a message `sent` or `delivered`** — it holds no UPDATE on the table;
- a request **cannot forge a delivery attempt** — it holds no INSERT on `shared.delivery_attempts`.
  This is exercised through the repository layer rather than asserted in prose:
  `NotificationRepository.attemptForgeDeliveryAttempt()` exists purely so the security suite can run
  the forbidden INSERT through the same code path the application uses;
- a worker **cannot read template content** — it holds nothing on `shared.template_versions`. That
  single fact settles the whole content design, and §11 states its consequence without softening it.

The worker's own policies (`wkr_outbound_messages_dispatch`, `wkr_delivery_attempts_all`) are
`USING (true)`, because a dispatcher must see every tenant's queue. That is exactly why the request
path must never borrow the worker connection, and why
[`WorkerDb`](../../../src/server/worker/worker-db.ts) carries no `RequestContext` at all: the tenant
of each row is read _from the row_ and carried explicitly into every write.

## 5. Two conflicts with the frozen contract, and how each is resolved

Both conflicts are resolved **toward the database and away from a signature change**, because P1-13
froze the interface and later phases compile against it. The full reasoning is in
[`notification-policy.ts`](../../../src/modules/shared-services/domain/notification-policy.ts).

### 5.1 `sms` and `whatsapp` are in the type and not in the database

The frozen type is:

```ts
export type NotificationChannel = 'email' | 'sms' | 'whatsapp' | 'in_app';
```

The database disagrees. `ck_outbound_messages_channel` reads
`CHECK (channel = ANY (ARRAY['email', 'in_app']))`, and `ck_message_templates_channel` restricts
message templates the same way. There is no `sms` and no `whatsapp` anywhere in the schema.

**The interface is not changed.** `assertSupportedChannel()` accepts the frozen union and refuses
anything outside `SUPPORTED_CHANNELS = ['email', 'in_app']` with the stable rule code
`unsupported_channel`, surfaced through the error catalogue as `ERR-VAL-001` with
`violations: [{ path: 'body', rule: 'unsupported_channel' }]`. The request validator on the HTTP
route still accepts the four-member enum, precisely so the refusal comes from policy with an
explanation rather than from Zod with a shape error.

The alternative — letting the value through — would surface as SQLSTATE 23514 from a CHECK
constraint. That is neither a contract nor actionable by a caller, and it would leak a schema detail
into an API response. A stable code that names the field is the better failure.

### 5.2 `locale` is required by the contract and has no column

`QueueMessageInput.locale` is mandatory in the frozen type. `shared.outbound_messages` has **no
locale column** — the locale lives on the template, as `shared.message_templates.locale_code`.

So the locale is **checked, not stored**. `assertTemplateUsable()` compares the requested locale with
the locale of the template that owns the chosen version and refuses a mismatch with rule
`locale_mismatch`. That makes the required field load-bearing instead of decorative: a caller asking
for Arabic and being sent an English template is exactly the failure the field exists to prevent.

The locale is not lost. It is recorded as a `public` audit detail on `shared.notification.enqueued`
and appears in the `message.enqueued` event payload. It is simply not a column on the message row,
and this document does not pretend otherwise.

## 6. The recipient is a reference, never an address

`assertRecipientReference()` requires `recipientRef` to be a UUID — structurally, not by convention.
An email address or a phone number cannot pass it, which removes recipient-header injection and
arbitrary-destination sending from the threat model rather than filtering for them. The refusal
never echoes the rejected value, because echoing it would put an address into the very log the rule
exists to keep it out of.

The reference is then stored one of two ways:

| Case                                          | Stored as                                                             | Protection                                                                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| The reference names a live user in the tenant | `recipient_user_id`                                                   | `fk_outbound_messages_recipient_user` is composite on `(tenant_id, recipient_user_id)`, so it cannot point at another tenant's user |
| Anything else                                 | `recipient_digest` = `SHA-256("<tenantId>:<recipientRef>")`, 32 bytes | The raw reference never reaches the row                                                                                             |

The digest is **salted with the tenant id**. Without that, an operator with cross-tenant read access
on the ledger could correlate the same person across tenants by digest equality. `ck_outbound_messages_recipient_present`
requires at least one of the two to be set, so a message can never be addressed to nobody, and
`ck_outbound_messages_recipient_digest_length` pins the digest at exactly 32 bytes.

The delivery port carries the same discipline: `DeliveryRequest` in
[`message-provider.ts`](../../../src/modules/shared-services/provider/message-provider.ts) has **no
address field**. An adapter that needs an address obtains it where the address lives, against its own
configuration. The platform never holds a plaintext destination.

## 7. Deduplication

`uq_outbound_messages_dedupe` is `UNIQUE (tenant_id, dedupe_key)`. The enqueue is written as
`ON CONFLICT (tenant_id, dedupe_key) DO NOTHING` followed by a read of the existing row — deliberately
**not** `ON CONFLICT DO UPDATE`. The existing row must not be touched at all: it may already be
`sending`, and any UPDATE would both require a grant the request runtime does not hold and risk
disturbing a lifecycle the worker owns.

A deduplicated call returns `{ messageId, deduplicated: true }`, increments the enqueue counter with
`result: 'deduplicated'`, logs at info with the channel only, and **appends no audit entry and
publishes no event** — because nothing happened. The dedupe key itself is validated to 8–200
characters over `[A-Za-z0-9][A-Za-z0-9._:-]*`; keys travel into indexes and logs, so they are kept
boring and printable, and they are recorded in the audit as `restricted`, which `iam.audit_mask`
collapses to a fixed marker before storage.

## 8. Retry classification and the bounded dead-letter path

A provider failure is classified by kind, and the kind decides whether another attempt is even
plausible:

| `DeliveryFailureKind` | Retryable | Meaning                                |
| --------------------- | --------- | -------------------------------------- |
| `timeout`             | yes       | The provider did not answer in time    |
| `outage`              | yes       | The provider is unavailable            |
| `rejected`            | **no**    | The provider refused the message       |
| `invalid_recipient`   | **no**    | The destination cannot be delivered to |

An unclassified exception is coerced to `outage` / `unclassified_provider_fault` rather than being
guessed at. Each attempt is bounded by `NOTIFICATION_PROVIDER_TIMEOUT_MS` (default 5,000 ms, bounded
100–60,000), because a provider that never answers must not hold a worker slot forever.

On any failure the dispatcher writes one `delivery_attempts` row with `status = 'errored'` and a
**sanitised** `error_summary` — never the provider's own message, which routinely echoes the
destination back — then moves the message `sending → failed` with `failure_class` set to the kind.
It then dead-letters when either condition holds:

- the failure is not retryable; or
- `retry_count + 1 >= OUTBOX_MAX_ATTEMPTS` (default 8, bounded 1–50).

Dead-lettering is the `failed → cancelled` edge, which is the schema's terminal failure state and the
one place the CHECK constraints permit `failure_class` to stand. **Nothing is deleted**: a
dead-lettered message stays queryable with its full attempt history, which is what an operator needs
in order to decide whether to request it again. The retry budget is deliberately the _same_
`OUTBOX_MAX_ATTEMPTS` the outbox worker uses — a second, independent retry budget is a second thing
to get wrong.

Two behaviours are worth stating exactly:

- **Digest mismatch is refused, not retried.** Before contacting a provider the dispatcher recomputes
  SHA-256 over the canonical form of the content it was handed and compares it with the stored
  `body_sha256`. A mismatch runs the message through `queued → sending`, records an errored attempt
  summarised as `content_digest_mismatch`, moves it `sending → failed` with `failure_class = 'integrity'`,
  and dead-letters it. The call returns `{ outcome: 'failed', retryable: false }` while the row itself
  has already reached `cancelled`. Content that was altered between enqueue and dispatch cannot be
  delivered, which is what makes the stored digest load-bearing rather than decorative.
- **A crash mid-provider-call is visible.** The attempt row is written once, _after_ the outcome is
  known, because a `started` row would need a second UPDATE the schema does not grant to `app_worker`.
  A crash during the provider call therefore leaves the message in `sending` with no attempt row —
  which is precisely the state a recovery sweep should look for, and is honest about what is unknown.
  **No such recovery sweep is implemented in this phase.**

## 9. The provider is a port with an `unconfigured` default

**No production message provider is provisioned, and this phase does not select one.** What exists
is the port every adapter must satisfy plus two adapters:

| Adapter                       | `code`         | Behaviour                                                                              |
| ----------------------------- | -------------- | -------------------------------------------------------------------------------------- |
| `UnconfiguredMessageProvider` | `unconfigured` | **The default.** Refuses with `provider_unconfigured` rather than pretending           |
| `LocalMessageProvider`        | `local_fake`   | Deterministic, in-process, reaches no network; selected only by explicit configuration |

`LocalMessageProvider` delivers nothing anywhere. Its `providerMessageRef` is derived from the
message id so it is stable across runs. It exists so the retry, timeout, outage and dead-letter paths
are exercised by real code rather than described in a document. A `DeliveryOutcome` carries a
provider reference and a short response code, never a response body.

## 10. What is recorded, and what is deliberately not

| Sink                                 | Carries                                                                                                                                                       | Never carries                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Audit `shared.notification.enqueued` | channel, purpose, locale (public); template version, consent record (internal); dedupe key and recipient reference as **`restricted`**, masked before storage | rendered content                                                                    |
| Event `message.enqueued`             | channel, purpose, locale                                                                                                                                      | recipient, content, dedupe key — an event travels further than the row it describes |
| Logs                                 | channel, purpose, locale, provider code, attempt number, outcome                                                                                              | recipient, subject, body, dedupe key                                                |
| Metrics                              | `notification.enqueue.count`, `notification.delivery.count`, `notification.retry.count`, `notification.dead_letter.count`                                     | any value-bearing label                                                             |

The dedupe key routinely encodes a business identity and the recipient is a person; both are
classified `restricted` so the audit proves the message was requested without becoming a copy of who
it was for.

## 11. Residual risk: rendered content is transient

This section states a real limitation. It is not hedged.

The column comment on `shared.outbound_messages.body_sha256` reads, verbatim from the live database:

> Exactly 32-byte SHA-256 integrity digest of rendered content that is not persisted here; rendering
> and transient content belong to the backend dispatch phase.

Three facts together determine the design:

1. **The schema stores only the digest.** There is no body column and no subject column on
   `shared.outbound_messages`; the table comment says the same thing.
2. **`app_worker` holds no privilege whatsoever on `shared.template_versions`**, verified against the
   live catalogue. The dispatcher cannot read a template body, so it cannot re-render.
3. **No durable transient content store is provisioned.** There is no cache, no object store and no
   broker holding rendered messages.

So content is rendered exactly once, at enqueue, from an approved immutable version, and is handed to
the dispatcher **in process** via `queueMessageWithRendering()`. The consequence, stated plainly:

> **A message whose rendered content is lost from process memory cannot be re-rendered by another
> process.** Cross-process redelivery of _content_ is not implemented and is not claimed.

What **is** guaranteed, and is durable in the database:

- **The request.** The row proves that this tenant asked for this message, on this channel, for this
  purpose, from this approved template version, to this recipient reference or digest, under this
  dedupe key and this consent record, created by this user, at this time.
- **The integrity digest.** `body_sha256` fixes what was rendered. Any content later presented for
  dispatch is verified against it and refused on mismatch (§8).
- **The lifecycle.** Every state the message reached, with server-owned timestamps the application
  cannot write, plus the full `delivery_attempts` history with provider code, attempt number,
  outcome and a sanitised summary.

What is **not** guaranteed: that the content itself can be recovered, reconstructed, resent from
another process, or inspected after the fact. The digest proves _whether_ a given piece of content is
the one that was approved; it cannot produce that content.

There is a second, related honesty point. `promotePending()` and `dispatchOne()` are implemented and
composed into the module, but **no scheduled loop in the merged tree invokes them** — no code outside
the dispatcher itself calls either method. Dispatch is exercised as a service, not run as a
continuously scheduled background process in this phase.

## 12. Claims this document does not make

For the avoidance of doubt, and because the temptation in a document like this is to imply more than
was built:

- **No production message provider is provisioned.** The default is `unconfigured` and it refuses.
- **No throughput, latency, SLO, availability or failover claim is made.** None was measured and none
  is provisioned.
- **No monitoring or alerting is provisioned.** Counters are incremented into the existing metrics
  interface; nothing scrapes, stores, or alerts on them.
- **No broker, replication, sharding, load balancing or CDN is involved.** The database outbox is the
  queue in this phase.
- **No malware or content scanning exists** anywhere in this path.
- **The P1-15 owner gate is Pending.** Nothing here records or implies a Go.

## 13. Where the behaviour is exercised

| Concern                                                                                                     | Location                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Channel refusal, recipient references, dedupe keys, consent, template usability, recipient and body digests | [`tests/foundation/p1-15-notification-policy.test.ts`](../../../tests/foundation/p1-15-notification-policy.test.ts)                                           |
| Deterministic rendering and its digest inputs                                                               | [`tests/foundation/p1-15-template-rendering.test.ts`](../../../tests/foundation/p1-15-template-rendering.test.ts)                                             |
| Role capability surface against the live database                                                           | [`tests/db/p1-15-shared-services-runtime-capabilities.test.ts`](../../../tests/db/p1-15-shared-services-runtime-capabilities.test.ts)                         |
| The capability grant itself                                                                                 | [`20260728090000_shared_services_runtime_write_capabilities.sql`](../../../supabase/migrations/20260728090000_shared_services_runtime_write_capabilities.sql) |
