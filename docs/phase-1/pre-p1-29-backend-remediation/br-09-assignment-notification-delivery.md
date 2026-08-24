# BR-09 — Assignment Notification Delivery

|                      |                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------ |
| Closes               | `BE-6` · `DEP-B6` · finding `INS-25` (**BLOCKER**) · Owner requirement 6 (`INT-100`) |
| Depends on           | **nothing technical**; blocked on **one Owner decision** — the channel               |
| Database change      | **none**                                                                             |
| New permission codes | **none**                                                                             |
| Complexity           | **M**                                                                                |

---

> **This slice is an addition to the requested eight.** The eight-slice cut left `BE-6` with no
> owner, and `BE-6` is the sole prerequisite of Owner requirement 6. Leaving it unassigned would
> reproduce exactly the failure `execution-decision.md` §1.2 forbids — a capability that no slice
> owns, and that therefore nobody builds.

## 1. Problem statement

**Assigning a technician notifies nobody.** `job.assigned` is published to the shared outbox and
consumed by no worker. Owner requirement 6 — _"notify the assigned employee"_ — is Blocked.

No P1-29 **screen** is blocked by this: the assignment itself works. But the requirement is not met
without it, and — the part that matters for the frontend — **the UI must not imply a notification
was sent.**

## 2. Existing repository evidence

### 2.1 The event is published

`apps/api/src/modules/work-order/application/job-assignment-service.ts:453` publishes
`eventType: 'job.assigned'`. Note the near-collision that must not be confused: the same service at
`:408` records `action: 'wo.job.assigned'` — an **audit action**, a different string in a different
system. The route declarations carry `auditAction: 'wo.job.assigned'`
(`jobs/[jobId]/assignments/route.ts:89`, `jobs/[jobId]/reassignments/route.ts:68`).

This is precisely the shape [`BR-08a`](br-08-api-contract-closure-and-parity.md) exists to keep a
gate from confusing.

### 2.2 The delivery machinery is complete

| component                 | location                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| the queue                 | `shared.event_outbox`                                                                                                                 |
| the claim protocol        | `shared.claim_outbox_events(claimant, limit, lease)`, `FOR UPDATE SKIP LOCKED`                                                        |
| the worker                | `apps/api/src/server/worker/outbox-worker.ts`                                                                                         |
| **the consumer registry** | `consumersFor(eventType)`, `runConsumer` — `server/worker/consumer-registry`                                                          |
| exactly-once effects      | `shared.processed_events`, primary key per consumer                                                                                   |
| retry and poison handling | full-jitter exponential backoff; attempt ceiling → `dead_letter` + `error_records`                                                    |
| notification services     | `shared-services/application/notification-service.ts`, `message-dispatcher.ts`, `notification-read-service.ts`, `template-service.ts` |
| the permission            | `shared.notification.send` — seeded at `04_iam_permission_catalog.sql:83`, risk `medium`, _"Enqueue outbound notifications"_          |
| the consent refusal       | `ERR-NTF-001` — _"Recipient consent not granted"_ (409)                                                                               |

The worker's own docblock states the guarantees this slice inherits rather than re-establishes:
_no double ownership · no loss on crash · at-least-once · **effect exactly once** · bounded work ·
no retry storm · poison messages stop._

### 2.3 What is absent

- **No consumer is registered for `job.assigned`.** `consumersFor('job.assigned')` returns an empty
  set, so the worker completes the event having done nothing.
- **`DEP-B6` records the precise mechanism**: notifications are **enqueue-on-request only**, and
  **no domain event raises one**. This is not specific to `job.assigned` — it is the general shape.
- No channel decision exists (in-app, email, both).

## 3. Gap

| gap                                                                                            | class                                                                   |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| no consumer for `job.assigned`                                                                 | **API** (worker-side)                                                   |
| no channel decision                                                                            | **Governance** — an Owner question                                      |
| notification recipient cannot be resolved from an assignment without a technician→user mapping | **Domain model** — closed by `BR-01`'s evidence, not by `BR-01`'s route |
| a failed delivery is invisible                                                                 | **Audit**                                                               |
| the UI must not claim a notification was sent                                                  | **Frontend dependency**                                                 |

## 4. Proposed architecture

**Register one consumer. Build nothing else.**

`DEP-B6`'s disposition is binding: **_"Do not poll and synthesize."_** A frontend that polled for
new assignments and rendered its own "you have been assigned" banner would be a second, divergent
notification system with no consent check, no delivery record and no audit trail.

