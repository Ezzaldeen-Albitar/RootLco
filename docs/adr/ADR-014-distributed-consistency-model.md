# ADR-014: Distributed Consistency Model

## Status

Accepted by owner instruction — for the per-subsystem consistency positions recorded below, which
are binding on every backend phase from Phase 1-13 onward.

The record decides **how each subsystem behaves under failure**, not the topology it runs on. Hosting
provider, production region, and deployment platform remain **Open** (ADR-001, ADR-005, ADR-007,
ADR-012). No environment beyond Local exists, so nothing here is a claim about observed availability,
partition behaviour, failover, or capacity in any hosted system.

The **consistent-hashing** position in the Decision below is **Open — deliberately deferred**. No
utility exists and none is approved.

## Context

Phase 1-13 delivers the backend foundation: the request pipeline, the scoped transaction wrapper,
authorization and entitlement middleware, an in-process cache, the transactional outbox and its
worker, and a configurable-but-inert replica setting. Later phases will add business modules on top
of exactly these primitives. The consistency question therefore has to be answered now, once, rather
than per module.

The tempting answer is a single label: "the platform is CP" or "the platform is AP". That answer is
wrong here, and stating why is the point of this record.

1. **The subsystems have different correctness requirements.** A tenant-isolation decision and a
   cached currency list do not deserve the same treatment. Forcing one label onto both either makes
   the cache needlessly strict or makes isolation negotiable — and only one of those failures is
   recoverable.
2. **The platform is a modular monolith on one PostgreSQL database** (ADR-001, ADR-003). Within a
   single transaction there is no distributed-consensus problem at all; the interesting questions are
   at the edges — the cache, the outbox consumer side, a future replica, a future CDN.
3. **CAP describes behaviour during a network partition**, which is a narrow and specific condition.
   Applied as a platform-wide slogan it obscures the decision it is supposed to inform, because most
   real degradations are not partitions.
4. **Several of the components a CAP label would cover do not exist.** No replica, no CDN, no
   distributed cache, no broker, and no load balancer is provisioned. A record that assigned them
   consistency properties today would be describing an imagined system.

The honest form is a per-subsystem table with a stated failure behaviour for each, plus an explicit
statement of what is deferred.

## Decision

**Consistency is decided per subsystem. There is no single CAP label for the platform.**

| Subsystem                          | Consistency                              | Behaviour when it cannot be satisfied                         |
| ---------------------------------- | ---------------------------------------- | ------------------------------------------------------------- |
| Core PostgreSQL transactions       | **Strong**                               | Reject the operation. Never partial, never optimistic         |
| Tenant isolation and authorization | **Strong, fail closed**                  | Deny. Availability never overrides isolation                  |
| Cache                              | **Disposable, non-authoritative**        | Bypass to the database. Correctness stays available           |
| CDN (not provisioned)              | **Eventual, stale-tolerant assets only** | Authenticated business data is never served from it           |
| Outbox — producer side             | **Strong** (same transaction)            | Roll back the business change with it                         |
| Outbox — consumer side             | **Eventual, at-least-once**              | Retry with backoff, then dead-letter. Effects stay idempotent |
| Read replicas (not provisioned)    | **Eventual, stale-tolerant reads only**  | Not activated; `poolFor('replica')` returns the primary       |
| Consistent hashing                 | **Deferred** — no utility exists         | n/a                                                           |

### 1. Core PostgreSQL transactions — strong consistency, partition-safe rejection

Every business operation runs inside one transaction opened by `withTransaction()`. Business state,
status history, the audit record, and the outbox row **commit atomically or not at all**. An
injected failure after the outbox write rolls back all four.

This is the property BR-INT-001 depends on: an event exists **if and only if** its source transaction
committed. There is no dual write, no "publish then persist", and no compensating-transaction
workflow, because none is needed inside one database.

Under a partition or an unreachable database the operation is **rejected**. The pipeline returns a
cataloged failure and leaves no side effect. It never writes half a change, never queues a change for
later application, and never accepts a command it cannot durably record. "Partition-safe rejection"
is the whole position: when the platform cannot be sure, it declines.

