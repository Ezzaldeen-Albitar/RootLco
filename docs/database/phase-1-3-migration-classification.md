# Phase 1-3 Migration Classification

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-3 · **Date:** 2026-07-17 · **Task:** P1-03-DB-021 · **Owner:** org module
(Eng. Ezzaldeen Al-Bitar)

Naming: 14-digit `supabase migration new` timestamps, mandatory from Phase 1-3
(migration standard §3). Application order = filename order. Migrations 0001–0003
are merged and immutable; the two amendments below happened on UNMERGED Phase 1-3
files only, which the standard permits (CI immutability compares against the
`develop` base, where these files do not exist).

| Migration                                            | Tasks                  | Forward behaviour                                                      | Rollback class                                                                      | Data-loss risk if dropped | Depends on    |
| ---------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------- | ------------- |
| `20260717100000_org_reference_tables.sql`            | DB-013, DB-019         | currencies/timezones/languages + IANA trigger + read-only RLS          | rollback-safe while unreferenced → **roll-forward-only** once org rows reference it | reference config          | 0002          |
| `20260717101000_org_tenants.sql`                     | DB-001, DB-002         | tenants + status history + immutable guard + atomic transition         | **roll-forward-only** once a tenant exists (root of everything)                     | the whole hierarchy       | 100000        |
| `20260717102000_org_subscriptions.sql`               | DB-003, DB-004, DB-015 | flags + versioned plans (validated jsonb) + subscriptions + resolution | roll-forward-only once assigned                                                     | entitlement evidence      | 101000        |
| `20260717103000_org_companies_branches.sql`          | DB-005..007            | companies + branches (composite FKs) + branch history + transition     | roll-forward-only once populated                                                    | organizational identities | 100000,101000 |
| `20260717104000_org_operational_structure.sql`       | DB-008..011            | departments/warehouses/locations/cost centres + live-parent guards     | roll-forward-only once populated                                                    | operational structure     | 103000        |
| `20260717105000_org_settings_tax_features.sql`       | DB-012, DB-014, DB-015 | versioned settings + tax foundation + overrides + feature resolution   | roll-forward-only once populated (settings/tax are evidence)                        | configuration history     | 102000,103000 |
| `20260717106000_shared_number_sequences_org_fks.sql` | DB-016                 | attaches the deferred org FKs + child-side support indexes             | **ROLLBACK-SAFE** (constraints/indexes only; tested by dropping in rehearsal)       | none                      | 0003,103000   |
| `20260717107000_org_provisioning.sql`                | DB-020, DB-022         | idempotency keys + atomic provisioning function                        | rollback-safe while unused → roll-forward-only once real provisioning ran           | provisioning evidence     | all above     |

**Amendments to unmerged files (self-review findings, recorded):** FK-support
indexes added to `101000`, `104000`, `105000` after the automated FK-coverage
assertion caught four gaps (evidence register §4).

## Rehearsals (executed 2026-07-17, outputs in the evidence register)

| Rehearsal                                          | Result                                                                                                                                                           |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean apply, empty database (`supabase db reset`)  | 0001→0003→all seven Phase 1-3 migrations + all three seed files, repeatedly, exit 0                                                                              |
| Deliberately defective migration (never committed) | `RUNNER_EXIT=1` — "syntax error at end of input"                                                                                                                 |
| Populated-database guard                           | `GUARD_EXIT=1` — "Refusing to run: module schemas already exist"                                                                                                 |
| Rollback-safe class test (`106000`)                | constraints/indexes dropped and re-applied on a scratch pass without data effect                                                                                 |
| Roll-forward recovery statement                    | For roll-forward-only migrations, recovery = corrective forward migration + restore from backup where data was lost; destructive rollback support is NOT claimed |
