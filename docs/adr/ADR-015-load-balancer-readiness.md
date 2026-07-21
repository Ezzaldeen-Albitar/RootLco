# ADR-015: Load-Balancer Readiness

## Status

Accepted by owner instruction — for the application properties recorded below, which are binding on
every backend phase from Phase 1-13 onward.

**No load balancer is provisioned, and none is approved.** The hosting provider, production region,
and deployment platform remain **Open** (ADR-001, ADR-005, ADR-007, ADR-012), and a load balancer is
a property of a platform none of which has been chosen. Selection, configuration, and operation of a
balancer are **Open** and out of scope for this record.

This ADR records **what the application must be true of** so that a balancer can be introduced later
without redesign, and what a future balancer will have to satisfy. It makes no claim about
throughput, latency, failover, session affinity, or availability, because no such system exists to
observe. Open decision **P1-OD-027 (NFR-SCL)** is unresolved.

## Context

Only the Local environment exists. There is one process, reached directly, with no proxy in front of
it. That situation will not last, and two specific mistakes are cheap to avoid now and expensive to
undo later:

1. **Accidental statefulness.** In-process state that a request depends on — a session map, a
   correctness-critical lock, an ambient context — is invisible while there is one instance and
   becomes a correctness bug the moment there are two. It also tends to be load-bearing by the time
   anyone notices, which is why the fix is a redesign rather than a patch.
2. **Trusting forwarded headers.** `X-Forwarded-For` is meaningful behind a balancer and is
   attacker-controlled in front of one. Code written without a balancer usually either ignores it —
   and then reports the proxy's address as every client's — or trusts it unconditionally, which makes
   every IP-keyed control bypassable by adding a header.

Phase 1-13 also introduces two process roles (web and worker) that scale and fail independently, and
a rate limiter whose correctness depends on whether its store is shared. Both are decisions a
balancer would otherwise force at an inconvenient moment.

The remaining constraint is honesty. ADR-012 forbids describing an environment that does not exist,
and this record must therefore not read as a deployment design. It is a list of application
properties plus a list of requirements on a future component.

## Decision

**No load balancer is introduced.** The application maintains the properties in §1 so that one can be
introduced without redesign, and any future balancer must satisfy the requirements in §2.

### 1. Application properties maintained today

| Property                                         | How it holds today                                                                                                                                                                                                                                       | Why a balancer needs it                                                                                   |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Stateless request handling**                   | Every value comes from the request, the resolved `RequestContext`, or the database. `RequestContext` is built per request and frozen; there is no ambient or global context. The transaction handle is passed per call, never held on a service instance | Any instance can serve any request                                                                        |
| **No sticky sessions required**                  | Nothing in the request path depends on having been served by a particular instance. Session context in PostgreSQL is transaction-local, so a pooled connection never carries one request's tenant into the next                                          | Round-robin, least-connections, or random distribution are all valid; no affinity configuration is needed |
| **No correctness-critical state in memory**      | Idempotency keys, the outbox, processed-event markers, attempt counts, and leases are in PostgreSQL. In-process state is limited to caches, metrics, and registries, all of which are disposable                                                         | An instance can be added or removed at any time without losing work                                       |
| **No in-memory lock used as a distributed lock** | Exclusivity comes from the database: `FOR UPDATE SKIP LOCKED` for queue claims, a unique index for idempotency, a version predicate for concurrency                                                                                                      | Two instances behind a balancer cannot corrupt each other's work                                          |
| **Trusted-proxy client-IP resolution**           | `resolveClientAddress()` reads forwarded headers **only** when the immediate peer is in `TRUSTED_PROXY_IPS`; the list is empty by default; the client IP is the right-most **untrusted** chain entry                                                     | The balancer's forwarded headers become usable exactly when it exists, and are ignored until then         |
| **Correlation IDs that survive instance hops**   | `x-correlation-id` is validated (UUID only), generated when absent or invalid, never echoed unvalidated, and carried into logs, audit, events, worker processing, and the response                                                                       | One request's trace is reconstructable across whichever instances touched it                              |
| **A distributed rate-limit store contract**      | `RateLimitStore` is a port; `DistributedRateLimitStore` is the shared-store contract; `assertStoreSuitableForMultiInstance()` throws when a process-local store is used across instances                                                                 | Rate limiting behind a balancer is either correct or loudly refused, never quietly per-instance           |
| **Graceful shutdown and readiness**              | Readiness goes false before the process stops accepting work; the worker stops claiming, drains within a bounded grace period, and leaves anything still in flight to lease recovery                                                                     | Instance rotation and rolling replacement do not drop or duplicate work                                   |
| **Independently startable roles**                | Web and worker are separate processes with separate DSNs, separate database archetypes, separate pools, and separate readiness reports                                                                                                                   | Each tier is placed, scaled, and drained on its own                                                       |
| **Documented health and readiness semantics**    | Liveness means "is the process alive"; readiness means "should it be sent work". `foundationReadiness()` and `workerReadiness()` produce the signals, with `ready` / `degraded` / `unavailable` states and no driver detail in the output                | The balancer has an unambiguous signal to poll, and a starting or draining instance is not restarted      |

