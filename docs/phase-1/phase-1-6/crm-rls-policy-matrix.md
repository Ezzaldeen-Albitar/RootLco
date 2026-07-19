# Phase 1-6 — CRM RLS Policy Matrix

<!-- GENERATED from live crm introspection; do not hand-edit count tables. -->

Generated from the live `crm` schema. Totals: **21 tables, 298 columns, 13 functions, 45 triggers, 58 policies, 79 indexes, 51 foreign keys, 73 check constraints.**

Every `crm` base table has `ENABLE` **and** `FORCE ROW LEVEL SECURITY`. `FORCE` binds any **non-superuser** role, including a non-superuser table owner; the `crm` tables are currently owned by the superuser `postgres` (which bypasses RLS regardless of `FORCE`), so tenant isolation rests on the application connecting **only** as the `NOBYPASSRLS` app roles (`app_runtime`/`app_readonly`/`app_worker`), never the owner/provisioning connection. All app roles are `NOBYPASSRLS` and non-superuser. Policies are per-command and default-deny: a command with no matching policy is denied. Tenant scoping keys on `iam.current_tenant_id()`.

## Force-RLS coverage

| Table                          | RLS enabled | RLS forced | Policies |
| ------------------------------ | ----------- | ---------- | -------- |
| `addresses`                    | ✅          | ✅         | 3        |
| `business_partners`            | ✅          | ✅         | 3        |
| `communication_log`            | ✅          | ✅         | 3        |
| `communication_preferences`    | ✅          | ✅         | 3        |
| `company_profiles`             | ✅          | ✅         | 3        |
| `consent_history`              | ✅          | ✅         | 2        |
| `contact_points`               | ✅          | ✅         | 3        |
| `customer_alerts`              | ✅          | ✅         | 3        |
| `customer_block_history`       | ✅          | ✅         | 2        |
| `customer_credit_profiles`     | ✅          | ✅         | 3        |
| `customer_restrictions`        | ✅          | ✅         | 3        |
| `customer_segments`            | ✅          | ✅         | 3        |
| `duplicate_candidates`         | ✅          | ✅         | 3        |
| `individual_profiles`          | ✅          | ✅         | 3        |
| `partner_identifiers`          | ✅          | ✅         | 3        |
| `partner_merges`               | ✅          | ✅         | 2        |
| `partner_roles`                | ✅          | ✅         | 3        |
| `partner_segment_assignments`  | ✅          | ✅         | 3        |
| `partner_sensitive_attributes` | ✅          | ✅         | 3        |
| `partner_status_history`       | ✅          | ✅         | 2        |
| `timeline_events`              | ✅          | ✅         | 2        |

## Policy inventory (58)

