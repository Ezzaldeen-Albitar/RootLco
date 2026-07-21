# Phase 1-13 — Gate validation record

**Phase:** P1-13 · **Date:** 2026-07-21 · **Owner:** Eng. Ezzaldeen Al-Bitar ·
**Subject:** protected `origin/develop` = `e615a0212fda0b028316206bf9f331dd86120890`

Every exit code below is an observed value. No output was truncated to hide a failure and no check
was skipped. **Hosted CI on the exact final SHAs is the authoritative CI evidence** and is recorded
in the pull requests, not here.

---

## 1. Protected history verified before any validation

| Check                                                              | Result                                      |
| ------------------------------------------------------------------ | ------------------------------------------- |
| PR #49 merged into `develop`                                       | Yes — merge commit `6c3f0de`                |
| PR #51 merged into `develop`                                       | Yes — merge commit `e615a02`                |
| Feature SHA `cf85615` contained in `origin/develop`                | Yes (`git merge-base --is-ancestor` exit 0) |
| Remediation SHA `af240f0` contained in `origin/develop`            | Yes (`git merge-base --is-ancestor` exit 0) |
| Merge trees identical to the merged branch trees                   | Yes, for both merges                        |
| `develop` first-parent history since `release-2-database-baseline` | Exactly two commits, both PR merge commits  |
| `origin/main`                                                      | `728920c`, unchanged by this phase          |
| Working tree before gate work                                      | Clean                                       |
| P1-14 branches / commits / pull requests                           | None                                        |

The only repository-wide match for "P1-14" is inside `cf85615`'s own commit message, where it
appears in a scope statement ("no P1-14+ business endpoint"), not as work.

## 2. The merged migration, verified from the merged tree

`git diff --name-status release-2-database-baseline..e615a02 -- supabase/` returns exactly one line:

```text
A	supabase/migrations/20260725090000_iam_shared_runtime_write_capabilities.sql
```

One file added, none modified, renamed, or deleted. Scanning the executable portion of that file
(comments stripped) for forbidden constructs:

| Construct                                                  | Occurrences |
| ---------------------------------------------------------- | ----------- |
| `BYPASSRLS`                                                | 0           |
| `SECURITY DEFINER`                                         | 0           |
| `OWNER TO`                                                 | 0           |
| `CREATE ROLE` / `ALTER ROLE`                               | 0 / 0       |
| `GRANT USAGE ON SCHEMA`                                    | 0           |
| `USING (true)` / `WITH CHECK (true)`                       | 0 / 0       |
| `app_readonly` / `app_worker`                              | 0 / 0       |
| `CREATE TABLE` / `ALTER TABLE`                             | 0 / 0       |
| `DROP …` / `TRUNCATE`                                      | 0 / 0       |
| `GRANT UPDATE\|DELETE\|TRUNCATE\|REFERENCES\|TRIGGER\|ALL` | 0           |

## 3. Live catalogue after rebuilding from the merged state

| Property                                                        | Value                              |
| --------------------------------------------------------------- | ---------------------------------- |
| Migrations applied                                              | **114**                            |
| Tables (17 module schemas)                                      | **242**                            |
| RLS policies                                                    | **596**                            |
| Functions                                                       | **210**                            |
| Triggers                                                        | **539**                            |
| `SECURITY DEFINER` routines                                     | **0**                              |
| Tables with RLS enabled but not FORCED                          | **0**                              |
| `app_runtime` INSERT surface in `shared`+`iam`                  | exactly 6 tables                   |
| `app_runtime` UPDATE/DELETE/TRUNCATE in `shared`+`iam`          | **0**                              |
| DELETE granted to any application role, anywhere                | **0**                              |
| `app_readonly` non-SELECT privileges, anywhere                  | **0**                              |
| `app_worker` privileges                                         | the 3 queue tables only, unchanged |
| Unconditional (`true`) write policy for `app_runtime`           | **0**                              |
| `extensions` schema USAGE for any application role              | **false** for all three            |
| Relations owned by an application role                          | **0**                              |
| `rolsuper` / `rolbypassrls` / `rolcanlogin` for the three roles | false / false / false              |

`app_runtime` also holds UPDATE on 151 tables across the fifteen **business** module schemas
(`apt`, `crm`, `dia`, `inv`, `org`, `qms`, `quo`, `rec`, `rpt`, `sal`, `svc`, `tech`, `veh`, `wo`,
`wty`). That is the pre-existing Release 2 surface, not something this phase added: the merged
migration contains no `GRANT UPDATE` at all, and no earlier migration was modified. Inside `shared`
and `iam` — the only schemas the remediation touched — the count is zero.

## 4. Validation from the merged working tree

