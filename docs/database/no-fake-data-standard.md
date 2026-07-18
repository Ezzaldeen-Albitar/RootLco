# No-Fake-Data Standard

**Status:** Binding, permanent, project-wide. Introduced 2026-07-18.

RootLco must ship and start with **no fabricated business data**. A freshly
migrated database contains only approved **structural reference definitions**; all
**business tables are empty** until real records are entered by authorized users
through real application workflows.

## 1. Prohibited

No demo / sample / mock / fake / fabricated business records anywhere that the
application ships or auto-inserts, including: customers, vehicles, work orders,
invoices, employees, users, companies, branches, suppliers, partners, documents,
messages, notes, comments, operational events; mock API responses shipped with
the product; JSON fixture data used by the running application; frontend-hardcoded
business records; development-only business records auto-inserted on normal
startup; a "demo mode"; placeholder business transactions; Faker-generated
records committed as application data; persistent seed data representing business
activity; production-like sample content.

**Real Benzene or Zoom operational data is equally prohibited as startup data.**
The system starts empty regardless of whether the fabricated-vs-real distinction
applies.

## 2. Allowed

- **Structural reference data** — only when required for executable behaviour and
  kept generic, tenant-neutral, and free of Benzene/Zoom/customer content:
  permission codes, role definitions, languages (`ar`/`en`), status codes,
  classification and retention-class definitions, technical configuration
  catalogues. These are system definitions, not business records; each must be
  justified as structural before it is added.
- **Ephemeral automated-test data** — created inside an isolated test, in a
  rolled-back transaction or disposable database, removed automatically
  (`cleanFixtures`), never shipped as seed, never inserted by normal startup,
  never shown in the UI, never relied on by application behaviour. It is **not**
  "seed data".
- **Structural template identity** — only if technically mandatory, and with **no
  customer-facing final wording**. Prefer proving template tables with ephemeral
  test inserts.

## 3. Enforcement

| Control            | Mechanism                                                                                                                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static scan        | `npm run validate:no-fake-data` (`scripts/check-no-fake-data.mjs`) flags demo/mock/sample/fake business-record indicators outside a precise allow-list (tests, docs, this standard). Wired into CI (secrets job). |
| Clean-DB invariant | `tests/db/no-fake-data.test.ts` asserts the shared-services business tables hold zero rows on a clean database.                                                                                                   |
| API layer (future) | Every API returns real empty collections when no data exists, never mock rows; integration tests use ephemeral isolated data only.                                                                                |

## 4. Phase 1-5 application

- **Increment M** is reinterpreted from "structural seeds" to **mandatory
  platform reference configuration only** (P1-05-DB-021): retention-class
  definitions and any equally-structural catalogue — **no** document categories,
  message templates, localized business wording, tenants, or operational content.
- **Document categories** and **message templates** start empty; they are
  configured later through real administration flows.
- **Localization**: the schema supports `ar`/`en`; final UI wording is entered
  later (approved configuration/migration), never invented in the database phase.

## 5. Known pending reconciliation

Pre-existing merged Phase 1-3/1-4 seeds
`supabase/seeds/02_benzene_pilot_provisioning.sql` (real Benzene tenant) and
`supabase/seeds/03_local_test_tenant.sql` (fictional "Northwind Motors" tenant)
auto-provision business rows on `supabase db reset`, and merged tests
(`tests/db/org-provisioning.test.ts`, `tests/db/iam-seeds.test.ts`) depend on
them. They predate this standard and conflict with it. They are **allow-listed in
the guard pending an explicit owner decision** and were **not removed
unilaterally** (doing so would break approved tests and touch the real customer's
provisioning). The owner must choose either to convert them to ephemeral,
test-only provisioning (and rewrite those tests) or to record a documented
exception here. Note: the CI database job runs migrations only (no seeds), so
these seeds never populate the CI-validated database.
