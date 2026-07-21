# ADR-018: Database Sharding Deferral

## Status

Accepted by owner instruction — for the deferral and for the sharding-ready properties recorded
below, which are binding on every phase that adds tables, queries, or application workflows.

**The current PostgreSQL database is NOT sharded.** It is a single logical database with a single
primary, as decided in ADR-001 and ADR-003. No shard key is configured, no routing layer exists, and
no partitioning of tenant data across databases has been implemented, designed, or approved.

Sharding itself is **Open — deliberately deferred**. Reconsideration requires **measured evidence**,
not estimated fear; the conditions are in §3.

## Context

Sharding a multi-tenant database is the most expensive reversible decision in a platform's life, and
the most expensive irreversible one if it is taken badly. It is also the decision most often taken
early, on the strength of an imagined growth curve rather than a measured constraint.

The facts here are unambiguous:

1. **There is no measured constraint.** No hosted deployment exists (ADR-012), there are no
   production tenants, and no workload has been measured. There is therefore no size, throughput, or
   contention figure that sharding would relieve.
2. **PostgreSQL has a great deal of headroom before sharding is the right answer.** Indexing,
   partitioning within one database, connection pooling, read replicas, and query correction are all
   cheaper, reversible, and available first.
3. **The schema is already tenant-keyed.** Eleven database phases have produced a schema in which
   tenant-owned tables carry `tenant_id` and are governed by Row-Level Security (ADR-004). The
   natural distribution key already exists.
4. **The expensive part of sharding is not the routing.** It is cross-shard queries, cross-shard
   transactions, global uniqueness, and re-sharding. Those costs are determined by how the
   application is written, not by when the routing layer is added — which is why the properties in
   §2 matter now and the routing layer does not.

The purpose of this record is therefore to defer sharding while making the deferral cheap to reverse:
keep the properties that make sharding possible, and write down what evidence would justify it.

## Decision

**Sharding is deferred.** The database remains a single logical PostgreSQL database. The following
properties are maintained so that the decision stays cheap to revisit.

### 1. `tenant_id` is the distribution candidate

Every tenant-owned table carries `tenant_id`, and RLS policies are written against it
(`tenant_id = iam.current_tenant_id()`). The application never queries a tenant-owned table without a
resolved tenant in the session context, and repositories carry an explicit tenant predicate in
addition to RLS — defence in depth, where RLS is the guarantee and the predicate is the declared
intent.

That combination means the distribution key is present in the schema, in the session, and in the
query text. No column would need to be added to shard by tenant.

### 2. Sharding-ready properties maintained

| Property                                                         | How it holds today                                                                                                                                                        | Why sharding needs it                                                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **No global mutable state requiring a cross-tenant transaction** | Every write path is scoped to one tenant's context. Idempotency keys, audit records, outbox rows, and processed-event markers are all tenant-stamped                      | A cross-tenant transaction cannot be made atomic across shards without a distributed protocol |
| **No cross-tenant joins in application workflows**               | Application queries run under a session whose `app.tenant_id` is set and under RLS that filters to it; a cross-tenant join returns nothing useful even if written         | A cross-shard join is the query class that makes sharding expensive                           |
| **Explicit tenant ownership in cache keys**                      | `tenantKey()` requires the tenant; `platformKey()` is a separately named call for tenant-neutral data. Segments are length-prefixed so keys cannot collide across tenants | A shard-aware cache must be able to derive the shard from the key                             |
| **Explicit tenant ownership in events**                          | `event_outbox.tenant_id` is written from the request context, and `event_key` uniqueness is per tenant                                                                    | Queue partitioning by tenant requires the tenant on the row                                   |
| **Explicit tenant ownership in logs**                            | `tenantRef` is a standard log field, carried as an opaque UUID                                                                                                            | Per-shard operational triage requires attributing a record to a tenant                        |
| **Explicit tenant ownership in repository contracts**            | A `DbHandle` cannot exist without a `RequestContext`, and `Repository.assertContext()` refuses a context with an empty tenant before the statement runs                   | A routing layer needs the tenant at the call site, not inferred from SQL                      |
| **Identifiers not dependent on a process-local sequence**        | See §4                                                                                                                                                                    | Application-generated sequential ids collide across shards                                    |
| **Documented global control-plane data**                         | See §5                                                                                                                                                                    | Global data must be identified before it can be replicated or centralised                     |

