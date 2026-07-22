# Phase 1-14 — Authentication, Session, and Administration Architecture

**Company:** RootLco — Root Link Company · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Release group:** Release 3 — Backend Foundation · **Date:** 2026-07-22 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md) — never an
independent third-party audit).

**Related:** [ADR-019](../../adr/ADR-019-supabase-auth-as-authentication-provider.md) ·
[DBCR-P1-14-001](../../database/change-requests/DBCR-P1-14-001-runtime-administration-write-capabilities.md) ·
[Backend Architecture and Shared Foundation](../../standards/backend-architecture-and-shared-foundation.md) ·
[Event Catalog](../../standards/event-catalog-v0.1.md)

---

## 1. The shape of a request

Phase 1-13 built the pipeline and stopped one step short of authentication, installing an
`UnconfiguredAuthenticator` that returned `null` so every authenticated operation answered
`ERR-IAM-002`. Phase 1-14 fills that seam. The order is unchanged and remains the security design:

```
correlation → rate limit (IP-keyed) → authenticate → resolve context (+ session state)
  → open transaction → authorize → entitlement → rate limit (tenant/user)
  → idempotency → handler → respond
```

What P1-14 adds is the third and fourth steps.

**Authenticate** — `BearerSessionAuthenticator` reads `Authorization: Bearer`, verifies the token
locally, and returns `PrincipalClaims { identityProvider, providerSubject, tenantId, sessionRef }`.
It performs no authorization, reads no permission, and touches no business table.

**Resolve context** — unchanged from P1-13 except for one addition: when the claims carry a
`sessionRef`, the same read-only bootstrap transaction also reads `iam.user_sessions` and refuses a
session that is revoked, hard-expired, or idle-timed-out. All three questions are answered in SQL,
so they use the **database's** clock; comparing a PostgreSQL timestamp against `Date.now()` would
make the idle timeout depend on drift between two machines.

## 2. Why authorization is not in the token

The conventional design puts roles and permissions into the JWT and skips a database round trip.
It is rejected here for one reason that outweighs the saving: **a revoked grant would keep
authorizing until the token expired.** The phase requires revocation to take effect immediately.

So every protected request resolves the principal, the scope, and each declared permission from the
database, inside the request transaction, through `iam.has_permission` and
`iam.has_permission_in_scope`. Nothing is cached — `src/server/cache/eligibility.ts` continues to
refuse to cache anything permission-dependent, and every authenticated response carries
`Cache-Control: no-store, private`.

The measured cost is one indexed function call per declared permission inside a transaction that is
already open. That is the price of the property.

### The tenant binding

`app_metadata.tenant_id` is written by the service role at invitation and is not editable by the end
user. It travels as `PrincipalClaims.tenantId` and is used exactly as P1-13 specified: **a lookup
key**. The account must exist inside that tenant, hold the provider subject the provider just
verified, be `active`, and not be soft-deleted. A forged or stale binding finds no account and is
denied. The token grants nothing on its own.

A unit test asserts that a binding placed in `user_metadata` — which the end user _can_ edit — is
ignored.

## 3. Bearer, not cookie

Credentials are carried in an `Authorization` header, never in an ambient cookie.

That removes CSRF from the threat model by construction rather than mitigating it: a cross-site form
post cannot attach a header, so there is no ambient authority to forge a request with. The phase
requires CSRF controls "where applicable"; with no ambient credential they are not applicable.

The trade is stated plainly: a browser client holding a bearer token in JavaScript is exposed to
XSS in a way an `HttpOnly` cookie is not. No browser client exists — frontend work is explicitly out
of Phase 1 scope — so the decision that matters is the API's, and for an API a bearer token is the
right shape. **The browser session-cookie design, with its SameSite/HttpOnly/Secure and
double-submit machinery, is recorded as an open decision for the phase that introduces a browser
client.** It is not pre-empted here.