| Table                          | Policy                                    | Command | Roles                      |
| ------------------------------ | ----------------------------------------- | ------- | -------------------------- |
| `addresses`                    | `ins_addresses_tenant`                    | INSERT  | {app_runtime}              |
| `addresses`                    | `sel_addresses_tenant`                    | SELECT  | {app_readonly,app_runtime} |
| `addresses`                    | `upd_addresses_tenant`                    | UPDATE  | {app_runtime}              |
| `business_partners`            | `ins_business_partners_tenant`            | INSERT  | {app_runtime}              |
| `business_partners`            | `sel_business_partners_tenant`            | SELECT  | {app_readonly,app_runtime} |
| `business_partners`            | `upd_business_partners_tenant`            | UPDATE  | {app_runtime}              |
| `communication_log`            | `ins_communication_log_tenant`            | INSERT  | {app_runtime}              |
| `communication_log`            | `sel_communication_log_tenant`            | SELECT  | {app_readonly,app_runtime} |
| `communication_log`            | `upd_communication_log_tenant`            | UPDATE  | {app_runtime}              |
| `communication_preferences`    | `ins_communication_preferences_tenant`    | INSERT  | {app_runtime}              |
| `communication_preferences`    | `sel_communication_preferences_tenant`    | SELECT  | {app_readonly,app_runtime} |
| `communication_preferences`    | `upd_communication_preferences_tenant`    | UPDATE  | {app_runtime}              |
| `company_profiles`             | `ins_company_profiles_tenant`             | INSERT  | {app_runtime}              |
| `company_profiles`             | `sel_company_profiles_tenant`             | SELECT  | {app_readonly,app_runtime} |
| `company_profiles`             | `upd_company_profiles_tenant`             | UPDATE  | {app_runtime}              |
| `consent_history`              | `ins_consent_history_tenant`              | INSERT  | {app_runtime}              |
| `consent_history`              | `sel_consent_history_tenant`              | SELECT  | {app_readonly,app_runtime} |
| `contact_points`               | `ins_contact_points_tenant`               | INSERT  | {app_runtime}              |
| `contact_points`               | `sel_contact_points_tenant`               | SELECT  | {app_readonly,app_runtime} |
| `contact_points`               | `upd_contact_points_tenant`               | UPDATE  | {app_runtime}              |
| `customer_alerts`              | `ins_customer_alerts_tenant`              | INSERT  | {app_runtime}              |
| `customer_alerts`              | `sel_customer_alerts_tenant`              | SELECT  | {app_readonly,app_runtime} |
| `customer_alerts`              | `upd_customer_alerts_tenant`              | UPDATE  | {app_runtime}              |
| `customer_block_history`       | `ins_customer_block_history_tenant`       | INSERT  | {app_runtime}              |
| `customer_block_history`       | `sel_customer_block_history_tenant`       | SELECT  | {app_readonly,app_runtime} |
| `customer_credit_profiles`     | `ins_customer_credit_profiles_tenant`     | INSERT  | {app_runtime}              |
| `customer_credit_profiles`     | `sel_customer_credit_profiles_tenant`     | SELECT  | {app_readonly,app_runtime} |
| `customer_credit_profiles`     | `upd_customer_credit_profiles_tenant`     | UPDATE  | {app_runtime}              |
| `customer_restrictions`        | `ins_customer_restrictions_tenant`        | INSERT  | {app_runtime}              |
| `customer_restrictions`        | `sel_customer_restrictions_tenant`        | SELECT  | {app_readonly,app_runtime} |
| `customer_restrictions`        | `upd_customer_restrictions_tenant`        | UPDATE  | {app_runtime}              |
| `customer_segments`            | `ins_customer_segments_tenant`            | INSERT  | {app_runtime}              |
| `customer_segments`            | `sel_customer_segments_tenant`            | SELECT  | {app_readonly,app_runtime} |
| `customer_segments`            | `upd_customer_segments_tenant`            | UPDATE  | {app_runtime}              |
| `duplicate_candidates`         | `ins_duplicate_candidates_tenant`         | INSERT  | {app_runtime}              |
| `duplicate_candidates`         | `sel_duplicate_candidates_tenant`         | SELECT  | {app_readonly,app_runtime} |
| `duplicate_candidates`         | `upd_duplicate_candidates_tenant`         | UPDATE  | {app_runtime}              |
| `individual_profiles`          | `ins_individual_profiles_tenant`          | INSERT  | {app_runtime}              |
| `individual_profiles`          | `sel_individual_profiles_tenant`          | SELECT  | {app_readonly,app_runtime} |
| `individual_profiles`          | `upd_individual_profiles_tenant`          | UPDATE  | {app_runtime}              |
| `partner_identifiers`          | `ins_partner_identifiers_tenant`          | INSERT  | {app_runtime}              |
| `partner_identifiers`          | `sel_partner_identifiers_tenant`          | SELECT  | {app_readonly,app_runtime} |
| `partner_identifiers`          | `upd_partner_identifiers_tenant`          | UPDATE  | {app_runtime}              |
| `partner_merges`               | `ins_partner_merges_tenant`               | INSERT  | {app_runtime}              |
| `partner_merges`               | `sel_partner_merges_tenant`               | SELECT  | {app_readonly,app_runtime} |
| `partner_roles`                | `ins_partner_roles_tenant`                | INSERT  | {app_runtime}              |
| `partner_roles`                | `sel_partner_roles_tenant`                | SELECT  | {app_readonly,app_runtime} |
| `partner_roles`                | `upd_partner_roles_tenant`                | UPDATE  | {app_runtime}              |
| `partner_segment_assignments`  | `ins_partner_segment_assignments_tenant`  | INSERT  | {app_runtime}              |
| `partner_segment_assignments`  | `sel_partner_segment_assignments_tenant`  | SELECT  | {app_readonly,app_runtime} |
| `partner_segment_assignments`  | `upd_partner_segment_assignments_tenant`  | UPDATE  | {app_runtime}              |
| `partner_sensitive_attributes` | `ins_partner_sensitive_attributes_tenant` | INSERT  | {app_runtime}              |
| `partner_sensitive_attributes` | `sel_partner_sensitive_attributes_tenant` | SELECT  | {app_readonly,app_runtime} |
| `partner_sensitive_attributes` | `upd_partner_sensitive_attributes_tenant` | UPDATE  | {app_runtime}              |
| `partner_status_history`       | `ins_partner_status_history_tenant`       | INSERT  | {app_runtime}              |
| `partner_status_history`       | `sel_partner_status_history_tenant`       | SELECT  | {app_readonly,app_runtime} |
| `timeline_events`              | `ins_timeline_events_tenant`              | INSERT  | {app_runtime}              |
| `timeline_events`              | `sel_timeline_events_tenant`              | SELECT  | {app_readonly,app_runtime} |

## Role bypass posture

| Role           | BYPASSRLS | Superuser |
| -------------- | --------- | --------- |
| `app_readonly` | false     | false     |
| `app_runtime`  | false     | false     |
| `app_worker`   | false     | false     |
