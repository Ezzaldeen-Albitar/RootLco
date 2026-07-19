# Vehicle Shared-Services Contract (P1-07)

How the veh domain consumes the Phase 1-5 shared platform and the Phase 1-4
IAM context — nothing is duplicated, nothing bypassed.

## `shared.number_sequences` → Vehicle display numbers

- Allocation: `shared.next_display_number('vehicle')` at runtime, tenant from
  session context; concurrency-safe on the sequence row lock (QA-008 §1: two
  concurrent allocations → distinct numbers).
- Provisioning: the per-tenant `sequence_code='vehicle'` row is created by the
  **admin-side tenant-onboarding path** — never seeded (no tenant exists at
  seed time), never runtime-created.
- Honest gap semantics: a rolled-back transaction consumes a number; gaps are
  expected and documented — display numbers are human references, not audit
  sequence proofs.
- Uniqueness backstop: `uq_vehicles_active_display_number` (partial, per
  tenant, excludes soft-deleted).

## `shared.search_metadata` → Vehicle search projection

Runtime roles are SELECT-only; the backend/admin projection path (P1-15/17)
writes `entity_type='veh.vehicle'` rows per the field allow-list. Full
contract + PII exclusions: [veh-search-contract.md](../../database/veh-search-contract.md).
Executable proof: `tests/db/veh-search.test.ts`.

## `shared.documents` / `shared.document_links` → relationship evidence

`veh.relationship_evidence.document_id` is a composite same-tenant FK to
`shared.documents (tenant_id, id)`. The evidence row stores linkage + kind +
note only — never a payload copy. Document lifecycle (versions, scans,
retention, legal hold) stays entirely in the shared domain.

## IAM context and permissions

- Tenant scope: every policy is `tenant_id = iam.current_tenant_id()`
  (transaction-local `set_config`, default-deny when absent).
- Attribution: server stamps read `iam.current_user_id()` and RAISE when no
  actor is present (proven per ledger).
- Sensitive gate: `iam.has_permission('iam.sensitive.view')` gates
  restricted-classified `vehicle_identifiers` rows for SELECT/INSERT/UPDATE —
  the same single gate the CRM uses; no parallel mechanism was invented.
- Roles: `app_runtime` (read/write per grant matrix), `app_readonly`
  (SELECT-only), `app_worker` (NO veh access) — all NOBYPASSRLS, owning
  nothing.

## CRM consumption (party boundary)

- `crm.business_partners (tenant_id, id)` composite FKs from
  `ownership_history` / `vehicle_relationships`.
- `crm.resolve_partner_survivor(uuid)` inside `veh.owner_at` — returns the
  surviving partner **uuid only**; name/contact resolution stays behind CRM
  RLS (crown-jewel proof).

## What veh does NOT touch

`shared.event_outbox` / workers (no async pipeline in this phase),
`shared.message_templates` / outbound messaging, `iam.audit_*` (P1-16),
`shared.tags/notes/comments` (generic entity linkage is a later consumer
decision).
