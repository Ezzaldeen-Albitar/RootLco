# Observability Standard

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Binding standard — applies to every backend phase from Phase 1-13 onward ·
**Date:** 2026-07-21 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (under the
[Standing Technical Authorization Policy](../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../governance/solo-developer-review-policy.md) —
owner-authorized technical self-review, never an independent third-party audit) ·
**Task IDs:** P1-13-BE-008, P1-13-BE-009, P1-13-BE-010, P1-13-SEC-006, P1-13-DO-002 ·
**Related:** [Backend Architecture and Shared Foundation](./backend-architecture-and-shared-foundation.md) ·
[API Conventions v0.1](./api-conventions-v0.1.md) ·
[Error Catalog v0.1](./error-catalog-v0.1.md) ·
[Secure Coding Standard](../security/secure-coding-standard.md) ·
[Retention and Sensitive-Data Standard](../database/retention-and-sensitive-data-standard.md) ·
[Security Event Capture Map](../security/security-event-capture-map.md) ·
[ADR-012 Local-First Environment](../adr/ADR-012-local-first-environment-with-controlled-promotion.md) ·
Implementation: [`src/server/observability/`](../../src/server/observability/),
[`src/server/health/readiness.ts`](../../src/server/health/readiness.ts)

---

## 1. Scope and honest status

This standard covers correlation, structured logging, redaction, metrics, error monitoring, and
health and readiness signals as they are implemented today.

**No observability platform is provisioned.** There is no log shipper, no metrics backend, no
tracing collector, and no error-monitoring project — no environment beyond Local exists (ADR-012).
What exists is: a process that writes JSON to stdout, a metrics **port** with an in-memory
recorder, an error-monitoring **port** with a recording transport, and readiness functions that are
not yet wired to HTTP routes. Every instrumentation result referenced anywhere in this repository is
**development and test evidence from the Local environment**, and is never evidence about hosted
behaviour, capacity, latency, or availability.

## 2. Correlation

### 2.1 Lifecycle

One identifier ties a request to its logs, its audit record, its outbox envelope, the worker
processing that envelope, its monitoring event, and its response header.

```text
inbound header → validate → (accept | generate) → RequestContext.correlationId
   → every log record            (correlationId field)
   → the audit record            (iam.audit_append p_correlation)
   → the outbox envelope         (event_outbox.correlation_id)
   → worker processing           (read from the row)
   → the monitoring event        (MonitoringEvent.correlationId)
   → the response                (x-correlation-id, success and failure alike)
   → the problem document        (correlationId field)
```

`x-causation-id` carries the command or event that caused this one. Unlike the correlation ID there
is **no fallback**: an absent or invalid causation ID is simply absent, because inventing a causal
ancestor would be a lie in the event envelope.

### 2.2 The inbound-validation rule

**An inbound correlation ID is accepted only if it is a syntactically valid UUID. Anything else is
discarded, replaced with a freshly generated ID, and never echoed back.**

| Case                                | Result                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| Valid UUID (RFC 9562, versions 1–8) | Accepted, lower-cased, used as the correlation ID                                     |
| Absent                              | A new UUID is generated                                                               |
| Present and not a UUID              | Discarded; a new UUID is generated; a warn record is emitted with `result: 'skipped'` |

The reasons are specific:

- **Log forging.** An unvalidated header value flows into every log record for the request. A value
  containing a newline and a plausible JSON prefix can synthesise a second log record — one that a
  reader or an alert rule treats as genuine.
- **Header injection.** Echoing an unvalidated value back in a response header lets a caller control
  response header content.
- **Unbounded input.** An oversized value is copied into every record of the request and into
  whatever index collects them.

The rule can be this strict because the database columns are `uuid`, so a UUID is the only
representable form. The rejection is **observable, not silent**: an invalid inbound correlation ID
is either a client defect or an injection attempt, and either is worth a record.

Even for accepted values, `scrubString()` still runs over every emitted string — validation and
scrubbing are independent layers, and neither is trusted to be the only one.

## 3. Structured logging

Pino emits one JSON object per line to stdout. No transport, no file, no network sink: the
deployment model is "the process writes JSON, the platform collects it", and a log shipper
configured here would be configuration for an environment that does not exist.

### 3.1 The standard field set

