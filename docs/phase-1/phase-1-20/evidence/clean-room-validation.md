# P1-20 — exact-SHA PostgreSQL 17 clean-room reproof

> **This document records TWO runs, and the first one does not cover the gated tree.**
> Run 1 was taken against `17e59ae51395bff064677abbfe9e15eebf716383`, before the
> service-catalog mutation surface existed. Its delta to the merged tree is 37 files —
> including all four new routes, `ServiceCatalogWriteService`, the rewritten task gate and
> 1,303 added lines of service-catalog test — so its figures (13 operations, unit 901,
> backend 1219) were correct when taken and are **not** evidence for what was gated. It is
> kept rather than deleted because a rewritten record is no longer a record. Run 2 is the
> authoritative one.

## Run 2 — the gated tree (authoritative)

**SHA under test: `db7ef97a4c1e090911e22ddac5936f725470f084`** — the protected merge
commit on `develop`, whose tree is byte-identical to the reviewed feature head
`e7462536d183e410ff2db9792c7a6090df7f4698`. Container `p120cr3` on port 15433.

The worktree was verified clean at that SHA immediately before the run and was
**unchanged by it** — `git status --porcelain` empty at both ends, which is what makes the
run a reproof of the committed tree rather than of a local state.

### Method

A fresh `postgres:17-alpine` container (**PostgreSQL 17.10**) on an isolated port with an
empty database — **verified empty first: zero tables outside `pg_catalog`/
`information_schema` before anything ran.** The repository's own commands were driven
against it through `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD`, which is the
convention CI uses. Repository gates are the authority throughout; no ad-hoc probe
substitutes for one.

Each step's own exit code is captured directly. An earlier attempt at this harness read
`$?` after a pipe into `tail`, which reports the exit status of `tail` and would have
reported success for a failing step; that is corrected here and is the reason the step
labels below carry their real `exit=` value.

### Results

| Proof                                         | Result                                                                                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database empty before anything ran            | **green** — 0 tables outside the system catalogs                                                                                                    |
| PostgreSQL version                            | **17.10**                                                                                                                                           |
| All 119 migrations apply to an empty database | **green** (`exit=0`) — "All 119 migrations applied cleanly."                                                                                        |
| Migration 120 absent                          | **green** — 119 files, no `120*`                                                                                                                    |
| Migrations 1–119 unchanged vs base            | **green** — `git diff --name-status 0d86a19 db7ef97 -- supabase/migrations/` is empty                                                               |
| Declared seeds apply                          | **green** — 7 declared files (`seed.sql` + 6 under `seeds/`)                                                                                        |
| Seeds apply **twice** idempotently            | **green** (`exit=0`, run twice) — "7 declared files applied twice; five exact retention classes; every business table empty; counts idempotent"     |
| Retention classes match the committed seeds   | **green** — five exact classes, **no manual repair required**                                                                                       |
| Business tables empty where required          | **green** — every `svc`/`quo` business table 0 rows                                                                                                 |
| `iam.permissions`                             | **96** — 93 at the P1-19 baseline plus this phase's three read codes                                                                                |
| Schema inventory                              | **green** (`exit=0`)                                                                                                                                |
| Structural review                             | **PASS** — 537 FKs all validated, no runtime-reachable destructive cascade, FK index coverage complete, no duplicate indexes, zero dictionary drift |
| Full **unit** suite                           | **903 passed**, 42 files                                                                                                                |
| Full **backend** suite                        | **1264 passed**, 56 files                                                                                                          |
| Full **database** suite                       | **1610 passed**, 136 files                                                                                                        |
| `schema_hash` **before** the suites           | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c`                                                                                  |
| `schema_hash` **after** all three suites ran  | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c` — **unchanged**                                                                  |
| Worktree unchanged by the run                 | **green** — `git status --porcelain` empty at both ends                                                                                             |

### Structural posture — identical to the frozen baseline

`schema_hash` is byte-identical to the P1-17/P1-18/P1-19 baseline, which is the whole
point: **P1-20 adds no migration, so a fresh database built from the committed migrations
must be indistinguishable from the one P1-19 gated.**