### 2. Requirements on a future load balancer

Binding on the phase that introduces one.

| #   | Requirement                                                                                                                                                           | Reason                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | **Poll readiness, not liveness, for routing decisions.** An instance reporting not-ready must receive no new requests and must not be restarted for that reason alone | Restarting a starting or draining instance is how rolling deploys drop traffic                            |
| 2   | **Be added to `TRUSTED_PROXY_IPS` by exact remote address**, and terminate or normalise `X-Forwarded-For` itself                                                      | Forwarded headers are believable only for hops the application has been told to trust                     |
| 3   | **Append to the forwarded chain rather than replacing it**, and strip client-supplied `X-Forwarded-*` on ingress                                                      | The right-most-untrusted rule depends on the suffix of the chain being appended by trusted hops           |
| 4   | **Pass `x-correlation-id` and `x-causation-id` through unchanged** in both directions                                                                                 | The application validates them; a balancer that rewrote them would break the trace                        |
| 5   | **Never require sticky sessions.** If affinity is enabled for cache-locality reasons, correctness must not depend on it                                               | Affinity that becomes load-bearing reintroduces statefulness by the back door                             |
| 6   | **Drain before terminating:** stop new connections, allow in-flight requests to finish within a bounded window aligned with the application's shutdown grace          | Otherwise a deploy converts in-flight commands into client errors                                         |
| 7   | **Do not cache responses.** Authenticated responses are `Cache-Control: no-store, private`; a balancer must honour that and must not add its own caching layer        | Tenant, company, and branch scope are not in the URL; a URL-keyed shared cache can serve the wrong caller |
| 8   | **Enforce request and header size limits and connection timeouts at the edge**, aligned with the application's own bounds                                             | Edge limits are the first line; the application's bounded pools and timeouts are the second               |
| 9   | **Be introduced only together with a shared rate-limit store**, verified by calling `assertStoreSuitableForMultiInstance()` in deployment composition                 | Multi-instance with a process-local store does not rate limit; it limits per instance                     |
| 10  | **Route the web and worker roles separately**, or route only the web role — the worker takes no inbound traffic                                                       | The roles have unrelated scaling and draining shapes                                                      |
| 11  | **Terminate TLS at or before the balancer**, with the application never inferring scheme from an untrusted header                                                     | Scheme inference from a caller-controlled header is a redirect and cookie-scope hazard                    |
| 12  | **Be recorded in a superseding or accompanying ADR** naming the provider, the topology, and the health-check configuration actually used                              | ADR-012's controlled-promotion rule: a hosted component exists only when an owner decision records it     |

### 3. Explicitly not decided

