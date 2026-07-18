# Seed Data Standard

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Active — binding for all seed data from Phase 1-2 onward ·
**Date:** 2026-07-16 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (under the
[Solo Developer Review Policy](../governance/solo-developer-review-policy.md) —
technical self-review, not independent review) ·
**Task:** P1-02-DB-015 ·
**Related:** [Database Architecture](./database-architecture.md) ·
[Migration Standard](./migration-standard.md) ·
[RLS Standard](./rls-standard.md) ·
[Role and Grant Standard](./role-and-grant-standard.md) ·
[Number Sequence Standard](./number-sequence-standard.md) ·
[Naming Standard](./database-naming-standard.md) ·
[ADR-008](../adr/ADR-008-configuration-driven-tenant-onboarding.md) ·
[ADR-009](../adr/ADR-009-benzene-as-first-configured-pilot-tenant.md) ·
[ADR-010](../adr/ADR-010-zoom-excluded-from-phase-1.md) ·
[ADR-012](../adr/ADR-012-local-first-environment-with-controlled-promotion.md)

---

## 1. Purpose and scope

This standard governs every piece of **seed data** in the platform: rows inserted
outside the normal application runtime path — reference data, provisioning
templates, tenant provisioning packages, and test fixtures. It defines four seed
classes, the binding requirements common to all of them, where each class lives
as the platform grows, and the data that must never appear in any of them.

It applies to `supabase/seed.sql`, to any future seed or provisioning files, and
to the test-fixture data created by the database test harness. It does **not**
govern schema changes: structure belongs exclusively to
`supabase/migrations/` under the [Migration Standard](./migration-standard.md).

Phase 1-2 context, stated plainly: the platform has no business-domain tables
yet (no tenants, companies, branches, users, customers, vehicles, documents).
Consequently there is almost nothing to seed, and `supabase/seed.sql` is
intentionally empty of rows (Section 5). This standard exists **now** so that
the first populated seed file is written under rules, not habits.

---

## 2. What a seed is — and is not

| A seed **is**                                                                                             | A seed **is not**                                                                 |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Row data (`INSERT`, and nothing but row data)                                                             | DDL of any kind — no `CREATE`, `ALTER`, `DROP`, `GRANT`, no policies, no triggers |
| Deterministic, reviewable, version-controlled content                                                     | A dump of a running database                                                      |
| Safe to re-run against a database that already contains it                                                | A one-shot script that assumes an empty table                                     |
| Configuration expressed as data (per [ADR-008](../adr/ADR-008-configuration-driven-tenant-onboarding.md)) | A migration by another name                                                       |
| Local/CI development material or a controlled provisioning action                                         | A channel for real, production, or personal data                                  |

**Binding rule — separation from migrations:** structure (tables, constraints,
roles, grants, RLS policies, functions, triggers, extensions) must only ever be
created by files in `supabase/migrations/`. A seed file that contains DDL is
defective and must be rejected in review. This is already codified inside
`supabase/seed.sql` itself: _“SEED IS NOT MIGRATION. Structure belongs in
supabase/migrations/. This file only inserts rows.”_

---

## 3. The four seed classes

Every seeded row must belong to exactly one of the classes below. A file (or
provisioning package) must contain rows of one class only; mixing classes in a
single file is prohibited because their lifecycles, audiences, and safety rules
differ.

### 3.1 Class 1 — Platform reference data

Rows that are true for **every** tenant and owned by the platform itself:
lookup-table values (status catalogues, document-type catalogues), ISO 4217
currency codes, unit-of-measure catalogues, and similar. Reference data carries
no tenant identifier by definition — a Class 1 row that contains a `tenant_id`
is misclassified.

Rules:

- Must be tenant-neutral and jurisdiction-neutral. No Jordan-specific (or any
  jurisdiction-specific) tax rates, categories, or legal values may be baked
  in; jurisdiction-dependent values are tenant configuration (Class 3), per
  the data-type rules in the [Database Architecture](./database-architecture.md).
- Must use stable natural keys (`code` columns per the
  [Naming Standard](./database-naming-standard.md)) so idempotent conflict
  targets exist.
