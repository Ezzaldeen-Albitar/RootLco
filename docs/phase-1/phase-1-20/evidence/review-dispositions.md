# P1-20 — independent review dispositions

Every finding any independent reviewer raised against this phase, with what was done about
it. A finding that was **not** acted on says why, and says it in the reviewer's terms
rather than restating the code's.

Five review passes ran. The first four are recorded in `execution-checkpoint.md` §Wave 9.
This document is the full disposition register, and it exists because a review whose
findings are summarised only in a commit message cannot be audited afterwards.

## Pass 5 — adversarial review of the remediation commit `0096560`

The remediation commit was itself reviewed, on the principle that a remediation pass
introduces its own defects. It did: **13 findings — 0 Critical, 2 High, 5 Medium, 6 Low.**

| #   | Reviewer severity | Finding                                                                                                                                                                                                                                                                                         | Classification | Disposition                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | High              | The `scope: 'branch'` change on `svc.price-rule-record` authorizes the selector only when one is NAMED. A **wildcard** rule is the broadest selector and fell through to the scope-blind tenant check, so a branch-scoped actor could still price every branch. Publication had the same shape. | **Confirmed**  | **Fixed.** `callerHoldsPermissionTenantWide` asks the deployed `iam.has_permission_in_scope` with an all-NULL target, which only an `unrestricted` grant satisfies. Required for a wildcard rule and for publication. Two tests, both mutation-verified; the branch-scoped actor can still write rules for its own branch, so the fix discriminates rather than blanket-refusing.     |
| 2   | High              | The task-anchor rule **is** satisfiable by prose: comments were not stripped from the haystack, `.md` files under the code roots were searched, and `P1-20-DO-001`/`P1-20-DOC-001` resolved solely to the gate script's own header comment.                                                     | **Confirmed**  | **Fixed by redesign.** The identifier search is gone. Each task now names ARTIFACTS — operation id, seeded-and-declared permission, catalogued-and-produced audit action, published event, exported symbol, test title — and the gate asserts those exist. Mutation-verified in both directions. See below for why the old premise could never work.                                  |
| 3   | Medium            | `field()` reads the FIRST `scope: '…'` in un-stripped declaration text, so a comment beats the declaration: the generated inventory reported `svc.service-list` as `branch` where the route declares `tenant`.                                                                                  | **Confirmed**  | **Fixed.** The declaration is comment-stripped before `field()`. The regenerated inventory now agrees with the route and with `openapi.v1.json`. The dangerous direction the reviewer named — a branch-scoped operation read as tenant, skipping `scopeEnforced` — is closed by the same change.                                                                                      |
| 4   | Medium            | The module-cycles item was filed as `P1-20-A-06`, an id `open-decisions.md` already uses for "No alert routing".                                                                                                                                                                                | **Confirmed**  | **Fixed.** Renumbered to `P1-20-A-09` in every document. (Already corrected in the working tree when the review landed.)                                                                                                                                                                                                                                                              |
| 5   | Medium            | The document-level ceiling ran only `if (elevatedLines > 0)` — the case splitting avoids. With threshold 50 and ceiling 100, 200 lines of 49.99 authorize 9,998 with no elevated permission and no ceiling comparison at all. The block's own comment claimed to close this.                    | **Confirmed**  | **Fixed.** The document is authorized through the SAME `authorize` call a single line of that size would take — same policy, same ceiling, same maker/approver rule — against the document's own discount and pre-discount base. Four tests including the under-threshold control case; mutation-verified. The audit record now keys on the aggregate, so the split case is recorded. |
| 6   | Medium            | Repeated claim that `wo.additional_work.approve` alone disclosed a revision's **total** and **currency**. No refusal renders either.                                                                                                                                                            | **Confirmed**  | **Fixed (evidence).** Narrowed to existence, scope, revision status, expiry and acceptance outcome — which is what the seven refusals actually say. The control itself is unchanged and still correct; only the justification was inflated.                                                                                                                                           |
| 7   | Medium            | Claim that BOTH new audit actions are asserted by tests reading `iam.audit_record_details`. True for the discount action, false for the link action, which had only a row-count assertion.                                                                                                      | **Confirmed**  | **Fixed.** The link test now asserts the exact field set, that `quotation_revision_ref` is classified `internal`, and that no amount or currency field is present.                                                                                                                                                                                                                    |
| 8   | Low               | The `/prices` coherence check ran before `authorizeScope` and reads `org.branches` under the caller's own RLS, so an out-of-scope caller got a factually false `422` ("branch B does not belong to company C") instead of the `403`.                                                            | **Confirmed**  | **Fixed.** `authorizeScope` first, coherence second. Coherence still runs before anything is resolved, which is its purpose. No access changes either way.                                                                                                                                                                                                                            |
| 9   | Low               | Per-suite counts in `task-register.md` left stale (35/38/11) while `qa-evidence.md` in the same commit used 45/56/12.                                                                                                                                                                           | **Confirmed**  | **Fixed.** (Already corrected in the working tree when the review landed; the counts have since moved again with the new tests and are re-measured below.)                                                                                                                                                                                                                            |
| 10  | Low               | Wave 9 row claims 10 Mediums; the section lists 9.                                                                                                                                                                                                                                              | **Confirmed**  | **Fixed.** Corrected to 9.                                                                                                                                                                                                                                                                                                                                                            |
| 11  | Low               | The measurement table still read Unit 866 / Backend 1182 while the commit message claimed 899 / 1219, and 1182 + 29 new tests is 1211, not 1219.                                                                                                                                                | **Confirmed**  | **Fixed.** The table records the measured 899 / 1211 and states explicitly that the commit message's 1219 was an estimate written before the suite finished. The reviewer could not run the backend suite and correctly declined to say which number was wrong; the measurement settles it.                                                                                           |
| 12  | Low               | The comment claiming the ceiling predicate and `iam.has_permission_in_scope` "cannot disagree" is false — the deployed function matches a `branch` scope row on `branch_id` only, never on `company_id`, so the ceiling predicate is deliberately WIDER.                                        | **Confirmed**  | **Fixed.** The parity sentence is deleted. The comment now states that the predicate is wider, names the residual case the reviewer constructed, and explains why the widening is correct: `iam.approval_limits` has no branch column, so a company is the only granularity a limit can be matched at.                                                                                |
| 13  | Low               | The port-pairing gate rule keys on the literal `quotationRevisionRef`, so a route reaching the port by spreading a body or by calling the reader directly would pass.                                                                                                                           | **Confirmed**  | **Fixed.** The rule now also keys on `commercialApprovalReader`. Either alone has a false negative; together they cover the direct and the indirect case.                                                                                                                                                                                                                             |

