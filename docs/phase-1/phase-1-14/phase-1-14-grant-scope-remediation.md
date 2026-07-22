# Phase 1-14 — Grant-Scope Containment and Operation-Evidence Remediation

**Company:** RootLco — Root Link Company · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Release group:** Release 3 — Backend Foundation · **Date:** 2026-07-22 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)).

> This is the owner reviewing the owner's own work. It is **not** an independent third-party audit,
> a penetration test, or a security certification, and nothing here should be read as one.

---

## 1. Why this remediation exists

The P1-14 owner gate did **not** pass its review. Two blockers were recorded:

1. **Confirmed High — unrestricted-grant scope-containment bypass.** `issueGrant` performed scope
   containment only inside its per-scope loop, so an **empty** scope list — a request for an
   unrestricted, tenant-wide grant — skipped containment entirely. The database policy
   `ins_role_grants_delegable` did not close the gap: it checks permission delegability through
   `iam.has_permission(text)`, which is deliberately **tenant-wide / scope-blind**, so it proves the
   actor holds the role's permissions _somewhere_ in the tenant but not that they may delegate them
   tenant-wide, nor into a company or branch they do not hold. A company- or branch-scoped
   administrator holding `iam.grant.manage` could therefore mint a grant broader than their own
   authority.

2. **Missing application-layer evidence.** The ~39 registered operations had no
   application/API-layer test invoking them through their real service, repository, runtime context,
   authorization, RLS, transaction, audit, and outbox path. OpenAPI registration and unit-only
   metadata tests are not acceptance evidence for the implemented operations.

This record describes the remediation. It composes the P1-13 foundation and the P1-14 feature; it
adds one additive migration and no schema change to any existing table.

## 2. The application-layer fix (Part A)

`src/modules/iam/domain/delegation-policy.ts` and
`src/modules/iam/application/access-administration-service.ts`:

- `GrantFacts` gains `actorScopes: HeldScope[]` — the actor's held scopes at **full granularity**,
  read server-side from `iam.role_grants` / `iam.grant_scopes` via the new
  `AuthorizationRepository.heldScopesOfCaller()`. The flattened company/branch sets alone cannot
  express containment, because a branch scope carries its parent company into the company set;
  membership there does **not** mean the actor holds the whole company.
- `assertUnrestrictedDelegationAllowed(facts)` — an unrestricted (tenant-wide) delegation is allowed
  **only** for an actor who themselves hold tenant-wide authority. A scoped administrator is refused.
- `assertScopeWithinAuthority(facts, scope)` now decides containment with `scopeCovers()`: a company
  scope held covers that company and everything beneath it; a branch scope covers that branch and
  its departments, **not** the company; a department scope covers only itself.
- `issueGrant` splits the two paths explicitly. `normalizeScopes()` coerces `null`/`undefined` and
  removes exact duplicates **before** validation, and an empty/omitted/null list is interpreted as an
  explicit **unrestricted request** — never as "nothing to validate". A single invalid scope throws,
  rolling the whole transaction back so no partial grant commits.
- `organization-settings-service`, `user-administration-service`, and `invitation-service` build
  `GrantFacts` with `actorScopes` too, so the same granular containment applies to company/branch
  settings.

Unit evidence: `tests/foundation/p1-14-authentication-units.test.ts` (47 tests) adds the
unrestricted-delegation refusal and the company/branch/department coverage matrix, including the
branch-scoped-actor-cannot-delegate-company-wide case the old code's own comment warned about.

## 3. The database backstop (Part B)

Migration **`20260727090000_iam_grant_delegation_scope_backstop.sql`** (the 116th) adds, additively:

- `iam.grant_delegation_within_authority(uuid)` — a `STABLE SECURITY INVOKER` predicate, empty
  `search_path`, **no `SECURITY DEFINER`**. It reads only rows the caller may already read under RLS
  (`sel_role_grants_tenant` / `sel_grant_scopes_tenant` are tenant-scoped SELECT), so it cannot see
  another tenant's grants.
- `iam.enforce_grant_delegation_within_authority()` + two **DEFERRABLE INITIALLY DEFERRED**
  constraint triggers, on `iam.role_grants` (INSERT/UPDATE) and `iam.grant_scopes` (INSERT), so the
  grant header and its scope rows — written in separate statements — are validated together at
  COMMIT. It raises SQLSTATE `42501` (the same class a policy denial raises) when the delegation
  exceeds the actor's scope.

The predicate constrains **exactly** the population `ins_role_grants_delegable` constrains: the
non-superuser, NOBYPASSRLS request-path archetype `app_runtime` and its login members. A superuser
or the BYPASSRLS provisioning/admin connection bypasses RLS and this backstop alike — which is what
preserves the bootstrap boundary (the first tenant administrator via `org.provision_organization`,
ADR-008) and the fixture/seed path. `app_runtime` is NOBYPASSRLS in every environment, so the real
request path is always enforced.

The migration is **ROLLBACK-SAFE** (functions + constraint triggers only; no data, no change to any
existing table). Exact rollback is at the foot of the file. `scope_mode` is already immutable and
`tg_grant_scopes_require_scope` already refuses removing the last scope of a scoped active grant, so
the only route to an unrestricted grant is creating one with `scope_mode='unrestricted'` — which the
backstop refuses for a scoped actor.