- Changes to reference data are controlled changes: a new value is added by a
  new version of the seed (idempotent insert); an existing value is never
  silently rewritten by a seed — semantic changes go through a reviewed change
  with its own rationale.

Illustrative example — **Phase 1-3+ illustration only; `shared.currencies`
does not exist today**:

```sql
-- ILLUSTRATION (Phase 1-3+): platform reference data, idempotent.
INSERT INTO shared.currencies (code, name, minor_unit, created_by)
VALUES
  ('JOD', 'Jordanian Dinar',       3, '00000000-0000-4000-8000-000000000001'),
  ('USD', 'United States Dollar',  2, '00000000-0000-4000-8000-000000000001'),
  ('EUR', 'Euro',                  2, '00000000-0000-4000-8000-000000000001')
ON CONFLICT (code) DO NOTHING;
```

(The `created_by` UUID above is a documented platform-system actor placeholder,
required because the base metadata standard makes `created_by` `NOT NULL`; the
actual system-actor identifier is defined when IAM arrives in Phase 1-4. It is
not a real user.)

### 3.2 Class 2 — Tenant-provisioning templates

**Generic, tenant-agnostic** definitions of what a new tenant receives at
onboarding: the default set of number-sequence definitions, default document
statuses a tenant starts with, default configuration shapes. A template
describes _what to create_; it never names a tenant.

Rules:

- A template must be fully parameterised by tenant: it contains **no**
  `tenant_id` values, ever. If a concrete UUID appears in a Class 2 file, it is
  misclassified (it is either Class 3 or a defect).
- Templates are the single source of truth for onboarding content. Tenant
  provisioning (Class 3) must instantiate templates rather than restating
  their content, so that every tenant starts from the same reviewed baseline.
- Templates are version-controlled and reviewed exactly like code, because
  they define what every future customer receives.

Illustrative example — the template as data the provisioning process reads,
shown here as the _shape_ it instantiates (see 3.3 for the instantiation):

```text
Template "standard_sequences" (versioned document, not SQL):
  - sequence_code: quotation,  prefix_template: 'Q-{period}-',  pad_width: 6, period_reset_rule: yearly
  - sequence_code: work_order, prefix_template: 'WO-{period}-', pad_width: 6, period_reset_rule: yearly
  - sequence_code: invoice,    prefix_template: 'INV-{period}-', pad_width: 6, period_reset_rule: yearly
```

(`quotation`, `work_order`, `invoice` documents are issued by later phases;
the template names are illustrations. The column names and semantics match the
real `shared.number_sequences` table from migration `0003`.)

### 3.3 Class 3 — Tenant-specific controlled provisioning

Concrete rows for **one named tenant**, created when that tenant is onboarded.
This is configuration-as-data under
[ADR-008](../adr/ADR-008-configuration-driven-tenant-onboarding.md): the tenant
row itself, its companies and branches, its instantiated sequence definitions,
its jurisdiction-specific configuration.

**Phase 1-5 operating model (owner decision 2026-07-18):** a Class-3 package is
a controlled JSON data artifact under `supabase/packages/`, executed only by the
generic, environment-gated administrative CLI after an exact tenant-code
confirmation and a write-free dry run. It is never listed in `[db.seed]`, never
runs in CI or on local reset, and must produce an operator-retained result log.

Rules:

- Class 3 runs on the **manual administrative path only**. This is already enforced in
  the schema where it matters most: migration `0003` deliberately grants the
  runtime roles **no INSERT and no DELETE** on `shared.number_sequences` and
  defines no INSERT/DELETE policy — sequence provisioning is an administrative
  configuration action, not an application feature. Future provisioning follows
  the same posture (see the [Role and Grant Standard](./role-and-grant-standard.md)).
- Every Class 3 package must be a controlled, reviewed, version-controlled data
  artefact with a named operator, approved environment, exact confirmation,
  dry-run review, execution record, and idempotent operation — never ad-hoc SQL
  typed into a console and never an automatic seed.
- A Class 3 package must instantiate Class 2 templates; it may override
  documented parameters (prefixes, pad widths) but must not invent structure.
- **This is the only class in which Benzene Vehicle Services may ever appear**
  — see Section 7.

