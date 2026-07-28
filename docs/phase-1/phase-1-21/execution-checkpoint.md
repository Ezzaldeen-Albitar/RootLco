# P1-21 — Inventory Backend — Execution Checkpoint

A living recovery record. Updated after every coherent local commit. **A checkpoint is
not a stopping point.**

## Verified base

| Fact                       | Value                                                                    |
| -------------------------- | ------------------------------------------------------------------------ |
| Verified base SHA          | `bb9cc8813661a4a2e97bf0eff8a8d9c148742ed2` (P1-20 waiver merge)          |
| `origin/main` at start     | `491c4e0882763b5d5864737e63b4e31ca708a6b5` — untouched                   |
| Current branch             | `feature/p1-21-inventory-backend`                                        |
| Current HEAD               | see the wave table below                                                 |
| P1-20 containment verified | `e746253`, `db7ef97`, `21c5e13`, `66b84a2`, `99ebdc4` all CONTAINED      |
| P1-20 decision             | `Go — P1-20 Service Catalog, Pricing, and Quotation Backend Gate Passed` |
| Remote push occurred       | **NO** — nothing pushed; no PR                                           |
| Execution policy           | Temporary Local CI Primary Mode (owner-established, begins P1-21)        |

## Baseline totals (measured at the base SHA, before any P1-21 change)

