# Phase 1-9 — Security Matrix (RLS / branch isolation / grants / classification)

## RLS + branch isolation

Every `wo`/`tech`/`dia`/`qms` table has RLS **enabled and forced**. Three policy
shapes:

- **Branch-scoped business tables** — `sel`/`upd` `USING` and `ins` `WITH CHECK`:

  ```
  tenant_id = iam.current_tenant_id()
  AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
  AND (iam.allowed_branch_ids()  IS NULL OR branch_id  = ANY (iam.allowed_branch_ids()))
  ```

  `upd` `WITH CHECK` is tenant-only; company/branch and other immutable columns are
  frozen by immutable-column guards. `NULL` allowed-lists mean full-tenant access.
  Branch ⊆ company ⊆ tenant is additionally FK-enforced (composite FK to
  `org.branches`), so isolation does not rely on RLS alone.

- **Dual-scope config catalogs** — `sel` visible when `scope='platform' OR tenant_id
= current`; `ins`/`upd` only `scope='tenant' AND tenant_id = current` (platform
  rows are admin-only and can never be claimed by a tenant). The
  `work_order_states`/`job_states` flag CHECKs additionally forbid a tenant row from
  being terminal/closed/cancellation.

- **Restricted 1:1 payload tables** — the whole-table read/write policy additionally
  requires `iam.has_permission('iam.sensitive.view')` on `sel`/`ins`/`upd`.

## Grants

| Role           | Business tables        | Append-only ledgers | Config catalogs        |
| -------------- | ---------------------- | ------------------- | ---------------------- |
| `app_runtime`  | SELECT, INSERT, UPDATE | SELECT, INSERT      | SELECT, INSERT, UPDATE |
| `app_readonly` | SELECT                 | SELECT              | SELECT                 |
| `app_worker`   | — (no P1-09 grants)    | —                   | —                      |

**DELETE is granted to no application role on any `wo`/`tech`/`dia`/`qms` table** —
deletion is a soft-delete UPDATE, never a hard delete. Application roles are
`NOBYPASSRLS`. The `p1-09-security` suite auto-enumerates all 44 tables and fails if
any of these invariants regress. Only two functions carry
`GRANT EXECUTE TO app_runtime`: `tech.correct_labor_session` and
`qms.attempt_reopen`.

## Restricted-payload gating (3 tables)

Restricted attributes live in **separate 1:1 tables** whose whole read policy
requires `iam.sensitive.view`; the metadata parents stay readable in-scope. This is
genuine row-level gating, not a column-masking view. Each restricted column is
`classification='restricted'` (immutable):

| Restricted column                                          | Gate                                | Note                                                  |
| ---------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------- |
| `tech.technician_certification_details.certificate_number` | `iam.sensitive.view` on sel/ins/upd | Operational cert (type/issue/expiry) stays `internal` |
| `wo.additional_work_request_details.description`           | `iam.sensitive.view`                | Customer-facing narrative                             |
| `qms.rework_link_details.rework_cost`                      | `iam.sensitive.view`                | Cost-of-quality KPI — **not** a billing artifact      |

`rework_cost` is retained as an internal quality KPI (design finding F11); no billing
table is created in this phase. Operational technician fields (labor-derivable, home
branch, trade) are `internal` and search-excluded — not personal data.

## Append-only enforcement (8 ledgers)

The following ledgers grant only SELECT + INSERT to the runtime (never
UPDATE/DELETE); UPDATE/DELETE raise `42501`:

`wo.work_order_status_history`, `wo.job_status_history`,
`wo.customer_approval_evidence`, `dia.diagnostic_report_status_history`,
`dia.diagnostic_evidence`, `dia.diagnostic_reviews`, `qms.qc_status_history`,
`qms.reopen_attempts`.

Status ledgers are trigger-emitted and coherence-guarded so a caller cannot forge a
transition the master did not make. Evidence ledgers bind an **exact immutable
`shared.document_versions`** row; possession of a document id grants no access.
`qms.reopen_attempts` records rejected reopen attempts via `qms.attempt_reopen`,
which never mutates the work order.

## Function security

All 27 functions are `SECURITY INVOKER` with `SET search_path = ''` and
`REVOKE EXECUTE FROM PUBLIC`; none is `SECURITY DEFINER`. A `SECURITY INVOKER`
function runs with the caller's RLS, so a function cannot be used to bypass branch
isolation.

## Classification summary

All 657 columns are classified in
`docs/database/wo-tech-dia-qms-personal-data-classification.json` (taxonomy
`public`/`internal`/`restricted`/`secret`) and reconciled against the live schema by
`scripts/check-wo-tech-dia-qms-classification.mjs` (CI + local). The validator fails
on a missing, stale, duplicate, invalid, restricted-searchable, or type-drifted
entry. **3 columns are `restricted`, 0 are restricted-searchable.** The check is
wired to `package.json` (`validate:wo-tech-dia-qms-classification`) and to
`.github/workflows/ci.yml` after the apt/rec classification step.