Historical Phase 1-2 illustration of the idempotency rule (the current
implementation is the gated JSON-package model above):

```sql
-- ILLUSTRATION (Phase 1-3+): controlled provisioning package for ONE tenant,
-- executed on the administrative path at onboarding. :tenant_id, :company_id
-- and :operator_id are operator-supplied parameters — never literals in the
-- committed file, and never a hard-coded tenant.
INSERT INTO shared.number_sequences
  (tenant_id, company_id, sequence_code, prefix_template, pad_width,
   period_reset_rule, created_by)
VALUES
  (:tenant_id, :company_id, 'quotation', 'Q-{period}-', 6, 'yearly', :operator_id)
ON CONFLICT ON CONSTRAINT uq_number_sequences_scope DO NOTHING;
```

Note the conflict action is `DO NOTHING`, **not** `DO UPDATE`: a re-run must
never touch `next_value` or `current_period` of a live sequence, because
rewinding a counter would re-issue already-issued display numbers. (Migration
`0003` additionally blocks lowering `next_value` without a period change via
`tg_number_sequences_guard_regression` — defence in depth, not a licence to
try.)

### 3.4 Class 4 — Test fixtures

Deterministic data created by the automated database test harness to prove
isolation, constraints, and concurrency behaviour.

Rules:

- Test fixtures belong to the test harness under `tests/db/` — **never** to
  `supabase/seed.sql` and never to any migration. The harness owns their whole
  lifecycle.
- As practised today (verified 2026-07-16, all 68 tests passing via
  `npm run test:db`): the suite creates and drops a disposable fixture schema
  `p1_02_test`; fixture tenants use the deterministic UUIDs
  `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa` (tenant A) and
  `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb` (tenant B); isolation assertions run
  as the login role `rootlco_test_runtime` (member of `app_runtime`), which is
  created by the harness and **never by a migration** (`tests/db/helpers.ts`).
- Fixture identifiers must remain deterministic so failures are reproducible
  and diffs reviewable. Random fixture data is prohibited except where the test
  itself is about randomness (none exists today).
- Fixture data must be obviously fake. Real names, real vehicle identifiers,
  real phone numbers or emails are prohibited even in fixtures.

The harness files are `tests/db/foundation.test.ts`, `tests/db/rls.test.ts`,
`tests/db/constraints.test.ts`, `tests/db/patterns.test.ts`,
`tests/db/number-sequences.test.ts`, and `tests/db/helpers.ts`.

---

## 4. Binding requirements for all seed classes

Every requirement below is mandatory. Rationale follows each rule.

1. **Idempotent.** Every insert must be safe against a database that already
   contains the row: `ON CONFLICT (…) DO NOTHING` /
   `ON CONFLICT ON CONSTRAINT … DO NOTHING` against a declared unique
   constraint, or an equivalent explicit existence check. Rationale: seeds are
   re-run by design (`supabase db reset`, repeated provisioning attempts after
   a partial failure); a seed that errors or duplicates on re-run turns
   recovery into an incident. Corollary: every seedable table needs a natural
   or scoped unique key to conflict on — `uq_number_sequences_scope`
   (`UNIQUE NULLS NOT DISTINCT (tenant_id, sequence_code, company_id,
branch_id)`) is the practised example.
2. **Deterministic.** The same seed file version must produce the same rows
   every time: fixed codes, fixed UUIDs where an identity must be stable
   (fixture tenants, system actors), no `random()`, no environment-dependent
   branching hidden inside the data. `DEFAULT now()` audit timestamps are
   acceptable — determinism applies to business content, not to audit
   metadata. Rationale: reviewability and reproducibility.
3. **Environment-aware.** A seed file must state which environments it is for,
   and must be safe if executed in the wrong one (idempotency plus refusing
   assumptions about pre-existing state). Honest current state: per
   [ADR-012](../adr/ADR-012-local-first-environment-with-controlled-promotion.md)
   **no Development/Staging/Production environment exists** — the only
   databases are the local Supabase stack (PostgreSQL 17.6, DB port 54322) and
   the separate CI container (`postgres:17-alpine`), each with separate
   non-production credentials. “Environment-aware” today therefore means:
   local-only, and never written as if a production database existed.
