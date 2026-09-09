# P1-31 — the warranty policy and coverage seam (P-10)

What was published, why each shape is the shape it is, what was proved on real rows, and the
one operator act this slice creates and does not perform.

|                              |                                                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Phase**                    | P1-31 — Vehicle Delivery, Warranty, and Reporting Frontend                                                            |
| **Authority**                | Prerequisite **P-10** of [`a0-preflight.md`](./a0-preflight.md), Artefact 4 — **PPD-04**                              |
| **Lane**                     | `remediation/p1-31-backend-warranty-policy-seam`, ownership profile `p1-31-backend`                                   |
| **Baseline**                 | protected `develop` **99dc6f41**; `main` untouched                                                                    |
| **Change control**           | [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) — **CC-15 … CC-18** (CC-16 is the operator backfill) |
| **Closes no canonical task** | P-10 is an execution prerequisite. The 29 remain 29, each still owing its own evidence                                |

---

## 1. The measured problem

`wty.warranty_policies` and `wty.warranty_coverage` landed in P1-11 carrying `SELECT`, `INSERT`
and `UPDATE` grants for `app_runtime` and an `INSERT` and an `UPDATE` policy each — and **no code
anywhere in `apps/api/src` had ever written either one.** Every method that touched them only
read them: `findPolicy` and `findPolicies` to explain a warranty that already cites a policy,
`findPolicyByCode` and `listActivePolicies` to resolve one a warranty is about to be issued
under, `findCoverageEffectiveOn` to mirror the selection `wty.issue_warranty` will make.

`wty.policy.manage` has been a seeded row in `supabase/seeds/04_iam_permission_catalog.sql` since
P1-08 and was **declared by no operation and named by no row-level-security predicate** — the
"declared but never wired" defect this phase keeps finding, in its purest form.

The consequence is total rather than cosmetic. `WarrantyService.resolvePolicy` issues under the
policy the caller named or the company's ONLY active one, and refuses a company with none as
`ERR-RES-001`, saying so: "a policy and its effective-dated coverage are operator configuration;
the backend does not create one." Since nothing could create one, **no tenant provisioned through
the product could ever issue a warranty.** `establishP1_22Fixtures` and
`p1-31-warranty-read-seam.test.ts` both seed `wty.warranty_policies` by admin SQL, and that is the
measurement rather than a convenience.

## 2. The seven operations

Two reads declare `wty.warranty.read` with `auditClass: 'none'`; five commands declare
`wty.policy.manage` with `auditClass: 'privileged'`.

| operation                          | method | path                                                  | guards                         |
| ---------------------------------- | ------ | ----------------------------------------------------- | ------------------------------ |
| `wty.warranty-policy-list`         | GET    | `/warranty-policies`                                  | paged, `status` filter         |
| `wty.warranty-policy-read`         | GET    | `/warranty-policies/{policyId}`                       | —                              |
| `wty.warranty-policy-create`       | POST   | `/warranty-policies`                                  | `idempotent`, 201              |
| `wty.warranty-policy-rename`       | PATCH  | `/warranty-policies/{policyId}`                       | `versionGuarded`               |
| `wty.warranty-policy-status-set`   | POST   | `/warranty-policies/{policyId}/status`                | `idempotent`, `versionGuarded` |
| `wty.warranty-coverage-create`     | POST   | `.../{policyId}/coverage-windows`                     | `idempotent`, 201              |
| `wty.warranty-coverage-status-set` | POST   | `.../{policyId}/coverage-windows/{coverageId}/status` | `versionGuarded`               |