| Check                             | Exit | Detail                 |
| --------------------------------- | ---- | ---------------------- |
| `test:db`                         | 0    | 120 files / 1184 tests |
| `test:backend`                    | 0    | 8 files / 61 tests     |
| `test` (unit)                     | 0    | 22 files / 272 tests   |
| `lint`                            | 0    |                        |
| `typecheck`                       | 0    |                        |
| `format:check`                    | 0    |                        |
| `style:check`                     | 0    |                        |
| `validate:module-boundaries`      | 0    |                        |
| `validate:authorization-coverage` | 0    |                        |
| `validate:openapi`                | 0    |                        |
| `security:tracked-secrets`        | 0    |                        |
| `security:browser-secrets`        | 0    |                        |
| `security:scope-exclusions`       | 0    |                        |
| `validate:no-fake-data`           | 0    |                        |
| `validate:canonical-docs`         | 0    |                        |
| `build` (Next.js production)      | 0    |                        |
| `docker compose config`           | 0    |                        |
| `docker build --target runner`    | 0    | production image       |
| `docker build --target dev`       | 0    | development image      |

The database and backend suites were run **serially**, never sharing the database concurrently. An
earlier run in this session that overlapped them produced a spurious fixture-cleanup failure; it was
re-run in isolation and passed, and the overlap is recorded here rather than omitted.

**One unattributed transient failure is recorded here rather than left out.** During the
gate-branch validation (§6 below), one `test:db` run reported `1 failed | 1183 passed`. The failing
test was not captured before the run scrolled, and two immediate re-runs on the same tree were fully
green — 1184/1184 both times. The gate branch changes documentation only, so no code path in that
suite differs from the merged state that had already passed it twice (Wave 4 and the clean room).
The most likely cause is the same shared-database contention seen earlier in the session. It is
flagged because an intermittent database test is worth knowing about, and because a gate record that
quietly reports only the green runs is not a record.

## 5. Clean room

A fresh `git clone` of the repository at `e615a02` into an isolated directory outside the working
tree, `npm ci` only, and a **brand-new empty database** (`p1_13_cleanroom`) — not the working
database — built by applying all migrations with the CI runner.

| Step                                                                  | Exit | Detail                               |
| --------------------------------------------------------------------- | ---- | ------------------------------------ |
| `git clone` + checkout `e615a02`                                      | 0    | 114 migration files, clean tree      |
| `npm ci`                                                              | 0    | lockfile only                        |
| `db:apply-migrations` (empty database)                                | 0    | "All 114 migrations applied cleanly" |
| `validate:seed-state`                                                 | 0    | 7 declared seed files applied twice  |
| `test:db`                                                             | 0    | 120 files / 1184 tests               |
| `test:backend`                                                        | 0    | 8 files / 61 tests                   |
| `test` (unit)                                                         | 0    | 22 files / 272 tests                 |
| `lint` · `typecheck` · `format:check` · `style:check`                 | 0    |                                      |
| `validate:module-boundaries` · `-authorization-coverage` · `-openapi` | 0    |                                      |
| `security:tracked-secrets` · `-browser-secrets` · `-scope-exclusions` | 0    |                                      |
| `validate:no-fake-data`                                               | 0    |                                      |
| `build`                                                               | 0    |                                      |

**Post-run residue on the isolated database** — every one of `org.tenants`, `org.legal_companies`,
`iam.user_accounts`, `iam.audit_records`, `iam.audit_record_details`, `iam.audit_integrity_links`,
`iam.security_events`, `shared.event_outbox`, `shared.idempotency_keys`, `shared.processed_events`,
`shared.error_records`, and `crm.business_partners` held **0** rows. Zero leftover rehearsal roles,
zero leftover `cr_rehearsal%` policies, and no `p1_02_test` fixture schema. Retained structural
reference rows, all tenant-neutral: 3 currencies, 2 languages, 2 timezones, 43 permissions, 5
retention classes.

**Clean-room catalogue:** 242 tables · 596 policies · 210 functions · 0 `SECURITY DEFINER` · 0
tables without FORCE RLS — identical to the working database. The clean-room database was dropped
afterwards.

One limitation, stated rather than glossed: `db:apply-migrations` does not create the
`supabase_migrations.schema_migrations` ledger that `supabase db reset` maintains, so the clean-room
migration count comes from the runner's own output rather than from that table.

## 6. Executable capability verification

Mapping of the required verifications to the executed evidence. Everything asserting a _capability_
runs on `rootlco_test_runtime`, a member of `app_runtime` — the identity the application deploys
with. The admin connection bypasses RLS and is used only for fixtures and read-back.