4. **Version-controlled.** Every seed file and provisioning package lives in
   the repository and changes only through the normal reviewed branch/PR flow.
   No seed is ever executed from an unversioned scratch file.
5. **Safe to re-run.** Follows from (1), but is a distinct review question:
   _what happens if this runs twice, or half-runs and runs again?_ The answer
   must be “nothing bad”, and for counters specifically: a re-run must never
   reset or rewind allocation state (Section 3.3).
6. **DDL never in seeds.** Restated because it is the most common failure
   mode: if a seed file contains anything but row inserts (and the minimal
   `DO` blocks needed for notices/guards), it is in the wrong file.
7. **No real, production, or personal data — ever.** No customer records, no
   real vehicle identifiers (VINs, plate numbers), no personal data, no
   passwords, keys, or tokens, nothing copied from a live system. This applies
   to all four classes without exception and mirrors the sensitive-data rules
   in the [Database Architecture](./database-architecture.md).
8. **RLS is not suspended for seeding.** Seeds and provisioning run on
   administrative connections whose roles are documented in the
   [Role and Grant Standard](./role-and-grant-standard.md); nothing about
   seeding may weaken, disable, or bypass a policy, and no seed result obtained
   under a `BYPASSRLS`-capable role (such as local `postgres`) may be presented
   as evidence of RLS behaviour (see the [RLS Standard](./rls-standard.md)).

---

## 5. Current state of `supabase/seed.sql` (verified 2026-07-16)

**Phase 1-5 forward correction (2026-07-18):** `[db.seed].sql_paths` now declares
`seed.sql`, `01_reference_data.sql`, `04_iam_permission_catalog.sql`, and
`05_shared_reference.sql`. Former tenant seeds 02 and 03 were removed. Seed 05
adds exactly five tenant-neutral retention-class definitions; no declared seed
creates a tenant, role, user, grant, or other business row.

`supabase/seed.sql` is applied by `supabase db reset` **after all migrations**,
configured in `supabase/config.toml` under `[db.seed]` with
`sql_paths = ["./seed.sql"]`. It is **intentionally empty of rows**: it
contains a governance header and a single `DO $$ … RAISE NOTICE … $$;` block
that proves the seed pipeline executes without creating any object or writing
any row.

Its header states the rules that govern the file when it is eventually
populated — quoted here as the operative text:

> 1. **NO TENANT IS HARD-CODED. Not here, not anywhere.** Benzene Vehicle
>    Services (بنزين لخدمات المركبات) is the first customer, the first
>    subscribed tenant, and the first pilot. It is NOT the software owner and
>    NOT the platform owner. It is onboarded exactly like any other tenant
>    would be: through configuration and operator-entered data. A `benzene` row
>    committed to this file would make the product unsellable to the second
>    customer. Do not add one. See ADR-008, ADR-009.
> 2. **NO ZOOM OBJECTS.** Zoom Vehicle Inspection and Evaluation Services is
>    outside Phase 1 (out-of-scope register P1-OOS-026). No tables, no seeds,
>    no columns, no enum values. See ADR-010.
> 3. **NO REAL DATA AND NO PRODUCTION DATA.** This file is local-only. It must
>    never contain customer records, personal data, real vehicle identifiers,
>    passwords, keys, or anything copied from a live system.
> 4. **SEED IS NOT MIGRATION.** Structure belongs in supabase/migrations/.
>    This file only inserts rows. If you are writing DDL here, it is in the
>    wrong file.
> 5. **IDEMPOTENT.** `db reset` re-runs this from scratch, but write inserts so
>    that re-running is safe (ON CONFLICT DO NOTHING) rather than assuming an
>    empty table.

**Binding for Phase 1-2:** the file stays exactly this way — governance header
and no-op notice, zero rows. Phase 1-2 creates no business-domain tables, so
there is nothing legitimate to seed; any row added to this file during Phase
1-2 is a standards violation. (The header's “INTENTIONALLY EMPTY AT PHASE 1-1”
wording predates this phase; the emptiness requirement carries forward
unchanged through Phase 1-2.)

