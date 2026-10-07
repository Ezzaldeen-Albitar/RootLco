# DBCR-P1-32-PRE-OD-FD16B-001 — frozen report snapshots and distinguished restatements

**Company:** RootLco — Root Link Company · **Classification:** Confidential — Commercial Product
and Pilot Planning · **Phase:** 1-32 (preparatory) — Owner decision D16 of
[ADR-023](../../adr/ADR-023-sales-and-finance-policy-decisions.md), part 2 · **Owner:** Eng.
Ezzaldeen Al-Bitar (technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)).
**This is not an independent third-party review, and no approval of this migration is recorded
here.** It implements the snapshot and restatement half of the Owner's decision D16; applying it to
any existing database is a separate, rehearsed step.

- **Migration:** `supabase/migrations/20261008100000_rpt_report_snapshots.sql` (the 182nd)
- **Seed change:** none. **Permission change:** none — a dedicated snapshot permission code is an
  open Owner question; until it is answered a snapshot is saved under `rpt.export` and read under
  `rpt.report.read`. **Audit action:** one new, `rpt.report.snapshot_created` (class `financial`).
- **Executable proof:** `tests/db/rpt-report-snapshots.test.ts` (append-only for every application
  role and against a superuser UPDATE; the stamps; row-level security by tenant, branch,
  `rpt.report.read` and every frozen code; one original; one restatement per snapshot; the reason
  and difference checks; a restatement of another period refused),
  `tests/backend/od-report-snapshots.test.ts` (the three operations end to end),
  `tests/unit/od-report-snapshot-isolation.test.ts` (the save runs at REPEATABLE READ),
  `tests/db/foundation.test.ts` (table, routine, trigger and policy inventories),
  `tests/db/p1-11-security.test.ts` (append-only list) and
  `tests/db/p1-15-shared-services-runtime-capabilities.test.ts` (migration census).
- **Rollback classification:** **ROLLBACK-SAFE while `rpt.report_snapshots` is empty**;
  roll-forward-only once a snapshot exists. The inverse is in the migration footer and refuses to
  run once a row exists.

---

## 1. Why this change request exists

D16: "End-of-period reporting is defined and tested. Later payments, credits, reversals or
backdated entries never silently change a historical report. The as-of calculation and the
preserved snapshot are documented, and restatements are distinguished. No new accounting subsystem
is built."

Part 1 (`DBCR-P1-32-PRE-OD-FD16A-001`) made the invoice and payment report answer as of a moment
from immutable event times. That reading is repeatable, but nothing kept the figures a person
actually saw and relied on, and nothing could say that a later reading of the same period replaced
an earlier one. This change keeps them.

## 2. The change

One table, `rpt.report_snapshots`, one SECURITY INVOKER trigger function,
`rpt.guard_report_snapshot`, and its BEFORE INSERT OR UPDATE trigger.

- A row is a frozen copy of ONE run of a report: tenant, company, branch, `report_code`, the
  half-open period (`period_from`, `period_to_exclusive`) and its zone (`timezone_name`), `as_of`,
  the filters used (`parameters`, a JSON object), `required_permissions` (the dataset's codes,
  frozen at creation), `columns` and `rows` as the run published them.
- **Stamped, never supplied.** For `app_runtime` and its login members the guard stamps
  `generated_by` and `created_by` from `iam.current_user_id()` and `generated_at` and `created_at`
  from `now()`; a row without a signed-in person is refused. For every writer it stamps
  `row_count` and the sha256 digests `rows_digest` and `parameters_digest` over the canonical
  `jsonb` text. A role that bypasses row security (a superuser, the provisioning connection) is not
  held to the person and time stamps, the boundary of `20261007150000` and `20261008090000`.
- **Append-only.** `app_runtime` holds SELECT and INSERT, `app_readonly` SELECT; no UPDATE or
  DELETE for any application role, and the guard refuses every UPDATE whoever runs it.
- **A restatement** names the snapshot it replaces (`restates_snapshot_id`, a composite foreign key
  in the same tenant, company and branch), carries a reason (`ck_report_snapshots_reason`: required
  and non-blank exactly when `restates_snapshot_id` is set, at most 500 characters) and a
  `difference` (`ck_report_snapshots_difference`: present exactly on a restatement). The guard
  admits a restatement only of a snapshot of the same report, period and filters.
- **The chain is linear.** `uq_report_snapshots_original` admits one original per (tenant,
  company, branch, report, period, filters digest); `uq_report_snapshots_restates` admits one
  restatement per snapshot. The latest snapshot of a period is the one nothing restates, and only
  it can be restated; a concurrent second save loses at the index rather than writing a second row.
