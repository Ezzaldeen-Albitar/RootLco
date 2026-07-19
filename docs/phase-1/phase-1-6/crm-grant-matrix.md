# Phase 1-6 — CRM Grant Matrix

<!-- GENERATED from live crm introspection; do not hand-edit count tables. -->

Generated from the live `crm` schema. Totals: **21 tables, 298 columns, 13 functions, 45 triggers, 58 policies, 79 indexes, 51 foreign keys, 73 check constraints.**

Table privileges granted to the three application roles. `app_runtime` is the request-path role, `app_readonly` is read-only, `app_worker` is the constrained background role. None owns any `crm` table; none has `BYPASSRLS`. Append-only history tables grant `INSERT`+`SELECT` only (no `UPDATE`/`DELETE`). A blank cell means no direct privilege.

| Table                          | `app_runtime`          | `app_readonly` | `app_worker` |
| ------------------------------ | ---------------------- | -------------- | ------------ |
| `addresses`                    | INSERT, SELECT, UPDATE | SELECT         | —            |
| `business_partners`            | INSERT, SELECT, UPDATE | SELECT         | —            |
| `communication_log`            | INSERT, SELECT, UPDATE | SELECT         | —            |
| `communication_preferences`    | INSERT, SELECT, UPDATE | SELECT         | —            |
| `company_profiles`             | INSERT, SELECT, UPDATE | SELECT         | —            |
| `consent_history`              | INSERT, SELECT         | SELECT         | —            |
| `contact_points`               | INSERT, SELECT, UPDATE | SELECT         | —            |
| `customer_alerts`              | INSERT, SELECT, UPDATE | SELECT         | —            |
| `customer_block_history`       | INSERT, SELECT         | SELECT         | —            |
| `customer_credit_profiles`     | INSERT, SELECT, UPDATE | SELECT         | —            |
| `customer_restrictions`        | INSERT, SELECT, UPDATE | SELECT         | —            |
| `customer_segments`            | INSERT, SELECT, UPDATE | SELECT         | —            |
| `duplicate_candidates`         | INSERT, SELECT, UPDATE | SELECT         | —            |
| `individual_profiles`          | INSERT, SELECT, UPDATE | SELECT         | —            |
| `partner_identifiers`          | INSERT, SELECT, UPDATE | SELECT         | —            |
| `partner_merges`               | INSERT, SELECT         | SELECT         | —            |
| `partner_roles`                | INSERT, SELECT, UPDATE | SELECT         | —            |
| `partner_segment_assignments`  | INSERT, SELECT, UPDATE | SELECT         | —            |
| `partner_sensitive_attributes` | INSERT, SELECT, UPDATE | SELECT         | —            |
| `partner_status_history`       | INSERT, SELECT         | SELECT         | —            |
| `timeline_events`              | INSERT, SELECT         | SELECT         | —            |

## Table ownership (must be a non-app role for every table)

| Table                          | Owner      |
| ------------------------------ | ---------- |
| `addresses`                    | `postgres` |
| `business_partners`            | `postgres` |
| `communication_log`            | `postgres` |
| `communication_preferences`    | `postgres` |
| `company_profiles`             | `postgres` |
| `consent_history`              | `postgres` |
| `contact_points`               | `postgres` |
| `customer_alerts`              | `postgres` |
| `customer_block_history`       | `postgres` |
| `customer_credit_profiles`     | `postgres` |
| `customer_restrictions`        | `postgres` |
| `customer_segments`            | `postgres` |
| `duplicate_candidates`         | `postgres` |
| `individual_profiles`          | `postgres` |
| `partner_identifiers`          | `postgres` |
| `partner_merges`               | `postgres` |
| `partner_roles`                | `postgres` |
| `partner_segment_assignments`  | `postgres` |
| `partner_sensitive_attributes` | `postgres` |
| `partner_status_history`       | `postgres` |
| `timeline_events`              | `postgres` |
