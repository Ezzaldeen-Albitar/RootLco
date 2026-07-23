# Rate-Limiting Standard

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Binding standard — applies to every HTTP surface from Phase 1-13 onward.
All limits and windows are **proposed validation baselines pending measurement**; P1-OD-027 (NFR-SCL) is unresolved ·
**Date:** 2026-07-21 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (under the
[Standing Technical Authorization Policy](../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../governance/solo-developer-review-policy.md) —
owner-authorized technical self-review, never an independent third-party audit) ·
**Task IDs:** P1-13-SEC-003, P1-13-BE-021 ·
**Related:** [Backend Architecture and Shared Foundation](./backend-architecture-and-shared-foundation.md) ·
[API Conventions v0.1](./api-conventions-v0.1.md) ·
[Error Catalog v0.1](./error-catalog-v0.1.md) ·
[Scalability and Backpressure Standard](./scalability-and-backpressure-standard.md) ·
[ADR-015 Load-Balancer Readiness](../adr/ADR-015-load-balancer-readiness.md) ·
[Security Baseline](../security/security-baseline.md) ·
[Security Event Capture Map](../security/security-event-capture-map.md) ·
Implementation: [`src/server/http/rate-limit.ts`](../../src/server/http/rate-limit.ts),
[`src/server/http/trusted-proxy.ts`](../../src/server/http/trusted-proxy.ts)

---

## 1. Position and honest status

Rate limiting is configuration-led, multi-dimensional, and **explicitly not correct on a
process-local store once more than one instance runs**. That is stated first because the opposite
claim is the usual defect: a system that appears rate limited but limits _per instance_, which is a
different and much weaker property.

The store is a port. The in-memory implementation is the development and test adapter.
`DistributedRateLimitStore` is the contract a shared-store adapter must satisfy before horizontal
scaling is claimed, and `assertStoreSuitableForMultiInstance()` enforces the distinction in code
rather than in a comment.

Enforcement is switchable via `RATE_LIMIT_ENABLED` (default `true`).

## 2. Dimensions

A policy declares which dimensions form its key. The order is fixed for key stability.

| Dimension   | Source                              | Available when              | Notes                                                                                   |
| ----------- | ----------------------------------- | --------------------------- | --------------------------------------------------------------------------------------- |
| `operation` | The registered operation id         | Always                      | Present in every policy; prevents one endpoint's traffic consuming another's budget     |
| `ip`        | `resolveClientAddress()` — see §5   | Before authentication       | The only identity available for an unauthenticated caller                               |
| `tenant`    | `RequestContext.principal.tenantId` | After context resolution    | Server-resolved, never caller-supplied                                                  |
| `user`      | `RequestContext.principal.userId`   | After context resolution    | Server-resolved, never caller-supplied                                                  |
| `session`   | Reserved in the dimension type      | Not populated in Phase 1-13 | Sessions are Phase 1-14; the dimension exists so the key contract does not change later |

A missing value becomes the literal `-` rather than being dropped, so a key never silently collapses
into a shorter, broader bucket.

**Which side of authentication a policy runs on is derived from its key, not configured
separately.** A policy whose `keyBy` contains neither `tenant` nor `user` is evaluated
**pre-authentication**; any other policy is evaluated after context resolution. That derivation is
what makes "throttle credential stuffing before doing session work" a property of the pipeline
rather than a per-endpoint decision.

## 3. The four policies

Every value below is a **proposed validation baseline**, not an approved capacity statement. No load
evidence exists.

