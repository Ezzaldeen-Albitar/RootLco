# Phase 1-10 — Published-Version Immutability Contract

**Requirement:** BR-SVC-001 (a published price list is immutable; a change is a new
version). The same pattern governs `svc.service_versions` and `svc.price_list_versions`.

## Freeze on the version row

`guard_price_list_version_freeze` / `guard_service_version_freeze` (BEFORE UPDATE):
once `status IN ('published','archived')`, `effective_from` and `notes` are frozen; a
closed `effective_to` cannot change; `archived` is terminal; a `published` version may
only advance to `archived`. `org.guard_immutable_columns` additionally freezes
`tenant_id`, the list/service reference, `version_no`, and the audit anchor.

## Freeze on the child rows (INSERT/DELETE too — H13)

Row-level immutable-column guards only see UPDATE, so a parent-freeze guard covers
INSERT/UPDATE/DELETE:

- `svc.guard_price_rule_parent_frozen` on `svc.price_rules` — no rule may be inserted,
  edited, or deleted once its parent `price_list_version` is published/archived.
- `svc.guard_labor_time_parent_frozen` on `svc.standard_labor_times` — the same, for
  the service-version children.

This closes the "published-version child INSERT/DELETE" gap (review-response Medium,
H13): a published version's price surface is a closed set.

## Forward-only succession

A published version is never mutated in place to extend or replace it; the publish
functions (`svc.publish_price_list_version` / `svc.publish_service_version`) create
the succession by closing the prior version's `effective_to` forward and publishing a
new draft. The gist `EXCLUDE` remains the concurrency backstop against overlapping
published intervals.

## Downstream immutability

Because an issued `quo.quotation_revision` captures its amounts, republishing or
changing a price list has **no** effect on already-issued quotations (FR-SVC-004).

**Tests:** see the `svc` pricing suite in
[phase-1-10-test-catalog.md](phase-1-10-test-catalog.md).
