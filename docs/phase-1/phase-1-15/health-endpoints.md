# Phase 1-15 — Health Endpoints: liveness, readiness, and the endpoint that did not change

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Release group:** Release 3 — Backend Foundation ·
**Phase:** P1-15 — Shared Services Backend ·
**Date:** 2026-07-23 ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent third-party audit. The Phase 1-15 owner gate is
[Pending](phase-1-15-owner-gate.md).**

**Implementation:**
[`application/health-service.ts`](../../../src/modules/shared-services/application/health-service.ts) ·
[`server/health/readiness.ts`](../../../src/server/health/readiness.ts) ·
**Routes:**
[`GET /api/v1/health/live`](../../../src/app/api/v1/health/live/route.ts) ·
[`GET /api/v1/health/ready`](../../../src/app/api/v1/health/ready/route.ts) ·
[`GET /api/health` (Phase 1-1, unchanged)](../../../src/app/api/health/route.ts) ·
**Evidence:**
[`tests/foundation/p1-15-health.test.ts`](../../../tests/foundation/p1-15-health.test.ts) ·
[`tests/health.test.ts`](../../../tests/health.test.ts) ·
**Related:** [ADR-015 — load-balancer readiness](../../adr/ADR-015-load-balancer-readiness.md)

---

## 1. Three endpoints, three different questions

| Path                   | Question it answers                                     | Touches                       |
| ---------------------- | ------------------------------------------------------- | ----------------------------- |
| `/api/v1/health/live`  | Is this process running?                                | Nothing                       |
| `/api/v1/health/ready` | Should this instance be sent work?                      | The database, under a timeout |
| `/api/health`          | Did this container's configuration resolve? (Phase 1-1) | Configuration validation only |

Conflating the first two is how a rolling deploy drops traffic, and P1-13 already separated the
_signals_. What P1-15 adds is the HTTP surface for them, at **new** versioned paths, as projections
of signals that already existed.

Both new routes are registered through `defineOperation()` with `public: true` and a written
`publicReason` that the coverage report prints, `auditClass: 'none'`, `rateLimitPolicy:
'low-risk-metadata'`, and `cacheCategory: 'never'`. A probe is called by an orchestrator or a
balancer before any credential exists, so requiring a session would make the endpoint useless; saying
_why_ in the registry is what keeps "public" a decision rather than an omission.

## 2. Liveness touches nothing, and that is the whole design

`HealthService.liveness()` reads `process.uptime()` and returns:

```json
{ "status": "alive", "uptimeSeconds": 0 }
```

No database query. No provider call. No configuration read. No write. Not even a hostname lookup.

The reasoning is operational rather than aesthetic. A liveness probe is wired to a **restart**. If it
touches the database, then every time the database hiccups the orchestrator concludes the process is
dead and restarts it — converting a brief dependency blip into a rolling outage across every
instance, at precisely the moment the dependency is least able to absorb reconnections. Liveness must
therefore answer a question the process can answer alone.

The payload is pinned by its **exact key set**, not by a spot check, so a later "just add the version,
it is harmless" is a failing test rather than a review comment somebody might miss. It carries no
version, no commit, no environment, no service name, no hostname, and no dependency name — the
evidence suite asserts the absence of the _values_ as well as the keys, because those are what a
caller fingerprinting a deployment actually wants.

`uptimeSeconds` is a duration, never a wall-clock instant. An instant would date the deployment; a
duration is exactly the fact a probe needs and nothing more.

The method is **synchronous** — it returns a value, not a promise — which is asserted as its own
test. A liveness probe that reached a database would have to be async, so the return type is itself
part of the guarantee, and the whole suite runs with no database configured.

## 3. Readiness reports a verdict, never a topology

`foundationReadiness()` (P1-13) computes a rich internal report so an operator reading a log can act
on it. Its `checks` are:

| Check name                   | Meaning                                               | `detail` it carries |
| ---------------------------- | ----------------------------------------------------- | ------------------- |
| `database.reachable`         | A read-only transaction opened and answered           | —                   |
| `database.role.no-bypassrls` | The connection role is not a `BYPASSRLS` role         | **the role name**   |
| `capability.<capability>`    | One per foundation write capability, available or not | —                   |

