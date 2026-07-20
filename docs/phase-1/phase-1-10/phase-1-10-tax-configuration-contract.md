# Phase 1-10 — Tax Configuration Contract

**Requirement:** FR-SVC / P1-OD-007 (jurisdiction/currency/tax kept configurable). No
new tax table is created; **no hard-coded jurisdiction or rate** is invented.

## Reuse, not duplication

Tax reuses the existing `org` tables:

- `org.tax_classes(tenant_id, company_id, id)` — the tax class.
- `org.tax_rates` — the effective-dated `NUMERIC(9,6)` fraction (with its own
  no-overlap `EXCLUDE`).

`svc.price_rules.tax_class_id` is a nullable composite FK `(tenant_id, company_id,
tax_class_id) → org.tax_classes(tenant_id, company_id, id)`. A CHECK
(`ck_price_rules_tax_needs_company`) enforces `company_id IS NOT NULL OR tax_class_id
IS NULL`: a tenant-wide rule (no company) leaves `tax_class_id` NULL, avoiding a
dangling tax class where the company is unknown (review-response Medium).

## Capture at quotation

Tax binds when the company is known — at quotation capture. `quo.quotation_items`
captures the resolved `captured_tax_rate NUMERIC(9,6)` and `captured_tax_amount
NUMERIC(18,4)` with the arithmetic CHECK `captured_tax_amount = round((unit*qty -
discount) * rate, 4)`. Historical interpretation is preserved because the rate is
captured, not re-derived, so a later `org.tax_rates` change never alters an issued
quotation.

## Configuration boundary (P1-OD-007)

Rates and classes are configuration owned by `org`; each company states its own
jurisdiction/rates via `org.tax_*`. P1-10 stores the linkage and the captured values,
not any policy. See [phase-1-10-open-decisions.md](phase-1-10-open-decisions.md).

**Tests:** covered by the `svc` pricing and `quo` capture suites in
[phase-1-10-test-catalog.md](phase-1-10-test-catalog.md).
