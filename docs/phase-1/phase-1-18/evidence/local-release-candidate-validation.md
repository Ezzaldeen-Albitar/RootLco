# P1-18 — Local release-candidate validation

> **Superseded as gate evidence.** This file records the validation of the
> **third** remediation at `7caafbe`, and it is retained unaltered as the history
> of that run. It is **not** the evidence the P1-18 gate was decided against.
> PR #80 has since merged, `origin/develop` is now
> `a13ff8b8b1f4002ff60a9112ce8f21d7920f444d`, and gate conditions 15, 16, 17 and
> 19 are satisfied by **`post-merge-gate-reproof.md`**, which re-ran the full
> battery, the artifact-stability comparison, the exact-SHA clean room and the
> hosted-CI check on `a13ff8b` itself. Every SHA and count below refers to
> `7caafbe` unless stated, and must not be read forward onto the merged tree.

Full local validation and exact-SHA clean room for the third P1-18 remediation.
Everything below was produced on one candidate, serially, with no other
PostgreSQL consumer and no concurrent Vitest process.

| Item              | Value                                                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SHA validated     | `7caafbee0faf17183a19ca76f85ebc16d8e85c54` — the protected merge of PR #79 (authoritative for this file only; superseded for gate purposes by `a13ff8b`) |
| Delivered by      | `fix/p1-18-scoped-authorization-containment`, reviewed head `b9b4ff5`                                                                                    |
| Protected push CI | `#202`, run id `30173469487`, event `push`, branch `develop`, Success 4/4                                                                                |
| `origin/main`     | `3e2c44d9e32e609186f4a6b9f9bfd246cdccda1a` — untouched by P1-18                                                                                          |
| Migrations        | 119, no migration 120, none added, modified, renamed or deleted                                                                                          |
| Owner gate        | `Decision: Pending`                                                                                                                                      |

Earlier local candidates are listed in §8 and are **superseded**. Read §8 first
if any figure below appears to belong to a different tree.

## 1. Repository validation, CI-equivalent order

| #   | Gate                                | Result                                                                                                                                                                                                                         |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Repo-wide Prettier                  | green                                                                                                                                                                                                                          |
| 2   | ESLint                              | green                                                                                                                                                                                                                          |
| 3   | TypeScript `tsc --noEmit`           | green                                                                                                                                                                                                                          |
| 4   | Unit / foundation suite             | **828 passed**, 39 files                                                                                                                                                                                                       |
| 5   | Production build (`next build`)     | green                                                                                                                                                                                                                          |
| 6   | Module boundaries                   | green — 253 files, 11 rules                                                                                                                                                                                                    |
| 7   | Authorization coverage              | green — every operation guarded, every route registered                                                                                                                                                                        |
| 8   | Operation coverage                  | green — see §2                                                                                                                                                                                                                 |
| 9   | OpenAPI structural validation       | green — 3.1.0, 94 paths, 110 operations                                                                                                                                                                                        |
| 10  | Encoding                            | green — clean UTF-8, no BOM                                                                                                                                                                                                    |
| 11  | Canonical documents                 | green — 2 documents, hashes match                                                                                                                                                                                              |
| 12  | Stylelint                           | green                                                                                                                                                                                                                          |
| 13  | APT/REC classification              | green — 454 columns, 4 restricted, 0 searchable                                                                                                                                                                                |
| 14  | Tracked secrets                     | green — **1098** files at `7caafbe` (corrected: the figure previously here, 1097, was run 1's count at the superseded tree `b9b412e`, and was the one residue §8's run-4 rule failed to catch. At `a13ff8b` the count is 1103) |
| 15  | Browser-exposed secrets             | green                                                                                                                                                                                                                          |
| 16  | Scope exclusions (Benzene, Zoom)    | green                                                                                                                                                                                                                          |
| 17  | No-fake-data                        | green                                                                                                                                                                                                                          |
| 18  | Seed state                          | green — 7 files applied twice, every business table empty, idempotent                                                                                                                                                          |
| 19  | Schema inventory                    | green — see §4                                                                                                                                                                                                                 |
| 20  | Database suite                      | **1547 passed**, 132 files                                                                                                                                                                                                     |
| 21  | Backend suite                       | **767 passed**, 38 files                                                                                                                                                                                                       |
| 22  | Docker                              | `compose config` green; dev and runner stages build; runtime uid 1001, non-root (ADR-007)                                                                                                                                      |
| 23  | Migration immutability vs `develop` | green — zero M/D/R, zero additions                                                                                                                                                                                             |