**Speculative or refuted: none.** Every one of the 13 was reproduced before it was
touched. Nothing was implemented on a reviewer's suggestion without first confirming the
mechanism.

### Why the task-anchor premise could never work, stated plainly

Three versions of that gate searched for the task identifier, and all three were vacuous.
That is not three careless mistakes; it is one wrong premise. `P1-20-BE-002` is a
project-management label, not a code symbol — it can only ever appear in a comment or a
string literal. So "the identifier appears in code" always reduced to "somebody typed the
identifier into a comment", and each fix only moved which comment counted:

1. **v1** counted the gate's own generated documents. All 27 resolved the moment the
   generator ran.
2. **v2** excluded those two documents. Five identifiers then resolved to
   `task-register.md`, which prints all 27 in its tables — deleting every P1-20 source file
   would still have reported 27/27.
3. **v3** stopped searching `docs/` entirely. Comments were still not stripped, `.md` files
   under the code roots were still searched, and two identifiers resolved solely to the
   gate script's own header comment.

The fourth version stops asking the question. Each task names the artifacts it produced and
the gate checks those artifacts exist: a comment cannot register an operation, seed a
permission, produce an audit action, publish an event, export a symbol, or name a test.
Both directions are mutation-verified — renaming `findAvailability` fails `P1-20-BE-002`;
renaming the npm script or unwiring it from `ci.yml` fails `P1-20-DO-001`.

### What the reviewer checked and could not break

Recorded because a review's negative results are evidence too, and because these are the
claims most worth having independently confirmed:

- `expireLapsed`'s parent-state guard: `active` is genuinely the only legal source state —
  `quo.issue_revision` sets `quotations.status='active'` unconditionally and there is no
  quotation-level transition guard.
- `serverNow()`'s one-clock claim: every caller is inside `withTransaction`'s explicit
  `BEGIN`, and `hasExpired` uses `<=`, so millisecond truncation cannot invert the SQL
  predicate.
- `lineBase`'s exactness argument, including that the returned scale-4 text is numerically
  identical to the unrounded product, so `ck_quotation_items_discount` stays correct. The
  worked `1.0001 × 1.500` counter-example reproduces against the deployed constraints.
- The `quo.quotation.read` check sits before every information-disclosing refusal and
  passes a concrete company **and** branch.
- `quo.additional_work.quotation_linked` is appended on the same handle inside the approval
  transaction.
- The rollback test's forced failure is genuinely after the writes; both race tests are
  genuinely concurrent and neither branch passes trivially.
- The three new principals hold the permissions their tests need, and the widening grants
  really place `BRANCH_A1` in their allowed-branch union.
- `P1_20_PREFIXES` is applied at every prefix-keyed enforcement point, and no earlier
  phase's floor was relaxed.
- Verified independently: OpenAPI 152/181, permissions 96, audit actions 127, event catalog
  39, `p1-19-additional-work` 39/39, coverage gate 13/13 at operation depth.
