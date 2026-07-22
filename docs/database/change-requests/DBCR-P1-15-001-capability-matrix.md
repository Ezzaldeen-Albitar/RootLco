# DBCR-P1-15-001 — Table-by-table capability matrix

**Status:** Decided — this matrix is the specification migration 117 is written from ·
**Date:** 2026-07-22 ·
**Protected state analysed:** `origin/develop` `c7edc51`, database reset through all 116 migrations ·
**Method:** live catalog reads plus behavioural probes as the non-owner login `rootlco_test_runtime`
(`rolsuper=false`, `rolbypassrls=false`). Nothing was decided from `postgres`, which carries
`BYPASSRLS` and proves nothing about runtime behaviour.

---

## 1. Decision summary

| Table               | `app_runtime`                                                                | `app_worker`                                                                     | `app_readonly`     |
| ------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------ |
| `status_history`    | **none — withheld**                                                          | none                                                                             | SELECT (unchanged) |
| `status_evidence`   | **none — withheld**                                                          | none                                                                             | SELECT (unchanged) |
| `documents`         | INSERT (column-restricted)                                                   | none                                                                             | SELECT (unchanged) |
| `document_versions` | INSERT (column-restricted) + `UPDATE (status)`                               | none                                                                             | SELECT (unchanged) |
| `document_links`    | INSERT (column-restricted) + `UPDATE (deleted_at)`                           | none                                                                             | SELECT (unchanged) |
| `file_scan_results` | **none — hard security limit**                                               | **none**                                                                         | SELECT (unchanged) |
| `outbound_messages` | INSERT (column-restricted, enqueue only)                                     | `UPDATE (status, failure_class)`                                                 | SELECT (unchanged) |
| `delivery_attempts` | **none**                                                                     | INSERT (column-restricted)                                                       | SELECT (unchanged) |
| `message_templates` | INSERT + `UPDATE (name, description, active_version_id, status, deleted_at)` | none                                                                             | SELECT (unchanged) |
| `template_versions` | INSERT + `UPDATE (subject, body, content_hash, status, approved_by)`         | none                                                                             | SELECT (unchanged) |
| `search_metadata`   | **none — withheld**                                                          | INSERT + `UPDATE (normalized_value, classification, source_updated_at)` + DELETE | SELECT (unchanged) |
| `error_records`     | none                                                                         | **unchanged — already correct**                                                  | none               |
| `processed_events`  | none                                                                         | **unchanged — already correct**                                                  | none               |

`app_readonly` receives **no write capability of any kind**. No `DELETE` is granted to
`app_runtime` anywhere. No `TRUNCATE`, `REFERENCES`, or `TRIGGER` privilege is granted to any role.

## 2. The three deliberate withholdings

### 2.1 `status_history` / `status_evidence` — withheld as unsafe to grant

`shared.status_history` **cannot bind a transition to a business aggregate**, and the gap is
structural rather than a matter of privilege:

| Property                 | `shared.status_history`                                                                           | `wo.work_order_status_history` (the module pattern)                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Aggregate binding        | **no foreign key on `entity_id`** — the only FK is `fk_status_history_tenant` → `org.tenants(id)` | `FOREIGN KEY (tenant_id, company_id, branch_id, work_order_id)` → `wo.work_orders(...)` — composite and scope-carrying |
| `entity_type` vocabulary | `CHECK (btrim(entity_type) <> '')` only — no allow-list, enum, or reference table                 | n/a (the FK is the binding)                                                                                            |
| State vocabulary         | `CHECK (from_state IS DISTINCT FROM to_state)` only                                               | format-checked (`^[a-z][a-z0-9_]{1,62}$`)                                                                              |
| Coherence guard          | **none**                                                                                          | `tg_work_order_status_history_coherence`                                                                               |
| Scope columns            | none — no `company_id` / `branch_id`, so scope-aware authorization is not expressible             | present                                                                                                                |

Verified independently: `shared.status_history` carries exactly one non-internal trigger
(`tg_status_history_stamp`, which stamps `actor_id` and `occurred_at`), `shared.status_evidence`
carries **zero** triggers, and every module owns a coherence-guarded history table instead
(`apt`, `rec`, `wo` ×2, `dia`, `qms`, `veh`).

Granting `app_runtime` INSERT here would therefore create a writable transition log in which, inside
a single tenant, any holder could record a transition for **any** `entity_type`, **any** `entity_id`
(including an aggregate that does not exist or belongs to another module), to **any** `to_state`,
with no coherence check against the aggregate's real state. That is a falsification surface of the
same character as manufacturing a malware-scan verdict, and it is precisely the "generic unsafe
foreign-key-free workflow store" this remediation is forbidden to invent.

