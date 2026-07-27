# Phase 1-20 Gate — Service Catalog, Pricing, and Quotation Backend

**Phase:** 1-20 — Service Catalog, Pricing, and Quotation Backend · **Gate package:** post-merge gate record ·
**Review model:** the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)
under the [Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md).
**This is not an independent third-party review and is never represented as one.**
**Date opened:** 2026-07-27 · **Date decided:** 2026-07-27 (Asia/Amman).

---

## Decision: **Go — P1-20 Service Catalog, Pricing, and Quotation Backend Gate Passed**

Decided against the protected merge commit `db7ef97a4c1e090911e22ddac5936f725470f084`,
not against any local candidate. Every number below was produced by a command run on that
commit or by the authoritative CI for it, and is recorded in `evidence/`.

**There is no preserved Pending record for this phase.** As in P1-19, no owner gate
document existed before this one; this record is the first and only gate document for
P1-20, and nothing was superseded in writing it.

## 1. What this gate governs

The commercial backend on the frozen Phase 1-10 `svc` and `quo` schemas: the
service-catalog read **and mutation** surface — service create, update, version
publication and branch availability — with standard labour time; the price-list lifecycle
with forward-only publication; deterministic price and tax resolution; discount
authorization against both a policy threshold and the actor's own approval ceiling;
quotation creation, revision, issue and expiry; item-level and revision-wide customer
decisions with approval evidence; and the additional-work commercial link into the P1-19
approval path.

It governs no database change. **P1-20 adds no migration.** It does change one seed file.

## 2. Verified state at decision

