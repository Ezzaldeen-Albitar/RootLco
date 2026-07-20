# Phase 1-8 — Security Matrix (RLS / branch isolation / grants / classification)

## RLS + branch isolation

Every `apt`/`rec` table has RLS **enabled and forced**. Two policy shapes:

- **Branch-scoped business tables** — `sel`/`upd` `USING` and `ins` `WITH CHECK`:

  ```
  tenant_id = iam.current_tenant_id()
  AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
  AND (iam.allowed_branch_ids()  IS NULL OR branch_id  = ANY (iam.allowed_branch_ids()))
  ```

  `upd` `WITH CHECK` is tenant-only; company/branch are immutable via
  `org.guard_immutable_columns`. `NULL` allowed-lists mean full-tenant access.
  Branch ⊆ company ⊆ tenant is additionally FK-enforced (composite FK to
  `org.branches`), so isolation does not rely on RLS alone.

- **Dual-scope config catalogs** — `sel` visible when `scope='platform' OR
tenant_id = current`; `ins`/`upd` only `scope='tenant' AND tenant_id = current`
  (platform rows are admin-only and can never be claimed by a tenant).

## Grants

| Role           | Business tables        | Append-only ledgers | Config catalogs        |
| -------------- | ---------------------- | ------------------- | ---------------------- |
| `app_runtime`  | SELECT, INSERT, UPDATE | SELECT, INSERT      | SELECT, INSERT, UPDATE |
| `app_readonly` | SELECT                 | SELECT              | SELECT                 |
| `app_worker`   | — (no apt/rec grants)  | —                   | —                      |

**DELETE is granted to no application role on any `apt`/`rec` table** — deletion
is a soft-delete UPDATE, never a hard delete. Application roles are
`NOBYPASSRLS`. The `apt-rec-security.test.ts` suite auto-enumerates all 29 tables
and fails if any of these invariants regress.

## Sensitive-data classification

All 454 columns are classified in
`docs/database/apt-rec-personal-data-classification.json` and reconciled against
the live schema by `scripts/check-aptrec-classification.mjs` (CI + local). Four
columns are `restricted`, none `searchable`:

| Restricted column                               | Gate                                |
| ----------------------------------------------- | ----------------------------------- |
| `rec.complaint_details.complaint_text`          | `iam.sensitive.view` on sel/ins/upd |
| `rec.vehicle_content_details.item_description`  | `iam.sensitive.view`                |
| `rec.vehicle_content_details.declared_value`    | `iam.sensitive.view`                |
| `rec.vehicle_content_details.declared_currency` | `iam.sensitive.view`                |

Restricted payloads live in **separate 1:1 tables** whose whole read policy
requires `iam.sensitive.view`; the metadata parents stay readable in-scope. This
is genuine row-level gating, not a column-masking view. Operational
Vehicle-technical notes (condition/finding/leak/warning notes) are `internal` and
search-excluded — they are not personal data.

## Append-only enforcement

`apt.appointment_status_history`, `rec.reception_status_history`,
`rec.custody_history`, `rec.signatures`, `rec.refusals`, `rec.authorizations`
grant only SELECT + INSERT to the runtime (never UPDATE/DELETE); UPDATE/DELETE
raise `42501`. Status ledgers are trigger-emitted and coherence-guarded so a
caller cannot forge a transition the master did not make.
