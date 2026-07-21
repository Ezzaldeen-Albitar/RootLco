# Backend Architecture and Shared Application Foundation

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Binding standard — applies to every backend phase from Phase 1-13 onward ·
**Date:** 2026-07-21 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (under the
[Standing Technical Authorization Policy](../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../governance/solo-developer-review-policy.md) —
owner-authorized technical self-review, never an independent third-party audit) ·
**Task IDs:** P1-13-BE-001 … P1-13-BE-021, P1-13-SEC-001 … P1-13-SEC-006, P1-13-DO-001 ·
**Related:** [ADR-001 Modular Monolith Architecture](../adr/ADR-001-modular-monolith-architecture.md) ·
[ADR-012 Local-First Environment](../adr/ADR-012-local-first-environment-with-controlled-promotion.md) ·
[API Conventions v0.1](./api-conventions-v0.1.md) ·
[Error Catalog v0.1](./error-catalog-v0.1.md) ·
[Event Catalog v0.1](./event-catalog-v0.1.md) ·
[Observability Standard](./observability-standard.md) ·
[Scalability and Backpressure Standard](./scalability-and-backpressure-standard.md) ·
[RLS Standard](../database/rls-standard.md) ·
[Transaction and Concurrency Standard](../database/transaction-and-concurrency-standard.md) ·
[Secure Coding Standard](../security/secure-coding-standard.md) ·
[DBCR-P1-13-001](../database/change-requests/DBCR-P1-13-001-backend-runtime-write-grants.md)

---

## 1. Purpose and scope

This standard describes the backend foundation that exists in `src/server/` and
`src/modules/meta/` today: how modules are separated, how a request is layered, how the
request pipeline is assembled, and how the database session is scoped. It is binding on every
later backend phase.

It describes **only implemented behaviour**. Where something is a contract-only stub, a port
without a production adapter, or deferred to a later phase, that is stated in place rather than
implied away.

**What Phase 1-13 delivers.** Module-boundary and layering enforcement, the request pipeline,
server-resolved request context, the scoped transaction wrapper, the controlled data-access
layer, boundary validation, cursor pagination, the error catalog and problem-document renderer,
correlation, structured logging, redaction, the metrics and error-monitoring ports, the
authorization and entitlement middleware, idempotency, optimistic concurrency, the event
envelope and transactional-outbox publisher, the outbox worker with consumer idempotency, two
contract-only service interfaces, the OpenAPI generator, and one reference endpoint.

**What Phase 1-13 does not deliver.** No business endpoint. No login (the session authenticator
is a port whose default fails closed). No file transfer. No notification delivery. No frontend.
No database schema change — the single migration this phase adds
([DBCR-P1-13-001](../database/change-requests/DBCR-P1-13-001-backend-runtime-write-grants.md), §10)
alters grants, policies, and two function bodies only, and creates no table, column, constraint,
index, sequence, or role. No published domain event — the event catalog reserves
names only. No environment beyond Local exists (ADR-012), so this document makes no
production-readiness, capacity, throughput, latency, failover, replica, CDN, or load-balancer
claim of any kind. Every numeric limit named here is a **proposed validation baseline pending
measurement**; open decision **P1-OD-027 (NFR-SCL)** is unresolved.

## 2. Where the foundation lives

| Path                        | Contents                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `src/server/http/`          | Route-handler pipeline, boundary validation, idempotency, rate limiting, proxy trust |
| `src/server/auth/`          | Operation registry, authorization middleware, entitlement middleware                 |
| `src/server/context/`       | Authentication port, request context, server-side scope resolution                   |
| `src/server/db/`            | Pools, transaction wrapper, repository base, pagination, concurrency, capabilities   |
| `src/server/errors/`        | `AppFailure`, error catalog, RFC 9457 problem renderer                               |
| `src/server/events/`        | Event envelope and the transactional-outbox publisher                                |
| `src/server/worker/`        | Outbox worker, consumer registry, worker database access, backoff                    |
| `src/server/observability/` | Correlation, logger, redaction, metrics, error-monitoring port                       |
| `src/server/cache/`         | Cache port, in-process adapter, key factory, eligibility matrix                      |
| `src/server/audit/`         | Audit append wrapper, security-event candidates                                      |
| `src/server/contracts/`     | File and notification service contracts (stubs)                                      |
| `src/server/health/`        | Health and readiness signals                                                         |
| `src/server/openapi/`       | OpenAPI document generation from the operation registry                              |
| `src/server/layering.ts`    | Application/domain service base classes and the composition root                     |
| `src/modules/meta/`         | The reference module: public surface, application, domain, data                      |