### Floors

| Tier     | Floor entering the phase | Actual at `7caafbe` | Margin |
| -------- | ------------------------ | ------------------- | ------ |
| Unit     | 746                      | **828**             | +82    |
| Database | 1547                     | **1547**            | 0      |
| Backend  | 693                      | **767**             | +74    |

The margins are exactly the two suites this remediation added, which is how they
are confirmed to be counted in the aggregates rather than run separately: unit
828 − 82 foundation = 746, and backend 767 − 74 containment = 693. Those become
the new floors for anything that follows.

Targeted re-proof at `7caafbe`: authorization foundation **82/82**, scoped
containment **74/74**.

The database suite prints five `✖ APT/REC classification guard FAILED` and three
`✖ SVC/QUO/INV classification guard FAILED` lines. These are **deliberate
negative-control output**: `tests/db/apt-rec-classification-guard.test.ts` and
its siblings spawn the real validator against tampered registries and require it
to fail, then require the untampered committed registry to pass. All 132 files
and all 1547 tests pass.

## 2. Operation coverage

```
P1-18 registered public operations: 12
P1-18 operation-depth:              12
P1-18 invocation-only:               0
P1-18 pending:                       0
P1-18 unit-only:                     0
P1-18 unreferenced:                  0
P1-18 metadata-only:                 0
```

## 3. Independent OpenAPI route inventory

The repository gate builds its list from the operation registry. To avoid one
list checking itself, a second inventory was taken that shares no import list,
no registry module and no helper with it: it walks every
`src/app/api/v1/**/route.ts`, strips all comments, parses each
`defineOperation({...})` declaration directly, and compares the result against
`docs/api/openapi.v1.json` by operationId, path and method.

| Measure                 | Value                |
| ----------------------- | -------------------- |
| `route.ts` files walked | 94                   |
| Declared operations     | **110** (110 unique) |
| Published operations    | **110** (110 unique) |
| Guarded operations      | **110**              |
| Unguarded               | **0**                |
| Public operations       | 6                    |
| P1-18 declared          | 12                   |
| P1-18 published         | **12/12**            |
| Missing from OpenAPI    | **0**                |
| Orphan published        | **0**                |
| Path/method drift       | **0**                |

Both methods agree at 110, which is the point of running two.

## 4. Generated-artifact stability

Both generators were run twice, with repository formatting applied after each
run: the operation matrices via `validate:operation-coverage`, and the OpenAPI
document via `UPDATE_OPENAPI=1 vitest run tests/openapi-contract.test.ts`.

| Artifact                                         | Committed   | After run 1 | After run 2 |
| ------------------------------------------------ | ----------- | ----------- | ----------- |
| `phase-1-14/evidence/operation-test-matrix.json` | `179ef098…` | `179ef098…` | `179ef098…` |
| `phase-1-18/evidence/operation-test-matrix.json` | `ad6123ae…` | `ad6123ae…` | `ad6123ae…` |
| `docs/api/openapi.v1.json`                       | `4b878a7a…` | `4b878a7a…` | `4b878a7a…` |

Byte-identical throughout. **Zero drift**, so no generated change needed
committing and the candidate SHA is unchanged by this step.

## 5. Exact-SHA PostgreSQL 17 clean room

**Method.** A fresh `postgres:17-alpine` container (PostgreSQL 17.10) was
started on an isolated port with an empty database — verified empty: zero tables
outside `pg_catalog`/`information_schema` before anything ran. The repository's
own commands were driven against it through `DB_HOST`/`DB_PORT`/`DB_NAME`/
`DB_USER`/`DB_PASSWORD`, which is the same convention CI uses. The worktree was
verified clean and at the candidate SHA immediately before and after. See §8
for which SHA each run belongs to; the authoritative run is §8 run 4. Repository gates are the authority
throughout; no scratchpad probe substitutes for one.

