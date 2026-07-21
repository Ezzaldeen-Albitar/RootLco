# P1-12 Evidence — Phase-Boundary Upgrade Matrix Report (Wave 1.2)

**Company:** RootLco — Root Link Company · **Release:** Release 2 — Core Business Database ·
**Phase ID:** P1-12 · **Gate wave:** 1.2 (Migration review stream) ·
**Base:** protected `origin/develop` = `5cd16da` (P1-11 gate merge #45).

_All figures below are from the actual validation-environment execution and trace to the
committed machine-readable evidence `evidence/upgrade-matrix.json`. No number is estimated
or fabricated._

## Governance / self-review note

This report records an owner-authorized technical, QA, security, and adversarial
**self-review** by Eng. Ezzaldeen Al-Bitar under the Solo Developer Review Policy and the
Standing Technical Authorization Policy. It is **not** an independent third-party audit.
The user performs every PR merge; this task modifies neither `origin/develop` nor
`origin/main`.

## Gate condition

Starting from each historical phase boundary (P1-2 … P1-11), the remaining forward
migrations must apply cleanly and upgrade the database to the exact same canonical Release
2 schema, proving the migration set is order-independent of the entry point and converges
to one authoritative structure.

## Method

`scripts/db/phase-upgrade-matrix.mjs` runs each boundary on a **disposable database**: it
applies migrations up to the boundary cutoff file, records the boundary inventory, then
applies the remaining forward migrations and computes the final schema hash. Each final
hash is compared byte-for-byte against the canonical Release 2 hash.

- **Canonical schema hash:**
  `d3b1e7e40a141152f8aff04cf582c02cffa43f8709adad936450c8019d3e4cdb`
- **Boundaries evaluated:** 10 (P1-2 … P1-11) · **Aggregate result:** `all_pass = true`.

## Results — upgrade matrix (10/10)

| Phase | Cutoff migration                                | Boundary tables | Boundary fns | Boundary apply (ms) | Upgrade (ms) | Final hash = canonical | Outcome |
| ----- | ----------------------------------------------- | --------------- | ------------ | ------------------- | ------------ | ---------------------- | ------- |
| P1-2  | `0002_base_schemas.sql`                         | 0               | 5            | 133                 | 2226         | ✓ match                | ok      |
| P1-3  | `20260717107000_org_provisioning.sql`           | 22              | 20           | 278                 | 1938         | ✓ match                | ok      |
| P1-4  | `20260718098000_iam_rls_grants_hardening.sql`   | 41              | 34           | 427                 | 2009         | ✓ match                | ok      |
| P1-5  | `20260718111000_shared_services_hardening.sql`  | 63              | 57           | 735                 | 1655         | ✓ match                | ok      |
| P1-6  | `20260719106000_crm_fk_index_coverage.sql`      | 84              | 70           | 919                 | 1416         | ✓ match                | ok      |
| P1-7  | `20260720105000_veh_review_hardening.sql`       | 107             | 99           | 1094                | 1199         | ✓ match                | ok      |
| P1-8  | `20260721106000_rec_status_history_checkin.sql` | 136             | 118          | 1397                | 1074         | ✓ match                | ok      |
| P1-9  | `20260722105000_qms_rework_closure_gate.sql`    | 180             | 145          | 1846                | 630          | ✓ match                | ok      |
| P1-10 | `20260723097000_wo_forward_fks.sql`             | 215             | 184          | 2099                | 404          | ✓ match                | ok      |
| P1-11 | `20260724096000_rpt_reporting.sql`              | 242             | 210          | 2627                | 180          | ✓ match                | ok      |

Every boundary upgraded to the canonical hash with **byte-identical structural
equivalence** (`matches_canonical = true`, `error = null` for all 10 rows).

## Cumulative table counts across boundaries

| Boundary | P1-2 | P1-3 | P1-4 | P1-5 | P1-6 | P1-7 | P1-8 | P1-9 | P1-10 | P1-11 |
| -------- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | ----- | ----- |
| Tables   | 0    | 22   | 41   | 63   | 84   | 107  | 136  | 180  | 215   | 242   |

Progression: **0 → 22 → 41 → 63 → 84 → 107 → 136 → 180 → 215 → 242**, terminating at the
canonical Release 2 total of **242** tables.

## Status

**PASS — 10/10 boundaries.** Every phase boundary P1-2 … P1-11 applies cleanly and
upgrades to the single canonical schema hash
`d3b1e7e4…d3e4cdb`, byte-identical. Full per-boundary data is preserved in
`evidence/upgrade-matrix.json` (`all_pass: true`).