### 3. Sharding requires measured evidence, not estimated fear

Reconsideration requires **all** of the following, in this order:

1. **A hosted deployment with real tenants and a measured workload.** Nothing measured on a developer
   machine is evidence about a hosted system.
2. **A specific, identified constraint** — dataset size, write throughput, connection saturation,
   lock contention, vacuum or bloat behaviour, or backup and restore duration — with figures.
3. **Evidence that cheaper measures have been applied and are insufficient**: index correction, query
   correction, declarative partitioning within one database, connection pooling, and read replicas
   ([ADR-017](./ADR-017-read-replica-readiness.md)). Sharding is the last of these, not the first.
4. **A stated shard key and a re-sharding plan**, including how a tenant is moved between shards and
   what happens to in-flight work during the move.
5. **A superseding ADR** recording the topology, the routing mechanism, the global-data strategy, and
   the operational obligations accepted.

"Tenants might grow" is not evidence. "The largest tenant's table is N rows and the P99 for query X
is Y at Z concurrent connections, after indexing and partitioning" is.

### 4. Identifiers do not depend on a process-local sequence

- **Primary keys are database-generated UUIDs.** They are globally unique without coordination, so
  two shards cannot mint the same key.
- **Human-facing display numbers are allocated database-side and per scope.**
  `shared.next_display_number()` over `shared.number_sequences` allocates under a row lock within the
  caller's transaction — per tenant and per scope, not per process. The application never generates a
  sequential identifier itself, and there is no in-process counter to become a collision source.
- **Idempotency keys are client-supplied and scoped** to `(tenant_id, operation, idempotency_key)`.
- **Event keys are unique per tenant**, not globally.

The consequence: **every uniqueness constraint the application relies on is already either globally
unique or tenant-scoped.** None of them would need to be redesigned to shard by tenant, which is
usually the largest hidden cost.

### 5. Global control-plane data is documented, not accidental

Some data is genuinely not tenant-owned and would have to be replicated to every shard or held in a
central control-plane database:

| Data                                                                | Nature                                                              | Sharding treatment                                        |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------- |
| Tenant registry (`org` tenant records) and tenant-to-shard mapping  | The routing table itself                                            | Central control plane; never sharded                      |
| Platform reference data (currencies, languages, locales, timezones) | Tenant-neutral, changes only by migration or approved configuration | Replicated to every shard, or read from the control plane |
| Plan, feature-flag, and entitlement definitions                     | Platform-level product shape                                        | Central, with per-tenant overrides living with the tenant |
| Permission catalogue and role definitions                           | Platform-level authorization vocabulary                             | Replicated; grants themselves are tenant-owned            |
| Migration history and schema version                                | Per database                                                        | Every shard must be at the same schema version            |

These are named here so a future sharding effort begins with a list rather than a discovery process.

### 6. Tables and operations that would be hard to shard

Recorded honestly, because a deferral that hides its own difficulties is not useful:

| Surface                                                | Difficulty                                                                                                                                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared.event_outbox` and the worker's claim protocol  | The worker drains **all** tenants with `FOR UPDATE SKIP LOCKED` under an all-tenant role. Per-shard queues would mean per-shard workers, an ownership map, and a rebalancing story |
| `shared.processed_events`                              | Consumer idempotency is keyed `(consumer_code, event_id)`. Event ids stay unique, but the marker must live wherever the consumer runs                                              |
| `iam.audit_records` and its per-tenant hash chain      | The chain is per tenant, which shards cleanly — but cross-tenant audit _reporting_ becomes a scatter-gather                                                                        |
| Platform-wide reporting and any cross-tenant analytics | Becomes a fan-out plus merge, or requires a separate analytical store                                                                                                              |
| `shared.number_sequences`                              | Shards cleanly by tenant, but a sequence scoped above the tenant would not                                                                                                         |
| Migration application across shards                    | Every shard must be migrated consistently; a partially migrated fleet is a new failure mode                                                                                        |
| Backup, restore, and point-in-time recovery            | Per-shard, with a consistency question across shards that does not exist today                                                                                                     |
| Moving a tenant between shards                         | The hardest operation: a live data move with in-flight requests, queued events, and leases                                                                                         |

None of these is a reason to shard early. Several are reasons to be certain before sharding at all.

## Alternatives Considered

**Alternative 1 — Shard now, by tenant, before there is data to move.**
Rejected. It is superficially attractive — sharding an empty database is free — and it is a
false economy. Every subsequent phase would pay the cost: cross-shard reporting, per-shard migration
application, a routing layer to keep correct, a rebalancing story, and a distributed transaction
question for anything that touches control-plane data. That cost would be paid continuously, from
Phase 1-14 onward, to relieve a constraint that has never been measured and may never appear. ADR-001
rejected premature microservices on exactly this reasoning: a wrong boundary chosen at the point of
least information is the most expensive kind.

**Alternative 2 — Design the full sharding topology on paper now and implement later.**
Rejected, for the reason ADR-012 gives about paper environments. Shard count, shard key granularity,
routing mechanism, and rebalancing strategy all depend on measured tenant-size distribution and
workload shape. With none measured, every field would be invented, and invented specifications are
read later as decisions. The durable content — the sharding-ready properties and the evidence
threshold — is what this record captures instead.

**Alternative 3 — Adopt a distributed SQL engine now to make sharding a configuration concern.**
Rejected. It would replace the approved data platform (ADR-003: PostgreSQL on Supabase with
Row-Level Security) with a different one, changing the RLS enforcement model that is the platform's
primary tenant-isolation control, the extension surface, the operational model, and the commercial
position — to solve a problem nobody has measured. Any such change is a superseding ADR with an owner
decision behind it, not a Phase 1-13 technical convenience.

**Alternative 4 — Partition tables within one database now, as a stepping stone.**
Rejected **for now**, and this is a deferral rather than a rejection on principle. Declarative
partitioning is materially cheaper than sharding, keeps one database and one transaction domain, and
is explicitly listed in §3 as a measure that must be tried before sharding. It is not done now
because partitioning without a measured access pattern usually picks the wrong partition key, and a
wrong partition key is expensive to change. It becomes the first candidate the moment a real
constraint is measured.

## Consequences

**Positive.**

- One database, one transaction domain, one migration target, one backup surface. Every guarantee in
  [ADR-014](./ADR-014-distributed-consistency-model.md) — atomic commit of business state, status
  history, audit, and outbox — holds without any distributed protocol.
- The properties that make sharding possible are maintained continuously and checked by existing
  gates, so the deferral does not accumulate debt.
- No uniqueness constraint would have to be redesigned to shard by tenant, because none depends on a
  process-local sequence.
- The hard surfaces are already identified, so a future evaluation starts from a list rather than a
  survey.
- No cost, no additional platform, and no unverifiable capacity claim enters the repository.

**Negative and trade-offs — accepted knowingly.**

- **One database is one failure domain and one shared performance domain.** ADR-001 already records
  this; a single very large tenant can degrade every other tenant, and this record does not mitigate
  that.
- **Vertical scaling has a ceiling**, and reaching it is the scenario in which this record must be
  revisited under pressure — the worst time to design a shard key.
- **Maintaining sharding-ready properties has an ongoing cost**: no cross-tenant joins in application
  workflows, tenant in every cache key, tenant on every event and log record. That discipline is
  enforced by tooling and review, and it is real friction for work that would otherwise be a quick
  cross-tenant query.
- **Some of the properties are enforced by convention rather than by mechanism.** "No cross-tenant
  joins in application workflows" is currently guaranteed in practice by RLS returning nothing useful
  and by the repository's tenant predicate, not by a checker that rejects such a query outright.
- **Backup, restore, and recovery are undescribed** because no hosted database exists. That gap is
  independent of sharding and is not closed here.
- **This record will need superseding** if sharding is ever adopted, to record the shard key,
  topology, routing mechanism, and global-data strategy actually chosen.

## Security Impact

- **Tenant isolation does not depend on sharding, and must never appear to.** Row-Level Security is
  the isolation control (ADR-004). Physical separation of tenant data across databases is not an
  isolation mechanism in this design, and no document may present sharding as a security improvement:
  a shard that received a request for a tenant it does not hold must still be unable to serve
  unauthorized data, because the control is RLS plus server-side authorization, not placement.
- **This mirrors the consistent-hashing rule in [ADR-014](./ADR-014-distributed-consistency-model.md)**
  — placement is never an authorization control. The same reasoning applies to shard routing.
- **A sharded fleet multiplies the RLS surface.** Every shard would need identical policies, identical
  role archetypes with no `BYPASSRLS`, and identical grant discipline. A single misconfigured shard
  would be a tenant-isolation failure that the other shards' correctness would hide.
- **Explicit tenant ownership in cache keys, events, and logs is a security property as much as a
  sharding one.** A cache key without a tenant is a cross-tenant disclosure; an event without a
  tenant cannot be routed or audited; a log record without a tenant reference cannot be attributed
  during an investigation.
- **Cross-tenant queries remain prohibited** regardless of physical layout, in application workflows.
  Platform-level administrative reads are a separate, control-plane concern with their own
  authorization requirements, and none is delivered in Phase 1-13.
- No security assessment of a sharded topology has been performed, and none is claimed. Verification
  is performed by the same engineer who implements; no independent QA ownership is assigned.

## Operational Impact

- **Nothing operational changes today.** One database, one migration target, one schema version.
- **The Release 2 database baseline is frozen** and applied migrations are immutable, enforced in CI.
  Phase 1-13 adds and modifies no migration.
- **`shared.next_display_number()` is the reference implementation** of transactional, per-scope
  allocation and remains database-side, per the
  [Number Sequence Standard](../database/number-sequence-standard.md).
- **The outbox worker currently drains every tenant** from one queue using an all-tenant role. Any
  future sharding must decide whether the queue shards with the data or stays central, and that
  decision changes the worker's ownership model — it is named in §6 so it is not discovered late.
- **Backup, restore, point-in-time recovery, and cross-shard consistency are undescribed**, because
  no hosted database exists (ADR-012). Sharding would make each of them harder; that is a cost to
  weigh at decision time, not a reason to pre-solve now.
- **No capacity, dataset-size, tenant-count, or growth figure is claimed anywhere in this record.**
  Open decision **P1-OD-027 (NFR-SCL)** is unresolved.
- Nothing reached protected develop outside the approved pull-request and hosted-CI flow. The work
  was reviewed under the Standing Technical Authorization and Solo Developer Review policies.

## Related Phase 1 Task and Requirement IDs

| ID                          | Relationship to this ADR                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------- |
| P1-13-BE-003                | Controlled data access — the tenant predicate alongside RLS in every tenant-owned query                 |
| P1-13-BE-004                | Request context — one tenant per request, always, resolved server-side                                  |
| P1-13-BE-011                | Scoped transaction wrapper — the session context a routing layer would consume                          |
| P1-13-BE-015                | Event envelope — explicit tenant ownership on every outbox row                                          |
| P1-13-BE-009                | Structured logging — `tenantRef` as a standard field                                                    |
| P1-02-DB-012 / P1-02-DB-013 | Transaction, concurrency, and idempotency patterns established database-first                           |
| P1-OD-027 (NFR-SCL)         | **Unresolved.** No dataset-size, throughput, or growth figure is claimed                                |
| ADR-001                     | Modular monolith — single application process, single PostgreSQL database                               |
| ADR-003                     | Supabase and PostgreSQL — the approved data platform; hosted project and region remain Open             |
| ADR-004                     | Mandatory Row-Level Security — the isolation control that sharding must never be presented as replacing |
| ADR-012                     | Local-first environment — why no measured workload exists                                               |
| ADR-014                     | Distributed consistency model — including the consistent-hashing deferral and its placement rule        |
| ADR-017                     | Read-replica readiness — a cheaper measure that must be exhausted before sharding                       |
| ASM-01                      | Assumption: domain boundaries remain subject to validation against the canonical documentation          |

Identifiers such as P1-OD-027 and ASM-01 are defined in the canonical documents recorded in
[canonical-documents.md](../governance/canonical-documents.md), which live outside this repository by
owner decision.

## Decision Owner

Eng. Ezzaldeen Al-Bitar (technical and IT owner; GitHub username `Ezzaldeen-Albitar`) — for the
deferral, the sharding-ready properties, the identifier strategy, the documented global control-plane
data, and the evidence threshold for reconsideration. Recorded under the
[Standing Technical Authorization Policy](../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../governance/solo-developer-review-policy.md) —
owner-authorized technical self-review, never an independent third-party audit.

Eng. Ezzaldeen Al-Bitar and Eng. Bilal Jradat (jointly) — for any future decision to shard, which
carries platform, cost, operational, and data-residency commitments beyond the technical decision.
None has been approved.

## Date

2026-07-21
