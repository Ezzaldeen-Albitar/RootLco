# P1-31 — operator runbook

**Status:** OPEN · **Covers:** the acts P1-31 owes an operator — one prerequisite seed, three
migrations and two platform commands. **These are not the same four acts the phase index names,
and the difference is deliberate; § 2.1 maps this document's sections onto the index's rows one by
one.** · **Authority for every command below:** the script and migration files themselves, read at
`develop` `81b3bce804626353a1a7b9f4ba52f1306c8f8b6e` ·
**Companion records:** [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) § 57,
[`tenant-administrator-bundle-backfill.md`](./tenant-administrator-bundle-backfill.md),
[`delivering-employee-identity-seam.md`](./delivering-employee-identity-seam.md),
[`p9b-complete-delivery-template-gate.md`](./p9b-complete-delivery-template-gate.md)

This document exists because two P1-31 tasks — **DO-002** (operator half) and **DOC-002** — are
blocked on nothing except the absence of a runbook for the acts this phase introduced.
**CC-16** states the blocker in the register's own words: the phase "names an operator act after
merge that no runbook yet carries"
([`change-control-2026-09-08.md`](./change-control-2026-09-08.md), § 29.2, line 634).

---

## 0. Where this document lives, and why it is not where the chapter says

The canonical chapter's **Field 34** names a `documentation/` tree and numbered files inside it.
**That tree does not exist in this repository.** The measurement is recorded, not asserted: the
A0 preflight states "There is no `documentation/` directory, and the numbered files Field 34 names
do not exist at those paths" ([`a0-preflight.md`](./a0-preflight.md), line 97).

The two conventions are reconciled explicitly rather than silently:

| convention                                               | what it says                                                              | what this file does                                                                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| the chapter, Field 34                                    | a `documentation/` tree carrying numbered documents                       | **not satisfied by this file.** No `documentation/` directory is created here, and none is proposed                                          |
| the repository, `docs/phase-1/phase-1-NN/`               | every phase record lives under its own phase directory                    | **followed.** This file is `docs/phase-1/phase-1-31/operator-runbook.md`, beside the phase's other records                                   |
| the repository, `docs/engineering/ci-automation/runbook` | the SHAPE of a runbook: preconditions, exact command, then what it proves | **followed.** See that file's database-job block at [`operator-runbook.md` lines 52–53](../../engineering/ci-automation/operator-runbook.md) |

[`security-and-qa-evidence.md`](./security-and-qa-evidence.md) § 12 records as an open item that
"Field 34's numbered documentation targets do not exist at the paths the chapter gives, and no
record reconciles the chapter's document tree with this repository's". **The table above is that
reconciliation, and it is all of it.**

**Creating the tree Field 34 names is still owed and is NOT done by this file.** A second
documentation root is a structural decision about the repository, and it is not this runbook's to
take.

---

## 1. Scope statement — read this before quoting any result below

The evidence set at `orchestration/evidence/p1-31/p17-operator-20260912/` **lives outside this
repository** and is not tracked by it. It records these acts performed **once**, against **one
containerised local database**.

**It proves nothing about any hosted environment.** No hosted run of any of these acts exists, and
none is claimed anywhere in this document.

**The set of environments in which this work is not yet done is: every environment that is not
that one database.** That sentence is exact and is not to be softened. There is no second local
database in which it is done, no staging environment in which it is done, and no production
environment in which it is done.

Two further limits on the one run that did happen:

- The local database held **zero** rows in `sal.delivery_records` when the delivering-employee
  command ran, so that command **minted nothing and stamped nothing**. A run against a database
  with delivery history exercises code paths no recorded run has exercised.
- The bundle backfill's numbers below (24 roles, `76 -> 78`) are that database's numbers. Another
  database holds whatever it holds, and the command prints its own before/after counts per
  organisation. **Do not carry these figures forward as an expectation.**

---

## 2. The order is load-bearing

