# P1-12 Evidence — Seed Campaign Report

**Company:** RootLco — Root Link Company · **Phase ID:** P1-12 · **Wave:** 6.1 (QA) ·
**Gate condition:** Seed campaign — idempotent, no fake / business data.

- **Protected base:** `origin/develop` = `5cd16da` (P1-11 gate merge #45).
- **Branch:** `feature/p1-12-database-integration-validation-release-gate`.
- **Canonical schema hash:** `d3b1e7e40a141152f8aff04cf582c02cffa43f8709adad936450c8019d3e4cdb`.
- **Validators:** `validate:seed-state` and `validate:no-fake-data`.

## Governance / self-review note

Owner-authorized technical, QA, security, and adversarial **self-review** by
Eng. Ezzaldeen Al-Bitar under the Solo Developer Review Policy and the Standing Technical
Authorization Policy. This is **not** an independent third-party audit. All figures are
from actual execution; none are fabricated or extrapolated. The user performs every merge.

## Result

The seed campaign is **idempotent (applied ×2)**, **deterministic**, and **referentially
intact**. After a clean migration the business tables are **empty**; the seeds carry
**only tenant-neutral structural reference** data, with **no fabricated / business data**
and **no invented currency or tax**.

## Seed set (7 files)

`./seed.sql`, `seeds/01_reference_data.sql`, `seeds/04_iam_permission_catalog.sql`,
`seeds/05_shared_reference.sql`, `seeds/06_wo_job_state_graph.sql`,
`seeds/07_inv_units_of_measure.sql`, `seeds/08_sal_payment_methods.sql`
(**7** seed files; numbering skips 02/03).

## Campaign assertions

| Assertion                                      | Expected                               | Result |
| ---------------------------------------------- | -------------------------------------- | ------ |
| Idempotent re-apply (seeds run ×2)             | `validate:seed-state` OK, no drift     | PASS   |
| Deterministic content                          | identical result each apply            | PASS   |
| Referential integrity of seeded reference data | intact                                 | PASS   |
| Business tables after clean migration          | empty                                  | PASS   |
| No fake / mock / demo / business data          | none present (`validate:no-fake-data`) | PASS   |
| No invented currency or tax                    | none invented                          | PASS   |

## Reference control totals (deterministic)

The structural reference content is deterministic across applies; representative control
totals observed during Wave 7 restore verification:

| Reference table | Rows |
| --------------- | ---- |
| currencies      | 3    |
| permissions     | 43   |
| payment_methods | 3    |

These are tenant-neutral structural reference values (currencies / timezones / languages,
the IAM permission catalog, the WO job state graph, units of measure, and platform payment
methods) — not customer, tenant, or business data.

## Status

**PASS — Wave 6.1 seed campaign.** Seeds are idempotent across two applies, deterministic,
and referentially intact; business tables remain empty; no fabricated / business data and
no invented currency or tax are present.
