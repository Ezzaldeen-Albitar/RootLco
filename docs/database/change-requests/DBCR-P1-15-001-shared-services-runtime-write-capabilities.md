# DBCR-P1-15-001 — Shared-services runtime write capabilities

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Raised by:** Eng. Ezzaldeen Al-Bitar, during Phase 1-15 (Shared Services Backend) Wave 0 ·
**Date raised:** 2026-07-22 ·
**Status:** **Open — blocking P1-15 feature execution** ·
**Severity:** **High** — every mandatory P1-15 write capability is impossible against the protected
schema ·
**Protected state inspected:** `origin/develop` = `c7edc51`, `origin/main` = `8ca1da2`, 116 migrations ·
**Governance:** raised under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md);
this is owner-authorized technical self-review, never an independent third-party audit.

---

## 1. Summary

Phase 1-5 delivered the `shared` schema structures that Phase 1-15 must operate: documents, message
templates, outbound messages, status history, search metadata, and durable error records. It granted
the runtime role **`SELECT` only**, and created **`SELECT`-only RLS policies**, because at Phase 1-5
there was no application layer to write them and a write surface with no caller would have been an
ungoverned privilege.

Phase 1-15 is that application layer. **It cannot write anything.** Both enforcement layers deny it
independently:

- **Privilege layer** — `app_runtime` holds `SELECT` only (or nothing) on every target table.
- **Policy layer** — only `sel_*` `SELECT` policies exist for `app_runtime`; there is **no
  `INSERT`, `UPDATE`, or `DELETE` policy at all** on any target table. RLS is `ENABLE`d **and
  `FORCE`d**, so adding grants alone would still deny every write.

This is the same defect class as **DBCR-P1-13-001** (remediated by migration `20260725090000`) and
**DBCR-P1-14-001** (remediated by migration `20260726090000`): each backend phase discovers that the
capability its own operations need was never granted, because the database phase that created the
structures correctly declined to grant a write surface to a caller that did not yet exist.

## 2. Executable proof

Run as the login **`rootlco_test_runtime`** — a member of `app_runtime` with
`rolsuper = false`, `rolbypassrls = false`. Nothing here was executed as `postgres`, which carries
`BYPASSRLS` locally and would prove nothing.

```
insert into shared.<table> default values;
```

| Target table | Observed result |
| --- | --- |
| `shared.status_history` | `ERROR: permission denied for table status_history` |
| `shared.status_evidence` | `ERROR: permission denied for table status_evidence` |
| `shared.documents` | `ERROR: permission denied for table documents` |
| `shared.document_versions` | `ERROR: permission denied for table document_versions` |
| `shared.outbound_messages` | `ERROR: permission denied for table outbound_messages` |
| `shared.delivery_attempts` | `ERROR: permission denied for table delivery_attempts` |
| `shared.message_templates` | `ERROR: permission denied for table message_templates` |
| `shared.template_versions` | `ERROR: permission denied for table template_versions` |
| `shared.search_metadata` | `ERROR: permission denied for table search_metadata` |
| `shared.error_records` | `ERROR: permission denied for table error_records` |

All ten fail at the privilege layer with SQLSTATE `42501` before any constraint, trigger, or policy is
reached.

### 2.1 Current privilege state (`app_runtime`, `shared` schema)

`INSERT` exists on exactly two tables, both granted by the Phase 1-13 remediation:
`event_outbox` (`INSERT, SELECT`) and `idempotency_keys` (`INSERT, SELECT`).
Every other `shared` table is `SELECT` only. (`number_sequences` additionally carries the
column-restricted `UPDATE (next_value, current_period)` used by the allocator, which is a
column-level grant and therefore does not appear in table-level privileges.)

### 2.2 Correction — two tables are worker-owned by design, not gaps

The first probe in this change request queried `app_runtime` only, so `error_records` and
`processed_events` reported "no privilege" and were initially read as gaps. **That reading was
wrong**, and a probe across all three application roles corrects it:

