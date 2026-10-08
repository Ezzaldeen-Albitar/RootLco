# DBCR-P1-32-PRE-OD-FD16C-001 — a report snapshot is saved under `rpt.report.configure`

**Company:** RootLco — Root Link Company · **Classification:** Confidential — Commercial Product
and Pilot Planning · **Phase:** 1-32 (preparatory) — Owner decision D16 of
[ADR-023](../../adr/ADR-023-sales-and-finance-policy-decisions.md), part 2, follow-up to
[DBCR-P1-32-PRE-OD-FD16B-001](DBCR-P1-32-PRE-OD-FD16B-001-rpt-report-snapshots.md) · **Owner:** Eng.
Ezzaldeen Al-Bitar (technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)).
**This is not an independent third-party review, and no approval of this migration is recorded
here.** Applying it to any existing database is a separate, rehearsed step.

- **Migration:** `supabase/migrations/20261008110000_rpt_report_snapshot_save_gate.sql` (the 183rd)
- **Seed change:** none. **Permission change:** none — no code is minted, and no role bundle,
  backfill or grant changes. **Audit action:** none new.
- **Executable proof:** `tests/db/rpt-report-snapshots.test.ts` (an INSERT is admitted with
  `rpt.report.configure`, `rpt.report.read` and the frozen dataset code and no `rpt.export`;
  refused without `rpt.report.configure`, without `rpt.report.read`, without the dataset code, in
  another branch, and with `rpt.export` in place of `rpt.report.configure`),
  `tests/backend/od-report-snapshots.test.ts` (the operation's declaration; an original and a
  restatement admitted under the new gate and refused under the export switch alone; the CSV export
  still refused without `rpt.export`; the read bound; the race-path refusal entity),
  `tests/unit/od-report-snapshot-read-bound.test.ts` (the bound, the single nested acquisition, the
  race-path refusal entity) and `tests/db/p1-15-shared-services-runtime-capabilities.test.ts`
  (migration census).
- **Rollback classification:** **ROLLBACK-SAFE.** One policy predicate; no object is created or
  dropped and no row is written. The exact inverse is in the migration footer.

---

## 1. Why this change request exists

The browser retest of FD16B found that no tenant account can save a snapshot. FD16B's INSERT policy
`ins_report_snapshots_scope` and the operation `rpt.report-snapshot-create` required `rpt.export`.
`rpt.export` is the platform-wide export switch over every registered export resource, and it is
withheld from every tenant administrator by an explicit Owner decision (P1-31 CC-04, 2026-09-08;
`apps/api/src/modules/iam/domain/bootstrap-roles.ts`); a holder cannot be created by delegation
either, because `ins_role_permissions_delegable` admits a mapping only of a code the acting
administrator already holds.

## 2. The decision (planner, interim)

A snapshot is an internal, frozen, append-only record that only holders of the dataset's codes can
read (`sel_report_snapshots_scope`, unchanged); it is not an export out of the platform. Saving one —
an original or a restatement — is therefore gated on `rpt.report.configure` + `rpt.report.read` + the
dataset's codes instead of `rpt.export`. `rpt.report.configure` is already carried by the tenant
administrator bundle (P1-31 P-11), so this grants nothing new to anyone. The CSV export
(`rpt.report-export`) keeps `rpt.export` unchanged.

**Open Owner question:** whether snapshots get a dedicated permission code. Until it is answered,
`rpt.report.configure` saves them.

## 3. The change

`ALTER POLICY ins_report_snapshots_scope ON rpt.report_snapshots WITH CHECK (…)`: the same
predicate FD16B wrote — tenant, company and branch reach, `generated_by` is the signed-in user,
`rpt.report.read` and every frozen code in the row's own company and branch — with
`iam.has_permission_in_scope('rpt.report.configure', …)` in place of
`iam.has_permission_in_scope('rpt.export', …)`. `ALTER POLICY` keeps the policy's name, command
(INSERT) and roles (`app_runtime`). RLS stays enabled and forced; the SELECT policy, the guard
trigger, the grants and the unique indexes are untouched. A `COMMENT ON POLICY` states the rule.

The application moves with it: the operation declares `rpt.report.configure` and `rpt.report.read`,
the service requires `rpt.report.configure`, `rpt.report.read` and the dataset codes in the branch,
and the report screen offers Save snapshot and Restate only to holders of `rpt.report.configure`
(the panel is drawn only on a run the backend answered, which already required the dataset codes).

## 4. Concurrency