`CORS_ALLOWED_ORIGINS` is empty by default, which means same-origin only — the deployed shape today,
since no separate frontend origin exists.

## 4. Token verification

`verifyBearerToken` is strict about the things JWT verifiers are historically lax about:

| Control                 | Behaviour                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Algorithm               | The **allow-list decides**, not the header. `alg: none` and RS256→HS256 confusion both fail before anything is computed.        |
| Unimplemented algorithm | An allow-listed algorithm this build does not implement is **refused loudly**, never accepted. Only HMAC is implemented.        |
| Signature               | Timing-safe comparison, **length-checked first** (`timingSafeEqual` throws on a length mismatch; a signature length is public). |
| `iss` / `aud`           | Both required and matched. An array audience matches if it contains the expected value.                                         |
| `exp`                   | **Required.** A token without one is rejected rather than treated as eternal.                                                   |
| `nbf` / `iat`           | Honoured when present.                                                                                                          |
| Clock skew              | Bounded by `AUTH_CLOCK_SKEW_SECONDS` (0–300, default 60). Unbounded skew turns `exp` into a suggestion.                         |
| Failure detail          | **One reason for every failure.** Naming the failed check is a free oracle for iterating on a forged token.                     |

Verification is offline. A network call per request would make authentication as available as the
provider and as slow as a round trip, for no additional guarantee — revocation is enforced against
`iam.user_sessions`, not against the provider.

## 5. Two things the protected schema will not express

Both are documented rather than worked around, and both were established by reading the live catalog
rather than by inference.

### 5.1 Self-service activation is not expressible

`ins_user_accounts_admin`, `upd_user_accounts_admin`, and `ins_user_status_history_admin` are all
gated on `iam.has_permission('iam.user.manage')`, and `iam.has_permission` returns false unless the
account is `active`. An `invited` account therefore holds **no** permission, and cannot write its own
status. `iam.stamp_user_status_history` additionally overwrites `actor_id` with
`iam.current_user_id()`, so history authorship cannot be delegated either.

Implementing self-activation would require a `SECURITY DEFINER` routine. The platform has **zero**
of those and the invariant is asserted in CI.

**What is implemented instead:** the invitee accepts **in the provider** — which is where the
invitation token lives, and whose single use and lifetime the provider owns. Activation is an
audited administrative action that **asks the provider whether the identity is confirmed and refuses
if it is not**. The invitee's action is a verified precondition, not an assumption. An administrator
cannot activate an account nobody ever accepted.

This is not recorded as a database defect. The capability — onboarding a user — is implementable
securely; it is administrative rather than self-service, which is what the schema was designed for.
Whether self-service onboarding is wanted later is a product decision and is carried as an open
decision.

### 5.2 Automatic account locking is not expressible

Same gate, same reason: the principal failing to authenticate cannot write `iam.user_accounts.status`
or append to `iam.user_status_history`.

**What is implemented instead:** the `auth-adjacent` rate-limit policy (keyed by operation and
client IP, resolved under the trusted-proxy policy so a forged `X-Forwarded-For` cannot buy a fresh
bucket), durable failure rows in `iam.login_audit`, and a **security event** when a principal crosses
`LOGIN_MAX_FAILED_ATTEMPTS` consecutive failures inside `LOGIN_FAILURE_WINDOW_MINUTES`. Lock and
unlock are administrative, at `POST /api/v1/iam/users/{userId}/status`.

This is also the safer control. An automatic persistent lock is itself a denial-of-service
primitive — anyone who knows an address can disable it — which is precisely what the phase's own
"prevent cheap lockout denial-of-service" requirement warns about. Throttling resists brute force
without handing an attacker that lever.

"Consecutive" is expressed as "failures since the last success", so success-reset semantics need no
second counter column to keep in step.

## 6. Delegation and escalation

Every escalation control exists in **two** places, and the database is the authority.

