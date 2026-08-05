# Phase 1-27 — execution checkpoint

**Classification:** Confidential — Commercial Product and Pilot Planning

**Status: OPEN. Not closed, not promoted.** P1-27 closes only on an explicit
`OWNER ACCEPTANCE: PASS` after the Product Owner manually tests the running
application in installed Chrome. Silence is not Pass.

---

## 1. Base

The feature branch is based on the exact protected `develop` SHA **after all four
prerequisite remediations were merged**, as §6 requires.

| key                          | value                                      |
| ---------------------------- | ------------------------------------------ |
| `P1_27_BRANCH`               | `feature/p1-27-crm-vehicle-frontend`       |
| `P1_27_BASE_SHA`             | `dd49a6f754541747c7226591dffc70e4a9400df9` |
| `P1_27_BASE_TREE`            | `7d5e539495e4818db3237ea0d7c6dd93aa2c3804` |
| `P1_27_INITIAL_HEAD`         | `dd49a6f754541747c7226591dffc70e4a9400df9` |
| `P1_27_INITIAL_TREE`         | `7d5e539495e4818db3237ea0d7c6dd93aa2c3804` |
| protected `main` (unchanged) | `f085d82001a43de51725707426d5c10eb134c004` |

`main` is **not** promoted by this phase.

## 2. Surface baselines

| key                             | value                                                              |
| ------------------------------- | ------------------------------------------------------------------ |
| `P1_27_API_ROUTE_COUNT`         | 199                                                                |
| `P1_27_OPENAPI_PATH_COUNT`      | 198                                                                |
| `P1_27_OPENAPI_OPERATION_COUNT` | 238                                                                |
| `P1_27_MIGRATION_COUNT`         | 119                                                                |
| `P1_27_SCHEMA_HASH`             | `d16a1cf7240a8b55218122db5fac9a22ed0c2702c878d519ef32df919478ad21` |

The schema hash is SHA-256 over every migration filename and its bytes, in sorted
order, across all 119 files. **There is no migration 120, and P1-27 must not add
one** — the phase owns `apps/web` only.

## 3. Test baselines — measured, on a clean database

Every number below was produced by running the command on this exact tree.
Nothing is carried forward from an earlier measurement.

| tier                 | command                | result                     |
| -------------------- | ---------------------- | -------------------------- |
| Root / CI-contract   | `npm run test`         | **1608 / 1608**, 72 files  |
| Web unit / component | `npm run test:web`     | **357 / 357**, 19 files    |
| Backend              | `npm run test:backend` | **1818 / 1818**, 79 files  |
| Database / RLS       | `npm run test:db`      | **1636 / 1636**, 138 files |

### The DB tier was re-measured, and why that matters

Its first run reported **4 files failing, 2 tests failing** — `no-fake-data` and
`iam-seeds`, both of which assert that business tables start empty. The cause was
local: the backend suites and the P1-26 Owner-acceptance environment had left 823
rows behind.

That is not a defect and it is not a passing result either. **A baseline measured
against a dirty database is not a baseline** — it is a reference point that moves,
and the whole purpose of these four numbers is to be the fixed thing a later
measurement is compared against. So the acceptance fixtures were reset
(`acceptance:reset-owner`, 823 rows removed in one transaction, 5 identities and
the browser session state removed) and the tier was re-run. 1636 / 1636.

The failure is recorded here rather than quietly overwritten, because the next
person to see `no-fake-data` fail locally should know what it means before they
go looking for a code defect.

## 4. What P1-27 inherits

Four Backend remediations were merged **before** this branch existed, each on its
own branch through protected change control:

| PR   | finding         | effect                                                         |
| ---- | --------------- | -------------------------------------------------------------- |
| #192 | `P1-27-INT-001` | Nine CRM reads. Nothing in 226 operations returned a customer. |
| #193 | `P1-27-INT-002` | `GET /vehicles/{vehicleId}`.                                   |
| #194 | `P1-27-INT-005` | Both duplicate-candidate review queues.                        |
| #195 | `P1-27-INT-006` | Silent row loss in every keyset cursor over a `timestamptz`.   |
| #196 | —               | The canonical plan and this readiness gate at 16/16.           |

Registry **226 → 238 operations**. No new permission code, no migration, and no
existing write changed in any of them.

## 5. Findings this phase carries

