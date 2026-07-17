# Phase 1-3 Initial Audit — Organizational Database Readiness

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-3 — Tenant, Company, Branch, and Organizational Database ·
**Date:** 2026-07-17 · **Author:** Eng. Ezzaldeen Al-Bitar ·
**Review model:** [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)
under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
— owner-authorized technical self-review, never independent review.

---

## 1. Starting point (measured, not assumed)

| Item                        | Value                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------- |
| Branch                      | `feature/p1-03-organization-structure-schema`                                       |
| Base commit                 | `3d8e7cc2c962f82dc69e48bce09659dff05a27a9` (== `origin/develop` at branch time)     |
| Working tree at branch time | Clean (`git status --porcelain` empty)                                              |
| Prior stale branch          | Existed at `c37984e` with **zero** commits of its own; deleted and recreated        |
| Local platform              | Node v24.16.0 · npm 11.13.0 · Docker Engine 29.5.3 · PostgreSQL 17 (Supabase local) |

## 2. Phase 1-2 gate proof (the precondition for this phase)

Phase 1-3 may not begin until the Phase 1-2 technical-gate record is contained in
`origin/develop`. **Proven, not assumed:**

```
git merge-base --is-ancestor e9f4f7db64327937879d8dcc17b936b0edcb9b38 origin/develop
  → exit 0 (contained)
```

It reached `develop` through **pull request #11** (merge commit `3d8e7cc`). The Phase 1-2
gate record in `origin/develop` reads **Decision: Go — Technical Gate Passed**, with its
condition-1 CI evidence labelled **Owner-verified** (the owner inspected PR #5's checks in
GitHub; the build environment holds no GitHub credentials and did not read the run).

Phase 1-3 is therefore authorized. No further routine signature or approval is required
(Standing Technical Authorization Policy §2–§3).

## 3. Existing foundations this phase builds on (verified by reading the migrations)

| Foundation           | Object                                                                                                      | Consequence for Phase 1-3                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Module schemas       | `org`, `iam`, `shared`, `crm`, `veh` (migration `0002`)                                                     | `org` exists and is **empty** — this phase fills it. `crm`/`veh` stay reserved.                       |
| Role archetypes      | `app_runtime`, `app_readonly` — `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`     | Every Phase 1-3 grant is explicit and per-object. No blanket grants, no `ALTER DEFAULT PRIVILEGES`.   |
| Session context      | `iam.current_tenant_id()`, `iam.current_user_id()`, `iam.allowed_company_ids()`, `iam.allowed_branch_ids()` | Reused verbatim as the RLS pivot. **No new context function is needed or permitted.**                 |
| Row metadata trigger | `shared.touch_row_metadata()` — sets `updated_at`/`updated_by`, `record_version := OLD + 1`                 | Attached to every new updatable table; callers never write metadata columns.                          |
| Display numbers      | `shared.number_sequences` + `shared.next_display_number()` (migration `0003`)                               | **Reused. No second sequence table may be created** (§25 of the phase instruction).                   |
| Extensions           | `pgcrypto` 1.3, `btree_gist` 1.7, `citext` 1.6, `pg_trgm` 1.6 in schema `extensions` (migration `0001`)     | `btree_gist` is available for the `EXCLUDE` constraints this phase needs (effective-dating overlaps). |
| Deferred FKs         | `shared.number_sequences.tenant_id/company_id/branch_id` carry **no** FKs                                   | Phase 1-3 owns adding them, now that `org.*` exists. Recorded in the Phase 1-2 data dictionary.       |

## 4. Migration starting point and the naming rule (a correction to the brief)

Existing migrations: `0001_extensions.sql`, `0002_base_schemas.sql`,
`0003_number_sequences.sql`. **These are immutable** — all three are merged into
`develop` and `main` and must not be edited (migration standard §; CI asserts
immutability against the base ref).

The phase brief (§9) illustrates names such as `0004_org_reference_tables.sql`. **Those
names would violate the repository's own migration standard** and are therefore not used.
The standard is explicit and is enforced twice — by `tests/db/foundation.test.ts` and by
`scripts/db/apply-migrations.mjs`:

```
^(\d{4}|\d{14})_[a-z0-9_]+\.sql$
```

| Form                             | Range / source                    | Used by                                |
| -------------------------------- | --------------------------------- | -------------------------------------- |
| `NNNN_description.sql`           | `0001`–`0999`, hand-assigned      | **Phase 1-2 platform foundation only** |
| `YYYYMMDDHHMMSS_description.sql` | 14-digit `supabase migration new` | **Phase 1-3 onward — mandatory**       |

The brief anticipated exactly this: _"These names are illustrative. Inspect the existing
migration standard and choose final names that conform exactly."_ Phase 1-3 therefore uses
14-digit timestamps. Both forms sort correctly against each other (4-digit always precedes
14-digit), so application order is safe by construction.

## 5. Reusable helpers and the exact objects that exist today

Routines in module schemas (the foundation suite asserts this set **exactly**):

- `iam.current_tenant_id`, `iam.current_user_id`, `iam.allowed_company_ids`, `iam.allowed_branch_ids`
- `shared.touch_row_metadata`, `shared.guard_number_sequence_regression`, `shared.next_display_number`

