# ADR-017: Read-Replica Readiness

## Status

Accepted by owner instruction — for the routing rules recorded below, which are binding on every
backend phase from Phase 1-13 onward.

**No read replica is provisioned, and none is approved.** The hosted Supabase project, its cloud
region, and its commercial plan are **Open** (ADR-003), as are the hosting provider, production
region, and deployment platform (ADR-012). Replica provisioning is a property of a platform none of
which has been chosen.

`DATABASE_REPLICA_URL` is accepted as configuration so deployment topology is expressible, and it is
**deliberately inert**: `poolFor('replica')` returns the primary pool and records that it did. The
candidate stale-tolerant read classes in §4 are listed as candidates and are **NOT activated**.

**No failover, no replica lag figure, no read-scaling result, and no availability improvement is
claimed.** Open decision **P1-OD-027 (NFR-SCL)** is unresolved.

## Context

A read replica is the standard first answer to read load, and it is also the standard first source of
a class of bug that is very hard to find: an operation that reads slightly stale data, decides
something, and writes the decision to the primary. The symptom is intermittent, data-dependent, and
usually appears under exactly the load that motivated adding the replica.

Four facts shape the decision now.

1. **No replica exists and none can be provisioned**, because no hosted database project has been
   approved (ADR-003, ADR-012).
2. **Replica lag is not observable.** Nothing measures it, exports it, or alerts on it. Routing reads
   to a replica whose staleness cannot be measured is a correctness claim with nothing behind it.
3. **The abstraction point exists now.** The backend reaches PostgreSQL through exactly one path —
   `withTransaction()` over a pool obtained from `poolFor()`. Whatever routing rule is chosen has one
   place to live, and choosing it now costs nothing.
4. **The dangerous default is silent success.** A `poolFor('replica')` that quietly returned a
   replica would work in every test with no lag and fail only in production. A version that returns
   the primary and logs is correct in both.

## Decision

**No replica is activated.** The rules below govern any future activation and are binding now.

### 1. Writes always go to the primary

Without exception. There is no write path, no "write-through-read-replica" mode, and no
write-forwarding proxy in scope.

### 2. Operation classes that must read the primary

These are not stale-tolerant, and none may ever be routed to a replica:

| Class                                | Why the primary is required                                                                                                                                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Security and authorization reads** | `iam.has_permission` / `iam.has_permission_in_scope`, and the scope resolution that precedes them. A stale replica can return an allow for a grant that has been revoked, or a scope that has been narrowed |
| **Entitlement resolution**           | `org.resolve_feature_enabled` is evaluated at command time against the effective plan (BR-TEN-001). A stale plan is a commercial error                                                                      |
| **Command validation reads**         | Any read whose result decides whether a write is permitted or what it writes. Deciding on stale state and committing to the primary is the exact failure mode this ADR exists to prevent                    |
| **Idempotency lookups**              | Reading `shared.idempotency_keys` from a replica can miss a just-stored key and re-execute a command. The lookup is inside the caller's transaction, so it is on the primary by construction                |
| **Any read inside a transaction**    | A transaction is opened on one connection to one server. Splitting reads across servers inside a transaction is not expressible and would break atomicity and the scoped session                            |
| **Read-after-write**                 | See §3                                                                                                                                                                                                      |
| **Optimistic-concurrency reads**     | The version a client is about to send in `If-Match` must be the current one, not a lagging one                                                                                                              |

### 3. Read-after-write is on the primary, or has an explicit consistency strategy

A caller that has just written and then reads must observe its own write. Two acceptable
implementations, and only two:

1. **Read from the primary** for a bounded window after a write in the same logical session. Simple,
   always correct, and the default.
2. **An explicit consistency strategy** — for example, waiting for the replica to reach a recorded
   log position before reading. Acceptable only when replica position is observable, the wait is
   bounded, and the fallback on timeout is the primary.

"It is usually fast enough" is not a strategy and is not acceptable.

### 4. No silent routing of a strongly consistent operation

The repository abstraction must never route a strongly consistent operation to a replica without the
call site saying so. This is the rule the implementation enforces today.

```ts
export function poolFor(role: ConsistencyRole): Pool {
  if (role === 'replica' && !replicaWarningEmitted) {
    replicaWarningEmitted = true;
    log.info('Replica routing requested; serving from primary (no replica activated)', { … });
  }
  return primaryPool();
}
```

`poolFor('replica')` **returns the primary and logs once**. The consequence is that a caller asking
for a replica gets correct data and an observable record of the request, rather than a silent
downgrade in either direction.

The rule generalises: any future routing layer must make the consistency requirement **explicit at
the call site** and must fail towards the primary. A routing decision that can be made implicitly —
by a connection pool, a proxy, or a driver setting — is a routing decision that will eventually route
something it should not.

### 5. Replica lag must be observable before activation

Three preconditions, all required:

1. **A provisioned replica.**
2. **Observable replication lag** — measured, exported as a metric, alertable, and visible in
   readiness output.
3. **An approved list of stale-tolerant operations**, each with the maximum staleness it tolerates,
   recorded in the operation registry rather than in prose.

Until all three exist, routing would be a correctness claim with no evidence behind it, which is the
one thing this repository's documentation rules forbid.

### 6. Candidate stale-tolerant read classes — listed, NOT activated

Recorded so a future evaluation starts from a considered list rather than from whatever is convenient
that day. **None of these is activated, and listing one here is not approval to route it.**

| Candidate class                                     | Why it might tolerate staleness                              | What must be checked before activating                                            |
| --------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Historical reporting over closed periods            | The underlying period no longer changes                      | That the period-closure boundary is itself read from the primary                  |
| Analytical aggregates already declared eventual     | Presented as summaries, not as authoritative counts          | That no write path consumes the aggregate                                         |
| Platform reference data (currencies, locales)       | Changes only by migration or approved platform configuration | That a migration-time change does not need to be immediately visible              |
| Export generation for a stated as-of instant        | The export declares its own as-of time                       | That the as-of instant is recorded in the artefact                                |
| Audit-trail browsing (read-only investigation)      | Append-only; a slightly short tail is visible as such        | That an investigation UI states the staleness rather than hiding it               |
| Large list views with an explicit "as of" indicator | The user is told what they are looking at                    | That no action is initiated directly from the stale row without a primary re-read |

Every candidate shares one property: **no write decision depends on the value read.** A class that
fails that test is not a candidate regardless of how appealing its read volume is.

### 7. Failover is not claimed

A replica is not a failover plan. Promotion, split-brain avoidance, connection-string cutover, and
recovery-point objectives are all unaddressed, and nothing in this record may be cited as evidence
that any of them exists. There is no backup and restore regime to describe either, because no hosted
database exists (ADR-012).

## Alternatives Considered

**Alternative 1 — Provision a replica now and route obviously read-only endpoints to it.**
Rejected. It requires a hosted database project, a region, and a commercial plan, all Open (ADR-003).
It would also be untestable in the way that matters: with no traffic, lag is effectively zero, so the
routing would appear correct while proving nothing about behaviour under the lag that only appears
under load. "Obviously read-only" is additionally not the right test — the test is whether a write
decision depends on the value, and several obviously-read-only endpoints fail it.

**Alternative 2 — Route reads to a replica by default and mark the exceptions.**
Rejected, decisively. The default determines the failure mode. Defaulting to the replica means that
any operation whose consistency requirement was not noticed — a new endpoint, a refactor, a
convenience read added inside an existing service — is silently stale. Defaulting to the primary
means the same oversight costs read capacity and nothing else. When one default fails towards
"slower" and the other towards "wrong", the choice is not close.

**Alternative 3 — Make `poolFor('replica')` throw until a replica exists.**
Rejected, though it is a defensible position. Throwing would make the gap maximally loud, but it
would also make it impossible to express intended consistency in code before the infrastructure
exists — the annotation and the activation would have to land together, which is exactly the
big-bang change this record is trying to avoid. Returning the primary and logging keeps the call site
honest, keeps behaviour correct, and leaves an observable record. The distinction between "asked for
a replica" and "got a replica" stays visible either way.

**Alternative 4 — Add a proxy or driver-level read/write split.**
Rejected. It moves the routing decision out of the application, where the consistency requirement is
known, into a component that only sees SQL text. A `SELECT` that decides a write is
indistinguishable from a `SELECT` that renders a list at that layer, so the split is made on exactly
the wrong information. It also hides the decision from code review and from tests.

## Consequences

**Positive.**

- The correctness of every read is currently trivial to reason about: there is one server.
- Consistency requirements can be expressed in code now, through `ConsistencyRole`, without waiting
  for infrastructure.
- The failure mode of the current implementation is "no read scaling", which is visible, measurable,
  and recoverable — not "intermittently stale decisions", which is none of those things.
- A future activation has a written list of preconditions and a written list of candidate classes, so
  it starts as an evaluation rather than an argument.
- No cost, no region commitment, and no unverifiable replication claim enters the repository.

**Negative and trade-offs — accepted knowingly.**

- **All read load lands on the primary.** ADR-001 already records that a single shared database is a
  single performance domain; this record does not mitigate that, it declines to mitigate it
  prematurely.
- **`DATABASE_REPLICA_URL` is accepted and ignored**, which is mildly confusing on first reading. It
  is documented here and in `src/server/config/backend-config.ts`, and the alternative — refusing to
  parse a variable that expresses real deployment intent — was judged worse.
- **`poolFor('replica')` logs once per process**, so a caller that requested a replica thousands of
  times produces one record. That is deliberate noise control and it does mean the frequency of the
  request is not visible in logs.
- **Read-after-write on the primary constrains a future activation.** Sessions that write and then
  read frequently will get little benefit from a replica, which reduces the eventual payoff.
