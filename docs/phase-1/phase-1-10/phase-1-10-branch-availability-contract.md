# Phase 1-10 — Branch Availability Contract

**Table:** `svc.branch_service_availability`. A service is a tenant catalog entry;
**where** it is offered is recorded per branch.

## Structural controls

- **Branch ∈ company coherence:** the composite FK `(tenant_id, company_id, branch_id)
→ org.branches(tenant_id, company_id, id)` guarantees the branch belongs to the
  company; a second composite FK `(tenant_id, service_id) → svc.services(tenant_id,
id)` ties the offering to a real tenant service.
- **One offering per (scope, service):** `UNIQUE(tenant_id, company_id, branch_id,
service_id) WHERE deleted_at IS NULL`.
- **Archived-service block:** `guard_branch_availability_service_active` looks up the
  service `lifecycle_status`; an `archived` service cannot be newly made available
  (`is_available=true`) — raised as `check_violation`. A not-yet-published (but
  `active`) service is stageable, so availability can be prepared before a version is
  published (review-response Medium: service archival lifecycle).
- **Branch-scoped RLS:** the standard `tenant_id = current AND allowed_company_ids()
AND allowed_branch_ids()` clause; `company_id`, `branch_id`, `service_id` are
  immutable once set.

## Boundary

Availability records **offering intent only**. It does not carry pricing (that is
`svc.price_rules` resolved by `svc.resolve_price`) and it does not gate quotation item
selection at the database layer — that authorization is a P1-20 concern.

**Tests:** see the `svc` service-catalog suite in
[phase-1-10-test-catalog.md](phase-1-10-test-catalog.md).
