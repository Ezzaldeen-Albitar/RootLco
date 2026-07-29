# P1-21 — Inventory Backend Gate Record

**Phase:** P1-21 — Inventory Backend
**Prerequisite:** P1-20 closed (Go), `origin/develop` at `bb9cc8813661a4a2e97bf0eff8a8d9c148742ed2`
**Decision:** recorded in §14 below.

This is a **documentation-only** record. It changes no executable file, no test, no
script, no workflow, no lockfile, no Supabase file, no seed and no migration.

---

## 1. Verification mode — and the transition that changed it

P1-21 began under an **Owner-Approved Temporary Local CI Primary Mode**. The repository
was private, its GitHub Actions credits were exhausted, and hosted jobs failed _before
startup_ with an account billing message — no runner assigned, no checkout, no
repository command executed.

**Before merge the repository was made public**, which restores standard GitHub-hosted
runners on the free public tier. From that point **GitHub Actions is the primary and
authoritative verification path for P1-21**, and it is what this gate rests on.

Two consequences are stated plainly because they matter:

- **The owner-authorized billing bypass was never used.** Every required check on the
  merged commit executed for real and passed. No required check was waived, no branch
  protection was weakened, and no protected branch was pushed to directly.
- **The local CI battery and the local clean room are corroboration, not evidence of
  record.** Their documents (`final-local-ci.md`, `clean-room.md`) say so at the top.

The billing annotations that appear on **ancestor** commits are historical. They are not
the result for the merged tree and are not treated as such.

---

## 2. Repository visibility and runner posture

| Check                                    | Result                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| Repository visibility                    | **Public**                                                                                 |
| GitHub Actions                           | **Enabled**, executing                                                                     |
| Runner labels, every required job        | **`ubuntu-latest`** — standard GitHub-hosted                                               |
| Self-hosted runners                      | **None**                                                                                   |
| Larger / paid runner groups              | **None**. The `group:` key at `ci.yml:24` is the **concurrency** group, not a runner group |
| Workflow altered for runner reasons      | **No** — nothing needed changing                                                           |
| `pull_request_target`                    | **Absent** anywhere in `.github/workflows/`                                                |
| Repository secrets consumed by workflows | **None**. The only `secrets.` occurrence is inside a comment                               |

---

## 3. Public-repository security preflight

Performed before rerunning CI, because making a repository public exposes the tree and
every Actions log at once.

| Item                                            | Result                                                                                                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tracked `.env`, `.env.local`, `.env.production` | **None.** Only `.env.example`, which contains placeholders and commented-out keys                                                                                               |
| Tracked key material (`.pem/.key/.p12/.pfx`)    | **None**                                                                                                                                                                        |
| High-signal credential patterns                 | **Two matches, both benign** — a docs table listing token _prefixes_ as detection patterns, and a logger test fixture literally valued `sk_live_do_not_log` asserting redaction |
| Customer / pilot data                           | Pilot-tenant guard and excluded-scope guard clean over **1323** tracked files, on the hosted runner                                                                             |
| Fabricated business data                        | `validate:no-fake-data` clean over **1323** tracked files, on the hosted runner                                                                                                 |
| Tracked-secret scan (hosted)                    | **Pass** — no credential-shaped values in tracked files                                                                                                                         |
| Browser/public secret scan (hosted)             | **Pass** — no browser-exposed service-role variable                                                                                                                             |
| Actions-log exposure                            | Workflows consume no secret and print none; the only literals are placeholder Supabase values and a throwaway service-container password                                        |
| **Exposed credentials**                         | **None**                                                                                                                                                                        |
| **Credential rotations required**               | **None**                                                                                                                                                                        |

### An open finding, recorded rather than quietly accepted

GitHub's own scanners are **not enabled** on this repository:

| Feature                | State           |
| ---------------------- | --------------- |
| Secret scanning alerts | **Disabled**    |
| Dependabot alerts      | **Disabled**    |
| Code scanning alerts   | **Needs setup** |

There were therefore **no alerts to read — not because the tree is clean, but because
nothing is watching it.** The repository's own scanners do run in CI and pass, which is
what this gate relies on. Enabling the three GitHub-native scanners is a
repository-settings change and is left to the owner. Recorded as **P1-21-A-01**.

---

## 4. Feature pull request