| Proof                                         | Result                                                                                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| All 119 migrations apply to an empty database | **green** — "All 119 migrations applied cleanly."                                                                                                   |
| Migration 120 absent                          | **green**                                                                                                                                           |
| Migrations 1–119 unchanged                    | **green** — zero M/D/R against `develop`                                                                                                            |
| Supported seeds apply                         | **green** — 7 declared files                                                                                                                        |
| Seeds apply twice idempotently                | **green** — counts idempotent                                                                                                                       |
| Business tables empty where required          | **green**                                                                                                                                           |
| Clean seed-state validation                   | **green**                                                                                                                                           |
| Schema inventory                              | **green**                                                                                                                                           |
| Structural review                             | **PASS** — 537 FKs all validated, no runtime-reachable destructive cascade, FK index coverage complete, no duplicate indexes, zero dictionary drift |
| Full database suite                           | **1547 passed**, 132 files                                                                                                                          |
| Full backend suite                            | **767 passed**, 38 files                                                                                                                            |
| Authorization foundation                      | **82 passed**                                                                                                                                       |
| Scoped containment                            | **74 passed**                                                                                                                                       |
| All 12 P1-18 operation evidences              | **green** — 12/12 operation-depth                                                                                                                   |
| Artifact regeneration drift                   | **zero**                                                                                                                                            |

### Structural posture

| Measure          | Expected | Clean room |
| ---------------- | -------- | ---------- |
| Tables           | 242      | **242**    |
| Functions        | 212      | **212**    |
| Policies         | 631      | **631**    |
| Triggers         | 541      | **541**    |
| Indexes          | 999      | **999**    |
| Constraints      | 1845     | **1845**   |
| Permissions      | 71       | **71**     |
| SECURITY DEFINER | 0        | **0**      |
| RLS not forced   | 0        | **0**      |

Per-schema tables: org 17, iam 17, shared 29, crm 21, veh 23, apt 6, rec 23,
wo 15, tech 9, dia 13, qms 7, svc 11, quo 6, inv 18, sal 19, wty 5, rpt 3.

### Security posture

| Control                             | Result                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------ |
| No app role is superuser            | **green** — `app_readonly`, `app_runtime`, `app_worker` all `rolsuper=f` |
| No app role has BYPASSRLS           | **green** — all `rolbypassrls=f`                                         |
| No app role owns application tables | **green** — 0 across all 17 schemas                                      |
| No app-role DELETE grant on `apt`   | **green** — 0                                                            |
| No app-role DELETE grant on `rec`   | **green** — 0                                                            |
| No app-role DELETE grant on `wo`    | **green** — 0                                                            |
| `app_readonly` SELECT-only          | **green** — 0 non-SELECT grants                                          |
| `app_worker` within approved scope  | **green** — SELECT/INSERT/UPDATE/DELETE confined to the `shared` schema  |

### Schema hash

```
a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c
```

Byte-identical to the frozen P1-17 baseline, and identical to the local
development database. P1-18 adds no DDL, so an unchanged hash is the expected
result and any change would have been a blocker.

Clean-room evidence was preserved before teardown, and the container was
removed afterwards.

## 6. A finding the clean room surfaced, and its attribution

Running `validate:seed-state` **after** the database suite, in the same
database, FAILS: `Retention classes do not match the five governed values`. All
five governed `class_code` values are present and correct; the residue is in
`min_retention_days` — `evidence-audit` reads `3650` and `operational` reads `0`
where the governed baseline is `null` for both.

**This is not P1-18's.** It was attributed definitively rather than by argument.
On a second, pristine `postgres:17-alpine` container, with all 119 migrations
and the seeds applied and `validate:seed-state` passing, running **only**
`tests/db/shared-retention.test.ts` — a P1-05-era file this branch does not
touch, whose own 14 tests all pass — reproduces the identical failure with no
P1-18 code involved at all. `git diff --name-only origin/develop...HEAD --
tests/db/` is empty: this branch changes no database test.

Recorded as **`P1-05-SEEDRESIDUE`, severity Low**, and deliberately not fixed
here: it belongs to another phase's test hygiene and repairing it would widen
this remediation into unrelated code. Its practical consequence is bounded and
worth stating: `validate:seed-state` is only meaningful before the database
suite has run against that database, or after a re-seed. The clean-room sequence
above runs it in that order, which is why it passes there.

