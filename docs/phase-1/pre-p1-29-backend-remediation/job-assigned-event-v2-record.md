# `job.assigned` schemaVersion 2 — execution record

**A published event-schema change, taken as its own slice.** The publisher now
resolves the notification facts its consumer cannot, because the consumer runs on
a role for which those facts are unreachable by design.

|                      |                                                              |
| -------------------- | ------------------------------------------------------------ |
| Branch               | `remediation/p1-29-backend-job-assigned-event-v2`            |
| Base                 | `e9c195e8` — `origin/develop` at the enqueue-authority merge |
| Ownership profile    | `p1-29-backend` — resolved before the branch was created     |
| New migrations       | **0**                                                        |
| New permission codes | **0**                                                        |
| New operations       | **0**                                                        |
| Schema version       | `EVT-TEC-001` `job.assigned` **1 → 2**                       |

---

## 1. Why v1 could not be made to work

`BR-09`'s consumer runs on `app_worker`. Measured, not assumed:

| what the consumer needed        | what `app_worker` holds |
| ------------------------------- | ----------------------- |
| `wo.job_assignments`, `wo.jobs` | no USAGE on `wo`        |
| `tech.technician_profiles`      | no USAGE on `tech`      |
| `shared.message_templates`      | nothing                 |
| `shared.template_versions`      | nothing                 |

The v1 payload carried `{jobId, assignmentId, assignmentRole}` and left every
notification fact to be resolved downstream — from exactly those four relations.
So v1 was not merely inconvenient for its consumer; it was **unsatisfiable**, and
the only way to satisfy it was to widen the worker into two more schemas and the
tenant-authored template library. That is the privilege the Owner's
payload-carries-the-facts decision forbids.

This is not an oversight the platform later noticed. `message-dispatch-repository.ts`
already recorded that the worker gets "nothing at all" on `shared.template_versions`,
and `message-dispatcher.ts` already recorded that `outbound_messages` stores no body
and that rendered content is "never persisted, never logged". The platform had
decided the worker resolves nothing; v1's payload simply had not caught up.

## 2. The minimum payload, derived rather than chosen

The consumer's job is one INSERT into `shared.outbound_messages`, so the payload
must carry exactly the granted columns it cannot otherwise obtain. Working from
the table's NOT NULL set and the column grant:

| column                | where the worker gets it             | carried? |
| --------------------- | ------------------------------------ | -------- |
| `tenant_id`           | `ConsumedEvent.tenantId`             | no       |
| `company_id`          | the outbox row                       | no       |
| `branch_id`           | the outbox row                       | no       |
| `created_by`          | the outbox row                       | no       |
| `template_version_id` | cannot resolve                       | **yes**  |
| `channel`             | cannot resolve                       | **yes**  |
| `purpose`             | a TEMPLATE fact, cannot read         | **yes**  |
| `recipient_user_id`   | cannot resolve (`tech` is closed)    | **yes**  |
| `body_sha256`         | cannot render                        | **yes**  |
| `dedupe_key`          | publisher-derived, canonical         | **yes**  |
| `consent_ref`         | evaluated at publish                 | **yes**  |
| `status`              | outside the grant; default `pending` | n/a      |

**Seven fields.** Two candidates were dropped after reading the code rather than
assuming them:

- **`recipientDigest`** — `notification-service.ts` sets `recipient_user_id` and
  `recipient_digest` MUTUALLY EXCLUSIVELY: `isUser ? recipientRef : null` against
  `isUser ? null : digest(...)`. A technician is a tenant user, so the digest is
  null on every row this slice can produce, and carrying an always-null field
  would be carrying noise.
- **`locale`** — `shared.outbound_messages` has no locale column. The locale is a
  property of the template version, so `templateVersionId` already carries it.

## 3. Envelope facts are forwarded, not duplicated

`company_id`, `branch_id` and `created_by` are NOT in the payload. They were
already being fetched — the claim is `SELECT * FROM shared.claim_outbox_events(...)`
and that function is `RETURNS SETOF shared.event_outbox` — and then dropped by
`toEvent`. Widening `ConsumedEvent` by three fields forwards what the worker
already had; putting them in the payload instead would have created a second copy
of one fact, free to disagree with the first.

`created_by` is the load-bearing one: `outbound_messages.created_by` is NOT NULL
and `wkr_outbound_messages_enqueue_scope` requires it. The honest author of a
message caused by an event is the actor who caused the event.

## 4. What the publisher does, and what it refuses to do

