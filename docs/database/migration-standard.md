# Database Migration Standard

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Active — binding for every schema change ·
**Date:** 2026-07-16 ·
**Task:** P1-02-DB-014 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (under the
[Solo Developer Review Policy](../governance/solo-developer-review-policy.md) —
technical self-review, not independent review) ·
**Phase:** 1-2 — Database Architecture and Engineering Standards ·
**Branch:** `feature/p1-02-database-engineering-foundation`

**Related standards:**
[Database architecture](./database-architecture.md) ·
[Naming standard](./database-naming-standard.md) ·
[RLS standard](./rls-standard.md) ·
[Role and grant standard](./role-and-grant-standard.md) ·
[Number-sequence standard](./number-sequence-standard.md) ·
[Extension register](./postgresql-extension-register.md) ·
[Rehearsal evidence](../phase-1/phase-1-2/rehearsal-defective-migration.md) ·
[ADR-012 — local-first environments](../adr/ADR-012-local-first-environment-with-controlled-promotion.md)

---

## 1. Purpose and scope

Every change to the database schema of this platform is made **only** through a
version-controlled SQL migration file in `supabase/migrations/`. This standard defines
how migrations are named, structured, reviewed, applied, verified, and recovered from
when they fail. It is binding on every phase from Phase 1-2 onward.

Phase 1-2 itself creates **no business-domain tables**. The three migrations that exist
today (`0001_extensions.sql`, `0002_base_schemas.sql`, `0003_number_sequences.sql`)
establish platform foundation only; this standard describes how later phases build
domain tables on top of it.

## 2. Core model: forward-only, ordered migrations

- **Migrations are forward-only.** There are no committed "down" scripts. The database
  moves in one direction: the state of any environment is the result of applying every
  migration file, in filename order, to an empty database. Rationale: down scripts are
  rarely tested against real data, give false confidence, and are useless once a
  migration has issued numbers, created dependencies, or been built upon by later
  migrations. Recovery is by **fixing forward** (section 10).
- **Migrations apply in deterministic filename order.** Both the Supabase CLI
  (`supabase db reset`) and the CI runner (`scripts/db/apply-migrations.mjs`) sort
  the directory listing and apply in that order. A migration must therefore never
  depend on anything a later-sorted file creates.
- **One logical change per migration.** Each file must carry exactly one reviewable
  concern: one table with its constraints, RLS policies, grants, and triggers; or one
  set of roles; or one function family. Migration 0003 is the model: the
  `shared.number_sequences` table, its RLS, its grants, and its allocator function are
  one coherent unit, delivered together. What is prohibited is bundling _unrelated_
  changes (a new table **and** an unrelated index change elsewhere) into one file,
  because a failure then rolls back both and review cannot approve them independently.

## 3. Deterministic filenames — the naming rule

Every migration filename must match:

```
^(\d{4}|\d{14})_[a-z0-9_]+\.sql$
```

| Form                             | Range / source                                         | Used by                            |
| -------------------------------- | ------------------------------------------------------ | ---------------------------------- |
| `NNNN_description.sql`           | `0001`–`0999`, hand-assigned                           | Phase 1-2 platform foundation only |
| `YYYYMMDDHHMMSS_description.sql` | 14-digit timestamp emitted by `supabase migration new` | Phase 1-3 onward                   |

Both forms sort correctly against each other under plain lexicographic ordering
(4-digit numbers always precede 14-digit timestamps), so the transition from
foundation numbering to CLI timestamps is safe by construction.

The rule is **enforced twice**, so a badly named file cannot be applied anywhere:

- the database test suite asserts every file in `supabase/migrations/` matches the
  pattern (`tests/db/foundation.test.ts`);
- the CI runner's `listMigrations()` throws on any non-conforming filename before
  applying anything (`scripts/db/apply-migrations.mjs`).

The description part must be lower-case snake_case and say what the migration does
(`0003_number_sequences.sql`), consistent with the
[naming standard](./database-naming-standard.md).

## 4. Immutability of applied migrations

