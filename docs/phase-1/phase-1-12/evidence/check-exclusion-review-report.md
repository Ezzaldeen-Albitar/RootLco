# P1-12 Evidence — Check / Exclusion / State-Guard Review (Wave 2)

**Company:** RootLco — Root Link Company · **Release:** Release 2 — Core Business Database ·
**Phase:** P1-12 · **Review stream:** Structural ·
**Base:** protected `origin/develop` = `5cd16da` (P1-11 gate merge #45).

## Governance / self-review note

Owner-authorized technical, QA, security, and adversarial **self-review** by
Eng. Ezzaldeen Al-Bitar under the Solo Developer Review Policy and the Standing Technical
Authorization Policy — a solo-developer self-review, **not** an independent third-party
audit. The user performs all merges. Every outcome below traces to actual test execution; no
results are fabricated or extrapolated.

## Purpose

Prove that every documented check, exclusion, and state-guard family is enforced by the
database **and** has explicit negative evidence — a test that attempts the forbidden value,
overlap, or transition and asserts the database rejects it. Enforcement without a proof of
rejection is treated as unverified.

## Method

Each family is proven by the per-phase negative-test suites that ship as part of the full
database test suite. The complete suite on an empty rebuild is
**118 files / 1141 tests, all green (≈201 s)**. Each family's regression suite asserts both
the positive path (a valid value/transition is accepted) and the negative path (a violating
value, overlapping interval, forbidden mutation, or illegal initial state is rejected).
Enforcement is `CHECK` / `EXCLUSION` constraint- or guard-trigger-level, so it holds
regardless of the application path.

## Evidence — check / exclusion / state-guard families proven by negative tests

| #   | Family                           | Rule enforced (negative test rejects the violation)                                                  | Mechanism                           | Result |
| --- | -------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------- | ------ |
| 1   | Money precision `NUMERIC(18,4)`  | Monetary amounts confined to the 18,4 precision/scale; no truncation or over-precision               | Column type + `CHECK`               | Proven |
| 2   | Maker ≠ approver                 | The approver of a record cannot be its maker (segregation of duties)                                 | `CHECK` / guard                     | Proven |
| 3   | Payer splits                     | Payer allocations are non-negative and reconcile to the billed total                                 | `CHECK` / guard                     | Proven |
| 4   | Effective intervals              | Effective date ranges are valid and non-overlapping within scope                                     | `CHECK` + `EXCLUSION`               | Proven |
| 5   | Born-draft                       | Governed records must be created in `draft` (cannot be inserted already advanced)                    | Guard trigger / `CHECK`             | Proven |
| 6   | Immutability + provenance guards | Immutable/append-only rows reject `UPDATE`/`DELETE`; provenance fields cannot be forged or rewritten | Guard triggers + append-only grants | Proven |

All six families assert the negative path (violation **rejected**) inside the 1141-test
suite; none rely solely on the positive path. The immutability and provenance guards are
reinforced at the privilege layer — append-only ledgers hold no runtime `UPDATE`/`DELETE`
grant — so the guard cannot be bypassed by an application role.

## Cross-reference

Uniqueness families (tenant/company/branch codes, VIN normalization, one-open-visit, display
numbers, service codes/SKUs, price-rule resolution, quotation revisions, one-billable-invoice,
financial-event source uniqueness, delivery completion, warranty overlap, saved-filter
ownership) are covered in `unique-review-report.md`. Foreign-key integrity is covered in
`fk-review-report.md`.

## Status

**PASS.** All 6 documented check / exclusion / state-guard families have explicit
negative-test evidence in the 1141-test suite (118 files, all green). Every forbidden value,
overlapping interval, illegal initial state, and immutability/provenance violation is
rejected at the constraint or guard layer. Zero unresolved Critical or High findings for
this review.
