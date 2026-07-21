# P1-12 Evidence — Uniqueness Rule Review (Wave 2)

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

Prove that every documented uniqueness rule is enforced by the database **and** has explicit
negative evidence — a test that attempts the forbidden duplicate and asserts the database
rejects it. Enforcement without a proof of rejection is treated as unverified.

## Method

Each uniqueness family is proven by the per-phase negative-test suites that ship as part of
the full database test suite. The complete suite on an empty rebuild is
**118 files / 1141 tests, all green (≈201 s)**. Each family's regression suite asserts both
the positive path (a valid distinct row is accepted) and the negative path (a duplicate is
rejected by the underlying `UNIQUE` / partial-unique / exclusion constraint). Enforcement is
constraint-level, so it holds regardless of the application path.

## Evidence — uniqueness families proven by negative tests

| #   | Uniqueness family                 | Rule enforced (negative test rejects the duplicate)                   | Result |
| --- | --------------------------------- | --------------------------------------------------------------------- | ------ |
| 1   | Tenant / company / branch codes   | Codes unique within their governing scope                             | Proven |
| 2   | VIN normalization                 | One normalized VIN per vehicle scope (case/format-normalized)         | Proven |
| 3   | One-open-visit                    | At most one open reception visit per vehicle (partial-unique)         | Proven |
| 4   | Display numbers                   | Per-tenant sequential display numbers are collision-free              | Proven |
| 5   | Service codes / SKUs              | Service codes and inventory SKUs unique within tenant scope           | Proven |
| 6   | Price-rule resolution             | A single winning price rule resolves (no ambiguous duplicate)         | Proven |
| 7   | Quotation revisions               | One issued revision per quotation lineage (single-issued)             | Proven |
| 8   | One-billable-invoice              | At most one billable invoice per work order / quotation revision      | Proven |
| 9   | Financial-event source uniqueness | Each financial event maps to exactly one immutable source fact        | Proven |
| 10  | Delivery completion               | At most one completed delivery per visit/work order                   | Proven |
| 11  | Warranty overlap                  | No overlapping active warranty for the same vehicle scope (exclusion) | Proven |
| 12  | Saved-filter ownership            | Saved-filter identity unique per owner                                | Proven |

All twelve families assert the negative path (duplicate/overlap **rejected**) inside the
1141-test suite; none rely solely on the positive path.

## Cross-reference

Check, exclusion, and state-guard families — money precision `NUMERIC(18,4)`,
maker ≠ approver, payer splits, effective intervals, born-draft, and immutability +
provenance guards — are covered separately in `check-exclusion-review-report.md`. Foreign-key
integrity is covered in `fk-review-report.md`.

## Status

**PASS.** All 12 documented uniqueness families have explicit negative-test evidence in the
1141-test suite (118 files, all green). Every forbidden duplicate/overlap is rejected at the
constraint layer. Zero unresolved Critical or High findings for this review.
