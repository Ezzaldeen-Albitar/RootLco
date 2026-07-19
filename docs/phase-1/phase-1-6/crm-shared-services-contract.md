# CRM Shared-Services Integration Contract — Phase 1-6

**Company:** RootLco — Root Link Company
**Product:** [PRODUCT NAME — Pending Final Approval]
**Phase:** 1-6 — CRM and Business Partner Database
**Branch:** `feature/p1-06-crm-business-partner-database` (base `develop` @ `cd475d3`)
**Owner gate:** **Pending** — the feature PR is not yet open or merged.
**Authorization:** Authored under the [Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md); the closeout review is owner-authorized technical/security self-review, not independent review.

## Purpose

This document records how the `crm` schema **consumes** the pre-existing `org`, `iam`, and
`shared` foundations. It is a dependency contract, not a re-specification of those schemas.
Every dependency listed below was found by grepping and reading the 15 Phase 1-6 migrations
(`20260719090000`–`20260719104000`); nothing here is inferred. For the full object set see
[crm-object-inventory.md](./crm-object-inventory.md); for the row-security surface see
[crm-rls-policy-matrix.md](./crm-rls-policy-matrix.md) and [crm-grant-matrix.md](./crm-grant-matrix.md);
for the classification surface see [crm-classification-matrix.md](./crm-classification-matrix.md);
and for the entity relationships see the ERD at [../../database/erd/phase-1-6-crm.mmd](../../database/erd/phase-1-6-crm.mmd).

## 1. `org` — tenant scoping

Every one of the 21 `crm` tables carries a `tenant_id` and binds it to the tenant registry with a
single-column foreign key:

```
FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT
```

`ON DELETE RESTRICT` means a tenant cannot be removed while it still owns `crm` rows — deletion is
refused at the database layer rather than cascading through customer data. Co-tenancy of related
rows is then structurally enforced _within_ `crm`: parent tables expose composite candidate keys
`UNIQUE (tenant_id, id)` and children reference them with composite FKs
`(tenant_id, parent_id) REFERENCES parent (tenant_id, id)`, so a child row can never point at a parent
belonging to a different tenant. Tenant immutability is protected by the reused trigger
`org.guard_immutable_columns(...)`, installed `BEFORE UPDATE` on `crm` tables to freeze
`tenant_id` (together with columns such as `party_type`, `created_at`, and `created_by`) — a row
cannot be moved across tenants after creation.

The runtime enforcement of tenant scope is Row-Level Security: every `crm` policy keys its
`USING` / `WITH CHECK` predicate on `iam.current_tenant_id()` (see Section 2 and the RLS matrix).
All 21 tables run `ENABLE` + `FORCE ROW LEVEL SECURITY` with default-deny, so `org.tenants` provides
the identity that RLS filters on but the filtering itself is an `iam` primitive.

## 2. `iam` — request context and the sensitive-data gate

`crm` consumes three `iam` primitives, all by **function call** (there is no FK from any `crm` table
into an `iam` table):

- **`iam.current_tenant_id()`** — request tenant context. It appears in the `USING` and
  `WITH CHECK` clause of every `crm` RLS policy; it is the sole tenant discriminator.
- **`iam.current_user_id()`** — the acting user. It is server-stamped into user-attribution columns
  rather than being trusted from the client: `consent_history.recorded_by`, `partner_merges.merged_by`
  (via `stamp_partner_merge`), `timeline_events.actor_id` (via `emit_timeline_event`), and the
  `actor_id` of `partner_status_history` / `customer_block_history` (via `shared.stamp_status_history`).
  These stamping paths `RAISE` when the current user is `NULL`, so an unattributed history row cannot
  be written. Note that these columns are `uuid` values captured from `iam.current_user_id()`; they
  are **not** FK-constrained to an `iam` user table — user-existence verification is a Phase-1-16
  write-path concern, not a DB-layer FK in this phase.
- **`iam.has_permission('iam.sensitive.view')`** — the **only** sensitive-data primitive in `crm`.
  There is no column-masking view or function anywhere in the schema. Restricted data is gated at the
  row level in exactly two places:
  - `crm.partner_identifiers` — restricted rows are visible only to a session that holds the
    permission:
    `USING (tenant_id = iam.current_tenant_id() AND (classification = 'internal' OR iam.has_permission('iam.sensitive.view')))`.
  - `crm.partner_sensitive_attributes` — the entire table (e.g. `date_of_birth`) is gated:
    `USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('iam.sensitive.view'))`.

  A session without the permission simply does not see the restricted rows; the restriction is not a
  masked column value. Restricted scope is national-id / registration / tax identifiers plus date of
  birth (see [crm-classification-matrix.md](./crm-classification-matrix.md) and
  [../../database/crm-personal-data-classification.json](../../database/crm-personal-data-classification.json)).

## 3. `shared` — reference data and reused triggers

`crm` consumes `shared` in two ways: as reference data referenced by FK, and as reused trigger
functions.

**Reference data (consumed by FK, never copied into `crm`):**

- `individual_profiles.preferred_locale` and `communication_preferences.preferred_locale` →
  `shared.languages (locale_code)` `ON DELETE RESTRICT`.
- `customer_credit_profiles.currency_code` → `shared.currencies (code)` `ON DELETE RESTRICT`.
- `consent_history` consent-evidence reference → `shared.documents (tenant_id, id)` `ON DELETE RESTRICT`
  (composite, same-tenant; consent points at a stored document rather than inlining PII).
- `communication_log` → `shared.outbound_messages (tenant_id, id)` `ON DELETE RESTRICT` (composite,
  same-tenant).

**Reused trigger functions (not re-implemented in `crm`):**