## 7. Independent read-only reviews

Four independent reviewers — correctness, security, QA evidence, and
architecture/documentation — each instructed to run no tests, touch no database
and edit nothing. Every finding was adjudicated by direct inspection before
being accepted or rejected; nothing below was taken on the reviewer's word.

**Zero Critical. One High, fixed. Four Medium fixed, one Medium (doc) corrected,
one Medium recorded.** (An earlier revision of this line said "two Medium fixed"
and did not match the table immediately below it; the count is now taken from the
table.)

| Finding                                                                                                                                                                   | Verdict                                                                                                                                                                                                                                                                                                                                                             | Disposition                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **High** — the mutation record claimed M6 was "killed by exactly one assertion" and would otherwise "have survived every gate the project had"                            | **Confirmed false.** `tests/backend/p1-18-reception-parties.test.ts:551` drives the party-roles handler as a principal holding only `rec.reception.authorization.verify` on an unrestricted grant and asserts 403; under M6 that route runs under the sibling declaration whose permission is exactly that one, so it would answer 201 and the assertion would fail | Corrected in the mutation record, with the reasoning error named: the protocol runs only the targeted test, so "nothing else catches this" is a conclusion it cannot support |
| **Medium** — foreign-branch appointment lifecycle state and vehicle linkage disclosed before the scope check in `resolveOrigin`                                           | **Confirmed.** `assertCheckInEligible` names the exact lifecycle state, and the vehicle comparison confirms or denies a booking, both before the company/branch equality test — contradicting the module's own stated doctrine                                                                                                                                      | **Fixed**: the scope equality test now runs first                                                                                                                            |
| **Medium** — latent fail-open: a deferred call from an operation that omitted `scope: 'branch'` would evaluate scope-blind, and the F10 discovery filter would exclude it | **Confirmed.** `defineOperation` defaults a missing scope to `'tenant'`; both the guard and the discovery filter keyed on the declared scope                                                                                                                                                                                                                        | **Fixed**: neither condition consults the declared scope any more, and F10 discovers by path parameter then asserts the scope                                                |
| **Medium** — company-scoped grants falsely denied on four branch-addressed org routes                                                                                     | **Confirmed**, and it is P1-14/P1-15 code outside this diff                                                                                                                                                                                                                                                                                                         | **Recorded** as `PLAT-BRANCHTARGET-001`; not fixed here                                                                                                                      |
| **Medium** — F7's transaction-binding assertion sliced from the _import_ of `withTransaction`, degenerating to "B appears after A"                                        | **Confirmed**                                                                                                                                                                                                                                                                                                                                                       | **Fixed**: the assertion now walks the callback's own parenthesis span and additionally proves no second construction site exists outside it                                 |
| **Medium** — `%s passes the deferred authorizer down` is satisfied by parameter destructuring and survives M1's mutation                                                  | **Confirmed**                                                                                                                                                                                                                                                                                                                                                       | **Fixed**: renamed to `names the deferred authorizer`, with the limit stated in the test itself                                                                              |
| **Low** — the three appointment lifecycle commands wrote audit rows with NULL company/branch                                                                              | **Confirmed.** The data was available at the choke point but the return type discarded it, so privileged actions were invisible to scope-filtered audit queries                                                                                                                                                                                                     | **Fixed**: `requireAppointment` returns the lock row and all three pass the locked scope                                                                                     |
| **Medium (doc)** — `P1-18-LEX-001` described its second construct backwards                                                                                               | **Confirmed by execution**: a `//` inside a `${…}` interpolation SURVIVES stripping, so the gate is fail-_open_ there, not stricter                                                                                                                                                                                                                                 | **Corrected**, with a scan showing zero occurrences across all seven P1-18 evidence files                                                                                    |
| **Low (doc)** — `P1-18-R-02` said 39 operations across three namespaces                                                                                                   | **Confirmed 41 across four** (`veh` 20, `crm` 18, `iam` 2, `meta` 1) by recount                                                                                                                                                                                                                                                                                     | **Corrected**                                                                                                                                                                |
| **Low (doc)** — "authorized twice" has an exception on idempotent replay                                                                                                  | **Confirmed**                                                                                                                                                                                                                                                                                                                                                       | **Qualified**, and recorded as `P1-18-REPLAY-001`                                                                                                                            |
| **Low (doc)** — `P1-18-QA-BARRIER` said "row"; the barrier correlates to the relation                                                                                     | **Confirmed**                                                                                                                                                                                                                                                                                                                                                       | **Corrected**                                                                                                                                                                |
| **Low (doc)** — §7.1 heading no longer described its contents                                                                                                             | **Confirmed**                                                                                                                                                                                                                                                                                                                                                       | **Heading corrected**                                                                                                                                                        |
| **Low** — 403/404 split is an existence oracle inside the caller's RLS-visible union                                                                                      | **Confirmed**, bounded by a SELECT the caller already holds                                                                                                                                                                                                                                                                                                         | **Recorded** as `P1-18-ORACLE-001`                                                                                                                                           |
| **Low** — department-scoped grants can no longer satisfy any of the ten                                                                                                   | **Confirmed**, fail-closed direction, previously undocumented                                                                                                                                                                                                                                                                                                       | **Recorded** as `P1-18-DEPT-001`                                                                                                                                             |
| **Low** — route-level threading is mutation-proved for five of ten, not ten                                                                                               | **Confirmed**                                                                                                                                                                                                                                                                                                                                                       | **Recorded** in the mutation document's scope section                                                                                                                        |

