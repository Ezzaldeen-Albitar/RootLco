# PRE-P1-29 — Wave B control-plane refutation register

**Classification:** Confidential — Commercial Product and Pilot Planning

---

## 1. What this document is

The first Wave B control-plane design is formally **REJECTED**. A bounded adversarial pass
produced twelve confirmed findings against it. This register freezes all twelve — not the three
headline problems — and gives each one a disposition that the second-pass design
([wave-b-control-plane-design-v2.md](wave-b-control-plane-design-v2.md)) must discharge.

It also records **eight further findings that the second pass produced while writing the
dispositions**. Those are numbered `N-1` … `N-8`. They exist because the first pass reasoned at the
function level and this one reasoned along the whole privilege path, which is what §9 of the
directive asked for. Three of them change the answer: `N-1` and `N-4` together force the database
role model, and `N-2` says the repository's own coverage gate cannot see the role that results.

Every claim below was measured against the working tree at `fe81f3eb`
(`origin/develop` = `origin/HEAD` of the branch this was written from), migrations 124.

### Lane verdicts carried forward

| Lane                       | Verdict                                                       |
| -------------------------- | ------------------------------------------------------------- |
| Control-plane authority    | **REJECTED** — twelve confirmed findings, frozen below        |
| Org operation surface      | **REQUIRES REVISION** — depends on the authority model        |
| Bootstrap and provisioning | **REQUIRES REVISION** — C1, C3, C4 and C5 all land here       |
| Company-Owner scoping      | **SURVIVED** — all seven adversarial concerns refuted; see §4 |

---

## 2. Evidence method, and one thing it changed

Every row carries `path:line`. Where a row states an **absence**, it was verified twice by
different means, because a search that fails silently returns zero and zero reads as absence. The
gap register already records one instance of exactly that (a Git revision-and-path argument
rewritten by the shell, piped into a counter that reported zero —
[gap-register.md:26-33](gap-register.md)).

Two absence claims in this register are load-bearing and were checked both ways:

| Absence claimed                                             | Method 1                                                        | Method 2                                                              | Result |
| ----------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------- | ------ |
| No `UPDATE` or `DELETE` privilege exists on any audit table | pattern search for a grant of either action on the three tables | read the "deliberately absent" block, `20260725090000:378-400`        | Absent |
| No operation identifier begins `org.`                       | search for `id: 'org.` across `apps/api/src`                    | enumerate all 305 `= defineOperation({` sites and read their prefixes | Absent |

---

## 3. The twelve findings

### C1 — `EXECUTE` on the audit writer is not enough

|                          |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**               | **CONFIRMED**, and worse than stated                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Original claim**       | Granting `EXECUTE` on `iam.audit_append` lets the control-plane principal write its audit trail.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Evidence**             | The writer is `SECURITY INVOKER` ([`20260725090000_iam_shared_runtime_write_capabilities.sql:156-171`](../../../supabase/migrations/20260725090000_iam_shared_runtime_write_capabilities.sql)). Its three inserts target `iam.audit_records` (`:199`), `iam.audit_record_details` (`:206`) and `iam.audit_integrity_links` (`:232`). The privileges those need are granted **to `app_runtime` only** (`:260-262`), and each is gated by a policy `TO app_runtime` with `WITH CHECK (tenant_id = iam.current_tenant_id())` (`:264-272`). It also reads back the row it just wrote, and names that requirement itself: it raises `insufficient_privilege` with the text _"the caller lacks the writer-scoped SELECT path on `iam.audit_records`"_ (`:224-227`). |
| **Why the claim failed** | It reasoned about one privilege on one function. `SECURITY INVOKER` means the caller's own privileges apply to everything the body touches — three inserts, one read-back, and the row-level policies on all four.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Consequence**          | The most privileged path in the product would be unable to write a single audit event, and would discover that at run time.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **V2 disposition**       | **FIXED IN DESIGN.** §7 of the design enumerates the full audit privilege path for the platform role: three `INSERT` grants, three insert policies, and the two read-back select policies, each written for the new role and each predicated on the target tenant. No `UPDATE`, no `DELETE`, no committed-history read.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Proof required**       | As the platform role, append an event and read it back; then attempt an update and a delete of a committed audit row and be refused. Remove any one of the three insert policies and the append must fail for that exact privilege reason.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### C2 — a platform authority reader would have denied itself