| Field                    | Value                                                |
| ------------------------ | ---------------------------------------------------- |
| Pull request             | **#87** — `feat(p1-21): implement inventory backend` |
| Base                     | `develop`                                            |
| Head branch              | `feature/p1-21-inventory-backend`                    |
| **Final reviewed SHA**   | **`96c93cadcba573e34f97f8f6ea7814c2f707abeb`**       |
| Mergeable state at merge | `clean` — no conflicts                               |
| Check runs on that SHA   | **5 of 5 completed success**                         |
| Merge strategy           | **Merge commit** — not squash, not rebase            |

### Hosted proofs on the exact reviewed SHA

| Workflow                  | Run                        | Result                               |
| ------------------------- | -------------------------- | ------------------------------------ |
| `CI`                      | **#278**, id `30363179679` | **Success** — all 4 jobs, every step |
| `P1-21 Hosted Clean Room` | **#1**, id `30363175882`   | **Success** — all 21 steps, 7m 25s   |

Run **#277** (`30360215916`) also succeeded on the immediately preceding commit
`53c954d`, including a deliberate `Re-run all jobs` (**attempt 3, success**) to confirm
the result was deterministic and not a one-off.

---

## 5. GitHub-hosted exact-SHA clean room

`ci.yml` was examined **step by step** against the clean-room definition rather than
declared equivalent to it. Most of the definition was already satisfied — fresh hosted
VMs, lockfile-only install, a fresh PostgreSQL 17 service, all suites, OpenAPI, build,
Docker. **Three requirements were genuinely missing, and each fails silently:**

1. no assertion that the database held **zero application tables** before the first
   migration;
2. **no schema-hash step at all** — a suite that mutated the schema would leave no trace
   and every result above it would be unsound;
3. no **clean-worktree** check.

`.github/workflows/p1-21-clean-room.yml` closes all three in **one job against one
database**, so the suites are serial by construction rather than by convention.

It is also stricter than `ci.yml` in one respect that matters: for a `pull_request`
event `actions/checkout` defaults to the **merge ref** — a synthetic commit that exists
nowhere in the branch history — so proving that tree is _not_ proving the commit being
merged. The clean room pins `github.event.pull_request.head.sha` and then **asserts**
`git rev-parse HEAD` equals it, failing closed.

### Readings taken from the hosted clean-room log

| Proof                                   | Hosted reading                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Runner                                  | `ubuntu-latest`                                                                                              |
| Exact-head assertion                    | `expected` = `actual` = `96c93cadcba573e34f97f8f6ea7814c2f707abeb`                                           |
| Database engine                         | **PostgreSQL 17.10**                                                                                         |
| **Application tables before migration** | **0**                                                                                                        |
| Migration files in tree                 | **119**                                                                                                      |
| Migrations applied                      | **All 119 applied cleanly** — **no migration 120**                                                           |
| Seeds                                   | 7 declared files applied **twice**, idempotent, five exact retention classes, **every business table empty** |
| **Schema hash before suites**           | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c`                                           |
| **Schema hash after suites**            | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c` — **identical**                           |
| Unit and foundation suite               | **926 passed / 43 files**                                                                                    |
| Database suite                          | **1624 passed / 137 files**                                                                                  |
| Backend suite                           | **1380 passed / 59 files**                                                                                   |
| P1-21 traceability gate                 | **14 operations; permissions, audit actions, events and all 28 task identifiers reconcile**                  |
| P1-20 / P1-19 inventories               | 17 operations / 27 tasks · 58 operations — both current                                                      |
| OpenAPI                                 | structurally valid, **every operation guarded**                                                              |
| Authorization coverage                  | every operation guarded, every route registered                                                              |
| Module boundaries                       | no boundary or layering violation                                                                            |
| Docker                                  | compose valid; production runner image built; **runtime uid=1001**                                           |
| **Working tree after everything**       | **clean**                                                                                                    |

---

## 6. Protected feature merge

| Field                           | Value                                                                   |
| ------------------------------- | ----------------------------------------------------------------------- |
| **FEATURE_MERGE_SHA**           | **`28df255ddbd5d854b85735fae085e64b3c783a32`**                          |
| Parent 1                        | `bb9cc8813661a4a2e97bf0eff8a8d9c148742ed2` — the protected develop base |
| Parent 2                        | `96c93cadcba573e34f97f8f6ea7814c2f707abeb` — the reviewed feature SHA   |
| Merge tree                      | `963e4df2624184a47e49406d10064298a335e376`                              |
| Reviewed feature tree           | `963e4df2624184a47e49406d10064298a335e376` — **byte-identical**         |
| Reviewed SHA contained          | **Yes** (`git merge-base --is-ancestor`)                                |
| File drift merge↔feature        | **Zero** (`git diff --name-status` empty)                               |
| Commits added to develop        | 24 — 23 feature commits plus the merge commit                           |
| Migrations on the merge         | **119**, **no migration 120**                                           |
| Migration files changed vs base | **None**                                                                |
| `origin/main`                   | `491c4e0882763b5d5864737e63b4e31ca708a6b5` — **unchanged**              |
| Direct protected pushes         | **None**                                                                |
| Merged at                       | 2026-07-28T13:37:34Z                                                    |

