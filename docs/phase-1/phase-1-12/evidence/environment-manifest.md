# P1-12 Evidence — Environment Manifest

_Captured at Wave 0 from the validation environment. All figures are from actual inspection._

## Protected baseline

- **Protected base SHA:** `origin/develop` = `5cd16da9d5b82c3baa42146da02ef31dbc2e45d5` (P1-11 gate merge #45).
- **`origin/main`:** `286d48231368a105c762e63da658bbdc54726d16` (owner release-promotion PR #43 `develop`→`main`; **not** modified by this task).
- **P1-12 branch:** `feature/p1-12-database-integration-validation-release-gate` (created from `origin/develop`; HEAD started == `5cd16da`, clean working tree).

## Toolchain

| Component                   | Version                                          |
| --------------------------- | ------------------------------------------------ |
| PostgreSQL (Supabase local) | 17 (`supabase_db_RootLco` @ 127.0.0.1:54322)     |
| Node.js                     | v24.16.0                                         |
| npm                         | 11.13.0                                          |
| Docker                      | 29.5.3 (build d1c06ef)                           |
| OS                          | Windows 11 — MINGW64_NT-10.0-26200 (build 26200) |
| CPU / Memory                | 12 logical CPUs / 34.0 GB RAM                    |

## Repository baseline

- **Total migrations:** 113 (`.sql`), all forward-only/additive, all carrying a rollback-classification header (113/113).
- **Seed files (configured order):** `./seed.sql`, `seeds/01_reference_data.sql`, `seeds/04_iam_permission_catalog.sql`, `seeds/05_shared_reference.sql`, `seeds/06_wo_job_state_graph.sql`, `seeds/07_inv_units_of_measure.sql`, `seeds/08_sal_payment_methods.sql` (**7** seed files; numbering skips 02/03).
- **Test files:** 122 `.ts` under `tests/db/` (118 `*.test.ts` suites + helpers).
- **Existing validators:** 7 classification checks (crm, veh, apt-rec, wo-tech-dia-qms, svc-quo-inv, sal-wty-rpt, plus registers), `validate:no-fake-data`, `validate:seed-state`, `validate:canonical-docs`, `security:tracked-secrets`, `security:browser-secrets`, `security:scope-exclusions`.
- **CI required jobs:** Lint/types/tests/build · Docker build validation · Database migrations and RLS tests · Secret and sensitive-file scan.

## Live integrated inventory (empty rebuild — `supabase db reset` from empty)

| Metric                       | Value                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| Module schemas               | 17 (org, iam, shared, crm, veh, apt, rec, wo, tech, dia, qms, svc, quo, inv, sal, wty, rpt) |
| Tables                       | **242**                                                                                     |
| Columns                      | 3562                                                                                        |
| Functions                    | **210**                                                                                     |
| Triggers                     | **539**                                                                                     |
| Policies                     | **585**                                                                                     |
| Indexes                      | **999**                                                                                     |
| Constraints                  | 1843                                                                                        |
| Views                        | 0                                                                                           |
| `SECURITY DEFINER` functions | **0**                                                                                       |
| RLS tables not FORCE-enabled | **0**                                                                                       |
| Schema hash (sha256)         | `d3b1e7e40a141152f8aff04cf582c02cffa43f8709adad936450c8019d3e4cdb`                          |

Per-schema table counts: org 17 · iam 17 · shared 29 · crm 21 · veh 23 · apt 6 · rec 23 · wo 15 · tech 9 · dia 13 · qms 7 · svc 11 · quo 6 · inv 18 · sal 19 · wty 5 · rpt 3.

## Data-handling posture

- No real personal or customer data present. Business tables empty after clean migration
  (only tenant-neutral structural reference: currencies/timezones/languages, permission
  catalog, WO job state graph, units of measure, platform payment methods).
- All P1-12 validation datasets are **generated, non-personal** and are **not committed**.