## 3. Module boundaries

### 3.1 The rule

ADR-001 fixes the rule: a module is imported **only** through its public surface,
`@/modules/<name>`. Everything under `application/`, `domain/`, and `data/` is internal.
`src/modules/meta/index.ts` is the reference: it exports behaviour and types, and never a
repository. Handing out a repository would let a caller run SQL under another module's identity
and bypass that module's invariants.

ADR-001 also records the weakness this creates: in a modular monolith a boundary violation does
not fail to compile or fail to route — it simply works. Enforcement is therefore tooling, in two
independent layers.

### 3.2 Layer one — ESLint (`eslint.config.mjs`)

Two `no-restricted-imports` blocks:

| Block | Applies to                                     | Restricted patterns                                      | What it prevents                                                                                                                    |
| ----- | ---------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `src/**/*.{ts,tsx}`                            | `@/modules/*/*`; `../../modules/*`, `../../../modules/*` | Deep imports into a module's internals, and the relative-path spelling of the same mistake at two depths                            |
| 2     | `src/shared/**`, `src/lib/**`, `src/config/**` | `@/modules`, `@/modules/*`, `@/modules/**`               | Foundation code depending on a domain module, which would invert the dependency graph and make the foundation unusable in isolation |

ESLint is fast, runs in the editor, and catches the common case at the moment it is typed. It is
not sufficient on its own: a pattern on the `@/` alias never matches a relative path that escapes
a module at an unlisted depth, and ESLint expresses "who may import whom", not "which layer may
reach which layer".

### 3.3 Layer two — `scripts/check-module-boundaries.mjs`

A dependency-free script that walks `src/`, extracts every static import, `export … from`,
dynamic `import()`, and `require()`, resolves relative specifiers, and applies seven rules. It
exits `0` clean, `1` on violations, `2` on a usage or IO error, and runs identically locally and
in CI so "it passes on my machine" cannot mean a different rule set. `--scan-dir` points it at an
alternative tree, which is how a deliberate violation is proven to fail rather than assumed to.

| Rule                                         | What it enforces                                                                                             | What it prevents                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| **B1** module-deep-import                    | `@/modules/<name>/<anything>` is rejected unless the importing file belongs to that same module              | Callers coupling to another module's internals through the alias                                                  |
| **B2** relative-module-escape                | A relative path that resolves inside another module's internals is rejected; the module's `index` is allowed | The same coupling spelled `../../modules/x/data/y`, which no alias pattern matches                                |
| **B3** foundation-must-not-depend-on-modules | Files under `server/`, `shared/`, `lib/`, `config/` may not import `@/modules/…`                             | Dependency inversion — a foundation that cannot be used, tested, or extracted without the domain modules          |
| **B4** handlers-hold-no-data-access          | Files under `app/` may not import `@/server/db`, `@/server/events`, `@/server/audit`, or `@/server/worker`   | Business logic and SQL migrating into Route Handlers, bypassing the application-service layer and its invariants  |
| **B5** domain-layer-is-database-free         | Files under `modules/*/domain/` may not import `@/server/db` or `pg`                                         | Domain rules acquiring I/O, which makes them untestable without a database and lets a rule depend on query shape  |
| **B6** foundation-must-not-import-app        | Files under `server/`, `shared/`, `lib/`, `config/`, `modules/` may not import `@/app/…`                     | The foundation becoming unusable outside the Next.js app tree — including in the worker process and in tests      |
| **B7** backend-uses-the-backend-logger       | Files under `server/` and `modules/` may not import `@/lib/logging/logger`                                   | Backend records bypassing the standard field set and the redaction layers by using the Phase 1-1 bootstrap logger |

