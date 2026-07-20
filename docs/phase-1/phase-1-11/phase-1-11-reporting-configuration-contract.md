# Phase 1-11 — Reporting-Configuration Contract

**Requirement:** FR-RPT-001…004, P1-11-DB-018, DEP-11. Owner-authorized technical self-review by
Eng. Ezzaldeen Al-Bitar under the Solo Developer Review Policy and the Standing Technical
Authorization Policy — not an independent third-party review.

## Configuration foundation only (no datasets/KPIs)

`rpt` builds only the **configuration foundation** — no report datasets, KPI formulas, or export
backend (DEP-11, deferred to P1-23).

- `rpt.report_configurations` — tenant-scoped: `report_code` (`^[a-z][a-z0-9_]{1,62}$`;
  `uq_..._code` partial; `uq_..._id (tenant, id)`), `name`, `scope_level` CHECK IN
  `('branch','company','tenant')`, `export_permission_code` (FK → `iam.permissions(permission_
code)` RESTRICT), `owner_user_id`, `status` CHECK IN `('draft','published','archived')`.
- `rpt.report_configuration_versions` — monotonic per config: `report_configuration_id`
  (composite FK → `rpt.report_configurations(tenant_id, id)`), `version_number` (>=1;
  `uq_..._number`), `parameter_schema jsonb`, `status` CHECK IN `('draft','published')`,
  `published_at`.

## Published version is immutable

`uq_report_configuration_versions_published` (partial unique `WHERE status='published'`) — at
most **one published version** per config. `rpt.guard_report_version_freeze` (BEFORE UPDATE)
freezes a published version; `org.guard_immutable_columns` freezes
`report_configuration_id`/`version_number`/audit anchors.

## Export permission recorded for P1-23

`export_permission_code` maps each report to the permission that gates its export downstream
(FR-RPT-003, BR-RPT-001, Table 3.10 sensitive-export row). No export is performed in P1-11; the
code is recorded for the P1-23 reporting backend. Saved-filter isolation and the export scope
ceiling are in
[phase-1-11-saved-filter-ownership-contract.md](phase-1-11-saved-filter-ownership-contract.md).

**Tests:** `rpt-reporting`.