`publishAssigned` runs on `app_runtime`, inside the tenant's own RLS, where every
read it makes is already scoped. It resolves the technician's user through the
**technician module's public surface** — `technicianModule().eligibility.profile()`,
the same call this file already made — never by reading `tech.` from a work-order
repository, which the module-boundary gate refuses.

It then asks `NotificationService.prepareNotification()` for the immutable facts.
That method resolves the template, renders it, computes `bodySha256` over the
canonical rendered form, and **discards the rendered content**. Nothing rendered
reaches the payload, because an outbox payload is persistence and the platform's
rule is that rendered content is never persisted.

**It cannot fail an assignment.** The technician was assigned; that operation has
already succeeded when this runs. `prepareNotification` returns `null` — and the
event is published without the `notification` block — when there is no technician
profile, or no active template with an approved version. **No message template
ships with this platform** (zero seed references, zero migration inserts), so on
every tenant today that is the ORDINARY path, not a degraded one.

The block is **absent**, not null-filled, so a consumer can tell "nothing to send"
from "something to send whose fields happen to be empty".

## 5. Two contract methods, because `queueMessage` is frozen

`NotificationService` is documented as frozen so later phases implement without a
signature change, so both additions are new methods:

- `prepareNotification(db: DbHandle, …)` — the REQUEST side. Reads templates and
  renders, which is legal only there.
- `enqueuePrepared(db: WorkerDb, …)` — the WORKER side. Reads no template, renders
  nothing, and takes a **`WorkerDb` rather than a `DbHandle`**. That is the type
  system stating the boundary: a `DbHandle` carries a `RequestContext`, and the
  worker has none, so a signature accepting one would suggest this path could read
  a tenant from the session — the exact assumption that must never be made here.

`enqueuePrepared` reuses the platform's EXISTING `(tenant_id, dedupe_key)` conflict
target rather than inventing an idempotency mechanism, so it agrees with
`shared.processed_events` instead of competing with it.

## 6. Consent is a POINTER, and is not claimed to be more

`consentRef` carries `consentEvaluation.consentRecordId`. `assertConsent` is applied
at PUBLISH time — the worker inserts directly and never calls it, so if the
publisher is not the gate then there is none.

Two things are stated rather than implied:

1. The five-minute freshness rule (`MAX_CONSENT_AGE_MS`) **does not survive the
   queue**. Outbox lag can exceed it. Nothing downstream may read `consent_ref` as
   "consent was fresh when the row was written".
2. For a technician the reference is **null**, and that is honest rather than
   missing: the platform's consent model is `crm.consent_history`, which covers
   CUSTOMERS. An internal staff recipient has no consent record to consult.
   Recording null says none was consulted; inventing an id would say one was.

## 7. Proofs — eight, behavioural

| proof                                                              | result |
| ------------------------------------------------------------------ | ------ |
| no template authored → v2 published, block ABSENT, assign succeeds | ✅     |
| immutable version id, resolved channel, template `purpose`         | ✅     |
| recipient is the assigned technician's own user, read from `tech`  | ✅     |
| `bodySha256` recomputed independently and matches                  | ✅     |
| no rendered content and no `@` anywhere in the payload             | ✅     |
| reassignment re-resolves to the NEW technician's user              | ✅     |
| a v1-only consumer is refused BEFORE its handler runs              | ✅     |
| cross-tenant: tenant B gets B's version and B's user, never A's    | ✅     |

The digest proof assembles `subject + NUL + renderedBody` **by hand** with
`node:crypto` rather than calling `bodyDigest(canonicalRenderedForm(renderTemplate(…)))`.
Calling the production helpers would assert that a function equals itself and
would keep passing if all three changed together.

The cross-tenant proof seeds the SAME template code in both tenants, so a leak in
resolution has something to leak, and checks the recipient's tenant against
`iam.user_accounts` rather than inferring it from the profile the test asked for.
The reassignment proof asserts the two technicians have DIFFERENT users before
relying on that difference.

## 8. What this does not do

It does not add the BR-09 consumer. `job.assigned` v2 is now published and no
consumer is registered for it — the same state v1 was in, and the honest one:
resuming BR-09 against an unmerged payload contract is what left it blocked the
first time. BR-09 resumes on its own branch once this contract is merged, declares
`supportedSchemaVersions: [2]`, and enqueues through `enqueuePrepared`.

**Assigning a technician still notifies nobody**, and will until BR-09 lands and a
tenant authors a template. No screen may claim otherwise.
