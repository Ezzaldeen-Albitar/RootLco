# Phase 1-6 → Phase 1-7 Structural Contract

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-6 — CRM and Business Partner Database · **Date:** 2026-07-19

Phase 1-7 and every later CRM consumer build on a small, deliberately stable
subset of the `crm` schema. This document states that contract in prose; it is
enforced by [`tests/db/crm-structural-contract.test.ts`](../../../tests/db/crm-structural-contract.test.ts)
(8 assertions), so a change that would break the contract fails the build. The
exhaustive object list lives in [`foundation.test.ts`](../../../tests/db/foundation.test.ts)
and the [object inventory](./crm-object-inventory.md); this contract is the
narrower promise the next phase may rely on.

## 1. Party master

`crm.business_partners` is the single root of the CRM graph. A consumer may bind
to these columns, whose presence is asserted by the contract test:

- `id` — partner identity (part of the composite tenant candidate key).
- `tenant_id` — tenant scope; present on every CRM table.
- `party_type` — discriminator (`individual` / `company`).
- `lifecycle_status` — `active` / `blocked` / `merged` (see the
  [party & role taxonomy](./crm-party-role-taxonomy.md)).
- `display_number` — tenant-unique, concurrency-safe human reference.
- `merged_into_id` — redirect to the surviving partner after a merge.
- `created_by` — the acting user (attribution).

## 2. Profile exclusivity

`crm.individual_profiles` and `crm.company_profiles` each exist and key on
`(tenant_id, partner_id)`. A partner has exactly the profile matching its
`party_type`, enforced by the `(tenant_id, id, party_type)` discriminator key.
Consumers resolve a partner's profile by joining on `(tenant_id, partner_id)`.

## 3. Sensitive-data gate

The classification registry
([`crm-personal-data-classification.json`](../../database/crm-personal-data-classification.json))
plus its CI guard (`scripts/check-crm-classification.mjs`, DO-001) is the single
source of truth for personal-data classification. The database-layer gate is
row-level `iam.has_permission('iam.sensitive.view')` evaluated against a
`classification` column — there is **no** column-masking view or function. The
contract test asserts the structural precondition: restricted-bearing tables
(`partner_identifiers`, `partner_sensitive_attributes`) expose a `classification`
column for the gate to read. Consumers must request sensitive data through the
gate; they must not add a parallel masking mechanism.

## 4. Stable functions

These functions are part of the contract and are asserted to exist, all
`SECURITY INVOKER` with `search_path = ''`:

- `resolve_partner_survivor(...)` — follow the merge redirect to the live partner (consumer-callable).
- `current_consent(...)` — the latest effective consent decision (deterministic via `seq`; consumer-callable).
- `partner_roles_active_at(...)` — roles active on a given date (consumer-callable).
- `normalize_name` / `normalize_email` / `normalize_phone` — deterministic, Arabic-safe search-key normalization (consumer-callable).
- `emit_timeline_event()` — the **only** writer into the append-only timeline. It is a
  trigger function fired `AFTER INSERT` on the six source tables (status/consent/block
  history, alerts, merges, communication log); consumers do **not** call it directly
  (`EXECUTE` is revoked from `PUBLIC`). Timeline rows appear automatically, in the same
  transaction as their source change.

## 5. Security posture (invariants)

- **Every** `crm` base table has `ENABLE` + `FORCE ROW LEVEL SECURITY`.
- The application roles `app_runtime`, `app_readonly`, `app_worker` are
  `NOBYPASSRLS` and non-superuser, and own no `crm` table.
- **No** `crm` function is `SECURITY DEFINER`.

## 6. What is explicitly NOT promised here

The application-layer write-path invariants deferred from this database phase are
**not** part of the structural contract and will be delivered by later phases:
identifier-type correctness enforcement, lifecycle-transition orchestration, and
the forensic audit trail (`iam.audit_append`, Phase 1-16). See the
[target data model](./crm-target-data-model-phase-1-35.md) and the
[completion report](./phase-1-6-completion-report.md) known-limitations section.
Consumers must not assume these exist at the database layer in Phase 1-6.
