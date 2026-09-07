# CC-14 — a read's scope target is resolved inside the caller's tenant

**Status:** implemented on `remediation/p1-30-backend-cc-14-scope-target-in-tenant` ·
**Date:** 2026-09-07 · **Lane:** Backend `iam` foundation, with `inventory` ·
**Filed against:** `change-control-2026-09-06.md` row CC-14 (acceptance step 66) ·
**Base:** protected `develop` `68a728f9`

## 1. The finding, stated precisely

`iam.has_permission_in_scope` answers a question about the **caller**, not about the target. Its
first branch short-circuits on `scope_mode = 'unrestricted'` and returns true before any
`iam.grant_scopes` row — and therefore any `org.*` row — is read. A holder of an unrestricted grant
consequently satisfies the permission check for **any** company and branch pair it names, including
another tenant's real pair and a pair that exists nowhere.

Before this change the query then ran and row-level security returned nothing, so the answer was
`200` with an empty collection. **No data crossed a tenant boundary, and none crosses now.** What
was wrong was the shape of the answer: the application layer never decided anything, and a caller
could not distinguish "this branch is empty" from "this branch is not yours".

## 2. What was decided

The Owner approved full enforcement over two narrower options.

A GET whose `authorizationTarget` names **both** a company and a branch is refused, before the
collection is read, when that pair does not resolve to an `org.branches` row **visible to the
caller inside its own tenant**.

| case                                             | before   | after                |
| ------------------------------------------------ | -------- | -------------------- |
| permitted pair, rows exist                       | 200      | 200 (unchanged)      |
| permitted pair, **no rows**                      | 200 `[]` | 200 `[]` (unchanged) |
| missing permission, valid pair                   | 403      | 403 (unchanged)      |
| foreign tenant's real pair, unrestricted holder  | 200 `[]` | **403 ERR-IAM-001**  |
| pair that exists nowhere                         | 200 `[]` | **403 ERR-IAM-001**  |
| in-tenant pair, branch of another company (H6)   | 200 `[]` | **403 ERR-IAM-001**  |
| in-tenant pair whose branch is soft-deleted      | 200 `[]` | **403 ERR-IAM-001**  |
| mixed-grant caller, branch its grant union hides | 200 `[]` | **403 ERR-IAM-001**  |
| half target (company only, or branch only)       | 200      | 200 (untouched)      |
| body-scoped create naming a foreign pair         | 404      | 404 (untouched)      |

The four refusal rows are **byte-identical** apart from the correlation id. That is the property, not
a side effect: a refusal that differed between "exists elsewhere" and "exists nowhere" would be an
enumeration oracle, which is exactly what this file's parent header forbids of every denial.

It is a **refusal**, not a not-found and not a validation error. A `404` would confirm the existence
boundary the refusal exists to hide; a `422` would claim the input was malformed when it was
well-formed and merely unauthorized.

**Order:** the permission decision runs first, the target probe second. A caller missing the
permission must be told that, not told the pair is invisible — the same argument `prices/route.ts`
already makes for authorizing before calling `branchBelongsToCompany`.

## 3. The contract changes, named as such

Two previously-measured behaviours change. Both are the same class, both are strictly stricter, and
neither moves any data.

**(a) H6's incoherent in-tenant pair.** `tests/backend/p1-21-inventory-reads.test.ts` asserted 200
with an empty page for a company-scoped holder naming `(COMPANY_A1, BRANCH_A9)`, where `BRANCH_A9`
belongs to `COMPANY_A9`. It is now 403. The pair is not a row anywhere, so the probe refuses it
before the SQL `company_id` predicate is reached.

**(b) The mixed-grant caller.** A principal holding the operation's permission **company-scoped in
C** while carrying **any branch-scoped grant elsewhere** passes the permission check through the
company row, but `iam.allowed_branch_ids()` for it is the branch-scoped grant's branch alone. The
probe reads `org.branches` under `sel_branches_scope`, which narrows by that same union, so a branch
of C outside it is invisible and the read is refused — even though the permission covers it.

That is the honest reading of the guarantee: **the refusal means "not visible to this caller inside
its tenant", not "not in the tenant".** It is not a new restriction on what the caller can reach.
The business tables' own `sel_*_scope` policies are narrowed by the identical union, so such a
caller already received an empty page; the difference is that the application layer now makes the
decision and names it, instead of letting an empty result stand in for one.

`INV_COMPANY_SCOPED` in `tests/backend/p1-21-helpers.ts` is exactly this shape — inventory
permissions company-scoped on `COMPANY_A1` plus an unrelated permission branch-scoped on
`(COMPANY_A9, BRANCH_A9)` — so the corner is proved with a shipped fixture rather than recorded as
an unproved claim.

## 4. What is covered, and what deliberately is not

**Covered:** the sixteen GET reads that pass `scopeTargetOption(raw)` — appointments, inventory
reconciliations, jobs, departments, payments (receipt list), quality controls, receiving employees,
receptions, stock availability, stock locations, stock movements, stock reservations, available
technicians, the technician queue, technicians, and work orders. The gate is keyed on
`operation.method === 'GET'` plus the presence of a full target, so a future read inherits it by
passing `scopeTargetOption(raw)` — which is the one line a P1-31 read seam owes.

