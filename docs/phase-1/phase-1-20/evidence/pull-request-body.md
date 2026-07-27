# feat(p1-20): implement service catalog pricing and quotation backend

> Every number below was produced by a named command at the exact head being merged. Nothing
> is estimated — an earlier commit message in this phase carried an estimated test count that
> turned out wrong, and that is not repeated here.
>
> **Note on the committed copy.** `docs/phase-1/phase-1-20/evidence/pull-request-body.md` and
> `clean-room-validation.md` in this branch are the *pre-final* drafts: they still read 13
> operations, OpenAPI 152/181 and unit 901 / backend 1219, which were the true figures before
> the service-catalog mutation surface was built. This description is the corrected and
> authoritative text. Correcting those two files in this branch would move the head off
> `e746253` and invalidate the exact-SHA evidence below, so the correction lands in the
> documentation-only gate-record PR that immediately follows this merge. Saying so here rather
> than quietly shipping the stale copy.

## Identity

| Item                    | Value                                                              |
| ----------------------- | ------------------------------------------------------------------ |
| Base branch             | `develop`                                                          |
| `P1_20_BASE_SHA`        | `0d86a198ad1d13aa0b3219a8f6ecafea3a699cf0`                         |
| Final reviewed head     | `e7462536d183e410ff2db9792c7a6090df7f4698`                         |
| Hosted CI SHA           | `e7462536d183e410ff2db9792c7a6090df7f4698` — identical to the head |
| Clean-room SHA          | `e7462536d183e410ff2db9792c7a6090df7f4698` — identical to the head |
| `origin/main`           | `491c4e0882763b5d5864737e63b4e31ca708a6b5` — untouched             |

## Prerequisite — P1-19 verified closed

| Item                     | Value                                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| P1-19 final gate SHA     | `0d86a198ad1d13aa0b3219a8f6ecafea3a699cf0`                                                                                        |
| Verified containment     | `d8278c7` (feature merge), `da0b8b2` (reviewed feature), `600ca9c` (reviewed gate) — all three ancestors of `origin/develop`      |
| `origin/develop` parents | `d8278c7` + `600ca9c` — unchanged since P1-19 closed                                                                             |
| P1-19 decision           | `Go — P1-19 Work Order, Diagnostics, and Technician Backend Gate Passed`                                                         |
| P1-19 inventory at this head | **green — 58 operations**, re-verified after this phase moved the platform registry total                                     |

## Scope of this PR

**77 files, +25,384 / −413** — src 41, docs 19, tests 12, scripts 2, supabase 1,
`package.json`, `.github/workflows/ci.yml`.

The commercial backend on the frozen Phase 1-10 `svc` and `quo` schemas: the service-catalog
read **and mutation** surface — create, edit, publish a version, set branch availability —
with standard labour time; the price-list lifecycle with forward-only publication;
deterministic price and tax resolution; discount authorization against both a policy threshold
and the actor's own approval ceiling; quotation creation, revision, issue and expiry;
item-level and revision-wide customer decisions with approval evidence; and the additional-work
commercial link into the P1-19 approval path.

## Database boundary

**No migration, and none was authorized.**

