# Phase 1-9 — Domain Contracts

Consolidated statement of the invariants each domain enforces at the database layer.
All are structural (constraints, triggers, RLS), not deferred to the backend.

## Reception-origin contract

A work order originates from **exactly one** Phase 1-8 reception visit, referenced by
the branch-scoped candidate key:

```
FOREIGN KEY (tenant_id, company_id, branch_id, reception_visit_id)
  REFERENCES rec.reception_visits (tenant_id, company_id, branch_id, id)
```

- **Preconditions at insert (guard `wo.guard_work_order_refs`):** the visit's
  `reception_status` is `authorized` or `converted`, it has accepted custody
  (`rec.custody_history` `accepted`), and an approved `rec.authorizations` row exists.
- **One ordinary WO per reception origin:** a partial-unique index blocks a **second
  `ordinary`** work order per reception visit (`WHERE kind='ordinary' AND deleted_at
IS NULL`). A `rework` work order (`kind='rework'`) reuses the original reception
  visit and is exempt.
- **Vehicle coherence lock (design finding F13):** `vehicle_id` is resolved **through**
  the visit and re-stored only under a coherence guard that runs on INSERT and UPDATE
  (it must equal the visit's Vehicle); it is in the immutable-columns guard and can
  never diverge.
- **Reference, never copy:** complaints, inspection findings, custody, authorization,
  and party roles remain owned by `rec`/`veh`/`crm`; the work order references them
  (P1-08 → P1-09 structural contract). The work order carries a `parts_forward_state`
  text contract field (default `none`, CHECK-constrained) for P1-10/P1-11 — never a
  dangling foreign key.

## Technician-privacy matrix

`tech.technician_profiles` references the app identity anchor via
`FOREIGN KEY (tenant_id, user_id) REFERENCES iam.user_accounts (tenant_id, id)` and
stores **operational data only**.

| Referenced / stored (operational)                       | **Never** duplicated in `tech` |
| ------------------------------------------------------- | ------------------------------ |
| Identity anchor (`iam.user_accounts` FK)                | Salary / compensation          |
| Home branch, trade/discipline, active flag              | Government IDs                 |
| Held skills / skill levels                              | Personal contact details       |
| Operational certifications (type, issue/expiry, status) | Medical data                   |
| Availability windows, labor sessions                    | Payroll data                   |

Certificate numbers are **restricted**: they live in the 1:1
`tech.technician_certification_details` table (RLS-gated by
`iam.has_permission('iam.sensitive.view')`, `classification='restricted'` immutable),
while the operational `tech.technician_certifications` stays `internal` so
eligibility/expiry queries run without the sensitive permission (design finding F11).
Labor-time and performance-derivable fields are `internal`, visible only in scope.

## Labor-session contract

`tech.labor_sessions` binds `(tenant, company, branch, technician_profile_id, job_id,
started_at, ended_at NULL, …)`:

- **≤ 1 active session per technician** and **no overlap** — a gist `EXCLUDE`
  (`tstzrange(started_at, coalesce(ended_at,'infinity'))`) over non-deleted rows;
  a concurrent overlap loses with `23P01`.
- **End after start** (`CHECK`), `ended_at` **write-once**.
- **No backdating beyond the contract window** (guard).
- **No labor on a terminal work order** — a parent-lock guard rejects a start when the
  parent WO is `is_closed` (design finding F2 serialization).
- **Corrections** are content-immutable: `tech.correct_labor_session` soft-deletes the
  original and inserts a linked correction in one transaction (design finding F9).

## Additional-work and approval contract

- `wo.additional_work_requests`: `state`
  (`pending`/`approved`/`rejected`/`withdrawn`) + self-contained `fulfillment_state`
  (`unfulfilled`/`fulfilled`/`waived`, design finding F7). A **required** request that
  is `pending`, or `approved` and `unfulfilled`, blocks closure (B3).
- `wo.additional_work_request_details`: restricted 1:1 customer-facing description,
  gated by `iam.sensitive.view`.
- `wo.customer_approvals`: an **immutable** decision binding the deciding
  `rec.reception_party_roles` role, channel, decision time, and the presented scope
  snapshot, with an opaque `quotation_revision_ref` forward field (no FK — P1-10 does
  not exist).
- `wo.customer_approval_evidence`: append-only, binding an **exact immutable
  `shared.document_versions`** row; no substitution. **No quotation or item table is
  created in this phase.**

## Diagnostic template / version / evidence contract

- `dia.inspection_templates` → `dia.template_versions`
  (`draft→published→retired`) → `dia.template_items`. A **published** version and its
  items are **frozen** (design finding F3); mutation is possible only while `draft`.
- `dia.diagnostic_reports` pin an **exact published** template version; changing the
  template makes a new version, never mutating a referenced one. Status is
  `draft→in_progress→completed`/`cancelled`; a report cannot reach `completed` while a
  mandatory `template_item` has neither a result nor a documented not-applicable
  (completion gate).
- `dia.findings` (constrained severity/disposition), `dia.measurements` (unit
  required), `dia.dtc_records` (OBD-II code format), `dia.recommendations`.
- `dia.diagnostic_evidence` binds an exact `shared.document_versions` row (append-only,
  no replacement); `dia.diagnostic_reviews` are append-only with a server-stamped
  reviewer. **Export/access posture:** object-id possession grants no access; a future
  read/export surface derives from the linked business record and an explicit
  permission.

## QC and rework contract (BR-QMS-001)

- `qms.qc_checks` (dual-scope; `is_mandatory`, `is_safety_critical`) →
  `qms.quality_control_records` (`overall_result` pending/passed/failed; finalized
  result frozen, design finding F10) → `qms.qc_check_results`.
- **BR-QMS-001:** a safety-critical rework requires **independent** sign-off. On
  `qms.rework_links`, `lead_technician_id` (the correcting technician) is stored
  immutably and `independent_sign_off_by` must differ from it — the lead/correcting
  technician may not be the sole final approver (design finding F4). A guard rejects
  `independent_sign_off_by = lead_technician_id`.
- `qms.rework_link_details` holds the restricted `rework_cost` cost-of-quality KPI
  (gated) — **not** a billing artifact.
- **BR-WO-002:** a closed work order never reopens. Corrective work is a linked
  `rework` work order; `qms.attempt_reopen` records a rejected `qms.reopen_attempts`
  row and never mutates the WO; the terminal-freeze trigger hard-blocks any direct
  UPDATE out of a terminal state.