**The two-connection hold is bounded.** A save reads its pages in a READ ONLY REPEATABLE READ
transaction of its own (`readWholeReport`, DBCR-P1-32-PRE-OD-FD16B-001 section 3) on a SECOND pooled
connection, while the request's own transaction holds the first; so each save in flight holds two
connections of a pool of `DB_POOL_MAX` (default 10). Unbounded, `DB_POOL_MAX / 2` concurrent saves
could hold the whole pool, each waiting for a second connection the others hold. The service now
admits at most `snapshotReadCapacity(DB_POOL_MAX) = max(1, DB_POOL_MAX - 2)` snapshot reads at once
in one process (8 at the default) and refuses the next save **at once**, before it asks for the
second connection, with the platform's throttling refusal for expensive reads: `ERR-RTE-001`
(429) with `Retry-After: 5`, counted under `http.throttle.count` with the policy
`report-snapshot-read-bound` — never a 500 and never a wait on the pool. The slot is given back
whether the read succeeded or failed. `readWholeReport` is the only place the service acquires a
connection of its own; a unit test pins that it holds the file's only `withTransaction(` call. The
bound is per process: several application instances each hold their own, and each instance's pool
is its own.

**The race path of a duplicate original is recorded like the check before it.** Two saves of the
same period that both pass the check before their reads meet at `uq_report_snapshots_original`; the
loser's insert is rolled back to its savepoint. The service then reads the winning original (it
committed before the loser's insert failed, so the request transaction at READ COMMITTED sees it, in
a savepoint of its own so a failed read leaves the transaction usable) and records the refusal
against entity `rpt.report_snapshot` and the winner's id, exactly as the check before the read
records it (ADR-023 D12). The branch is named only when the winner cannot be read. The refusal the
caller receives is unchanged (`ERR-RES-002`, `report_snapshot_exists`), and a retry of the same
request under the same Idempotency-Key is still answered with the stored response.

## 5. Measured effect and populated-data rehearsal

**Empty replay.** On a disposable `postgres:17-alpine` database on 127.0.0.1:55446 replayed from
empty through all 183 migrations with `scripts/db/apply-migrations.mjs` and seeded twice with
`npm run validate:seed-state`, on 2026-10-08: `scripts/ci/migration-replay-checks.mjs --phase post`
reported, against the 182 baseline, only the migration count (tables 279, functions 669, policies
807, triggers 658, `security_definer` 0, permissions 134 unchanged); `scripts/db/structural-review.mjs`
reported every gate true (680 foreign keys, 1251 indexes, 279 live tables). Schema hash
`6674074e…` → `e612b0ad…` (`npm run validate:schema-inventory -- --hash-only`): the inventory hashes
every policy's check expression. These are local measurements; the hosted migration-replay,
database and backend jobs re-prove them.

**Rehearsal.** No acceptance backup holding migration 182 exists: the newest,
`C:/Users/Ezzaldeen/rootlco-db-backups/20261007T203200Z-d16-cp3-preapply/`, was taken before
CP-20261007-3 applied 181 and 182 (ledger 180; `sha256sum -c` OK, dump sha256 `ec9736b6…`). It was
restored, by the method of that checkpoint, into `public.ecr.aws/supabase/postgres:17.6.1.143` on
127.0.0.1:55447 on 2026-10-08, and the three pending migrations were applied from this branch:

- restore: roles 14 errors, all "already exists"; `pg_restore --create` exit 0 with an empty log;
  restored schema hash `216dfbab…`, the recorded 180 value;
- `npx supabase migration up --db-url …`: exit 0, three files applied in order (181, 182, 183),
  ledger 183; server log 0 WARNING, 0 ERROR, 0 FATAL;
- the delta 180 → 183 is byte-identical to the CP-20261007-3 rehearsal delta 180 → 182 except the
  ledger and the fingerprint of `ins_report_snapshots_scope` (`5ca8b3b9…` → `f3d75fb0…`): every
  pre-existing table's row count and row data digest unchanged (278 tables, 55607 rows), the new
  table empty, the as-of functions equal to the live functions for all 47 invoices and 39 receipts;
- schema hash `e612b0ad…`, equal to the empty replay.

The disposable container was removed. The acceptance database was not read or written.

## 6. Records this change moves

`.github/ci-baselines/schema-baseline.json` (`migrationCount` 183, `schemaHash`,
`migrationCountNote`, `structuralTotalsNote183`), the P1-15 migration census,
`docs/database/data-dictionary.md` (`rpt.report_snapshots`), the P1-27 migration-count records, the
OpenAPI document and the P1-24 operation register (the operation's permissions), the P1-31
least-privilege grant map (a fifteenth distinct declared-code set) and the P1-31 error-path and
isolation matrices (their citations), ADR-023's D16 mapping row, the verification ledger row
VL-P132-007, the route checklist and the user manual (6.5.4a, 6.5.4b).

## 7. Upgrade of an existing database

Writes no row, takes no lock beyond the policy change and changes one policy expression. Apply
with the other pending migrations by the established backup, rehearsal and forward-apply procedure; never by reset.

## 8. Not in this change

A dedicated snapshot permission code (open Owner question). Any change to a role bundle, a backfill,
a grant or the CSV export's gate.
