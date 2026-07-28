# Nightly assurance

Runs at **02:30 UTC** — after the working day in Asia/Amman (UTC+3) and before
the next one starts, so a failure is waiting rather than interrupting.

## Why nightly is not a merge gate

A pull request asks _did this change break something_. Nightly asks _is the
system still what we think it is_. Those need different answers and different
budgets.

Making the full suite required for every merge would add 40+ minutes to every
pull request and would eventually be disabled. But "not blocking a merge" must
not mean "nobody looks", so `nightly-gate` **fails** when a blocking-tier job
failed, and the run shows red in the Actions list.

## Tiers

**Blocking** — a failure means the system is not what we think it is.

| Job                      | Question                                                 |
| ------------------------ | -------------------------------------------------------- |
| `full-backend-e2e`       | do the complete cross-module workflows still work        |
| `full-rls-matrix`        | is every table in every application schema still guarded |
| `migration-replay`       | can the schema still be built from nothing               |
| `historical-secret-scan` | has a credential ever entered this history               |
| `mutation-assurance`     | is each security guard still load-bearing                |
| `backup-restore-drill`   | does a restore actually restore                          |
| `code-security`          | CodeQL over the whole tree                               |

**Informational** — a failure is a signal to act on, not proof of a defect. The
reason is recorded per job in `nightly-summary.mjs`, so "informational" is never
a shrug.

| Job                    | Why not blocking                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `dependency-deep-scan` | includes the outdated inventory, which is behind almost by definition; the blocking dependency check runs on every pull request |
| `container-deep-scan`  | drops `ignore-unfixed`, so it reports base-image findings with no available patch                                               |
| `performance-baseline` | measured on a shared runner; one slow night is jitter                                                                           |
| `compatibility-matrix` | the experimental rows are early warning about the next Node and PostgreSQL majors, not a veto from an unsupported one           |

A job that is **neither listed nor recognised is treated as blocking**, so adding
a nightly job without deciding its tier fails loudly rather than being ignored.

## The full RLS matrix

PR runs cover `iam, org, inv, wo, crm, sal, quo`. Nightly adds `veh, apt, rec,
tech, dia, qms, svc, wty, rpt, shared` — every application schema.

Both tiers first **reconcile the declared lists against the database**. Two
failures, either of which would make the matrix a weaker claim than it looks:

- a schema exists that no list mentions — it is never checked and nobody
  noticed. A future phase adding a schema hits this immediately;
- a schema is declared and does not exist — the matrix reports it as covered
  while checking nothing, which is the same vacuity as a coverage floor over an
  empty set.

Twelve non-application schemas (`extensions`, `supabase_migrations`, `public`
and the Supabase-managed ones) are classified with the reason each holds no
tenant data.

The matrix is catalog-derived: for each role × table × action it records whether
the privilege is granted, whether RLS is enabled and forced, which policies cover
the action, and a verdict. Every cell has a verdict or a recorded skip reason; a
cell with neither fails the run.

Absolute invariants, checked in both tiers: RLS enabled on every application
table, FORCE RLS except for three named global reference tables, zero
`SECURITY DEFINER`, no runtime role with `SUPERUSER` or `BYPASSRLS`, and
`app_readonly` holding no write privilege anywhere.

## Mutation assurance

Removes one guard at a time and requires the suite to notice. Current targets:

| Guard                                | Category      | Why it matters                                                                                                                                    |
| ------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inventory-read-company-scope`       | RLS scope     | P1-21 finding H6 — `iam.has_permission_in_scope` matches company **or** branch, so only a SQL `company_id` predicate refuses a cross-company read |
| `deferred-scope-target-required`     | authorization | P1-18-A-01 — a deferred authorizer given an empty target silently evaluates scope-blind `iam.has_permission` and answers yes                      |
| `idempotency-fingerprint-comparison` | idempotency   | without it, the same key with a different payload returns the first caller's stored response — a cross-user disclosure shaped like a retry        |

A target whose anchor text has moved **errors** rather than passing. A mutation
check that silently stops mutating is the same failure mode as a vacuous
assertion, and it is the risk this manifest is most exposed to.

The `inventory-read-company-scope` target is currently a **placeholder mutation**
and says so in the manifest: a faithful predicate removal requires renumbering
the bound parameters, and deleting the clause outright leaves `$2` unbound,
producing 500s rather than the original defect — a mutant that looks killed for
the wrong reason. Recorded as a limitation rather than presented as a kill.

## Performance

`scripts/db/perf-baseline.mjs` at scale 20 000 against a **generated,
non-personal** dataset that is deleted afterwards. p50, p95, p99 and the actual
plan from `EXPLAIN (ANALYZE, BUFFERS)`.

Two checks are absolute from day one and need no baseline: a **sequential scan on
a tenant-leading indexed lookup** fails immediately, and an **empty measurement
set** fails — nothing measured must never read as fast.

The regression budget is ×1.5 on p95, with a 5 ms noise floor. Wide on purpose:
a shared CI runner is a noisy instrument and a budget that cries wolf gets
ignored.

## Backup and restore

Ephemeral container only. Dump, destroy, restore into a fresh database, then
prove the **schema hash**, the **per-table row counts** and **application-shaped
queries** all match the source — including that RLS is still enabled on the
restored tables. A restore that completes without error is not a verified
restore.

Production is unreachable from every workflow in this repository, and the script
refuses to run against any host it did not create the target database on.

## Compatibility matrix

| Node | PostgreSQL | Status                                                |
| ---- | ---------- | ----------------------------------------------------- |
| 22   | 17         | **supported** — a failure here is a real failure      |
| 24   | 17         | experimental — next Node LTS under evaluation         |
| 22   | 18         | experimental — next PostgreSQL major under evaluation |

`continue-on-error` is scoped to the experimental rows via
`matrix.experimental`. The supported pair has `experimental: false`, so its
failure still fails the job. An unsupported future version must never veto a
merge, and a supported one must never be waved through.