- **Row-level security, enabled and forced.** `sel_report_snapshots_scope` admits a row in the
  caller's tenant and branch reach only when the caller holds `rpt.report.read` and every code in
  `required_permissions`, each evaluated in the row's own company and branch by
  `iam.has_permission_in_scope`. `ins_report_snapshots_scope` adds `rpt.export` and pins
  `generated_by` to the signed-in user.

## 3. What the application does with it

Three operations, only for a dataset that declares snapshots (`invoice_payment_summary` today;
every other dataset refuses):

- `rpt.report-snapshot-create` — `POST /reports/{reportCode}/snapshots`, idempotent, declaring
  `rpt.export` and `rpt.report.read` at the branch; the service requires every dataset code too.
  The whole result is read page by page through the report run, as of ONE moment, inside the
  request's transaction opened at REPEATABLE READ, so a payment committed while the pages are read
  cannot appear in some of them. Capped by the export's row bound (`EXPORT_MAX_ROWS`) and byte
  bound. A restatement's difference counts the rows added, removed and changed by the dataset's
  identity column and sums every money column per currency, before and after, in PostgreSQL.
  Refusals by rule are recorded (ADR-023 D12): `report_snapshot_exists`,
  `report_snapshot_reason_required`, `report_snapshot_not_latest`,
  `report_snapshot_period_mismatch`, `report_snapshot_not_supported`, `report_snapshot_too_large`.
  A unique-index loss is mapped to the same refusals, never a 500.
- `rpt.report-snapshot-list` — `GET /reports/{reportCode}/snapshots`, metadata only, newest first.
- `rpt.report-snapshot-read` — `GET /reports/{reportCode}/snapshots/{snapshotId}/rows`, the frozen
  rows a page at a time with the restatement links and difference. The party name is stored as the
  saver saw it and withheld from a reader without `crm.customer.read`, as the live run withholds it.

## 4. Measured effect

On a disposable `postgres:17-alpine` database on 127.0.0.1:55458 replayed from empty through all
182 migrations and seeded twice with `npm run validate:seed-state`:
`scripts/ci/migration-replay-checks.mjs --phase post` reported, against the 181 baseline, only the
migration count and `tables` 278 → 279, `functions` 668 → 669, `policies` 805 → 807, `triggers`
657 → 658; `security_definer` 0. `scripts/db/structural-review.mjs`: every foreign key validated
and index-covered, no destructive cascade, no duplicate index, no dictionary drift. Schema hash
`6674074e…` (`npm run validate:schema-inventory -- --hash-only`). These are local measurements; the
hosted migration-replay, database and backend jobs re-prove them.

## 5. Populated-data rehearsal

The migration adds a table, so it was rehearsed on a disposable restore of the most recent
acceptance backup the D5-D8 checkpoint record references
(`C:/Users/Ezzaldeen/rootlco-db-backups/20261006T142940Z-d5-d8-cp2-preapply/`, ledger 170, dump
sha256 `49785af9…`, `sha256sum -c` OK), in `public.ecr.aws/supabase/postgres:17.6.1.143` on
127.0.0.1:55459 with the method of that checkpoint's rehearsal scripts, on 2026-10-07 between
14:46Z and 14:48Z:

- restore: roles 14 errors, all "already exists"; `pg_restore --create` exit 0 with an empty log;
- `npx supabase migration up --db-url …` from this branch: exit 0, twelve files applied in order
  (171 to 180, then 181, then 182), 0 pending afterwards, ledger 182; server log 0 WARNING,
  0 ERROR, 0 FATAL;
- row counts of all 278 pre-existing tables in the 17 business schemas identical before and after
  (53548 rows), and the data md5 of every `sal` and `rpt` table identical; the new table empty;
- `rpt.report_snapshots`: row security enabled and forced, the two policies, SELECT and INSERT to
  `app_runtime` and SELECT to `app_readonly` only;
- schema hash `6674074e…`, equal to the empty replay.

The disposable container was removed. The acceptance database was not read or written.

## 6. Records this change moves

`.github/ci-baselines/schema-baseline.json` (`migrationCount` 182, `schemaHash`,
`structuralTotals`, `migrationCountNote`, `functionCountDiscrepancyNote`,
`structuralTotalsNote182`), the P1-15 migration census, the `tests/db/foundation.test.ts`
inventories, `tests/db/helpers.ts` cleanup, the P1-11 append-only list,
`docs/database/data-dictionary.md`, `docs/database/sal-wty-rpt-personal-data-classification.json`
(`rows`, `restatement_reason` and `difference` restricted), and the P1-27 migration-count records.

## 7. Upgrade of an existing database

Forward-only, writes no row, creates one empty table and takes no lock on an existing table. Apply
with the other pending migrations by the established backup, rehearsal and forward-apply procedure;
never by reset.

## 8. Not in this change

Period close and financial statements, which wait for the accounting questionnaire. A dedicated
snapshot permission code is an open Owner question.