Nesting uses `SAVEPOINT`s, so an inner failure rolls back to its savepoint and rethrows rather than
silently committing an outer partial state.

### 2. Tenant isolation and authorization — fail closed, always

Authorization is evaluated **in the database**, inside the request transaction, under the same
session context the handler will use (`iam.has_permission`, `iam.has_permission_in_scope`). Deny
precedence is a property of those functions and this layer does not soften it.

The binding rule: **availability never overrides isolation.** Specifically —

- An unresolvable request context is `ERR-CTX-001` and the statement never reaches the database.
- An unauthenticated or unresolvable principal is `ERR-IAM-002`; the default authenticator returns
  `null`, so every authenticated operation is refused until Phase 1-14 installs a real one.
- A requested scope the caller does not hold is **rejected**, never silently narrowed or widened.
- An authorization decision is **never cached** (`authorization` and `entitlement` are permanently
  prohibited cache categories). A cached allow outlives a revoked grant; a cached entitlement
  outlives a downgraded subscription.
- When a foundation write capability is missing, the operation is **refused** rather than executed
  without its audit record or its event
  ([DBCR-P1-13-001](../database/change-requests/DBCR-P1-13-001-backend-runtime-write-grants.md)).

There is deliberately no degraded mode in which isolation is relaxed to keep serving. A platform that
serves the wrong tenant's data has not degraded; it has failed.

### 3. Cache — disposable and non-authoritative

The cache is an optimisation whose absence changes latency, never answers.

- **Never the source of truth.** No write-through, no write-behind. A mutation writes the database
  and then invalidates.
- **A miss runs the same authorized repository path** as a normal read; the loader executes in the
  caller's context, so the cache cannot bypass RLS.
- **Errors are never cached**, so a transient outage cannot be pinned in for a TTL.
- **Every TTL is finite and bounded by category**, and four categories — authorization, entitlement,
  financial commands, restricted data — are permanently prohibited.

Therefore **correctness remains available through the database path** when the cache is empty, stale,
evicted, or entirely absent. Losing the cache is a performance event, not a correctness event, and
the system is allowed to treat it as one.

### 4. CDN — only explicitly cacheable, stale-tolerant assets

No CDN is provisioned ([ADR-016](./ADR-016-cdn-readiness.md)). The consistency position, binding if
one is ever introduced:

- Only assets **explicitly classified public and stale-tolerant** may be served from an edge cache.
- **Authenticated business data must never gain availability by serving stale or
  incorrectly-scoped content.** Authenticated responses are scoped to a tenant, a user, and a set of
  companies and branches, none of which appear in the URL — so a shared cache keyed on URL alone is
  structurally capable of serving one caller's data to another. The API pipeline therefore sends
  `Cache-Control: no-store, private` on every authenticated success response, and `no-store` on every
  failure.
- "Serve stale on error" is acceptable for a versioned static asset. It is **never** acceptable for a
  business representation.

### 5. Transactional outbox — strong on the producer side, eventual on the consumer side

**Producer side is strongly consistent.** `publishEvent()` writes the row using the caller's
transaction handle, so the event and the state change share a commit. `event_key` is unique per
tenant, so a retried command cannot emit the same event twice.

**Consumer side is eventually consistent and at-least-once**, and that is the only honest guarantee a
durable queue can give across a crash:

- `shared.claim_outbox_events` uses `FOR UPDATE SKIP LOCKED` plus a lease, so no two workers own a row
  and a dead worker's claim returns to the queue rather than being stranded.
- Every consumer must be idempotent, and this is structural rather than aspirational:
  `shared.processed_events` has `PRIMARY KEY (consumer_code, event_id)`, and the marker is inserted
  **in the same transaction** as the consumer's side effects. A redelivery aborts on the primary key
  and discards the whole attempt. **Exactly-once effect, at-least-once delivery.**
- Failures retry with bounded exponential backoff and full jitter; the attempt ceiling moves the
  event to `dead_letter` with an `shared.error_records` row and an error-level log record.

