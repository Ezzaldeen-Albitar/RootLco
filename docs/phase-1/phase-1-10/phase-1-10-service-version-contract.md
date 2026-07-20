# Phase 1-10 — Service Version Contract

**Requirement:** FR-SVC-001 (stable service identity), FR-SVC-002 (versioned pricing
by effective interval). All controls are structural (constraints, triggers, an
`EXCLUDE`), not deferred to a backend.

## Stable identity

`svc.services(tenant_id, id)` is the stable service identity. `service_code` is
immutable (`org.guard_immutable_columns('tenant_id','service_code','created_at',
'created_by')`) and tenant-unique. Service identity **never changes** across
descriptive or pricing revisions — a change is a new `svc.service_versions` row, not a
new service. Services are tenant-scoped (a catalog entry); branch offering is a
separate concern (`svc.branch_service_availability`).

## Category hierarchy

`svc.service_categories(tenant_id, id, parent_category_id)` is a self-referencing
hierarchy. `svc.guard_service_category_no_cycle` rejects self-parenting and any cycle,
serialized per tenant with `pg_advisory_xact_lock(hashtext('svc.service_categories:'
|| tenant_id))` so two concurrent re-parents cannot each miss the other's uncommitted
change (Medium: hierarchy cycle races).

## Effective-dated versions and succession (H1)

`svc.service_versions(service_id, version_no, effective_from, effective_to, status)`:

- `version_no` is monotonic and unique per service; `status` is `draft` →
  `published` → `archived`.
- A gist `EXCLUDE` (`daterange(effective_from, effective_to, '[)')` `&&`, `WHERE
status='published' AND deleted_at IS NULL`) forbids two **published** versions of
  the same service from overlapping in time.
- A published/archived version is frozen — `guard_service_version_freeze` blocks
  changes to identity, `effective_from`, and `notes`; a closed `effective_to` cannot
  change; a published version may only advance to `archived`.
- **Succession** is `svc.publish_service_version(service_id, version_id,
effective_from)`: under a per-service `FOR UPDATE` lock it closes the prior open
  published version's `effective_to` to the new `effective_from` (the only permitted
  NULL→date mutation) and flips the draft to `published`. This resolves the
  freeze-vs-closure collision (review-response H1).

Current version = the published version whose `[effective_from, effective_to)`
interval contains the as-of date.

## Lifecycle

`svc.services.lifecycle_status` is `active`|`archived`; `guard_service_lifecycle`
makes `archived` terminal and stamps `archived_at`. An archived service cannot be
newly made available at a branch (see
[phase-1-10-branch-availability-contract.md](phase-1-10-branch-availability-contract.md)).

## Standard labor time

`svc.standard_labor_times(service_version_id, standard_minutes NUMERIC(10,2) CHECK >
0)` is positive and versioned with the service version; frozen against
INSERT/UPDATE/DELETE once the parent version is published
(`guard_labor_time_parent_frozen`).

**Tests:** see the `svc` service-catalog suite in
[phase-1-10-test-catalog.md](phase-1-10-test-catalog.md).
