# Phase 1-11 — Warranty Policy & Coverage Version Contract

**Requirement:** FR-WTY-001, BR-WTY-001 (terms effective at service date), P1-11-DB-015,
P1-OD-024. Owner-authorized technical self-review by Eng. Ezzaldeen Al-Bitar under the Solo
Developer Review Policy and the Standing Technical Authorization Policy — not an independent
third-party review.

## Policy identity + effective-dated coverage

- `wty.warranty_policies` — tenant/company-scoped policy identity: `policy_code`
  (`^[a-z][a-z0-9_]{1,62}$`; `uq_..._code` partial), `name`, `status` CHECK IN
  `('active','archived')`. **Structural only** — no warranty duration/odometer values are seeded
  (P1-OD-024).
- `wty.warranty_coverage` — the effective-dated **terms**: `policy_id` (composite FK →
  `wty.warranty_policies(tenant_id, company_id, id)`), `covered_scope` CHECK IN
  `('all','service','part')`, `duration_months` (>0), `odometer_limit` (optional, >0),
  `effective_from date`, `effective_to date` (nullable; `> effective_from`), `status` CHECK IN
  `('active','archived')`.

## No overlapping active coverage (M-wty-1)

`ex_warranty_coverage_no_overlap` is a gist `EXCLUDE` over `(tenant_id, company_id, policy_id,
covered_scope, daterange(effective_from, effective_to, '[)'))` `WHERE status='active' AND
deleted_at IS NULL` — active coverage for a policy+scope cannot overlap in time. Coverage is
immutable in its identity anchors (`org.guard_immutable_columns` freezes policy_id/effective_from
/scope).

## Backdating cannot change history

A newly-added coverage row is a **new** effective interval; because eligibility is evaluated by
the coverage effective at the original service/delivery date (see
[warranty-eligibility-contract](phase-1-11-warranty-eligibility-contract.md)), a backdated
coverage cannot retroactively change the interpretation of a warranty already issued at a past
date. Terms are tenant configuration; no default duration/odometer is invented (P1-OD-024).

**Tests:** `wty-warranty`.
