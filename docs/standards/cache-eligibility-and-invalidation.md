# Cache Eligibility and Invalidation Standard

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Binding standard — applies to every server-side cache use from Phase 1-13 onward ·
**Date:** 2026-07-21 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (under the
[Standing Technical Authorization Policy](../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../governance/solo-developer-review-policy.md) —
owner-authorized technical self-review, never an independent third-party audit) ·
**Task IDs:** P1-13 caching foundation — a cross-cutting principle of Phase 1-13; the canonical task
allocation lives in the external plan documents recorded in
[canonical-documents.md](../governance/canonical-documents.md) ·
**Related:** [Backend Architecture and Shared Foundation](./backend-architecture-and-shared-foundation.md) ·
[API Conventions v0.1](./api-conventions-v0.1.md) ·
[Scalability and Backpressure Standard](./scalability-and-backpressure-standard.md) ·
[ADR-014 Distributed Consistency Model](../adr/ADR-014-distributed-consistency-model.md) ·
[ADR-016 CDN Readiness](../adr/ADR-016-cdn-readiness.md) ·
[RLS Standard](../database/rls-standard.md) ·
Implementation: [`src/server/cache/eligibility.ts`](../../src/server/cache/eligibility.ts),
[`src/server/cache/keys.ts`](../../src/server/cache/keys.ts),
[`src/server/cache/cache.ts`](../../src/server/cache/cache.ts)

---

## 1. The four rules that constrain everything else

1. **Cache is never the source of truth.** There is no write-through and no write-behind. A mutation
   writes the database and then invalidates.
2. **A miss runs the same authorized repository path as a normal read.** The loader is supplied by
   the caller and executes inside the caller's context and transaction. The cache never queries the
   database itself, so it cannot bypass RLS.
3. **Errors are never cached.** Only a fulfilled value is stored; a rejected loader propagates and
   leaves the key empty.
4. **A TTL is mandatory and finite.** `set()` requires `ttlSeconds`; there is no "cache forever" call
   to reach for at 2 a.m.

These are enforced in `src/server/cache/cache.ts`, not documented and hoped for.

## 2. The eligibility matrix

`assertCacheable(category, ttlSeconds)` refuses a prohibited category and refuses a TTL above the
category ceiling. Categories are named in `defineOperation({ cacheCategory })`, so "we agreed not to
cache authorization decisions" is a failing call rather than a paragraph nobody re-reads.

| Category               | Allowed | Key scope       | Max TTL | Invalidation owner                                    | Consistency      | Rationale                                                                                                                                                                                      |
| ---------------------- | ------- | --------------- | ------- | ----------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `never`                | **No**  | `none`          | 0 s     | n/a                                                   | n/a              | Explicitly not cacheable. **The default for anything not yet assessed.**                                                                                                                       |
| `platform-reference`   | Yes     | `platform`      | 3600 s  | Migration or platform configuration change            | eventual         | Tenant-neutral structural reference (currencies, locales, timezones). Changes only by migration or approved platform configuration, so a long TTL is safe.                                     |
| `tenant-configuration` | Yes     | `tenant`        | 300 s   | The application service that writes the configuration | read-your-writes | Settings and catalogues a tenant edits rarely and reads constantly. The writing service invalidates the namespace in the same request, so the editor sees their own change.                    |
| `tenant-read-model`    | Yes     | `tenant+branch` | 60 s    | The mutating application service, by namespace        | eventual         | Derived list and summary views. Short TTL because staleness is visible to users; every mutation must declare its invalidation namespace.                                                       |
| `authorization`        | **No**  | `none`          | 0 s     | n/a                                                   | n/a              | A cached allow outlives a revoked grant, and a cached deny outlives a granted one. Permission decisions are evaluated in the database on every request.                                        |
| `entitlement`          | **No**  | `none`          | 0 s     | n/a                                                   | n/a              | Entitlement is evaluated at command time against the effective plan version (BR-TEN-001). A cached entitlement survives a subscription change — a commercial defect, not just a technical one. |
| `financial-command`    | **No**  | `none`          | 0 s     | n/a                                                   | n/a              | Command results are not reads. Idempotent replay is served from `shared.idempotency_keys` — a durable, tenant-scoped, audited record — never from a cache.                                     |
| `restricted-data`      | **No**  | `none`          | 0 s     | n/a                                                   | n/a              | Values classified restricted in the personal-data registries never enter a store that has no RLS, no tenant isolation, and no retention enforcement.                                           |

### 2.1 The four permanent prohibitions

Each exists for a specific incident, not for tidiness:

- **`authorization`** — a cached allow survives a revoked grant. Permission changes taking effect
  immediately is the entire promise of server-side authorization; caching the decision breaks the
  promise silently and in the caller's favour.
- **`entitlement`** — a cached entitlement survives a downgraded subscription. That is a commercial
  and contractual problem, not merely a technical one.
- **`financial-command`** — replaying a command result from a cache invents a financial fact. Replay
  belongs to idempotency, which is durable, tenant-scoped, and audited.
- **`restricted-data`** — the cache has no RLS, no tenant isolation, and no retention rules.
  Classified values do not enter it.

### 2.2 Consistency each category promises

| Consistency        | What a caller may assume                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `read-your-writes` | The writer sees its own change immediately, because the writing service invalidates the namespace in the same request |
| `eventual`         | A change becomes visible within the TTL, or immediately if the mutating service invalidates                           |
| `strong` / `n/a`   | Not served from cache at all — the database path is the only path                                                     |