Consumers therefore observe a delay between a committed change and its downstream effect. Any
workflow built on events must tolerate that delay; a workflow that cannot must be inside the
producer's transaction instead.

### 6. Read replicas — eventual, stale-tolerant reads only, and not activated

No replica is provisioned ([ADR-017](./ADR-017-read-replica-readiness.md)).
`DATABASE_REPLICA_URL` is accepted so deployment topology is expressible, and `poolFor('replica')`
**returns the primary** and logs that it did. Activating replica routing requires a provisioned
replica, observable replication lag, and an approved list of stale-tolerant operations. Until all
three exist, routing would be a correctness claim with no evidence behind it.

When activated, a replica may serve **only** reads explicitly classified stale-tolerant. Writes,
authorization, entitlement, command validation, idempotency lookups, transactional reads, and
read-after-write always go to the primary.

### 7. Consistent hashing — deferred

**No consistent-hashing utility exists in this repository, and none is approved.**

Possible future uses, recorded so the deferral is a decision rather than an omission:

| Possible future use              | What it would distribute                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| Distributed cache node selection | Cache keys across nodes of a multi-node cache ring, minimising remapping on node change |
| Worker partition ownership       | Ownership of queue partitions or tenant shards across worker instances                  |
| Queue partition routing          | Events to partitions such that per-aggregate ordering is preserved                      |
| Tenant-affinity routing          | Tenants to instances, to improve cache locality                                         |

Reasons it is deferred:

1. **The platform is a modular monolith with one database and one process role per function.** There
   is no ring to hash onto.
2. **No multi-node cache is approved.** The cache is in-process and bounded; `DistributedCache` is a
   marker interface nothing implements.
3. **No broker partition topology is approved.** The outbox is the queue, and its work distribution is
   `FOR UPDATE SKIP LOCKED` — which needs no hashing, no ownership map, and no rebalancing.
4. **It would add failure modes without solving a current problem**: a ring configuration to keep
   consistent across instances, rebalancing behaviour during membership change, and a class of bugs
   in which two instances disagree about who owns a key. None of that is worth taking on for a
   problem the platform does not have.

**Rules any future consistent-hashing utility must satisfy** — binding on the phase that introduces
one:

- **Virtual nodes.** Each physical node is represented by many points on the ring, so distribution is
  even and a single node's departure does not dump its whole share on one neighbour.
- **Deterministic.** The same key and the same ring membership always produce the same node, in every
  process and every language binding. No process-local seed, no iteration-order dependency.
- **Minimal key movement.** Adding or removing one node must move approximately `1/N` of keys, not
  rehash the space. That is the only reason to choose consistent hashing over modulo hashing.
- **Never an authorization or tenant-isolation control.** Placement is a performance concern. Which
  node serves a key must never be part of deciding _whether_ a caller may read it — RLS and
  server-side authorization remain the only isolation controls, and a node that receives a request
  for a tenant it does not "own" must still be unable to serve unauthorized data.
- **Tested for distribution and remapping.** Distribution across nodes within a stated tolerance, and
  measured key movement on node addition and removal, with the test failing if movement exceeds the
  expected bound.

## Alternatives Considered

**Alternative 1 — Declare the platform "CP" and be done.**
Rejected. It is superficially true of the database and false of everything else. Applied literally it
would forbid the cache (which is deliberately allowed to be stale) and forbid at-least-once event
delivery (which is deliberately eventual), and it would say nothing useful about the actual decisions
a developer faces: may this be cached, may this be replayed, may this be served from a replica. A
label that must be qualified in every application is not a decision; it is a slogan.

**Alternative 2 — Declare the platform "AP" with eventual consistency everywhere.**
Rejected, and decisively. Eventual consistency applied to authorization means a revoked grant keeps
working for a while, and applied to tenant isolation it means cross-tenant exposure is a matter of
timing. For a commercial multi-tenant platform whose primary isolation control is Row-Level Security
(ADR-004), that is not a trade-off — it is the failure the architecture exists to prevent. Eventual
consistency is also unnecessary for the properties it would buy: there is no measured availability
requirement that a single-database modular monolith fails to meet, because there is no hosted
deployment at all.