**A migration that has been merged to the target branch is immutable.** It must never
be edited, renamed, or deleted — not even to fix a typo in a comment. The reason is
mechanical: every environment that already applied the file holds the state it
produced; editing the file makes the repository lie about how that state was reached,
and re-running a changed file against a fresh database silently diverges from every
database that ran the original.

This is **enforced by CI**, not by convention. The `Database migrations and RLS tests`
job in `.github/workflows/ci.yml` runs the following assertion on every pull request:

```bash
git diff --name-status --diff-filter=MDR \
  "origin/${GITHUB_BASE_REF}...HEAD" -- supabase/migrations/
```

`--diff-filter=MDR` selects **M**odified, **D**eleted, and **R**enamed files. If the
diff between the target branch and the PR head shows any existing file under
`supabase/migrations/` in one of those states, the job fails with an instruction to
write a new forward migration instead. Pull requests may only **add** migration files.
(The checkout for this job uses `fetch-depth: 0` precisely so this diff has the full
history it needs.)

If a merged migration turns out to be wrong, the correction is a **new** migration
(section 10). If a migration is wrong on a feature branch that has **not** been merged,
it may still be amended freely — immutability begins at merge into the target branch,
because that is when other environments and other work may start depending on it.

## 5. Transactional DDL

PostgreSQL supports transactional DDL, and this platform relies on it:

- **CI runner: one transaction per migration.** `scripts/db/apply-migrations.mjs`
  wraps each file in `BEGIN … COMMIT` and issues `ROLLBACK` on failure. A failed
  migration therefore leaves **no partial state**: everything before it stays applied,
  the failing file applies not at all. This behaviour was exercised and recorded in the
  [defective-migration rehearsal](../phase-1/phase-1-2/rehearsal-defective-migration.md).
- **Local: `supabase db reset`** (wrapped as `npm run supabase:reset`) recreates the
  local database and applies all migrations in filename order, then applies
  `supabase/seed.sql`. It is the local equivalent of the clean-database replay.
- Consequently, a migration file must not contain its own `BEGIN`/`COMMIT`
  statements, and must not use statements that cannot run inside a transaction
  (e.g. `CREATE INDEX CONCURRENTLY`, `ALTER TYPE … ADD VALUE` on enums — which the
  data-type standard prohibits for volatile sets anyway). If a genuinely
  non-transactional operation is ever required, it must be isolated in its own
  migration with the limitation stated in the header, and its recovery path documented
  before merge.

Note on migration 0001: it ends with an `ALTER DATABASE … SET search_path` executed
via a `DO` block. `ALTER DATABASE … SET` is transactional and replays cleanly; the
dynamic form exists only because the database name differs between environments.

## 6. Rollback classification — declared in every header

Every migration **must declare its rollback classification in its header comment**,
with the reason:

| Classification      | Meaning                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rollback-safe`     | The change could, in principle, be reversed by a new forward migration without losing state that matters (e.g. adding a nullable column nobody has written to yet, adding an index). |
| `roll-forward-only` | Reversal would destroy state or break dependents; the only acceptable correction is a further forward migration.                                                                     |

The classification does **not** license writing down scripts — nothing is ever rolled
back by re-running an edited file (section 4). It exists so the reviewer and any future
operator know, before merge, what the blast radius of a mistake is.

All three existing migrations are **roll-forward-only**, each for a stated reason:

- **0001** — dropping an extension that objects depend on is destructive
  (`btree_gist` will carry EXCLUDE constraints; `pgcrypto` will carry fingerprint
  hashing); the database-level `search_path` setting is load-bearing for operator
  resolution.
- **0002** — the schemas (`org`, `iam`, `shared`, `crm`, `veh`), roles
  (`app_runtime`, `app_readonly`; `app_worker` is added by Phase 1-5 Increment G),
  and context functions become load-bearing the
  moment any later migration references them — which 0003 already does.
- **0003** — once any display number has been issued, dropping
  `shared.number_sequences` loses allocation state and would permit duplicate
  document numbers. Duplicate human-facing numbers on controlled documents are
  unacceptable; gaps are tolerated, duplicates never
  (see the [number-sequence standard](./number-sequence-standard.md)).

## 7. Expand–contract for breaking changes

Because migrations are forward-only and immutable, a breaking change (rename, type
change, moved column) must never be done in one destructive step once anything depends
on the old shape. The mandated pattern is **expand–contract**:

1. **Expand** — a migration adds the new structure alongside the old (new column, new
   table), with any backfill needed, without removing anything. Old and new coexist.
2. **Migrate usage** — application code and later migrations move to the new
   structure. During this window, writes keep both consistent (trigger or dual-write,
   whichever the change requires — stated in the expand migration's header).
3. **Contract** — a later migration removes the old structure, only after evidence
   that nothing reads or writes it.

**Illustration — Phase 1-3+ example only; `org.companies` does not exist today and is
shown purely to demonstrate the pattern:**

```sql
-- Migration A (expand): add the new column, backfill, keep the old one.
ALTER TABLE org.companies ADD COLUMN registered_name text;
UPDATE org.companies SET registered_name = legal_name WHERE registered_name IS NULL;
ALTER TABLE org.companies ALTER COLUMN registered_name SET NOT NULL;