| #   | act                                                                             | why it is in this position                                                                                             |
| --- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | apply `supabase/seeds/04_iam_permission_catalog.sql`                            | **the bundle backfill fails closed without it, exit code 5.** Discovered by a real refusal, not predicted — see § 3    |
| 2   | apply the three migrations                                                      | the delivering-employee command refuses with exit code 5 if `fk_delivery_records_delivering_employee` does not exist   |
| 3   | `backfill-delivering-employee-identity.mjs`, dry run then real run              | it mints the `org.employees` rows; nothing downstream can reference an employee that does not exist                    |
| 4   | `backfill-tenant-administrator-bundle.mjs`, dry run then real run — **ONE run** | it maps catalogue rows onto roles, so both the catalogue (act 1) and any code the phase minted must already be present |
| 5   | apply `supabase/seeds/05_shared_reference.sql` (§ 10)                           | independent of acts 1 to 4; receiver verification refuses identity evidence until the D-18 category row is present     |

_(2026-09-15: row 5 and § 10 were added by `remediation/p1-31-backend-closure-hardening`. Rows 1
to 4, the header's count of acts and every statement about "four acts" in § 2.1 are unchanged and
were true when written; § 10 is outside that count.)_

Acts 1 and 2 are independent of each other and may be done in either order. **Act 1 must precede
act 4, and act 2 must precede act 3.** Every act is idempotent; re-running a completed act is safe
and reports zeros.

### 2.1 How these sections map onto the four acts the phase index names

The phase index counts four owed operator acts —
[`security-and-qa-evidence.md`](./security-and-qa-evidence.md) § 11, the owed-act table at
lines 952–957, and [`closure-record.md`](./closure-record.md) lines 341–346, a file this pull
request also corrects. **This runbook also numbers four acts, and they are not the same four.**
The two differences are stated here rather than left for a reader to notice: this document splits
the migrations by tool rather than by task, so it carries all three in one section, and it
promotes the catalogue seed to a numbered section because an operator who skips it hits an exit-5
refusal. Nothing is added to the index's
list and nothing is dropped from it.