Provider, algorithm, health-check interval and thresholds, TLS termination point, instance count,
autoscaling policy, and any capacity or availability target. All are **Open**. Nothing in this record
may be cited as approving any of them.

## Alternatives Considered

**Alternative 1 — Provision a load balancer now, in front of a single instance.**
Rejected. It requires choosing a hosting provider and a region, which are owner decisions that have
not been made (ADR-012), and it would create a real cost and a real data-residency position for a
product with no hosted deployment. In front of one instance it would also be untestable in the only
way that matters: distribution, draining, and affinity behaviour cannot be observed with a single
target, so the configuration would enter the repository as permanently unverified content.

**Alternative 2 — Write the full balancer configuration now and apply it later.**
Rejected for the same reason ADR-012 rejected a paper four-environment topology. Every substantive
field — provider, listener, health-check path, thresholds, TLS policy — would be invented, and
invented specifications are read later as decisions. The honest form is this record: application
properties that are true and verifiable today, plus requirements on a component that does not exist.

**Alternative 3 — Accept sticky sessions and keep session state in process memory.**
Rejected. It is the cheapest thing to build and the most expensive thing to remove. Sticky sessions
make instance loss a user-visible failure rather than a routing event, make rolling deploys
disruptive, and quietly make correctness depend on the balancer's affinity table — a component
outside the application's control and outside its tests. Server-resolved context from the database
costs one short read per request and keeps every instance interchangeable.

**Alternative 4 — Ignore `X-Forwarded-For` entirely until a balancer exists.**
Rejected. Ignoring it means every IP-keyed control sees the proxy's address on the day a balancer is
introduced, silently collapsing every caller into one bucket — a failure that looks like a working
rate limiter. The implemented approach costs nothing today (the allow-list is empty, so the peer
address is used) and is correct the moment the list is configured.

## Consequences

**Positive.**

- The application can be placed behind a balancer without a redesign: no session store to introduce,
  no locks to relocate, no affinity to configure.
- Multi-instance rate limiting cannot be claimed by accident — the code refuses.
- Instance rotation is already safe: readiness precedes liveness, the worker drains within a bounded
  window, and lease recovery covers whatever it could not finish.
- A request's trace survives instance hops, because the correlation ID is validated and propagated by
  the pipeline rather than by call-site discipline.
- No cost, no region commitment, and no unverifiable configuration enters the repository.

**Negative and trade-offs — accepted knowingly.**

- **Nothing here is verified against a real balancer.** These are properties of the code, demonstrated
  in the Local environment only. Header handling, draining behaviour, and health-check semantics will
  meet reality for the first time when a balancer is provisioned, and reality usually has an opinion.
- **A shared rate-limit store is required work that has not been done.** The gate makes the gap
  loud, but the day a second instance is wanted, an adapter must be written and operated first.
- **`TRUSTED_PROXY_IPS` is an exact-address allow-list**, which is safe and is also operational
  friction: a balancer whose address changes must be reconfigured, and forgetting to do so degrades
  IP-keyed limits to the peer address rather than failing loudly.
- **Single-instance behaviour is the only behaviour anyone has seen.** Latent assumptions that hold
  for one process may exist despite the rules above; the boundary checks and the shared-store gate
  reduce that risk without eliminating it.
- **This record will need superseding.** The moment a balancer is chosen, the provider, topology, and
  health-check configuration must be recorded in an ADR rather than added to this one.

## Security Impact

- **Trusted-proxy handling is a security control, not a convenience.** The allow-list is empty by
  default, so an un-configured deployment ignores forwarded headers entirely rather than accepting
  forged ones. Trusting `X-Forwarded-For` unconditionally is the single most common rate-limiting
  defect, and the default here makes it impossible to inherit by omission.
- **The right-most untrusted entry is the client IP.** Taking the left-most entry — the usual mistake
  — takes the first value the _client_ wrote, which is entirely attacker-controlled.