Both layers are advisory only if nothing runs them. `npm run validate:module-boundaries` is a
named script and part of `npm run gate:p1-13`.

### 3.4 A second coverage gate

`scripts/check-authorization-coverage.mjs` reconciles two sources that must agree: every
`route.ts` under `src/app/api/v1/**`, and every `defineOperation({…})` literal in the tree. A
route with no declaration, a declaration with no route, a declaration with no permission codes,
a `public: true` with no `publicReason`, or a non-`none` audit class with no audit action all
fail the build. Runtime registration already refuses an incomplete declaration
(`defineOperation()` throws at import time); this script closes the other half, where a route
exists and never registers at all. See [Section 6](#6-the-request-pipeline).

## 4. Layering

Four layers, each with exactly one job. The base classes are in `src/server/layering.ts`.

| Layer                   | Responsibility                                                                                       | Must not                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Route Handler**       | Parse and validate the request, call one application service, return its value                       | Contain business logic; touch the database, events, audit, or the worker (B4)            |
| **Application service** | Orchestrate the use case: call domain services and repositories in order, publish events, emit audit | Know anything about HTTP; open its own transaction; hold a handle on the instance        |
| **Domain service**      | Decide. Pure rules over values it is given                                                           | Touch the database — not even through an injected client (B5); perform I/O; read a clock |
| **Repository**          | Own the SQL, behind the context guard                                                                | Run without a resolved context; interpolate values; return an unbounded, unordered list  |

Two details are deliberate and worth stating:

- **The transaction handle is passed per call, never held on a service instance.** A service
  instance is cheap and stateless and may outlive a request; holding a handle would let one
  request's transaction leak into another's.
- **`DomainService` has no database access in its type at all**, not even an injected one. A rule
  that needs state receives that state as an argument. Rules that can be unit-tested without a
  database therefore are unit-tested without a database.

`src/modules/meta/` is the copyable shape: `application/ping-service.ts` orchestrates,
`domain/ping-policy.ts` decides, `data/meta-repository.ts` runs one bounded, parameterised,
explicitly tenant-predicated statement, and `index.ts` composes them.

## 5. The composition root

`composeModule()` in `src/server/layering.ts` is the whole dependency-injection story: a module
exposes a `ModuleComposition` with a `create()` factory, and `composeModule()` memoises it so the
services are constructed once per process.

A full DI container was rejected deliberately. Containers trade explicit wiring for runtime
resolution, and their characteristic failure mode is a missing or mis-scoped binding discovered
at run time. With a factory, the wiring is ordinary code and the type system checks it: a service
whose dependency is not supplied does not compile.

```ts
export const metaModule = composeModule({
  module: 'meta',
  create: () => ({
    ping: new PingService(new MetaRepository(), new PingPolicy()),
  }),
});
```

Ports installed by composition rather than by a handler — the session authenticator, the metrics
recorder, the error monitor, the cache, the rate-limit store, the file and notification services
— each expose a `setX()` function. Those setters are for deployment composition and test
harnesses only; a handler that called one would be reaching outside its layer.

## 6. The request pipeline

`handleOperation()` in `src/server/http/route-handler.ts` assembles the entire request path in
one fixed order, so no handler can skip a step or run two in the wrong sequence:

```text
correlation → rate limit (unauthenticated dimensions) → authenticate →
resolve context → open transaction → authorize → entitlement →
rate limit (tenant/user dimensions) → idempotency → handler → respond
```

### 6.1 Why this order

| Position                                                      | Reason                                                                                                                                                                                                                 |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rate limiting before authentication** for IP-keyed policies | A credential-stuffing loop must be throttled _before_ the request performs session work. A policy whose `keyBy` contains neither `tenant` nor `user` is evaluated pre-authentication, keyed on the resolved client IP. |
| **Authorization before entitlement**                          | An unauthorized caller must not learn which features a tenant has bought. Running entitlement first would leak subscription shape to a caller who is not permitted to be there at all.                                 |
| **Both before the handler body**                              | A denied request performs no work and leaves no side effect.                                                                                                                                                           |
| **Idempotency inside the transaction**                        | The reservation row and the command it guards commit together. Reserving in a separate transaction would leave keys behind for commands that rolled back and permanently block the retry.                              |
| **Tenant/user-keyed rate limiting after context resolution**  | Those dimensions do not exist until the principal is resolved. Keying them earlier would mean keying them on a value the caller controls.                                                                              |

The consequence is that handlers contain no cross-cutting logic at all. They receive an
already-authorized `DbHandle` and return a value. That is what makes rule B4 enforceable: there
is nothing left in a handler to enforce against.

### 6.2 Registration is the security metadata

Every operation declares itself through `defineOperation()` (`src/server/auth/operation-registry.ts`)
before it can be invoked. The declaration carries the permission codes, scope requirement, audit
class and action, entitlement flag, idempotency and version guards, rate-limit policy, and cache
category. Registration fails loudly at module load — therefore in the build and in tests — when:

- an operation declares no permission codes and is not marked `public`;
- an operation is `public` with no `publicReason`, or is `public` and also declares permissions;
- a non-`none` audit class declares no audit action, or `none` declares one;
- the id or path violates its format, or the id or `METHOD path` pair is already claimed.

`public: true` is deliberately verbose to write and is reported by the coverage check, so it can
never be the quiet default.

### 6.3 Failure handling

Every exit path — success, denial, validation failure, unhandled fault — carries the correlation
ID, and every failure is an RFC 9457 problem document assembled only from the catalog entry plus
the failure's `safeDetails`. Only faults with status ≥ 500 are sent to error monitoring: routing
every 403 and 422 there turns the monitor into a second access log and buries real incidents.

### 6.4 The public path

`operation.public === true` takes a separate path with no context, no transaction, and no
database handle. The types make that explicit — the handler receives a handle typed as present
but never constructed — rather than handing over a half-built one that would fail deeper in.

## 7. The scoped-session contract

`withTransaction()` in `src/server/db/transaction.ts` is the only way the backend reaches
PostgreSQL. It enforces three things that are easy to forget individually and fatal to forget
together.

**1. Context before query.** Before any caller statement runs, the wrapper sets four GUCs with
bound parameters — never interpolation — using the transaction-local form:

```sql
SELECT set_config($1, $2, true)
```

| GUC               | Value                                        | Database contract                                                                           |
| ----------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `app.tenant_id`   | `context.principal.tenantId`                 | Read by `iam.current_tenant_id()`; an invalid value is treated as "no context"              |
| `app.user_id`     | `context.principal.userId`                   | Read by `iam.current_user_id()`                                                             |
| `app.company_ids` | `context.companyIds.join(',')`, may be empty | Read by `iam.current_company_ids()` / `iam.allowed_company_ids()`; empty means tenant scope |
| `app.branch_ids`  | `context.branchIds.join(',')`, may be empty  | Read by `iam.current_branch_ids()`; empty means no branch narrowing                         |

The third argument `true` is the point. It makes the setting **transaction-local**: the values
evaporate at `COMMIT` or `ROLLBACK`, so a pooled connection cannot leak one tenant's context into
the next request. In a pooled multi-tenant application that is the single most dangerous failure
mode, and it is closed structurally rather than by discipline. `SET LOCAL statement_timeout`
follows the same rule.

**2. No context, no handle.** A `DbHandle` cannot be constructed without a `RequestContext`, so
"the repository forgot to set the tenant" is a compile error rather than a cross-tenant read.
`Repository.assertContext()` adds the behavioural half: it checks the _shape_ — a context with an
empty tenant or user is as dangerous as none — and fails with `ERR-CTX-001` before the statement
reaches the database. Relying on RLS alone would work, because default-deny returns zero rows,
but an empty result set looks like "no data" rather than "the application forgot who was asking".

**3. All-or-nothing.** Business state, status history, audit append, and the outbox row share one
transaction, so an event exists if and only if its source transaction committed (BR-INT-001).
Nesting uses `SAVEPOINT`s: a nested block that throws rolls back to its savepoint, releases it,
and rethrows, so an inner failure cannot silently commit an outer partial state.
`withReadOnlyTransaction()` starts `BEGIN READ ONLY`, which turns "this handler should not write"
from a review comment into a property PostgreSQL enforces.

After a failed `ROLLBACK` the client is released with `release(true)` — destroyed rather than
returned to the pool carrying an unknown transaction state.

### 7.1 Scope is resolved, never accepted

`src/server/context/resolve-context.ts` exists to enforce one rule: **client-supplied scope never
reaches `set_config`**. A request may mention a company or branch as a filter or a path
parameter, but that value is a claim to be checked, never the scope itself.

- `resolveScopeFor()` reads the caller's actual grants from `iam.role_grants` and
  `iam.grant_scopes`, inside a short read-only transaction that carries only `app.tenant_id` —
  all the account-lookup policy needs, and not enough to satisfy any policy that requires a user.
- The claimed tenant is a **lookup key**, not an assertion: the account row must exist in that
  tenant with the session's provider subject, active and not deleted. A session claiming another
  tenant finds nothing and is denied with `ERR-IAM-002`.
- `narrowScope()` intersects a requested narrowing with what the caller holds and **rejects**
  rather than silently drops anything outside it. Silently dropping would turn "show me branch X"
  into "show me everything", which is the wrong direction to fail. The denial is uniform and
  never reveals whether the id exists.
- An `unrestricted` grant means tenant-wide, so the resolver returns empty company and branch
  lists — passing the scoped ids as well would silently _narrow_ a tenant-wide operator.

The resulting `RequestContext` is frozen at construction, including its arrays, so a downstream
service cannot widen its own scope halfway through a request. There is no ambient or global
context; it is passed as an argument, so a repository that forgot it does not compile.

### 7.2 Authorization is evaluated in the database

`requirePermissions()` calls `iam.has_permission()` or `iam.has_permission_in_scope()` inside the
same transaction and under the same session context the handler will use. The permission model,
deny precedence, grant validity windows, and scope matching already live there and were gated in
Phase 1-4. Re-implementing them in TypeScript would create a second source of truth whose drift
would be silent until it was a breach. Evaluating inside the request transaction also means the
decision and the work see one snapshot, so a grant revoked mid-request cannot be half-applied.

## 8. Web and worker role separation

The web request path and the outbox worker are different database archetypes, different pools,
and different processes. `src/server/worker/worker-db.ts` is where that separation is made real.

| Property        | Web role                                                                                   | Worker role                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Connection      | `DATABASE_URL`, login role in `app_runtime`                                                | `WORKER_DATABASE_URL`, login role in `app_worker`                                              |
| Session context | `app.tenant_id` / `app.user_id` / `app.company_ids` / `app.branch_ids` set per transaction | **None.** The tenant of each event is read from the row                                        |
| RLS posture     | Tenant-scoped policies                                                                     | `USING (true)` — deliberately all-tenant, because a dispatcher must drain every tenant's queue |
| Pool sizing     | `DB_POOL_MAX`                                                                              | `max(2, OUTBOX_MAX_CONCURRENCY + 1)` — sized by its own concurrency                            |
| Readiness       | `foundationReadiness()`                                                                    | `workerReadiness()`                                                                            |

The request path must never borrow the worker connection. The worker's all-tenant policies exist
so a dispatcher can see every tenant's queue; granting that to a request handler would dissolve
tenant isolation for user-facing reads. This is why DBCR-P1-13-001 gave the runtime archetype its
own tenant-scoped grants rather than "just run as `app_worker`" — see
[the change request, §3](../database/change-requests/DBCR-P1-13-001-backend-runtime-write-grants.md).
The runtime role may now insert an event into `shared.event_outbox`; it still holds nothing on
`shared.processed_events` or `shared.error_records` and no EXECUTE on the claim, complete, or fail
routines, so producing an event and draining the queue remain separate powers.

The two roles also report readiness separately (`src/server/health/readiness.ts`), because they
scale, fail, and drain independently: a worker that cannot reach the queue must leave the
rotation without taking the web tier with it.

## 9. Ports, stubs, and what is deferred

Everything below is a **contract**, not an implementation. Each names the phase that owns its
behaviour.

| Contract                                                    | Default in P1-13                                                                                     | Behaviour owned by                                                                         |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `SessionAuthenticator` (`context/principal.ts`)             | `UnconfiguredAuthenticator` — returns `null`, so every authenticated operation answers `ERR-IAM-002` | Phase 1-14 and its approved provider decision                                              |
| `FileService` (`contracts/file-service.ts`)                 | `NotImplementedFileService` — every call throws `ERR-STB-001`                                        | Phase 1-15                                                                                 |
| `NotificationService` (`contracts/notification-service.ts`) | `NotImplementedNotificationService` — throws `ERR-STB-001`                                           | Phase 1-15 / Phase 1-23                                                                    |
| `ErrorMonitor` (`observability/monitoring.ts`)              | `RecordingErrorMonitor` — sanitised event to the structured log plus a bounded in-memory ring        | Deployment composition; no DSN or platform is provisioned                                  |
| `MetricsRecorder` (`observability/metrics.ts`)              | `InMemoryMetricsRecorder` — bounded counters, gauges, observations                                   | Deployment composition; no metrics backend is provisioned                                  |
| `Cache` (`cache/cache.ts`)                                  | `InMemoryCache` — bounded, in-process                                                                | A `DistributedCache` adapter, if and when horizontal scaling is approved                   |
| `RateLimitStore` (`http/rate-limit.ts`)                     | `InMemoryRateLimitStore` — correct for one process only                                              | A `DistributedRateLimitStore` adapter; `assertStoreSuitableForMultiInstance()` is the gate |
| Replica routing (`db/pool.ts`)                              | `poolFor('replica')` returns the **primary** and logs once                                           | [ADR-017](../adr/ADR-017-read-replica-readiness.md) — not activated                        |

The stubs reject rather than return an empty success. A "successful" no-op upload registration
would let a caller believe a document exists, which is a worse failure than a clear 501.

## 10. Failing closed on a missing database capability

The Release 2 grant surface as frozen gave the `app_runtime` archetype **SELECT only** across
`shared` and `iam`, so four foundation write capabilities had no path to the database at all. That
defect was raised with executed evidence as
**[DBCR-P1-13-001](../database/change-requests/DBCR-P1-13-001-backend-runtime-write-grants.md)**
and is now implemented by `20260725090000_iam_shared_runtime_write_capabilities.sql`, the 114th
migration and the only one this phase adds. All four capabilities are available to the request
path:

| Capability              | Object                                             | Grant to `app_runtime`                                                                         |
| ----------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `audit.append`          | `iam.audit_append(...)` and the three audit tables | EXECUTE on `audit_append`, `audit_mask`, `audit_canonical`, `audit_hash`; INSERT on the tables |
| `outbox.publish`        | `shared.event_outbox`                              | SELECT, INSERT                                                                                 |
| `idempotency.store`     | `shared.idempotency_keys`                          | SELECT, INSERT                                                                                 |
| `security-event.record` | `iam.security_events`                              | INSERT                                                                                         |

Each of the eleven policies the migration adds is `tenant_id = iam.current_tenant_id()` — far
narrower than the worker's `USING (true)`, and a session with no resolved tenant matches nothing.
What was deliberately **not** granted matters as much: no UPDATE, DELETE, or TRUNCATE on any of
these tables; nothing at all for `app_readonly`; no `BYPASSRLS`; no ownership; no `SECURITY
DEFINER` routine (the database still holds none); no EXECUTE on `shared.claim_outbox_events`,
`shared.complete_outbox_event`, `shared.fail_outbox_event`, or `iam.audit_verify_chain`; and no
access to `shared.processed_events` or `shared.error_records`. Append-only stays the security
property of the audit trail.

**Writing an audit record is not reading audit history.** Reading `iam.audit_records`,
`iam.audit_record_details`, or `iam.security_events` still requires the `iam.audit.view`
permission. The two `sel_audit_*_unlinked` policies exist only so `iam.audit_append` can see the
row it is in the middle of building: they match a record that has no chain link yet, and the
function writes the link last, so a committed record never qualifies and the window closes inside
the same transaction. The one deliberate widening is recorded in §7 of the change request — any
session of a tenant may read that tenant's `iam.audit_integrity_links`, which holds a counter, an
opaque record id, and two SHA-256 digests, and no action, actor, entity, or field value. It is
rated Low and accepted with its reasoning stated rather than absorbed silently.

The foundation still treats the capability as a measurement rather than an assumption.
`preflightPrivileges()` (`src/server/db/capabilities.ts`) asks PostgreSQL what the current
connection may actually do via `has_table_privilege` / `has_function_privilege`, and
`requireCapability()` (`src/server/db/require-capability.ts`) runs **before** the write is
attempted, so a failure names the missing capability and the change request instead of surfacing
as a bare SQLSTATE `42501` from inside an INSERT. "The migration is applied" is a claim about a
deployment, not about the connection in hand; the gate now guards against a connection opened as
the wrong role or against a database that never received the migration.

**It fails closed.** There is deliberately no "skip the audit record and continue" branch. A state
change without its evidence, or a command without its event, is worse than a refused command: it
is a silent integrity hole nobody notices until an investigation needs the record that was never
written. The consequence, stated plainly: **wherever audit append, outbox publication, or
idempotency storage is not actually available to the connection, the operation requiring it is
refused rather than executed unguarded.**

One deliberate asymmetry: `recordSecurityEvent()` does **not** fail the request when the durable
write is unavailable. It always emits the structured log record and the metric, attempts the
insert only when the capability is present, and never escalates telemetry loss into a 500. The
difference is that an audit record is evidence of a change that is happening, while a security
event describes an action that was already refused — the refusal is the control, and its
telemetry is not.

On a database carrying the migration, the preflight reports all four capabilities as available and
both gates pass without an application change — the code path was written once and did not move
when the grants arrived.

## 11. Verification

| Check                          | Command                                   | What it proves                                                              |
| ------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------- |
| Module boundaries and layering | `npm run validate:module-boundaries`      | Rules B1–B7 hold across `src/`                                              |
| Authorization coverage         | `npm run validate:authorization-coverage` | Every route is registered and every registration is guarded                 |
| OpenAPI structure              | `npm run validate:openapi`                | The committed document is structurally sound and every operation is guarded |
| Phase gate aggregate           | `npm run gate:p1-13`                      | The above plus lint, typecheck, format, security scans, and the test suites |

The database-backed suites live under [`tests/backend/`](../../tests/backend/) and are run by
`vitest.config.backend.ts` (`npm run test:backend`), split from `npm test` because they need a live
PostgreSQL with the Release 2 migrations and the DBCR-P1-13-001 grant migration applied; they
connect as a member of the deployed `app_runtime` archetype, not as a role invented for the test
run. The unit tier is [`tests/foundation/`](../../tests/foundation/). The database-side proof of the
granted surface — and of everything that must remain denied — is
`tests/db/p1-13-runtime-capabilities.test.ts` (27 tests). Conventions for both tiers are in
[backend testing conventions](../testing/backend-testing-conventions.md). All such results are
**development and test evidence** from the Local environment only; none of it is a statement about
hosted behaviour, because no hosted environment exists (ADR-012).

## 12. Review and governance

Nothing reached protected develop outside the approved pull-request and hosted-CI flow. The work
was reviewed under the Standing Technical Authorization and Solo Developer Review policies.

Owner: Eng. Ezzaldeen Al-Bitar. He is the sole technical decision maker, implementer, reviewer, QA
reviewer, security reviewer, and repository administrator. No independent third-party review,
external audit, or separation of duties exists or is claimed.