| Table | Actual state |
| --- | --- |
| `shared.error_records` | `app_worker` holds `INSERT, SELECT, UPDATE`, policy `wkr_error_records_all` (`ALL`, `USING(true) WITH CHECK(true)`) |
| `shared.processed_events` | `app_worker` holds `INSERT, SELECT`, policy `wkr_processed_events_all` (`ALL`, `USING(true) WITH CHECK(true)`) |

Both are **deliberate worker-owned contracts that already work**. The deliberately cross-tenant
worker policy is the established pattern in this schema, because the worker drains every tenant's
queue. Neither table is a defect, and **neither requires any change in this remediation** unless the
capability analysis proves `app_runtime` has a legitimate synchronous need — which is not assumed.

The inverse case is a real gap: **`shared.delivery_attempts` grants `app_worker` nothing at all**
(only `app_runtime`/`app_readonly` `SELECT`), so the worker cannot record provider delivery
evidence. That gap belongs to the **worker**, not to ordinary request code — precisely because
ordinary request code must never be able to forge a delivery result.

This correction is recorded rather than quietly edited away: it is the reason the remediation is
designed from a table-by-table capability matrix with an explicit actor decision per table, instead
of granting `app_runtime` everything the first probe reported as denied.

### 2.2 Current policy state (target tables)

| Table | Policies for `app_runtime` |
| --- | --- |
| `status_history`, `status_evidence`, `documents`, `document_versions`, `document_links`, `outbound_messages`, `delivery_attempts`, `search_metadata` | `sel_*_tenant` — **SELECT only** |
| `message_templates`, `template_versions` | `sel_*_visible` — **SELECT only** |
| `error_records` | none for `app_runtime`; `wkr_error_records_all` (**ALL**) for `app_worker` only |

No write policy exists for the runtime role anywhere in this set.

## 3. Affected Phase 1-15 work

| P1-15 capability | Blocked table(s) | Correct actor |
| --- | --- | --- |
| Status-transition service (history append, evidence) | `status_history`, `status_evidence` | `app_runtime` (synchronous with the business transition) |
| Attachment authorization and pre-acceptance lifecycle | `documents`, `document_versions`, `document_links` | `app_runtime` |
| Notification **enqueue** | `outbound_messages` (initial insert) | `app_runtime` |
| Notification **dispatch + provider evidence** | `outbound_messages` (lifecycle), `delivery_attempts` | `app_worker` |
| Template management and versioning | `message_templates`, `template_versions` | `app_runtime`, permission-gated, tenant scope only |
| Search projection maintenance | `search_metadata` | to be decided by the capability matrix (`app_runtime` vs `app_worker`) |
| Durable error recording | `error_records` | **`app_worker` — already granted, no change required** |
| Consumer bookkeeping | `processed_events` | **`app_worker` — already granted, no change required** |

Number allocation, event publication, and idempotency are **not** blocked: the allocator's
column-restricted `UPDATE`, `event_outbox` `INSERT`, and `idempotency_keys` `INSERT` already exist.
Health, normalization (pure functions), pagination, filtering, sorting, and export **authorization**
are also unaffected because they perform no shared-table write.

**Five of the phase's mandatory service capabilities are impossible until this is remediated**
(status transitions, attachment lifecycle, notification enqueue, template administration, search
projection), plus one worker capability (`delivery_attempts`) that is required before any
notification can be dispatched.

### 3.1 A second gap — no shared-service permission codes exist

The permission catalog (`supabase/seeds/04_iam_permission_catalog.sql`, 43 codes across domains
`org`, `iam`, `svc`, `quo`, `inv`, `sal`, `wty`, `rpt`) contains **no code for any shared service**:
there is nothing for documents/attachments, notifications, or templates. The only adjacent codes are
`iam.sensitive.view` (already used by the `search_metadata` classification gate) and `rpt.export`.

