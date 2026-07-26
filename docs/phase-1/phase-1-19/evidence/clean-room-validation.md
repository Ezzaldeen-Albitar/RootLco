# P1-19 — Exact-SHA PostgreSQL 17 clean-room reproof

**Final SHA `b158ea91226f318a3248ec6b55fe0b45aa1426c6`**, branch
`feature/p1-19-module-foundation`, base `develop` = `f326e24`. Worktree verified clean at
that SHA immediately before the run and unchanged by it.

**This is the THIRD run, and the reason is the same each time: executable code changed
after the previous one, so the previous result stopped describing the tree being merged.**
Run 1 was at `3b39328`, run 2 at `baa270a` after the final adversarial review's
remediation, and run 3 at the SHA above after the pre-merge completeness audit's
remediation — the `wo.job-update` parent guard, the diagnostics parent-terminal refusal
and the `closeAssignment` read-back. Each earlier run remains recorded rather than
overwritten, because a reproof that predates a code change is not evidence about the code
that shipped, and hiding that would make the record less useful than admitting it.

**The first run's SHA is why run 2 existed.** The reproof was first taken at
`3b39328`. The final adversarial review then changed application code — the
`tech.labor-session-list` scope fix, two lock corrections, the eligibility semantics and a
removed request field — so the earlier run no longer described the tree being merged. A
clean-room result that predates a code change is not evidence about the code that shipped,
and re-running it was not optional. Both runs are recorded: the figures below are the
second run's, and §"What the clean room found" reports what the first one caught.

Everything structural is identical between the two runs, which is the expected result: the
remediation touched no DDL. What had to be re-established is that the suites still pass
from an empty database at the SHA being merged.

## Method

A fresh `postgres:17-alpine` container (**PostgreSQL 17.10**) on an isolated port
(`55432`) with an empty database — verified empty first: **zero** tables outside
`pg_catalog`/`information_schema` before anything ran. The repository's own commands were
driven against it through `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD`, which is
the convention CI uses. Repository gates are the authority throughout; no ad-hoc probe
substitutes for one.

The point of an empty database is that it cannot pass on residue. A suite that only ever
runs against the long-lived development database can be relying on a row, a sequence
value or a grant that a fresh deployment would not have.

## Results

| Proof                                         | Result                                                                                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| All 119 migrations apply to an empty database | **green** — "All 119 migrations applied cleanly."                                                                                                   |
| Migration 120 absent                          | **green** — 119 files, last is `20260730090000_crm_customer_notes_write_capability.sql`                                                             |
| Migrations 1–119 unchanged vs `develop`       | **green** — `git diff --name-status f326e24 HEAD -- supabase/migrations` is empty                                                                   |
| Declared seeds apply                          | **green** — 7 declared files (`seed.sql` + 6 under `seeds/`)                                                                                        |
| Seeds apply **twice** idempotently            | **green** — "counts idempotent", five exact retention classes                                                                                       |
| Business tables empty where required          | **green** — validator green; `wo`/`dia`/`qms`/`tech` business tables all 0 rows                                                                     |
| Schema inventory                              | **green**                                                                                                                                           |
| Structural review                             | **PASS** — 537 FKs all validated, no runtime-reachable destructive cascade, FK index coverage complete, no duplicate indexes, zero dictionary drift |
| Full **database** suite                       | **1610 passed**, 136 files                                                                                                                          |
| Full **backend** suite                        | **1077 passed**, 52 files                                                                                                                           |
| Full **unit** suite                           | **843 passed**, 40 files                                                                                                                            |
| P1-19 operation depth                         | **58/58**, 0 pending                                                                                                                                |
| Artifact regeneration drift                   | **zero** (see below)                                                                                                                                |
| Schema hash **after** all three suites ran    | **unchanged**                                                                                                                                       |

## Structural posture

| Measure          | Frozen baseline | Clean room |
| ---------------- | --------------- | ---------- |
| Schemas          | 17              | **17**     |
| Tables           | 242             | **242**    |
| Columns          | 3562            | **3562**   |
| Functions        | 212             | **212**    |
| Policies         | 631             | **631**    |
| Triggers         | 541             | **541**    |
| Indexes          | 999             | **999**    |
| Constraints      | 1845            | **1845**   |
| Views            | 0               | **0**      |
| SECURITY DEFINER | 0               | **0**      |
| RLS not forced   | 0               | **0**      |

