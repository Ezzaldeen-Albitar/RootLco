# P1-12 Evidence — Migration Rebuild Report (Wave 1.1)

**Company:** RootLco — Root Link Company · **Release:** Release 2 — Core Business Database ·
**Phase ID:** P1-12 · **Gate wave:** 1.1 (Migration review stream) ·
**Base:** protected `origin/develop` = `5cd16da` (P1-11 gate merge #45).

_All figures below are from the actual validation-environment execution. No number is
estimated, extrapolated, or fabricated._

## Governance / self-review note

This report records an owner-authorized technical, QA, security, and adversarial
**self-review** by Eng. Ezzaldeen Al-Bitar under the Solo Developer Review Policy and the
Standing Technical Authorization Policy. It is **not** an independent third-party audit.
The user performs every PR merge; this task modifies neither `origin/develop` nor
`origin/main`.

## Gate condition

Empty rebuild is reproducible from an empty database, seeds are idempotent across repeated
runs with business tables left empty, and the full database test suite passes green on the
freshly rebuilt schema.

## Method

- **Rebuild:** `supabase db reset` from an **empty** database (no pre-existing schema),
  applying all migrations and configured seeds from scratch.
- **Seed idempotency:** `validate:seed-state` executed **twice** consecutively against the
  rebuilt database.
- **Test:** full `test:db` suite executed against the empty-rebuild result.

## Results

### Empty rebuild

| Item                  | Value                                                              |
| --------------------- | ------------------------------------------------------------------ |
| Rebuild source        | Empty database (`supabase db reset` from empty)                    |
| Migrations applied    | **113** (all forward-only / additive)                              |
| Seed files applied    | **7** (configured order; numbering skips 02/03)                    |
| Reset outcome         | Exit 0 — clean apply, no errors                                    |
| Resulting tables      | **242**                                                            |
| Resulting schema hash | `d3b1e7e40a141152f8aff04cf582c02cffa43f8709adad936450c8019d3e4cdb` |

### Full test suite (on the empty rebuild)

| Metric     | Value         |
| ---------- | ------------- |
| Test files | **118**       |
| Tests      | **1141**      |
| Outcome    | **ALL GREEN** |
| Wall time  | **201 s**     |

### Seed idempotency

| Run             | `validate:seed-state` | Business tables |
| --------------- | --------------------- | --------------- |
| First run       | OK                    | Empty           |
| Second run (×2) | OK                    | Empty           |

Repeated seeding adds no rows and no fabricated business data; only tenant-neutral
structural reference is present after a clean rebuild.

## Status

**PASS.** The empty rebuild is reproducible with exit 0; the full suite is **118 files /
1141 tests, all green (201 s)**; seeds are idempotent across two runs with business tables
empty; and the rebuilt schema resolves to the canonical hash
`d3b1e7e4…d3e4cdb` (**242** tables).
