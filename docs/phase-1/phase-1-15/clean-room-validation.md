# Phase 1-15 — Clean-room validation

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Date:** 2026-07-23 ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent third-party audit.**

---

## 1. What "clean room" means here, and what it does not

A **fresh checkout of the exact candidate commit**, in its own working tree at a short path, with its
own `node_modules` installed by `npm ci`, against a database **rebuilt from empty**. Nothing is
carried over from the development tree except `.env.local`, which is environment configuration and
is deliberately identical — the point is to test the committed source, not to test a different
environment.

What it is **not**: it is not a different machine, not a different operating system, not a
production-like deployment, and not an independent execution. It removes "it works because of
something uncommitted in my tree" and nothing more. Hosted CI on the exact SHA is the separate,
genuinely-independent execution.

| Item             | Value                                                           |
| ---------------- | --------------------------------------------------------------- |
| Candidate commit | **`6bdb2c35bd63c1c7bb8301f10f2269c5c1daeeba`**                  |
| Working tree     | `C:\Users\Ezzaldeen\p115cr` (git worktree, created at that SHA) |
| Tree state       | clean — `git status --porcelain` empty                          |
| Migrations       | **117** — unchanged; P1-15 adds none                            |
| Dependencies     | `npm ci` from the committed lockfile                            |
| Database         | `npx supabase db reset` — dropped and rebuilt from empty        |

## 2. Database rebuild and seed idempotency

`npx supabase db reset` was run **twice**. The seed files report the same counts on both passes, and
`validate:seed-state` — run on the freshly rebuilt database, before any test suite — reported:

```
OK seed state: 7 declared files applied twice; five exact retention classes;
every business table empty; counts idempotent.
```

45 permission codes, 12 platform units of measure, 3 payment methods, 3 currencies, 2 timezones,
2 languages. **Every business table empty**, which is the no-fake-data policy as an executable fact
rather than a promise.

## 3. Results

Every command below was run inside the clean-room tree. Exit codes are recorded as observed; a
non-zero one is explained rather than retried.

| Check                                           | Exit  | Result                                                                                          |
| ----------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------- |
| `npm ci`                                        | 0     | clean install from the lockfile                                                                 |
| `npm run lint`                                  | 0     | no errors, no warnings                                                                          |
| `npm run typecheck`                             | 0     | strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`                                |
| `npm run format:check`                          | 0     | all matched files match Prettier                                                                |
| `npm run style:check`                           | 0     | zero stylelint warnings                                                                         |
| `npm run validate:module-boundaries`            | 0     | 13 rules, including the new B11 and B12                                                         |
| `npm run validate:authorization-coverage`       | 0     | every operation guarded, every route registered                                                 |
| `npm run validate:operation-coverage`           | 0     | **60 registered · 43 with required evidence · 17 invocation-only · 0 pending · 0 unreferenced** |
| `npm run validate:openapi`                      | 0     | 3.1.0, 49 paths, 60 operations, structurally valid                                              |
| `npm run security:all`                          | 0     | tracked-secret, browser-secret, scope-exclusion and no-fake-data scans across 940 tracked files |
| `npm run validate:seed-state` (fresh DB)        | 0     | see §2                                                                                          |
| `npm run test` (unit/foundation)                | 0     | **636 passed**                                                                                  |
| `npm run test:backend`                          | 0     | **262 passed**                                                                                  |
| `npm run test:db`                               | 0     | **1477 passed / 128 files**                                                                     |
| `npm run build`                                 | 0     | production build; every P1-15 route registered as dynamic                                       |
| `docker compose config`                         | 0     | compose file resolves                                                                           |
| `npm run validate:seed-state` (after `test:db`) | **1** | **expected — see §4.1**                                                                         |
| `npm run validate:canonical-docs`               | **1** | **expected — see §4.2**                                                                         |

## 4. The two non-zero exits, diagnosed rather than retried

### 4.1 `validate:seed-state` fails _after_ the database suite, and that is pre-existing

`tests/db/shared-retention.test.ts` — a **Phase 1-5** suite, not a P1-15 one — deliberately
overwrites `min_retention_days` and `allows_deletion` for three retention classes so its
eligibility-function tests have known finite, indefinite and no-delete periods. Its own comment says
so, and it names `validate:seed-state` as the authority on the seed's governed values. It does not
restore them afterwards.

So the sequence is:

- on a freshly rebuilt database → `validate:seed-state` **passes** (§2);
- after `npm run test:db` → it **fails** with `Retention classes do not match the five governed
values`, showing `min_retention_days` differing from the seeded values.

**Hosted CI is unaffected, and the ordering is deliberate**, not lucky: `.github/workflows/ci.yml`
runs `npm run db:apply-migrations` (line 233) → `npm run validate:seed-state` (line 236) → the
classification checks → `npm run test:db` (line 284). The seed assertion therefore always runs
against a database no suite has touched.

This is **not** caused by P1-15 and P1-15 does not fix it: changing another phase's test to restore
state is a change to that phase's evidence, and doing it inside a feature PR would be exactly the
kind of quiet edit this project's review policy exists to prevent. It is recorded here, and in
[the risk register](risk-register.md), as a known local-run ordering constraint: **run
`validate:seed-state` before `test:db`, or after a reset.**

### 4.2 `validate:canonical-docs` verifies documents that live outside the repository

The check compares recorded hashes of two Word documents held **outside** the working tree:

```
- RootLco_Phase_1_Development_Plan_recovered_v01.docx
    expected at: ../RootLco_Phase_1_Development_Plan_recovered_v01.docx
    STATUS:      MISSING or unreadable