That is right for a log line and wrong for an HTTP body which is unauthenticated by necessity and
reachable from the load balancer's network. So `HealthService.readiness()` **projects** the report:
it keeps the check _name_ and the boolean verdict, and drops everything else.

### Exactly what is dropped

- **Every `detail` string** — including `preflight.currentRole`, the name of the database role the
  connection opened as. It is dropped, **not summarised**: the projection never reads the field, so
  there is no transformation of it that could be loosened later and no path by which a longer or
  shorter version of it reaches the body.
- **The `role` field** (`'web'` | `'worker'`) — which tier answered is not something the verdict
  needs, so it is not projected.
- Consequently: **no role name, no host, no bucket, no database name, no driver message, and no
  stack trace**, because none of them is copied into the projection in the first place.

A failure inside `foundationReadiness()` is already caught there and reported as
`state: 'unavailable'` with `database.reachable: false` rather than a raw driver message, so the two
layers agree: the driver's opinion never becomes a response body.

The disclosure limit is enforced at two depths. `ReadinessProjection` **cannot express a `detail`** —
asserted with `@ts-expect-error`, which `npm run typecheck` verifies — and `HealthService.readiness`
is separately pinned as returning exactly that type, so no detail string can reach a caller of the
real method either.

### The probe tenant

Building a `DbHandle` requires a request context, so the route passes a fixed
`PROBE_TENANT_ID`. That value never selects business data: the readiness query reads `pg_roles` and
`has_*_privilege`, which are not tenant-scoped. The constant exists because the invariant that a
query cannot run without a context is one this phase composes rather than bypasses.

## 4. Readiness is bounded

The whole probe races against `READINESS_TIMEOUT_MS`, configuration bounded to `50 … 10_000`
milliseconds with a default of `2_000`. A hanging dependency therefore yields a fast verdict instead
of holding a connection until the balancer's own timeout fires — the failure mode where a slow
dependency becomes an outage of the health check itself.

A timeout is reported as a **verdict**, not an error:

```json
{ "status": "unavailable", "checks": [{ "name": "readiness.timeout", "ok": false }] }
```

An exception is reported the same way, with `readiness.error`. Both choices exist for the same
reason: a probe that throws produces a 500 whose body is a problem document, and a balancer reading
that document learns more about the failure than it needs to.

Every outcome increments `readiness.dependency.count` with a `result` label
(`ready`, `degraded`, `unavailable`, `timeout`, or `error`), and every outcome except the exception
path also observes `readiness.dependency.duration_ms` with the same label. The timer is cleared in a
`finally` block, so a fast success does not leave a pending timeout behind.

## 5. Status-code mapping, and why `degraded` is 200

| Verdict       | HTTP status | Reasoning                                                                     |
| ------------- | ----------- | ----------------------------------------------------------------------------- |
| `ready`       | 200         | Send work                                                                     |
| `degraded`    | **200**     | Reads work; a missing write capability must not take the tier out of rotation |
| `unavailable` | 503         | Do not send work                                                              |

The verdict itself is computed in `foundationReadiness()`: a failing check whose name begins
`database.` is **blocking** and produces `unavailable`; any other failing check produces `degraded`.
That is the rule that makes a missing write grant a _documented change request_ rather than an
outage — the alternative, returning 503 because one capability is absent, would remove every instance
from rotation while reads are working perfectly.

The code follows the verdict so a balancer can act on it without parsing the body. The body still
names which check failed, so an operator gets the diagnosis and the balancer gets the decision, from
one response.

## 6. `/api/health` is unchanged, and stays unchanged

The Phase 1-1 endpoint is **not modified by P1-15**. Three facts make that a constraint rather than a
preference:

1. It is asserted by [`tests/health.test.ts`](../../../tests/health.test.ts) to return **exactly
   seven keys** — `commit`, `configured`, `environment`, `service`, `status`, `timestamp`, `version`
   — with the assertion written as an exact sorted-key equality, so an added field fails the test.
2. It is the **Docker container healthcheck** in `docker-compose.yml`:
   `curl -fsS http://127.0.0.1:3000/api/health`, interval 30s, timeout 5s, start period 40s, 3
   retries. `-fsS` fails on any non-2xx, so the endpoint's status code _is_ the container's health.