| Policy              | Limit | Window | Key dimensions                | Security-relevant | Rationale                                                                                                                                                           |
| ------------------- | ----- | ------ | ----------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth-adjacent`     | 10    | 60 s   | `operation`, `ip`             | **Yes**           | Unauthenticated or authentication-adjacent operations are keyed by client IP because no trustworthy principal exists yet. A breach is a credential-stuffing signal. |
| `expensive-read`    | 30    | 60 s   | `operation`, `tenant`, `user` | No                | Reports and wide searches. Keyed per user within a tenant so one operator cannot monopolise a tenant, and one tenant cannot monopolise the instance.                |
| `standard-command`  | 120   | 60 s   | `operation`, `tenant`, `user` | No                | The general write path. Generous enough to be invisible to real use.                                                                                                |
| `low-risk-metadata` | 600   | 60 s   | `operation`, `tenant`         | No                | Cheap metadata reads. A limit exists only to bound accidental client loops; it is **not** a security control.                                                       |

The reference endpoint `meta.ping` declares `low-risk-metadata`.

An operation that names a policy which does not exist throws when the pipeline resolves it — a
mis-typed policy name is a loud failure, never a silently unlimited endpoint.

The algorithm is a **fixed window** counter: `hit()` increments and returns the new count plus the
window expiry, and the decision is `count <= limit`. A fixed window admits a burst across a window
boundary; that is an accepted, documented property of the current baseline, not an oversight. Changing
the algorithm is a change to the store contract, and the contract requires increment-and-read to be
atomic in any implementation.

## 4. Tenant-safe, collision-proof keys

Keys are built centrally by `rateLimitKey()`:

```text
p:<policy>|<dimension>:<length>:<value>|<dimension>:<length>:<value>…
```

Every segment is **length-prefixed**, so no combination of segment contents can produce another
policy's key: `a` + `bc` and `ab` + `c` are different keys, and a value containing the separator is
harmless. A tenant identifier is always a discrete key segment, so **two tenants can never share a
bucket**, and no caller can forge another tenant's bucket by controlling the content of a segment
they influence.

## 5. Client-IP resolution and trusted proxies

`X-Forwarded-For` is caller-controlled input. Behind a load balancer it is the only way to see the
real client; in front of one it is a free-form string an attacker sets to whatever they like.
Trusting it unconditionally means every IP-keyed limit is bypassed by adding one header — the single
most common rate-limiting defect.

The rules in `resolveClientAddress()`:

1. **Forwarded headers are read only when the immediate peer is in `TRUSTED_PROXY_IPS`**, an exact
   allow-list of remote addresses. The peer address comes from the platform, never from a header.
2. **The allow-list is empty by default.** An un-configured deployment therefore ignores forwarded
   headers entirely and falls back to the peer address. This is the only safe default: any other
   default would make forged forwarding the out-of-the-box behaviour, and a deployment that forgot to
   configure the list would be silently bypassable. Configuring it is a deliberate act taken when a
   proxy actually exists.
3. **The client IP is the right-most untrusted entry.** The chain is walked from the right — the hop
   nearest this server, appended by infrastructure we trust — inward, and the first address that is
   not itself a trusted proxy is taken. Taking the **left-most** entry is the usual mistake: the
   left-most value is the first thing the _client_ wrote, so it is entirely attacker-controlled. Only
   the suffix of the chain appended by trusted hops is believable, and the right-most untrusted entry
   is the outermost hop still covered by that trust.
4. **When no peer address is available at all, resolution returns `null`** and the limiter degrades to
   its non-IP dimensions rather than bucketing every caller together under a fabricated address.

Normalisation strips IPv6 brackets, unwraps `::ffff:` IPv4-mapped addresses, and removes a trailing
`:port` only when exactly one colon is present — a bare IPv6 address is full of colons and must not be
truncated.

## 6. The distributed-store contract

```ts
interface RateLimitStore {
  hit(key, windowMs, now): Promise<{ count: number; resetAtMs: number }>;
  reset(key): Promise<void>;
  readonly isShared: boolean;
}
interface DistributedRateLimitStore extends RateLimitStore {
  readonly isShared: true;
}
```

Requirements for any adapter:

- **`hit()` must be atomic**: increment-and-read in one operation. A read-then-write implementation
  under-counts precisely when it matters — under load.
- **`isShared` must be `true`** and must be true in fact, not merely in the literal.
- Window expiry must be authoritative in the shared store, not derived from a local clock per
  instance.
- Key space must be bounded or expired, so a key-space flood degrades the store rather than exhausting
  it.

`assertStoreSuitableForMultiInstance()` throws when the installed store reports `isShared === false`.
**Deployment composition must call it before serving traffic from more than one instance.** No shared
adapter ships in Phase 1-13: introducing an external cache service is out of scope, and a fake
"distributed" store would be worse than none, because it would convert a visible gap into an invisible
one.

The in-memory store is correct for one process and bounded at 50 000 keys, evicting the
oldest-resetting bucket so a key-space flood evicts rather than exhausts memory.

## 7. Breach handling

On breach, `enforceRateLimit()`:

1. increments `http.throttle.count` with `{ policy, operation }` labels;
2. throws `AppFailure('ERR-RTE-001')` carrying `retryAfterSeconds`.

The boundary then returns:

| Element              | Value                                             |
| -------------------- | ------------------------------------------------- |
| Status               | **429**                                           |
| Body                 | RFC 9457 problem document, `code: "ERR-RTE-001"`  |
| `retryAfterSeconds`  | Seconds until the window resets (minimum 1)       |
| `Retry-After` header | The same value, integer seconds                   |
| `x-correlation-id`   | Present, as on every response                     |
| `Cache-Control`      | `no-store`                                        |
| Log record           | `result: 'throttled'`, `errorCode: 'ERR-RTE-001'` |

**Security-event candidates.** A policy marked `securityRelevant` — `auth-adjacent` today — produces
a breach that is an abuse signal, not merely a client-behaviour signal, and is therefore a
**candidate** for `iam.security_events`.

The word "candidate" is precise, and the reason is the pipeline position rather than the grant.
**The durable write is not reachable from the pre-authentication path.** `recordSecurityEvent()`
requires a `DbHandle`, which requires a resolved request context and an open transaction. An
`auth-adjacent` policy is by construction evaluated _before_ either exists. Today an
`auth-adjacent` breach therefore produces the throttle metric and the `result: 'throttled'` log
record with its correlation ID, and nothing else. Wiring the durable record for this path is work
for the phase that owns authentication (Phase 1-14), which is where a pre-authentication
security-event writer belongs.

The grant is no longer the obstacle: the runtime role holds tenant-scoped INSERT on
`iam.security_events`
([DBCR-P1-13-001](../database/change-requests/DBCR-P1-13-001-backend-runtime-write-grants.md)), so
`recordSecurityEvent()` persists the record wherever it is called with a resolved context. It holds
no UPDATE or DELETE, and **reading** `iam.security_events` still requires the `iam.audit.view`
permission — recording an abuse signal is not permission to browse the abuse log.

Telemetry loss never escalates into a request failure: the throttle itself is the control, and the
refusal has already happened.

## 8. Failure policy by class

What happens when the limiter itself cannot answer — the store is unreachable, or a shared adapter
times out. The rule differs by what the policy is protecting, because "fail closed everywhere" and
"fail open everywhere" are both wrong.

| Class                                     | Policy              | On limiter failure                                                | Reasoning                                                                                                                                                                                                    |
| ----------------------------------------- | ------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Auth-adjacent** (security control)      | `auth-adjacent`     | **Fail closed** — refuse with `ERR-RTE-001`                       | The limit _is_ the brute-force control. Failing open removes the control precisely when the system is under stress, which is when an attacker is most likely to be the cause                                 |
| **Expensive reads** (resource protection) | `expensive-read`    | **Fail closed**                                                   | The limit protects a shared resource. Failing open lets a single caller degrade every tenant on the instance                                                                                                 |
| **Standard commands**                     | `standard-command`  | **Fail closed**                                                   | Same resource-protection reasoning; write paths are the more expensive side                                                                                                                                  |
| **Low-risk metadata** (loop guard)        | `low-risk-metadata` | **Fail open** — proceed, and log at warn with `result: 'skipped'` | The limit is explicitly not a security control; it bounds accidental client loops. Refusing cheap metadata reads because a counter store is unavailable converts a limiter outage into an application outage |

Two rules apply to every class: the decision is logged with the correlation ID so the degradation is
visible, and a limiter failure is never silent.

> **Status today.** This table is **binding on the phase that introduces a shared-store adapter**;
> it is not yet differentiated in code. The in-process store has no remote dependency and no failure
> mode of this kind, and `enforceRateLimit()` therefore lets any store error propagate — the
> boundary classifies it as `ERR-SYS-001` (500), which is fail-closed behaviour for **every** class,
> including `low-risk-metadata`. The per-class differentiation above is a requirement on the adapter
> and its call site, not a description of current behaviour.

### 8.1 When the key cannot be formed

§8 is about the limiter failing. This is the other case: the limiter works, and the **dimension the
policy keys on does not exist**. `rateLimitKey()` substitutes `-` for a missing dimension, so the
policy still evaluates — but every caller lands in one bucket, and the limit becomes a global budget
rather than a per-caller one.

The rule is the same shape as §8 and turns on the same property:

| Policy class              | Key unavailable                                          | Reasoning                                                                                                                                                                                     |
| ------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `securityRelevant: true`  | **Enforce on the coarse bucket.** Never skip             | A bounded attacker rate is worth more than uninterrupted service on the endpoint the limit protects. Skipping deletes the control silently, and silence is the failure mode that gets shipped |
| `securityRelevant: false` | **May skip**, where a shared bucket is itself the hazard | A shared bucket in front of a liveness probe lets one caller make the probe report an unhealthy pod — the control causing the outage it exists to prevent                                     |

The coarse bucket is a **degradation, not a control**, and a phase that relies on it records the
residual rather than describing the policy as if it were keyed. The real remedy is to supply the
missing dimension; for `ip` that means a peer address from the platform, which is infrastructure work.

> **Why this section exists.** Phase 1-15 added a skip for an unkeyable ip-policy, wrote the
> condition against `operation.public` rather than against security relevance, and thereby removed
> the `auth-adjacent` limit from four unauthenticated authentication routes that the previous phase
> had enforced. It was caught at the phase gate, not before. See
> [PMR-006](../phase-1/phase-1-15/post-merge-security-review.md) §4.1.

## 9. Exemptions must be explicit

- **There is no implicit exemption.** An operation that declares no `rateLimitPolicy` is not
  "exempted"; it is unthrottled, and that is a reviewable declaration in the operation registry,
  visible in the generated OpenAPI document as the absence of `x-rate-limit-policy` and of a `429`
  response.
- **No caller class is exempt by identity.** There is no allow-list of tenants, users, IPs, or
  internal callers that bypasses a policy. An internal caller that needs a different budget gets a
  different policy, named and reasoned in §3.
- **Adding a policy or changing a limit is a change to `RATE_LIMIT_POLICIES` and to this document**,
  in the same pull request, including the `rationale` field — it is read during review, not
  decoration.
- **Health and container probes** are unauthenticated by design and are declared `public` with a
  `publicReason`. They are reported by `npm run validate:authorization-coverage`, so an unthrottled
  public endpoint cannot be quiet.

## 10. Review and governance

Nothing reached protected develop outside the approved pull-request and hosted-CI flow. The work
was reviewed under the Standing Technical Authorization and Solo Developer Review policies.

Owner: Eng. Ezzaldeen Al-Bitar. No independent third-party review, external audit, or separation of
duties exists or is claimed. Every limit and window in this document is a proposed validation
baseline pending measurement; no capacity, throughput, or abuse-resistance level is claimed.