| id              | owner        | disposition                                                                                                                                                                                                                                                                                                   |
| --------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `P1-27-INT-003` | **P1-27**    | **In scope.** The web client defaults `Idempotency-Key` on POST only, so nine non-POST idempotent operations answer 400 `ERR-INT-002` — six PUT and three PATCH, including `PATCH /vehicles/{vehicleId}`, the edit path behind FE-019. The client's own docblock says no PATCH is idempotent, which is false. |
| `P1-27-INT-004` | foundation   | Out of scope. The OpenAPI generator publishes 200 for 201 routes.                                                                                                                                                                                                                                             |
| `P1-27-INT-006` | other phases | 16 pre-existing cursor sites remain, listed with file and line.                                                                                                                                                                                                                                               |
| `P1-16-A-01/02` | P1-16 / fdn  | Open.                                                                                                                                                                                                                                                                                                         |
| `P1-17-A-01/02` | P1-17        | Open.                                                                                                                                                                                                                                                                                                         |

## 6. Ownership boundary, enforced at merge

`apps/api` is Backend only; `apps/web` is Frontend only. Required at merge:

```
APPS_API_EXECUTABLE_DIFF=0    SUPABASE_DIFF=0
MIGRATION_DIFF=0              UNCLASSIFIED_FILES=0
GENERATED_TRACKED_FILES=0     DUPLICATE_FRONTEND_AUTHORITIES=0
NESTED_LOCKFILES=0
```

A real Backend defect found during P1-27 does **not** get fixed here. It gets a
stable `P1-27-INT-###`, an owning phase, its own branch, its own tests, and its
own protected merge — which is exactly what happened four times above.

---

## 7. Wave log

Each row is a commit that was green on its own before the next wave started.

| wave | tasks                        | subject                                          | commit    |
| ---- | ---------------------------- | ------------------------------------------------ | --------- |
| 2    | `FE-001`, `FE-002`           | CRM customer search and results                  | `df6e452` |
| 3    | `FE-003`, `FE-004`, `FE-005` | Customer creation, duplicate advisory, lifecycle | `a912681` |
| 4    | `FE-006`, `FE-007`, `FE-008` | Profile, contacts, addresses                     | `c8d755d` |
| 5    | `FE-009`…`FE-014`            | The same six, read surface                       | `ff923f1` |
| 5b   | `FE-009`…`FE-014`            | The same six, write operations                   | `c390abb` |
| 6    | `FE-015`, `FE-016`           | Timeline; duplicate review and merge             | pending   |

**Frontend progress: 16 / 29. Total: 16 / 42.**

Wave 5 was split because the read surface was coherent and green on its own,
while the plan binds a **write** operation to each of the same six tasks. Both
halves are required; `FE-009`…`FE-014` count as delivered only after `5b`.

Every CRM task is now delivered except the customer-side half of `FE-025` — the
`vehicles` profile section, still marked planned because it lists a customer's
vehicles and there is no vehicle screen to link to before Wave 7.

### Test tiers, re-measured at Wave 6

| tier                 | at base     | now         |
| -------------------- | ----------- | ----------- |
| Root / CI-contract   | 1608 / 1608 | 1614 / 1614 |
| Web unit / component | 357 / 357   | 564 / 564   |

### What the write surface proved

All six writes are registered `idempotent: true`, and **one is a PUT**
(`crm.preference-set`). Before `P1-27-INT-003` the client derived the
`Idempotency-Key` from the HTTP method, so that operation would have answered
`400 ERR-INT-002` before authorization on every attempt while its five POST
neighbours worked. `tests/crm-governance-writes.test.ts` asserts a key is
required for all six **and not required for the GETs at the same paths**, so the
resolver is shown to discriminate rather than to answer yes to everything.

The six need **six different permissions**, not one blanket write capability, and
those are pinned exactly as the routes register them.

`FAILED_TESTS=0`, `SKIPPED_REQUIRED_TESTS=0`.

### A defect in the commit history that cannot be repaired

The Wave 4 commit `c8d755d` carries a **UTF-8 BOM** (`ef bb bf`) at the start of
its subject line, because the message file was written with PowerShell
`Out-File -Encoding utf8`, which emits a BOM in PowerShell 5.1.

It is recorded rather than fixed. The commit is already on the remote, and
correcting a pushed commit message requires a force push, which the standing
constraints forbid without exception. Three invisible bytes in one subject line
is a smaller cost than a rewritten protected history. Every commit message from
Wave 5 onward is written with a tool that does not add a BOM.