The register moves 390 → **397** operations, 304 → **309** paths, 222 → **227** audit actions,
measured after the P-9 checklist-template seam (#355) merged ahead of this slice.
Five route modules; two of them carry two verbs, which is why the two counts move by seven and
five.

### Why the segment is `coverage-windows` and not `coverage`

`.gitignore:45` carries the root-unanchored rule `coverage/`, which git applies at every depth. A
route directory named `coverage` is therefore **untrackable**: `git add` skips it in silence, and
the file never reaches the tree the encoding, secret-scanning and route-discovery gates enumerate
through `git ls-files`. The alternatives were a negation entry in `.gitignore` for one source
directory, which is a config exception a reader has to be told about, or a segment that says the
same thing. `coverage-windows` is the phrase the module's own prose already uses for the
effective-dated row, so the URL and the docblocks agree.

### The governing precedent, and where this slice departs from it

The delivery checklist-template seam (P-9, PR #355) is the configuration-writer precedent of this
phase and this follows it in every respect it can: a strict body that refuses `id` and `status`, a
code mirrored from the column's own CHECK, `23505` surfaced as `ERR-CON-001` with
`rule: 'duplicate_code'`, status as a sub-route rather than a field, `If-Match` required on every
update, and company-scope authority evaluated with `authorizeScope({ companyId })` against the
row's own company.

It departs in two respects, and both are properties of this schema rather than choices.

- **There is no removal at all**, soft or hard. P-9 withdraws a checklist item with a soft delete
  on the `tech.technician-skill-withdraw` precedent. Here `deleted_at` exists on both tables and is
  never set: a soft-deleted policy would vanish from `findPolicyByCode` and `listActivePolicies`
  while `findPolicy` still resolved it for a warranty that cites it, which is a second retirement
  mechanism meaning something subtly different from `status = 'archived'` — the one the issue path
  already reads. One is enough.
- **A status change can be REFUSED by a constraint.** Reactivating a coverage row can violate
  `ex_warranty_coverage_no_overlap`. Nothing in P-9's status commands can fail that way, which is
  why the coverage status command is the one operation here that is version-guarded and NOT
  declared idempotent: a stored replay would hand back a success computed against rows that have
  since changed. Section 6.

## 3. The permission — nothing was minted

**Reads declare `wty.warranty.read`. Writes declare `wty.policy.manage`.** Both are verified in
`supabase/seeds/04_iam_permission_catalog.sql` before use. **No seed changed and no code was
minted.** `wty.policy.manage` is line 73 of that seed and has been since P1-08; this slice is the
first thing in the repository to declare it.

The reads take the READ code rather than the administration code, and the reason is who needs
them. `wty.warranty-generate` accepts a `policyId` it cannot invent, and `wty.warranty-list`
carries a policy block on every row precisely so a bare id is never published. Gating the policy
picker on `wty.policy.manage` would mean a warranty clerk could name a policy only by guessing its
id — and would hand coverage administration to everyone who merely reads. That is the converse of
the rule `wty.warranty-detail`'s own docblock states: borrowing `wty.policy.manage` for a read
"would be worse: it grants coverage administration". The rows carry no personal data — a code, a
name, a status, three dates and two integers.

## 4. How the authority is scoped — the company-scope decision

**The writes require the permission for the TARGET COMPANY: company-wide, or wider.** Every
command calls `authorizeScope({ companyId })` against the row's own company after the row is read,
or against the body's claimed company before the row is written.

There is **no company-scope helper in the repository** and none was added. `authorizeScope` is
`requireScopedPermissions`, which accepts a company-only target — the shape
`iam.company-settings-read` and `iam.company-settings-write` already pass — and resolves it
through `iam.has_permission_in_scope(code, company, NULL, NULL)`. That predicate is satisfied only
by `scope_mode = 'unrestricted'` or by a `company`-type grant scope naming the company: a
BRANCH-scoped grant compares `s.branch_id = NULL` and does not apply. So the check means exactly
"company-wide or wider", by the deployed function rather than by a second definition of scope
written here.

Why company-wide and not branch: **neither table has a `branch_id` column, and neither RLS policy
carries a branch clause.** `resolvePolicy` picks a company's only active policy for every branch of
that company, and `findCoverageEffectiveOn` narrows on `(tenant, company, policy)` and nothing
else. So one coverage row authored here sets the duration and the distance allowance of every
warranty issued in every branch of that company for the days it covers. That reach is the argument,
and it is read off the DDL rather than assumed.

**The READS are scoped differently, deliberately.** They declare `scope: 'tenant'` and lean on
`sel_warranty_policies_scope`, which narrows by `iam.allowed_company_ids()` — a set that includes
the company of a BRANCH-scoped grant, because `ck_grant_scopes_shape` requires every scope row to
name its company. Requiring company-wide authority to read would deny the policy picker to the
branch-scoped warranty clerk that `wty.warranty-generate` (`scope: 'branch'`) is built for, which
is the P-2…P-5 rule restated: a read on this surface must be holdable by the principal that acts on
it.

The tenant boundary on a create is `fk_warranty_policies_company`, whose tenant half comes from the
session context rather than from the request, so a company in another tenant is refused as
`ERR-VAL-001` and no row can be written outside the caller's tenant.

## 5. Absence, and what a 404 means here

`findPolicyById` returns null for absent and out-of-scope alike, and the service turns both into
one `ERR-RES-001` — decided **before** any scope decision, so a 403 never confirms that an id names
a real row somewhere. A foreign tenant gets 404 on the detail read and on every command; a caller
holding `wty.policy.manage` but not `wty.warranty.read` gets 403 on the reads, which is the missing
code and nothing else.

A coverage row addressed through the WRONG parent policy is a 404 as well, and that check is
load-bearing: `findCoverage` resolves within the COMPANY, so without it the coverage path would
archive a sibling policy's terms and report success.

## 6. The overlap invariant, in both directions

`ex_warranty_coverage_no_overlap` is a gist `EXCLUDE` on
`(tenant, company, policy, covered_scope, daterange(effective_from, effective_to, '[)'))` **where
the row is `status = 'active'` and live** — BR-WTY-001. It is the enforcement point in three
distinct situations, and each is reported to the caller as the same thing because to a caller it is
the same thing:

| situation                                           | where it is refused                | what the caller sees                                           |
| --------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------- |
| two windows in ONE create body overlap              | the application, before any INSERT | `ERR-VAL-001`, `body.coverage.N`, `rule: overlapping_coverage` |
| a new window overlaps a live one                    | the constraint (`23P01`)           | `ERR-CON-001`, `body`, `rule: overlapping_coverage`            |
| reactivating an archived window that was re-covered | the constraint (`23P01`)           | `ERR-CON-001`, `body.status`, `rule: overlapping_coverage`     |

The first is refused at the boundary rather than left to the constraint because the constraint
would abort the transaction and tell the caller only that two windows overlap — not that it sent
the overlap itself, in one body, and can fix it without reading anything back. It is a better
MESSAGE for the same rule and never a second definition of it: the constraint still runs, and the
half-open `[from, to)` semantics are reproduced exactly, so a window ending on the day the next
begins is legal in both places.

The third is why the coverage status command is **version-guarded and not idempotent**, alone among
the five writes. An idempotency reservation that replayed a stored success would hand back a
success computed before the replacement row existed. The version guard already makes a duplicate
submission safe: the second one loses.

## 7. Money

**None crosses this surface, and that is a measurement rather than an omission.** `wty` has 80
columns and not one is an amount, a currency or a cap in any unit of account. `durationMonths` is
an `integer` count of months and is rendered as a JSON number: the decimal-string rule this
codebase applies to money exists because `numeric` cannot survive IEEE-754, which does not apply to
an `integer`. `odometerAllowance` is a DISTANCE and is carried as an exact decimal STRING in both
directions, because `veh.odometer_readings.value` is `numeric` and every odometer value in this
codebase crosses the wire as a string — one spelling for the reading and another for the allowance
is how a float gets onto the path. The suite walks every response for a JSON number under any
money-shaped key and asserts there is none.

**It is `odometerAllowance` and never `odometerLimit`.** The coverage's value is the RELATIVE
allowance the primitive adds to the odometer at issue; `wty.warranty_records.odometer_limit` is the
ABSOLUTE reading at which the warranty lapses. `WarrantyCoverageView` already spells the coverage
half `odometerAllowance` for exactly this reason, and this surface uses the same word so the
coverage a warranty cites and the coverage an operator authors are one shape.

## 8. The bundle widening — CC-01, closed on its own terms

`TENANT_ADMINISTRATOR_ROLE` deliberately EXCLUDED `wty.policy.manage` (CC-01) because no operation
declared it, and stated the rule for lifting it: "the slice that publishes them owns the widening
— exactly the `inv.item.manage` sequence, excluded here while no route declared it and added by
#322 on the day three routes did." Five operations now declare it, so this slice carries it. The
bundle moves **74 → 75**.

Withholding it now would be worse than withholding it was: `resolvePolicy` refuses a company with
no active warranty policy, so an administrator who could not create one could never issue a
warranty in a freshly provisioned organisation — and could not delegate the authority to anyone,
because `ins_role_permissions_delegable` admits a mapping only when the acting administrator
already holds the code. `rpt.report.configure` was still excluded on CC-02's unchanged grounds when this slice was written, and left them the same day when P-11 published its writers; `rpt.export` remains withheld on
CC-04's Owner decision.

**EXISTING organisations do not gain the code.** The bundle is written ONCE, inside
`platform.organization-provision`, and nothing re-applies it. Every organisation provisioned on the
48-, 65-, 67-, 73- or 74-code bundle holds no `wty.policy.manage`, so its administrator is refused
`ERR-IAM-001` on all five writes and cannot delegate the code either. The remedy exists and is the
one CC-11 built: **`scripts/platform/backfill-tenant-administrator-bundle.mjs` needs an operator run
against each environment AFTER this branch merges.** It parses `bootstrap-roles.ts` at run time, so
it needs no edit — but it is an operator act on a privileged connection and **this slice did not
run it and does not claim it was run.**

Five tests pin the bundle and all five moved, each with its reason in place:
`p1-29-w9-owner-bootstrap.test.ts` and `p1-30-inventory-master-data.test.ts` (74 → 75),
`p1-31-warranty-read-seam.test.ts` (`not.toContain` → `toContain`, with the note that P-7's own
claim is unaffected either way), and `p1-31-provisioning-bundle.test.ts`, where
`wty.policy.manage` moved from `EXCLUDED_UNDECLARED` into a new `ADDED_BY_P10` constant kept apart
from P-1's six and P-7's one so no widening can drift into another. That last move is what makes
the change falsifiable: B1 asserts ZERO declarers for everything still excluded on the "nothing
declares it" ground and MORE THAN ZERO for every added code, both read from the generated P1-24
operation register.

## 9. What was proved, on real rows

`tests/backend/p1-31-warranty-policy-seam.test.ts` — **31 cases, all passing**. Every policy and
every coverage row the suite reads was authored **through the published routes**; unlike every
suite before it, this one seeds neither table by admin SQL, because "a warranty policy can be
configured through the product" is the claim under test.

1. **Authored and read back.** A policy with two windows is created in one call, returned in
   `(covered_scope, effective_from, id)` order, and read back by `WTY_READ_ONLY` — which holds
   `wty.warranty.read` and not `wty.policy.manage`, so it wrote none of the rows it reads.
2. **The closure, closed end to end (P10-W1).** In `COMPANY_A9`, which the P1-22 fixtures leave with
   ZERO warranty policies: a delivered delivery is refused a warranty with `ERR-RES-001`; a policy
   and its coverage are authored through the routes; the SAME delivery then issues a warranty
   carrying the very terms just authored — the policy id, the policy code, the coverage id, 24
   months, an allowance of `"30000"` and scope `all`; the policy is archived through the status
   route; and a SECOND delivery is refused `ERR-RES-001` again. Naming the archived policy
   explicitly is a DIFFERENT refusal, `ERR-TRN-001` from `assertPolicyActive`, which is exactly why
   `findPolicy` does not filter on status.
3. **The authority is company-wide, from three sides.** `SAL_SCOPED_A2` holds `wty.policy.manage`
   through a BRANCH-scoped grant in `COMPANY_A1` and is refused every write while still able to
   READ; `SAL_COMPANY_SCOPED`, whose grant is `scope_type = 'company'` on the same company, is
   admitted there and refused in `COMPANY_A9`.
4. **Refused correctly.** A caller holding only `wty.warranty.read` is refused all five commands
   with `ERR-IAM-001` and `requiredPermissions = ["wty.policy.manage"]`; a caller holding only
   `wty.policy.manage` is refused both reads naming `wty.warranty.read`; another tenant gets 404
   `ERR-RES-001` on a read and on every write and never a 403.
5. **The guards hold.** `If-Match` absent is 428, stale is 409 with the row asserted unchanged, and
   a success advances the version by exactly one. A coverage row's `If-Match` is the COVERAGE's
   version: the suite moves the POLICY's counter first, offers it on the coverage path, gets 409,
   and then succeeds with the coverage's own.
6. **Archiving a policy does not cascade.** Asserted on real rows: the coverage statuses are
   unchanged across an archive and a restore.
7. **The overlap invariant**, all three limbs of section 6, including the refused reactivation
   leaving the archived row's version untouched.
8. **Replay.** The same key and body answers with the identical document and creates one policy and
   one audit record; the same for a coverage add. (The replay answers 200 rather than the declared
   201: `withIdempotency` stores the body and replays it as a plain result, which is a platform
   contract rather than a property of this route.)

## 10. What this does not close

- **Coverage cannot be edited, only archived and replaced.** `tg_warranty_coverage_immutable`
  freezes `policy_id` and `effective_from`, so the two fields deciding which window a row occupies
  cannot move at all. Nothing freezes `effective_to`, and this surface still refuses to edit it:
  warranties cite a coverage row by id for their whole life, so re-closing a window in place would
  silently restate the terms a customer was already bound to. Archive and add is the model, and it
  leaves the superseded terms readable beside the warranties that cite them. Publishing a coverage
  PATCH would need a decision about what it means for an already-issued warranty, which this
  prerequisite does not sanction.
- **The three coverage CHECK constraints are unreachable through these routes**, because the request
  schema mirrors each of them. The suite asserts the BOUNDARY refusal — a 422 naming the field — and
  does **not** claim to have exercised the `23514` constraint-name mapping in
  `WarrantyPolicyService`. That mapping is defence for the case where the boundary and the column
  disagree, and it is recorded as untested rather than presented as proved.
- **Bilingual names.** `wty.warranty_policies` has one `name` column and no locale column, so an
  Arabic name cannot be stored. Adding one is a migration; this surface publishes what the column
  holds and invents nothing.
- **The post-merge backfill**, section 8. Existing organisations gain nothing until an operator runs
  `scripts/platform/backfill-tenant-administrator-bundle.mjs`. It was not run here.
- **`wty.warranty_record_status_history` still has no reader** (CC-10, unchanged), and no claim
  surface exists or is created (P1-22-L-01, unchanged). This slice writes no `wty.warranty_records`
  row of any kind.
- **FE-008 and FE-009 themselves.** `apps/web` is unchanged except through the generated idempotency
  manifest, which every published operation moves. The screens are a later slice on the
  `p1-31-frontend` lane, and it is that lane which owes any request-payload mirror. Note that
  `check-p1-30-payload-parity.mjs` does not hold `wty` writes to a mirror at all — `P1_30_DOMAINS`
  is `svc`, `quo`, `inv`, `sal` — so no `PENDING` declaration was added, and adding one would have
  been a claim about a gate that does not look here.