**Not covered, each for a reason:**

- **The six half-target operations** — `iam.company-settings-read`/`-write`,
  `iam.branch-settings-read`/`-write`, `shared.branch-status-read`/`-change`. They name one half of
  the pair, and inventing the other half here would be a second definition of scope. A company-only
  probe against `org.legal_companies` is a named follow-on, not this change.
- **`svc.price-resolve`** — it authorizes in-handler and then checks pair coherence itself, answering 422. Left as it is; whether it should pass `scopeTargetOption(raw)` instead is a follow-on.
- **The five body-scoped creates** — they keep the 404 their composite foreign key and RLS produce
  (MD-X1, pinned by `tests/backend/p1-18-reception-create.test.ts`). Unifying creates on 403 is a
  separate contract question.

## 5. Evidence

Unit tier — `tests/foundation/p1-18-scoped-authorization.test.ts`, new `F9` block (6 cases): one
statement against `org.branches` for a full target, bound `[context tenant, company, branch]` in that
order; `deleted_at IS NULL` present; **zero** statements for `{}`, company-only, branch-only and a
public operation; the refusal carries `ERR-IAM-001`, status 403, the operation's required
permissions, and names neither the company nor the branch. `F7`'s lexical-containment assertion was
extended so the probe cannot be hoisted out of the `withTransaction` callback.

Backend tier — `tests/backend/authorization.test.ts`, new `CC-14` block (5 cases) against the
deployed schema: the tenant's own pair resolves; half and empty targets issue no statement; a
nowhere pair and an in-tenant wrong-company pair produce the **same message**; a soft-deleted branch
is refused like a missing one (and restored in a `finally`); a context whose branch narrowing
excludes `BRANCH_A1` is refused.

End to end — `p1-30-a2-inventory-reads` (location list, reservation list), `p1-19-work-order-reads`,
`p1-27-reception-reads`, `br-03-technician-roster`, `br-06-work-execution-controls`,
`p1-29-w4-technician-workspace` (W4-8, `tech.technician-me-queue`),
`pre-p1-29-wave-c-company-rbac` (W32), `p1-30-a2-published-reads` (receipt list) and
`p1-21-inventory-reads` (H6 and the mixed-grant corner) now assert the exact 403 and its code, each
with a nowhere-pair companion whose problem document is compared whole with the correlation id
nulled. The suites that previously accepted `[403, 200]` or `[403, 404]` were tightened to the exact
status, which is a strengthening: an assertion that admitted two answers could not have caught
either one changing.

The positive halves are kept everywhere: `p1-27` and `br-03` still prove a caller's own empty branch
answers 200 with an empty page, `p1-30-a2` proves tenant B's own seeded branch answers 200 with its
own rows and none of tenant A's, and `p1-21` pairs the mixed-grant 403 with the same pair answered
200 for an unrestricted caller — without which a probe that refused everything would pass.

The falsification of the inventory `company_id` SQL predicate was **re-homed** rather than dropped.
With the pre-handler refusing the incoherent pair, the HTTP cases no longer reach that SQL, so
`tests/backend/p1-21-inventory-reads.test.ts` gained a repository-level case that calls
`listMovements`, `readAvailability` and `reconcileBalances` directly inside a transaction opened for
the unrestricted `INV_FULL` — where `iam.allowed_branch_ids()` is NULL and A9's rows are visible —
and asserts zero rows, with the coherent A9 pair returning rows in the same transaction as its
control. Without it, `mutation-targets.json`'s `inventory-read-company-scope` would guard a predicate
nothing exercises.

## 6. One shape the P1-24 mutation matrix forced

`requireScopeTargetInTenant` builds its denial document with `safeDetails` BEFORE `message`, which
is the reverse of every other throw in the file. That is deliberate and load-bearing rather than
stylistic. The P1-24 hostile mutation matrix attacks `requirePermissions`' denial document by
rewriting the exact two-line sequence `safeDetails: { requiredPermissions: operation.permissions },`
followed by `});` (M2 in `scripts/p1-24-mutation-matrix.mjs`). Writing the new throw in the ordinary
order made that anchor match twice, and the matrix reported M2 as **NOT APPLIED** — a state weaker
than a pass, because the mutation was never applied and nothing was attacked. Reordering the two
properties restores the anchor to exactly one site. The object literal is order-independent, so the
refusal is byte-identical either way; only the source text differs. The gate is unchanged and was
re-run to confirm: 6 of 6 caught, 0 survived, 0 not applied.

## 7. Follow-ons named, not done here

- `.github/ci-baselines/mutation-targets.json` — the `why` text of `inventory-read-company-scope`
  ("Only the SQL `company_id` predicate refuses it") is now **stale**: the pre-handler refuses it
  first, and the predicate is defence in depth exercised by the repository-level case. Editing
  `.github/ci-baselines` requires explicit approval under CLAUDE.md §A.3 and was not done here.
- A company-only probe (against `org.legal_companies`) for the six half-target operations.
- Whether the five body-scoped creates should unify on 403 rather than the FK/RLS 404.
- Whether `svc.price-resolve` should pass `scopeTargetOption(raw)` instead of checking coherence
  itself.
- P1-31 read seams must pass `scopeTargetOption(raw)` for this gate to apply to them.
