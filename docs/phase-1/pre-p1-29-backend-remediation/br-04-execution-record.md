# BR-04 — execution record

Inspection and Diagnostic Template Authoring. Closes `BE-4` and finding `INS-09`
(**CRITICAL**), and mints the mechanism closure blocker `B4` needs.

It **unblocks** Owner requirements 9 (Diagnostic findings), 10 (Computer scan) and
11 (Technician diagnosis) at the mechanism level, and **closes none of them**.
`dia.diagnostic_reports` requires both a published `template_version_id` and a
`diagnostic_type_id`, both NOT NULL, and every artefact of those three requirements
hangs off a report by `diagnostic_report_id NOT NULL`. No `dia.diagnostic_types`
vocabulary is seeded (§8), so no diagnostic report is creatable by a real tenant
and the three are unreachable in equal measure. Requirement 10 is additionally
deferred on its own terms — manual DTC entry is the whole mechanism and no scan or
OBD ingestion surface exists (residual `REQ-10`).

> **Correction.** This header previously read "Closes … Owner requirements 9, 10
> and 11", which its own §8 contradicts. The residual register recorded the
> contradiction as `REQ-10-C` and attributed it to requirement 10 alone; that
> attribution was wrong too. §8's open item is a **BR-04 Definition-of-Done item**
> — the register files the same fact correctly as `RES-01` — and it gates all
> three requirements identically, not requirement 10 specially.
>
> The requirements are named here rather than cited by number alone because the
> P1-29 table in `docs/product/owner-workflow-requirements.md` is **unnumbered**:
> every "Owner requirement N" citation in this programme depends on counting rows,
> and inserting one row silently renumbers all of them.

|                      |                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| Contract             | [br-04-inspection-diagnostic-template-authoring.md](br-04-inspection-diagnostic-template-authoring.md) |
| Branch               | `remediation/p1-29-backend-inspection-template-authoring`                                              |
| Depends on           | `BR-08a` (closed) — this slice mints the code the parity gate exists to police                         |
| Migrations           | **zero**                                                                                               |
| New permission codes | **one** — `dia.catalogue.manage`, risk `high`                                                          |
| Operations           | **eight**, 317 → 325                                                                                   |

---

## 1. What this slice is for

`dia.inspection_templates`, `dia.template_versions` and `dia.template_items` held
**zero rows**, and no `INSERT` or `UPDATE` against any of the three existed
anywhere in `apps/api`. `POST /jobs/{jobId}/inspections` requires a
`templateVersionId`, and nothing in the shipped system could produce one.