Per-schema tables: org 17, iam 17, shared 29, crm 21, veh 23, apt 6, rec 23, wo 15,
tech 9, dia 13, qms 7, svc 11, quo 6, inv 18, sal 19, wty 5, rpt 3.

## Permission catalog

| Measure                           | Clean room |
| --------------------------------- | ---------- |
| `iam.permissions` total           | **93**     |
| …of which `wo`/`tech`/`dia`/`qms` | **22**     |

93 = 71 at the protected base + this phase's 22. This is the one place the clean room
shows a **difference** from the P1-18 baseline, and it is the difference this phase
intends — see the correction recorded below.

## Security posture

| Control                                               | Result                                                     |
| ----------------------------------------------------- | ---------------------------------------------------------- |
| No app role is superuser                              | **green** — 0 of `app_readonly`/`app_runtime`/`app_worker` |
| No app role has `BYPASSRLS`                           | **green** — 0                                              |
| No app role owns an application table                 | **green** — 0                                              |
| No app-role `DELETE` grant on `wo`/`tech`/`dia`/`qms` | **green** — 0                                              |
| `app_readonly` is SELECT-only                         | **green** — 0 non-SELECT grants                            |
| Every `wo`/`tech`/`dia`/`qms` table FORCEs RLS        | **green** — 0 tables without `relforcerowsecurity`         |
| SECURITY DEFINER functions outside catalogs           | **green** — 0                                              |

## Schema hash

```
a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c
```

**Byte-identical to the frozen P1-17/P1-18 baseline.** P1-19 adds no DDL, so an unchanged
hash is the expected result and any change would have been a blocker.

It was measured twice **in each run**: once after migrations and seeds, and again after the
database, backend and unit suites had all run against the same container. The second
measurement is the one that matters — it proves the phase's 303 backend tests and 63
database tests leave no DDL residue behind them. A suite that quietly created a helper
table or dropped a policy would show here and nowhere else.

The value is identical across both runs and both measurements within each, which is four
readings of the same hash.

## Artifact regeneration drift: zero, and what "zero" means

`UPDATE_OPENAPI=1 npx vitest run tests/openapi-contract.test.ts` and
`node scripts/p1-19-endpoint-inventory.mjs` were both re-run against the clean room. The
two generated evidence documents came back **byte-identical**. `docs/api/openapi.v1.json`
came back byte-**different** and semantically **identical** —
`JSON.stringify(regenerated) === JSON.stringify(committed)` is `true`. The difference is
JSON whitespace only: the regenerator writes compact arrays and Prettier expands them, so
the committed file is the Prettier-formatted rendering of exactly what the registry
produces. The regenerated file was discarded and the committed one re-verified against
`prettier --check`.

This is stated rather than reported as "zero drift" without qualification, because
"byte-identical" and "semantically identical" are different claims and only one of them
is true here.

## What the clean room found

**One error, in the first run, and it was in this phase's own evidence rather than in its
code.** The second run found nothing — which is what a reproof is for: it either confirms
the tree or it does not, and a run that finds nothing after a run that found something is
the only sequence that closes the question.

Three phase-level evidence documents — `change-log.md`, `security-review.md` and
`devops-observability.md` — stated that **no seed changed**. That is false.
`supabase/seeds/04_iam_permission_catalog.sql` gained **22 permission codes** in Wave 3
(+61 / −1, the single deletion being the preceding row's missing trailing comma). The
clean room surfaced it directly: `iam.permissions` returned 93 where the P1-18 baseline
returned 71, and a phase that changed no seed could not have moved that number.

Nothing about the code was wrong. The 22 codes are additive structural reference data
consumed by the 58 operations' `defineOperation` declarations, the seed is idempotent
(`ON CONFLICT (permission_code) DO NOTHING`, proved by the twice-applied pass), and a
permission row grants nothing until a tenant role maps it — this phase seeds no role and
no mapping. But the documents said something untrue about the deliverable, and the
deployment note that followed from it ("a code deployment: it requires no database step")
was wrong in a way that would have mattered to whoever deployed it.

All three documents are corrected, and each states what it previously claimed rather than
silently replacing it. The wave-level documents for Waves 6, 7 and 8 are unaffected: no
seed changed in those waves, which is what they say.

Clean-room evidence was preserved before teardown and the container removed afterwards.