| Field           | Source                                         | Notes                                                                                                            |
| --------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `time`          | Pino, ISO-8601                                 | ISO rather than epoch millis: logs are read by humans during an incident far more often than parsed by a machine |
| `severity`      | Pino level formatter                           | `debug` / `info` / `warn` / `error`                                                                              |
| `service`       | `APP_NAME`                                     | Process-wide base field                                                                                          |
| `version`       | `APP_VERSION`                                  | Process-wide base field                                                                                          |
| `env`           | `NEXT_PUBLIC_APP_ENV` ?? `NODE_ENV` ?? `local` | Process-wide base field                                                                                          |
| `module`        | Caller / request context                       | e.g. `meta`, `outbox-worker`, `db`                                                                               |
| `operation`     | Caller / request context                       | e.g. `meta.ping`, `outbox.dead-letter`                                                                           |
| `correlationId` | Request context                                | The join key across web, worker, audit, and events                                                               |
| `causationId`   | Request context                                | Present only when supplied                                                                                       |
| `tenantRef`     | Request context principal                      | **Opaque UUID reference only**                                                                                   |
| `actorRef`      | Request context principal                      | **Opaque UUID reference only**                                                                                   |
| `durationMs`    | Caller                                         | Elapsed milliseconds                                                                                             |
| `result`        | Caller                                         | `success` / `failure` / `denied` / `throttled` / `skipped`                                                       |
| `errorCode`     | Caller                                         | A catalog code                                                                                                   |
| `context`       | Caller                                         | Free-form extras — **redacted and scrubbed before emission**                                                     |

`contextLogFields()` derives `module`, `operation`, `correlationId`, `tenantRef`, `actorRef`, and
`causationId` from a `RequestContext`, so a correlation ID is searchable across web and worker
without per-call-site discipline.

**Tenant and actor appear as opaque references, never as identifying values.** `tenantRef` and
`actorRef` are the raw UUIDs — meaningless without the database, and already the join key audit
uses — and never names, email addresses, phone numbers, or any classified attribute.

Log level resolves from `LOG_LEVEL`, defaulting to `warn` under `NODE_ENV=test` and `info`
otherwise.

### 3.2 Backend code uses the backend logger

`src/lib/logging/logger.ts` is the retained Phase 1-1 bootstrap logger for the health and config
path. Backend code must use `@/server/observability/logger`; boundary rule **B7** fails the build
otherwise. The reason is not tidiness: the bootstrap logger does not carry the standard field set
and does not pass through the redaction layers.

## 4. Redaction and scrubbing

Two **independent** layers, because either alone fails.

### 4.1 Layer one — key-name redaction

The value of any key whose name matches a known-sensitive fragment (case-insensitive substring) is
replaced with `[REDACTED]`, at every nesting depth. This catches the common accident:
`log.info('ctx', { row })` where `row` happens to carry a token column.

| Group                    | Key fragments                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Credentials and secrets  | `authorization`, `auth`, `cookie`, `credential`, `dsn`, `jwt`, `key`, `passwd`, `password`, `secret`, `session`, `signature`, `token`, `connectionstring`, `database_url` |
| Restricted business data | `national_id`, `passport`, `tax_number`, `iban`, `card_number`, `cvv`, `bank_account`, `date_of_birth`, `birth_date`                                                      |
| Content bodies           | `document_content`, `file_content`, `payload_body`                                                                                                                        |

The list is deliberately broad. A false redaction costs a debugging round-trip; a missed one costs
a credential.

### 4.2 Layer two — value-shape scrubbing

Strings that _look like_ a credential are replaced even under an innocent key. This catches what
key matching cannot: `log.info('failed', { detail: 'auth failed for Bearer eyJ...' })`.