Current CI note (forward-corrected 2026-07-18): after clean migrations, the
database job runs `npm run validate:seed-state`. That command parses the declared
paths, applies every seed twice, verifies exact retention definitions, proves all
business tables empty, and proves per-table count idempotence before DB tests.

---

## 6. Where each class lives as the platform grows

| Class                                       | Phase 1-2 location                                   | Target location as the platform grows                                                                                                                                         | Executed by                                                                             |
| ------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1 — Platform reference data                 | Nowhere (no reference tables exist)                  | `supabase/seed.sql` for local development reference data; the promotion mechanism to any future shared environment is decided when such an environment first exists (ADR-012) | `supabase db reset` locally; controlled deployment step later                           |
| 2 — Tenant-provisioning templates           | Nowhere (documented in standards only)               | Versioned template artefacts in the repository (data files or SQL fragments) consumed by the provisioning process — never merged into `seed.sql`                              | Provisioning tooling, administrative path                                               |
| 3 — Tenant-specific controlled provisioning | Prohibited entirely                                  | Controlled provisioning packages per tenant, stored and reviewed in the repository, executed at onboarding with an execution record                                           | Administrative path only (runtime roles have no INSERT — practised in migration `0003`) |
| 4 — Test fixtures                           | `tests/db/` harness (disposable schema `p1_02_test`) | Stays with the test harness; grows with new test suites                                                                                                                       | `npm run test:db` (vitest + pg)                                                         |

Phase 1-5 current location note: Class 1 files are the declared structural SQL
seeds (01, 04, 05); Class 3 lives in controlled JSON packages and is executed by
the manual gated CLI; Class 4 provisioning fixtures are cascade-deleted by their
own suites.

Two boundaries in this table are load-bearing:

- **`seed.sql` is for Class 1 only.** Tenant-shaped rows (Classes 2 and 3)
  never enter `seed.sql`, in any phase — a tenant committed to the shared seed
  file is a hard-coded tenant, which [ADR-008](../adr/ADR-008-configuration-driven-tenant-onboarding.md)
  prohibits.
- **Test fixtures never leak out of the harness.** The harness creates and
  drops everything it needs (`p1_02_test` schema, `rootlco_test_runtime`
  login); nothing it creates may appear in migrations or seeds.

---

## 7. Benzene policy

Benzene Vehicle Services is the first customer, first subscribed tenant, and
first pilot ([ADR-009](../adr/ADR-009-benzene-as-first-configured-pilot-tenant.md)).
It is **not** the owner of the platform and **not** a special case in code or
schema. The binding rules:

- Benzene may appear **only** in its Class-3 controlled data package and the
  associated operator/governance documentation.
- Benzene must **never** appear in the Phase 1-2 base database: not in
  migrations, not in `seed.sql`, not in schema objects, not in RLS policies,
  not in functions, not in application logic, not as a default value, not as
  a test fixture name.
- Nothing in the platform may behave differently because the tenant is
  Benzene. If a Benzene requirement cannot be expressed as configuration
  available to every tenant, that is a product-design decision to escalate,
  not a seed to write.

Zoom Vehicle Inspection and Evaluation Services is outside Phase 1 entirely
([ADR-010](../adr/ADR-010-zoom-excluded-from-phase-1.md)): no seed class may
contain Zoom rows, and no provisioning package for Zoom may be drafted within
Phase 1.

---

## 8. Review checklist for any future seed or provisioning change

A reviewer (under the [Solo Developer Review Policy](../governance/solo-developer-review-policy.md),
this is a documented technical self-review) must be able to answer **yes** to
all of the following before a seed change merges:

1. Does every row belong to exactly one declared seed class, in the correct
   location for that class (Section 6)?
2. Is every statement an idempotent row insert — no DDL, no grants, no policy
   changes, no `DO UPDATE` on allocation state?
3. Is the content deterministic and reviewable line by line?
4. Is the file free of tenant hard-coding (no Benzene, no concrete tenant in
   Classes 1–2), free of Zoom objects, and free of real/production/personal
   data?
5. Does re-running it twice — or after a partial failure — change nothing?
6. If this is the first change that populates `seed.sql`: has CI been extended
   to execute or assert the seed (Section 5, honest note)?

A “no” to any question blocks the merge.
