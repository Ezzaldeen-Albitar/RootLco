# Phase 1-13 — Adversarial review of the merged implementation

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** P1-13 · **Date:** 2026-07-21 · **Reviewer:** Eng. Ezzaldeen Al-Bitar ·
**Subject:** protected `origin/develop` = `e615a0212fda0b028316206bf9f331dd86120890`
(feature PR #49 + remediation PR #51, both merged)

Owner-authorized technical **self-review** under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**Never an independent third-party audit, and never a penetration test.**

---

## 1. Method

A refute-focused pass over the merged feature work and the database remediation together. The
posture was to break the phase's own claims, not to confirm them: each claim was treated as a
hypothesis, and a finding was only recorded once a concrete failure or exploit path could be
written down. Catalogue claims were checked with read-only `psql` against a database carrying
exactly this schema. Two findings were settled by execution rather than argument — one confirmed
that way, one refuted.

Severity is assigned on what an actor can actually do **against the system as merged**. P1-13 ships
no business endpoints, so several findings are real defects whose impact is latent until P1-14
builds on the foundation; those are marked as such rather than inflated or dismissed.

## 2. Findings

**Zero unresolved Critical. Zero unresolved High.**

### ADV-01 — Medium — the layering gate matches alias imports only

**Where:** `scripts/check-module-boundaries.mjs` rules B4/B5; `eslint.config.mjs`.

B4 tests the raw import specifier against `^@/server/(db|events|audit|worker)`. A relative
specifier resolving to the same module is not matched, and ESLint's `no-restricted-imports` does not
mention `@/server/db` at all.

**Confirmed by execution.** A throwaway fixture with a single route file:

```text
import { withTransaction } from '../../../../server/db/transaction';   → exit 0  (passes)
import { withTransaction } from '@/server/db/transaction';             → exit 1  (B4 violation)
```

**Failure path.** A future route can declare a `defineOperation` literal (satisfying the coverage
gate, which only requires the literal to be present in the file), skip `handleOperation`, import
`withTransaction` and `buildRequestContext` by relative path, and build a context from a
client-supplied tenant id — with no authorization, no entitlement, no audit, and green CI.

**Why Medium and not High.** Nothing in the merged tree does this. Only two routes exist
(`/api/health`, `/api/v1/meta/ping`) and both were checked. There is no external attack path: the
defect is a missing guardrail that would let a _future_ mistake ship, not a live vulnerability.

**Remediation.** Match the resolved path as well as the specifier in B4/B5; add the relative forms
to ESLint for `src/app/**`; assert that each exported HTTP method references `handleOperation`.
**Regression test.** Extend the existing `--scan-dir` failure-proof fixture with a relative-import
case for B4 and B5 and assert a non-zero exit.
**Disposition.** Accepted for P1-13. **Should be closed before P1-14** — it is the guardrail that
makes the phase's authorization claims enforceable rather than conventional.

### ADV-02 — refuted by measurement — suspected per-append cost proportional to chain length

**The concern.** `sel_audit_records_unlinked` adds a `NOT EXISTS` subquery against
`iam.audit_integrity_links` to every read of `iam.audit_records`, including the read
`iam.audit_canonical` performs inside every `iam.audit_append`. On an empty, unanalysed table the
planner chose a **hashed** subplan, which would mean hashing the tenant's entire chain on every
audit write — O(n) per append, O(n²) cumulative.

**Measured, on a seeded tenant with 20,000 chain links, through the deployed runtime login:**

```text
plan at 20,000 links:
  Index Scan using pk_audit_records on audit_records
    Filter: (tenant_id = iam.current_tenant_id())
            AND ((NOT EXISTS(SubPlan 1)) OR iam.has_permission('iam.audit.view'))
    SubPlan 1 -> Index Scan using uq_audit_integrity_links_record on audit_integrity_links
  Execution Time: 0.045 ms

50 × iam.audit_append on an EMPTY chain      : 35.703 ms
50 × iam.audit_append on a 20,000-link chain : 28.517 ms
```

With statistics present the planner uses a **correlated index probe** on the unique index
`uq_audit_integrity_links_record`, not a whole-chain hash. Per-append cost does not grow with chain
length — the longer chain was marginally faster, which is noise. The hashed shape was an artefact of
an unanalysed empty table.

**Disposition.** Not a defect. Recorded with the numbers so the concern is not re-raised without
them.

### ADV-03 — Medium — a direct audit INSERT can forge a readable record and wedge the chain

**Where:** the `GRANT INSERT` on the three `iam.audit_*` tables, `uq_audit_records_tenant_seq`, and
`sel_audit_records_unlinked`.

`iam.audit_append` is `SECURITY INVOKER`, so the caller must hold INSERT on the audit tables; the
grant is unavoidable without a `SECURITY DEFINER` routine, which the project's zero-definer rule
forecloses. Consequently an actor able to execute arbitrary SQL as `app_runtime` can:

1. insert a record with no chain link — permanently matched by `sel_audit_records_unlinked`, and so
   readable by every session of that tenant without `iam.audit.view`; and
2. insert a record squatting the next chain sequence, after which every `iam.audit_append` for that
   tenant fails on `uq_audit_records_tenant_seq`.

**Why Medium.** Both require an existing arbitrary-SQL foothold as `app_runtime` — at which point
the actor can already write anything that role can write. The chain stays tamper-evident:
`iam.audit_verify_chain` reports the orphan, and (2) fails closed rather than extending a chain
already known to be broken, which is the intended behaviour.

**Remediation.** Narrow the writer read to the row written by the current transaction (e.g.
`age(xmin) = 0`), which removes half of this; and/or a `BEFORE INSERT` trigger requiring
`seq = max(chain seq) + 1`.
**Disposition.** Accepted risk, recorded. This is a genuine reduction in audit tamper-evidence from
"unreachable" to "orphan-detectable" and is stated as such rather than absorbed.

### ADV-04 — Medium (latent) — an idempotency replay is not bound to its principal

**Where:** `src/server/http/idempotency.ts` — `readExisting()` matches on
`(tenant_id, operation, idempotency_key)` only, and `withIdempotency()` returns the stored
`response_document` before `execute()` runs.

**Failure path.** Two users of the same tenant, both holding the operation's permission but narrowed
to different companies or branches. User B replays user A's key with the same fingerprint and
receives A's stored response body verbatim — no scope filter, no re-derivation, no re-check against
B's narrowing. Keys are client-chosen and in practice derived from business identifiers, so guessing
is realistic. Secondarily, the same key with a different fingerprint returns `ERR-INT-001` rather
than executing, which is an intra-tenant key-existence oracle.

**Why latent.** P1-13 registers exactly one operation (`meta.ping`) and no idempotent business
command exists yet, so nothing is currently exposed. Cross-tenant replay is impossible — the
uniqueness scope and both policies are keyed on `tenant_id` (verified).

**Remediation.** Bind the reservation to the principal: include `created_by` in the replay lookup,
or treat a foreign actor's replay as a conflict.
**Regression test.** Two contexts, same tenant, different `userId` and narrowing, same key and
fingerprint — the second must not receive the first's document.
**Disposition.** Accepted for P1-13. **Should be closed before P1-14** introduces an idempotent
business command.

### ADV-05 — Medium (latent) — the IP dimension of rate limiting is never populated

`peerAddress` is an optional `RouteOptions` field that no production caller supplies, so
`resolveClientAddress()` returns `{ ip: null }` and every IP-keyed policy would degrade to a single
global bucket. No operation uses IP keying today, so nothing is currently affected. The trusted-proxy
logic itself is correct: the allow-list is empty by default and the right-most untrusted entry is
chosen. **Remediation:** supply the real peer address in the route layer, and make `enforceRateLimit`
refuse an IP-keyed policy when the address is unknown rather than bucketing everyone under `-`.

### ADV-06 — Low — `assertCacheable()` is never called

`cacheCategory` on an operation is an unvalidated `string`, and neither `Cache.set` nor
`getOrLoad` consults `assertCacheable`. The "permanently non-cacheable" categories are a documented
convention, not an enforced control. **Remediation:** type the field as `CacheCategoryName`, validate
it in `defineOperation()`, and require a category on `Cache.set`.

### ADV-07 — Low — the security-event write path is not yet wired, and three comments are stale

`noteDenial()` has no call site anywhere in `src/`, so `iam.security_events` receives nothing at
runtime even though the capability now exists and is proven. Wiring it as written would also not
work: `requirePermissions` throws inside the request transaction, so the insert would roll back with
it — it needs a savepoint or its own transaction. `recordSecurityEvent`'s `catch` swallows the error
but leaves the transaction aborted, so "telemetry never escalates into a request failure" holds only
on the success path. Separately, comments in `security-events.ts` and `authorization.ts` still
describe the pre-remediation world. **Disposition:** accepted; the wiring belongs with P1-14's
authenticated request paths.

### ADV-08 — Low — coverage-gate blind spots

`check-authorization-coverage.mjs` scans `src/app/api/v1/**/route.ts` only. It does not look for
`'use server'` Server Actions, `route.tsx`/`route.js`, or routes outside `/api/v1`
(`src/app/api/health/route.ts` is unregistered — benign, it returns status, version, commit, and
environment only). It also requires the _file_ to contain a `defineOperation(` literal without
checking that the exported methods call `handleOperation`, which is what makes ADV-01 invisible.
**Disposition:** accepted; close together with ADV-01.

### ADV-09 — Low — audit classifications are enforced by TypeScript only

`toDetailEnvelope()` does not validate against `AUDIT_CLASSIFICATIONS` at runtime, so a JavaScript
caller or a parsed payload could still submit an unsupported value and abort the command. No path
was found by which the rejected row's raw values leave the process — `captureException` reads
`error.message`, not the driver's `detail`. **Remediation:** validate in `toDetailEnvelope()` and
throw before issuing SQL.

### ADV-10 — Low (latent) — event-catalog `owner` is documented as enforced but is not

Neither `buildEventEnvelope` nor `publishEvent` compares the catalog entry's `owner` to a publishing
module, and envelope `companyId`/`branchId` are not checked against the context's narrowing — the
outbox `WITH CHECK` tests the tenant only. P1-13 publishes no domain events, so nothing is live.

### Informational

- **I1** `iam.current_tenant_id()` raises on a non-UUID GUC; the comment in `request-context.ts`
  claiming an invalid value is treated as "no context" is wrong. Unreachable in practice.
- **I2** `worker-db.ts` falls back to `DATABASE_URL`, so a misconfigured worker runs as
  `app_runtime`. It fails closed (no EXECUTE on the queue routines) but as a per-poll error rather
  than a startup refusal.
- **I3** An unsupported event schema version is documented as going "straight to dead letter"; it
  actually retries up to the attempt ceiling first.
- **I4** A replayed idempotent response returns 200 with no ETag, so a replayed 201 becomes a 200
  and `recordVersion` is dropped.
- **I5** `/api/health` is unauthenticated and returns commit, version, and environment. Pre-existing
  (P1-01), conventional, noted only because no gate reconciles it.

## 3. Claims that survived the attempt to break them

Recorded because a review that only lists what it found is half a review.

1. **The grant surface.** Exhaustive catalogue check: the only non-SELECT privileges `app_runtime`
   holds in `iam`/`shared` are the six INSERTs; no UPDATE, DELETE, TRUNCATE, REFERENCES, or TRIGGER;
   no application role holds DELETE anywhere; no `BYPASSRLS`; app roles own zero relations; zero
   `SECURITY DEFINER` functions; no USAGE on `extensions`.
2. **Appending is not reading.** A session without `iam.audit.view` reads zero audit rows. A
   _committed_ record cannot be re-exposed: `uq_audit_integrity_links_record` is UNIQUE on
   `audit_record_id` and the runtime holds no UPDATE or DELETE on links, so a link cannot be
   detached. Another session's in-flight record is invisible at any isolation level. The only route
   to a permanently unlinked row is ADV-03.
3. **No RLS recursion or deadlock.** The policy graph is acyclic —
   `sel_audit_integrity_links_chain` does not reference `audit_records` — and the subplan takes no
   additional locks.
4. **Producer/worker separation.** `app_runtime` has no EXECUTE on `claim_outbox_events`,
   `complete_outbox_event`, `fail_outbox_event`, or `audit_verify_chain`; no UPDATE on the outbox;
   and no access to `processed_events` or `error_records`. The all-tenant `wkr_` policy is
   `TO app_worker` only.
5. **Cross-tenant idempotency.** Keyed on `tenant_id`; platform-scope rows unreachable because the
   predicate is NULL. The race path is correct: the losing INSERT blocks on the winner's tuple lock,
   so by the time `23505` is raised the winner has committed.
6. **The error model.** `problemFor` reads the catalog entry plus four whitelisted `safeDetails`
   fields; `message`, `cause`, and `stack` are structurally unreachable from the renderer.
7. **Scope spoofing.** `narrowScope` rejects rather than silently dropping; the account lookup runs
   under a tenant-only bootstrap context with `app.user_id` blanked, so a forged tenant claim finds
   no row. The only way to widen scope is to bypass the pipeline entirely — ADV-01.
8. **Pooled-context leakage.** Every context value uses `set_config(..., true)`; a failed rollback
   destroys the client rather than returning it to the pool.
9. **Pagination.** Clamped to 100 with a total order; a forged cursor yields a bad page, never
   another tenant's rows, because every query still runs under RLS.
10. **Worker double-claim and the dead-letter boundary.** `FOR UPDATE SKIP LOCKED` with the attempt
    counter incremented in the same statement; the TypeScript and SQL ceiling comparisons agree
    exactly, with no off-by-one.
11. **Migration immutability.** Exactly one file added under `supabase/` relative to the Release 2
    baseline tag, and no file modified.

## 4. What this review does not claim

No penetration test was performed and no claim is made about resistance to a determined attacker.
All evidence is from the Local environment; no other environment exists (ADR-012). No production
capacity, throughput, latency, failover, replica, CDN, or load-balancer behaviour is claimed —
P1-OD-027 (NFR-SCL) remains unresolved. This was an owner-authorized technical self-review, not an
independent third-party audit.