**Alternative 3 — Introduce sagas and compensating transactions now, in anticipation of later service
extraction.**
Rejected. Sagas exist to coordinate state across boundaries that cannot share a transaction. No such
boundary exists: ADR-001 fixes a single-process, single-database modular monolith and explicitly
rejects service extraction for Phase 1. Building compensation machinery now would add a large amount
of code whose correctness cannot be exercised, and would replace an atomic commit — which is simple
and provable — with a distributed protocol that is neither. If a module is ever extracted, ADR-001
already requires a superseding ADR, and this record would be revisited then.

**Alternative 4 — Introduce a message broker and treat the event stream as the integration backbone
now.**
Rejected. A broker cannot participate in the producer's transaction, so it needs an outbox anyway;
adding it now means operating a second delivery path with no measured driver, in a project where only
the Local environment exists. The outbox pattern is retained as the pattern; the transport is a later,
evidence-driven decision.

## Consequences

**Positive.**

- Each subsystem's failure behaviour is written down and matches what the code does, so "what happens
  when X is down" has an answer that is checkable rather than argued.
- Isolation and authorization have no degraded mode, which removes an entire class of incident in
  which a system stays up by being wrong.
- The cache can be added, removed, cleared, or replaced without a correctness review, because it is
  authoritative for nothing.
- At-least-once delivery with database-enforced consumer idempotency means a redelivery is a
  non-event, not an incident.
- The deferred items — replicas, CDN, consistent hashing — are recorded with the conditions under
  which they would be reconsidered, so a later phase inherits a decision rather than a silence.

**Negative and trade-offs — accepted knowingly.**

- **Rejection under failure is visible to users.** Partition-safe rejection means an unreachable
  database is an outage for writes, not a queued write. That is the correct behaviour and it is still
  an outage.
- **Consumers observe stale state.** Any workflow built on events must tolerate the delay between
  commit and downstream effect, and workflows that cannot must be pulled into the producer's
  transaction — which enlarges that transaction.
- **At-least-once shifts work onto every consumer author.** The marker table makes duplicate delivery
  safe, but a consumer whose side effects reach outside the database (a future notification send) must
  still be designed for it.
- **A single database is a single failure domain and a shared performance domain**, as ADR-001
  already records. This record does not mitigate that; it decides how the system behaves when the
  domain is unavailable.
- **The eventual-consistency positions for CDN and replicas are untested**, because neither exists.
  They are commitments about future behaviour, and a later phase must verify rather than inherit them.
- **Consistent-hashing deferral will eventually be wrong** if a multi-node cache or a partitioned
  queue is ever approved. The rules in §7 are written so that the later work starts from constraints
  rather than from scratch.

## Security Impact

The security-relevant content of this record is the second position: **availability never overrides
isolation.**

- Authorization and entitlement are evaluated in the database, inside the request transaction, and
  are permanently non-cacheable. There is no code path in which a stale decision is served to keep a
  request alive.
- A missing request context fails closed with `ERR-CTX-001` before any statement runs. Relying on
  RLS default-deny alone would also be safe but would be silent — an empty result looks like "no
  data" rather than "the application forgot who was asking".
- A missing database write capability causes refusal, not a silent skip. A state change without its
  audit record is a silent integrity hole; a refused command is a visible one.
- Denials are uniform: `ERR-IAM-001` never reveals whether the target exists, `ERR-RES-001` is
  indistinguishable from "exists but out of scope", and `ERR-CON-001` covers both a stale version and
  an out-of-scope row.
- The prohibition on serving authenticated business data from a shared or edge cache is a tenant-isolation
  control, not a performance preference: tenant, company, and branch scope are not in the URL, so a
  URL-keyed shared cache cannot be relied on to keep them apart.
- The consistent-hashing rule that placement must **never** be an authorization or isolation control
  is recorded now, before any implementation exists, because "the request routed to the owning node"
  is a tempting and completely invalid substitute for an authorization check.

