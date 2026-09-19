# P1-31 — the report configuration seam (P-11, writer half)

What was published, why each shape is the shape it is, what was proved on real rows, and the two
things this slice deliberately leaves undone: the reporting engine, and the operator backfill.

|                              |                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| **Phase**                    | P1-31 — Vehicle Delivery, Warranty, and Reporting Frontend                                         |
| **Authority**                | Prerequisite **P-11** of [`a0-preflight.md`](./a0-preflight.md) — the WRITER half only             |
| **Lane**                     | `remediation/p1-31-backend-report-configuration-seam`, ownership profile `p1-31-backend`           |
| **Baseline**                 | protected `develop` **fc58f1c2** (#357, after P-10 #356) merged into this branch; `main` untouched |
| **Change control**           | [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) — section 34, **CC-20**           |
| **Closes no canonical task** | P-11 is an execution prerequisite. The 29 remain 29, each still owing its own evidence             |

---

## 1. The measured problem

`rpt.report_configurations` and `rpt.report_configuration_versions` landed in P1-11 carrying
`SELECT`, `INSERT` and `UPDATE` grants for `app_runtime` and a policy set for each — and **no code
anywhere in `apps/api/src` had ever written either one.** P1-23 shipped the two reads over them,
`rpt.report-catalogue` and `rpt.report-read`, and **both filter on `status = 'published'`**.

So the only rows those reads could return were rows nothing could create. Every tenant's report
catalogue was empty, and permanently so — not because the catalogue was new, but because the value
it selects on could never be set.

`rpt.report.configure` has been a seeded row in `supabase/seeds/04_iam_permission_catalog.sql`
since P1-08 and was **declared by no operation and named by no row-level-security predicate**. The
P1-23 repository names it in a comment as the authority for writes through `rpt.report.configure`
that did not exist — the "declared but never wired" defect this phase keeps finding, stated by the
code itself.

## 2. The seven operations

Every one declares **`rpt.report.configure`**, reads included. Two reads carry `auditClass: 'none'`;
five commands carry `auditClass: 'privileged'`.

| operation                                  | method | path                                                 | guards                         |
| ------------------------------------------ | ------ | ---------------------------------------------------- | ------------------------------ |
| `rpt.report-configuration-list`            | GET    | `/report-configurations`                             | paged, `status` filter         |
| `rpt.report-configuration-read`            | GET    | `/report-configurations/{configurationId}`           | versions ascending             |
| `rpt.report-configuration-create`          | POST   | `/report-configurations`                             | `idempotent`, 201              |
| `rpt.report-configuration-update`          | PATCH  | `/report-configurations/{configurationId}`           | `versionGuarded`               |
| `rpt.report-configuration-status-set`      | POST   | `.../{configurationId}/status`                       | `idempotent`, `versionGuarded` |
| `rpt.report-configuration-version-create`  | POST   | `.../{configurationId}/versions`                     | `idempotent`, 201              |
| `rpt.report-configuration-version-publish` | POST   | `.../{configurationId}/versions/{versionId}/publish` | `versionGuarded`               |

The register moves 397 → **404** operations, 309 → **314** paths, 227 → **232** audit actions,
measured on the merged tree after P-10 (#356) landed ahead of this slice (measured 2026-09-09 at the
P-11 writer's merge; not re-measured here). Five route modules; two of
them carry two verbs, which is why the two counts move by seven and five.

### Why the reads declare the CONFIGURE code and not the READ code

This is the one place P-11 departs from the P-9 and P-10 seams beside it, where the read code and
the write code differ. It departs because **the rows are different rows.**

This surface returns DRAFTS, ARCHIVED definitions and every VERSION of each — decisions that are
unfinished and decisions that were withdrawn. A `rpt.report.read` holder sees published definitions
through `/reports`, which is the whole of what that code was minted for. Gating this list on the
read code would publish the tenant's unfinished and withdrawn decisions to everyone who may open a
report, which is precisely the visibility the `status` column exists to control.

### Why the collection is top-level and names no company

Because the TABLE names none. `rpt.report_configurations` carries a `tenant_id` and no `company_id`
and no `branch_id`, and `sel_report_configurations_scope` is `tenant_id = iam.current_tenant_id()`
with no other term. `scope_level` — `branch`, `company` or `tenant` — describes how wide the FIGURES
a report answers with may be, not who owns the definition, and no operation published here reads it:
P-11 publishes no engine.

## 3. The permission — nothing was minted

`rpt.report.configure` is a catalogue row from P1-08. This slice adds no seed row, no migration and
no new code; it is the first thing in the product to DECLARE the code.

## 4. How the authority is scoped — the tenant-wide re-check

`scope: 'tenant'` on all seven, and every handler re-checks with
`callerHoldsPermissionTenantWide(db, 'rpt.report.configure')` before it calls the service.

That second check is not belt-and-braces. A declared scope with no target degrades to the
scope-blind `iam.has_permission` (**P1-18-A-01**), and these rows carry no company and no branch to
narrow against — so without the re-check an actor granted the code in ONE BRANCH would read every
draft and every withdrawn definition in the tenant, and could consume a tenant-wide report code
permanently: `uq_report_configurations_code` is unique per tenant and
`tg_report_configurations_immutable` then freezes it. The precedent is W1's
`service-categories/route.ts:161`.

## 5. Absence, and what a 404 means here

`#requireConfiguration` answers `ERR-RES-001` for a row that is absent and for a row that belongs to
another tenant alike, because the read that decides is the tenant-scoped one — an authorized caller
cannot learn that a report code exists somewhere else by the shape of its refusal.

## 6. The constraints this surface maps, and the ones it does not invent

| database refusal                                        | mapped to                                                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `23505` on `uq_report_configurations_code`              | `ERR-CON-001`, `body.reportCode` / `duplicate_code`                                                |
| `23503` on `fk_report_configurations_permission`        | `ERR-VAL-001`, `body.exportPermissionCode`                                                         |
| `23505` on `uq_report_configuration_versions_published` | `ERR-CON-001`, `path.versionId` / `version_already_published`                                      |
| `23514` from `rpt.guard_report_version_freeze`          | `ERR-CON-001`, `path.versionId` / `version_immutable`                                              |
| a `record_version` predicate that matched no row        | `ERR-CON-001` on a stale `If-Match`; an absent `If-Match` is `ERR-CON-002` before the handler runs |

The freeze guard raises with `ERRCODE = 'check_violation'` and therefore carries no constraint name,
so the mapping reports the only update this surface can send to an already-published version: a
repeat publication. The suite exercises that refusal rather than reasoning about it.

**No rule the schema does not encode was added.** In particular there is no "a configuration must
have a published version before it may be published" rule: the schema states no such thing, the two
reads select the configuration status and the version status independently, and inventing the
coupling here would be a report-lifecycle decision nobody has taken.

`export_permission_code` is REQUIRED on create, and that is a transcription rather than a choice:
the column is `NOT NULL` with no default. It names the permission an EXPORT of the report would
require, never the permission to view it.

## 7. `parameter_schema` — bounded in SHAPE and in VOCABULARY

The frozen schema constrains the column in no way at all: `jsonb NOT NULL DEFAULT '{}'`, no CHECK,
no domain, no trigger over its content. The version route bounds the SHAPE — a JSON object, at most
64 top-level keys, each key non-empty and at most 120 characters, at most 16 KiB in the UTF-8
encoding of the serialized document — because a `jsonb` column a TENANT writes is otherwise a row
size the tenant chooses.

When this seam was written the vocabulary was deferred: what a filter key MEANS was part of the
report definition, which was Owner decision **D-4**, and validating a vocabulary here would have
been inventing the reports. That deferral is now closed. **Engineering consequence (not an Owner
decision):** D-4 approved a baseline of four reports and the columns each must carry; building an
engine to serve them is this programme's own choice, and that engine reads a published
`parameter_schema` before it runs a report and refuses a run whose schema it does not recognise. A
writer that accepted any bounded object while the engine accepted four filter names is a writer that
lets an administrator publish a definition nobody can then execute. So the route reads the same
definition the engine reads. The filter vocabulary set out below is engineering rather than any part
of D-4, and it lives on `remediation/p1-31-backend-report-engine-work-orders`, which is not merged.

### The vocabulary — Engineering consequence (not an Owner decision)

One function, `readReportParameterVocabulary`, in
`apps/api/src/modules/reporting/domain/report-configuration.ts`. It is the ONLY statement of the
vocabulary in the codebase; the version writer and the report engine both call it, so they cannot
disagree about what a schema means.

A `parameter_schema` is one of exactly three things:

| document               | meaning                                                                       |
| ---------------------- | ----------------------------------------------------------------------------- |
| `{}`                   | no restriction — the run may supply any filter the report accepts             |
| `{ "filters": { … } }` | an allowlist — the run may supply the named filters and no others             |
| anything else          | unrecognised — the engine refuses the run, the writer refuses the publication |

Under `filters`, four names and no others, each declaring exactly one key, `type`:

| filter      | type   | meaning                                 |
| ----------- | ------ | --------------------------------------- |
| `companyId` | `uuid` | the run may be narrowed to one company  |
| `branchId`  | `uuid` | the run may be narrowed to one branch   |
| `from`      | `date` | the run may set the start of its period |
| `to`        | `date` | the run may set the end of its period   |

Four because those are the four the engine implements. Adding a fifth is a change to the engine and
to this list in the same commit, and a unit case asserts the list so the two cannot separate.
Pagination is transport rather than a report filter, so no cursor or page-size name appears here.

### Why `{ "filters": {} }` is REFUSED at authoring and HONOURED at run time — Engineering consequence (not an Owner decision)

It is a well-formed document and its meaning is not in doubt: an allowlist permitting no filter at
all. The engine honours it exactly, and that behaviour is untouched — a version published before
this rule existed still runs precisely as it did, because changing the engine would change the
meaning of rows already in tenant databases.

The writer refuses it, and that is a decision rather than a transcription. `{}` already says "place
no restriction", so nobody reaches for the empty allowlist in order to say that; they reach for it
believing it says the same thing, and publishing it would instead narrow the report to nothing. The
refusal names the ambiguity at the one moment a person is present to resolve it, and it carries its
own rule, `empty_filter_allowlist`, rather than the vocabulary rule — a caller told "unrecognised"
would go looking for a spelling mistake that is not there.

Refusing rather than silently accepting is the choice, and it is the conservative one in the only
direction that matters: refusing a publication costs an administrator one corrected request, while
accepting it costs every reader of that report a refusal they cannot explain or fix.

### What the refusals do not say

Neither refusal quotes any part of the submitted document. A schema is tenant input, and a
validation message is the most commonly logged and most commonly displayed error text there is. The
message names the VOCABULARY, which is reference data, and the rule that was broken. A unit case
asserts that a schema whose keys are themselves sensitive produces a reason containing none of
them.

## 8. Money

`rpt` has no `numeric` column of any kind, so there is no money on this surface and the correct
assertion is not "the amounts are decimal strings" but "there are no amounts". The suite walks every
response document, `parameterSchema` included, and refuses a JSON number under any money-shaped key.
`versionNumber` and `recordVersion` are counters and are JSON numbers, which is what every counter
in this codebase is.

## 9. The bundle widening — CC-02, closed on its own terms

CC-02 withheld `rpt.report.configure` BECAUSE nothing declared it, and stated the rule for lifting
it: "the slice that publishes them owns the widening" — the `inv.item.manage` sequence, excluded
while no route declared it and added by #322 on the day three routes did. Seven operations now
declare it, so this slice carries it.

**On the merged tree the bundle moves 74 → 76** (measured 2026-09-09 at the P-11 writer's merge; not
re-measured here): 75 with `wty.policy.manage`, which P-10 carried on
the same rule the same day (**CC-01**), and 76 with `rpt.report.configure`. With both closed,
`rpt.export` is the only deliberate exclusion left, withheld on least-privilege grounds by the Owner
decision of 2026-09-08 (**CC-04**) rather than for want of a declarer.

Withholding the configure code now would be worse than withholding it was: both published report
reads filter on `status = 'published'`, and nothing but this code can set that value, so a freshly
provisioned administrator would hold a report catalogue it could never fill and could not delegate
the authority to anyone.

### The backfill this obliges, and does not perform

The bundle is written ONCE, inside `platform.organization-provision`, and nothing re-applies it.
Every organisation provisioned before these two slices holds neither new code.
`scripts/platform/backfill-tenant-administrator-bundle.mjs` parses `bootstrap-roles.ts` at run time
and therefore needs no edit to carry them.

**ONE operator run covers both newly approved codes** — `wty.policy.manage` and
`rpt.report.configure` — after this branch merges. It is not two runs, and it is emphatically not a
repeat of the #350 backfill: that run carried the P-1 and P-7 widenings and is complete. The script
preserves tenant customizations and denials rather than rewriting a role to the bundle.

**This slice did not run it, and no claim is made that any environment carries either code.**

## 10. The writer / engine split, and Owner decision D-4

P-11 as A0 states it asks for a report-configuration writer **and a report engine**. This slice
publishes the writer and deliberately not the engine. Everything in this section describes `develop`
before `remediation/p1-31-backend-report-engine-work-orders` merges; that branch implements engine
slice 1 of 4 and is unmerged.

The reason is not sequencing convenience. `ReportDefinitionView.executable` is the literal `false`
in P1-23 because the frozen reporting schema **binds no data source to a report code** — there is no
dataset table, no formula and no field-to-column mapping anywhere in an approved migration. An
engine built on this schema today would have to invent what each report means, which is the one
thing the no-fabrication rule forbids. `executable: false` is therefore left exactly as it is BY
THIS SLICE, and remains the literal on `develop` until the engine branch merges, where it becomes
dataset-registry membership.

**The Owner decided D-4 on 2026-09-09**: a baseline of four reports, named here as the codes they
will be addressed by — `work_orders_by_status`, `technician_labor_time`, `inventory_movements` and
`invoice_payment_summary` — with the field-to-contract mapping for each **to follow in the engine
slice**. Nothing about that baseline is implemented, seeded or assumed here: the four codes are
recorded as an Owner decision, not written into a migration, a seed, a constant or a test, and this
surface accepts any code matching `ck_report_configurations_code` exactly as the schema does.

## 11. What was proved, on real rows

| id         | what was shown                                                                                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P11-1**  | `tests/backend/p1-31-report-configuration-seam.test.ts` — every configuration and version authored THROUGH THE ROUTES, with no admin SQL seeding of either table                    |
| **P11-2**  | create; a duplicate report code refused naming the field; an unknown export permission code refused as `ERR-VAL-001`; a body naming `id`, `status` or `ownerUserId` refused         |
| **P11-3**  | the version guards — `If-Match` absent 428, stale 409 with the row unchanged, success advancing by exactly one, a one-field patch leaving the rest alone                            |
| **P11-4**  | the status command through every value the CHECK allows, in both directions, and a value outside that vocabulary refused                                                            |
| **P11-5**  | versions numbered 1 then 2 and listed ascending; publication stamping `published_at`; a second publication refused; a published version proved immutable through the mapped refusal |
| **P11-6**  | the catalogue interplay — a published configuration with a published version appears in `GET /reports` with `executable: false`, and a draft never does                             |
| **P11-7**  | a `rpt.report.read`-only caller refused `ERR-IAM-001` on every one of the seven, and a branch-scoped configure holder refused by the tenant-wide re-check                           |
| **P11-8**  | another tenant sees none of these definitions and receives 404 rather than 403 on every one                                                                                         |
| **P11-9**  | idempotent replay on each reserving command — one key, one row, one audit record                                                                                                    |
| **P11-10** | the bundle delta measured against the generated P1-24 register: more than zero declarers for every added code, and the undeclared-exclusion list now empty                          |

## 12. What this does not close

- **The reporting ENGINE.** On `develop`, before the engine branch merges, no report can be run and
  `executable` is still the literal `false`. The D-4 baseline above is an Owner decision; slice 1 of
  the engine that serves it is implemented on
  `remediation/p1-31-backend-report-engine-work-orders` (PR #364) and is unmerged, and slices 2–4
  have not started.
- **P-12, the export surface.** There is no `POST /reports/{reportCode}:export` route, and
  `rpt.export` remains withheld from the bundle (**CC-04**).
- **FE-010 … FE-016.** The Frontend items this seam unblocks are untouched by this seam and by the
  engine branch alike; both are Backend work and publish no screen.
- **`rpt.saved_filters`.** It has no writer either. `ck_saved_filters_scope_within_report` is where
  `scope_level` acquires its enforcement, and nothing here reads or writes that table.
- **The operator backfill**, section 9 — named, owed, and not performed.