## 3. Key construction

Keys are built by `src/server/cache/keys.ts` **and nowhere else**. Hand-concatenated keys are how a
cache serves one tenant's data to another: someone writes `` `partner:${id}` ``, forgets the tenant,
and the bug is invisible until two tenants share an id space — or until an id is guessable.

Four properties are enforced structurally.

| Property                          | Mechanism                                                      | What it prevents                                                                                                                        |
| --------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Versioned**                     | `SERIALIZATION_VERSION` is the first segment                   | New code reading a value written in an old shape. Deploying a shape change is a version bump, not a cache flush somebody forgets to run |
| **Environment-namespaced**        | `NEXT_PUBLIC_APP_ENV` ?? `NODE_ENV` ?? `local`                 | A shared cache instance cross-serving between environments                                                                              |
| **Module-namespaced**             | The owning module is a segment                                 | Two modules colliding on a common noun (`invoice`, `status`, `line`)                                                                    |
| **Tenant-aware, collision-proof** | Every segment is **length-prefixed**: `label:<length>:<value>` | Forging another key by controlling one segment's contents                                                                               |

The length prefix is the load-bearing detail. Without it, `a` + `bc` and `ab` + `c` join to the same
string; with it, they are `p:1:a|p:2:bc` and `p:2:ab|p:1:c`. **No combination of segment contents
can produce another key**, so a value that happens to contain the separator is harmless and an
attacker-influenced id cannot be crafted into another tenant's key.

Two entry points, deliberately separate:

- `tenantKey({ module, entity, tenantId, companyId?, branchId?, parts? })` — the tenant is
  **mandatory**. A key for tenant-owned data without a tenant is not expressible.
- `platformKey({ module, entity, parts? })` — for genuinely tenant-neutral platform data. It is
  separately named so choosing it is a deliberate act a reviewer sees, not an omission.

`tenantNamespace()` returns the prefix used for namespaced invalidation, and `tenantOfKey()` extracts
the tenant segment — used by the cross-tenant collision test.

## 4. Invalidation

**The mutating application service owns invalidation, in the same request as the write.**

1. Write the database inside the transaction.
2. Invalidate the affected namespace with `deleteNamespace(tenantNamespace({...}))`, which removes
   every key for one entity within one tenant and nothing else.
3. Never write the new value into the cache directly. The next read repopulates through the
   authorized loader, so the cached value is always something the reader was allowed to read.

For a read-after-write path, `getOrLoad(key, ttl, loader, { bypass: true })` skips the read but still
populates on load — the caller sees its own write without abandoning caching for later readers.

Every mutation that touches a cached category **must declare its invalidation namespace**. A cached
category with no declared invalidation owner is a defect, and the matrix names the owner for each
allowed category so review has something to check against.

## 5. Stampede protection

Concurrent misses on one key share a single in-flight loader promise: the first miss owns the load,
later misses await the same promise. A cold key under load therefore produces one database read, not
N. The in-flight entry is removed in a `finally`, so a rejected loader does not pin the key.

This is per-process. A distributed adapter must provide the equivalent guarantee across instances
before it is used to make a horizontal-scaling claim.

## 6. Bounds and eviction

`InMemoryCache` is bounded by `CACHE_MAX_ENTRIES` (default 5000, range 16–100 000). On insert past
the bound, the entry with the earliest expiry is evicted. An unbounded cache is a memory leak with
good intentions.

Expiry is checked on read as well as enforced by eviction, so an expired entry is never returned even
if it has not yet been evicted. Cache hits and misses are counted (`cache.hit.count`,
`cache.miss.count`); neither counter carries a tenant label.

## 7. No external cache service is introduced

`DistributedCache` is a marker interface. **Nothing implements it in Phase 1-13**, and that is a
decision rather than an omission.

Adding Redis (or an equivalent) to satisfy a checklist would introduce:

- an operational dependency with its own availability, upgrade, and backup story, in a project where
  the only environment is Local (ADR-012);
- a new failure mode on a path that currently has none — a cache outage becoming a request outage is
  a classic self-inflicted incident;
- a **second place tenant data lives**, with no RLS, no tenant isolation, no retention enforcement,
  and no audit trail;
- a shared key space that would make the length-prefixing rule in §3 a security control rather than a
  hygiene one.

In exchange for nothing a single-instance deployment needs. When horizontal scaling is actually
approved, `DistributedCache` is the contract an adapter must satisfy, and the eligibility matrix,
key rules, and invalidation ownership above apply to it unchanged.

## 8. Relationship to HTTP caching

This standard governs **server-side data caching**. HTTP response caching is separate and much
narrower: authenticated API responses are sent `Cache-Control: no-store, private` by the pipeline
(see [API Conventions §10](./api-conventions-v0.1.md#10-caching-of-api-responses)), and failure
responses `no-store`. Public, stale-tolerant asset caching is governed by
[ADR-016 CDN Readiness](../adr/ADR-016-cdn-readiness.md); no CDN is provisioned.

## 9. Review and governance

Nothing reached protected develop outside the approved pull-request and hosted-CI flow. The work
was reviewed under the Standing Technical Authorization and Solo Developer Review policies.

Owner: Eng. Ezzaldeen Al-Bitar. No independent third-party review, external audit, or separation of
duties exists or is claimed. All TTL and size values above are **proposed validation baselines
pending measurement**; P1-OD-027 (NFR-SCL) is unresolved.