Migration classification is recorded in
[phase-1-14-migration-classification.md](phase-1-14-migration-classification.md).

## 4. A second defect the evidence layer surfaced — P1-14-R-007 (High)

Building the operation-evidence layer immediately surfaced a latent defect the merged feature never
exercised: **five IAM UPDATE statements set `updated_by` explicitly**, but `app_runtime`'s
column-scoped UPDATE grants exclude `updated_by` (the `shared.touch_row_metadata` trigger sets it).
Under the deployed runtime identity these all failed with _"permission denied for table …"_, making
**session revocation, administrative session-revoke-all, role-permission effect changes, grant
revocation, and approval-limit ending non-functional at runtime**. The fix removes the redundant
explicit `updated_by` (the trigger stamps it) in `identity-repository.ts` (two session revokes) and
`authorization-repository.ts` (role-permission effect, grant revoke, approval-limit end). Proven by
the revocation and stale-version tests in `tests/backend/iam-access-administration.test.ts`.

## 5. Grant-scope security proofs (Part B tests)

`tests/db/p1-14-grant-scope-containment.test.ts` — **20 proofs through the real `app_runtime`
login**: a tenant-wide admin may issue an unrestricted grant; a company- or branch-scoped admin
cannot; company/branch containment (own vs foreign, branch-cannot-go-company-wide); empty-scope path;
mixed allowed/disallowed → whole transaction rolled back; cross-tenant / cross-company scope FK
refusal; require-scope guard; last-scope-removal cannot widen; two concurrent within-authority grants
each keep their scope; a rejected commit leaves no grant or scope; revocation removes authority
immediately.

`tests/backend/iam-access-administration.test.ts` — **16 proofs through the real service**:
the same containment via `issueGrant` (empty/omitted/null/duplicate/mixed), one audit record + one
`access.grant.changed` event per grant (both inside the business transaction), a rejected grant
writes no state/audit/outbox, scope add/remove containment, self-grant and self-approval-limit
refusal, malformed money rejection, cross-tenant grantee not found, immediate revocation effect, and
stale-version optimistic-concurrency conflict.

## 6. Operation-to-test coverage (Part C + the gate)

`scripts/check-operation-test-coverage.mjs` (`npm run validate:operation-coverage`, wired into CI)
reconciles every registered operation against a coverage manifest and **fails** when an operation
has no coverage decision, or when a non-pending evidence claim's test no longer references the
operation id. It writes a machine-readable matrix to
[`evidence/operation-test-matrix.json`](evidence/operation-test-matrix.json).

Current coverage of the **39** registered operations:

| Depth       | Count | What it means                                                                              |
| ----------- | ----- | ------------------------------------------------------------------------------------------ |
| `operation` | 20    | Application service invoked end to end under runtime context/RLS/transaction, with asserts |
| `unit`      | 6     | Decision logic proven at unit level; wired-service integration is a tracked residual (R-8) |
| `pending`   | 13    | No executable evidence yet — a **visible, tracked** residual, not a hidden gap (R-9)       |

`tests/backend/iam-operations.test.ts` adds operation-depth evidence for the read/catalogue surface
(permission/role/role-permission/approval-limit/grant-scope listing, user list/detail/session list,
tenant/company/branch settings read, audit list + detail), with tenant-isolation assertions and a
proof that the privileged audit read is itself audited.

**This remediation does not claim full operation coverage.** The `pending` set — the write side of
role/permission/user/settings administration (R-9) and the wired auth/invitation integration (R-8) —
is listed explicitly in the matrix and carried as a residual. The confirmed-High surface (grant,
scope, approval-limit administration) is covered at `operation` depth; that is the security-critical
part this remediation is responsible for.

## 7. Residual risks introduced or carried

| ID  | Risk                                                                                                                               | Disposition                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| R-8 | The five `/auth/*` operations and the invitation create/cancel/activate operations have unit-depth evidence, not wired integration | Needs a provider-fake backend harness. The verifier, domain policies, and activation-confirmation check are proven at unit depth. |
| R-9 | 13 operations remain `pending` operation-depth evidence (role/permission/user/settings **writes**, approval-limit end)             | Visible in the coverage matrix and enforced by the gate; each is a governed follow-up, not a silent gap.                          |
| R-5 | The database suite intermittency carried from the feature phase                                                                    | Unchanged by this remediation; re-run recorded in the validation evidence. Still Low, still undiagnosed.                          |
| R-3 | No dependency-vulnerability scanning                                                                                               | Unchanged; still not implemented and not claimed.                                                                                 |

## 8. Governance

Nothing reached protected `develop` outside the approved pull-request and hosted-CI flow. The work
was reviewed under the Standing Technical Authorization and Solo Developer Review policies. This is
owner-authorized technical self-review and is never an independent third-party audit. The Phase 1-14
owner gate remains **Pending**; this remediation is offered as a pull request for the owner to merge,
after which the gate may be reconsidered.