| Shape detected                                            |
| --------------------------------------------------------- |
| JWT (`eyJ…`.`…`.`…`)                                      |
| `Bearer <token>` and `Basic <token>` authorization values |
| PEM private-key headers                                   |
| `postgres://` connection URLs carrying an inline password |
| Supabase secret keys (`sb_secret_…`)                      |
| AWS access key ids (`AKIA…`)                              |
| GitHub tokens (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`)    |

Scrubbing also applies to the **log message itself**, which is frequently an upstream error string,
and it bounds runaway strings at 2048 characters.

### 4.3 Control characters and log forging

Control characters (C0 range plus DEL) are **neutralised, not dropped**: each is replaced with its
`\xNN` escape. An escaped newline is still readable evidence, but it can no longer forge a second
log record. This applies to every string that reaches a log field, including values that passed
validation.

### 4.4 Recursion limits and error handling

`redact()` walks to a maximum depth of 8, truncates arrays at 100 elements, converts `Date` to an
ISO string, converts `bigint` to a string, and reduces functions and symbols to `[function]` /
`[symbol]` — they are never useful and occasionally leaky.

An `Error` becomes `{ name, message }` with the message scrubbed. **A stack trace never enters a
log field.** It belongs in error monitoring, which is a different destination with a different
audience and a different retention posture.

### 4.5 The prohibition list

The following must never appear in a log record, a metric label, a metric series name, or a
monitoring event, whether directly or inside a spread object:

1. Authentication tokens, session tokens, JWTs, refresh tokens, API keys.
2. `Authorization` and `Cookie` header values, in any form.
3. Passwords, password hashes, or password-reset tokens.
4. Connection strings and DSNs, including error messages that embed them.
5. Private keys and certificates.
6. Any field classified **restricted** in the personal-data classification registries under
   `docs/database/` — national identifiers, passport numbers, tax numbers, IBANs and bank account
   numbers, card numbers, CVVs, dates of birth.
7. Document contents, file contents, and uploaded payload bodies.
8. Payment instrument details of any kind.
9. Request or response bodies as a whole.
10. Personal names, email addresses, and phone numbers as log fields. Reference the subject by its
    opaque identifier.

The rule the standard rests on: **callers pass identifiers and classifications, never row
payloads.** The key list in §4.1 covers the restricted columns so that an accidental spread still
fails closed, but it is a backstop, not the control.

## 5. Metrics

A port, not a platform. No metrics backend is provisioned, so the default recorder keeps counters,
gauges, and observations in memory, bounded at 512 distinct series and 4096 retained observations
so a mislabelled instrument degrades the metric rather than the process. A real exporter is a later
adapter implementing `MetricsRecorder`, installed by composition.

The instrument names are fixed now so dashboards and alert rules can be written against a stable
vocabulary before any exporter exists.

| Constant                   | Instrument name                   | Kind      | Labels used today     |
| -------------------------- | --------------------------------- | --------- | --------------------- |
| `requestCount`             | `http.request.count`              | counter   | `operation`, `result` |
| `requestDuration`          | `http.request.duration_ms`        | histogram | `operation`           |
| `errorCount`               | `http.error.count`                | counter   | `operation`, `code`   |
| `throttleCount`            | `http.throttle.count`             | counter   | `policy`, `operation` |
| `cacheHit`                 | `cache.hit.count`                 | counter   | —                     |
| `cacheMiss`                | `cache.miss.count`                | counter   | —                     |
| `outboxQueueDepth`         | `outbox.queue.depth`              | gauge     | —                     |
| `outboxOldestAgeSeconds`   | `outbox.queue.oldest_age_seconds` | gauge     | —                     |
| `outboxRetryCount`         | `outbox.retry.count`              | counter   | `eventType`           |
| `outboxDeadLetterCount`    | `outbox.dead_letter.count`        | counter   | `eventType`           |
| `workerProcessingDuration` | `worker.processing.duration_ms`   | histogram | `eventType`           |

Adding an instrument is a reviewable change to `src/server/observability/metrics.ts`.

**Label sets are deliberately low-cardinality.** `tenantRef` is **not** a label. Per-tenant series
would explode cardinality and would leak tenant enumeration into a metrics store that has no tenant
isolation, no RLS, and no retention rules. Labels are never identifiers and never free text.

## 6. Error monitoring — a port, not a platform

State it plainly: **no DSN, no project, and no provisioned monitoring platform exists.**
`RecordingErrorMonitor` is the default transport. It writes the sanitised event to the structured
log at error level and keeps a bounded in-memory ring of the last 100 events for tests and for the
monitoring rehearsal. It is honest by construction: it claims nothing about an external service.

A Sentry-or-equivalent adapter is a small class implementing `ErrorMonitor`, installed by
**deployment composition** via `setErrorMonitor()`. The contract it must satisfy is exactly the
`MonitoringEvent` interface. Wiring a real client here would either require a secret this
repository must not hold, or would silently no-op.

**Sanitisation happens at the boundary, not in the adapter.** `captureException()` scrubs the
message and the stack, redacts the extra context, and reduces the caller to `tenantRef` /
`actorRef` before the event reaches any transport. A third-party SDK can therefore never be handed a
raw error object carrying request bodies, headers, or database rows.

| Field                                  | Included | Note                                                                                                       |
| -------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `severity`, `errorName`, `errorCode`   | Yes      |                                                                                                            |
| `message`                              | Yes      | Scrubbed                                                                                                   |
| `stack`                                | Yes      | Scrubbed. Retained because it is the entire point of error monitoring, and never returned to an API caller |
| `correlationId`, `module`, `operation` | Yes      |                                                                                                            |
| `tenantRef`, `actorRef`                | Yes      | Opaque references only                                                                                     |
| `context`                              | Yes      | Redacted                                                                                                   |
| Request body, headers, database rows   | **No**   | Not reachable from the capture boundary                                                                    |

**Only genuine server faults are captured.** The route handler sends an exception to monitoring
only when the resolved status is ≥ 500. Sending every 403 and 422 there turns the monitor into a
second access log and buries real incidents.

## 7. Health and readiness

The distinction is the whole point, and getting it wrong is how a rolling deploy drops traffic.

| Signal        | Question                                   | Wrong answer costs                                                          |
| ------------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| **Liveness**  | Is this process alive?                     | A live-but-not-ready instance restarted while it is starting up or draining |
| **Readiness** | Should a balancer send this instance work? | Requests routed to an instance that cannot serve them                       |

Readiness goes false **first** during shutdown, so a balancer stops sending requests before the
process stops accepting them.

### 7.1 Web-role readiness — `foundationReadiness()`

| Check                              | Meaning                                                          |
| ---------------------------------- | ---------------------------------------------------------------- |
| `database.reachable`               | A read-only transaction opened and answered                      |
| `database.role.no-bypassrls`       | The connection role has no `BYPASSRLS` attribute (P1-13-SEC-002) |
| `capability.audit.append`          | `has_function_privilege` on `iam.audit_append`                   |
| `capability.outbox.publish`        | `has_table_privilege` INSERT on `shared.event_outbox`            |
| `capability.idempotency.store`     | `has_table_privilege` INSERT on `shared.idempotency_keys`        |
| `capability.security-event.record` | `has_table_privilege` INSERT on `iam.security_events`            |

The four capability checks pass on a database carrying the
[DBCR-P1-13-001](../database/change-requests/DBCR-P1-13-001-backend-runtime-write-grants.md)
grant migration. They are probed rather than assumed, because the answer describes the connection
in hand — a pool opened as the wrong role, or against a database that never received the
migration, is exactly what the probe is for.

States: `ready`, `degraded`, `unavailable`. A failing `database.*` check is **unavailable**. A
missing write capability is **degraded, not unavailable** — reads still work, and taking a whole
tier out of rotation over one absent grant would convert a deployment defect into an outage while
hiding which capability was actually missing.

On any thrown error the report is `unavailable` with no detail: **the driver message is never
surfaced**, because readiness output is frequently exposed more widely than application responses.

### 7.2 Worker-role readiness — `workerReadiness()`

| Check                 | Meaning                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `queue.reachable`     | The queue-health query answered                                                                                                 |
| `worker.loop.running` | The claim loop is running and not stopping                                                                                      |
| `queue.depth`         | Pending plus claimed, and the oldest pending age — **reported, never a failure**; a deep queue means "work to do", not "broken" |
| `queue.dead-letters`  | Zero is `ready`; non-zero is `degraded`                                                                                         |

A stopped loop is `unavailable`. The two roles report separately because they scale, fail, and
drain independently.

### 7.3 What is not wired yet

`src/server/health/readiness.ts` provides the **signals**. No HTTP route is added for them in this
phase: `/api/health` (Phase 1-1) remains the container probe, and the richer health endpoints are
assigned to **Phase 1-15**. Wiring these functions to routes is that phase's work, and this document
does not describe them as reachable today.

## 8. Trace-context readiness

No distributed tracing is implemented and no collector is provisioned. What exists is the property
that makes tracing addable without redesign:

- A single identifier already spans the web request, the transaction, the audit record, the event
  envelope, the worker's processing of that envelope, and the response — the same span an
  end-to-end trace would need to cover.
- `causationId` already carries the parent relationship between a command and the event that caused
  it, which is the edge a trace graph is built from.
- Both identifiers are UUIDs in fixed columns, and both are propagated by the pipeline rather than
  by call-site discipline.

When tracing is adopted, the expected shape is W3C Trace Context (`traceparent` / `tracestate`)
carried alongside — not instead of — `x-correlation-id`, with the same inbound-validation rule:
accept only a syntactically valid value, otherwise generate a new one and never echo the input.
Adopting it requires a collector, which requires a provisioned environment (ADR-012). None exists,
and nothing here should be read as a claim that tracing is available.

## 9. Evidence status

Everything measurable about this foundation today comes from the Local environment: the unit suites
under [`tests/foundation/`](../../tests/foundation/), the OpenAPI contract test, and the
database-backed suites under [`tests/backend/`](../../tests/backend/) run by
`vitest.config.backend.ts` against a local PostgreSQL with the Release 2 migrations applied. All of
it is **development and test evidence**. None of it is, or may be presented as, evidence of
production behaviour, capacity, throughput, latency-SLO compliance, or availability — no such
environment exists, and P1-OD-027 (NFR-SCL) is unresolved.

## 10. Review and governance

Nothing reached protected develop outside the approved pull-request and hosted-CI flow. The work
was reviewed under the Standing Technical Authorization and Solo Developer Review policies.

Owner: Eng. Ezzaldeen Al-Bitar. No independent third-party review, external audit, or separation of
duties exists or is claimed.