No security testing of hosted behaviour is claimed. No compliance position is asserted. Verification
of these properties is currently performed by the same engineer who implements them; no independent
QA ownership is assigned.

## Operational Impact

- **Only the Local environment exists** (ADR-012). Every statement above about partitions, staleness,
  and failover describes intended behaviour of the code, not observed behaviour of a hosted system.
- **Operational signals that exist today:** structured JSON logs on stdout with a correlation ID
  spanning web, worker, audit, and events; in-memory metrics behind a port, including
  `outbox.queue.depth` and `outbox.queue.oldest_age_seconds`; and readiness functions for the web and
  worker roles. There is no log shipper, no metrics backend, no tracing collector, and no
  error-monitoring project.
- **Dead-letter alerting is an error-level log record with the stable code `outbox.dead_letter`.** No
  pager integration is provisioned or claimed.
- **Replica lag is not observable**, which is one of the three preconditions for activating replica
  routing. Until it is, `poolFor('replica')` returning the primary is the only defensible behaviour.
- **Replay procedures** for dead-lettered events are documented in the
  [Queue Processing and Replay Standard](../standards/queue-processing-and-replay-standard.md),
  including the rule that `shared.processed_events` markers are never deleted during a replay.
- Nothing reached protected develop outside the approved pull-request and hosted-CI flow. The work
  was reviewed under the Standing Technical Authorization and Solo Developer Review policies.

## Related Phase 1 Task and Requirement IDs

| ID                          | Relationship to this ADR                                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| P1-13-BE-003 / P1-13-BE-011 | Controlled data access and the scoped transaction wrapper — the strong-consistency core             |
| P1-13-BE-005                | Authorization middleware — the fail-closed position                                                 |
| P1-13-BE-012                | Idempotency — replay without duplicate effect on the request path                                   |
| P1-13-BE-013                | Optimistic concurrency — conflict rejection rather than last-write-wins                             |
| P1-13-BE-015                | Event envelope and transactional outbox — producer-side atomicity                                   |
| P1-13-BE-016 / P1-13-BE-017 | Outbox worker and consumer idempotency — consumer-side eventual consistency                         |
| P1-13-SEC-002               | Server-resolved scope and the no-`BYPASSRLS` requirement                                            |
| P1-OD-027 (NFR-SCL)         | **Unresolved.** Every numeric limit in the related standards is a proposed validation baseline      |
| BR-INT-001                  | An event exists if and only if its source transaction committed                                     |
| BR-INT-002                  | Consumer idempotency                                                                                |
| BR-IAM-001                  | Deny precedence in permission evaluation                                                            |
| BR-TEN-001                  | Entitlement evaluated at command time                                                               |
| DBCR-P1-13-001              | Open change request; the reason audit, outbox, and idempotency writes currently fail closed         |
| ADR-001                     | Modular monolith — the single-process, single-database premise this record rests on                 |
| ADR-004                     | Mandatory Row-Level Security direction — the isolation control that must never be traded for uptime |
| ADR-012                     | Local-first environment — why no hosted behaviour is claimed                                        |

Identifiers such as P1-OD-027, BR-INT-001, BR-IAM-001, and BR-TEN-001 are defined in the canonical
documents recorded in [canonical-documents.md](../governance/canonical-documents.md), which live
outside this repository by owner decision.

## Decision Owner

Eng. Ezzaldeen Al-Bitar (technical and IT owner; GitHub username `Ezzaldeen-Albitar`) — for the
per-subsystem consistency positions, the fail-closed isolation rule, the outbox delivery semantics,
and the consistent-hashing deferral and its future rules. Recorded under the
[Standing Technical Authorization Policy](../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../governance/solo-developer-review-policy.md) —
owner-authorized technical self-review, never an independent third-party audit.

Eng. Ezzaldeen Al-Bitar and Eng. Bilal Jradat (jointly) — for any business or commercial decision
that would change these positions, including provisioning a replica, a CDN, a distributed cache, or a
message broker, each of which carries cost and data-residency consequences beyond the technical
decision.

## Date

2026-07-21