**Decision: withhold.** P1-15's status-transition service is an application-layer framework that
composes each module's own coherence-guarded, scope-bound history table — the pattern Phases 1-8 and
1-9 already established. Making the generic table safely writable needs an `entity_type` allow-list
and a binding mechanism, which is a schema change, not a grant. Recorded as a follow-on, not
smuggled in here.

### 2.2 `file_scan_results` — withheld as the hard security limit

A `scan_status = 'clean'` row is the **sole positive evidence**
`shared.guard_document_version_transition` accepts before allowing a version to become `accepted`.
The table has **zero triggers**, so an `infected` verdict could be silently rewritten with no guard
and no audit.

**Decision: no privilege of any kind, for any role.** Granting request code the ability to write its
own scan verdict would let the application manufacture the exact evidence the guard exists to
demand. `guard_document_version_transition` is not weakened in any way.

**Consequence, recorded honestly:** with no scanner in this phase, a document version **cannot reach
`accepted`**. P1-15 therefore delivers upload authorization and pre-acceptance lifecycle only, and
final acceptance is an explicit follow-on blocked on a scanning capability that does not exist. This
is a limitation, not a defect, and it is never described as implemented.

### 2.3 `search_metadata` — withheld from `app_runtime`, assigned to `app_worker`

Granting request code write access would make the stored normalized search expression
client-influenced. Projection maintenance is asynchronous derivation from a source aggregate, which
is worker work. Probing also proved two columns are **unguarded** by
`tg_search_metadata_immutable` — `id` and `locale_code` were both writable in a probe — so they are
excluded from the grant by the column list rather than trusted to a trigger.

## 3. Binding column-level rules (applied to every grant)

1. **Never** `updated_by`, `updated_at`, `record_version` — all stamped by
   `shared.touch_row_metadata()`. Naming a trigger-stamped column in an UPDATE raises `42501` before
   any row is touched (Phase 1-14 findings R-007 and R-010).
2. **Never** `tenant_id`, `company_id`, `branch_id` on any UPDATE — re-parenting.
3. **Never** immutable identity or provenance: `id`, `created_at`, `created_by`,
   `version_number`, `storage_key`, `sha256`, `template_id`.
4. **Never** guard-assigned timestamps: `approved_at`, `retired_at`, `queued_at`, `sending_at`,
   `sent_at`, `delivered_at`, `failed_at`, `cancelled_at`, `retry_count`, `accepted_at`,
   `quarantined_at`, `rejected_at`.
5. **Never** `documents.status`, `documents.legal_hold`, `documents.classification`,
   `documents.retention_class` — a legal hold is the absolute deletion blocker, and a classification
   downgrade is a data-exposure escalation.
6. **Never** `message_templates.scope` or a platform-scoped row: tenant runtime must be structurally
   unable to create or mutate a template every tenant can read.

## 4. Role separation rationale

- **`app_runtime`** receives only what an authenticated request must do synchronously: create
  document metadata and versions, link documents, enqueue a notification, administer tenant
  templates.
- **`app_worker`** receives only asynchronous processing: the outbound-message dispatch lifecycle,
  provider delivery evidence, and search projection maintenance. Worker policies are deliberately
  cross-tenant (`USING(true) WITH CHECK(true)`), matching the established `wkr_error_records_all` /
  `wkr_processed_events_all` pattern, because the worker drains every tenant's queue.
- Request code can therefore **never forge a delivery result** (`delivery_attempts` is worker-only,
  and `outbound_messages.status` is not grantable to `app_runtime`), and worker code is never an
  interactive request role.

## 5. Permission codes

The catalog has no shared-service codes. The migration's seed companion adds the minimum set as
structural platform reference data (idempotent, `ON CONFLICT (permission_code) DO NOTHING`,
tenant-neutral, no tenant role/user/business row). Template administration reuses the existing
`org.settings.manage` rather than minting a new code. Policies state explicitly whether they use
tenant-wide `iam.has_permission(text)` or scope-aware
`iam.has_permission_in_scope(text, uuid, uuid, uuid)`; Phase 1-14 proved the tenant-wide form is
unsafe where scope matters.

## 6. House-style constraints confirmed for migration 117

- `CREATE POLICY IF NOT EXISTS` is **not valid PostgreSQL** and appears nowhere in the 116
  migrations — it must not be used.
- Migrations 1–116 are immutable; CI fails the pull request on any `M`, `D`, or `R` under
  `supabase/migrations/`.
- No `SECURITY DEFINER` may be introduced — both existing suites assert the count is exactly 0.
- No `USING (true)` / `WITH CHECK (true)` on any `app_runtime` or `app_readonly` write policy —
  asserted negatively by existing tests. The worker exception is explicit and pre-existing.
- No `GRANT USAGE ON SCHEMA extensions` — rehearsed and rejected in migration `20260725090000`.
- Every `GRANT` needs a matching `REVOKE`, and every `CREATE POLICY` a matching `DROP POLICY`, in an
  explicit rollback section.