## 7. Protected develop push CI

This replaces the previously planned local protected reproof.

| Field    | Value                                                            |
| -------- | ---------------------------------------------------------------- |
| Workflow | `CI`, run **#279**, id `30364368667`                             |
| Event    | **push**                                                         |
| Branch   | **develop**                                                      |
| Head SHA | **`28df255ddbd5d854b85735fae085e64b3c783a32`**                   |
| Status   | **completed — success**                                          |
| Window   | 2026-07-28T13:37:38Z → 13:43:14Z                                 |
| Jobs     | 4 of 4 **success**, all `ubuntu-latest`, **0 non-success steps** |

---

## 8. Completion

| Category                | Result                                                                          |
| ----------------------- | ------------------------------------------------------------------------------- |
| Backend tasks           | **15/15** (`P1-21-BE-001…015`)                                                  |
| Security tasks          | **4/4** (`SEC-001…004`)                                                         |
| QA tasks                | **5/5** (`QA-001…005`)                                                          |
| DevOps tasks            | **2/2** (`DO-001…002`)                                                          |
| Documentation tasks     | **2/2** (`DOC-001…002`)                                                         |
| **Total tasks**         | **28/28**, enforced mechanically against artifacts, not prose                   |
| Operations              | **14**, all registered, all guarded                                             |
| Operation depth         | 100% — pending 0, unit-only 0, metadata-only 0                                  |
| OpenAPI                 | **169 paths / 199 operations**; 14 `inv.*`; parity in both directions           |
| Unit                    | **926 / 43 files**                                                              |
| Backend                 | **1380 / 59 files**                                                             |
| Database                | **1624 / 137 files**                                                            |
| Docker                  | dev and runner images built; **uid 1001**                                       |
| Security                | all hosted scans pass                                                           |
| Permissions             | 96 → **100** (`inv.*` 5 → 9)                                                    |
| Audit actions           | **11**                                                                          |
| Events                  | **3** (`stock.reserved`, `stock.reservation.released`, `stock.movement.posted`) |
| Migrations              | **119**, **no migration 120**, none modified                                    |
| Schema hash             | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c`              |
| **Critical unresolved** | **0**                                                                           |
| **High unresolved**     | **0**                                                                           |

The backend total is **1380, not the 1376 carried in earlier planning notes**. The H6
regression added four tests. It is recorded here as measured on the hosted runner,
because a figure copied from an expectation is not evidence.

---

## 9. Findings — one Critical, six High, one test-honesty, all resolved

Every finding was **reproduced directly** before being accepted, and every fix carries a
regression test that fails if the fix is removed.

| ID     | Finding                                                                                                                                                                                                                                                                        | State    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| **C1** | `npm run test` had been **red at every commit of the phase** and was reported green — 11 audit actions and 3 events were added to the controlled catalogs without extending the foundation allow-lists. The count in the checkpoint was right; the outcome line was never read | Resolved |
| **H1** | The branch scope check was **skippable by omitting a query parameter**: the same principal was refused branch A1 (403) and served A1 with the parameter left out (200)                                                                                                         | Resolved |
| **H2** | A 0.001-unit damage destroyed an arbitrarily large reservation, unaudited and unpublished, because `inv.free_reservations_for_loss` releases whole rows                                                                                                                        | Resolved |
| **H3** | `stock.movement.posted` was published for issues only, contradicting the event catalog and the change log                                                                                                                                                                      | Resolved |
| **H4** | `release()` decided from an unlocked pre-read, so a concurrent issue produced an audit record and an event for a release that never happened                                                                                                                                   | Resolved |
| **H5** | Quarantined (damaged) stock could be **reserved and issued back onto a customer's vehicle**, invisibly                                                                                                                                                                         | Resolved |
| **H6** | An **incoherent (company, branch) pair disclosed another company's stock**                                                                                                                                                                                                     | Resolved |
| **T1** | `idempotency` was declared for two operations with no replay test behind it                                                                                                                                                                                                    | Resolved |

### H6 in full, because it was found last and is the subtlest

H1's remediation was complete at the service layer and **incomplete at the SQL layer**.
`readAvailability` and `readMovements` filter on `company_id` **and** `branch_id`;
`reconcileBalances` filtered on `branch_id` alone. The deployed
`iam.has_permission_in_scope` matches

```
   (s.scope_type = 'company' AND s.company_id = p_company)