- **A balancer must not become a caching layer for authenticated responses.** Tenant, company, and
  branch scope are not in the URL, so URL-keyed shared caching is structurally capable of serving one
  tenant's data to another.
- **Correlation IDs remain validated at the application boundary** regardless of what any proxy does.
  A balancer that injected an unvalidated value would not weaken this: the application accepts only a
  syntactically valid UUID and never echoes anything else.
- **Multi-instance rate limiting is refused rather than approximated.** A per-instance limit
  presented as a global one is a false security control, and false controls are worse than absent
  ones because they stop the search for a real one.
- No penetration testing, edge-security assessment, or availability testing has been performed, and
  none is claimed. Verification is performed by the same engineer who implements; no independent QA
  ownership is assigned.

## Operational Impact

- **Nothing operational changes today.** There is no balancer to configure, monitor, or fail over.
- **Readiness signals exist but are not yet routed.** `foundationReadiness()` and `workerReadiness()`
  produce the reports; `/api/health` (Phase 1-1) remains the container probe, and the richer health
  endpoints are assigned to **Phase 1-15**. A balancer cannot poll what is not yet exposed, and this
  record does not describe those endpoints as available.
- **Deployment composition acquires two obligations** on the day a second instance runs: install a
  shared rate-limit store and call `assertStoreSuitableForMultiInstance()`, and populate
  `TRUSTED_PROXY_IPS` with the balancer's exact remote addresses.
- **Draining is bounded by `OUTBOX_SHUTDOWN_GRACE_MS`** (default 15 s, range 0–120 s) for the worker.
  A balancer's connection-drain window should be aligned with it; both values are **proposed
  validation baselines pending measurement**.
- Nothing reached protected develop outside the approved pull-request and hosted-CI flow. The work
  was reviewed under the Standing Technical Authorization and Solo Developer Review policies.

## Related Phase 1 Task and Requirement IDs

| ID                  | Relationship to this ADR                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------- |
| P1-13-BE-004        | Request context — server-resolved and per-request, the basis of statelessness                |
| P1-13-BE-008        | Correlation-ID lifecycle — traces that survive instance hops                                 |
| P1-13-BE-003        | Bounded pools and per-role connections                                                       |
| P1-13-BE-016        | Worker graceful shutdown and lease-based recovery                                            |
| P1-13-SEC-003       | Rate limiting and trusted-proxy client-IP resolution                                         |
| P1-13-DO-002        | Health and readiness signals for the web and worker roles                                    |
| P1-OD-027 (NFR-SCL) | **Unresolved.** Instance counts, drain windows, and limits are proposed validation baselines |
| ADR-001             | Modular monolith — one deployable unit, which is what a balancer would replicate             |
| ADR-012             | Local-first environment with controlled promotion — why no balancer is provisioned           |
| ADR-014             | Distributed consistency model — statelessness and fail-closed isolation across instances     |
| ADR-016             | CDN readiness — the adjacent edge decision, also not provisioned                             |
| ADR-017             | Read-replica readiness — the adjacent data-tier decision, also not provisioned               |
| OIR-01              | Open issue: hosting provider, production region, and deployment platform are not approved    |

Identifiers such as P1-OD-027 and OIR-01 are defined in the canonical documents recorded in
[canonical-documents.md](../governance/canonical-documents.md), which live outside this repository by
owner decision.

## Decision Owner

Eng. Ezzaldeen Al-Bitar (technical and IT owner; GitHub username `Ezzaldeen-Albitar`) — for the
application properties in §1 and the requirements in §2. Recorded under the
[Standing Technical Authorization Policy](../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../governance/solo-developer-review-policy.md) —
owner-authorized technical self-review, never an independent third-party audit.

Eng. Ezzaldeen Al-Bitar and Eng. Bilal Jradat (jointly) — for the selection and provisioning of any
load balancer, hosting provider, region, or deployment platform, which carry commercial and
data-residency commitments beyond the technical decision. None has been approved.

## Date

2026-07-21