| this runbook                                                               | the act as the index states it                                                                                                                                                  | where the index records it                                     |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| § 3, act 1 — apply `supabase/seeds/04_iam_permission_catalog.sql`          | **not one of the four.** It is the prerequisite the index names in its own right: the refusal recorded as **CC-37(c)**, "the act has a prerequisite no repository record names" | `closure-record.md` line 306; register § 57.3                  |
| § 4, act 2 — apply the three migrations, first file `20260909090000`       | act 1 of four: apply the P-9b migration `20260909090000_sal_complete_delivery_active_template_gate.sql`                                                                         | register § 35 (P-9b, #363); `security-and-qa-evidence.md` § 11 |
| § 4, act 2 — the same section, files `20260910090000` and `20260910091000` | act 2 of four: apply the two P-17 migrations `org_employees.sql` and `sal_delivery_delivering_employee_identity.sql`                                                            | register § 41; `security-and-qa-evidence.md` § 11              |
| § 5, act 3 — `backfill-delivering-employee-identity.mjs`                   | act 3 of four: run it so legacy handovers gain an identity                                                                                                                      | register § 41 (**CC-29b**)                                     |
| § 6, act 4 — `backfill-tenant-administrator-bundle.mjs`                    | act 4 of four: run it so existing organisations gain the new codes, ONE run for all codes                                                                                       | **CC-16** § 29.2, **CC-20** § 34.2                             |

**Stated plainly, because the count is the thing that misleads:** the permission-catalogue seed is
**the prerequisite CC-37(c) names, not one of the four acts**. A reader reconciling this document
against the index should expect four index rows covered by three of this document's sections, with
§ 3 sitting outside the four.

---

## 3. Act 1 — the permission-catalogue seed prerequisite

> **This is the single most useful fact this runbook carries, and it was found by a refusal
> rather than by prediction.** On 2026-09-12 the bundle backfill's dry run was executed against a
> database whose catalogue had not been re-seeded. It **refused, exit code 5, and wrote nothing**:
>
> ```
> Refused: the permission catalogue lacks 2 code(s) the bundle requires:
> org.employee.manage, org.employee.read
> ```
>
> The refusal is the script's own, at
> [`scripts/platform/backfill-tenant-administrator-bundle.mjs` line 453](../../../scripts/platform/backfill-tenant-administrator-bundle.mjs),
> and its reason is stated there: "a role mapped to fewer codes than its definition states is a
> silent narrowing nobody asked for". The backfill is **fail-closed by design** and there is no
> flag that makes it proceed.

### Preconditions

- The three migrations of § 4 are **not** required for this act.
- `supabase/seeds/04_iam_permission_catalog.sql` is the **only** shipping insert into
  `iam.permissions`; zero migrations write to that table. It is registered in
  `supabase/config.toml` under `[db.seed] sql_paths` (line 74), and it is idempotent —
  `ON CONFLICT (permission_code) DO NOTHING`.
- **`supabase db reset` is the declared way seeds are applied and MUST NOT be used on a database
  that holds anything you intend to keep.** It drops and recreates the database. On the shared
  local acceptance database it destroys the environment.

### Command

The seed file is applied **as it stands**, with no hand-written insert. Against a containerised
local database:

```bash
docker cp supabase/seeds/04_iam_permission_catalog.sql <container>:/tmp/04_iam_permission_catalog.sql
docker exec <container> psql -U "$DB_USER" -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 --echo-errors -f /tmp/04_iam_permission_catalog.sql
```

Against a database reached over the network, the same file through `psql -f` with
`ON_ERROR_STOP=1`. **Do not transcribe the two rows by hand**: a second, drifting definition of
the catalogue is exactly the defect the single-authority rule exists to prevent.

**Derive the target, and here is what it was when this was written.** The file is the authority,
so count it on the tree you are holding:

```bash
grep -c "^  ('" supabase/seeds/04_iam_permission_catalog.sql
git rev-parse --short HEAD
```

At `a547fc9b` that command printed **121** — one `INSERT`, 121 single-line value rows, so a fully
seeded catalogue holds **121 rows** and `catalogue_rows` below should equal it once every row is
present. It printed **121** again at `786c5900`, this branch's merge of `develop` `821ed668`, so no seed row landed between the two heads. If your
tree prints a different number, **your tree is right and this paragraph is stale**: the count is a
fact about the file at one commit, not a constant.

### Verification query — proves the step took effect

```sql
-- 1. the codes the current bundle needs and the catalogue now has
SELECT permission_code, risk_level
  FROM iam.permissions
 WHERE permission_code IN ('org.employee.read', 'org.employee.manage')
 ORDER BY permission_code;
-- expect: two rows.

-- 2. nothing else moved. Compare this digest before and after; it must change
--    by exactly the rows the seed added and by nothing else.
SELECT count(*) AS catalogue_rows,
       md5(string_agg(permission_code || ':' || risk_level, ',' ORDER BY permission_code)) AS digest
  FROM iam.permissions;
```

To prove **no pre-existing row changed** rather than merely counting, digest each row's full
tuple before and after and compare the two sets; `ON CONFLICT DO NOTHING` guarantees it and this
measures it.

### Rollback criterion

**Roll back if any pre-existing permission row changed, or if the run reported an error.** The
seed is additive and idempotent, so the only honest rollback is to delete rows the seed inserted
and that nothing has yet mapped — and **only** while `iam.role_permissions` references none of
them. Once act 4 has mapped a code, deleting the catalogue row is no longer a rollback of this
act; it is a revocation, and it is out of this runbook's scope.

### Done looks like

The two codes are present, the catalogue count rose by exactly the number of codes the file adds
that were absent, and every pre-existing row digest is unchanged.

---

## 4. Act 2 — apply the three migrations

### Preconditions

- **`npm run db:apply-migrations` will refuse.** It is a clean-database runner and throws
  `Refusing to run: module schemas already exist (...)`
  ([`scripts/db/apply-migrations.mjs` lines 96–101](../../../scripts/db/apply-migrations.mjs)).
  It is the right tool for a fresh database and the wrong tool for an established one.
- On an established database the migrations are applied file by file, **each in its own
  transaction**, and the migration ledger is repaired to match. `supabase migration repair
--status applied <version>` writes the canonical ledger row shape.
- Read the migration ledger count and the file count **before** starting; they must agree
  afterwards.

### The three files, in ledger order

| version          | file                                             | what it creates                                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260909090000` | `sal_complete_delivery_active_template_gate.sql` | `CREATE OR REPLACE FUNCTION sal.complete_delivery` (line 108) — the P-9b gate that makes the checklist template's `status` and `deleted_at` load-bearing                                                                   |
| `20260910090000` | `org_employees.sql`                              | `org.employees` (line 81), three indexes, two triggers, three policies (`sel_employees_tenant`, `ins_employees_scope`, `upd_employees_scope`)                                                                              |
| `20260910091000` | `sal_delivery_delivering_employee_identity.sql`  | `sal.delivery_legacy_identity_review` (line 101), column `delivering_employee_display_name` (line 175), `fk_delivery_records_delivering_employee` **NOT VALID** (line 195), the stamp function (line 238) and two triggers |

### Command

```bash
docker cp supabase/migrations/<file>.sql <container>:/tmp/<file>.sql
docker exec <container> psql -U "$DB_USER" -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 --single-transaction --echo-errors -f /tmp/<file>.sql
```

`--single-transaction` is not optional: a partially applied migration is the one outcome this
step must not be able to produce.

### Verification query — proves the step took effect

```sql
-- the function was replaced
SELECT p.proname, md5(pg_get_functiondef(p.oid)) AS body_digest
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'sal' AND p.proname = 'complete_delivery';

-- the two new tables exist, with RLS enabled AND forced
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE (n.nspname, c.relname) IN (('org','employees'),
                                  ('sal','delivery_legacy_identity_review'));
-- expect: two rows, both true/true.

-- the snapshot column and the key, and whether the key is validated yet
SELECT conname, convalidated
  FROM pg_constraint
 WHERE conrelid = 'sal.delivery_records'::regclass
   AND conname IN ('fk_delivery_records_delivering_employee',
                   'ck_delivery_records_delivering_employee_name');

-- the ledger agrees with the tree
SELECT count(*) FROM supabase_migrations.schema_migrations;
```

**Derive the target, and here is what it was when this was written.** The tree is the authority,
so count it on the checkout you are applying from:

```bash
ls supabase/migrations/*.sql | wc -l
git rev-parse --short HEAD
```

At `a547fc9b` that command printed **141**, so the ledger count above should read **141** once the
three files of this act are applied and the ledger is repaired. It printed **141** again at
`786c5900`, this branch's merge of `develop` `821ed668`, so no migration landed between the two heads. If your tree prints a different number,
**your tree is right and this paragraph is stale**: the count is a fact about the tree at one
commit, and it moves with every migration any later phase adds.

**`convalidated` is expected to be `false` on a database that held delivery rows** — the key is
added `NOT VALID` on purpose, and the migration emits a `RAISE NOTICE` naming the operator command
(line 219). On a database with **zero** delivery rows the migration's own `DO` block validates it
immediately and `convalidated` is `true`. Both are correct outcomes; which one you get is a fact
about the data, not about the run.

### Rollback criterion

**Roll back if any file reported an error, or if `psql` exited non-zero.** Because each file runs
in one transaction, a failed file has rolled itself back and the ledger row must not be written
for it. **Do not write a ledger row for a file that did not apply**, and do not proceed to § 5
until the ledger count equals the file count.

### Done looks like

Three files applied, exit 0 each; both tables present with RLS enabled and forced; the foreign key
present; the migration ledger count equal to the number of files in `supabase/migrations/`.

---

## 5. Act 3 — the delivering-employee identity backfill

The row-level half of P-17. It is a command and not a migration because
`scripts/ci/migration-replay-checks.mjs` refuses a top-level `INSERT` into a module schema, and it
is right to: a migration that writes rows into `org.employees` is indistinguishable from one that
ships people nobody confirmed.

### Preconditions

- § 4 applied. If `fk_delivery_records_delivering_employee` does not exist the command **refuses
  with exit code 5**: `Refused: ... does not exist; apply the P-17 migrations first`.
- A platform operator account exists and holds an **unrevoked** `platform.organization.provision`
  grant in `iam.platform_grants`. Without it the command refuses with **exit code 4**. No new
  permission is minted for this command; the authority is the one that already sanctions writing
  an organisation's structural rows on the platform's behalf.
- `ROOTLCO_ENV` must be exactly `local-acceptance` or `production-maintenance`. Anything else is
  refused.
- `--confirm <address>` must match `BACKFILL_OPERATOR_EMAIL` exactly.
- Scope is mandatory and unambiguous: **either** `--all` **or** one or more `--tenant <uuid|code>`,
  never both, never neither.

### Command — dry run first, then the real run

```bash
ROOTLCO_ENV=local-acceptance \
DB_HOST=... DB_PORT=... DB_NAME=... DB_USER=... DB_PASSWORD=... \
BACKFILL_OPERATOR_EMAIL=<operator address> \
BACKFILL_EVIDENCE_PATH=<where the evidence JSON goes> \
node scripts/platform/backfill-delivering-employee-identity.mjs \
  --confirm <operator address> --all --dry-run
```

Then the same line **without** `--dry-run`.

The dry run opens the same transaction per organisation and `ROLLBACK`s it instead of
committing, so the plan it prints is the plan the real run executes — not a description of one.
It also reports the constraint as `eligible-not-attempted` rather than validating it.

### What it does, and what it will never do

It mints one `org.employees` row per distinct legacy `(tenant, delivering_employee_id)` that
**resolves to a same-tenant `iam.user_accounts` id**, carrying the legacy uuid as its own `id`;
stamps `delivering_employee_display_name` only where it is `NULL`; and **lists** every delivery
whose value resolves to nobody in `sal.delivery_legacy_identity_review`. A value matching no
account produces **no employee** and is reported, never substituted and never replaced with the
operator. The file contains no `DELETE` and no `UPDATE` against `org.employees` or the review
register.

### Verification query — proves the step took effect

```sql
-- 1. what was minted, per organisation
SELECT tenant_id, count(*) AS employees, count(*) FILTER (WHERE status = 'inactive') AS inactive
  FROM org.employees GROUP BY tenant_id ORDER BY tenant_id;

-- 2. nothing was invented: every minted employee resolves to an account of the same tenant
SELECT count(*) AS unbacked
  FROM org.employees e
 WHERE NOT EXISTS (SELECT 1 FROM iam.user_accounts a
                    WHERE a.tenant_id = e.tenant_id AND a.id = e.user_account_id);
-- expect: 0.

-- 3. what could not be resolved, and was reported rather than repaired
SELECT tenant_id, count(*) AS unresolved_deliveries
  FROM sal.delivery_legacy_identity_review GROUP BY tenant_id ORDER BY tenant_id;

-- 4. the key's status after the run
SELECT convalidated FROM pg_constraint
 WHERE conname = 'fk_delivery_records_delivering_employee'
   AND conrelid = 'sal.delivery_records'::regclass;

-- 5. the audit trail the run left, per organisation that changed
SELECT tenant_id, count(*) FROM iam.audit_records
 WHERE action = 'platform.delivering_employee_identity.backfilled'
 GROUP BY tenant_id;
```

Compare 1 and 3 against the counts the command printed and against the evidence JSON it wrote.
**A disagreement between the printed count and the query is a stop condition**, not a rounding
difference.

### Rollback criterion

**Roll back if any organisation's transaction raised, or if query 2 returns anything other than 0.** Each organisation is its own transaction and a failure rolls that organisation back on its
own; organisations already committed stay committed, which is why the printed per-organisation
list is the record of what to re-examine.

**A green `convalidated` over an unresolved history is the one outcome this act exists to
prevent.** If `convalidated` is `true` while query 3 returns rows, stop and escalate: that
combination cannot be produced by this command and means something else validated the key.

### Done looks like

Both runs exit 0; the real run's minted/stamped/listed counts match the verification queries;
query 2 returns 0; and the key is either `validated` (nothing unresolved anywhere) or reported
`withheld` with the review register naming exactly what is outstanding. **`withheld` is a correct
outcome, not a failure** — it means history was preserved rather than completed with people nobody
confirmed.

---

## 6. Act 4 — the tenant administrator bundle backfill

### ONE run carries every newly approved code. It is not one run per code.

The work the command performs is the **set difference** `bundle − mapped`, computed per
organisation, where `bundle` is parsed out of
`apps/api/src/modules/iam/domain/bootstrap-roles.ts` by the script's own exported
`readTenantAdministratorBundle()`. Every code missing from a role is inserted in the same run, in
the same transaction. Running it once per code is not merely wasteful — it would be four
opportunities to stop halfway.

### Preconditions

- **§ 3 applied.** This is the fail-closed dependency: any bundle code absent from
  `iam.permissions` refuses the whole run with **exit code 5** and writes nothing.
- The same platform authority as § 5: an unrevoked `platform.organization.provision` grant, or
  **exit code 4**.
- Same `ROOTLCO_ENV`, `--confirm` and scope rules as § 5.
- An organisation with **no** live `tenant_administrator` role is **reported and skipped**, not
  repaired. Creating the role would be provisioning.
- An organisation that has deliberately mapped a bundle code as `effect = 'deny'` keeps that
  decision; the code is reported as `blockedByDeny` and is **not** re-decided.

### Command — dry run first, then the real run

```bash
ROOTLCO_ENV=local-acceptance \
DB_HOST=... DB_PORT=... DB_NAME=... DB_USER=... DB_PASSWORD=... \
BACKFILL_OPERATOR_EMAIL=<operator address> \
BACKFILL_EVIDENCE_PATH=<where the evidence JSON goes> \
node scripts/platform/backfill-tenant-administrator-bundle.mjs \
  --confirm <operator address> --all --dry-run
```

Then the same line **without** `--dry-run`.

### Expected effect

The bundle declared at this head is **78 codes**, re-derived as 78 at `786c5900`, this branch's merge of `develop` `821ed668` — re-derive it
yourself, never transcribe it:

```bash
node -e "import('./scripts/platform/backfill-tenant-administrator-bundle.mjs').then(m => console.log(m.readTenantAdministratorBundle().length))"
```

On the one database where this was performed, all 24 `tenant_administrator` roles stood at **76**
and moved to **78**, the two added codes being `org.employee.manage` and `org.employee.read`, for
48 new mappings in total. **Those are that database's numbers.** The command prints `heldBefore`
and `heldAfter` per organisation; those printed numbers are the record, and an organisation
provisioned on an older bundle may be far below 76.

### Verification query — proves the step took effect

```sql
-- 1. codes per administrator role, per organisation
SELECT t.tenant_code, count(*) FILTER (WHERE rp.effect = 'allow') AS allowed_codes
  FROM org.tenants t
  JOIN iam.roles r ON r.tenant_id = t.id AND r.role_code = 'tenant_administrator'
                  AND r.deleted_at IS NULL
  JOIN iam.role_permissions rp ON rp.tenant_id = t.id AND rp.role_id = r.id
 GROUP BY t.tenant_code ORDER BY t.tenant_code;

-- 2. nothing was revoked and nothing was re-decided: total mappings and their
--    identity digest, taken before and after and compared as SETS
SELECT count(*) AS mappings,
       md5(string_agg(rp.role_id || ':' || rp.permission_id || ':' || rp.effect, ','
                      ORDER BY rp.role_id, rp.permission_id, rp.effect)) AS digest
  FROM iam.role_permissions rp;

-- 3. every role OTHER than tenant_administrator is untouched
SELECT r.role_code, count(*)
  FROM iam.roles r JOIN iam.role_permissions rp ON rp.role_id = r.id
 WHERE r.role_code <> 'tenant_administrator'
 GROUP BY r.role_code ORDER BY r.role_code;

-- 4. the audit trail, per organisation that changed
SELECT tenant_id, count(*) FROM iam.audit_records
 WHERE action = 'platform.tenant_administrator_bundle.backfilled'
 GROUP BY tenant_id;
```

The honest proof of "nothing pre-existing changed" is a **set comparison** of query 2's identity
triples before and after — added rows only, removed rows zero — not a count difference. A count
difference of `+N` is equally consistent with `N+1` added and one removed.

### Rollback criterion

**Roll back if the set comparison in query 2 shows any removed row, or if query 3's per-role
counts moved for any role other than `tenant_administrator`.** The whole run is one transaction,
so a failure mid-run rolls the entire scope back and nothing partial can survive; that is why the
dry run is mandatory and why its plan must be read before the real run.

**Exit code 5 is not a rollback condition — it is a precondition failure.** It means § 3 was not
done. Apply the seed and re-run; do not work around it.

### Done looks like

Both runs exit 0; the real run's `widened` count equals the dry run's; every widened role's
`heldAfter` equals the bundle size printed by the command; query 2's set comparison shows adds
only; and the audit record count equals the number of organisations reported as widened.

---

## 7. What this runbook does not cover

- **No monitoring or alert routing.** DO-002 is a conjunction and this document closes only its
  operator half. The monitoring and alerting half depends on **D-10** — whether Field 24 requires
  an event-consumption mechanism or accepts polling — which is recorded as still open at
  [`a0-preflight.md`](./a0-preflight.md) lines 380–386 and explicitly not settled by the Owner
  decision of 2026-09-12 ([`owner-decisions-2026-09-12.md`](./owner-decisions-2026-09-12.md),
  lines 76–79).
- **No hosted procedure.** Every command above was shaped against a containerised local database.
  A hosted run has its own connection, its own change-control approval and its own evidence, and
  none of the three exists.
- **No acceptance claim.** Nothing here is an acceptance record, and under rule 2 of
  [`task-matrix.md`](./task-matrix.md) documentary evidence alone never earns
  `end-to-end verified`.
- **No permission is minted and no schema is changed by this document.** It describes acts that
  already exist in the tree; it adds none.

---

## 8. What this runbook closes in the register

| identifier                                                                                 | what it asked for                                                                                                                                                                                                     | what this file does                                                                                           |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **CC-37(c)** ([`change-control-2026-09-08.md`](./change-control-2026-09-08.md), line 2750) | "the tenant-administrator bundle backfill has a prerequisite no repository record named … the remedy is the operator runbook that DO-001 and DO-002 both owe and that does not exist; **the ordering must be in it**" | **closed.** § 2 states the ordering and § 3 states the prerequisite, its exit code and its refusal text       |
| **CC-16** (line 634) and **CC-20** (line 815)                                              | organisations provisioned before the widenings hold neither new code and cannot delegate the authority either                                                                                                         | **not closed.** Both are closed by _running_ the act on an environment, not by documenting it. § 6 is the how |

**CC-16 and CC-20 stay open.** A runbook is not a run. They close when the act has been performed
on the environments they are about, and § 1 says exactly how few of those there are.

The register's allocation for this slice is **§ 57** and **CC-47**. Under § 48.1's never-renumber
rule no existing identifier moves to accommodate it.

## 9. Local fault monitoring

The [monitoring runbook](./monitoring-runbook.md) documents the P1-31 local alert router,
its environment and file-access prerequisites, bounded output, reviewer routing, failure handling,
rollback and reproducible exception-capture rehearsal. Its queue is local; external delivery and
the separate D-10 event-consumption decision are not established by running it.

---

## 10. Act 5 — the D-18 identity-evidence category seed

Added by `remediation/p1-31-backend-closure-hardening` (register § 72, **CC-63**). Owner decision
**D-18** approves an optional identity-evidence document category for the receiver at a delivery
handover; the row is `delivery_receiver_identity` in `supabase/seeds/05_shared_reference.sql`. A
database that was seeded before that branch does not hold it, and receiver verification refuses
identity evidence filed under any other category, so this act must reach every database that should
accept that evidence.

**Not performed on any shared environment.** It was rehearsed twice on one disposable local
database only (§ 72.5 of the register); the shared local acceptance database has not received it.
§ 1's scope statement applies to it exactly as to the acts above.

### Preconditions

- **Independent of acts 1 to 4**, which it neither needs nor affects. It may be done in any order
  relative to them.
- **No migration is required.** The `identity_document` purpose is already admitted by
  `ck_document_categories_link_purpose`
  (`supabase/migrations/20260815090000_shared_reception_evidence_foundation.sql`, line 35), and rows
  are not shipped by migrations in this repository.
- `supabase/seeds/05_shared_reference.sql` is registered in `supabase/config.toml` under
  `[db.seed] sql_paths` (line 75). It holds three `INSERT` statements and **every one of them ends in
  `ON CONFLICT … DO NOTHING`**: the five retention classes on `(class_code)`, the seven reception
  evidence categories and the one D-18 category on any conflict. **So applying it inserts only the
  rows that are missing and updates none.**
- **`supabase db reset` MUST NOT be used** on a database that holds anything you intend to keep, for
  the reason § 3 gives.

### Command

The seed file is applied **as it stands**, exactly as § 3 applies seed 04, with no hand-written
insert. Against a containerised local database:

```bash
docker cp supabase/seeds/05_shared_reference.sql <container>:/tmp/05_shared_reference.sql
docker exec <container> psql -U "$DB_USER" -d "$DB_NAME" \
  -v ON_ERROR_STOP=1 --echo-errors -f /tmp/05_shared_reference.sql
```

From Git Bash on Windows, `export MSYS_NO_PATHCONV=1` first: without it the shell rewrites the
container path and `psql` reports the file missing. Against a database reached over the network, the
same file through `psql -f` with `ON_ERROR_STOP=1`.

**Derive the target on the tree you hold.** The file is the authority:

```bash
grep -c "'platform',NULL," supabase/seeds/05_shared_reference.sql
git rev-parse --short HEAD
```

On the branch that added this act it printed **8** platform category rows. If your tree prints a
different number, your tree is right and this sentence is stale.

### Verification query — proves the step took effect

```sql
-- 0. take both digests BEFORE the command, and again after it.
SELECT count(*) AS platform_categories,
       md5(string_agg(id::text || ':' || category_code || ':' || status || ':' || record_version,
                      ',' ORDER BY id)) AS digest
  FROM shared.document_categories
 WHERE scope = 'platform';

SELECT count(*) AS retention_classes,
       md5(string_agg(class_code || ':' || coalesce(min_retention_days::text, '-') || ':'
                      || allows_deletion, ',' ORDER BY class_code)) AS digest
  FROM shared.retention_classes;

-- 1. the row this act exists for.
SELECT id, category_code, business_link_purpose, default_classification,
       default_retention_class, status
  FROM shared.document_categories
 WHERE scope = 'platform' AND category_code = 'delivery_receiver_identity' AND deleted_at IS NULL;
-- expect: one row, id d1500000-0000-4000-8000-000000000008, purpose identity_document,
--         restricted, evidence-audit, active.
```

**Check the identifier, not only the code.** `ON CONFLICT DO NOTHING` also swallows a conflict with
a platform row that already carries the code under a different identifier; the command then reports
success and inserts nothing. The `id` in query 1 is what tells the two apart.

### Rollback criterion

**Roll back if the run reported an error, or if any pre-existing row changed**: the retention-class
digest must be identical, and the platform-category digest taken after must equal the one taken
before once the rows the command inserted are excluded. The seed is additive, so the only honest
rollback is to delete the rows it inserted, and the D-18 row **only while no `shared.documents` row
references it**. Once a document is filed under it, deleting it is no longer a rollback of this act.

### Done looks like

Query 1 returns the one row with the identifier above; the platform-category count rose by exactly
the number of rows that were missing (one, on a database seeded before this branch; zero on a
database that already held it); and every pre-existing row is unchanged.