| #     | Verification                                                                       | Evidence                                                                      |
| ----- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1     | No resolved context → refused before touching protected data                       | `p1-13-runtime-capabilities.test.ts`, `context-and-rls.test.ts`               |
| 2     | Spoofed client tenant/company/branch cannot override server scope                  | `context-spoofing.test.ts` (11 tests)                                         |
| 3     | No cross-tenant write to audit / details / links / security / outbox / idempotency | `p1-13-runtime-capabilities.test.ts` — 42501 on each                          |
| 4     | Another tenant can neither read nor infer those records                            | same file — counts of 0 from the other tenant                                 |
| 5     | Audit append succeeds through the intended runtime path                            | same file + `iam-audit.test.ts`                                               |
| 6     | Audit records and details immutable                                                | same file — 42501 on UPDATE/DELETE for all four tables                        |
| 7     | Audit-chain continuity verifies                                                    | same file — `audit_verify_chain` ok through seq 1, 5, and 10                  |
| 8     | Audit helpers expose no unrestricted history                                       | same file + `iam-hardening.test.ts` — 0 committed rows without the permission |
| 9     | Detail envelope stores field / old / new / classification exactly                  | `transaction.test.ts`                                                         |
| 10    | Application classifications match the live CHECK constraint                        | `transaction.test.ts` — reconciled against `pg_get_constraintdef`             |
| 11    | No restricted value leaks through database error details                           | verified in this session (see below)                                          |
| 12–15 | Idempotency first use, replay, fingerprint conflict, concurrency                   | `idempotency.test.ts`, `p1-13-runtime-capabilities.test.ts`                   |
| 16–17 | Outbox insert in the producer transaction; absent on rollback                      | `transaction.test.ts`, `p1-13-runtime-capabilities.test.ts`                   |
| 18    | Producers cannot claim, complete, or fail queue work                               | `p1-13-runtime-capabilities.test.ts`, `shared-event-outbox.test.ts`           |
| 19    | Worker isolated from the request identity                                          | `p1-13-runtime-capabilities.test.ts`                                          |
| 20    | Denial path can create a tenant-safe security-event candidate                      | verified in this session (see below)                                          |
| 21    | All-or-nothing across state, history, audit, idempotency, outbox                   | `transaction.test.ts`, `p1-13-runtime-capabilities.test.ts`                   |
| 22    | Cross-tenant denial leaks no resource existence                                    | `p1-13-runtime-capabilities.test.ts` — tenant B may reuse tenant A's key      |
| 23    | Release 2 database integrity intact                                                | full `test:db`, 1184 tests                                                    |

**Items 11 and 20** were not covered by the merged suites, so they were verified directly in this
session against the merged state, on `rootlco_test_runtime`:

- `recordSecurityEvent()` now returns `{ logged: true, persisted: true }` and the row lands against
  the **resolved** tenant, with the actor and detail intact; a second tenant receives nothing.
- When the database genuinely refuses the write (a context whose tenant does not exist — SQLSTATE
  `23503`, asserted explicitly so the test cannot pass for the wrong reason), the function swallows
  it, reports `persisted: false`, and does not throw.
- `iam.audit_mask` collapses `restricted` and `secret` values to `***`, and the raw value appears
  nowhere in the audit tables — so a rejected detail cannot carry one into an error.

These ran as a local working copy and are **not** part of this gate pull request, because the gate
branch carries documentation and evidence only. The test file is recommended for a follow-up code
pull request; until then, items 11 and 20 rest on this session's execution rather than on a
committed regression test, and that is stated plainly rather than implied to be covered.

## 6.1 Gate-branch validation (documentation-only tree)

Re-run after the final documentation state was written, on branch
`docs/p1-13-backend-foundation-gate-record`:

| Check                                                                 | Exit | Detail                                      |
| --------------------------------------------------------------------- | ---- | ------------------------------------------- |
| `format:check` · `lint` · `typecheck` · `style:check`                 | 0    |                                             |
| `validate:module-boundaries` · `-authorization-coverage` · `-openapi` | 0    |                                             |
| `security:tracked-secrets` · `-browser-secrets` · `-scope-exclusions` | 0    |                                             |
| `validate:no-fake-data` · `validate:canonical-docs`                   | 0    |                                             |
| `test` (unit)                                                         | 0    | 22 files / 272 tests                        |
| `test:db`                                                             | 0    | 120 files / 1184 tests (see the note above) |
| `test:backend`                                                        | 0    | 8 files / 61 tests                          |
| `build` · `docker compose config`                                     | 0    |                                             |
| Gate-history preservation check                                       | 0    | 7,768 chars byte-verbatim vs `e615a02`      |
| Encoding check across all changed files                               | 0    | 8 files, no BOM, no double-encoding         |
| Non-documentation files changed                                       | —    | **0**                                       |

The gate-history check is a script that extracts the quoted historical block from the Go gate,
strips the quotation prefix, and compares it byte-for-byte against
`git show e615a02:docs/phase-1/phase-1-13/phase-1-13-owner-gate.md`. It is the evidence for the
claim that the Pending record was preserved rather than paraphrased.

The encoding check exists because an earlier attempt to edit the traceability matrix through a
PowerShell round-trip corrupted its UTF-8 (writing a BOM and double-encoding `§`, `·`, and `—`).
That was caught by comparing the file's non-ASCII code points against `HEAD`, reverted with
`git checkout HEAD --`, and redone in Node. The check now runs over every file this branch touches,
and is recorded because the corruption was self-inflicted and would otherwise have shipped silently.

## 7. What this record does not claim

Development and test-environment results only. Not a performance baseline, not a capacity
measurement, and not evidence of any production behaviour — no environment beyond Local exists
(ADR-012) and **P1-OD-027 (NFR-SCL) remains unresolved**. No penetration test was performed. No
independent third-party review took place: this is an owner-authorized technical self-review under
the Standing Technical Authorization and Solo Developer Review policies.