- **The candidate list in §6 is unvalidated.** It is a starting point for evaluation, and some entries
  will not survive contact with a real workload.
- **This record will need superseding** if a replica is ever provisioned, to record the topology, the
  lag observability mechanism, and the activated operation list.

## Security Impact

- **Authorization and entitlement reads are permanently primary-only.** A stale replica can answer
  "allowed" for a grant that has been revoked, or return a scope that has since been narrowed.
  Combined with the permanent prohibition on caching authorization and entitlement decisions
  ([ADR-014](./ADR-014-distributed-consistency-model.md)), the position is consistent: **permission
  state is never read from anything but the authoritative source, in the request transaction.**
- **A replica is a second copy of all tenant data.** Provisioning one is a data-residency and
  access-control decision, not merely a performance one: it needs the same RLS enforcement, the same
  role archetypes with no `BYPASSRLS`, the same connection-role discipline, and the same backup and
  retention posture as the primary. None of that has been designed, and this record does not imply it
  has.
- **The replica connection role must be an `app_readonly`-class archetype** with no write grants, so
  a misconfiguration cannot produce writes on a replica.
- **Idempotency lookups on a replica would be a security-relevant defect**, not only a correctness
  one: a missed key re-executes a command that a caller believed had already happened.
- No replication security review, failover test, or data-residency assessment has been performed, and
  none is claimed. Verification is performed by the same engineer who implements; no independent QA
  ownership is assigned.

## Operational Impact

- **Nothing operational changes today.** There is one database and one pool per role.
- **`poolFor('replica')` emits one `info` record per process** with `operation: 'pool.replica-fallback'`
  and `result: 'skipped'`, so a request for replica routing is visible without being noisy.
- **Replica lag is not measured, exported, or alerted on**, and it is one of the three preconditions
  in §5. Building that observability is part of any future activation, not a follow-up to it.
- **Pools are bounded and per-role** — `DB_POOL_MAX` for the web role, `max(2, OUTBOX_MAX_CONCURRENCY + 1)`
  for the worker — and both values are **proposed validation baselines pending measurement**.
- **Provisioning a replica would add operational obligations** that are not estimated here:
  replication monitoring, lag alerting, connection-string management, promotion runbooks, and a
  larger backup surface. A provider and region decision is an owner matter.
- Nothing reached protected develop outside the approved pull-request and hosted-CI flow. The work
  was reviewed under the Standing Technical Authorization and Solo Developer Review policies.

## Related Phase 1 Task and Requirement IDs

| ID                  | Relationship to this ADR                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------- |
| P1-13-BE-003        | Bounded pools and the `ConsistencyRole` abstraction — where routing would live                |
| P1-13-BE-011        | Scoped transaction wrapper — why reads inside a transaction cannot be split across servers    |
| P1-13-BE-005        | Authorization middleware — permanently primary-only                                           |
| P1-13-BE-012        | Idempotency — lookups inside the caller's transaction, on the primary by construction         |
| P1-13-BE-014        | Entitlement resolution at command time (BR-TEN-001) — permanently primary-only                |
| P1-13-BE-013        | Optimistic concurrency — version reads must not lag                                           |
| P1-OD-027 (NFR-SCL) | **Unresolved.** No read-scaling, lag, or capacity target is claimed                           |
| ADR-001             | Modular monolith — the single shared database and its shared performance domain               |
| ADR-003             | Supabase and PostgreSQL — the hosted project, region, and plan remain Open                    |
| ADR-004             | Mandatory Row-Level Security — a replica would need identical enforcement                     |
| ADR-012             | Local-first environment with controlled promotion — why no replica is provisioned             |
| ADR-014             | Distributed consistency model — the eventual, stale-tolerant-reads-only position for replicas |
| ADR-018             | Database sharding deferral — the adjacent data-tier decision                                  |
| OIR-01              | Open issue: hosting provider, production region, and deployment platform are not approved     |

Identifiers such as P1-OD-027, BR-TEN-001, and OIR-01 are defined in the canonical documents recorded
in [canonical-documents.md](../governance/canonical-documents.md), which live outside this repository
by owner decision. Role archetypes are defined in the
[Role and Grant Standard](../database/role-and-grant-standard.md).

## Decision Owner

Eng. Ezzaldeen Al-Bitar (technical and IT owner; GitHub username `Ezzaldeen-Albitar`) — for the
routing rules, the primary-only operation classes, the activation preconditions, and the inert
replica configuration. Recorded under the
[Standing Technical Authorization Policy](../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../governance/solo-developer-review-policy.md) —
owner-authorized technical self-review, never an independent third-party audit.

Eng. Ezzaldeen Al-Bitar and Eng. Bilal Jradat (jointly) — for provisioning any read replica, hosted
database project, region, or commercial plan, each of which carries cost and data-residency
commitments beyond the technical decision. None has been approved.

## Date

2026-07-21