### 4.1 The consumer

```
consumer:  'wo.job-assigned-notifier'
event:     'job.assigned'
effect:    resolve the assignee → enqueue one notification through the existing
           notification service → record the outcome
```

Idempotency is the registry's, not this consumer's: `shared.processed_events` is keyed per
`(event, consumer)`, so a re-delivered event produces **exactly one** notification. **The consumer
must not implement its own dedupe** — a second mechanism would drift from the first.

### 4.2 Resolving the recipient — already possible, and worth stating

`tech.technician_profiles.user_id` is `NOT NULL` with a composite FK to
`iam.user_accounts (tenant_id, id)` and a partial unique index guaranteeing at most one live profile
per user per tenant. So an assignment's `technicianProfileId` resolves to a user account by an edge
that already exists and is **immutable**
([C-01](repository-corrections.md#c-01--a-technicians-branch-and-user-are-immutable-so-transfer-is-not-an-update)).

**This slice does not depend on [`BR-01`](br-01-technician-identity-authority.md).** `BR-01`
publishes an HTTP contract over that edge; this consumer reads the edge directly, server-side,
inside the worker transaction. Two different needs, one shared fact.

It **does** depend on [`BR-03`](br-03-technician-capability-administration.md) in practice — a
tenant with no roster generates no assignments — but that is a data precondition, not a code edge.

### 4.3 The channel is an Owner decision, and the slice is shaped so it is not blocked by it

Recorded as **`BR-09-OPEN-01`**: in-app, email, or both.

**The consumer is built against the notification service's own channel abstraction**, so the
decision changes configuration and a template, not the consumer. Building for in-app only and then
adding email later would mean two code paths; building against the abstraction means one.

**What must not happen while the decision is open:** shipping the consumer with a channel guessed,
or shipping the assignment screen with a "notified" indicator. The second is the real risk, and it
is a frontend rule this slice states rather than a backend behaviour.

### 4.4 Failure must be visible

_"A failed delivery is visible rather than silent"_ is `BE-6`'s acceptance proof, and the machinery
already delivers it: the attempt ceiling routes a poison message to `dead_letter` plus
`error_records`, and the worker increments `outboxDeadLetterCount` keyed by `eventType`.

**The consumer must not swallow a delivery failure to keep the event "successful".** A notification
that could not be sent is a failure of the consumer, and letting the retry and dead-letter machinery
see it is the whole point of putting the effect in the outbox.

**`ERR-NTF-001` (recipient consent not granted) is different and must not be retried.** It is a
terminal refusal, not a transient failure. Retrying it would burn the attempt ceiling and dead-letter
an event whose outcome was correctly determined on the first try. The consumer records it as a
completed-not-delivered outcome.

## 5. Database impact

**None.** No migration, no table, no column, no policy, no grant. `shared.event_outbox`,
`shared.processed_events`, `dead_letter` and `error_records` all exist.

**Rollback:** unregister the consumer. Events already processed stay processed; nothing is
reprocessed, because `shared.processed_events` is keyed per consumer and the key survives. That is
the correct behaviour — un-sending a notification is not possible, and re-sending on re-registration
would be worse.

## 6. API impact

**No new HTTP operations. No changed routes. No changed permissions.**

This is the only slice in the plan with no HTTP surface at all, and that is the point: the effect
belongs behind the outbox, not behind a route.

One **read** already exists and is not this slice's to build:
`notification-read-service.ts` serves the recipient's own notification list. If P1-29's frontend
renders an in-app notification centre, it consumes that existing surface.

### The worker-side contract

| field                   | value                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| consumer name           | `wo.job-assigned-notifier` — stable; it is the `shared.processed_events` key and **renaming it re-delivers every historical event** |
| event type              | `job.assigned`                                                                                                                      |
| payload fields consumed | `jobId`, `technicianProfileId`, `workOrderId`, tenant/company/branch from the outbox row                                            |
| effect                  | one notification enqueued per event                                                                                                 |
| failure mode            | throw → retry with backoff → attempt ceiling → dead letter                                                                          |
| terminal refusal        | `ERR-NTF-001` → recorded, **not** retried                                                                                           |

**The payload's shape is a contract even though it never crosses HTTP.** A consumer that receives a
payload shape it does not understand is a **poison message** by the worker's own definition
(`outbox-worker.ts:214`). If the publisher's payload changes, this consumer breaks silently into the
dead-letter queue. Pin the consumed field set in a test against the publisher.

## 7. Permission model

**Mint nothing, and require nothing at the HTTP layer** — there is no HTTP layer.

`shared.notification.send` (risk `medium`) is the authority for enqueueing a notification. The
worker runs as `SYSTEM_ACTOR_ID` (`worker-db.ts`), not as the assigning user.

**That is a deliberate and important distinction to record.** The notification is sent _by the
platform because an assignment happened_, not _by the supervisor who assigned_. If it ran as the
assigning user it would require every supervisor to hold `shared.notification.send`, coupling the
ability to assign work to the ability to send messages — a widening with no justification.

| actor                        | effect                                                     |
| ---------------------------- | ---------------------------------------------------------- |
| the assigning supervisor     | needs `tech.assignment.manage` only, unchanged             |
| the assigned technician      | receives the notification; needs no code to be a recipient |
| the worker                   | system actor, outside the user permission model            |
| a user who has not consented | `ERR-NTF-001`; recorded, not delivered, not retried        |

## 8. Security requirements

| abuse case                                    | required behaviour                                                                                                                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **notification as an oracle**                 | a notification confirms an assignment the recipient is party to. It must carry **no** data the recipient could not read through an authorized operation — no customer name, no cost, no restricted sidecar content |
| **cross-tenant delivery**                     | the outbox row carries `tenant_id`; the recipient is resolved through `tech.technician_profiles (tenant_id, user_id)`. A cross-tenant recipient is not representable                                               |
| **cross-branch disclosure**                   | the notification names a job the recipient has just been assigned to, so branch exposure is the assignment itself, not the notification                                                                            |
| **consent bypass**                            | `ERR-NTF-001` is honoured as terminal. The consumer must not retry it and must not fall back to a second channel the recipient did not consent to                                                                  |
| **privilege escalation via the system actor** | the worker runs as `SYSTEM_ACTOR_ID` and must enqueue **only** the notification for **this** event. A consumer that performed any other write would be doing so outside the user permission model entirely         |
| **retry storm**                               | inherited: full-jitter exponential backoff and an attempt ceiling                                                                                                                                                  |
| **double notification**                       | inherited: `shared.processed_events` per `(event, consumer)`. The consumer must **not** add its own dedupe                                                                                                         |
| **stale recipient**                           | a technician retired between assignment and delivery still resolves — the profile is soft-deleted, not removed. Deliver, and let the read surface handle visibility                                                |
| **free text in a notification body**          | the assignment carries no free text of its own; if a template interpolates `job.title` (free text on `wo.jobs`), the template engine must escape it                                                                |
| **PII in a notification**                     | the recipient is staff and the subject is their own work. Do not include the customer or the vehicle registration without an Owner decision                                                                        |

## 9. Validation

| concern              | rule                                                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| payload              | the consumed field set is validated on receipt; an unrecognised shape is a **poison message**, not a best-effort parse                                                 |
| ids                  | uuids; a malformed id in a payload is a poison message, not a lookup                                                                                                   |
| recipient resolution | at most one live profile per user per tenant, guaranteed by `uq_technician_profiles_active_user`; **zero** rows is a completed-not-delivered outcome, not an exception |
| enums                | none                                                                                                                                                                   |
| timestamps           | the event's own `occurred_at`; the consumer sets none                                                                                                                  |
| duplicate prevention | the registry's, not the consumer's                                                                                                                                     |
| state compatibility  | none — an assignment is a fact, and a notification about it is valid regardless of the job's later state                                                               |

## 10. Error contract

**No new error codes**, and no HTTP surface to return them on.

| condition                                | outcome                                                   | why                                        |
| ---------------------------------------- | --------------------------------------------------------- | ------------------------------------------ |
| recipient has no live technician profile | **completed, not delivered**, recorded                    | not an error; a roster gap is a data state |
| `ERR-NTF-001` consent not granted        | **completed, not delivered**, recorded                    | terminal; retrying wastes the ceiling      |
| notification service unavailable         | **throw** → retry with backoff                            | transient                                  |
| unrecognised payload shape               | **poison** → dead letter, no retry                        | the worker's own definition                |
| attempt ceiling reached                  | `dead_letter` + `error_records` + `outboxDeadLetterCount` | visible, not silent                        |

**The distinction between the first two rows and the third is the whole design.** A consumer that
threw on "no consent" would dead-letter a correctly-determined outcome; one that swallowed
"service unavailable" would lose a notification silently.

## 11. Audit and history behaviour

| requirement              | how it is met                                                                                                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the assignment itself    | already audited — `auditAction: 'wo.job.assigned'`, class privileged, on both the assignment and reassignment routes                                                              |
| the notification attempt | recorded by the notification service's own surface                                                                                                                                |
| delivery failure         | `dead_letter` + `error_records` + a metric keyed by `eventType`                                                                                                                   |
| attribution              | the assignment carries the supervisor's `actor_id`; the notification carries `SYSTEM_ACTOR_ID`. **These are different actors on purpose** and the evidence must not conflate them |
| correlation              | the outbox row carries the originating `correlation_id`; the consumer must propagate it, so the assignment and its notification are joinable in the log                           |

**One thing this slice does not provide:** a per-assignment "notified at" field readable from the
work-order surface. Adding one would duplicate delivery state into the work-order domain, where it
would go stale. If the Owner wants a notified indicator on the assignment row, it reads the
notification surface — it is not a `wo` column.

## 12. Tests

### Positive

| #   | case                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------- |
| P1  | assigning a technician enqueues exactly one notification for that technician                         |
| P2  | reassigning enqueues one for the **new** assignee                                                    |
| P3  | re-delivery of the same outbox event produces **no** second notification (`shared.processed_events`) |
| P4  | the notification carries the originating `correlation_id`                                            |
| P5  | a recipient with no consent yields a recorded, undelivered outcome and **no** retry                  |

### Negative

| #   | case                                                      | expected                                                                     |
| --- | --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| N1  | payload missing `technicianProfileId`                     | poison → dead letter, **no** retry                                           |
| N2  | `technicianProfileId` resolves to no live profile         | completed, not delivered, recorded                                           |
| N3  | notification service throws a transient error             | retried with backoff                                                         |
| N4  | transient error persists past the attempt ceiling         | `dead_letter` + `error_records` + metric increment                           |
| N5  | the consumer attempts a write other than the notification | forbidden — asserted by review and by the worker transaction's grant surface |

### Security

| #   | case                                                                                                                               | expected                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| S1  | **cross-tenant**: an event in tenant A never resolves a tenant-B recipient                                                         |                               |
| S2  | **payload minimality**: the notification body contains no customer name, vehicle registration, cost, or restricted sidecar content | asserted on the rendered body |
| S3  | **consent is terminal**: `ERR-NTF-001` is never retried and never falls back to another channel                                    |                               |
| S4  | **no second dedupe**: `grep` finds no consumer-local idempotency table or key                                                      |                               |
| S5  | **actor separation**: the notification is attributed to `SYSTEM_ACTOR_ID`, the assignment to the supervisor                        |                               |

### Regression — must remain green

- `tests/backend/outbox-worker.test.ts` — and note its known trap: its `beforeEach` deletes rows only for one tenant, while `shared.claim_outbox_events` is **not tenant-scoped**, so another tenant's expired lease leaks into the suite. Adding a consumer increases traffic through that path; if the suite flakes, that is the cause and it is a known test-isolation defect, not a product one.
- Every existing outbox consumer — `consumersFor` gains an entry and must not change dispatch for other event types.
- `wo.job-assignment-create` and `wo.job-reassignment` — unchanged behaviour; the publication already happened.
- `check-authorization-coverage` / `check-openapi`: **unchanged** — no HTTP operations.

## 13. Definition of Done

- [ ] One consumer registered for `job.assigned`, named `wo.job-assigned-notifier`.
- [ ] **Zero** HTTP operations, **zero** migrations, **zero** permission codes.
- [ ] P3 passes — exactly-once via `shared.processed_events`, with **no** consumer-local dedupe (S4).
- [ ] P5 and S3 pass — consent refusal is terminal, recorded, unretried, with no channel fallback.
- [ ] N4 passes — a persistent failure reaches `dead_letter` and increments the metric. **A silent success on failure fails this slice.**
- [ ] S2 passes — the notification body is minimal.
- [ ] S5 passes — actor separation is real and the evidence does not conflate the two.
- [ ] The consumed payload field set is pinned by a test against the publisher.
- [ ] `BR-09-OPEN-01` (channel) is recorded as an Owner decision, and the consumer is built against the channel abstraction rather than one channel.
- [ ] **No P1-29 screen claims a notification was sent** until this slice is delivered — `grep` confirms no "notified" indicator in `apps/web`.
- [ ] No polling substitute exists anywhere in `apps/web` (`DEP-B6`: _"Do not poll and synthesize"_).
- [ ] No unresolved Critical or High finding open against this slice.
