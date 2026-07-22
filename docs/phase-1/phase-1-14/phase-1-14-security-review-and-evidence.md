# Phase 1-14 — Threat Review and Validation Evidence

**Company:** RootLco — Root Link Company · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Release group:** Release 3 — Backend Foundation · **Date:** 2026-07-22 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)).

> This is the owner reviewing the owner's own work. It is **not** an independent third-party audit,
> a penetration test, or a security certification, and nothing here should be read as one.

---

## 1. Findings raised against this implementation

| ID          | Severity | Finding                                                                                                                                                                                                | Disposition                                                                                                                                                                                                                                                                                                                                            |
| ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1-14-R-001 | Medium   | `POST /auth/logout` required `iam.user.read`, so a principal holding no administrative grant could sign **in** and could not sign **out**. Being unable to end your own session is a security problem. | **Fixed before submission.** The operation is now `public` with the bearer token as its authority: the service verifies the token, takes tenant and subject from the verified claims, and revokes exactly the session that token carries.                                                                                                              |
| P1-14-R-002 | Medium   | The Event Catalog standard stated the `owner` column was "enforced, not documentary". It was not: `buildEventEnvelope` never checked it, so any module could publish any registered event.             | **Fixed.** The producer's leading dot-segment must equal the catalog owner. A regression test asserts `crm` cannot publish `access.grant.changed`. A security-shaped claim with no code behind it is worse than no claim.                                                                                                                              |
| P1-14-R-003 | Medium   | `platform.meta.ping` was declared by the P1-13 exemplar and is absent from `iam.permissions`, so `iam.has_permission` returned false for everyone and the reference endpoint answered 403 permanently. | **Fixed** (PC-1). The operation declares `org.tenant.read`. The backend harness no longer inserts a `platform`-domain fixture row that had been masking the defect.                                                                                                                                                                                    |
| P1-14-R-004 | Low      | `GET /auth/session` requires `iam.user.read`, so a principal without it cannot read their own session description.                                                                                     | **Accepted.** Unlike logout, this is a read of derived information rather than a control action, and a principal in that position can still authenticate and still log out. Fixing it properly needs a platform baseline permission held by every active account — a seed decision, deliberately not taken unilaterally. Recorded as an open decision. |
| P1-14-R-005 | Low      | `effectivePermissionsOfCaller()` evaluates `iam.has_permission` once per catalogued code (43 today) and runs on every administrative write via `delegationFacts()`.                                    | **Accepted, recorded.** Correctness first: the database is the authority for deny precedence and validity windows, and caching the answer is exactly what the phase forbids. It is not on any read path. No capacity claim is made either way.                                                                                                         |
| P1-14-R-006 | Low      | A successful provider authentication whose subject has no active RootLco account leaves a live provider session that authorizes nothing here.                                                          | **Accepted.** The token is refused by the authenticator on every subsequent request (no account → `ERR-IAM-002`), so it grants nothing. Revoking it would tell the caller their credentials were correct, which is the enumeration signal login exists to withhold.                                                                                    |

**No unresolved Critical or High finding exists in this implementation.**

## 2. Attack surface reviewed

Each row states what was reviewed and where the control lives. "Tested" means a named test asserts it.