| Measure                 | Frozen baseline | Clean room |
| ----------------------- | --------------- | ---------- |
| Schemas                 | 17              | **17**     |
| Tables                  | 242             | **242**    |
| Columns                 | 3562            | **3562**   |
| Functions               | 212             | **212**    |
| Triggers                | 541             | **541**    |
| Policies                | 631             | **631**    |
| Indexes                 | 999             | **999**    |
| Constraints             | 1845            | **1845**   |
| Views                   | 0               | **0**      |
| `SECURITY DEFINER`      | 0               | **0**      |
| RLS tables not forced   | 0               | **0**      |

Per-schema tables: `org:17 iam:17 shared:29 crm:21 veh:23 apt:6 rec:23 wo:15 tech:9
dia:13 qms:7 svc:11 quo:6 inv:18 sal:19 wty:5 rpt:3`.

### Why this run exists

The gate is decided against `db7ef97`. Run 1's SHA is not an ancestor of the gated tree's
content in any meaningful sense — 37 files differ, including every file the four new
operations live in — so citing it would have meant certifying a tree that was never
tested from empty. The instruction not to re-run the clean room absent a file change was
written on the understanding that the committed record already covered the final tree; it
did not, and re-running was cheaper than gating on evidence that did not match.

---

## Run 1 — superseded, preserved as taken


**SHA under test: `17e59ae51395bff064677abbfe9e15eebf716383`**, branch
`feature/p1-20-service-catalog-pricing-quotation-backend`, base `develop` =
`0d86a198ad1d13aa0b3219a8f6ecafea3a699cf0`. The worktree was verified clean at that SHA
immediately before the run and was **unchanged by it** — `git status --porcelain` was empty
at both ends, which is what makes the run a reproof of the committed tree rather than of a
local state.

## Method

A fresh `postgres:17-alpine` container (**PostgreSQL 17.10**) named `p120cr` on an isolated
port (15432) with an empty database — **verified empty first: zero tables outside
`pg_catalog`/`information_schema` before anything ran.** The repository's own commands were
driven against it through `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD`, which is the
convention CI uses. Repository gates are the authority throughout; no ad-hoc probe
substitutes for one.

The point of an empty database is that it cannot pass on residue. A suite that only ever runs
against the long-lived development database can be relying on a row, a sequence value or a
grant that a fresh deployment would not have.

## Results

| Proof                                         | Result                                                                                                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database empty before anything ran            | **green** — 0 tables outside the system catalogs                                                                                                    |
| PostgreSQL version                            | **17.10** on x86_64-pc-linux-musl                                                                                                                   |
| All 119 migrations apply to an empty database | **green** — "All 119 migrations applied cleanly."                                                                                                   |
| Migration 120 absent                          | **green** — 119 files, last is `20260730090000_crm_customer_notes_write_capability.sql`                                                             |
| Migrations 1–119 unchanged vs base            | **green** — `git diff --name-status 0d86a19..HEAD -- supabase/migrations/` is empty                                                                 |
| Declared seeds apply                          | **green** — 7 declared files (`seed.sql` + 6 under `seeds/`)                                                                                        |
| Seeds apply **twice** idempotently            | **green** — "7 declared files applied twice; five exact retention classes; every business table empty; counts idempotent"                           |
| Retention classes match the committed seeds   | **green** — five exact classes, **no manual repair required**                                                                                       |
| Business tables empty where required          | **green** — validator green; every `svc`/`quo` business table 0 rows                                                                                |
| Schema inventory                              | **green**                                                                                                                                           |
| Structural review                             | **PASS** — 537 FKs all validated, no runtime-reachable destructive cascade, FK index coverage complete, no duplicate indexes, zero dictionary drift |
| No fabricated business data                   | **green** — 1,273 tracked files, no indicators                                                                                                      |
| Full **unit** suite                           | **901 passed**, 42 files                                                                                                                            |
| Full **backend** suite                        | **1219 passed**, 56 files                                                                                                                           |
| Full **database** suite                       | **1610 passed**, 136 files — on a quiet machine, third pass; see below for the two contended passes                                                 |
| P1-20 inventory gate                          | **green** — 13 operations; permissions, audit actions, events and all 27 tasks reconcile                                                            |
| Operation-depth coverage gate                 | **green** — 13/13 P1-20 at operation depth, 0 pending, 0 unit-only, 0 metadata-only                                                                 |
| OpenAPI validation                            | **green** — structurally valid, every operation guarded                                                                                             |
| `schema_hash` **before** the suites           | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c`                                                                                  |
| `schema_hash` **after** all three suites ran  | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c` — **unchanged**                                                                  |
| Worktree unchanged by the run                 | **green** — `git status --porcelain` empty at both ends                                                                                             |