A permission-gated write policy cannot be written against a permission code that does not exist, so
the remediation must also add the minimal shared-service codes as **structural platform reference
data** — the same idempotent, additive, tenant-neutral pattern every prior phase used
(`INSERT INTO iam.permissions (...) ... ON CONFLICT (permission_code) DO NOTHING`). Permission codes
are explicitly permitted structural reference data under the no-fake-data policy; no tenant role,
user, or business row is seeded.

Both `iam.has_permission(text)` and the scope-aware
`iam.has_permission_in_scope(text, uuid, uuid, uuid)` exist. Phase 1-14 proved the tenant-wide form
is unsafe for scope-sensitive delegation, so each write policy states explicitly which of the two it
uses and why.

## 4. Requested change (additive only)

A single **additive** migration that grants the runtime role the least privilege each P1-15 service
genuinely needs, and adds the matching RLS policies. Migrations `1–116` are **not** modified.

Binding constraints on the remediation, carried from the prior phases' findings:

1. **Least privilege, per operation.** Grant `INSERT` where a service appends, `UPDATE` only where a
   lifecycle transition is genuinely required, and `DELETE` only where a contract demands it. Tables
   whose contract is append-only (`status_history`, `status_evidence`, `delivery_attempts`,
   `file_scan_results`) receive **no `UPDATE` and no `DELETE`**.
2. **Never grant `updated_by` / `updated_at` / `record_version`.** These are stamped by
   `shared.touch_row_metadata()`. Phase 1-14 findings **R-007** and **R-010** were exactly this: an
   `UPDATE` statement that names a trigger-stamped column raises `42501` before any row is touched.
   Column-restricted `UPDATE` grants must exclude them.
3. **Every write policy is tenant-scoped** with `tenant_id = iam.current_tenant_id()` in both `USING`
   and `WITH CHECK`, so a write can never cross a tenant and can never move a row to another tenant.
4. **No `SECURITY DEFINER`.** The baseline is zero and must remain zero.
5. **No application role may gain** `BYPASSRLS`, superuser, `LOGIN`, or ownership of any relation.
6. **The database-enforced lifecycle guards remain authoritative.** The remediation grants the
   capability to attempt a transition; `guard_document_version_transition`,
   `guard_outbound_message_lifecycle`, `guard_template_version_lifecycle`,
   `guard_template_active_version`, and the scope guards continue to decide whether it is legal. The
   application layer must not be able to bypass them.
7. **Rollback-safe and re-runnable**, consistent with the migration standard.

### 4.1 Open sub-question — document acceptance and scanning

`shared.guard_document_version_transition` permits a version to become `accepted` **only** when a
`shared.file_scan_results` row with `scan_status = 'clean'` exists, and refuses if any row is
`infected`. Phase 1-15 is explicitly forbidden from implementing antivirus scanning or claiming a
malware control that does not exist.

The remediation therefore must **not** grant the runtime role the ability to write a `clean` scan
verdict for itself — that would let the application manufacture the very evidence the guard exists to
require, which is a falsification risk rather than a convenience. How document acceptance is reached
without a scanner is resolved as part of this change request and recorded honestly; until it is,
P1-15 delivers upload **authorization** and treats acceptance as gated on a scanning capability that
does not yet exist.

## 5. Disposition

Per the phase's database rule and the precedent set by DBCR-P1-13-001 and DBCR-P1-14-001, this
change is delivered on a **separate remediation branch and pull request**, reviewed and merged by the
repository owner **before** the P1-15 feature work proceeds. A security-sensitive privilege migration
is never placed quietly inside a feature branch.

The **P1-15 owner gate remains Pending** and is not affected by the merge of this remediation.

**Status: Open.** This record is updated to Resolved only after the remediation is merged into
protected `develop` and the capability is re-verified from the merged protected state as the runtime
role.