| Attack                                       | Control                                                                                                                                                                                                                                              | Tested    |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| Credential stuffing / brute force / spraying | `auth-adjacent` rate limit keyed by operation + client IP, before authentication; durable failure evidence; threshold security event                                                                                                                 | ✓         |
| Account and tenant enumeration               | One generic `ERR-IAM-002` for unknown tenant, unknown address, wrong password, unconfirmed, disabled, invited, locked, archived, tenant mismatch; the provider is called even when no local account exists, so failure latency does not depend on it | ✓         |
| Lockout denial-of-service                    | No automatic persistent lock exists — deliberately. Throttling is the control; lock is administrative                                                                                                                                                | ✓         |
| Reset-token theft / replay                   | Provider-owned, single-use, time-bounded; consumed on first use; all other sessions revoked on completion                                                                                                                                            | ✓         |
| Open redirect                                | Exact match against `AUTH_REDIRECT_ALLOWLIST`; **empty list permits nothing**; prefix matching explicitly not used                                                                                                                                   | ✓         |
| Invitation hijacking / replay                | Provider-owned token; duplicate address is a deterministic `ERR-RES-002`; cancel archives terminally and disables the provider identity                                                                                                              | ✓         |
| Session fixation / theft                     | Session reference comes from the provider's own session id, never invented; revocation is terminal (`revoked_at IS NULL` in `USING`)                                                                                                                 | ✓         |
| Refresh-token replay                         | Single use — the old token is consumed by the exchange                                                                                                                                                                                               | ✓         |
| Session revocation failure                   | Enforced in context resolution on every request, in the same read-only transaction, using the database clock                                                                                                                                         | ✓         |
| Idle-timeout bypass                          | Server-side, database clock, `SESSION_IDLE_TIMEOUT_MINUTES`; activity refresh is throttled and cannot fail a request                                                                                                                                 | ✓         |
| `alg: none`, algorithm confusion             | Verifier's allow-list decides the algorithm; an allow-listed but unimplemented algorithm is refused loudly                                                                                                                                           | ✓         |
| Invalid issuer / audience / expiry / key     | All required and checked; `exp` mandatory; bounded skew; timing-safe, length-checked signature comparison                                                                                                                                            | ✓         |
| Stale authorization claims                   | Nothing authorization-bearing is in the token; every permission is re-evaluated per request                                                                                                                                                          | ✓         |
| Client scope spoofing                        | `narrowScope()` rejects any company or branch the caller does not hold; scope is never read from a body                                                                                                                                              | ✓ (P1-13) |
| Horizontal / vertical / self-escalation      | `assertNotSelf`, `assertDelegable`, `assertScopeWithinAuthority` — and the same rules again in RLS                                                                                                                                                   | ✓         |
| Role-composition escalation                  | The actor must hold every allow-permission the role confers; `ins_role_grants_delegable` agrees                                                                                                                                                      | ✓         |
| Last-administrator removal                   | Holder count taken `FOR UPDATE` inside the command's transaction                                                                                                                                                                                     | ✓         |
| Approval-limit escalation                    | No self-limit; exactly one subject; EXCLUDE constraints refuse overlapping windows; amount and currency immutable                                                                                                                                    | ✓         |
| Mass assignment                              | Prevented by parameter shape and by column-scoped grants, not by filtering                                                                                                                                                                           | ✓         |
| IDOR                                         | Every statement carries a tenant predicate **and** runs under RLS; not-found and out-of-scope are indistinguishable                                                                                                                                  | ✓         |
| CSRF                                         | Not applicable: bearer tokens, no ambient credential                                                                                                                                                                                                 | n/a       |
| CORS misconfiguration                        | `CORS_ALLOWED_ORIGINS` empty by default (same-origin only)                                                                                                                                                                                           | —         |
| Forged proxy headers                         | Forwarded headers read only from a configured trusted peer; empty allow-list by default                                                                                                                                                              | ✓ (P1-13) |
| Rate-limit bypass                            | Length-prefixed keys; trusted-proxy IP resolution                                                                                                                                                                                                    | ✓ (P1-13) |
| Sensitive data in logs / errors              | Redaction of token/password/cookie/authorization families; validation errors carry path + rule code, never values                                                                                                                                    | ✓         |
| Service-role exposure                        | Server-only via `serverEnv()`; `security:browser-secrets` scans tracked files                                                                                                                                                                        | ✓         |
| Audit-view abuse / pagination scraping       | Mandatory bounded date range (≤92 days), clamped page size, fixed filter allow-list, privileged reads audited                                                                                                                                        | ✓         |
| Timing side channels                         | Timing-safe signature comparison; provider always called on login                                                                                                                                                                                    | partial   |
| Replay after disablement                     | Status change revokes every session in the same transaction and removes every permission at the database layer                                                                                                                                       | ✓         |
| Grant/revoke races                           | `FOR UPDATE` on the rows the decision depends on; optimistic concurrency on every versioned mutation                                                                                                                                                 | ✓         |
| Idempotency abuse                            | Fingerprint binds tenant + principal + method + path + canonical body                                                                                                                                                                                | ✓ (P1-13) |
| Authorization-cache staleness                | Nothing is cached; `Cache-Control: no-store, private` on every authenticated response                                                                                                                                                                | ✓         |
| Provider outage / partial failure            | Fails closed with `ERR-DEP-001`; local verification means existing sessions are unaffected                                                                                                                                                           | ✓         |
| Notification side channels                   | The RootLco notification contract is **not** called; the provider sends the invitation mail                                                                                                                                                          | n/a       |
| Dependency vulnerabilities                   | **No control is implemented.** No scanner runs in CI and none is claimed. Residual risk R-3.                                                                                                                                                         | ✗         |

"partial" for timing side channels is honest: the two structural sources are addressed (constant-time
signature comparison, provider always called). No statistical timing analysis was performed and none
is claimed.

## 3. Validation — commands and exit codes

Run against the local Supabase stack (PostgreSQL 17) on the merged protected schema
(115 migrations, no migration added or changed by this branch).

| Command                                   | Exit                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- |
| `npm run typecheck`                       | 0                                                                                           |
| `npm run lint`                            | 0                                                                                           |
| `npm run format:check`                    | 0                                                                                           |
| `npm run style:check`                     | 0                                                                                           |
| `npm run validate:module-boundaries`      | 0 — 107 files, no violation                                                                 |
| `npm run validate:authorization-coverage` | 0 — **39 operations**, 29 route files                                                       |
| `npm run validate:openapi`                | 0 — 29 paths, 39 operations                                                                 |
| `npm run validate:canonical-docs`         | 0                                                                                           |
| `npm run security:all`                    | 0 — 836 tracked files                                                                       |
| `npm run test`                            | 0 — 24 files, **354 tests**                                                                 |
| `npm run test:backend`                    | 0 — 8 files, **69 tests**                                                                   |
| `npm run test:db`                         | 0 — 121 files, **1248 tests** — but see §3.1: 1 of 3 runs failed one unidentified assertion |
| `npm run build`                           | 0 — 28 API routes emitted                                                                   |