## Structural posture — identical to the frozen baseline

`schema_hash` is byte-identical to the P1-17/P1-18/P1-19 baseline, which is the whole point:
**P1-20 adds no migration, so a fresh database built from the committed migrations must be
indistinguishable from the one P1-19 gated.**

| Measure               | Frozen baseline | Clean room |
| --------------------- | --------------- | ---------- |
| Schemas               | 17              | **17**     |
| Tables                | 242             | **242**    |
| Columns               | 3562            | **3562**   |
| Functions             | 212             | **212**    |
| Triggers              | 541             | **541**    |
| Policies              | 631             | **631**    |
| Indexes               | 999             | **999**    |
| Constraints           | 1845            | **1845**   |
| Views                 | 0               | **0**      |
| `SECURITY DEFINER`    | 0               | **0**      |
| RLS tables not forced | 0               | **0**      |

Per-schema tables: `org:17 iam:17 shared:29 crm:21 veh:23 apt:6 rec:23 wo:15 tech:9 dia:13
qms:7 svc:11 quo:6 inv:18 sal:19 wty:5 rpt:3`.

## The two database-suite failures, and why they are not defects

The first clean-room pass reported 1608/1610 with two failures in
`tests/db/p1-14-runtime-administration-capabilities.test.ts` — foreign-key violations on a
missing parent role and a missing parent company, both inside fixture setup. The second pass
reported 1608/1610 again, but with two **different** failures, in
`tests/db/shared-event-outbox.test.ts` — the two tests that drive parallel worker connections.

Four facts settle it:

1. **Different files fail on each run.** A defect in a test does not move between files.
2. **Each failing file passes alone** against the same container: 60/60 for the P1-14 file,
   17/17 for the outbox file.
3. **It is not a file-level race.** `vitest.config.db.ts` already sets
   `fileParallelism: false`, precisely so that cleanup in one file cannot race provisioning
   in another. Concurrency is exercised _inside_ the tests, with up to 50 parallel
   connections.
4. **P1-20 touches neither file.** `git diff --name-only 0d86a19..HEAD -- tests/db/` lists
   exactly one file, `p1-15-shared-services-runtime-capabilities.test.ts`, and it passed.

Both passes ran while a large multi-agent audit was saturating the machine. The tests that
broke are the ones that would break first under CPU starvation: two 50-connection
concurrency assertions, and a fixture setup with a 60-second hook timeout. The honest
reading is **resource contention during the run**, not a defect in the tree — and the honest
consequence is that the number cannot be recorded from a contended run. The authoritative
database figure is taken on a quiet machine and recorded above only when it is 1610/1610.

**The quiet re-run closed it: 1610 passed, 136 files, zero failures.** Same container, same
SHA, same command — the only variable removed was the load. That is the confirmation the
contention reading needed, and it is why the recorded figure comes from this pass and not
from either contended one.

Both contended passes are reported above rather than deleted. "It passes when run alone" is
exactly the sentence that hides a real intermittent defect, so the four facts that
distinguish this case from that one are written down, and so is the fact that it took three
passes to get a number worth recording.

## What the clean room proved that the development database could not

- The permission seed is genuinely **additive and idempotent**: applied twice from empty,
  counts identical, five exact retention classes, no manual repair.
- Every `svc`/`quo` business table is **empty** after migrations and seeds. Nothing in this
  phase ships business data.
- The backend suite's 1219 tests pass against a database that has never seen a fixture from
  a previous run, so none of P1-20's tests depends on residue.
- `schema_hash` is unchanged **after** all three suites have run, so no suite leaves DDL
  behind.
