# feat(p1-20): implement service catalog pricing and quotation backend

> The PR body, committed so it is reviewable in the diff rather than only on GitHub. Every
> number below was produced by a named command. Anything not yet measured is marked
> **PENDING** rather than estimated — an earlier commit message in this phase carried an
> estimated test count that turned out wrong, and that is not repeated here.

## Prerequisite — P1-19 verified closed

| Item                     | Value                                                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| P1-19 final gate SHA     | `0d86a198ad1d13aa0b3219a8f6ecafea3a699cf0`                                                                                       |
| Verified containment     | `d8278c7` (feature merge), `da0b8b2` (reviewed feature), `600ca9c` (reviewed gate) — all three are ancestors of `origin/develop` |
| `origin/develop` parents | `d8278c7` + `600ca9c` — unchanged since P1-19 closed                                                                             |
| P1-19 decision           | `Go — P1-19 Work Order, Diagnostics, and Technician Backend Gate Passed`                                                         |
| `origin/main`            | `491c4e0882763b5d5864737e63b4e31ca708a6b5` — untouched; promotion is a founders' decision (ADR-006)                              |

## Scope of this PR

`P1_20_BASE_SHA = 0d86a198ad1d13aa0b3219a8f6ecafea3a699cf0` · base branch `develop` ·
**70 files, +19,139 / −48** (src 37, docs 16, tests 12, scripts 2, supabase 1,
`package.json`, `ci.yml`).

The commercial backend on the frozen Phase 1-10 `svc` and Phase 1-10 `quo` schemas: the
service-catalog read surface with branch availability and standard labour time; the
price-list lifecycle with forward-only publication; deterministic price and tax resolution;
discount authorization against both a policy threshold and the actor's own approval ceiling;
quotation creation, revision, issue and expiry; item-level and revision-wide customer
decisions with approval evidence; and the additional-work commercial link into the P1-19
approval path.

## Database boundary

**No migration, and none was authorized.**