OR (s.scope_type = 'branch'  AND s.branch_id  = p_branch)
```

so a caller holding the permission **company-scoped** to company X passes the check while
naming a branch of company Y — and `iam.allowed_branch_ids()` is the permission-blind
union of every active grant, so RLS admits company Y's rows.

Measured before the fix, one principal, two requests differing only in which SQL the
route reaches:

| Request (identical query string)                                        | Result                                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `GET /inventory-reconciliations?companyId=<A1>&branchId=<branch of A9>` | **200**, one cell — company A9's SKU and `storedOnHand` **`7.000`** |
| `GET /stock-availability?companyId=<A1>&branchId=<branch of A9>`        | **200**, `items: []`                                                |

Two fixture blind spots had to hold at once for this to survive: every tenant-A fixture
hung off a single company, so no pair could be incoherent; and no P1-21 principal carried
a `scope_type = 'company'` grant, because the fixture helper only ever writes branch
scopes.

**Mutation-proved.** Reverting the predicate fails exactly one assertion —
`expected 1 to be +0`, the leaked cell — while the control stays green; the file was then
restored byte-identically. Closed alongside it: the caller-supplied `workOrderId` filter
on the same read reached `countOpenCommitments`, which filters on tenant and work order
only, and is now pinned to the authorized pair through a non-locking `readWorkOrderScope`.

**A vacuity caught by mutation, not by reading.** The first version of the H6 regression
asserted `cellsChecked === 0` **without seeding any stock into the second company**. It
passed — and would have passed against the unfixed code, because an empty branch also
returns zero cells. That is precisely the defect T1 records. The fixture now seeds
`7.000` into A9 and a control asserts an unrestricted caller naming the coherent pair
receives exactly that.

---

## 10. Inventory guarantees

| Guarantee                 | How it is enforced                                                                                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Item search               | Tenant-scoped (`inv.item_master` has no company/branch column); archived excluded by default; LIKE metacharacters escaped, proven with a SKU containing a literal `_`             |
| Opening balances          | Maker–checker: `counted_by` is not settable by the caller, and `ck_opening_inventory_batches_maker_checker` requires a different approver                                         |
| Availability              | `scope: 'branch'` with a concrete target; `company_id` **and** `branch_id` are SQL predicates; quarantine excluded by default                                                     |
| Reservation               | Serialized through `inv.lock_stock_balance`; a ten-way concurrent race resolves to exactly one winner                                                                             |
| Release                   | Reservation is `FOR UPDATE`-locked **before** the decision, so no audit or event is written for a release that did not happen                                                     |
| Issue                     | Composed so the outbound movement cannot trip `ck_stock_balances_available`; work-order lifecycle checked; reservation coherence (item, location, work order, reference) enforced |
| Return                    | Bounded by the original issue; movement published                                                                                                                                 |
| Damaged return            | Both legs published; collateral reservation release **refused** when it would exceed the damage; genuine releases audited and published                                           |
| Customer-supplied         | Recorded as custody, **not** stock — no balance, no movement                                                                                                                      |
| External purchase         | Non-procurement record; restricted cost gated behind `inv.cost.view`                                                                                                              |
| Movement history          | `scope: 'branch'` with both predicates; privileged read is itself audited                                                                                                         |
| **Negative stock**        | Refused even against a **raw balance UPDATE that bypasses every function**                                                                                                        |
| Concurrency               | Real database concurrency tests, not mocks                                                                                                                                        |
| Audit                     | 11 actions with real producers; audit and outbox atomic with the write                                                                                                            |
| Business references       | All illegal movement/reference triples refused; `uq_stock_movements_source` enforces single use                                                                                   |
| Quarantine                | `requireSellableLocation` refuses reservation and issue from a quarantine cell                                                                                                    |
| P1-19 closure integration | An application-level inventory blocker refuses work-order closure while stock is reserved or issued and unreturned, via a public port with no import cycle                        |

---

## 11. Protected-contract mitigations

Three defects in the **frozen Phase 1-10** functions were reproduced against a live
database _before_ any code was written, and are closed in application code because no
migration is authorized:

1. `inv.issue_part` posts the `out` movement **before** consuming the reservation, so
   issuing against a reservation covering all available stock trips
   `ck_stock_balances_available`.
2. It reads `wo.work_orders.state` and never checks it, so a `draft` work order accepted
   an issue.
3. It consumes whatever reservation id it is handed, including one belonging to a
   different item.

Recorded as protected-contract mitigations and **change-control candidates**, not as
silently fixed database behaviour.

## 12. Accepted limitations — open, none blocking

| ID             | Limitation                                                                                                                                                                                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1-21-A-01** | GitHub Secret scanning, Dependabot alerts and Code scanning are disabled/unconfigured on this now-public repository                                                                                                                                                        |
| **P1-21-A-02** | The scheduled `inv.expire_reservations` caller is not built; `inv.reserve_stock` expires opportunistically                                                                                                                                                                 |
| **P1-21-A-03** | The database closure guard still raises only B1–B6, so the inventory closure blocker is enforced in the application — extending `wo.guard_work_order_closure` needs a migration                                                                                            |
| **P1-21-A-04** | The Medium and Low findings listed in `review-adjudication.md`, none merge-blocking                                                                                                                                                                                        |
| **P1-18-A-01** | Pre-existing, platform-wide: `iam.has_permission_in_scope` matches company **or** branch, and `iam.allowed_branch_ids()` is permission-blind. P1-21 compensates with explicit `company_id` + `branch_id` SQL predicates on every branch-scoped read — which is what H6 was |

## 13. Scope discipline

No Benzene hard-coding. No Zoom functionality. No P1-22 work. No new product naming —
the product name remains `[PRODUCT NAME — Pending Final Approval]`. No unapproved
country, tax, currency or retention defaults. **No migration**, as the phase mandate
required.

---

## 14. Gate condition matrix

| #   | Condition                                                      | Result                                                |
| --- | -------------------------------------------------------------- | ----------------------------------------------------- |
| 1   | P1-20 prerequisite closed                                      | **Met**                                               |
| 2   | Repository public; Actions authoritative                       | **Met**                                               |
| 3   | Every required job on a standard hosted runner                 | **Met** — `ubuntu-latest`                             |
| 4   | Public-repository security preflight                           | **Met** — no exposed credential, no rotation required |
| 5   | Feature PR checks green on the exact reviewed SHA              | **Met** — 5/5, runs #278 and Clean Room #1            |
| 6   | Hosted exact-SHA clean room                                    | **Met** — 21/21 steps                                 |
| 7   | Tasks 28/28                                                    | **Met**                                               |
| 8   | Operations 14, depth 100%, pending 0                           | **Met**                                               |
| 9   | OpenAPI parity exact                                           | **Met** — 169 / 199                                   |
| 10  | Unit / backend / database suites                               | **Met** — 926 / 1380 / 1624                           |
| 11  | Docker and non-root runtime                                    | **Met** — uid 1001                                    |
| 12  | Migrations 119, no 120, none modified                          | **Met**                                               |
| 13  | Schema hash unchanged before and after suites                  | **Met** — `a677eb05…`                                 |
| 14  | Negative stock, concurrency, reference integrity, audit/outbox | **Met**                                               |
| 15  | P1-19 closure integration honoured                             | **Met**                                               |
| 16  | Critical unresolved 0                                          | **Met**                                               |
| 17  | High unresolved 0                                              | **Met**                                               |
| 18  | Protected merge: merge commit, tree identity, zero drift       | **Met**                                               |
| 19  | Protected develop push CI                                      | **Met** — run #279 success                            |
| 20  | `origin/main` unchanged; no direct protected push              | **Met**                                               |
| 21  | No billing bypass used                                         | **Met**                                               |
| 22  | Scope discipline (Benzene, Zoom, P1-22, naming, defaults)      | **Met**                                               |

**22 of 22 conditions Met.**

---

## 15. Decision

**Go — P1-21 Inventory Backend Gate Passed**

P1-21 began under Temporary Local CI Primary Mode while the repository was private and
Actions credits were exhausted. Before merge, the repository was made public and standard
GitHub-hosted Actions were restored as the authoritative verification path. All final
feature, clean-room, protected-merge and protected-push checks executed successfully on
GitHub-hosted runners.

The final protected gate push CI is recorded in the closure report that accompanies this
gate, once the gate pull request itself is merged and its push run completes.