| Anchor                   | Value                                                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `origin/develop`         | `db7ef97a4c1e090911e22ddac5936f725470f084` (PR #84 merge)                                                                    |
| Merge parents            | `0d86a198ad1d13aa0b3219a8f6ecafea3a699cf0` + `e7462536d183e410ff2db9792c7a6090df7f4698`                                      |
| Merge tree               | `dc644ea5821d1a8c7da8efd22ddf924cf15d31bf` — **byte-identical** to `e746253^{tree}`; `git diff` merge↔head is empty          |
| Reviewed feature SHA     | `e7462536d183e410ff2db9792c7a6090df7f4698`                                                                                   |
| Clean-room SHA           | `e7462536d183e410ff2db9792c7a6090df7f4698` — the reviewed head itself                                                        |
| Commits entering         | 30 — 29 feature commits plus the merge; **no commit reachable from `develop` that is not reachable from `e746253`**          |
| `origin/main`            | `491c4e0882763b5d5864737e63b4e31ca708a6b5` — untouched; P1-20 is **not** on `main`                                           |
| Authoritative CI         | Push run **#267** (`30296722364`) — event `push`, branch `develop`, SHA `db7ef97`, **Success 4/4, 6m 50s**                   |
| Merged                   | PR #84 (feature), PR #85 (gate record)                                                                                       |
| Diff                     | 77 files, +25,384 / −413 — src 41, docs 19, tests 12, scripts 2, supabase 1, `package.json`, `ci.yml`                        |
| Migrations               | **119** — none added, none modified, no `120`                                                                                |
| Only `supabase/` change  | `seeds/04_iam_permission_catalog.sql` (+12 / −1) — 3 permission codes, 93 → **96**                                           |
| Clean-room `schema_hash` | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c` — byte-identical to the frozen P1-17/P1-18/P1-19 baseline |
| Test totals              | Unit **903** · Backend **1264** · DB **1610**                                                                                |
| Operations               | **17**, all at operation depth, **0 pending**                                                                                |
| OpenAPI                  | **155 paths / 185 operations** — exact P1-20 parity in both directions                                                       |
| Tasks                    | **27 / 27** — BE 14, SEC 4, QA 5, DO 2, DOC 2                                                                                |

## 3. Conditions

All 24 conditions verified on `db7ef97a`. Evidence paths are relative to
`docs/phase-1/phase-1-20/`.

| #   | Condition                                                                                                       | Status  | Verified by                                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Feature branch based on protected `develop`, merged with a byte-identical tree                                  | **Met** | Merge parents `0d86a19` + `e746253`; merge tree `dc644ea5…` equals `e746253^{tree}`; zero-file diff                             |
| 2   | No migration added or modified; 119 migrations, no migration 120                                                | **Met** | `git diff --name-status 0d86a19 db7ef97 -- supabase/migrations` empty; clean room applies 119 from empty                        |
| 3   | The one seed change is additive structural reference data and is stated, not hidden                             | **Met** | `evidence/clean-room-validation.md`; `iam.permissions` 93 → **96**; idempotent under `ON CONFLICT (permission_code) DO NOTHING` |
| 4   | All 27 tasks (BE 14, SEC 4, QA 5, DO 2, DOC 2) delivered and mapped to artifact evidence                        | **Met** | `evidence/task-register.md`; `validate:p1-20-inventory` reconciles all 27 against artifacts, not prose — see §4                 |
| 5   | Every operation registered with permissions, scope, audit class and action                                      | **Met** | Generated `evidence/endpoint-inventory.md` — 17 operations, 8 published events                                                  |
| 6   | Permission, event, audit-action and error catalogs synchronized and reconciled in CI                            | **Met** | `validate:p1-20-inventory` — code→seed both directions; 3 permissions, 8 events, catalogued audit actions all with producers    |
| 7   | Operation coverage: 17 registered == 17 operation-depth; 0 pending / invocation-only / unit-only / unreferenced | **Met** | `validate:operation-coverage` on `db7ef97`                                                                                      |
| 8   | Contract parity: every P1-20 route published in OpenAPI and every published operation guarded                   | **Met** | `validate:openapi` — 155 paths / 185 operations, structurally valid, every operation guarded                                    |
| 9   | Financial calculation is exact decimal end to end, with no authoritative floating-point path                    | **Met** | `evidence/qa-evidence.md`; `tests/unit/p1-20-decimal.test.ts` pins `pg`'s OID-1700 parser and the `numeric[]` float hazard      |
| 10  | Tax, discount ordering and four-decimal rounding match the protected CHECK constraints                          | **Met** | The insert writes the constraint expressions themselves, so engine and validator cannot disagree — see §5                       |
| 11  | Discount authorization enforces both a policy threshold and the actor's own approval ceiling                    | **Met** | `tests/unit/p1-20-discount-authorization.test.ts`; `tests/backend/p1-20-quotation.test.ts`; unparseable threshold fails closed  |
| 12  | Maker/approver separation, and a document-level aggregate cannot be split to evade either gate                  | **Met** | The document is authorized through the same `authorize` call a single line of that size would take                              |
| 13  | Issued quotation revisions are immutable snapshots                                                              | **Met** | Proven by republishing the price list at five times the amount after issue and asserting captured columns do not move           |
| 14  | Tenant-wide writes require tenant-wide authority; no `scope` declaration is inert                               | **Met** | `evidence/security-review.md`; `callerHoldsPermissionTenantWide` asks the DEPLOYED `iam.has_permission_in_scope` — see §6       |
| 15  | Cross-branch isolation proved with principals holding the operation's own permission in full                    | **Met** | `evidence/qa-evidence.md`; every case adds a widening grant so a scope-blind check would **allow** the request                  |
| 16  | Idempotency: every write refuses a missing key; `versionGuarded` writes refuse a wrong `If-Match`               | **Met** | `evidence/qa-evidence.md`; replays asserted, not assumed                                                                        |
| 17  | Concurrency and rollback proved by failures forced **after** writes, not by pre-check refusals                  | **Met** | Raced issue and raced opposite item-decisions via `Promise.all`; three forced post-write failures                               |
| 18  | Audit and outbox are atomic with the write and deterministic on replay                                          | **Met** | Event keys are row-id-based; a retry collides rather than double-publishing                                                     |
| 19  | Security review (SEC-001…004), zero Critical and zero High outstanding                                          | **Met** | `evidence/security-review.md`; `evidence/review-dispositions.md`                                                                |
| 20  | Independent adversarial reviews and a hostile completeness audit resolved                                       | **Met** | `evidence/hostile-audit-confirmed-gaps.md` — 101 claimed / 77 confirmed / 39 findings (6H, 11M, 22L); all Highs closed          |
| 21  | Required scope was not reclassified as an accepted limitation                                                   | **Met** | `P1-20-A-04` **withdrawn** and `P1-20-G-01` **closed** by building the surface — see §7                                         |
| 22  | Exact-SHA PostgreSQL 17 clean room from an empty database                                                       | **Met** | `evidence/clean-room-validation.md` — PG 17.10, 119 migrations + seeds twice, `schema_hash a677eb05…` before and after          |
| 23  | Feature pull request open to `develop`, conflict-free, all hosted checks green on the exact head                | **Met** | PR #84 — 4/4 green on `e746253`, "No conflicts with base branch"                                                                |
| 24  | Authoritative protected push CI green on the merge SHA, and `origin/main` untouched                             | **Met** | Run **#267** (`30296722364`) — push, `develop`, `db7ef97`, **Success 4/4, 6m 50s**; `origin/main` = `491c4e0`                   |

## 4. The task gate took four attempts, and the first three were vacuous

Recorded because the failure is instructive and because three green gates preceded the
real one.

`P1-20-BE-002` is a project-management label, not a code symbol. It can only ever appear
in a **comment**, so any gate that searches the repository for the identifier is
satisfiable by writing the identifier down. Three versions did exactly that, and each fix
only moved which comment counted: first the generator's own output, then
`evidence/task-register.md` (which prints all 27 in its tables, so deleting every P1-20
source file would still have reported 27/27), then the gate script's own header comment.

The fourth version stops asking the question. Each task names the **artifacts** it
produced — a registered operation, a permission both seeded and declared, an audit action
both catalogued and emitted, a published event, an exported symbol, a test title — and
the gate asserts those exist. A comment cannot register an operation, seed a permission,
produce an audit action, publish an event, export a symbol, or name a test.

Both directions are mutation-verified: renaming `findAvailability` fails `P1-20-BE-002`;
renaming the npm script or unwiring it from `ci.yml` fails `P1-20-DO-001`.

## 5. Financial correctness — the constraints are the policy

The protected CHECK constraints already fix the policy, so nothing here is a business
decision this phase made:

```
captured_tax_amount  = round(((unit * qty) - discount) * rate, 4)
captured_line_total  = round(((unit * qty) - discount) + tax_amount, 4)
captured_grand_total = (subtotal - discount_total) + tax_total   -- exact, unrounded
```

Tax is per line, discount is applied before tax, tax is exclusive, rounding is
`round(…, 4)`. PostgreSQL `numeric` is the only calculation engine: the insert writes
those exact expressions with every parameter cast to its column's precision and scale.

Two results are worth separating from the rest:

- **`Σ round(baseᵢ,4)` is not `round(Σ baseᵢ,4)`.** A line whose `unit × qty` is inexact
  at scale 4 is refused, naming the field, instead of failing later inside
  `quo.issue_revision` as a 500. The worked `1.0001 × 1.500` counter-example reproduces
  against the deployed constraints.
- **`pg` parses `numeric[]` (OID 1231) elements as JavaScript numbers** while it returns
  scalar `numeric` (OID 1700) as a string. A unit test records that asymmetry and asserts
  no money column is ever selected as an array.

## 6. Authorization — a scope declaration is not an enforcement

`P1-18-A-01` is the governing fact: `requiresScopedEvaluation` returns false on an empty
authorization target **whatever scope the operation declares**, so a `scope: 'tenant'`
declaration on a write with no company and no branch degrades to a scope-blind check.

Authorizing the selector protects the narrow case and leaves the broad one open. A price
rule with no company and no branch is a **wildcard** that `svc.resolve_price` applies to
every branch. A wildcard rule, a price-list publication, and every service-definition
write therefore require an `unrestricted` grant, asked of the deployed
`iam.has_permission_in_scope` with an all-NULL target — which only
`scope_mode = 'unrestricted'` can satisfy.

The control discriminates rather than blanket-refusing: a branch-scoped actor keeps the
ability to write price rules for its own branch and to set branch availability for a
branch it holds.

One behaviour change reaches a closed phase and is recorded rather than smuggled: citing
a quotation revision on a P1-19 additional-work approval now requires
`quo.quotation.read`, checked where it arises rather than declared on the operation,
because `permissions` is a conjunction and an approval citing no quotation must not need
a commercial permission.

## 7. The finding this phase should be judged on

An independent hostile audit read `docs/phase-1/phase-1-10/p1-20-backend-contract.md` —
the only committed protected contract for this phase — and found that it lists **"Manage
a service catalog"** (`svc.services` / `svc.service_categories` INSERT/UPDATE) and
**"Publish a service version"** (`svc.publish_service_version`) as P1-20 deliverables.

The phase had shipped the service-catalog **READ** surface only, and had recorded the
three resulting orphaned audit actions as an accepted limitation, `P1-20-A-04`, on the
stated premise that "the protected requirements mandate no public mutation". That premise
was false. The audit's own suggested minimal fix — restate `P1-20-BE-001` as read-only
and accept the limitation — was **not taken**.

**Resolution.** `P1-20-A-04` is withdrawn and `P1-20-G-01` is closed by building the
surface: `svc.service-create`, `svc.service-update`, `svc.service-version-publish` and
`svc.branch-availability-set`, all on the already-seeded `svc.service.manage` — no new
permission code, no seed change, no migration. Publication **calls**
`svc.publish_service_version` rather than reimplementing succession. All three catalogued
audit actions now have producers and `service.published` moved from reserved to
`implementedIn: 'P1-20'`.

Reclassifying unbuilt required scope as an accepted limitation is the single worst
failure in this phase's evidence. It is recorded under its own identifier in
`evidence/open-decisions.md` rather than edited out.

## 8. Findings disposition

| Review                                  | Raised | Confirmed | Critical | High  | Medium | Low | Outstanding |
| --------------------------------------- | ------ | --------- | -------- | ----- | ------ | --- | ----------- |
| Passes 1–4 (feature branch)             | —      | 21        | 0        | 5     | 9      | 7   | 0           |
| Pass 5 (remediation commit `0096560`)   | 13     | 13        | 0        | 2     | 5      | 6   | 0           |
| Hostile 100/100 completeness audit      | 101    | 77        | 0        | **6** | 11     | 22  | 0           |
| Post-fix verification (of my own fixes) | —      | 2         | 0        | **2** | 0      | 0   | 0           |

**Zero unresolved Critical. Zero unresolved High.**

Two corrections to my own evidence belong in the record:

- An earlier revision of the gap register said **41 confirmed**. That was my own
  arithmetic, taken by pairing verdicts to gaps in completion order before the run
  finished, and it was wrong. The run's own figures are 101 claimed / 77 confirmed /
  39 consolidated findings, and `evidence/completeness-audit.md` is authoritative.
- The `lineBase` scale-7 regression was introduced by **my own earlier fix**, not by the
  original implementation, and would have 500ed the ordinary case. The post-fix
  verification pass found two further Highs against my own remediation.

## 9. What this phase actually established

- **A gate that reports success on an empty requirement set is worse than no gate**,
  because it is cited as evidence. Extending `parseProvidedFlags` to accept `svc|quo`
  made the coverage gate _look_ extended while `derivedRequirements()` returned `[]` for
  every operation.
- **A task identifier can only ever live in a comment**, so artifact proofs are the only
  non-vacuous form of task traceability.
- **Two DB-backed suites must never run against one database concurrently** — every suite
  truncates the shared tenant fixtures in `beforeAll`, so concurrent runs delete each
  other's roles and grants and the failures surface nowhere near the cause. Figures taken
  during such a collision were discarded rather than recorded.
- **A cross-phase gate can go unexercised locally.** The one hosted failure on this
  branch (CI #265) was `validate:p1-19-inventory` reporting a stale document after the
  platform registry total moved 181 → 185; only `validate:p1-20-inventory` had been run
  locally.
- **`shared.next_display_number()` is `SECURITY INVOKER`** and runs in the request
  transaction, so a failed quotation create burns no number and leaves no gap in a
  customer-facing sequence.

## 10. Decision record

| Item                 | Value                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------- |
| Decision             | **Go — P1-20 Service Catalog, Pricing, and Quotation Backend Gate Passed**                   |
| Decided on           | `db7ef97a4c1e090911e22ddac5936f725470f084` (protected `develop`)                             |
| Decided by           | Solo developer review under the Standing Technical Authorization Policy                      |
| Owner authorization  | Explicit, for the complete P1-20 technical closure flow including the protected merges       |
| Conditions           | 24 of 24 **Met**                                                                             |
| Unresolved Critical  | **0**                                                                                        |
| Unresolved High      | **0**                                                                                        |
| Accepted limitations | `P1-20-A-01`…`A-03`, `A-05`…`A-10` — nine Low, all Open and documented; `A-04` **withdrawn** |
| Open scope gaps      | `P1-20-G-02`, `P1-20-G-03` — both Low, both Open; `G-01` **closed**                          |
| Next phase           | P1-21 — Inventory. **Unblocked. Not started by this record.**                                |

## 11. Exclusions

This gate does **not** authorize:

- Promotion of `develop` to `main`. That is a founders' reserved decision under ADR-006
  and the Standing Technical Authorization Policy §5, and no part of this phase performs
  or requests it. P1-20 closes on protected `develop`.
- Any schema change, migration, grant, role or policy change.
- Inventory reservation or issue (P1-21). No P1-20 module reaches `inv.`.
- Invoicing or billing (P1-22). No P1-20 module reaches `sal.`.
- A public write path for `svc.service_categories` (`P1-20-G-02`) or a public create path
  for a draft `svc.service_versions` row (`P1-20-G-03`).
- Any frontend, or any Zoom capability.
- Any claim that this phase was independently reviewed by a third party, deployed,
  piloted, or accepted by a customer.