| Proof                     | Result                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration count           | **119**, unchanged                                                                                                                                |
| Migration 120             | **absent**                                                                                                                                        |
| Migrations 1–119 modified | **none** — `git diff --name-status 0d86a19..HEAD -- supabase/migrations/` is empty                                                                |
| Total `supabase/` change  | **one file** — `seeds/04_iam_permission_catalog.sql`, +12 / −1                                                                                    |
| Seed shape                | additive only, `ON CONFLICT (permission_code) DO NOTHING`, applied twice idempotently                                                             |
| Codes added               | `svc.service.read` (low) · `svc.price.read` (**medium**) · `quo.quotation.read` (low)                                                             |
| Permission total          | 93 → **96**                                                                                                                                       |
| Clean-room `schema_hash`  | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c` — byte-identical to the frozen baseline, before and after all three suites ran |

`app_runtime` already held the grants and forced RLS on every `svc`/`quo` table this phase
writes, so no database change request was required. `svc.price.read` is `medium` rather than
`low` deliberately: a price list exposes what the business charges every customer segment,
not only the customer in front of you.

## The 27 canonical tasks — 27/27

BE 14 · SEC 4 · QA 5 · DO 2 · DOC 2. Register:
`docs/phase-1/phase-1-20/evidence/task-register.md`.

**The task gate does not accept prose, and it took four attempts to get there.** Three
versions searched the repository for the task identifier and all three were vacuous, because
the premise is unsatisfiable: `P1-20-BE-002` is a project-management label, not a code
symbol, so it can only ever appear in a comment. Each fix only moved which comment counted —
first the generator's own output, then `task-register.md` (which prints all 27), then the gate
script's own header. The fourth version stops asking: each task names the **artifacts** it
produced — a registered operation, a permission that is both seeded and declared, an audit
action that is both catalogued and emitted, a published event, an exported symbol, a test
title — and the gate asserts those exist. Mutation-verified both ways: renaming
`findAvailability` fails `P1-20-BE-002`; renaming the npm script or unwiring it from `ci.yml`
fails `P1-20-DO-001`.

## Operations, contract parity and coverage

| Item                                | Value                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------- |
| Registered P1-20 operations         | **13**                                                                  |
| At genuine operation depth          | **13/13**                                                               |
| Pending / unit-only / metadata-only | **0 / 0 / 0**                                                           |
| OpenAPI                             | **152 paths / 181 operations** (baseline 140 / 168)                     |
| P1-20 operations in OpenAPI         | **13** — parity verified in both directions, scopes matching the routes |

| Operation                        | Method | Path                                                          | Permissions                                  | Scope      |
| -------------------------------- | ------ | ------------------------------------------------------------- | -------------------------------------------- | ---------- |
| `svc.service-list`               | GET    | `/services`                                                   | `svc.service.read`                           | tenant     |
| `svc.price-list-list`            | GET    | `/price-lists`                                                | `svc.price.read`                             | tenant     |
| `svc.price-list-create`          | POST   | `/price-lists`                                                | `svc.price.manage`                           | tenant     |
| `svc.price-list-version-create`  | POST   | `/price-lists/{priceListId}/versions`                         | `svc.price.manage`                           | tenant     |
| `svc.price-rule-record`          | POST   | `/price-lists/{priceListId}/versions/{versionId}/rules`       | `svc.price.manage`                           | **branch** |
| `svc.price-list-version-publish` | POST   | `/price-lists/{priceListId}/versions/{versionId}/publication` | `svc.price.publish`                          | tenant¹    |
| `svc.price-resolve`              | GET    | `/prices`                                                     | `svc.price.read`                             | **branch** |
| `quo.quotation-create`           | POST   | `/quotations`                                                 | `quo.quotation.manage`, `wo.work_order.read` | **branch** |
| `quo.quotation-detail`           | GET    | `/quotations/{quotationId}`                                   | `quo.quotation.read`                         | **branch** |
| `quo.quotation-revision-create`  | POST   | `/quotations/{quotationId}/revisions`                         | `quo.quotation.manage`                       | **branch** |
| `quo.quotation-issue`            | POST   | `/quotations/{quotationId}/issue`                             | `quo.quotation.manage`                       | **branch** |
| `quo.quotation-item-decide`      | POST   | `/quotation-items/{quotationItemId}/decisions`                | `quo.decision.record`                        | **branch** |
| `quo.quotation-revision-decide`  | POST   | `/quotation-revisions/{revisionId}/decisions`                 | `quo.decision.record`                        | **branch** |

¹ `tenant` in the registry because a price list carries no company or branch — plus an
explicit tenant-wide authority check in the handler; see Authorization.

## Financial correctness

The CHECK constraints already fix the policy, so nothing here is a business decision this
phase made:

```
captured_tax_amount  = round(((unit * qty) - discount) * rate, 4)
captured_line_total  = round(((unit * qty) - discount) + tax_amount, 4)
captured_grand_total = (subtotal - discount_total) + tax_total   -- exact, unrounded
```

Tax is **per line**, discount is applied **before** tax, tax is **exclusive**, rounding is
`round(…, 4)`. PostgreSQL `numeric` is the only calculation engine: the insert writes those
exact expressions with every parameter cast to its column's precision and scale, so the
engine and the validator are the same thing and cannot disagree.

| Invariant                             | How it holds                                                                                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No float in the money path            | zero `parseFloat`/`Number(`/`Math.round`/`toFixed`/`Math.floor`/`Math.ceil` in the three modules; the only `parseFloat` strings in `src/` are comments saying why     |
| `parseInt` scope                      | five uses, all `Number.parseInt(_, 10)` on integer COUNTS — never on money                                                                                            |
| Money crosses as decimal STRINGS      | asserted positively (`"unitPrice":"100.0000"`) and negatively (no unquoted `100`)                                                                                     |
| `numeric` never becomes a float       | every money column selected `::text`; a unit test pins `pg`'s OID-1700 parser, and a second records that `numeric[]` IS parsed to floats and asserts none is selected |
| `Σ round(baseᵢ,4) = round(Σ baseᵢ,4)` | not an identity — a line whose `unit × qty` is inexact at scale 4 is refused naming the field, instead of failing later inside `quo.issue_revision` as a 500          |
| Splitting defeats neither gate        | the document is authorized through the same `authorize` call a single line of that size would take — same policy, same ceiling, same maker/approver rule              |
| Approval limits respect grant scope   | a role's ceiling counts only in a company its grant reaches                                                                                                           |
| No FX, ever                           | `Money` exposes no `convert`/`add`/`multiply`, asserted by absence; a cross-currency comparison is a deterministic refusal                                            |
| Deterministic selection               | `svc.resolve_price` specificity then priority; a tie is structurally impossible under `uq_price_rules_signature`                                                      |
| Issued revisions immutable            | proven by republishing the price list at five times the amount after issue and asserting the captured columns do not move                                             |
| Accepted quotations never expire      | the sweep tests the PARENT state, because a revision stays `issued` after every line is approved                                                                      |

## Authorization and isolation

Every route authenticates, declares a named permission, derives tenant/company/branch
server-side, and authorizes a concrete scope target. No route trusts a client-supplied actor,
tenant, company or branch.

**Tenant-wide writes need tenant-wide authority.** Authorizing the selector protects the
narrow case and leaves the broad one open: a price rule with no company and no branch is a
WILDCARD that `svc.resolve_price` applies to every branch, and an empty target makes
`requiresScopedEvaluation` return false whatever the declared scope. A wildcard rule and a
publication therefore require an `unrestricted` grant — asked of the deployed
`iam.has_permission_in_scope` with an all-NULL target, which only `scope_mode =
'unrestricted'` can satisfy. A branch-scoped actor keeps the ability to write rules for its
own branch, so the control discriminates rather than blanket-refusing.

**An isolation test only counts if the principal holds the operation's own permission.** A
403 from a missing permission proves nothing about scope, and a scope-blind implementation
produces the same 403. Every cross-branch case uses a principal holding the operation's
permission in full, scoped to branch A2, plus a widening grant putting A1 in its
`iam.allowed_branch_ids()` union — so the row is readable and the permission is held, and a
scope-blind check would **allow** the request.

Citing a quotation revision on a P1-19 additional-work approval requires
`quo.quotation.read`, checked where it arises rather than declared on the operation, because
`permissions` is a conjunction and an approval citing no quotation must not need a commercial
permission. This is the one behaviour change to a closed phase, and it is recorded rather
than smuggled.

## Concurrency, idempotency, audit and outbox

Raced issue and raced opposite item-decisions are driven with `Promise.all` against one row:
exactly one winner, exactly one outbox row. All eight writes refuse a missing
`Idempotency-Key`; `versionGuarded` operations refuse a **wrong** `If-Match`, not merely a
missing one. All six event keys are deterministic and row-id-based, so a retry collides
rather than double-publishing. Every error code any P1-20 path can return is in the
controlled catalog — reconciled independently, zero uncatalogued.

Rollback is proved by failures forced **after** writes, never by pre-check refusals:

- **issue** — the outbox key is pre-taken, so `publishEvent` raises after the revision moved
  to `issued`, `current_revision_id` was repointed and the audit record was written.
- **revision decide** — a mid-loop conflict, after line one's decision was already inserted.
- **create** — `uq_quotations_number` fires after the sequence allocation, and the allocated
  number goes back. `shared.next_display_number()` runs in the request transaction, so a
  failed create burns no quotation number and leaves no gap in a customer-facing sequence.

## Reviews and audit

| Pass                  | Scope                            | Outcome                                                      |
| --------------------- | -------------------------------- | ------------------------------------------------------------ |
| 1–4                   | the feature branch               | 5 Highs, 9 Mediums, 7 Lows — all closed (checkpoint §Wave 9) |
| 5                     | the remediation commit `0096560` | 13 findings (0C / 2H / 5M / 6L) — all closed                 |
| Hostile 100/100 audit | full diff `0d86a19..final`       | **PENDING**                                                  |

Full disposition register: `docs/phase-1/phase-1-20/evidence/review-dispositions.md`. Every
finding was reproduced before it was touched; nothing was implemented on a suggestion alone.

## Test totals

| Suite    | Development database     | Clean room (empty PostgreSQL 17.10) |
| -------- | ------------------------ | ----------------------------------- |
| Unit     | **901** / 42 files       | **901**                             |
| Backend  | **PENDING** quiet re-run | **1219** / 56 files                 |
| Database | **PENDING** quiet re-run | **PENDING** quiet re-run            |

P1-20's own suites: catalog 21 · pricing 47 · quotation 62 · additional-work link 12 ·
unit decimal 34 · unit discount 24.

Two suites must never run against one database at once — every DB-backed suite truncates the
shared tenant fixtures in `beforeAll`, so concurrent runs delete each other's roles and
grants and the failures surface nowhere near the cause. Figures taken during such a collision
were discarded rather than recorded.

## Clean room

`docs/phase-1/phase-1-20/evidence/clean-room-validation.md`. Fresh `postgres:17-alpine`,
verified empty first, 119 migrations applied cleanly, seeds applied twice with identical
counts and five exact retention classes, structural review PASS (537 FKs validated, no
runtime-reachable destructive cascade, complete FK index coverage, no duplicate indexes, zero
dictionary drift), `schema_hash` unchanged before and after all three suites, worktree
unchanged by the run.

## Accepted limitations — nine, all Low, all open

`docs/phase-1/phase-1-20/evidence/open-decisions.md` — A-01 availability has no effective
period · A-02 no branch override for labour time · A-03 `decided_by` is the recording staff
user · A-04 three catalog audit actions have no producer yet · A-05 expiry has no scheduler ·
A-06 no alert-routing destination is provisioned · A-07 the price-ambiguity guard is
structurally unreachable and mirrors protected SQL · A-08 price-list reads are bounded rather
than paged · A-09 three module cycles pre-date this phase and no gate refuses them.

## Out of scope, verified absent

No Benzene hard-coding in `src/`; no Zoom functionality; the product name remains
`[PRODUCT NAME — Pending Final Approval]`; no P1-21 inventory reservation or issue (no `inv.`
access from any P1-20 module); no P1-22 invoicing or billing (no `sal.` access). Enforced by
`scripts/check-scope-exclusions.mjs` over 1,272 tracked files.

## Hosted CI

**PENDING** — recorded only once all four required checks are green on the exact head being
merged.