|                          |                                                                                                                                                                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**               | **CONFIRMED**                                                                                                                                                                                                                                                                      |
| **Original claim**       | A new `org.has_platform_authority` helper reads three new platform tables.                                                                                                                                                                                                         |
| **Evidence**             | The design granted nothing on those tables. Every application table must enable row-level security and must force it: [`scripts/ci/rls-matrix.mjs:208-217`](../../../scripts/ci/rls-matrix.mjs), and the exemption map is `FORCE_RLS_EXEMPT = {}` at `:104` — empty, deliberately. |
| **Why the claim failed** | A forced table with no grant and no policy denies every non-bypassing role, including the one the design invented.                                                                                                                                                                 |
| **Consequence**          | The authority check answers "no" to everything. The control plane is dead on arrival, and the failure looks like a correct denial.                                                                                                                                                 |
| **V2 disposition**       | **FIXED IN DESIGN**, and reduced. §5 of the design adds **one** relation, not three, and specifies its grant, its policies and its readers explicitly.                                                                                                                             |
| **Proof required**       | A real platform operator's authority check returns true; a tenant user's returns false; removing the select policy makes the operator's check fail rather than silently answer false.                                                                                              |

### C3 — the delegation backstop refuses the caller, and the original proof was vacuous

|                          |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**               | **CONFIRMED as an obstacle**, but the mechanism was misdiagnosed — see `N-1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Original claim**       | Bootstrap can call the delegation backstop; a red test proves the guard.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Evidence**             | `iam.grant_delegation_within_authority(uuid)` has `EXECUTE` revoked from `PUBLIC` and granted **only** to `app_runtime` ([`20260727090000_iam_grant_delegation_scope_backstop.sql:197-200`](../../../supabase/migrations/20260727090000_iam_grant_delegation_scope_backstop.sql)). It is reached through a deferred constraint trigger, so it is invoked as the writing role.                                                                                                                                                                                                |
| **Why the claim failed** | A role that is not `app_runtime` raises `insufficient_privilege` at the call, before any logic runs — and the prescribed red test passed whether the feature was present or not.                                                                                                                                                                                                                                                                                                                                                                                             |
| **Consequence**          | Bootstrap aborts at commit, and the test that was supposed to catch it could not.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **V2 disposition**       | **FIXED IN DESIGN, with a correction.** The function's body carries three early exits (`:100-122`): a bypassing role, a caller that is **not a member of `app_runtime`**, and an absent acting principal. A dedicated platform role satisfies the second. So granting it `EXECUTE` makes the call succeed — and makes the backstop **vacuous for that role**, by the function's own design. The design therefore grants the execute privilege _and_ states plainly that the backstop is not the platform path's containment. Containment is §9's bootstrap-window predicate. |
| **Proof required**       | Two proofs, because one is not enough here. (a) Remove the execute grant → bootstrap fails with `insufficient_privilege` naming the function. (b) Remove the bootstrap-window predicate → bootstrap succeeds against a tenant that is already live, which is the escalation the backstop does **not** catch for this role. A test that only does (a) is the vacuous proof again in a new place.                                                                                                                                                                              |

### C4 — the provisioning path depended on rows the caller could not read

|                          |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**               | **CONFIRMED**, and it extends further than the finding said                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Original claim**       | A provisioning-window predicate gates the bootstrap.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Evidence**             | `org.tenants` forces row-level security ([`20260717101000_org_tenants.sql:238`](../../../supabase/migrations/20260717101000_org_tenants.sql)). `org.provision_organization` is `SECURITY INVOKER`, has `EXECUTE` revoked from `PUBLIC` and is **granted to no application role** ([`20260717107000_org_provisioning.sql:84-91`, `:281-282`](../../../supabase/migrations/20260717107000_org_provisioning.sql)). It writes ten tables (`:132`, `:142`, `:158`, `:172`, `:187`, `:204`, `:214`, `:226`, `:242`, `:270`).                                                                                                              |
| **Why the claim failed** | A predicate that reads rows the role cannot select is not a gate; it is a denial. And the finding stopped at `org.tenants` — the tenth write is `shared.idempotency_keys`, whose only policies are `TO app_runtime` and read `tenant_id = iam.current_tenant_id()`; the provisioning key is written with a **tenant that is deliberately absent** (`:270-272`), so the predicate is never true for it. The migration says so itself: _"Platform-scope rows … remain out of reach: the predicate is NULL for them"_ ([`20260725090000:355`](../../../supabase/migrations/20260725090000_iam_shared_runtime_write_capabilities.sql)). |
| **Consequence**          | Provisioning and bootstrap both fail closed, and the replay protection that makes provisioning safe to retry is the part that fails.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **V2 disposition**       | **FIXED IN DESIGN.** §6 grants the platform role `EXECUTE` on the provisioning function, `SELECT`/`INSERT` on `shared.idempotency_keys` under two new policies scoped to **platform rows only** (the tenant column absent, and the operation name fixed), and the exact table privileges the ten writes need. §9 defines the bootstrap window as `org.tenants.status = 'provisioning'`, which is a state the provisioning function itself writes (`:142`) and which exactly one legal transition leaves (`:211-216`).                                                                                                               |
| **Proof required**       | Provision as the platform role and succeed; replay the same key with the same request and create nothing; replay with a different request and be refused; remove the platform policy on the replay table and watch provisioning fail rather than silently duplicate.                                                                                                                                                                                                                                                                                                                                                                |

### C5 — a client-supplied actor, reintroduced

|                          |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**               | **CONFIRMED**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Original claim**       | Passing an actor identifier into the database function solves actor attribution.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Evidence**             | `org.provision_organization` derives its actor as `COALESCE(iam.current_user_id(), (p_spec ->> 'actor_id')::uuid)` ([`20260717107000:121`](../../../supabase/migrations/20260717107000_org_provisioning.sql)), and `org.change_tenant_status` does the same with `p_actor_id` ([`20260717101000:193-197`](../../../supabase/migrations/20260717101000_org_tenants.sql)). The first-pass design left the session actor empty, which promotes the fallback to the only source.                      |
| **Why the claim failed** | With the session actor empty, the request document becomes the authority on who acted. That is the shape the platform exists to remove.                                                                                                                                                                                                                                                                                                                                                           |
| **Consequence**          | The audit trail of the highest-authority path in the product would record whatever the caller typed.                                                                                                                                                                                                                                                                                                                                                                                              |
| **V2 disposition**       | **FIXED IN DESIGN.** §8 of the design binds the actor from the authenticated platform session on the server, never from the request document, and it does so in the shape the repository already prefers: `org.change_branch_status` takes **no actor parameter at all** ([`20260717103000:293-298`](../../../supabase/migrations/20260717103000_org_companies_branches.sql)), which is why the new company transition is modelled on the branch function rather than the tenant one — see `N-8`. |
| **Proof required**       | Send a forged actor identifier in the request document; the recorded actor is the authenticated platform principal and the forged value appears nowhere.                                                                                                                                                                                                                                                                                                                                          |

### C6 — the fail-closed registry rule must not be relaxed

|                          |                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**               | **CONFIRMED**                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Original claim**       | The operation registry guard can be relaxed so a control-plane operation may declare no permission codes.                                                                                                                                                                                                                                                                                                                                                                  |
| **Evidence**             | Registration refuses a non-public operation with no codes: [`apps/api/src/server/auth/operation-registry.ts:135-141`](../../../apps/api/src/server/auth/operation-registry.ts). **Nothing downstream repeats that check** — `evaluatePermissions` iterates the declared codes and returns allowed when the list is empty, because an empty conjunction is true ([`apps/api/src/server/auth/authorization.ts:92-124`](../../../apps/api/src/server/auth/authorization.ts)). |
| **Why the claim failed** | The registry guard is not one of two defences. It is the only one. Relaxing it converts "unreachable state" into "allowed".                                                                                                                                                                                                                                                                                                                                                |
| **Consequence**          | A control-plane operation with no declared authority would be authorized by construction.                                                                                                                                                                                                                                                                                                                                                                                  |
| **V2 disposition**       | **FIXED IN DESIGN.** The guard is untouched. §4 of the design gives platform operations real permission codes in the canonical catalogue, so they satisfy the existing rule rather than needing an exception to it.                                                                                                                                                                                                                                                        |
| **Proof required**       | Attempt to register a non-public operation with no codes and be refused; the existing registration test must still fail if the guard is deleted.                                                                                                                                                                                                                                                                                                                           |

### C7 — the control-plane route had no rate limit

|                          |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**               | **CONFIRMED**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Original claim**       | The control-plane operation is throttled.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Evidence**             | `policyFor` returns a non-public operation's declaration verbatim: `if (!operation.public) return declared;` ([`apps/api/src/server/http/route-handler.ts:151-159`](../../../apps/api/src/server/http/route-handler.ts)). The declaration field is optional ([`operation-registry.ts:81`](../../../apps/api/src/server/auth/operation-registry.ts)), so absent means unthrottled. Of the five catalogued policies, only `auth-adjacent` is both keyed without a session and marked security-relevant — 10 per minute, keyed by operation and client address ([`apps/api/src/server/http/rate-limit.ts:130-139`](../../../apps/api/src/server/http/rate-limit.ts)); the other four key on tenant or user (`:140-186`). |
| **Why the claim failed** | A control-plane operation runs before a tenant exists, so a tenant-keyed policy has no key material, and declaring nothing at all is silent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Consequence**          | The highest-authority route in the product, unthrottled, with no security signal on breach.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **V2 disposition**       | **FIXED IN DESIGN BY REUSE.** §10 reuses `auth-adjacent` unchanged. It is not merely adequate: it is the only catalogued policy whose key material exists before a tenant does, and its security-relevant flag is the property a control-plane breach needs. **No fifth policy is added** — the catalogue is pinned by four test files, and a new name with the same semantics would be cost without benefit.                                                                                                                                                                                                                                                                                                         |
| **Proof required**       | The platform operation resolves a policy that is present; repeated calls reach the refusal; tenant policies are unchanged; deleting the declaration turns a test red rather than passing quietly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### C8 — a malformed identifier could reach the database

|                          |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**               | **CONFIRMED as a risk, already solved by an existing convention**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Original claim**       | A malformed target identifier cannot reach a cast.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Evidence**             | Request context validates every identifier it carries ([`apps/api/src/server/context/request-context.ts:65-101`](../../../apps/api/src/server/context/request-context.ts)) — but those are the **principal's** identifiers, not a target named in the route. The context readers cast without a handler (`NULLIF(current_setting(...), '')::uuid`, [`0002_base_schemas.sql:108-152`](../../../supabase/migrations/0002_base_schemas.sql)).                                                                                                                                                                                            |
| **Why the claim failed** | It generalised from the principal path to the target path. A control-plane route addresses a tenant that is not the caller's own, so the target arrives from the address and is not covered by the principal's validation.                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Consequence**          | A database error surfaces where a validation refusal belongs.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **V2 disposition**       | **FIXED IN DESIGN, by following the existing convention rather than adding machinery.** Every route already validates its address parameters with the shared identifier rule — for example [`apps/api/src/app/api/v1/vehicles/[vehicleId]/route.ts:44`](../../../apps/api/src/app/api/v1/vehicles/[vehicleId]/route.ts) uses `schemas.uuid` ([`apps/api/src/server/http/validation.ts:194`](../../../apps/api/src/server/http/validation.ts)), and a failure becomes the repository's standard validation refusal (`:61-66`). §11 of the design applies it to every control-plane address parameter, before any context is installed. |
| **Proof required**       | A malformed target identifier produces the standard validation refusal and no database error; a well-formed identifier for a tenant the operator may not reach produces a non-disclosing refusal.                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### C9 — the scope readers fail open, and the tenant reader does not

|                          |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Status**               | **CONFIRMED** — the most severe finding of the first pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Original claim**       | Emptying the company and branch scope settings expresses "this request has no tenant reach".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Evidence**             | Read the source. `iam.current_tenant_id()` is `NULLIF(current_setting('app.tenant_id', true), '')::uuid` and its own comment records that policies comparing against an absent value match no rows — default deny ([`0002_base_schemas.sql:108-115`, `:156`](../../../supabase/migrations/0002_base_schemas.sql)). `iam.allowed_company_ids()` carries the opposite comment in its body: _"NULL means 'no company narrowing was set' (tenant scope only). An empty string is treated the same as unset."_ (`:128-141`, comment at `:135-136`), and `iam.allowed_branch_ids()` is written identically (`:143-153`). |
| **Why the claim failed** | The two readers are asymmetric. An absent tenant **denies**; an absent company or branch list **widens**. The design used the second as if it behaved like the first.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Consequence**          | A platform request that set no narrowing would not be scopeless — it would be unnarrowed, which is the broadest tenant reach the policies can express.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **V2 disposition**       | **FIXED IN DESIGN.** §3 forbids expressing platform authority through the absence of anything, and the request path in §3.2 sets the target tenant **positively** before any tenant-policy evaluation. The asymmetry is written into the threat model at §13 so it cannot be rediscovered.                                                                                                                                                                                                                                                                                                                         |
| **Proof required**       | With a platform request and both narrowing lists empty, a tenant-policy read returns no widened row set. Removing the positive tenant assignment must make the request fail, not succeed broadly.                                                                                                                                                                                                                                                                                                                                                                                                                  |

### C10 — ownership work that already exists

|                          |                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**               | **CONFIRMED**                                                                                                                                                                                                                                                                                                                                                           |
| **Original claim**       | The initiative must add ownership profiles for its branches.                                                                                                                                                                                                                                                                                                            |
| **Evidence**             | They are already on protected `develop`: eight entries in [`.github/ci-baselines/phase-ownership-profiles.json:108-125`](../../../.github/ci-baselines/phase-ownership-profiles.json) and four profiles in [`scripts/ci/check-phase-ownership.mjs`](../../../scripts/ci/check-phase-ownership.mjs) at `:304`, `:372`, `:398`, `:429`. They merged in pull request #255. |
| **Why the claim failed** | It described work already done.                                                                                                                                                                                                                                                                                                                                         |
| **Consequence**          | Duplicate change, and drift between two authorities for one rule.                                                                                                                                                                                                                                                                                                       |
| **V2 disposition**       | **DROPPED FROM WAVE B.** This design branch itself uses one of them — `chore/pre-p1-29-` resolves to the `repository-tooling` profile (`:304-327`), whose allowed buckets are documentation, tooling, tests and root configuration, and which forbids product source and any database change. That is the enforcement of §1's design-only rule.                         |
| **Proof required**       | None. The ownership check passing on this branch is the evidence.                                                                                                                                                                                                                                                                                                       |

### C11 — an unmeasured coverage figure

|                          |                                                                                                                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**               | **CONFIRMED**                                                                                                                                                                                                                                                                                     |
| **Original claim**       | The change is covered by "248 tables × 4 actions" of row-level security checking.                                                                                                                                                                                                                 |
| **Evidence**             | The matrix iterates three roles × four actions over the tables it finds ([`rls-matrix.mjs:81-87`, `:219-221`](../../../scripts/ci/rls-matrix.mjs)). A pull-request run does not see the business schemas at all — the same constraint the CI baseline notes already record for structural totals. |
| **Why the claim failed** | It quoted an arithmetic product as if it were a measurement.                                                                                                                                                                                                                                      |
| **Consequence**          | False assurance, and specifically assurance about the layer this design is most likely to get wrong.                                                                                                                                                                                              |
| **V2 disposition**       | **FIXED IN DESIGN.** No coverage figure appears in the design document unless it was measured, and every figure that does appear names the command that produced it. See also `N-2`, which is the reason this matters more than it looks.                                                         |
| **Proof required**       | Any coverage claim in the final design cites a run, not a product.                                                                                                                                                                                                                                |

### C12 — never edit an applied migration

|                          |                                                                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**               | **CONFIRMED**                                                                                                                                                                                                 |
| **Original claim**       | The bootstrap change can amend an existing migration.                                                                                                                                                         |
| **Evidence**             | Repository rule; the applied count is pinned at [`.github/ci-baselines/schema-baseline.json:6`](../../../.github/ci-baselines/schema-baseline.json) and the replay job re-runs the series from the beginning. |
| **Why the claim failed** | Editing applied history rewrites what every existing environment already ran.                                                                                                                                 |
| **Consequence**          | Environments diverge silently.                                                                                                                                                                                |
| **V2 disposition**       | **FIXED IN DESIGN.** Every database change in the design is additive, numbered above the live count of 124. The design names each new migration and what it may contain.                                      |
| **Proof required**       | The replay job is green, and the pinned count moves by exactly the number of files added.                                                                                                                     |

---

## 4. The lane that survived

**Company-Owner scoping — SURVIVED, subject to integration with the revised platform authority
model.** All seven adversarial concerns against it were refuted. It is not reopened here, and the
control plane's failure is not a reason to reopen it.

Its security premise stands unchanged:

> Company Owner authority is bounded by tenant and company, **and** the target resource is
> validated independently. Submitting another company's company, branch, employee, role or
> membership identifier must not widen the caller's reach.

One integration consequence follows from this register and is recorded rather than designed away:
the containment rule has to be enforced for the specific administration operations PRE-P1-29 uses,
**not** by flipping scoped evaluation for all 170 tenant-scope operations across 136 files. The
short-circuit that makes this a live question is `requiresScopedEvaluation`, which returns false for
a tenant-scope operation whatever target is named
([`authorization.ts:62-65`](../../../apps/api/src/server/auth/authorization.ts)); the reader that
overrides it is `options.forceScoped` (`:103-107`). Wave E adjudicates the general question. Wave B
touches only the operations it introduces.

---

## 5. Findings this second pass produced

These are new. They exist because the dispositions above were written against the whole privilege
path rather than against a single function, and three of them change what Wave B must build.

### N-1 — C5's remedy and C3's path collide, and the collision decides the database role

**Severity: CRITICAL for the design. Resolved in the design; recorded because the resolution is not
obvious and the wrong choice fails at commit time.**

The delegation backstop takes three early exits before it evaluates anything
([`20260727090000:100-122`](../../../supabase/migrations/20260727090000_iam_grant_delegation_scope_backstop.sql)):
a bypassing role returns true; a caller that is **not a member of `app_runtime`** returns true; an
absent acting principal returns true. That produces three candidate designs, and two of them are
dead:

| Candidate             | Shape                                                                                              | Outcome                                                                                                                                                                                                                                                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inherit**           | Platform work runs as `app_runtime`, with the platform principal as the acting principal           | The second exit does not fire. The platform principal holds no account in the tenant being created, so `iam.has_permission` is false, so `ins_role_grants_delegable` refuses the insert before the backstop is even reached ([`20260726090000:370-385`](../../../supabase/migrations/20260726090000_iam_org_runtime_administration_capabilities.sql)). **Dead.** |
| **Inherit, no actor** | Platform work runs as `app_runtime` with the acting principal left absent, so the third exit fires | The backstop is satisfied — but every administration policy is predicated on `iam.has_permission`, which returns false the moment the acting principal is absent ([`20260718097000:86-89`](../../../supabase/migrations/20260718097000_iam_context_and_permission_functions.sql)). Same refusal, one layer earlier. **Dead.**                                    |
| **Separate role**     | A fourth narrow role, not a member of `app_runtime`, with its own policies                         | The second exit fires, so the backstop admits it — and the backstop is therefore **not** its containment. Its containment must be written. **The only live candidate.**                                                                                                                                                                                          |

So the database role question in directive §8 is not a preference. **A fourth archetype is forced**,
because every existing administration write policy is written `TO app_runtime` and predicated on a
tenant-user permission resolution that a platform principal cannot satisfy by construction.

### N-2 — a fourth role is invisible to the repository's own coverage gate

**Severity: HIGH. Must be fixed in the same change that creates the role.**

`RUNTIME_ROLES` in [`scripts/ci/rls-matrix.mjs:81-85`](../../../scripts/ci/rls-matrix.mjs) is a
hard-coded list of exactly three entries. The matrix iterates it (`:219`). A fourth role's grants
would therefore be checked by nothing: the gate that exists to prove no role holds a privilege it
should not would not know the role exists.

This is C11 with teeth. The coverage claim was overstated; the coverage machinery is also
role-blind, and the role Wave B adds is the one whose over-granting matters most.

**Disposition:** the migration that creates the role and the change that teaches the matrix about it
are the same change, and the matrix change ships with a test that fails when the entry is removed.

### N-3 — the request path cannot currently express a request without a tenant

**Severity: HIGH. Design consequence, not a defect.**

`buildRequestContext` requires both a principal user and a principal tenant, and validates both
([`request-context.ts:88-93`](../../../apps/api/src/server/context/request-context.ts)).
`applyContext` unconditionally sets both database settings from them on every transaction
([`transaction.ts:91-105`](../../../apps/api/src/server/db/transaction.ts)).

There is no way, today, to open a transaction that has no tenant. A control-plane operation that
runs before its tenant exists therefore cannot simply omit the tenant — it must either carry a
distinct context type, or carry the **target** tenant positively once the platform layer has
authorized that target. The design chooses the second for everything after provisioning and the
first for provisioning itself, and says why in §3.

### N-4 — platform authority cannot be resolved by the existing permission functions

**Severity: HIGH. Design consequence.**

`iam.has_permission` returns false when either the acting principal or the tenant is absent
([`20260718097000:86-89`](../../../supabase/migrations/20260718097000_iam_context_and_permission_functions.sql)),
and then requires an active, undeleted account for that principal **in that tenant** (`:91-97`).

A platform principal has no account in the tenant it is about to create. So the canonical permission
resolver cannot answer a platform authority question, and must not be bent into answering one. The
design gives platform authority its own resolver over its own relation (§5), and keeps
`iam.has_permission` exactly as it is.

Note what this does **not** mean: the permission _vocabulary_ still lives in the canonical catalogue,
because `iam.permissions` carries no tenant column
([`20260718091000:48-66`](../../../supabase/migrations/20260718091000_iam_roles_and_permissions.sql))
and its code format already admits a `platform.` prefix (`:62-63`).

### N-5 — the replay table's platform rows are unreachable to every policy-bound role

**Severity: MEDIUM. Folded into C4.**

`shared.idempotency_keys` does have a grant and two policies for `app_runtime`
([`20260725090000:345-352`](../../../supabase/migrations/20260725090000_iam_shared_runtime_write_capabilities.sql)) —
the first-pass reading that it had none was wrong. But both policies read
`tenant_id = iam.current_tenant_id()`, and the provisioning key is written with the tenant column
deliberately absent, so the predicate can never be true for it. The migration states this as
intended behaviour (`:355`).

The platform role therefore needs its own pair of policies, and they must be narrow: the tenant
column absent **and** the operation name fixed to the provisioning one, so the platform role cannot
read or write any tenant's replay records.

### N-6 — audit is inherently tenant-contexted, which constrains the whole platform path

**Severity: MEDIUM. Shapes §3 and §7 of the design.**

Every audit insert policy is `WITH CHECK (tenant_id = iam.current_tenant_id())`
([`20260725090000:264-272`](../../../supabase/migrations/20260725090000_iam_shared_runtime_write_capabilities.sql)),
and the writer refuses an absent tenant outright
([`20260725090000:181-183`](../../../supabase/migrations/20260725090000_iam_shared_runtime_write_capabilities.sql)).

An audit event therefore cannot be written outside a tenant context. This is the strongest argument
for the design's choice in §3: after the platform layer has independently authorized a target, the
request installs that exact target's tenant context and works inside it. It is not a convenience —
it is what makes the platform action auditable at all.

### N-7 — there is no organisation module, and the existing reads do not use one

**Severity: MEDIUM. Naming consequence.**

`apps/api/src/modules/` holds nineteen modules and none is named `org`. The three existing
organisation reads are declared under the identity module — `iam.tenant-settings-read`
([`app/api/v1/org/tenant/route.ts:36`](../../../apps/api/src/app/api/v1/org/tenant/route.ts)),
`iam.company-settings-read`
([`app/api/v1/org/companies/[companyId]/settings/route.ts:37`](../../../apps/api/src/app/api/v1/org/companies/[companyId]/settings/route.ts)),
`iam.branch-settings-read`
([`app/api/v1/org/branches/[branchId]/settings/route.ts:33`](../../../apps/api/src/app/api/v1/org/branches/[branchId]/settings/route.ts)) —
and the one status change is declared under the shared module, `shared.branch-status-change`
([`app/api/v1/organization/branches/[branchId]/status/route.ts:47`](../../../apps/api/src/app/api/v1/organization/branches/[branchId]/status/route.ts)).

Directive §22 forbids introducing an `org.` operation prefix for aesthetic consistency. This finding
is the evidence that doing so would also mean a twentieth module. The design's naming matrix (§12)
therefore places new tenant-side organisation operations in the modules that already own their
neighbours, and reserves a new prefix for the platform operations alone — where it carries meaning,
because those operations are outside every tenant.

### N-8 — the two existing status functions disagree about the actor, and only one is C5-safe

**Severity: LOW, but it decides the shape of the company transition.**

`org.change_tenant_status` accepts `p_actor_id` and falls back to it
([`20260717101000:172-178`, `:193-197`](../../../supabase/migrations/20260717101000_org_tenants.sql)).
`org.change_branch_status` accepts **no actor parameter at all**
([`20260717103000:293-298`](../../../supabase/migrations/20260717103000_org_companies_branches.sql)).

The branch shape is the one that cannot be handed a forged actor. The new company transition
function is modelled on it. Where the tenant function must be called by the platform path, the
design forbids binding its actor parameter from the request and requires the acting principal to be
established in context instead.

---

## 6. Disposition summary

| Finding | Status                         | Disposition                                      | Design section |
| ------- | ------------------------------ | ------------------------------------------------ | -------------- |
| C1      | Confirmed                      | Fixed in design                                  | §7             |
| C2      | Confirmed                      | Fixed in design, reduced to one relation         | §5             |
| C3      | Confirmed, mechanism corrected | Fixed in design; backstop is not the containment | §9             |
| C4      | Confirmed, extended            | Fixed in design                                  | §6, §9         |
| C5      | Confirmed                      | Fixed in design                                  | §8             |
| C6      | Confirmed                      | Fixed in design; guard untouched                 | §4             |
| C7      | Confirmed                      | Fixed in design by reuse                         | §10            |
| C8      | Confirmed                      | Fixed in design by existing convention           | §11            |
| C9      | Confirmed                      | Fixed in design; written into the threat model   | §3, §13        |
| C10     | Confirmed                      | Dropped from Wave B                              | —              |
| C11     | Confirmed                      | Fixed in design; see N-2                         | §14            |
| C12     | Confirmed                      | Fixed in design; additive only                   | §15            |
| N-1     | New, critical                  | Resolved: a separate role is forced              | §2, §9         |
| N-2     | New, high                      | Fixed in the same change as the role             | §14            |
| N-3     | New, high                      | Resolved: two context shapes                     | §3             |
| N-4     | New, high                      | Resolved: separate resolver, shared vocabulary   | §4, §5         |
| N-5     | New, medium                    | Folded into C4                                   | §6             |
| N-6     | New, medium                    | Shapes the request path                          | §3, §7         |
| N-7     | New, medium                    | Naming matrix                                    | §12            |
| N-8     | New, low                       | Company transition follows the branch shape      | §8, §12        |

No finding is without a disposition.

---

## 7. The bounded adversarial pass over revision 1

Run 2026-08-22 against the committed design and this register. Six lanes, 39 concerns, 37 agents.
Nineteen concerns were raised `CONFIRMED` at critical or high; each was then handed to an
independent reviewer whose brief was to **refute** it. **Sixteen fell. Three survived**, all high,
none critical.

**Verdict: NO-GO.** Design revision 2 repairs all three; see
[wave-b-control-plane-design-v2.md §22](wave-b-control-plane-design-v2.md).

### Dispositions for C1 to C12

Polarity, stated once because it is easy to invert: **REFUTED means the attack on the disposition
failed — the disposition holds and the design closes the finding.** CONFIRMED means the attack
succeeded and the disposition was inadequate.

| Finding | Attack outcome | What it turned on                                                                                                                                                                                                                                                                                                 |
| ------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1      | **CONFIRMED**  | The disposition granted `EXECUTE` on the writer and stopped. Its three helpers are separately revoked and separately granted. Repaired in design §7.2.                                                                                                                                                            |
| C2      | REFUTED        | The disposition claims only that §5 adds one relation and specifies its grant, policies and readers. It does.                                                                                                                                                                                                     |
| C3      | **CONFIRMED**  | The disposition named one deferred constraint trigger on the grant write; there are two, and the second reads a table the design gave write access to and no read access. Repaired in design §6.3.                                                                                                                |
| C4      | REFUTED        | The ten write privileges are right. The reads enumeration was short, which is a medium finding folded into design §6.2, not a failure of the disposition.                                                                                                                                                         |
| C5      | REFUTED        | Attacked three ways and unbroken. Every citation exact.                                                                                                                                                                                                                                                           |
| C6      | **CONFIRMED**  | The C6 concern itself survives — the registry guard is intact and the empty-conjunction reading is correct — but §4.2 cited §5.3 as the mechanism preventing a tenant role from holding a platform code, and §5.3 governs a different relation. Repaired in design §4.2, which now gives the two real mechanisms. |
| C7      | **CONFIRMED**  | The reuse decision is sound; two clauses of its justification were false. The security-relevant flag is inert for a non-public operation, so the reuse buys key material and not signal. Repaired in design §10.                                                                                                  |
| C8      | REFUTED        | The mapping from a malformed identifier to the standard validation refusal is exact. One inherited mismatch between two validators is recorded in design §11.                                                                                                                                                     |
| C9      | **CONFIRMED**  | The remedy closes the original fail-open — all 650 policies carry a `TO` clause — but the disposition was incomplete. Repaired in design §3 and P-8.                                                                                                                                                              |
| C10     | REFUTED        | The ownership work exists and enforces the design-only rule on this branch.                                                                                                                                                                                                                                       |
| C11     | **CONFIRMED**  | Violated by the sentence carrying it: the coverage rule was honoured, and then the paragraph quoted an unmeasured "180 across 132". Repaired in design §14, which now names the method beside every figure.                                                                                                       |
| C12     | **CONFIRMED**  | Additive-only is real and enforced, and the live count is right two ways — but §15 named two moving baseline values where four move. Repaired in design §15.                                                                                                                                                      |

Five REFUTED, seven CONFIRMED. Note what that does **not** mean: only three of the seven were
blocking. The rest were incomplete dispositions, false supporting clauses, or unmeasured numbers —
real defects in a document whose whole purpose is to be relied on, and repaired as such.

### The three blockers

| #      | Severity | Statement                                                                                                                                                                                                                                                                                                                                                                                           |
| ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B1** | HIGH     | The design enumerated `EXECUTE` one level shallower than the `SECURITY INVOKER` call chains it granted: the writer's three helpers and the context readers four paths depend on were never named. No existing gate would have caught it — the boot preflight probes only the writer, and the coverage matrix tests table privileges only.                                                           |
| **B2** | HIGH     | The authority resolver reads `iam.user_accounts`, and no section granted `app_platform` a select privilege or wrote it a policy. Called from inside a policy expression it would raise rather than answer, making every policy in §6.3 and §6.4 unreachable.                                                                                                                                        |
| **B3** | HIGH     | An unpredicated `UPDATE (status)` on `org.tenants` let the platform role return a live tenant to `provisioning`, reopening the bootstrap window the design names as its containment. Rated critical by the finder and downgraded on review: unreachable over the request surface, requires both platform codes, and `app_platform` is a no-login archetype — so no principal below it can escalate. |

All three fail closed. All three are repaired by additive grant and policy lines plus one
`WITH CHECK`. And all three are the same defect as C1, reappearing inside the fix written to close
it — which is the single most useful thing this pass produced.

### Six confirmed findings that were dropped on review

Recorded because a register that keeps only what survived teaches nothing about how to read one.
"Platform impersonation" (critical) read a condition in §9.2 as referring to §6.2, and declared a
mechanism absent by searching for patterns that could not match the three places it is stated. "RLS
dead path" used today's grant list to prove what tomorrow's design withholds. "Actor identity" read
§6.2 and missed that §6.3 is the same permission code's second half. "Org API duplication",
"half-provisioned tenant" and one supporting claim of the B3 finder all assumed the bootstrap window
has one exit where the transition graph gives two. "Bootstrap deadlock" attributed three
`TO app_runtime` policies to `app_platform`.

Two of those — the one-exit assumption and the misread cross-reference — were caused by the
document's own presentation rather than by careless reading, and revision 2 fixes the presentation
as well as the substance.

---

## 8. What this register does not settle

Recorded rather than smoothed over.

**Whether the tenant-scope short-circuit is a defect.** Unchanged from the scope document, except
for the figure: **170 operations across 136 route files** ask the scope-blind question, measured by
parsing each declaration rather than by scanning for the literal text (design §14). Wave E
adjudicates it per operation. Wave B asserts nothing about the other 170.

**Whether the platform role should be able to read tenant business data at all.** The design says no
and grants nothing that would allow it, but the design has not been attacked yet. That is the
refuter's job, and it is the attack most likely to find something, because the bootstrap writes into
identity tables that are the entry point to everything else.

**The exact figure for row-level-security coverage after the change.** It cannot be measured until
the change exists, and per C11 no figure appears until it is measured.