- RootLco_Master_Project_Documentation.docx
    expected at: ../documentation/RootLco_Master_Project_Documentation.docx
    STATUS:      MISSING or unreadable
```

Both paths are `../` relative to the repository root, so **no checkout of any commit can satisfy
them** — a clean room least of all. The check is not part of `.github/workflows/ci.yml` and is not a
required PR check. It is an owner-side integrity control over the canonical DOCX originals, and it
is reported here rather than omitted so nobody later reads its absence as a pass.

## 5. Two defects the suites found, and what happened to them

Neither was known before the suites ran on the deployed role. Both are fixed in the candidate
commit, and both now have a regression lock.

**Version registration could not succeed at all.** `DocumentRepository.nextVersionNumber()`
serialised concurrent registrations with `SELECT … FROM shared.documents … FOR UPDATE`. PostgreSQL
requires UPDATE privilege on at least one column for _any_ row-locking clause, and DBCR-P1-15-001
deliberately grants `app_runtime` none on that table — so the lock was refused with SQLSTATE 42501
before the INSERT was reached, on a caller that **held** `shared.document.manage`. The withholding
is right; taking a write-privileged lock to perform a read was not. Serialisation is now
`pg_advisory_xact_lock`, which needs no table privilege and is released by COMMIT or ROLLBACK, with
`uq_document_versions_number` still the authority. Proven by
`tests/backend/p1-15-attachments-notifications.test.ts`.

**A 500 where a 422 belonged.** A template placeholder named after an `Object.prototype` member
(`constructor`, `toString`, …) resolved up the prototype chain, passed the missing-variable check,
and crashed the renderer with a `TypeError`. The check is now
`Object.prototype.hasOwnProperty.call(...)`. Proven by
`tests/foundation/p1-15-template-rendering.test.ts`.

## 6. Status

Clean-room validation is complete on `6bdb2c35bd63c1c7bb8301f10f2269c5c1daeeba`, with the two
non-zero exits above diagnosed and attributed.

### 6.1 Why this record is not invalidated by the commits after it

This document is itself a commit, so the branch tip necessarily moves past the SHA the run was
performed on. That is only acceptable while the difference is **not executable**, and the claim is
made checkable rather than asserted:

```bash
git diff --name-only 6bdb2c3..HEAD -- . ':!docs'
```

must be **empty** — every commit after the clean-room SHA touches `docs/` and nothing else. If it is
not empty, this record does not cover the tip and must be re-run.

The genuinely independent execution is **hosted CI on the exact final SHA**, which runs the same
gates on a machine this one has no influence over. A clean room removes "it works because of
something uncommitted in my tree"; only CI removes "it works because of this machine".

If the candidate SHA moves for an **executable** reason — for example to fix a hosted-CI failure —
this record is re-run and re-stated for the new SHA rather than inherited.

The Phase 1-15 owner gate remains **Pending**.