- `shared.touch_row_metadata()` — `BEFORE UPDATE` metadata stamping, installed on the mutable `crm`
  tables.
- `shared.stamp_status_history()` — reused **verbatim** as the `BEFORE INSERT` stamp on the two
  append-only lifecycle tables `partner_status_history` and `customer_block_history`; `crm` does not
  write its own status-stamping logic.

**Display-number allocation:** `crm.business_partners.display_number` is allocated with
`shared.next_display_number` (migration `0003`). Per the `business_partners` migration header this is
invoked by the backend/provisioning write-path, **not** by the DDL — the column ships nullable and is
populated at runtime, so it is a documented shared-service dependency rather than a call site inside
the migration.

## 4. Cross-schema dependency table

Only dependencies actually found in the migrations are listed. "Function call" means invoked in a
policy predicate, trigger body, or write path; "FK" means a foreign-key constraint.

| CRM object                                                                                                             | Depends on                                 | Mechanism                                 | On-delete  |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------- | ---------- |
| All 21 `crm` tables (`tenant_id`)                                                                                      | `org.tenants (id)`                         | FK (single column)                        | `RESTRICT` |
| Mutable `crm` tables (`BEFORE UPDATE`)                                                                                 | `org.guard_immutable_columns(...)`         | Function call (trigger)                   | n/a        |
| Mutable `crm` tables (`BEFORE UPDATE`)                                                                                 | `shared.touch_row_metadata()`              | Function call (trigger)                   | n/a        |
| `partner_status_history` (`BEFORE INSERT`)                                                                             | `shared.stamp_status_history()`            | Function call (trigger, reused)           | n/a        |
| `customer_block_history` (`BEFORE INSERT`)                                                                             | `shared.stamp_status_history()`            | Function call (trigger, reused)           | n/a        |
| `individual_profiles.preferred_locale`                                                                                 | `shared.languages (locale_code)`           | FK                                        | `RESTRICT` |
| `communication_preferences.preferred_locale`                                                                           | `shared.languages (locale_code)`           | FK                                        | `RESTRICT` |
| `customer_credit_profiles.currency_code`                                                                               | `shared.currencies (code)`                 | FK                                        | `RESTRICT` |
| `consent_history` (evidence document)                                                                                  | `shared.documents (tenant_id, id)`         | FK (composite)                            | `RESTRICT` |
| `communication_log` (source message)                                                                                   | `shared.outbound_messages (tenant_id, id)` | FK (composite)                            | `RESTRICT` |
| `business_partners.display_number`                                                                                     | `shared.next_display_number` (0003)        | Function call (backend/provisioning path) | n/a        |
| Every `crm` RLS policy                                                                                                 | `iam.current_tenant_id()`                  | Function call (RLS predicate)             | n/a        |
| `partner_identifiers` (restricted rows)                                                                                | `iam.has_permission('iam.sensitive.view')` | Function call (RLS predicate)             | n/a        |
| `partner_sensitive_attributes` (whole table)                                                                           | `iam.has_permission('iam.sensitive.view')` | Function call (RLS predicate)             | n/a        |
| `consent_history.recorded_by`, `partner_merges.merged_by`, `timeline_events.actor_id`, status/block history `actor_id` | `iam.current_user_id()`                    | Function call (server-stamp)              | n/a        |

## 5. What `crm` does NOT depend on or duplicate

- **No forensic audit call.** `crm` does not invoke `iam.audit_append`; that grant is not held by the
  app roles, and the forensic audit trail is Phase-1-16 backend work. The DB-layer attributable record
  in this phase is the append-only history and timeline tables (`partner_status_history`,
  `customer_block_history`, `consent_history`, `partner_merges`, `timeline_events`).
- **No writes into `shared.search_metadata`.** The `crm.normalize_name` / `normalize_email` /
  `normalize_phone` functions are pure, `IMMUTABLE`, `crm`-owned, and depend on nothing beyond
  `pg_catalog` string functions. The projection of normalized terms into `shared.search_metadata` is a
  documented backend/admin write-path — the app roles have SELECT-only access to that table and cannot
  write it — so `crm` supplies the normalization rules but does not perform the projection at runtime.
- **No column-masking layer.** The only sensitive-data primitive is the row-level
  `iam.has_permission('iam.sensitive.view')` gate; `crm` adds no masking view or function.
- **No user-table FK.** User-attribution columns are stamped from `iam.current_user_id()` but are not
  FK-constrained to an `iam` user table (deferred to Phase-1-16 write-path invariants).
- **No duplicated reference data.** Locales, currencies, documents, and outbound messages are consumed
  by FK, never copied into `crm`; the schema ships zero structural-reference rows (see
  [crm-object-inventory.md](./crm-object-inventory.md) and the no-fake-data guard).
- **No privilege escalation surface.** `crm` owns zero `SECURITY DEFINER` functions and no table grants
  bypass RLS; the app roles (`app_runtime`, `app_readonly`, `app_worker`) are `NOBYPASSRLS` and own no
  `crm` tables (see [crm-grant-matrix.md](./crm-grant-matrix.md)).

## References

- [crm-object-inventory.md](./crm-object-inventory.md)
- [crm-rls-policy-matrix.md](./crm-rls-policy-matrix.md)
- [crm-grant-matrix.md](./crm-grant-matrix.md)
- [crm-classification-matrix.md](./crm-classification-matrix.md)
- [crm-data-dictionary.md](./crm-data-dictionary.md)
- [../../database/erd/phase-1-6-crm.mmd](../../database/erd/phase-1-6-crm.mmd)
- [../../database/crm-personal-data-classification.json](../../database/crm-personal-data-classification.json)
- [../../governance/standing-technical-authorization-policy.md](../../governance/standing-technical-authorization-policy.md)
