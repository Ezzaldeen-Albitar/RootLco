# DBCR-P1-32-PRE-OD-REF-001 — control-plane read of the three reference registers

**Company:** RootLco — Root Link Company · **Classification:** Confidential — Commercial Product
and Pilot Planning · **Phase:** 1-32 (preparatory) — Owner directive, reference-value selects ·
**Owner:** Eng. Ezzaldeen Al-Bitar (technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)).
**This is not an independent third-party review.** The Owner approved this migration on
2026-09-26, together with the two read operations it serves.

- **Migration:** `supabase/migrations/20260927090000_shared_reference_platform_read.sql` (the 161st)
- **Seed change:** none. No currency, time-zone or language row is added (OIR-04 stays open).
- **Permission change:** none. No permission code is added.
- **Executable proof:** `tests/db/org-security.test.ts` (role posture: app_platform reads the
  three registers and writes none of them), `tests/db/foundation.test.ts` (the exact policy-name
  inventory), and `tests/backend/p1-32-platform-console.test.ts`
  (`platform.reference-values-read` answers the active rows over the platform connection).
- **Rollback classification:** **ROLLBACK-SAFE** — three grants and three policies; no table,
  column, constraint, index, trigger, function or row is created, moved or destroyed. The exact
  inverse is in the migration footer.

---

## 1. Why this change request exists

The Platform Owner Console provisions an organisation and grows one that is already running. It
writes a tenant's default language and time zone, a company's base currency and a branch's time
zone — four columns that are foreign keys into `shared.languages`, `shared.timezones` and
`shared.currencies`. The console offered them as free-text boxes, so an operator learned that a
code was unknown only after the database refused it.

Offering them as selects needs a list, and the control-plane role `app_platform` could read none of
the three registers: it held no grant and no policy named it. Migration
`20260916091000_org_subscription_commerce.sql` records that as a deliberate choice — "no platform
path reads the currency register directly". With `platform.reference-values-read` that is no longer
true, so this change request reverses that recorded choice, for SELECT only.

The foreign-key checks on the platform writes never depended on the grant (an RI check runs with the
referenced table owner's rights) and still do not.

## 2. The change

| Object              | Grant to `app_platform` | Policy                                                                |
| ------------------- | ----------------------- | --------------------------------------------------------------------- |
| `shared.currencies` | `SELECT`                | `sel_currencies_platform` — `FOR SELECT TO app_platform USING (true)` |
| `shared.timezones`  | `SELECT`                | `sel_timezones_platform` — `FOR SELECT TO app_platform USING (true)`  |
| `shared.languages`  | `SELECT`                | `sel_languages_platform` — `FOR SELECT TO app_platform USING (true)`  |

The predicate is `true` for the same reason `sel_currencies_all`, `sel_timezones_all` and
`sel_languages_all` use it for `app_runtime` and `app_readonly`: the registers hold no tenant data,
so there is no row a reader should be kept from. New policies are created beside the existing ones
rather than altering them, following `20260916096000_platform_organization_growth.sql`, which
grants `app_platform` SELECT on `shared.number_sequences` beside a dedicated policy.

**Not granted:** INSERT, UPDATE or DELETE on any of the three tables, for `app_platform` or any
other application role. Reference rows remain maintained by the declared seed
`supabase/seeds/01_reference_data.sql` and by the migration role only.

## 3. Measured effect

Measured on a database created empty in a throwaway `postgres:17-alpine` container, replayed
through all 161 migrations and seeded twice with `npm run validate:seed-state`:

- `has_table_privilege('app_platform', <table>, 'SELECT')` is true for all three tables, and INSERT,
  UPDATE and DELETE are false;
- `pg_policies` names exactly `sel_currencies_platform`, `sel_languages_platform` and
  `sel_timezones_platform` for `app_platform` on the three tables, all `SELECT`;
- `scripts/ci/migration-replay-checks.mjs --phase post` reports `policies` 803 (was 800) and no
  other structural total moved;
- the schema hash moved; applying the stated inverse reproduced the previous hash exactly.

## 4. Records this change moves

`.github/ci-baselines/schema-baseline.json` (`migrationCount` 161, `schemaHash`,
`structuralTotals.policies` 803 — an Owner-approved baseline edit), the P1-15 migration census in
`tests/db/p1-15-shared-services-runtime-capabilities.test.ts`, the policy-name inventory in
`tests/db/foundation.test.ts`, `docs/database/role-and-grant-standard.md` §5.8, and the P1-27
migration-count records (`closure-record.md`, `clean-room-evidence.md`, `deliverable-manifest.md`,
`evidence/closing-value-ledger.json`).
