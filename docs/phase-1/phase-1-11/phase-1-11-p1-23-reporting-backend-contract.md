# P1-23 (Reporting Backend) Data Contract

Phase 1-11 builds the reporting **configuration foundation** only. This document records what the
Phase 1-23 Documents / Notifications / Reporting backend inherits. **No report dataset, KPI
formula, or export backend is implemented in this phase.**

Owner-authorized technical self-review by Eng. Ezzaldeen Al-Bitar under the Solo Developer Review
Policy and the Standing Technical Authorization Policy — not an independent third-party review.

## What P1-23 may reference

| Concept                     | Source                                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| Report configuration        | `rpt.report_configurations` (`report_code`, `scope_level`, `owner_user_id`, `status`)           |
| Report version + parameters | `rpt.report_configuration_versions` (`version_number`, `parameter_schema`, published-immutable) |
| Export permission gate      | `rpt.report_configurations.export_permission_code` → `iam.permissions(permission_code)`         |
| User saved filters          | `rpt.saved_filters` (owner-only, `scope_level ≤ report scope`)                                  |
| Financial source facts      | `sal.financial_events` (immutable, provenance-guarded) + the amount tables (finance-gated)      |
| Outstanding balance         | `sal.invoice_open_receivable` / `sal.partner_outstanding_balance` (read-only derivations)       |

## Export gating (FR-RPT-003, BR-RPT-001, Table 3.10)

- **Per-report export permission.** P1-23 must check `export_permission_code` before exporting a
  report; the code is recorded in P1-11 and is an FK to a live `iam.permissions` row.
- **Export scope ≤ report scope.** DB-enforced coarsely (`guard_saved_filter_scope`); P1-23
  enforces the fine-grained jsonb subset (M-rpt-2).
- **Sensitive-financial export.** Amount payloads are gated by `sal.finance.view`; delivery
  identity evidence and signatures by `sal.delivery.view`. A report that projects these must carry
  the corresponding permission; sensitive exports are audited (FR-RPT-003).

## What P1-23 owns (not built here)

Report datasets, KPI definitions, the export renderer, notification delivery, and the audit of
each sensitive export. P1-11 provides only the configuration/versioning/saved-filter storage and
the permission-code anchors these will honour.