Several further Low observations about test naming and probe breadth were
accepted as accurate and are reflected either in the corrected tests or in the
mutation document's narrowed scope statement.

## 8. Which SHA each result belongs to

Validation ran more than once, because the tree changed underneath it and
re-running was the honest response rather than arguing that the change could not
have mattered. An earlier revision of this section left §5 naming run 1's tree
and run 1's foundation count while asserting run 3 was authoritative — two
mutually exclusive readings of the same evidence, in the section that is the sole
support for gate condition 17. That contradiction is what this table exists to
prevent, and it was found by independent review rather than by me.

| Run | SHA           | What changed since the previous run                                                                                                  | Status                      |
| --- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| 1   | `b9b412e`     | documentation corrections                                                                                                            | **superseded**              |
| 2   | `cf508c8`     | documentation only, empty executable-path diff                                                                                       | **superseded**              |
| 3   | `9c20fe3`     | review response — real code changes to `authorization.ts`, `reception-service.ts`, `appointment-service.ts` and the foundation suite | **superseded**              |
| 4   | **`7caafbe`** | **the protected merge of PR #79 into `develop`** — merge tree byte-identical to the reviewed head `b9b4ff5`                          | **authoritative for §1–§7** |

**Why runs 1–3 are not gate-authoritative.** Each was a local candidate on an
unmerged branch, and each was superseded by a later tree. Run 4 is the protected
merge itself: the tree the gate would actually be recorded against, reached
through a reviewed pull request with a byte-identical merge tree and a green
protected push CI (`#202`, run id `30173469487`, event `push`, branch `develop`,
SHA `7caafbe`, Success 4/4).

**The authoritative run, stated once so it cannot be read two ways:**

```
SHA          7caafbee0faf17183a19ca76f85ebc16d8e85c54
Unit         828        Database   1547       Backend  767
Foundation    82        Containment  74
Schema hash  a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c
```

Every figure in §1–§7 above is from run 4 unless a row says otherwise. Figures
from runs 1–3 have been removed from those sections rather than annotated,
because a superseded number sitting beside a current one is exactly how the
contradiction arose.

Counts move again in the remediation that carries this correction: containment
goes 74 → **76** and the appointment lifecycle suite 30 → **32**, both from added
assertions, and those are recorded against that remediation's own candidate
rather than back-dated into run 4.

The one unavoidable residue: the commit that records a run is necessarily one
commit after the run itself. Where that final commit changes documentation only,
the executable-path diff is stated and is verifiable with one command —
`git diff --name-only <run-sha> <final> -- src tests scripts supabase
package.json package-lock.json tsconfig.json vitest.config*.ts Dockerfile`.

## 9. What this document does not claim

No push, no pull request, no gate-record branch, and no Go decision. The owner
gate remains `Decision: Pending`. Hosted CI has not run — every result above is
local. Nothing here authorises P1-19.