| Proof                     | Result                                                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration count           | **119**, unchanged                                                                                                                                |
| Migration 120             | **absent**                                                                                                                                        |
| Migrations 1–119 modified | **none** — `git diff --name-status 0d86a19..e746253 -- supabase/migrations/` is empty                                                             |
| Total `supabase/` change  | **one file** — `seeds/04_iam_permission_catalog.sql`, +12 / −1                                                                                    |
| Seed shape                | additive only, `ON CONFLICT (permission_code) DO NOTHING`, applied twice idempotently                                                             |
| Codes added               | `svc.service.read` (low) · `svc.price.read` (**medium**) · `quo.quotation.read` (low)                                                             |
| Permission total          | 93 → **96**                                                                                                                                       |
| Clean-room `schema_hash`  | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c` — byte-identical to the frozen baseline, before and after all three suites ran |

`app_runtime` already held the grants and forced RLS on every `svc`/`quo` table this phase
writes, so no database change request was required. The four mutation operations added late in
the phase introduced **no new permission code** — they run on the already-seeded
`svc.service.manage` — so the seed delta above is the whole database-facing change.
`svc.price.read` is `medium` rather than `low` deliberately: a price list exposes what the
business charges every customer segment, not only the customer in front of you.

## The 27 canonical tasks — 27/27

BE 14 · SEC 4 · QA 5 · DO 2 · DOC 2. Register:
`docs/phase-1/phase-1-20/evidence/task-register.md`.

**The task gate does not accept prose, and it took four attempts to get there.** Three versions
searched the repository for the task identifier and all three were vacuous, because the premise
is unsatisfiable: `P1-20-BE-002` is a project-management label, not a code symbol, so it can
only ever appear in a comment. Each fix only moved which comment counted — first the
generator's own output, then `task-register.md` (which prints all 27), then the gate script's
own header. The fourth version stops asking: each task names the **artifacts** it produced — a
registered operation, a permission that is both seeded and declared, an audit action that is
both catalogued and emitted, a published event, an exported symbol, a test title — and the gate
asserts those exist. Mutation-verified both ways: renaming `findAvailability` fails
`P1-20-BE-002`; renaming the npm script or unwiring it from `ci.yml` fails `P1-20-DO-001`.

## Operations, contract parity and coverage

| Item                                              | Value                                                                   |
| ------------------------------------------------- | ----------------------------------------------------------------------- |
| Registered P1-20 operations                       | **17**                                                                  |
| At genuine operation depth                        | **17/17**                                                               |
| Pending / unit-only / metadata-only               | **0 / 0 / 0**                                                           |
| Invocation-only / unreferenced                    | **0 / 0**                                                               |
| OpenAPI                                           | **155 paths / 185 operations** (baseline 140 / 168)                     |
| P1-20 operations in OpenAPI                       | **17** — parity verified in both directions, scopes matching the routes |

| Operation                        | Method | Path                                                             | Permissions                                  | Scope       |
| -------------------------------- | ------ | ---------------------------------------------------------------- | -------------------------------------------- | ----------- |
| `svc.service-list`               | GET    | `/services`                                                      | `svc.service.read`                           | tenant      |
| `svc.service-create`             | POST   | `/services`                                                      | `svc.service.manage`                         | tenant¹     |
| `svc.service-update`             | PATCH  | `/services/{serviceId}`                                          | `svc.service.manage`                         | tenant¹     |
| `svc.service-version-publish`    | POST   | `/services/{serviceId}/versions/{versionId}/publication`         | `svc.service.manage`                         | tenant¹     |
| `svc.branch-availability-set`    | POST   | `/services/{serviceId}/branch-availability`                      | `svc.service.manage`                         | **branch**  |
| `svc.price-list-list`            | GET    | `/price-lists`                                                   | `svc.price.read`                             | tenant      |
| `svc.price-list-create`          | POST   | `/price-lists`                                                   | `svc.price.manage`                           | tenant      |
| `svc.price-list-version-create`  | POST   | `/price-lists/{priceListId}/versions`                            | `svc.price.manage`                           | tenant      |
| `svc.price-rule-record`          | POST   | `/price-lists/{priceListId}/versions/{versionId}/rules`          | `svc.price.manage`                           | **branch**  |
| `svc.price-list-version-publish` | POST   | `/price-lists/{priceListId}/versions/{versionId}/publication`    | `svc.price.publish`                          | tenant¹     |
| `svc.price-resolve`              | GET    | `/prices`                                                        | `svc.price.read`                             | **branch**  |
| `quo.quotation-create`           | POST   | `/quotations`                                                    | `quo.quotation.manage`, `wo.work_order.read` | **branch**  |
| `quo.quotation-detail`           | GET    | `/quotations/{quotationId}`                                      | `quo.quotation.read`                         | **branch**  |
| `quo.quotation-revision-create`  | POST   | `/quotations/{quotationId}/revisions`                            | `quo.quotation.manage`                       | **branch**  |
| `quo.quotation-issue`            | POST   | `/quotations/{quotationId}/issue`                                | `quo.quotation.manage`                       | **branch**  |
| `quo.quotation-item-decide`      | POST   | `/quotation-items/{quotationItemId}/decisions`                   | `quo.decision.record`                        | **branch**  |
| `quo.quotation-revision-decide`  | POST   | `/quotation-revisions/{revisionId}/decisions`                    | `quo.decision.record`                        | **branch**  |

¹ `tenant` in the registry because a service definition and a price list carry no company or
branch, **plus an explicit tenant-wide authority check in the handler** — a `scope: 'tenant'`
declaration alone degrades to a scope-blind check under `P1-18-A-01`. See Authorization.

## The service-catalog mutation surface

Built late in the phase, after an independent audit read the protected contract and found the
gap. `docs/phase-1/phase-1-10/p1-20-backend-contract.md` lists "Manage a service catalog"
(`svc.services` / `svc.service_categories` INSERT/UPDATE) and "Publish a service version"
(`svc.publish_service_version`) as P1-20 deliverables. The phase had shipped the READ surface
only, and had recorded the three orphaned audit actions as an *accepted limitation*
(`P1-20-A-04`) on the false premise that the contract excluded mutation.

That limitation is **withdrawn**, not re-worded. Four operations now implement the surface, all
on the already-seeded `svc.service.manage` — no new permission, no seed change, no migration —
and all three catalogued audit actions (`svc.service.updated`,
`svc.service_version.published`, `svc.branch_availability.changed`) now have producers.
`service.published` moved from reserved to `implementedIn: 'P1-20'`.

Reclassifying unbuilt required scope as an accepted limitation is the single worst failure in
this phase's evidence. It is recorded in `open-decisions.md` under its own identifier rather
than edited out.

## Financial correctness

The CHECK constraints already fix the policy, so nothing here is a business decision this phase
made:

```
captured_tax_amount  = round(((unit * qty) - discount) * rate, 4)
captured_line_total  = round(((unit * qty) - discount) + tax_amount, 4)
captured_grand_total = (subtotal - discount_total) + tax_total   -- exact, unrounded
```

Tax is **per line**, discount is applied **before** tax, tax is **exclusive**, rounding is
`round(…, 4)`. PostgreSQL `numeric` is the only calculation engine: the insert writes those
exact expressions with every parameter cast to its column's precision and scale, so the engine
and the validator are the same thing and cannot disagree.

| Invariant                             | How it holds                                                                                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No float in the money path            | zero `parseFloat`/`Number(`/`Math.round`/`toFixed`/`Math.floor`/`Math.ceil` in the three modules; the only `parseFloat` strings in `src/` are comments saying why     |
| `parseInt` scope                      | five uses, all `Number.parseInt(_, 10)` on integer COUNTS — never on money                                                                                            |
| Money crosses as decimal STRINGS      | asserted positively (`"unitPrice":"100.0000"`) and negatively (no unquoted `100`)                                                                                     |
| `numeric` never becomes a float       | every money column selected `::text`; a unit test pins `pg`'s OID-1700 parser, and a second records that `numeric[]` IS parsed to floats and asserts none is selected |
| `Σ round(baseᵢ,4) = round(Σ baseᵢ,4)` | not an identity — a line whose `unit × qty` is inexact at scale 4 is refused naming the field, instead of failing later inside `quo.issue_revision` as a 500          |
| Splitting defeats neither gate        | the document is authorized through the same `authorize` call a single line of that size would take — same policy, same ceiling, same maker/approver rule              |
| Approval limits respect grant scope   | a role's ceiling counts only in a company its grant reaches                                                                                                            |
| No FX, ever                           | `Money` exposes no `convert`/`add`/`multiply`, asserted by absence; a cross-currency comparison is a deterministic refusal                                             |
| Deterministic selection               | `svc.resolve_price` specificity then priority; a tie is structurally impossible under `uq_price_rules_signature`                                                       |
| Issued revisions immutable            | proven by republishing the price list at five times the amount after issue and asserting the captured columns do not move                                              |
| Accepted quotations never expire      | the sweep tests the PARENT state, because a revision stays `issued` after every line is approved                                                                       |
| Standard labour time                  | protected `numeric(10,2)` minutes; resolved from the published service version, never recomputed client-side                                                            |

## Authorization and isolation

Every route authenticates, declares a named permission, derives tenant/company/branch
server-side, and authorizes a concrete scope target. No route trusts a client-supplied actor,
tenant, company or branch.

**Tenant-wide writes need tenant-wide authority.** Authorizing the selector protects the narrow
case and leaves the broad one open: a price rule with no company and no branch is a WILDCARD
that `svc.resolve_price` applies to every branch, and an empty target makes
`requiresScopedEvaluation` return false whatever the declared scope. A wildcard rule, a price
publication, and every service-definition write therefore require an `unrestricted` grant —
asked of the deployed `iam.has_permission_in_scope` with an all-NULL target, which only
`scope_mode = 'unrestricted'` can satisfy. A branch-scoped actor keeps the ability to write
rules for its own branch and to set branch availability for a branch it holds, so the control
discriminates rather than blanket-refusing.

**An isolation test only counts if the principal holds the operation's own permission.** A 403
from a missing permission proves nothing about scope, and a scope-blind implementation produces
the same 403. Every cross-branch case uses a principal holding the operation's permission in
full, scoped to branch A2, plus a widening grant putting A1 in its `iam.allowed_branch_ids()`
union — so the row is readable and the permission is held, and a scope-blind check would
**allow** the request.

Citing a quotation revision on a P1-19 additional-work approval requires `quo.quotation.read`,
checked where it arises rather than declared on the operation, because `permissions` is a
conjunction and an approval citing no quotation must not need a commercial permission. This is
the one behaviour change to a closed phase, and it is recorded rather than smuggled.

## Concurrency, idempotency, audit and outbox

Raced issue and raced opposite item-decisions are driven with `Promise.all` against one row:
exactly one winner, exactly one outbox row. Every write refuses a missing `Idempotency-Key`;
`versionGuarded` operations refuse a **wrong** `If-Match`, not merely a missing one. Event keys
are deterministic and row-id-based, so a retry collides rather than double-publishing. Every
error code any P1-20 path can return is in the controlled catalog — reconciled independently,
zero uncatalogued.

Rollback is proved by failures forced **after** writes, never by pre-check refusals:

- **issue** — the outbox key is pre-taken, so `publishEvent` raises after the revision moved to
  `issued`, `current_revision_id` was repointed and the audit record was written.
- **revision decide** — a mid-loop conflict, after line one's decision was already inserted.
- **create** — `uq_quotations_number` fires after the sequence allocation, and the allocated
  number goes back. `shared.next_display_number()` runs in the request transaction, so a failed
  create burns no quotation number and leaves no gap in a customer-facing sequence.

## Reviews and audit

| Pass                      | Scope                            | Outcome                                                                        |
| ------------------------- | -------------------------------- | ------------------------------------------------------------------------------ |
| 1–4                       | the feature branch               | 5 Highs, 9 Mediums, 7 Lows — all closed                                        |
| 5                         | the remediation commit `0096560` | 13 findings (0C / 2H / 5M / 6L) — all closed                                   |
| Hostile 100/100 audit     | full diff `0d86a19..final`       | **101 claimed · 77 CONFIRMED · 24 overstated or refuted**                      |
| Audit synthesis           | consolidation of the confirmed set | **39 distinct findings — 6 High, 11 Medium, 22 Low**; all 6 Highs closed      |
| Post-fix verification     | the fixes themselves             | 2 further Highs found against my own fix — both closed                         |

**Unresolved Critical: 0. Unresolved High: 0.**

Full disposition register: `docs/phase-1/phase-1-20/evidence/review-dispositions.md`; confirmed
gap register preserved point-in-time at `hostile-audit-confirmed-gaps.md`. Every finding was
reproduced before it was touched; nothing was implemented on a suggestion alone.

One correction worth naming: an earlier revision of the gap register said 41 confirmed. That
was my own arithmetic, taken by pairing verdicts to gaps in completion order before the run
finished, and it was wrong — which is exactly the failure mode that file warns about. The
figures above are the run's own.

## Test totals

| Suite    | Development database (reset, serial) | Clean room (empty PostgreSQL 17.10) |
| -------- | ------------------------------------ | ----------------------------------- |
| Unit     | **903** / 42 files                   | **903**                             |
| Backend  | **1264** / 56 files                  | **1264**                            |
| Database | **1610** / 136 files                 | **1610**                            |

P1-20's own tests, 228 in total: service catalog 54 · pricing 46 · quotation 70 ·
additional-work link 12 · unit decimal 26 · unit discount authorization 20.

Two suites must never run against one database at once — every DB-backed suite truncates the
shared tenant fixtures in `beforeAll`, so concurrent runs delete each other's roles and grants
and the failures surface nowhere near the cause. Figures taken during such a collision were
discarded rather than recorded, and the totals above come from a serial run against a freshly
reset database.

## Clean room

Fresh `postgres:17-alpine` (**PostgreSQL 17.10**), verified empty first, 119 migrations applied
cleanly, seeds applied twice with identical counts and five exact retention classes and **no
manual repair**, structural review **PASS** (537 FKs validated, no runtime-reachable
destructive cascade, complete FK index coverage, no duplicate indexes, zero dictionary drift),
`schema_hash` unchanged before and after all three suites, worktree unchanged by the run.
Structural posture identical to the frozen baseline: 17 schemas · 242 tables · 3562 columns ·
212 functions.

## Accepted limitations — nine Low open, one withdrawn

`docs/phase-1/phase-1-20/evidence/open-decisions.md`:

- `P1-20-A-01` availability has no effective period
- `P1-20-A-02` no branch override for labour time
- `P1-20-A-03` `decided_by` is the recording staff user
- `P1-20-A-04` — **WITHDRAWN.** This was a defect reclassified as a limitation; see the
  mutation-surface section above.
- `P1-20-A-05` expiry has no scheduler
- `P1-20-A-06` no alert-routing destination is provisioned
- `P1-20-A-07` the price-ambiguity guard is structurally unreachable and mirrors protected SQL
- `P1-20-A-08` price-list reads are bounded rather than paged
- `P1-20-A-09` three module cycles pre-date this phase and no gate refuses them
- `P1-20-A-10` an idempotent replay answers 200 even where the first attempt answered 201
  (platform-wide since P1-15, not introduced here)

## Open scope gaps

`P1-20-G-01` — the missing service-catalog mutation surface — is **CLOSED** by the four
operations above. Two narrower gaps replace it and stay open, both Low, each naming the
protected column whose policy nothing in the catalog decides:

- `P1-20-G-02` — no public write path for `svc.service_categories`
- `P1-20-G-03` — no public create path for a draft `svc.service_versions` row

## Out of scope, verified absent

No Benzene hard-coding in `src/`; no Zoom functionality; the product name remains
`[PRODUCT NAME — Pending Final Approval]`; no P1-21 inventory reservation or issue (no `inv.`
access from any P1-20 module); no P1-22 invoicing or billing (no `sal.` access). Enforced by
`scripts/check-scope-exclusions.mjs` over **1,280 tracked files**.

## Hosted CI

**All four required checks green on `e7462536d183e410ff2db9792c7a6090df7f4698`** — the exact
head being merged. 8 jobs succeeded, 0 failed, 0 running; no conflicts with the base branch.

The one hosted failure this branch saw (CI #265) was `npm run validate:p1-19-inventory`
reporting a stale document after the platform-wide registry total moved 181 → 185. It was
diagnosed from the actual job log rather than inferred, and fixed by regenerating the P1-19
inventory. Root cause on my side: I had been running only `validate:p1-20-inventory` locally,
so a cross-phase gate went unexercised until CI ran it.
