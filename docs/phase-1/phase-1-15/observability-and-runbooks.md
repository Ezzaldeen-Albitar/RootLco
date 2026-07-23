# Phase 1-15 — Observability and Operator Runbooks

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Release group:** Release 3 — Backend Foundation ·
**Date:** 2026-07-23 ·
**Owner gate:** **Pending** ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent third-party audit, a penetration test, or a
certification.**

---

## 1. What exists, and what this document is not

**No monitoring backend is provisioned.** There is no metrics store, no dashboard, no alert manager,
no tracing collector, and no error-monitoring project. No environment beyond Local exists
([ADR-012](../../adr/ADR-012-local-first-environment-with-controlled-promotion.md)), and P1-15 does
not change that.

What P1-15 adds is instrument **vocabulary** on the existing port:

- [`src/server/observability/metrics.ts`](../../../src/server/observability/metrics.ts) defines a
  fixed `METRICS` map and a `MetricsRecorder` interface. The process-wide default is
  `InMemoryMetricsRecorder` — counters and gauges in a `Map`, histogram samples in an array. A real
  exporter is a later adapter that implements `MetricsRecorder` and is installed by deployment
  composition through `setMetricsRecorder()`; nothing in a handler ever installs one.
- [`logger.ts`](../../../src/server/observability/logger.ts) is Pino writing one JSON object per
  line to stdout. No transport, no file sink, no network sink.
- [`monitoring.ts`](../../../src/server/observability/monitoring.ts) is a capture boundary whose
  default transport (`RecordingErrorMonitor`) writes the sanitised event to the structured log and
  keeps a bounded ring of the last 100 events. It claims nothing about an external platform.