Tables in module schemas: **`shared.number_sequences` only.**
Triggers: `tg_number_sequences_touch_metadata`, `tg_number_sequences_guard_regression`.
Policies: `sel_number_sequences_tenant`, `upd_number_sequences_tenant`.

## 6. Gaps this phase must close

1. `org` schema is empty — the entire Platform → Tenant → Company → Branch →
   Department/Warehouse/Storage-Location/Cost-Centre backbone does not exist.
2. No reference data exists (`shared.currencies`, `shared.timezones`, `shared.languages`).
3. No subscription-plan or tenant-subscription model exists.
4. No settings, tax, or feature-flag model exists.
5. `shared.number_sequences` scope columns still have no foreign keys.
6. `supabase/seed.sql` is a deliberate no-op; no provisioning framework exists.
7. No atomic tenant-provisioning path exists.

## 7. Risks and constraints identified before writing any SQL

| Risk                                                                                                                                                         | Handling in this phase                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The Phase 1-2 allow-list guards will fail by design.** `ALLOWED_TABLES`, `ALLOWED_ROUTINES`, and the exact trigger/policy lists pin the Phase 1-2 surface. | Correct behaviour, not a defect: the guard forces every new object to be **explicitly registered**. The lists are extended deliberately, object by object, in this phase. |
| **RLS is asserted on every table in a module schema**, including `shared`.                                                                                   | Platform reference tables (`shared.currencies`, …) get RLS **enabled and forced** with a read-only policy — no write policy at all — rather than an exemption.            |
| `org.tenants` is the root scope object and has no parent tenant.                                                                                             | It carries **no self-referential `tenant_id`**; the reason is documented in the migration and the data dictionary so it is never misread as a missing scope column.       |
| Tenant enumeration by a runtime session.                                                                                                                     | Only a minimum self-tenant projection is exposed at the database layer; platform-operator administration is **not** implemented here (Phase 1-4/1-14).                    |
| Jurisdiction assumptions (OIR-04 open).                                                                                                                      | **Zero** tax rules or jurisdiction values are seeded. Schema is complete; production reference seeding is recorded as pending.                                            |
| Benzene leaking into generic code.                                                                                                                           | Benzene may appear **only** in a controlled provisioning-data file, never in schema, policies, functions, or generic tests. A second fictional tenant proves genericity.  |
| Reference-table primary keys.                                                                                                                                | See §8 — a genuine conflict between two binding documents, resolved openly rather than silently.                                                                          |

## 8. Open decisions and a standards conflict recorded, not papered over

1. **OIR-04 (currency/jurisdiction policy) remains OPEN.** No owner-approved production
   currency subset exists. This phase therefore seeds only an explicitly documented
   neutral reference subset needed for testing, and classifies the production reference
   seed as **pending**. No production currency policy is invented.
2. **Reference-table primary key — a real conflict between two binding documents.**
   - The [Naming Standard](../../database/database-naming-standard.md) §5 says: _"The
     primary key of every table is `id uuid`."_
   - The phase instruction §10 says: _"Currencies: ISO currency code primary key"_, and
     §15 names the company column `base_currency_code` (a `_code` FK, not a `_id` FK).
   - The [Seed Standard](../../database/seed-standard.md) §3.1 already illustrates
     `shared.currencies` with `ON CONFLICT (code)` and requires _"stable natural keys
     (`code` columns) so idempotent conflict targets exist."_

   **Resolution:** the owner instruction governs (the canonical authority table makes the
   latest explicit owner instruction the tie-breaker), and it is corroborated by the seed
   standard's own illustration. Platform reference tables use their stable natural code as
   the primary key. This is a **deliberate, documented exception** to the `id uuid` rule,
   limited to platform reference tables, and the naming standard is amended openly to
   record it — it is not left as a silent contradiction.

3. **Benzene provisioning facts.** Where an actual Benzene value is unknown it is left
   NULL or marked with an explicit pending marker in the provisioning register — never
   invented.

## 9. Files that must NOT be changed by this phase

- `supabase/migrations/0001_extensions.sql`, `0002_base_schemas.sql`,
  `0003_number_sequences.sql` — applied and merged; immutable. A defect would require a
  new corrective migration, not an edit.
- The Phase 1-1 and Phase 1-2 gate records and their evidence registers — historical
  records.
- `.github/workflows/ci.yml` existing jobs — extended only, never weakened.

## 10. Confirmation: Phase 1-3 business work had not already started

Verified on the branch base before any implementation:

- `supabase/migrations/` contained exactly `0001`, `0002`, `0003`.
- No `org.*` table exists; the only module-schema table is `shared.number_sequences`.
- `grep -riE "CREATE TABLE.*(org\.|crm\.|veh\.)" supabase/` → no matches.
- No Zoom object exists; Benzene appears only in prohibitory/explanatory prose.
- The prior `feature/p1-03-…` branch contained **no** commits beyond `develop`.

Phase 1-3 starts from a clean, verified base.

## 11. Canonical documents

Canonical DOCX synchronization is **Pending — non-blocking administrative
synchronization** (Standing Technical Authorization Policy §7). The Phase 1 plan DOCX
remains held open by a Word session; the lock is never forced, no watcher is started, and
it does not block this phase. Synchronization completes in a controlled documentation
window and before production release or formal external delivery.