-- Migration B (contract, a later PR, after usage has moved):
ALTER TABLE org.companies DROP COLUMN legal_name;
```

The expand and contract steps must be **separate migrations in separate pull
requests**, because the safety of the contract step depends on evidence gathered after
the expand step shipped. In today's local-plus-CI world (section 11) the window may be
short; the discipline is adopted now so it is already habitual when a shared
environment exists.

## 8. Migration review checklist

Every migration pull request must satisfy every item below. Review is performed under
the [Solo Developer Review Policy](../governance/solo-developer-review-policy.md)
(owner-approved technical self-review — never to be described as independent review),
and the checklist must be completed in the PR description.

- [ ] **Naming** — filename matches `^(\d{4}|\d{14})_[a-z0-9_]+\.sql$`; identifiers
      inside follow the [naming standard](./database-naming-standard.md)
      (snake_case, plural tables, `pk_`/`fk_`/`uq_`/`ck_`/`ex_` constraints,
      `tg_<table>_<purpose>` triggers, `sel_`/`ins_`/`upd_`/`del_` policies,
      63-byte limit respected with the documented shortening rule).
- [ ] **Single concern** — one logical change; nothing unrelated bundled in.
- [ ] **Rollback classification declared** — header states `rollback-safe` or
      `roll-forward-only` with the reason (section 6).
- [ ] **RLS on new tenant-owned tables** — `ENABLE` **and** `FORCE ROW LEVEL SECURITY`;
      policies named per the standard; default deny for anything not explicitly
      granted a policy (see the [RLS standard](./rls-standard.md)).
- [ ] **Named constraints** — every constraint has an explicit name; no
      system-generated names.
- [ ] **Tenant-leading indexes** — indexes on tenant-owned tables lead with
      `tenant_id`, or the migration carries a written justification for the exception.
- [ ] **Grants explicit** — every privilege the runtime roles receive is a stated,
      per-object grant (column-restricted where applicable, as in 0003); no
      `GRANT ALL`, no blanket `ALTER DEFAULT PRIVILEGES`.
- [ ] **No business tables before their phase** — Phase 1-2 creates none;
      `crm`/`veh` stay empty until their phases.
- [ ] **No Benzene, no Zoom** — no hard-coded tenant data anywhere (Benzene Vehicle
      Services is configuration-driven only, at onboarding, per ADR-008/ADR-009);
      nothing at all for Zoom Vehicle Inspection and Evaluation Services, which is
      outside Phase 1 (ADR-010).
- [ ] **Secret scan clean** — the `Secret and sensitive-file scan` CI job passes; any
      allowlisted line carries `pragma: allowlist secret` with a justification.
- [ ] **Clean-database replay passes** — locally via `npm run supabase:reset` and in
      CI via the migration runner (section 9).
- [ ] **Tests updated** — the database test suite covers the new objects' isolation,
      constraints, and grants; the full suite passes (`npm run test:db`).
- [ ] **Data dictionary updated** — every new/changed object is recorded, including
      honest notes (e.g. 0003 records that `tenant_id`/`company_id`/`branch_id` have
      **no foreign keys yet** — `org.*` does not exist until Phase 1-3, when the FKs
      are added).
- [ ] **Traceability updated** — the migration's header cites its task ID(s), and the
      traceability register links task → migration → tests → evidence.

## 9. Clean-database replay is the acceptance test

A migration is accepted only if the **entire chain** applies to an empty database:

- **Locally:** `npm run supabase:start`, then `npm run supabase:reset` —
  `supabase db reset` drops and recreates the local database, applies every migration
  in filename order, then applies `supabase/seed.sql` (which is intentionally empty of
  rows in Phase 1-2 — governance comments only — and must stay that way).
- **In CI:** the `Database migrations and RLS tests` job starts a fresh
  `postgres:17-alpine` service container and runs `npm run db:apply-migrations`
  (`scripts/db/apply-migrations.mjs`), followed by the 68-test database suite
  (`npm run test:db`), which passed in full on 2026-07-16.

The CI runner carries a **clean-database guard**: before applying anything it checks
whether any module schema (`org`, `iam`, `shared`, `crm`, `veh`) already exists, and
refuses to run if so. It can therefore never be pointed at a database holding state —
it validates replay from zero, and only that. The guard's refusal path was exercised in
the [rehearsal](../phase-1/phase-1-2/rehearsal-defective-migration.md).

"It works on my already-migrated database" is not evidence. Replay from empty is the
only accepted proof that the chain is complete, ordered, and self-contained.

## 10. Failure recovery — fix forward

When a migration fails:

1. **Nothing partial persists.** The per-file transaction rolls back the failing file
   entirely; earlier files remain applied (section 5).
2. **In CI / on a branch before merge:** fix the file, force the branch's history if
   needed — pre-merge migrations are not yet immutable — and replay from clean.
3. **After merge:** the defective migration is immutable. The correction is a **new
   forward migration** that repairs the state, with a header explaining what it fixes
   and why. Editing the merged file is blocked by the CI immutability assertion and
   must not be attempted by other means.

This failure mode is not theoretical: a deliberately defective migration was created,
run through the real runner, observed to fail with exit code 1 and no partial state,
and then deleted without ever being committed. The full procedure and verbatim output
are recorded in
[`docs/phase-1/phase-1-2/rehearsal-defective-migration.md`](../phase-1/phase-1-2/rehearsal-defective-migration.md).

## 11. Environment promotion — what exists today

Per [ADR-012](../adr/ADR-012-local-first-environment-with-controlled-promotion.md),
**no Development, Staging, or Production environment exists.** Do not write, plan, or
imply otherwise in any migration or document. The promotion path today is exactly:

| Step | Environment                                            | Mechanism                                         |
| ---- | ------------------------------------------------------ | ------------------------------------------------- |
| 1    | Local (Supabase stack, PostgreSQL 17.6, DB port 54322) | `npm run supabase:reset`                          |
| 2    | CI (`postgres:17-alpine` service container)            | `npm run db:apply-migrations` + `npm run test:db` |

Local and CI databases are separate instances with separate non-production
credentials; production data is prohibited in both. There is no production database to
edit, which is precisely why the disciplines in this standard (immutability, replay
from clean, fix-forward) are adopted **now**: they must already be reflexes on the day
a shared environment first exists, not learned on it.

## 12. No manual schema drift

- **No one edits any shared database directly** — no ad-hoc `ALTER TABLE` in a SQL
  console, no Studio-driven schema change, no "quick fix" outside a migration file.
  Today the only shared surface is the CI container (recreated per run) and the local
  stack (recreated by reset), so drift is self-correcting; the rule exists so it is
  already absolute when a longer-lived database appears.
- **The migration chain is the single source of schema truth.** Any database whose
  schema cannot be reproduced by replaying the chain from empty is, by definition,
  broken and must be rebuilt, not patched.
- **No auto-generated migration is accepted without review.** Tools that diff a live
  database and emit SQL (including `supabase db diff`) may be used to _draft_ a
  migration, but the output must be read, understood, cut down to a single concern,
  brought into naming/RLS/grant compliance, and pass the full checklist in section 8
  before it is committed. Generated SQL routinely omits RLS, grants, comments, and
  constraint names — none of which are optional here.

## 13. The Supabase workflow

- **CLI version:** the Supabase CLI is pinned through `package-lock.json`
  (CLI 2.109.1). CI and local development use the locked version via `npm ci` /
  the repository's npm scripts — never a globally installed, unpinned CLI.
- **Creating migrations:** from Phase 1-3 onward, new migrations are created with
  `supabase migration new <description>`, which emits the 14-digit-timestamp filename
  form of section 3. The hand-numbered `0001`–`0999` range is reserved for, and closed
  after, Phase 1-2 foundation work.
- **Applying migrations:** always in filename order — by `supabase db reset` locally
  and by the CI runner in CI. No mechanism may apply migrations out of order or
  selectively.
- **Local loop:** `npm run supabase:start` (start the stack) →
  `npm run supabase:reset` (replay from clean) → `npm run test:db` (assert behaviour).

## 14. Migration ownership and evidence

Every migration is owned by its author — currently Eng. Ezzaldeen Al-Bitar for all of
Phase 1-2 — and must leave the following evidence trail:

1. **Header comment** in the file itself: task ID(s), phase, what the migration does
   and deliberately does not do, rollback classification with reason, and links to the
   governing standards. Migrations 0001–0003 are the reference examples.
2. **Database comments:** `COMMENT ON` for every schema, table, non-obvious column,
   function, and role the migration creates — the schema is self-describing to anyone
   inspecting the live database, including honest limitations (0003's table comment
   records the deferred `org.*` foreign keys directly on the object).
3. **Tests:** additions to the database suite proving the object's isolation,
   constraint, and grant behaviour as a non-owner runtime role — never as `postgres`
   (see the [RLS standard](./rls-standard.md) on why postgres-role results prove
   nothing about RLS).
4. **Data dictionary and traceability entries** (checklist, section 8).
5. **For rehearsed failure paths or unusual operations:** a dated evidence document
   under `docs/phase-1/…`, as with the defective-migration rehearsal.

## 15. Honest gap — CI validates plain PostgreSQL, not the full Supabase stack

**The gap:** the CI database job runs against `postgres:17-alpine`, not the Supabase
local stack. The engine major version matches (PostgreSQL 17), but the role landscape
differs, and this difference is measured, not assumed:

- In the **local Supabase stack**, `postgres` is **not** a superuser but holds
  `BYPASSRLS`, `CREATEROLE`, and `CREATEDB`; `supabase_admin` is the superuser;
  `service_role` carries `BYPASSRLS` (which is why it must never reach a browser);
  `anon`/`authenticated` have no bypass.
- In the **plain `postgres:17` CI container**, `postgres` **is** a superuser, and the
  Supabase-managed roles do not exist at all.

**Why it is accepted:**

- Our migrations neither create nor modify any Supabase-managed role; they create only
  `app_runtime`, `app_readonly`, and `app_worker` (all `NOLOGIN NOSUPERUSER
NOBYPASSRLS …`), which
  behave identically in both environments.
- Tenant-session isolation assertions run as the harness-created
  `rootlco_test_runtime`; worker-boundary and concurrency assertions run as
  `rootlco_test_worker`. Both are constrained archetype members, never
  `postgres`, so no BYPASSRLS-capable result is presented as RLS evidence.
- Running the full Supabase stack in CI would add substantial time and moving parts to
  validate role differences our migrations deliberately do not touch.

**What this means in practice:** any future behaviour that _does_ depend on
Supabase-managed roles (e.g. policies targeting `authenticated`, PostgREST exposure)
cannot be considered CI-verified by this job and must carry its own evidence from the
local Supabase stack until CI grows a Supabase lane. This gap is documented here, in
the CI workflow comments, and is accepted by the owner for Phase 1-2.