The runbooks in [§5](#5-runbooks) are therefore written against the instrument names and the
database queries, **not** against alerts that fire. They are executable today by reading the
structured log and querying the database; the metric references become mechanically usable the day
an exporter is installed. Saying otherwise would be describing an operations capability the platform
does not have.

Three properties of the default recorder matter to anyone reading a number out of it, because each
means a reading can be an under-report rather than a measurement:

| Property                                                | Consequence                                                                                                                                 |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAX_SERIES = 512` for counters and gauges, per process | Once 512 distinct series exist, a **new** series is silently dropped. A mislabelled instrument degrades the metric rather than the process. |
| `MAX_OBSERVATIONS = 4096` for histograms, per process   | Samples are a ring across **all** histogram instruments together; the oldest is shifted out. Percentiles cover only the recent window.      |
| In-memory, per process, not persisted                   | A restart resets every counter. There is no retention and no aggregation across processes.                                                  |

Related: [Observability Standard](../../standards/observability-standard.md) ·
[Phase 1-15 binding implementation decisions](./phase-1-15-implementation-decisions.md) ·
[Phase 1-15 performance and query evidence](./performance-and-query-evidence.md).

## 2. The P1-15 instrument table

Every row below was read from the `METRICS` block at
[`metrics.ts:38–56`](../../../src/server/observability/metrics.ts) and cross-checked against the
call sites that emit it. **Labels are the literal keys and values passed at those call sites**, not
an intended design — where the code emits nothing, the row says so.

`increment()` is a counter, `observe()` is a histogram, `gauge()` is a gauge. No P1-15 instrument is
a gauge.

| Instrument (constant)          | Metric name                        | Kind      | Labels emitted                                                                                                         | What it means                                                                                                                                                           |
| ------------------------------ | ---------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `numberAllocationCount`        | `numbering.allocation.count`       | counter   | `sequence` (registry code), `result` ∈ `success` \| `not-provisioned` \| `denied` \| `failure`                         | One display-number allocation attempt. `not-provisioned` is SQLSTATE `P0002` from `shared.next_display_number`; `denied` is `42501` (scope refused).                    |
| `auditAppendFailureCount`      | `audit.append.failure_count`       | counter   | **none — no call site exists in the tree**                                                                             | Declared vocabulary only. Nothing emits it today.                                                                                                                       |
| `transitionCount`              | `transition.applied.count`         | counter   | `aggregate`, `to`, `result='success'`                                                                                  | A status transition that was actually applied and its history row written.                                                                                              |
| `transitionConflictCount`      | `transition.conflict.count`        | counter   | `aggregate`, `to`, `reason` ∈ `already-in-state` \| `invalid-origin`                                                   | A transition refused by the engine before any write. Rises when callers race, or when a client holds a stale view of state.                                             |
| `attachmentAuthorizationCount` | `attachment.authorization.count`   | counter   | `purpose` ∈ `upload` \| `download`, `result` ∈ `success` \| `refused`                                                  | An authorization decision for an attachment. `refused` is emitted for download of a version that is not in a downloadable state.                                        |
| `signedUrlCount`               | `storage.signed_url.count`         | counter   | `provider`, `result` ∈ `success` \| `timeout` \| `outage` \| `refused`. On failure `provider` is the literal `unknown` | A call into the storage port. `refused` is the `UnconfiguredStorageProvider` default — the platform has no object store.                                                |
| `signedUrlDuration`            | `storage.signed_url.duration_ms`   | histogram | `provider`, `result='success'`                                                                                         | Milliseconds inside the provider call. **Success only** — a failed or timed-out call contributes no duration sample.                                                    |
| `notificationEnqueueCount`     | `notification.enqueue.count`       | counter   | `channel` ∈ `email` \| `in_app`, `result` ∈ `success` \| `deduplicated`                                                | An enqueue request. `deduplicated` means `uq_outbound_messages_dedupe` matched and no second message was created.                                                       |
| `notificationDeliveryCount`    | `notification.delivery.count`      | counter   | `channel`, `provider`, `result` ∈ `delivered` \| `timeout` \| `outage` \| `rejected` \| `invalid_recipient`            | One worker-side delivery attempt against the message provider.                                                                                                          |
| `notificationRetryCount`       | `notification.retry.count`         | counter   | `channel`                                                                                                              | A failed message requeued for another attempt. Incremented only when the requeue actually moved a row.                                                                  |
| `notificationDeadLetterCount`  | `notification.dead_letter.count`   | counter   | `channel`, `reason` (the failure class: a provider failure kind, `integrity`, or `retry_budget_exhausted`)             | A message ended as undeliverable. Nothing is deleted; the row and its attempt history remain queryable.                                                                 |
| `templateRenderCount`          | `template.render.count`            | counter   | `channel`, `result='success'`                                                                                          | A template version rendered without error.                                                                                                                              |
| `templateRenderFailureCount`   | `template.render.failure_count`    | counter   | `channel`, `rule` (the `TemplateRenderError` rule identifier, or `unknown`)                                            | A render refused by the rendering rules. Emitted from both the preview path and the enqueue path.                                                                       |
| `eventRejectionCount`          | `event.rejected.count`             | counter   | **none — no call site exists in the tree**                                                                             | Declared vocabulary only.                                                                                                                                               |
| `normalizationRejectionCount`  | `normalization.rejected.count`     | counter   | **none — no call site exists in the tree**                                                                             | Declared vocabulary only.                                                                                                                                               |
| `queryLimitRejectionCount`     | `query.limit_rejected.count`       | counter   | **none — no call site exists in the tree**                                                                             | Declared vocabulary only.                                                                                                                                               |
| `exportAuthorizationCount`     | `export.authorization.count`       | counter   | `resource` (export-policy code), `result` ∈ `authorized` \| `denied` \| `denied-field` \| `too-large`                  | An export authorization decision. `denied-field` means the requested fields needed a further permission; `too-large` means the row estimate exceeded `EXPORT_MAX_ROWS`. |
| `readinessCheckCount`          | `readiness.dependency.count`       | counter   | `result` ∈ `ready` \| `degraded` \| `unavailable` \| `timeout` \| `error`                                              | One readiness probe. `timeout` means `READINESS_TIMEOUT_MS` elapsed; `error` means the probe threw.                                                                     |
| `readinessCheckDuration`       | `readiness.dependency.duration_ms` | histogram | `result` ∈ `ready` \| `degraded` \| `unavailable` \| `timeout`                                                         | Milliseconds for the whole probe. **Not observed on the `error` path** — a thrown probe raises the count but leaves no duration sample.                                 |

### 2.1 Instruments inherited from Phase 1-13 that the runbooks below rely on

These are not new in P1-15; they are listed because [§5.5](#55-outbox-backlog-and-dead-letters)
and [§5.7](#57-readiness-failure) name them.

| Metric name                       | Kind      | Labels      |
| --------------------------------- | --------- | ----------- |
| `outbox.queue.depth`              | gauge     | none        |
| `outbox.queue.oldest_age_seconds` | gauge     | none        |
| `outbox.retry.count`              | counter   | `eventType` |
| `outbox.dead_letter.count`        | counter   | `eventType` |
| `worker.processing.duration_ms`   | histogram | `eventType` |

### 2.2 Four declared instruments emit nothing

`audit.append.failure_count`, `event.rejected.count`, `normalization.rejected.count`, and
`query.limit_rejected.count` appear in `METRICS` and have **no emitting call site anywhere in
`src/`**. That is deliberate in the sense that fixing the vocabulary before the exporter exists is
the point of the map — but it means an operator must not read "the counter is zero" as "no
normalization input was rejected". It means the counter was never touched. Any dashboard built
later must treat these four as absent rather than as healthy.

A second discrepancy is recorded here rather than quietly corrected: the comment at `metrics.ts:36`
states that `tests/foundation/p1-15-observability.test.ts` asserts the label rule. **That file does
not exist in the tree.** The label discipline in [§3](#3-the-forbidden-label-list) is therefore
enforced by review and by the shape of the call sites, not by an executable assertion. It should not
be described as enforced until such a test exists.

## 3. The forbidden label list

The following must never appear as a metric label, and never as a logged **value**:

`email` · `phone` · `VIN` · user id · tenant id · attachment id · storage key · filename ·
signed URL · token · dedupe key · provider response · template content · sensitive template
variables

There are four independent reasons, and each one alone is sufficient. They are stated separately
because they fail differently, and a rule whose reason is understood survives a refactor.

**Cardinality.** A metrics store keeps one time series per distinct label combination. Every item on
that list is either unbounded (an id, a key, a filename) or effectively unbounded (an address, a
VIN). Attaching one converts a bounded instrument into an unbounded family of series, which does not
degrade gracefully: it exhausts the store, and in the default in-memory recorder it silently drops
new series past `MAX_SERIES = 512` — so the instrument stops recording precisely when the system is
busiest.

**Enumeration.** A metrics store has no tenant isolation. The database enforces isolation through
row-level security; a time-series database enforces nothing. `tenantRef` as a label would let anyone
who can read metrics enumerate the tenant list and infer each tenant's document, message, and
allocation volumes — a business-intelligence leak obtained without touching a single row. This is
why the comment in `metrics.ts` singles the tenant out, and why the P1-15 instruments carry only
catalogue metadata: a sequence code, an aggregate name, a channel, a purpose, a result word.

**Capability.** A signed URL **is** the capability — possession is access, for as long as it lives.
A token is the same. A storage key names the object and a dedupe key participates in the uniqueness
decision that suppresses a duplicate message; neither is a credential on its own, but both are the
inputs an attacker needs to make one useful. None of them may leave the process.

**Classification.** Email, phone, VIN, filename, template content, and sensitive template variables
are business or personal data. The classification registries mark these classes restricted, and
[the retention and sensitive-data rules](../../database/retention-and-sensitive-data-standard.md)
apply to them wherever they are stored — which includes a log index. A provider response is on the
list for a specific, observed reason: a delivery provider's own error message routinely echoes the
destination address back in the text. That is why `MessageProviderError` carries a separate
pre-sanitised `summary` (`provider_timeout`, `provider_rejected_message`, and so on) and why the
dispatcher records `failure.summary` rather than `error.message`.

### 3.1 What the P1-15 call sites log instead

The rule is visible in the code, not only in this document:

| Path                 | Logged                                          | Never logged                                    |
| -------------------- | ----------------------------------------------- | ----------------------------------------------- |
| Number allocation    | `{ sequence, scoped: boolean }`                 | The allocated display number                    |
| Signed-URL issuance  | `{ purpose, ttlSeconds, provider }`             | The URL, the storage key, the filename          |
| Enqueue              | `{ channel, purpose, locale }`                  | Recipient, subject, body, dedupe key            |
| Delivery attempt     | `{ channel, provider, attemptNumber, outcome }` | Recipient, content, provider response body      |
| Dead letter          | `{ channel, failureClass, retryCount }`         | Recipient, content                              |
| Status transition    | `{ aggregate, from, to }`                       | Any business field of the aggregate             |
| Readiness projection | Check `name` and boolean `ok` only              | The `detail` string — which carries the DB role |

`tenantRef` and `actorRef` do appear as **log** fields, and that is a deliberate and different
decision: they are raw UUIDs, meaningless without the database, already the join key audit uses, and
they live in a log the platform controls rather than in a shared metrics store. They remain
forbidden as metric labels.

## 4. The redaction hazard, stated precisely

`redact()` in [`redaction.ts`](../../../src/server/observability/redaction.ts) has two independent
layers: key-name redaction and value-shape scrubbing. The key layer is what matters here, and its
matching rule is worth quoting exactly, because its behaviour surprises in **both** directions:

```ts
function isSecretKey(key: string): boolean {
  const lowered = key.toLowerCase();
  return SECRET_KEY_FRAGMENTS.some((fragment) => lowered.includes(fragment));
}
```

A **case-insensitive substring** match, against a fragment list that includes `key`, `auth`,
`session`, `signature`, `secret`, and `token`.

### 4.1 The direction that helps

| Field name       | Lower-cased      | Matching fragment | Result       |
| ---------------- | ---------------- | ----------------- | ------------ |
| `storageKey`     | `storagekey`     | `key`             | `[REDACTED]` |
| `dedupeKey`      | `dedupekey`      | `key`             | `[REDACTED]` |
| `idempotencyKey` | `idempotencykey` | `key`             | `[REDACTED]` |
| `objectKey`      | `objectkey`      | `key`             | `[REDACTED]` |

So the natural P1-15 field names for the most dangerous values are redacted **anyway**, even if a
caller forgets. That is a good default and P1-15 does not weaken it. It also produces harmless false
positives — `authorId` lower-cases to `authorid`, which contains `auth`, so it too would be replaced.
A false redaction costs a debugging round-trip; a missed one costs a credential, and the list is
deliberately biased accordingly.

### 4.2 The direction that does not, and why signed URLs are never logged as values

A field named **`url`** matches no fragment. Neither does `signedUrl` — it contains neither `key`
nor `signature` nor `token`. And the value-shape layer does not save it either: a signed URL's
authentication material is ordinary query-string parameters, which match none of
`SECRET_VALUE_PATTERNS` (JWT, `Bearer`, `Basic`, PEM header, a PostgreSQL URL with an inline
password, `sb_secret_`, `AKIA`, `gh[pousr]_`).

**A signed URL logged under a key named `url` passes both layers intact.**

That is the whole reason the rule cannot be delegated to the redactor. It is stated in the port
itself — see the docstring of
[`provider/storage-provider.ts`](../../../src/modules/shared-services/provider/storage-provider.ts) —
and it is why `AttachmentService.logIssuance()` logs `{ purpose, ttlSeconds, provider }` and returns
the URL only in the response body. **The redactor is a backstop for accidents, never the control.**
The control is that the value is not passed to the logger at all.

## 5. Runbooks

Each runbook states a symptom, what to check, what to do, and what **not** to do. The "what not to
do" sections are not padding: most of them describe an action that looks like a fix and is actually
data loss or a broken invariant.

A standing caution applies to all eight: **no alert will page anyone.** No alerting exists. Each of
these begins with a human noticing something or with a scheduled check that a person runs.

### 5.1 Number-allocator failure

**Symptom.** Business writes that need a display number fail. Callers see `ERR-RES-001` ("no number
sequence is provisioned…") or `ERR-IAM-001` (scope refused). Nothing partially commits, because
allocation is in the caller's transaction.

**Check.**

- `numbering.allocation.count` split by `result`. `not-provisioned` dominating points at a
  configuration gap for one `sequence`; `denied` dominating points at a scope problem, not a
  numbering problem.
- The structured log line `Display number allocated` is absent for the affected operation; the
  failure arrives as the operation's own error record with its `correlationId`.
- Whether the sequence row exists in the scope actually being requested:

  ```sql
  SELECT sequence_code, company_id, branch_id, prefix_template, pad_width, period_reset_rule
    FROM shared.number_sequences
   WHERE tenant_id = $1 AND sequence_code = $2;
  ```

**Do.** Provision the missing sequence row as an operator action —
`app_runtime` holds **no INSERT** on `shared.number_sequences`, so this is by design not something
the application can self-heal. Confirm the requested scope obeys
`ck_number_sequences_branch_requires_company` (a branch-scoped row must also name its company).
For a scope denial, fix the caller's grant scope; the refusal came from
`shared.next_display_number` comparing against `iam.allowed_company_ids()` /
`iam.allowed_branch_ids()`, and it is correct.

**Do NOT.**

- Do not "repair" an apparent gap by editing `next_value` downwards. The trigger
  `shared.guard_number_sequence_regression()` refuses it, and the attempt tells you the model is
  being misread: committed allocations are gapless; a rolled-back transaction legitimately consumes
  nothing.
- Do not add a standalone allocation endpoint to work around a caller. It would commit a number that
  no business row carries — a real gap — while appearing to promise the opposite. See
  [the binding implementation decisions, §2.6](./phase-1-15-implementation-decisions.md).
- Do not allocate in a separate transaction "to be safe". Rollback safety is the entire guarantee.

### 5.2 Storage outage

**Symptom.** Upload and download authorization fail with `ERR-DEP-001` (dependency failure) or
`ERR-SYS-001`. The caller is never told which dependency, deliberately.

**Check.**

- `storage.signed_url.count` split by `result`. `refused` with `provider='unknown'` is the
  `UnconfiguredStorageProvider` default and means **no object store is configured at all** — the
  expected state of this platform, not an incident. `timeout` or `outage` means a configured adapter
  is failing.
- `storage.signed_url.duration_ms` — remembering it records **success only**, so a rising failure
  rate makes this histogram thinner, not slower.
- `attachment.authorization.count` for `purpose='upload'`: authorization can succeed while signing
  fails, and the two counters diverging localises the fault to the provider rather than to policy.
- The effective `STORAGE_PROVIDER` setting for the process.

**Do.** Treat it as a dependency incident: document metadata creation and version registration are
separate from signing, so the platform is degraded rather than down. Restore the provider, or
accept the degradation. `unconfigured` is the honest default and refusing to sign is the correct
behaviour when there is nothing to sign against.

**Do NOT.**

- Do not set `STORAGE_PROVIDER=local_fake` outside development to "make it work". That adapter signs
  against a `.invalid` host; the URLs it issues cannot resolve anywhere, by construction.
- Do not log a URL or a storage key while diagnosing (see [§4.2](#42-the-direction-that-does-not-and-why-signed-urls-are-never-logged-as-values)).
- Do not tell the caller which dependency failed. `ERR-DEP-001` is uniform on purpose.
- Do not claim a scanner ran. No malware scanner is configured, no application role may write
  `shared.file_scan_results`, and document **acceptance** is therefore unavailable in this phase.

### 5.3 A signed-URL incident

**Symptom.** A signed URL is believed to have been disclosed — pasted into a ticket, captured by an
intermediary, or found in an unexpected log.

**Check.**

- The TTL the URL was issued with. `AttachmentService` logs `{ purpose, ttlSeconds, provider }` on
  every issuance, so the exposure window is recoverable from the log without the URL itself.
- The configured bounds: `STORAGE_UPLOAD_URL_TTL_SECONDS` (30–900, default 600) and
  `STORAGE_DOWNLOAD_URL_TTL_SECONDS` (15–600, default 120), both capped by the port's
  `ABSOLUTE_MAX_URL_TTL_SECONDS = 900`.
- Whether the leak is systemic: search the log index for any field whose **value** looks like a URL.
  A hit means a call site is logging the capability and is a code defect, not an operational one.

**Do.** Establish the expiry instant and treat the window as the blast radius. Because the key is
server-built from the tenant and a generated id, a leaked download URL grants exactly one object to
whoever holds it until it expires, and grants nothing after. Lower the configured TTL if the exposure
window is judged too wide; the change takes effect for **newly issued** URLs. If a call site was
found logging a URL, fix the call site — that is the actual remediation.

**Do NOT.**

- Do not assume the URL can be revoked. **The port has no revocation operation.** `SignedUrl` carries
  a URL, a method, an expiry, and an adapter name; expiry is the only bound. Any recovery plan that
  depends on revoking an outstanding URL is planning against a capability that does not exist.
- Do not paste the URL into the incident record, the ticket, or a chat message while investigating.
- Do not raise a TTL above `ABSOLUTE_MAX_URL_TTL_SECONDS` to accommodate a slow client. The adapter
  re-checks the bound and will refuse.

### 5.4 Message-provider outage

**Symptom.** Messages accumulate in `queued`/`failed`. Nothing is delivered. Enqueue keeps working —
which is correct: the outbound row is the durable record, and delivery is the worker's separate
concern.

**Check.**

- `notification.delivery.count` split by `result`. A wall of `timeout` or `outage` is a provider
  fault; a wall of `rejected` or `invalid_recipient` is a content or recipient fault and needs a
  different response.
- `notification.retry.count` and `notification.dead_letter.count` by `channel` and `reason`.
- The log line `Delivery attempt recorded`, whose `context` carries `{ channel, provider,
attemptNumber, outcome }` and whose `correlationId` is the message id.
- The queue itself:

  ```sql
  SELECT status, failure_class, count(*)
    FROM shared.outbound_messages
   GROUP BY status, failure_class
   ORDER BY 3 DESC;
  ```

- `NOTIFICATION_PROVIDER` (default `unconfigured`, which throws `outage` with summary
  `provider_unconfigured`) and `NOTIFICATION_PROVIDER_TIMEOUT_MS` (100–60000, default 5000).

**Do.** Restore the provider, then requeue. Retry is bounded by `OUTBOX_MAX_ATTEMPTS` (1–50, default 8) and the retry counter is advanced by the lifecycle guard, so requeueing is safe and cannot loop
forever. A `reason` of `integrity` means something different and more serious: the rendered content
handed to the dispatcher did not match `body_sha256` recorded at enqueue. Investigate that as
tampering or as a code defect; do not retry it.

**Do NOT.**

- Do not edit `retry_count` or a lifecycle timestamp directly. `guard_outbound_message_lifecycle()`
  owns both and rejects a direct write; the guard is what makes the counter trustworthy.
- Do not delete failed or cancelled rows. A dead-lettered message stays queryable with its full
  attempt history, which is exactly what is needed to decide whether to re-request it.
- Do not attempt to re-render content on the worker side. `app_worker` holds no privilege on
  `shared.template_versions` and the message row stores no body — that separation is a security
  property, not an oversight.
- Do not record the provider's own error text. Record the sanitised `summary`; the raw text echoes
  destinations.

### 5.5 Outbox backlog and dead letters

**Symptom.** Events are not being consumed; the queue grows; downstream projections lag.

**Check.**

- The gauges `outbox.queue.depth` and `outbox.queue.oldest_age_seconds`. Depth alone means "work to
  do"; **depth plus a rising oldest age** means "not draining", and only the second is an incident.
- `outbox.retry.count` and `outbox.dead_letter.count` by `eventType` — a single event type
  dominating points at one consumer, not at the worker.
- `worker.processing.duration_ms` by `eventType`.
- The same query the worker uses, which is the authority:

  ```sql
  SELECT count(*) FILTER (WHERE status IN ('pending','claimed'))  AS depth,
         EXTRACT(EPOCH FROM (now() - min(occurred_at)
                 FILTER (WHERE status = 'pending')))              AS oldest_age_seconds,
         count(*) FILTER (WHERE status = 'dead_letter')           AS dead_letters
    FROM shared.event_outbox;
  ```

- `shared.error_records` for `error_code = 'outbox.dead_letter'`, which the worker writes with
  severity `critical` and a bounded, payload-free context.

**Do.** Confirm the worker loop is running (worker readiness reports `worker.loop.running`). Fix the
failing consumer, then replay per the
[Queue Processing and Replay Standard](../../standards/queue-processing-and-replay-standard.md).
Dead letters make the worker **degraded**, not unready — a deep queue must not take the tier out of
rotation.

**Do NOT.**

- Do not delete dead letters to clear the count. The row is the evidence and the replay source.
- Do not publish directly to bypass the worker. The outbox is the transactional boundary; a direct
  publish breaks the guarantee that an event exists if and only if its transaction committed.
- Do not raise `OUTBOX_MAX_ATTEMPTS` to hide a consumer that fails deterministically. It converts a
  fast, visible dead-letter into a slow, invisible one.
- Do not read a zero `outbox.dead_letter.count` from a freshly restarted process as evidence that
  none occurred. The recorder is in-memory and resets. The database query is the authority.

### 5.6 Template rollback

**Symptom.** An approved and activated template version renders wrongly, or renders content that
should not go out.

**Check.**

- `template.render.failure_count` by `channel` and `rule` for hard failures;
  `template.render.count` for the volume that succeeded — a wrong-but-valid template raises the
  success counter, so the metric will **not** tell you about it. Content defects are found by
  reading, not by measuring, and this runbook is honest about that.
- `notification.enqueue.count` to size how many messages already carry the bad rendering.
- The template's version history and current pointer:

  ```sql
  SELECT t.template_code, t.channel, t.locale_code, t.active_version_id,
         v.id, v.version_number, v.status
    FROM shared.message_templates t
    JOIN shared.template_versions v ON v.template_id = t.id
   WHERE t.tenant_id = $1 AND t.template_code = $2
   ORDER BY v.version_number DESC;
  ```

**Do.** Re-point `active_version_id` at the previous **approved** version via
`TemplateService.setActiveVersion()`. The guard `guard_template_active_version()` re-reads the
version `FOR UPDATE` and refuses anything not `approved`, which is what makes this a safe operation
rather than a hopeful one. Then create a **new** draft version with the correction, revise, approve,
and activate. Retire the bad version afterwards, once nothing points at it. Already-enqueued
messages keep the content they were enqueued with, by design — the digest check would refuse
anything else.

**Do NOT.**

- Do not edit the body of an approved version. `updateDraftContent` requires `status = 'draft'`, and
  the lifecycle guard refuses the transition; forcing it would break `body_sha256` on messages
  already enqueued against that version.
- Do not delete the bad version. Retire it. `shared.template_versions` is referenced by
  `shared.outbound_messages.template_version_id`, and the history is what explains what was sent.
- Do not attempt to mutate a **platform**-scope template from a tenant. The INSERT and UPDATE
  policies pin `scope = 'tenant'`; a tenant override is created instead, and that is the supported
  mechanism.
- Do not re-render and re-hash an enqueued message to "match" the fix.

### 5.7 Readiness failure

**Symptom.** The versioned readiness endpoint reports `degraded` or `unavailable`. Liveness stays
`alive` — which is correct and is the point of the split.

**Check.**

- `readiness.dependency.count` by `result`. `timeout` means `READINESS_TIMEOUT_MS` (50–10000,
  default 2000) elapsed; `error` means the probe threw and, note, contributes **no** duration sample.
- `readiness.dependency.duration_ms` for the probes that did complete.
- Which check is false. The projection returns check `name` and boolean `ok` only:
  `database.reachable`, `database.role.no-bypassrls`, and one `capability.*` entry per foundation
  write capability. The `detail` field — which carries the connected **database role name** — is
  dropped before the response is built and is available only in the internal report.
- A false `capability.*` with `database.*` true is **degraded**: reads work, and a grant gap is a
  documented change request rather than an outage. See
  [the P1-15 database remediation record](./phase-1-15-database-remediation-record.md).

**Do.** Distinguish the two states before acting. `unavailable` from a blocking `database.*` check
means the instance should leave the rotation. `degraded` from a capability gap means a grant needs
fixing and traffic should keep flowing. `database.role.no-bypassrls` being false is a security
finding, not a capacity one — the process is connected as a role that bypasses row-level security
and must be corrected immediately.

**Do NOT.**

- Do not wire liveness to the database. A liveness probe that touches a dependency restarts healthy
  processes on every hiccup and converts a blip into a rolling outage. `liveness()` performs no I/O
  at all, deliberately.
- Do not surface check `detail` in the HTTP response. Readiness is routinely unauthenticated and
  reachable from a balancer's network; the role name, host, bucket, and driver message must not
  cross that boundary.
- Do not modify `/api/health`. It is asserted to return exactly seven keys and is the container
  healthcheck (`curl -fsS`, which fails on any non-2xx). The P1-15 endpoints are additive.
- Do not take the tier out of rotation for a capability gap.

### 5.8 Provider credential rotation

**Symptom.** Not a fault — a scheduled or forced rotation of storage or delivery credentials.

**Check.**

- Which adapter is actually installed: `STORAGE_PROVIDER` and `NOTIFICATION_PROVIDER`, both
  defaulting to `unconfigured`, both constrained to `^[a-z][a-z0-9_]{1,62}$`.
- That the repository holds no credential to rotate. It does not, and must not.
- After rotation: `storage.signed_url.count` with `result='success'` and
  `notification.delivery.count` with `result='delivered'` resuming; and
  `readiness.dependency.count` returning to `ready`.

**Do.** Rotate in the deployment environment's own secret store and restart the process.
`backendConfig()` **memoises the parsed configuration on first call** — verified in
[`backend-config.ts`](../../../src/server/config/backend-config.ts), where `cached` is returned on
every subsequent call and cleared only by the test seam. A new value therefore takes effect at
process start, not on write. Plan the rotation as a restart, and drain via readiness first so the
balancer stops sending work before the process stops accepting it. Roll forward one role at a time —
web and worker report readiness separately precisely so they can be moved independently.

**Do NOT.**

- Do not place a credential in the repository, in a committed `.env`, in a migration, or in a
  comment.
- Do not log the old or new value while confirming the change; note that the configuration validator
  already reports variable **names** only and never echoes values, and the redactor's key list would
  catch most — but not all — accidental field names.
- Do not expect a hot reload. There is none, and assuming one produces a rotation that silently did
  not happen.
- Do not treat a successful rotation as evidence that a production provider exists. Both remain
  **ports with deterministic local adapters and an `unconfigured` default**; no production object
  store and no production message provider is provisioned.

## 6. What this document does not claim

- **No monitoring backend, log shipper, metrics store, dashboard, alert rule, or on-call rotation
  is provisioned.** The metrics port has an in-memory default recorder; an exporter is a later
  adapter.
- **No SLO, throughput, latency, availability, capacity, failover, replication, CDN, sharding, or
  load-balancing claim is made anywhere above.** None of those is provisioned, and
  [P1-OD-027 (NFR-SCL)](../../standards/scalability-and-backpressure-standard.md) remains open.
- **No malware scanning exists.** No scanner is configured, no application role may write
  `shared.file_scan_results`, and document acceptance is consequently unavailable.
- **No production object store and no production message provider is provisioned.** Both are ports
  with deterministic local adapters and an `unconfigured` default that refuses rather than pretends.
- **No independent review, independent QA, or third-party audit informed this document.** It is
  owner-authorized technical self-review.
- **The Phase 1-15 owner gate is Pending.** Nothing here records or implies a Go.