| Control                            | Application (first, readable)               | Database (last line of defence)                       |
| ---------------------------------- | ------------------------------------------- | ----------------------------------------------------- |
| No self-grant                      | `assertNotSelf`                             | `ck_role_grants_no_self_grant`                        |
| No delegating an unheld `allow`    | `assertDelegable`                           | `ins_role_permissions_delegable`                      |
| No escalation via role composition | `assertDelegable` over the role's allow set | `ins_role_grants_delegable`                           |
| No editing a system role           | `assertNotSystemRole`                       | `is_system = false` in all three `roles` policies     |
| No cross-tenant anything           | tenant predicate in every statement         | `tenant_id = iam.current_tenant_id()` in 615 policies |

Two rules exist **only** in the application, and are stated as such rather than implied to be
database-enforced:

- **Last-holder protection.** A policy cannot cheaply count active grants conferring a permission
  across a tenant. The count is taken `FOR UPDATE` inside the command's own transaction, so two
  concurrent revocations cannot both observe a survivor and both proceed.
- **Scope containment across the hierarchy.** A branch is resolved to its company _from the
  database_, never from the request. The composite foreign keys agree, but only after the scope check
  would already have passed on the caller's claimed value.

**Deny is never blocked.** Adding a `deny` mapping, revoking a grant, and ending an approval limit
are reductions in access. Requiring the actor to hold what they are removing would leave permissions
nobody can withdraw — a safety regression wearing a safety control's clothes. The database policies
make the same exemption for the same reason.

## 7. Money, concurrency, and mass assignment

- **Money crosses the boundary as a decimal string** with an ISO-4217 code and stays a string all the
  way to the bound parameter. `iam.approval_limits.amount` is `numeric(18,4)`; parsing it into a
  JavaScript number would round it silently and permanently.
- **Every versioned mutation is `If-Match`-guarded.** Zero affected rows always answers
  `ERR-CON-001`, never "not found" — distinguishing them leaks existence.
- **Mass assignment is prevented by shape, not by filtering.** No service takes a body and applies it
  to a row. Update parameter types name individual fields, and the SQL names individual columns —
  which it must, because `app_runtime` holds narrow column-scoped grants and a wider statement is
  refused at the privilege layer with `42501` before any trigger runs.

## 8. Audit and events

Every privileged operation writes exactly one audit record through `iam.audit_append`, inside the
business transaction, so the record and the change it describes commit together. Action codes come
from the controlled catalog (§9); `entity_type` comes from the catalog entry rather than a literal
repeated at each call site.

Reading the audit trail is itself audited — a reviewer must be able to see who read the record of who
did what — and is bounded: a mandatory date range of at most 92 days, a clamped page size, and a
**fixed filter allow-list** bound as parameters into a fixed statement. There is no expression
language and no dynamic column, because a flexible audit filter is a cross-tenant inference tool.
Export is out of scope and no endpoint offers it.

Four IAM events are published, all inside the producing transaction so an event exists if and only if
its source transaction committed: `access.grant.changed` (EVT-IAM-001, reserved by P1-13 and now
implemented), plus `user.invited`, `user.status.changed`, and `session.revoked` registered through
the catalog's documented process. Payloads carry identifiers only — no address, no token, no link —
because the outbox is drained by an all-tenant worker role.

## 9. Catalog corrections