3. Its contract is deliberately narrow: `status` is `ok` or `degraded`, `configured` is a boolean
   derived from schema validation — it reports **that** configuration resolved, never **what** it is
   — and the response carries `Cache-Control: no-store`. When configuration has not resolved it
   answers 503 with `status: 'degraded'`, which is what makes the container check meaningful rather
   than decorative.

Reshaping it would break a working probe to gain nothing, so P1-15 added versioned paths beside it.

The P1-15 suite guards the boundary from its own side without duplicating that contract: it asserts
the original route module still exports `GET`, re-reads `tests/health.test.ts` and requires the
seven-key pin to still exist and still name exactly those seven keys, and requires that file to
contain no reference to `/api/v1/health`. If a future phase ever repointed the old path at the new
projection, the pin would have had to change — which is why both assertions are kept together.

## 6.1 Rate limiting: what it does, and exactly where it stops (P1-15-SR-004)

Both probes are `public: true`, and a public request never reaches the
post-authentication throttle — it has no tenant and no user to key on. Until the final adversarial
pass caught it, that meant **the two most exposed endpoints in the deployment were throttled by
nothing at all**, because `low-risk-metadata` keys on tenant.

The fix and its boundary are both worth stating precisely, because the obvious version of this fix
is worse than the defect.

`policyFor()` now substitutes a dedicated `public-probe` policy — keyed on **operation + client
address**, 120 requests a minute — for _any_ `public: true` operation, and the pipeline enforces it
**before** the handler. Two things follow. The two probes are separate buckets, so exhausting one
cannot silence the other; and any future public operation inherits the policy without anyone
remembering to ask.

**Where it stops.** `resolveClientAddress()` returns `null` unless the platform supplies a peer
address or `TRUSTED_PROXY_IPS` names a proxy. Neither is true in the current deployment: the App
Router handlers pass no peer address, and the trusted-proxy list is empty by default. With a null
address an ip-keyed policy collapses to **one global bucket** — and enforcing _that_ on a liveness
probe would be an own goal, because a hostile caller could exhaust the shared bucket and the
orchestrator's own probe would begin receiving `429`, which an orchestrator reads as an unhealthy
pod. The control would cause the outage it exists to prevent.

So the pipeline **skips** an ip-keyed policy on a public operation when no address is resolvable.
Concretely:

| Deployment                                                                       | Behaviour                                       |
| -------------------------------------------------------------------------------- | ----------------------------------------------- |
| Behind a configured trusted proxy, or on a platform that supplies a peer address | Throttled per client, per operation, at 120/min |
| Neither (the current state)                                                      | **Not throttled** — as before                   |

The collapse property is pinned by `tests/foundation/rate-limit.test.ts`: an omitted address and an
explicit `null` produce the same key, a real address produces a different one. Closing the remaining
half means plumbing a peer address from the platform, which is an infrastructure decision rather
than an application one.

## 7. What is deliberately not claimed

This section exists because health endpoints are the part of a system most often described as more
than it is.

- **No load balancer, orchestrator, or service mesh is provisioned.** These endpoints are the
  _signals_ such a component would consume. [ADR-015](../../adr/ADR-015-load-balancer-readiness.md)
  records readiness for one, not the existence of one.
- **No monitoring, alerting, dashboard, or on-call routing is provisioned.** Metrics are emitted
  through the existing in-process interface; nothing scrapes, stores, or alerts on them.
- **No SLO, availability target, failover behaviour, or throughput figure is claimed or measured.**
- **No CDN, replication, sharding, or multi-instance deployment exists**, so nothing here should be
  read as evidence about behaviour across instances.
- **The worker role is not exposed over HTTP.** `workerReadiness()` exists in
  [`server/health/readiness.ts`](../../../src/server/health/readiness.ts) and is returned by the
  worker entrypoint as an in-process function — it reports queue reachability, whether the loop is
  claiming, queue depth, and dead letters, and it flips to `unavailable` as soon as draining starts.
  **No P1-15 route serves it.** `/api/v1/health/ready` projects the web-role signal only.
- **Readiness proves a verdict was computed, not that a dependency is healthy in production.** The
  P1-15 evidence suite runs with no database: it proves the projection contract, the type-level
  impossibility of a `detail`, and the liveness key set. Executing the wired readiness path against a
  live database belongs to the database and backend tiers, and the suite says so about itself rather
  than implying otherwise.