Diagnostics was therefore not thin, or partial, or unpolished — it was
**unreachable**. Closure blocker `B4` ("a job requiring diagnostics has no
completed diagnostic report") had a subject that could not be brought into
existence, so the blocker could never be exercised in either direction.

The row layer was never the gap. Both guards, all four CHECK vocabularies, the
nine RLS policies and `GRANT SELECT, INSERT, UPDATE … TO app_runtime` all shipped
in `20260722101000_dia_templates_versions_items.sql`. **This slice writes no SQL
against those three tables**, which the Definition of Done requires and which
`git diff --stat supabase/migrations` confirms as unchanged.

## 2. Two lifecycles, never conflated

`inspection_templates.status` is `active`/`inactive` — whether the library offers
this template at all. `template_versions.status` is `draft`/`published`/`retired`
— where one revision sits in its publication graph. They are orthogonal (`C-05`)
and the API exposes both.

Test **P6** is what makes that a fact rather than an intention: deactivating a
template removes its published versions from the technician's picker while the
versions themselves stay `published` and every report recorded against them stays
readable. A single flag could not express that.

## 3. The freeze is stronger than "no edits", and the API shape follows from it

`tg_template_items_frozen` is `BEFORE INSERT OR UPDATE`, so a published version's
item **set** is closed — appends included (`C-06`). "Add one more check to the
published inspection" is therefore not a supported operation and deliberately has
no route.

The supported shape is: create a new version, author its items, publish it, retire
the old one. `copyFromVersionId` exists so the correct path is the easy one —
re-typing forty items to change one is precisely what drives people to edit in
place, which is what the freeze exists to prevent.

**N6/N7/N8 each pass twice**, as the Definition of Done requires: once refused by
the service with a named `ERR-TRN-001`, and once by the trigger with the service
out of the path entirely.

## 4. The one rule this layer actually owns

**A version with zero items cannot be published.** It has no database counterpart,
so it is the one rule that must be tested directly rather than through a guard
(N9). A published empty version would let a technician open an inspection that can
never be meaningfully completed, while `outstandingMandatory` reported vacuous
success — a report claiming to have asked nothing and answered everything.

Everything else the service appears to enforce is a **message improvement over an
authority that stays in the database**. The publication graph is restated so the
caller receives `ERR-TRN-001` instead of a raw `23514`; the guard still runs, and
N4 proves it by making the same illegal move directly as `app_runtime`.

## 5. Four defects the suite found

Each was found by a test, not by review, and each is fixed in the same branch.

### 5.1 `keysetFragment` takes the NEXT index, and the repository passed the count

`pageTemplates` bound three values and passed `values.length` as
`nextParamIndex`. That index is the **next** placeholder, so `LIMIT` re-bound
`$3` — the `diagnosticTypeId`. Every paged list answered **500**,
`argument of LIMIT must be type bigint, not type uuid`.

It fails loudly rather than returning a wrong page, so it was always going to be
caught — but only by a test that actually pages. P5 does, and reconciles the union
of two pages against the whole set.

### 5.2 `ROUTE_TEMPLATES` — every idempotent operation answered `ERR-INT-002`

The same trap BR-03 hit (§5.1 of its own record). `assertRouteTemplate` interns
the route template against a frozen literal list to end a CodeQL dataflow, and an
unregistered template is **refused rather than hashed**. The six new paths were
absent, so all six idempotent operations answered `400 ERR-INT-002` —
"Idempotency key required" — while the header was present and well-formed.

257 → 263 templates. `tests/foundation/route-templates.test.ts` reconciles the
list against the route modules on disk and is what makes this a build failure
rather than a runtime one.

The misleading part is worth recording: the error names the _header_, and the
header was never the problem. Two plausible hypotheses (a missing global `crypto`,
then a header-casing difference) were both wrong; the cause was found by reading
every `ERR-INT-002` throw site rather than by guessing again.

### 5.3 Staleness was decided after transition legality

Two callers publish one version. The first wins. The second held a view from
before that happened and was told `ERR-TRN-001` — **true of the current state and
false of the state it knew about**, so it had no reason to re-read.

The version check now runs first: `ERR-CON-001` ("re-read and retry"), and only on
re-read `ERR-TRN-001` ("this is no longer possible"). That is the sequence the
contract specifies in §8, and S7 asserts both halves in order. The error catalogue
draws this distinction explicitly and warns that rendering one banner for both
trains users to retry an action that can never succeed.

### 5.4 A backstop assertion that would have passed while the trigger never ran

N4/N7/N8 write directly as `app_runtime` to prove the guard, not the service. Run
without the tenant GUCs, RLS narrows `dia.template_*` to nothing, the `UPDATE`
matches zero rows, and the statement **resolves** — so `rejects.toMatchObject`
would have failed for the right reason only by accident, and a future change that
silently disabled the trigger would have been invisible.

`asRuntime` sets `app.user_id` and `app.tenant_id` first. The INSERT cases
genuinely do not need it — a `BEFORE INSERT` trigger fires before the row-policy
`WITH CHECK` — and that asymmetry is documented beside the helper so nobody
"simplifies" it away.

## 6. Permission model

**One code: `dia.catalogue.manage`, domain `dia`, risk `high`.** Derived from the
rule the seed states at `:309-311` — _one code per schema, not per catalogue_ —
already applied twice as `apt.catalogue.manage` and `rec.catalogue.manage`, both
risk `high`. Neither of the two shipped template-plus-versions lifecycles
(`rec.damage_map_templates`, the shared message templates) minted a `*.template.*`
code, and neither does this one.

`permissionCount` 113 → **114**. Seeded, mapped to no role, no migration.

**Enforcement is route-layer only, and that is forced rather than chosen.** The
three tables carry no `company_id` or `branch_id`, so a scoped RLS predicate is
impossible without adding columns the slice does not otherwise need. For these
eight operations the declaration is the only authorization control — there is no
second line of defence — which is exactly why every coverage-manifest entry owes
`denial` and `cross-tenant`, and why `BR-08a` landing first mattered.

**S5 is the assertion that makes the mint load-bearing**: a principal holding all
four pre-existing `dia` codes (`record`, `complete`, `review`, `read`) can create
nothing, version nothing and update nothing. If any of the four had conferred
authoring authority, the new code would have been theatre.

## 7. Security properties, and where each is enforced

| property                               | enforced by                                                       | proved by                                                    |
| -------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------ |
| cross-tenant template reuse refused    | RLS on `dia.template_versions` + the report's own reference check | **S1** — the headline test, executable for the first time    |
| cross-tenant read returns nothing      | RLS, `tenant_id = iam.current_tenant_id()`                        | **S2**, with the tenant-B row proved to exist                |
| cross-tenant write is a 404, not a 403 | service resolves under RLS first                                  | **S3** — not an existence oracle                             |
| mass assignment                        | `.strict()` on every body                                         | **S4** — `tenantId`, `publishedAt`, `versionNumber`          |
| forged `diagnosticTypeId`              | service check the single-column FK cannot make                    | **N14** (foreign, inactive) and **N14b** (platform ACCEPTED) |
| privilege escalation                   | the code is minted, not reused                                    | **S5**                                                       |
| item integrity on a published version  | `tg_template_items_frozen`                                        | **N6/N7/N8**, service and trigger separately                 |
| empty published version                | the service, uniquely                                             | **N9**                                                       |
| publish race                           | `record_version` guard                                            | **S7**, both error codes in order                            |

## 8. The diagnostic-type vocabulary — OPEN, and deliberately not invented

**`OWNER DECISION REQUIRED — dia.diagnostic_types platform vocabulary` remains
open.** This slice does **not** ship a `dia.diagnostic_types` seed.

The contract's §4.4 argues that a _type vocabulary_ is platform reference data of
the same class as `wo.work_order_states` and the permission catalogue, and that
seeding one is not fake business data. That argument is accepted. What does not
exist is the **content**: a search of the controlled Phase 1 plan, the seeds, the
data dictionary, the prior migrations and the diagnostics documentation found **no
approved diagnostic-type vocabulary anywhere**, and `dia.diagnostic_types` holds
zero rows.

Inventing one here would put invented product vocabulary into a platform-scope
seed under the authority of a backend remediation slice. So the slice ships the
**mechanism** and records the question, exactly as §4.4 says it should
("the seed content is an Owner decision, not this slice's").

Consequences, stated plainly:

- **Every operation is complete and tested.** The four fixture types
  (`fx_br_04_*` — tenant, platform, inactive, tenant-B) are test scaffolding and
  are named so they can never be mistaken for content awaiting approval. They live
  in `tests/backend/br-04-helpers.ts`, never in a seed.
- **`dia.template-create` cannot be exercised by a real tenant** until a type
  exists, because `inspection_templates.diagnostic_type_id` is NOT NULL and no
  operation in BR-04 (or anywhere) creates a diagnostic type. The row layer does
  permit a tenant-scope insert (`ins_diagnostic_types_tenant`), so a tenant
  vocabulary is representable — there is simply no route for it, which is a
  deliberate scope boundary and not an oversight.
- **The Definition of Done item _"a platform `dia.diagnostic_types` vocabulary is
  seeded, its content approved by the Owner"_ is therefore NOT met**, and this
  slice does not claim it. Every other DoD item is met.

This is a product-content dependency, not a technical one. It blocks declaring the
user-facing diagnostic vocabulary production-ready; it blocks nothing in the
mechanism, and it is isolated here so it cannot be mistaken for either.

## 9. Other open questions this slice records rather than answers

- **`validationRule` semantics.** Accepted as an opaque `jsonb` object. Nothing in
  the platform interprets it today, and inventing a schema for it here would
  create a contract no consumer honours. Recorded, not defined.
- **Template rename silently re-labels published versions.** `name` is
  last-write-wins with attribution and there is no history table, so a renamed
  template re-labels its own published versions in every future read. The freeze
  protects the _questions_ a report was asked, not the _label_ on the template
  that asked them. Recorded as a known limitation; fixing it means a history
  table, which is a separate slice. The audit detail carries the previous value,
  so the change is at least reconstructible.

## 10. Deliberately out of scope

Named because the contract names them, and because silence would read as an
oversight:

- **symptom / probable cause / confirmed cause** — these fields do not exist in
  the `dia` schema and no approved contract authorizes them. Not added.
- **QC catalogue (`INS-38`, Requirement 15's second half)** — a possible `BR-10`.
  Not touched.
- **A route that creates a diagnostic type** — see §8.
- **Any `apps/web` authored UI.** The only `apps/web` file changed is
  `src/lib/api/idempotent-operations.ts`, which is **generated output** required
  by the operation registry and produced by
  `scripts/ci/generate-idempotent-operations.mjs` (147 → 151 idempotent). Its
  reproducibility is enforced by `validate:idempotent-operations --check`.

## 11. Evidence — local tiers

Measured at the candidate, not carried forward.

| tier             | command                                                                                       | result                                |
| ---------------- | --------------------------------------------------------------------------------------------- | ------------------------------------- |
| BR-04 suite      | `vitest run --config vitest.config.backend.ts tests/backend/br-04-template-authoring.test.ts` | **33 passed** / 33                    |
| Backend          | `npm run test:backend`                                                                        | **2172 passed** / 2172, 92 files      |
| Typecheck (api)  | `tsc --noEmit -p apps/api/tsconfig.json`                                                      | exit 0                                |
| Typecheck (root) | `npm run typecheck`                                                                           | exit 0                                |
| Format           | `npm run format:check`                                                                        | clean, whole repo                     |
| Lint             | `npm run lint`, `npm run lint:api`                                                            | no problem outside gitignored `.tmp/` |
| Contracts        | `npm run verify:contracts`                                                                    | green end to end                      |

Generated artefacts, each by its canonical generator and each re-validated in
`--check` mode afterwards:

| artefact                                        | generator                                                | movement                                                        |
| ----------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------- |
| `docs/api/openapi.v1.json`                      | `UPDATE_OPENAPI=1 vitest tests/openapi-contract.test.ts` | 317 → **325** operations, 257 → **263** paths                   |
| `apps/web/src/lib/api/idempotent-operations.ts` | `scripts/ci/generate-idempotent-operations.mjs`          | 147 → **151** idempotent                                        |
| `apps/api/src/server/http/route-templates.ts`   | reconciled by `tests/foundation/route-templates.test.ts` | 257 → **263**                                                   |
| P1-24 operation register                        | `scripts/p1-24-operation-register.mjs`                   | **325** operations                                              |
| P1-19 endpoint inventory                        | `scripts/p1-19-endpoint-inventory.mjs`                   | 58 P1-19 operations unchanged; **8** owned by `PRE-P1-29-BR-04` |
| Operation-test matrix                           | `scripts/check-operation-test-coverage.mjs`              | 325 covered                                                     |

The OpenAPI diff is **468 insertions and 1 deletion** ignoring whitespace: the
eight operations, and the summary line moving 317 → 325. Zero `operationId`s were
removed, which is the check that distinguishes a publication from a rewrite.

## 12. Note on the local developer stack

The developer Supabase stack was stale at **112** permissions and lacked even
`tech.technician.manage`, which BR-03 merged into protected `develop`. Applying
`supabase/seeds/04_iam_permission_catalog.sql` brought it to **114**.

The seed is additive — every row is `ON CONFLICT (permission_code) DO NOTHING`,
and the file contains no `TRUNCATE`, `DELETE` or `DROP`, which was verified before
it was run. **No `supabase db reset` was performed**, because a reset destroys the
Owner acceptance environment. This is a note about one developer machine and
changes nothing in the repository.