| Ref  | Finding                                                                                 | Disposition                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PC-1 | `platform.meta.ping` declared by the P1-13 exemplar, absent from `iam.permissions`      | **Application-metadata defect.** The catalog is the authority for what the permission model defines; a code outside it can never evaluate true, so the endpoint answered 403 to everyone. `meta.ping` now declares `org.tenant.read`, which the seed contains and which is semantically exact. The backend harness no longer inserts a `platform`-domain fixture row to paper over it. **No database change.** |
| PC-2 | `permission-catalog-reference.md` listed 19 codes; the seed has 43                      | Regenerated from the executable seed, with a note recording that the seed is the source of truth and this is a rendering of it.                                                                                                                                                                                                                                                                                |
| PC-3 | No audit-action catalog; `auditAction` was a free-form string                           | `src/server/auth/audit-actions.ts` — 26 actions, each with a class and an entity type. `defineOperation()` validates at module load; `check-authorization-coverage.mjs` re-checks from source so a route no test imports still fails CI. Codes are permanent: they land in an append-only hash-chained table.                                                                                                  |
| PC-4 | `identity.*.v1` names unregistered; the `.v1` suffix contradicts the catalog convention | Not used. `access.grant.changed` already reserved the grant-change fact and is now implemented; three further IAM events were registered through the documented process, with the version as a separate integer. `buildEventEnvelope` now **enforces** the catalog's `owner` column, which the P1-13 standard claimed was enforced and was not.                                                                |

## 10. Operator runbooks

**Provider outage.** Authentication fails closed with `ERR-DEP-001` (503, retryable). Existing
sessions continue to work — token verification is local and does not call the provider — so the
blast radius is new logins and password resets, not the whole application. There is no local
fallback credential path and introducing one would defeat ADR-019. Action: confirm the provider's
own status, check `AUTH_JWT_ISSUER`/`AUTH_JWT_SECRET` have not changed under the process, and watch
the `iam.auth-login` error counter for recovery.

**Session-revocation incident.** Revoke every session of the account with
`DELETE /api/v1/iam/users/{userId}/sessions`, then move the account to `locked` or `archived` with
`POST /api/v1/iam/users/{userId}/status` — the status change revokes sessions again and, unlike
revocation alone, removes every permission at the database layer. Revocation is terminal: both
session UPDATE policies carry `revoked_at IS NULL` in `USING`, so a revoked session cannot be
resurrected. Verify with `GET /api/v1/iam/users/{userId}/sessions`.

**Credential and service-role rotation.** The service-role key bypasses RLS and is the highest-value
secret in the system. Rotate it in the provider, update `SUPABASE_SERVICE_ROLE_KEY`, and restart.
Rotating `AUTH_JWT_SECRET` invalidates every outstanding token immediately — that is the intended
effect and it is the fastest global revocation available. Neither value is ever logged; only the
variable _name_ appears in a configuration error.

**Account-lock support.** A user reporting "locked out" is either throttled (recovers on its own
within `LOGIN_FAILURE_WINDOW_MINUTES`) or administratively `locked` (needs
`POST /iam/users/{userId}/status` with `active` and a reason). `GET /api/v1/audit-events` filtered on
`iam.user.locked` distinguishes them. Never confirm to an unauthenticated caller which one it is.

## 11. What is not claimed

- **No production monitoring is provisioned.** Metrics and log fields exist and are exercised in
  tests; alert thresholds are proposed baselines pending measurement. **P1-OD-027 (NFR-SCL) remains
  unresolved** and every numeric limit in this phase is a validation baseline, not an approved
  target.
- **No capacity, throughput, latency, failover, or availability figure is claimed** for
  authentication. None has been measured in any environment beyond Local.
- **No dependency-vulnerability scanning is implemented.** No such control runs in CI and none is
  claimed. This is recorded as a residual risk, not as a completed item.
- **MFA, SSO, SAML, SCIM, and social providers are out of scope** (ADR-019).
  `iam.user_accounts.mfa_required` exists as a column and nothing enforces it.
- **Tenant provisioning and the first tenant administrator remain an owner/operator capability**
  (ADR-008, DBCR-P1-14-001 §5.5). No policy or endpoint added here creates them, and the bootstrap
  boundary was not weakened.

## 12. Governance

Nothing reached protected develop outside the approved pull-request and hosted-CI flow. The work was
reviewed under the Standing Technical Authorization and Solo Developer Review policies. This is
owner-authorized technical self-review and is never an independent third-party audit.
