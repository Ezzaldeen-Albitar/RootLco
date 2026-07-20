# P1-12 Evidence — Export-Permission Backend Contract

**Phase:** P1-12 — Release 2 Database Gate · **Wave 4.6 (Security stream).**
**Base:** protected `origin/develop` = `5cd16da` (P1-11 gate merge #45).
**Schema hash (sha256):** `d3b1e7e40a141152f8aff04cf582c02cffa43f8709adad936450c8019d3e4cdb`.

> **Governance / self-review note.** Owner-authorized technical, QA, security, and
> adversarial **self-review** by Eng. Ezzaldeen Al-Bitar under the Solo Developer Review
> Policy and the Standing Technical Authorization Policy. This is **not** an independent
> third-party audit.
>
> **DOCUMENT ONLY.** This is a forward specification of the backend contract that future
> export/report endpoints (backend Phase 1-23) MUST honour. **No backend, API, controller,
> repository, business logic, or migration is created by this document.** It records the
> permissions already registered in the schema and states the rules a backend must enforce.
> The user performs all merges.

## Objective

Audit every export / sensitive-read permission already registered in the database across
the P1-4…P1-11 catalog, and define the backend contract that governs how those permissions
gate interactive reads versus exports — so that the read gate cannot be silently widened
into an export bypass when the backend is built.

## 1. Registered export / sensitive-read gates (audit)

Source: `supabase/seeds/04_iam_permission_catalog.sql` (IAM permission catalog, 43
permissions; control total confirmed by the backup/restore drill) and the reporting-config
migration `20260724096000_rpt_reporting.sql`.

| Permission code      | Risk   | Registered  | Gates                                                 |
| -------------------- | ------ | ----------- | ----------------------------------------------------- |
| `rpt.export`         | high   | P1-11 (rpt) | Export of report data — audited downstream            |
| `sal.finance.view`   | high   | P1-11 (sal) | View financial amounts (invoices / receipts / events) |
| `sal.delivery.view`  | high   | P1-11 (sal) | View delivery signatures / receiver evidence          |
| `inv.cost.view`      | high   | P1-10 (inv) | View item / purchase / adjustment cost                |
| `iam.sensitive.view` | high   | P1-04 (iam) | View sensitive / restricted-classified data           |
| `iam.audit.view`     | medium | P1-04 (iam) | Read the audit trail                                  |

Supporting schema facts:

- **`rpt.report_configurations.export_permission_code`** is `NOT NULL` and a foreign key to
  `iam.permissions (permission_code)` with `ON DELETE RESTRICT`. Every report configuration
  therefore names the permission that gates its export downstream, and that permission
  cannot be deleted while referenced.
- **`iam.sensitive_data_permissions`** (P1-04-DB-011) separates the permission _kinds_
  `view`, `export`, and `mask_override` as **distinct**, effective-dated, non-overlapping
  grants per `(role, classification, kind)`. Per its own contract comment, **a `view`
  permission does not confer `export`.** Access is by permission, never by role name.

## 2. Backend contract (specification — to be enforced by Phase 1-23)

### 2.1 Interactive scope vs export scope

- **Interactive scope** — on-screen read of a bounded, RLS-filtered result set (a single
  record or a paged view). Governed by the relevant `*.view` read gate
  (`sal.finance.view`, `sal.delivery.view`, `inv.cost.view`, `iam.sensitive.view`,
  `iam.audit.view`).
- **Export scope** — materialization of a dataset for download / off-platform transfer
  (report extract, bulk dump, file). Governed **additionally** by an explicit **export**
  permission. Holding a `*.view` gate MUST NOT, by itself, authorize an export. This mirrors
  the `view` ≠ `export` distinction already enforced in
  `iam.sensitive_data_permissions.permission_kind`.

### 2.2 Required permission per operation

- Report export MUST require the `export_permission_code` named on the target
  `rpt.report_configuration` (today: `rpt.export`).
- Any export whose columns include financial amounts MUST additionally require
  `sal.finance.view`; delivery-evidence exports MUST additionally require
  `sal.delivery.view`; cost exports MUST additionally require `inv.cost.view`; audit-trail
  exports MUST additionally require `iam.audit.view`.
- **Sensitive-export permission.** Exporting any `restricted`/`secret`-classified column
  MUST require an `export`-kind grant in `iam.sensitive_data_permissions` for that
  classification — never a `view`-kind grant and never role membership. Where a column is
  masked interactively, its unmasked export MUST require `mask_override` in addition.

### 2.3 Audit requirement

- Every export MUST emit an audit event through the single audit writer `iam.audit_append`
  (per-tenant SHA-256 chain; see `audit-integrity-report.md`), recording actor, tenant /
  company / branch scope, permission(s) exercised, report configuration id (where
  applicable), row count, and classification of the columns exported.
- `rpt.export` is registered as **"Export report data (audited downstream)"** — the audit
  emission is a contract obligation of the export endpoint, not an optional add-on.

### 2.4 Tenant / company / branch ceiling

- An export MUST NOT exceed the caller's authorized tenant / company / branch scope, and
  MUST NOT exceed the scope of the underlying report configuration. RLS remains the floor
  (242/242 tables ENABLE + FORCE; runtime owns nothing); the export scope is a **ceiling**
  applied on top of RLS, never a way around it. A saved-filter or report scope may narrow,
  but never widen, the tenant/company/branch ceiling.

## 3. Boundary

No table, function, policy, grant, backend, API, or migration is added by this contract.
The registered permissions above already exist in the schema; the enforcement described in
§2 is scheduled for backend Phase 1-23 and is **not implemented here**.

## Status

**COMPLETE (documented, not implemented).** All export / sensitive-read gates registered in
the P1-4…P1-11 catalog are audited (6 gates + the `rpt` export-permission FK + the
`iam.sensitive_data_permissions` view/export/mask_override model), and the interactive-vs-
export contract — required permission, sensitive-export permission, audit requirement, and
tenant/company/branch ceiling — is defined for Phase 1-23. Scope boundary preserved: no
backend/API/logic created.