### 3.1 Two transient failures, recorded rather than hidden

Both are recorded because a run that failed once is a fact about this validation, and quietly
re-running until green is how a flaky suite becomes an invisible one.

**Unit suite — worker IPC fault.** The first `npm run test` of the final pass aborted with
`Serialized Error: { code: 'ERR_IPC_CHANNEL_CLOSED' }` — a Vitest worker-IPC fault, not a test
assertion. The immediate re-run passed all 354. No cause was identified, so none is claimed. It is
unrelated to the assertions in this phase, all of which are deterministic and none of which touch
IPC.

**Database suite — one unidentified failing assertion.** Three full `npm run test:db` runs were
executed on this branch:

| Run | Result                                        |
| --- | --------------------------------------------- |
| 1   | 121 files, **1248 passed**, exit 0            |
| 2   | 121 files, **1 failed / 1247 passed**, exit 1 |
| 3   | 121 files, **1248 passed**, exit 0            |

**Run 2's failing test was not identified.** The console output was not captured before the summary
scrolled, and the two subsequent runs did not reproduce it — so there is no evidence to name a test,
and none is named. Stating "it was the known outbox flake" would be a guess presented as a finding,
which is worse than admitting the gap.

What can be said: the suite is deterministic in its assertions, the same 1248 tests passed in the
runs either side of it, and a pre-existing intermittent `shared-event-outbox` assertion is already
recorded as unresolved in §6a of the remediation evidence. Whether run 2 was that flake or another
is **unknown**. The correct disposition is to capture per-file output on the next failure rather
than to close this on an assumption; that is recorded as residual risk R-5.

## 4. Residual risks

| ID  | Risk                                                                                                                                                                                                                  | Why it is accepted                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-1 | `ip_hash` / `user_agent_hash` are SHA-256 with no key. For an IPv4 address the space is small enough to enumerate.                                                                                                    | **Pseudonymisation, not anonymisation** — stated plainly in the code. The column contract asks for a hash and storing the raw value would be worse. Keying it would need a key-management decision this phase does not own.                                                                                                                                                                                            |
| R-2 | A browser client holding a bearer token in JavaScript is XSS-exposed in a way an `HttpOnly` cookie is not.                                                                                                            | No browser client exists; frontend is out of Phase 1 scope. The cookie/CSRF design is an explicit open decision for the phase that introduces one.                                                                                                                                                                                                                                                                     |
| R-3 | No dependency-vulnerability scanning runs anywhere in the pipeline.                                                                                                                                                   | Out of scope for this phase and **not claimed as implemented**. Adding one is a CI decision with its own governance.                                                                                                                                                                                                                                                                                                   |
| R-4 | No real-provider integration test runs in CI.                                                                                                                                                                         | ADR-019 requires CI to run without provider credentials. The fake mints real JWTs verified by the real verifier, so the verification path is genuinely exercised; the SDK call shapes are not.                                                                                                                                                                                                                         |
| R-5 | The database suite is not reliably green run-to-run: one of three full runs on this branch failed a single assertion that was **not identified**, and a pre-existing `shared-event-outbox` flake remains undiagnosed. | Carried forward as an open defect, not closed on an assumption. Whether the two are the same thing is unknown. The next occurrence must have its per-file output captured before anything is concluded. Hosted CI builds a fresh database per run and executes the same files in the same parallel mode, so it can occur there; if it does, the run is re-triggered and the recurrence recorded, never explained away. |
| R-6 | Every numeric limit in this phase is a proposed validation baseline.                                                                                                                                                  | **P1-OD-027 (NFR-SCL) is unresolved.** No load evidence exists in any environment beyond Local.                                                                                                                                                                                                                                                                                                                        |

## 5. Open decisions carried

| Ref                       | Decision                                                                                                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH-PROVIDER`           | **Closed** by ADR-019.                                                                                                                                                                  |
| `AUTH-SESSION-TRANSPORT`  | **New.** Bearer today; whether a browser client uses a session cookie, and the CSRF machinery that implies, belongs to the phase that introduces one.                                   |
| `IAM-SELF-ONBOARDING`     | **New.** Whether self-service invitation acceptance is wanted. It is not expressible against the current schema and would need a controlled change request.                             |
| `IAM-BASELINE-PERMISSION` | **New.** Whether every active account should hold a baseline permission so self-directed reads such as `GET /auth/session` are reachable without an administrative grant (P1-14-R-004). |
| P1-OD-027 (NFR-SCL)       | **Unresolved.** Every limit here is a baseline pending measurement.                                                                                                                     |

## 6. Governance

Nothing reached protected develop outside the approved pull-request and hosted-CI flow. The work was
reviewed under the Standing Technical Authorization and Solo Developer Review policies. This is
owner-authorized technical self-review and is never an independent third-party audit. The Phase 1-14
owner gate remains **Pending**.