| Suite / gate                     | Result at base                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Unit (`npm run test`)            | **903 passed / 42 files**                                                                               |
| Database (`npm run test:db`)     | **1610 passed / 136 files**                                                                             |
| Backend (`npm run test:backend`) | **1264 passed / 56 files**                                                                              |
| OpenAPI                          | 155 paths / **185 operations**, every operation guarded                                                 |
| Migrations                       | **119** applied cleanly, no migration 120                                                               |
| Seeds                            | 7 declared files applied **twice**, every business table empty                                          |
| Permissions                      | **96**                                                                                                  |
| Encoding                         | 1265 tracked text files, 0 BOM / 0 U+FFFD / 0 mojibake                                                  |
| Schema hash                      | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c`                                      |
| Schema totals                    | 242 tables (`inv` 18), 212 functions, 541 triggers, 631 policies, 999 indexes, 0 SECDEF, 0 unforced RLS |
| Classification guards            | 6/6 pass (crm 298, veh 320, apt/rec 454, wo/tech/dia/qms 657, svc/quo/inv 582, sal/wty/rpt 427)         |

Baseline jobs: `quality` **ALL_GREEN**, `secrets` **ALL_GREEN**, `database` **ALL_GREEN**.

## Local-CI command matrix (extracted from `.github/workflows/ci.yml` at the base)

The workflow defines **four** jobs and 36 repository-controlled steps. Local
equivalents run the identical `npm` scripts. Required exit code is `0` for every step.

| #   | Job      | Step                                     | Command                                                   |
| --- | -------- | ---------------------------------------- | --------------------------------------------------------- |
| 01  | quality  | Install dependencies (locked)            | `npm ci`                                                  |
| 02  | quality  | Lint                                     | `npm run lint`                                            |
| 03  | quality  | Module boundary and layering check       | `npm run validate:module-boundaries`                      |
| 04  | quality  | Authorization coverage check             | `npm run validate:authorization-coverage`                 |
| 05  | quality  | Operation-to-test coverage check         | `npm run validate:operation-coverage`                     |
| 06  | quality  | P1-19 endpoint inventory                 | `npm run validate:p1-19-inventory`                        |
| 07  | quality  | P1-20 endpoint inventory                 | `npm run validate:p1-20-inventory`                        |
| 08  | quality  | OpenAPI validation                       | `npm run validate:openapi`                                |
| 09  | quality  | Type check                               | `npm run typecheck`                                       |
| 10  | quality  | Format check                             | `npm run format:check`                                    |
| 11  | quality  | Style lint (SCSS)                        | `npm run style:check`                                     |
| 12  | quality  | Encoding hygiene                         | `npm run validate:encoding`                               |
| 13  | quality  | Unit tests                               | `npm run test`                                            |
| 14  | quality  | Production build                         | `npm run build`                                           |
| 15  | docker   | Validate compose file                    | `docker compose config --quiet`                           |
| 16  | docker   | Build dev stage                          | `docker build --target dev`                               |
| 17  | docker   | Build production runner stage            | `docker build --target runner`                            |
| 18  | docker   | Assert non-root runtime                  | `docker run --entrypoint sh … 'id -u'` ≠ 0                |
| 19  | database | Install dependencies (locked)            | `npm ci`                                                  |
| 20  | database | Migration immutability (PR-only)         | `git diff --diff-filter=MDR … supabase/migrations/` empty |
| 21  | database | Apply all migrations to a clean database | `npm run db:apply-migrations`                             |
| 22  | database | Apply declared seeds twice               | `npm run validate:seed-state`                             |
| 23  | database | CRM classification                       | `npm run validate:crm-classification`                     |
| 24  | database | Vehicle classification                   | `npm run validate:veh-classification`                     |
| 25  | database | Appointment/Reception classification     | `npm run validate:aptrec-classification`                  |
| 26  | database | WO/Tech/Dia/QMS classification           | `npm run validate:wo-tech-dia-qms-classification`         |
| 27  | database | SVC/QUO/INV classification               | `npm run validate:svc-quo-inv-classification`             |
| 28  | database | SAL/WTY/RPT classification               | `npm run validate:sal-wty-rpt-classification`             |
| 29  | database | Database suite                           | `npm run test:db`                                         |
| 30  | database | Backend foundation suite                 | `npm run test:backend`                                    |
| 31  | secrets  | Tracked environment-file guard           | `git ls-files --error-unmatch .env …` must fail           |
| 32  | secrets  | Tracked key material                     | no tracked `*.pem/key/p12/pfx`                            |
| 33  | secrets  | Scope-exclusion guard                    | `node scripts/check-scope-exclusions.mjs`                 |
| 34  | secrets  | Tracked credential patterns              | `npm run security:tracked-secrets`                        |
| 35  | secrets  | Browser service-role guard               | `npm run security:browser-secrets`                        |
| 36  | secrets  | No fake/demo business data               | `npm run validate:no-fake-data`                           |

Workflow environment reproduced locally: `NEXT_TELEMETRY_DISABLED=1`,
`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY=ci-placeholder-anon-key-not-a-secret`,
`NEXT_PUBLIC_APP_ENV=local`, and `DB_*` pointing at an isolated PostgreSQL 17.10
container. Database-backed suites run **serially**; no two suites ever share a
database concurrently.

Stated local deviations (recorded, not hidden): Node 24.16.0 locally vs Node 22 in the
workflow; no GitHub Actions layer cache for the Docker stage; the workflow's
migration-immutability step is `pull_request`-only and is reproduced as an explicit
diff check.

## Waves

| Wave | Content                                                            | Status   | Commit              |
| ---- | ------------------------------------------------------------------ | -------- | ------------------- |
| 0    | Baseline verification + local-CI command matrix                    | **DONE** | `docs` commit below |
| 1    | Protected inventory contract archaeology                           | **DONE** | `docs` commit below |
| 2    | Inventory module foundation                                        | pending  | —                   |
| 3    | Item search, opening balances, availability                        | pending  | —                   |
| 4    | Reservations + concurrency protection                              | pending  | —                   |
| 5    | Issue / return / damage / customer-supplied / external purchase    | pending  | —                   |
| 6    | Movement history, negative stock, audit, business-reference matrix | pending  | —                   |

## Discovered contracts (full detail in `wave-1-contract-archaeology.md`)

- Quantity is `numeric(12,3)` everywhere; cost is `numeric(18,4)`; every quantity
  CHECK is `> 0`, so **zero is never a legal quantity**.
- Stock is **stored** in `inv.stock_balances` and coherence-guarded against the
  movement ledger; `available_qty` is `GENERATED` as `on_hand − reserved`.
- Negative stock is enforced by three CHECK constraints on `inv.stock_balances`, not
  by application arithmetic.
- `inv.lock_stock_balance(...)` `FOR UPDATE` is the single serialization point per cell.
- Legal business references are exactly `opening_line`, `part_issue`, `part_return`,
  `damage`, `adjustment`. There is no `transfer`, `customer_supplied`, or
  `external_purchase` movement kind.
- Customer-supplied parts and external-purchase parts generate **no movement and no
  balance change** by protected contract.
- `inv.stock_movements` is granted SELECT + INSERT only — corrections are new
  movements, never edits.

## Schema reconciliations

No new migration is required. Every write P1-21 performs uses an existing
`app_runtime` grant or an existing `SECURITY INVOKER` function. **No DBCR raised.**

## Confirmed findings carried into implementation

| ID           | Severity | Finding                                                                                                                                                                                                                                                                                           |
| ------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `P1-21-D-01` | High     | `inv.issue_part` posts the `out` movement before consuming the reservation, so issuing against a reservation covering all available stock fails `ck_stock_balances_available` (`23514`). Reproduced on a live database. Backend orchestrates the granted primitives in the correct order instead. |
| `P1-21-D-02` | High     | `inv.issue_part` reads `wo.work_orders.state` and never checks it; a `draft` work order accepts an issue. No trigger enforces it either. Backend owns the issuable-lifecycle rule.                                                                                                                |
| `P1-21-D-03` | High     | `inv.issue_part` accepts a reservation belonging to a different item/location/work order and consumes it. Backend validates reservation coherence before use.                                                                                                                                     |
| `P1-21-D-04` | Low      | The reservation-expiry scheduler and the `parts_forward_state` closure blockers are assigned to P1-21 by earlier phases but sit outside the canonical 15-task scope, and the database closure guard would need an unauthorized migration. Carried forward explicitly.                             |

## Local-CI / clean-room status

| Proof                         | Status                                                                  |
| ----------------------------- | ----------------------------------------------------------------------- |
| Baseline local CI at base SHA | **PASSED** (quality / secrets / database all green)                     |
| Final exact-SHA local CI      | not yet run — awaits the final feature SHA                              |
| Fresh exact-SHA clean room    | not yet run — awaits the final feature SHA                              |
| Hosted GitHub Actions         | unavailable (university-account billing lock); never claimed as passing |

## Exact next action

Wave 2 — create the `inventory` module skeleton (domain vocabulary, exact quantity
value object, repository, services, public surface) under
`src/modules/inventory/`, following the `service-catalog` / `work-order` module
conventions, then commit and continue to Wave 3.

---

## Progress log (live)

| Wave | Content                                          | Status   | Commit    |
| ---- | ------------------------------------------------ | -------- | --------- |
| 0    | Baseline + local-CI command matrix               | **DONE** | `5427754` |
| 1    | Protected inventory contract archaeology         | **DONE** | `5427754` |
| 2    | Inventory module foundation                      | **DONE** | `41015b3` |
| 3    | API surface + permission/audit/event catalogs    | **DONE** | `08544ca` |
| 4    | Domain unit tests + coverage-gate floor          | **DONE** | `9754725` |
| 5    | Read-surface backend tests                       | **DONE** | `9c69ee4` |
| 6    | Stock + intake backend tests                     | **DONE** | `d9951ac` |
| 7    | Database integrity/concurrency tests             | **DONE** | `5e14c20` |
| 8    | 28-task traceability gate + non-backend evidence | **DONE** | `8a8b0e2` |

**HEAD = `8a8b0e2`. Nothing pushed. No PR. `origin/develop` and `origin/main` untouched.**

### Verified green at HEAD

| Gate                                  | Result                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| `validate:p1-21-inventory`            | 14 operations; permissions, audit actions, events and **28/28** task identifiers reconcile |
| `validate:operation-coverage`         | every operation invoked with its required evidence; `inv.` registered in BOTH gate hooks   |
| `validate:openapi`                    | **169 paths / 199 operations** = 185 + 14, parity both directions                          |
| `validate:authorization-coverage`     | every operation guarded, every route registered                                            |
| `validate:module-boundaries`          | no boundary or layering violation                                                          |
| `typecheck` / `lint` / `format:check` | clean                                                                                      |
| Unit                                  | **926** (903 baseline + 23)                                                                |
| Backend P1-21 suites                  | 26 + 33 + 36 = **95** new, all green                                                       |
| Database P1-21 suite                  | **14** new, all green (10-way race → exactly one winner)                                   |
| Migrations                            | **119**, no 120, none modified. Schema hash `a677eb05…` unchanged                          |
| Permissions                           | 96 → **100**                                                                               |

### Defects found and fixed while building (all caught by the database or a test)

| #   | Defect                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------- |
| 1   | `opening_inventory_batches.batch_code` NOT NULL was never supplied — no batch could have been created            |
| 2   | `counted_by` modelled nullable; now the authenticated caller and NOT settable, so maker-checker cannot be evaded |
| 3   | `opening_inventory_lines` company/branch omitted; now taken from the batch                                       |
| 4   | `Quantity.parse().assertPostable()` outside the error mapping — a zero quantity returned 500 instead of 4xx      |
| 5   | A false gate proof claiming `inv.cost.view` is declared by an operation                                          |
| 6   | Gate header carried P1-20's failure history rewritten as P1-21's — a fabricated provenance in an evidence file   |

### Exact next action

Independent adversarial reviews (§23), then the hostile 100/100 audit (§24), then
`FINAL_FEATURE_SHA` local CI (§25) and the fresh clean room (§26) — the two of which
must agree on one SHA — then first push, PR, billing-only bypass check, merge,
protected reproof, gate record, and closure.

**P1-21 is NOT closed and must not be reported as closed.**

---

## Cycle 2 — post-review state (supersedes the tables above)

Four independent adversarial reviews were run against the complete diff and
adjudicated. One Critical, five High and one test-honesty finding were opened and all
are now fixed, each with a regression test that fails if the fix is removed.

**Nothing pushed. No PR. Both protected branches untouched.**

### Measured at HEAD — every number read off the RESULT line, not the total

| Gate                                       | Result                                              |
| ------------------------------------------ | --------------------------------------------------- |
| `npm run test` (unit)                      | **926 passed / 43 files**, exit 0                   |
| `npm run test:backend`                     | **1376 passed / 59 files**, exit 0                  |
| `npm run test:db`                          | **1624 passed / 137 files**, exit 0                 |
| `validate:p1-21-inventory`                 | 14 operations, **28/28** task identifiers reconcile |
| `validate:operation-coverage`              | every operation invoked with its required evidence  |
| `validate:openapi`                         | **169 paths / 199 operations**                      |
| authorization coverage / module boundaries | green                                               |
| typecheck / lint / format                  | green                                               |
| Migrations                                 | **119**, no 120, none modified                      |
| Permissions                                | 96 to **100**                                       |

The unit figure is stated deliberately. An earlier revision of this file recorded
"Verified green at HEAD | Unit | 926" while the suite was failing 3 of those 926 — the
count was right and the outcome was never read. Every number above was taken from the
suite's own result line.

### Findings resolved this cycle

| ID    | Finding                                                                                                                                                                                                                                             |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1    | `npm run test` was RED at every commit of the phase and reported green: 11 audit actions and 3 events were added to the controlled catalogs without extending the foundation allow-lists                                                            |
| H1    | The branch scope check was skippable by omitting a query parameter — the same principal was refused branch A1 (403) and served it with the parameter left out (200)                                                                                 |
| H2    | A 0.001-unit damage destroyed an arbitrarily large reservation, unaudited and unpublished                                                                                                                                                           |
| H3    | `stock.movement.posted` was published for issues only, contradicting the event catalog and the change log                                                                                                                                           |
| H4    | `release()` decided from an unlocked pre-read, so a concurrent issue produced evidence for a release that never happened                                                                                                                            |
| H5    | Quarantined stock could be reserved and issued back onto a customer vehicle, invisibly                                                                                                                                                              |
| T1    | `idempotency` was declared for two operations with no replay test behind it                                                                                                                                                                         |
| E1-E6 | Evidence defects: random-UUID cross-tenant proofs, a vacuous quarantine assertion, two false gate-header claims, five documentary tasks with no structural proof, a literal `27` task count, and a P1-20 finding relabelled as this phase's history |

Full detail and the resolution table are in `review-adjudication.md`.

### Exact next action

Final exact-SHA local CI on a fresh database, then the clean room, then first push,
PR, billing-only bypass check, merge, protected reproof, gate record, closure.

---

## Cycle 3 — pushed, PR #87 open, NOT merged

| Fact                            | Value                                                        |
| ------------------------------- | ------------------------------------------------------------ |
| FINAL_FEATURE_SHA / remote head | `7c717c3d3392cb28278bd03c10f441bf4c9cf064`                   |
| Feature PR                      | #87, base `develop`, **Open**, "Able to merge", no conflicts |
| LOCAL_CI_SHA                    | `6e0f3644ca6850fcaa4e01c1e64178e656022c9f`                   |
| CLEAN_ROOM_SHA                  | `0daacb1692ba0c92d0c39d2fad0d074d7767104a`                   |
| `origin/develop`                | `bb9cc881…` untouched                                        |
| `origin/main`                   | `491c4e08…` untouched                                        |

### Hosted checks — billing lock confirmed from the actual annotations

Run `30354181717`. Exactly **one** annotation, verbatim:

> The job was not started because recent account payments have failed or your
> spending limit needs to be increased. Please check the 'Billing & plans' section in
> your settings

No checkout, no `npm ci`, no repository command — searched for and absent. This is an
account-level lock, not a repository failure.

### The bypass is NOT taken, and why

Of the owner's ten conditions, eight hold: jobs did not start (1), no checkout (2), no
repository command executed (3), the only annotation is the known billing message (4),
no conflicts (7), unresolved Critical 0 (8), unresolved High 0 (9), and the merge would
go through the PR with a merge commit (10).

**Conditions 5 and 6 do not literally hold.** They require the local equivalent CI and
the fresh clean room to have passed **on the exact PR head SHA**. Both ran two
documentation commits earlier. The executable diff between those SHAs and the head is
**empty** — verified with
`git diff --stat <sha>..HEAD -- src tests scripts package.json package-lock.json supabase .github`
— so every executable and test path is byte-identical, and the substance of the
conditions is met. But "byte-identical executable tree" is not the same sentence as
"on the exact PR head SHA", and an authorized bypass is not the place to substitute a
weaker one of my own choosing.

### Exact next action

Re-run the full local equivalent CI **and** the fresh clean room at
`7c717c3d3392cb28278bd03c10f441bf4c9cf064` exactly. Both are expected to reproduce the
recorded results, since the delta is documentation only. Once they do, all ten
conditions hold and the bypass merge may proceed — followed by the protected merge
reproof, the documentation-only gate record, and closure.

**P1-21 is NOT closed.**

---

## Cycle 4 — the exact-SHA re-verification found a sixth High

The re-verification did not reproduce the recorded results and proceed to merge. The
focused final review it began with found a **new High in the executable code**, so the
bypass was not taken and the branch moved again.

### H6 — an incoherent (company, branch) pair disclosed another company's stock

The H1 fix was complete at the service layer and **incomplete at the SQL layer**.
`readAvailability` and `readMovements` filter on `company_id` AND `branch_id`;
`reconcileBalances` filtered on `branch_id` alone. Because the deployed
`iam.has_permission_in_scope` matches `company OR branch`, a caller holding the
permission COMPANY-scoped to one company passes the check while naming a branch of
another — and `iam.allowed_branch_ids()` is permission-blind, so RLS admits the rows.

Reproduced against a live database before any code changed, one principal, two
requests differing only in which SQL the route reaches:

| Request                                                                 | Result                                                    |
| ----------------------------------------------------------------------- | --------------------------------------------------------- |
| `GET /inventory-reconciliations?companyId=<A1>&branchId=<branch of A9>` | **200**, one cell — A9 SKU and `storedOnHand` **`7.000`** |
| `GET /stock-availability?companyId=<A1>&branchId=<branch of A9>`        | **200**, `items: []`                                      |

Two fixture blind spots had to coincide for this to survive: every tenant-A fixture
hung off one company, so no pair could be incoherent; and no P1-21 principal carried a
`scope_type = 'company'` grant, because `Principal.scope` only writes branch scopes.

Fixed by giving `reconcileBalances` the same required `companyId` and the same
`b.company_id = $2` predicate the other two reads carry. Mutation-proved: reverting the
predicate fails exactly one assertion — `expected 1 to be +0`, the leaked cell — with
the control still green, and the file restored byte-identically afterwards.

Closed alongside it: the caller-supplied `workOrderId` filter on the same read reached
`countOpenCommitments`, which filters on tenant and work order only. It is now pinned to
the authorized pair through a new non-locking `readWorkOrderScope`.

### An honest note on the vacuity I nearly shipped

The first version of the H6 regression asserted `cellsChecked === 0` **without seeding
any stock into the second company**. It passed — and would have passed against the
unfixed code, because an empty branch also returns zero cells. That is precisely the
defect T1 records, reproduced by me one screen after writing T1 up. It was caught by
running the mutation rather than by reading the test, which is the argument for
mutation-testing every regression rather than trusting that a green test means
anything. The fixture now seeds `7.000` into A9 and a control asserts an unrestricted
caller naming the coherent pair receives exactly that.

### Consequence for the exact-SHA proof

The branch advanced, so `7c717c3` and `3e8e80d` are both superseded. Every exact-SHA
proof — local equivalent CI and fresh clean room — must run against the **new** head,
and conditions 5 and 6 of the bypass are evaluated only against that SHA.

Measured after the fix, before the exact-SHA battery: unit **926 / 43 files**, backend
**1380 / 59 files**, `validate:p1-21-inventory` 14 operations and 28/28 identifiers,
authorization coverage, operation coverage, OpenAPI, module boundaries, lint, typecheck
and format all exit 0.

### Where the exact-SHA evidence is recorded

The final local CI and clean room run against the head **cannot be committed to the
feature branch**: writing the result into a file on that branch creates a new commit,
which changes the head the result claims to describe. That regress is what stalled
Cycle 3. The exact-SHA evidence is therefore recorded in the **gate record**, which is
created from the protected merge commit after the feature merge and is documentation
only — the first place in the process where a SHA can be named without moving it.

### Cycle 4 proof results

Both exact-SHA proofs ran against the H6 tree.

**Local equivalent CI — all 37 steps exit 0, zero failures, zero retries.** Unit
**926 / 43**, database **1624 / 137**, backend **1380 / 59**; 119 migrations with no
120; OpenAPI **169 paths / 199 operations**; `validate:p1-21-inventory` 14 operations
and 28/28 identifiers; schema hash `a677eb05…` identical before and after every suite;
uid **1001**. The `ERR_IPC_CHANNEL_CLOSED` worker crash seen in the earlier cycle did
not recur — the stale P1-21 containers from previous cycles were removed first, which
is the likely reason but is recorded as an observation, not a proven cause.

**Fresh clean room — green**, in a clone detached at the same commit against a database
verified to hold zero application tables. Every figure above reproduced independently.

Two things from the previous clean room are now closed:

- Its first unit run had reported **925 / 1 failed** with the failure identity lost.
  This clean room retained complete stdout and stderr for every step precisely so a
  recurrence could be named. **The first unit run passed 926/926.** There was nothing
  to name.
- `npm run build` failed once here, and it was diagnosed rather than retried:
  a Turbopack panic reading `path length … exceeds max length of filesystem`. The clone
  root was 156 characters and Windows caps paths at 260; the named chunk belongs to a
  **P1-19** route, untouched by this phase. The **same clone**, moved to `C:\cr\RootLco`
  with `.next` removed and nothing else changed, built **exit 0** — as did the local CI
  at the ordinary repository path. The runbook now mandates a short clone root so the
  environment cannot produce a log that looks like a build defect again.

### Hosted checks at the H6 head

Run **#276** (`30357025855`): status **Failure**, total duration **11 s**, jobs at
10 s / 11 s / 3 s / 10 s, **no artifacts**, and **all four annotations byte-identical**:

> The job was not started because recent account payments have failed or your spending
> limit needs to be increased. Please check the 'Billing & plans' section in your settings

No checkout ran and no repository command executed — the durations alone rule that out.
Bypass conditions 1–4 hold on the evidence, not on assumption.

### Why this commit exists, and what it costs

An earlier revision of `pull-request-body.md` and `final-local-ci.md` hard-coded the
local-CI and clean-room SHAs and stated the executable diff to the head was **empty**.
That was true when written and **became false the moment the H6 fix landed**, because
that commit changed `src` and `tests`. Committed evidence that decays into a false
statement is worse than no evidence, so both files now state the invariant instead of
transcribing a SHA, and neither can go stale again.

The cost is honest and unavoidable: this documentation commit moves the head, so the
Cycle 4 proofs above no longer sit on the head, and **both must run again on the commit
this section is part of**. Their results are recorded in the gate record — the first
document in the process created from a commit it does not itself change.

---

## Cycle 5 — the repository became public and Actions became authoritative again

The owner changed repository visibility from private to **public**, so standard
GitHub-hosted runners execute on the free public tier instead of consuming exhausted
private-repository Actions credits. That ends the Temporary Local CI Primary Mode.

**From this point the gate rests on GitHub Actions, not on this laptop.** The local
battery and the local clean room are retained as corroboration and are not re-run.

### The billing lock had already lifted, and it was verified rather than assumed

Before the visibility change, run **#277** (`30360215916`) on `53c954d` had already
succeeded — status **Success**, total **6m 03s**, on `ubuntu-latest`. It was checked
step by step rather than trusted as a green tick, because a job that never starts also
produces no failures:

- Quality — `Install dependencies (locked)` 17s, Lint 15s, Type check 14s, **Unit tests
  10s**, **Production build 24s**, plus module boundaries, authorization coverage,
  operation coverage, the three inventories, OpenAPI, format, stylelint, encoding.
- Database — `Apply all migrations to a clean database`, seeds twice, migration
  immutability, six classification guards, **database suite 2m22s**, **backend
  foundation suite 2m35s**.
- Docker — both image targets, two build-record artifacts with sha256 digests.
- Secrets — real checkout and all four guards.

All four annotations are **warnings** about the Node 20 action deprecation. There are
**no errors**. The earlier billing annotations belong to superseded ancestor commits
and are historical.

**The owner-authorized billing bypass was therefore never used, and will not be.**

### Public-repository security preflight

| Check                                             | Result                                                                                                                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository visibility                             | **Public**                                                                                                                                                                   |
| Tracked `.env` / `.env.local` / `.env.production` | **None**. Only `.env.example`, which holds placeholders                                                                                                                      |
| Tracked key material (`.pem/.key/.p12/.pfx`)      | **None**                                                                                                                                                                     |
| High-signal credential patterns                   | Two matches, both benign: a docs table listing token **prefixes** as detection patterns, and a logger test fixture literally valued `sk_live_do_not_log` asserting redaction |
| Repository secrets used by workflows              | **None.** The only `secrets.` match in `.github/workflows/` is inside a comment                                                                                              |
| `pull_request_target`                             | **Absent** — the classic public-repository privilege-escalation trigger is not used                                                                                          |
| Pilot-tenant / excluded-scope guards              | Clean across 1321 tracked files                                                                                                                                              |
| Fabricated business data                          | Clean across 1321 tracked files                                                                                                                                              |

**No real credential was found, so nothing required rotation.**

One finding worth the owner's attention, recorded rather than silently accepted:
GitHub's own **Secret scanning is Disabled, Dependabot alerts are Disabled, and Code
scanning needs setup** on this repository. There were therefore no alerts to read — not
because the tree is clean, but because nothing is watching it. The repository's own
tracked-secret and browser-secret scanners do run in CI and pass. Enabling the three
GitHub-native scanners is a repository-settings change and is left to the owner.

### Runner verification

All four `ci.yml` jobs declare `runs-on: ubuntu-latest`. There is no self-hosted
runner, no larger runner, and no paid runner group anywhere in `.github/workflows/`.
The `group:` key at `ci.yml:24` is the **concurrency** group, not a runner group.
**No workflow change was needed for runner reasons.**

### A hosted clean room was required, and why

`ci.yml` was examined step by step against the clean-room definition rather than
declared equivalent to it. Most of the definition was already satisfied — fresh hosted
VMs, lockfile-only install, fresh PostgreSQL 17, all suites, OpenAPI, build, Docker.
**Three requirements were genuinely missing:**

1. no assertion that the database held **zero application tables** before migration;
2. **no schema-hash step at all**, so a suite that mutated the schema would leave no
   trace and every result above it would be silently unsound;
3. no **clean-worktree** check.

So `.github/workflows/p1-21-clean-room.yml` was added — `P1-21 Hosted Clean Room`, one
`ubuntu-latest` job, `postgres:17-alpine`, every suite serial in a single job against a
single database.

It is also stricter than `ci.yml` in a way that matters: for a `pull_request` event
`actions/checkout` defaults to the **merge ref**, a synthetic commit that exists nowhere
in the branch history — proving that tree is not the same as proving the commit being
merged. The clean room pins `ref: github.event.pull_request.head.sha` and then
**asserts** `git rev-parse HEAD` equals it, failing closed otherwise.

Adding the workflow moves the head, so every hosted proof re-runs on the new SHA. That
is the cost of the correction and it is paid rather than argued around.
