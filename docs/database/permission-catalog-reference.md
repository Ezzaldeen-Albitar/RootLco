# Phase 1-4 — Permission Catalog Reference

**Company:** RootLco · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential · **Phase:** 1-4 · **Date:** 2026-07-18 ·
**Task:** P1-04-DB-025

The permission catalog (`iam.permissions`) is **platform-owned reference data**,
seeded idempotently by `supabase/seeds/04_iam_permission_catalog.sql`. Codes are
stable and additive; `permission_code` is immutable; there is **no wildcard**
permission. Authorization is by these codes, never by role name.

## Catalog

| Code                      | Domain | Risk   | Meaning                        |
| ------------------------- | ------ | ------ | ------------------------------ |
| `org.tenant.read`         | org    | low    | Read tenant profile            |
| `org.company.read`        | org    | low    | Read legal companies           |
| `org.company.manage`      | org    | medium | Create/update companies        |
| `org.branch.read`         | org    | low    | Read branches                  |
| `org.branch.manage`       | org    | medium | Create/update branches         |
| `org.department.manage`   | org    | medium | Manage departments/structure   |
| `org.settings.manage`     | org    | high   | Manage company/branch settings |
| `org.tax.manage`          | org    | high   | Manage tax classes/rates       |
| `org.subscription.manage` | org    | high   | Manage subscriptions           |
| `iam.user.read`           | iam    | low    | Read user directory            |
| `iam.user.manage`         | iam    | high   | Provision/lifecycle users      |
| `iam.role.read`           | iam    | low    | Read roles/mappings            |
| `iam.role.manage`         | iam    | high   | Create/update roles            |
| `iam.grant.manage`        | iam    | high   | Grant/revoke roles             |
| `iam.approval.manage`     | iam    | high   | Manage approval limits         |
| `iam.sensitive.view`      | iam    | high   | View sensitive/restricted data |
| `iam.audit.view`          | iam    | medium | Read the audit trail           |
| `iam.session.view_all`    | iam    | medium | View all tenant sessions       |
| `iam.login.view_all`      | iam    | medium | View all tenant login history  |

## Baseline roles (provisioning-time, configuration-led)

**Phase 1-5 forward correction (2026-07-18):** seed 04 now contains only the
platform permission catalog. The representative six-role shape below is proven
idempotently by `tests/db/iam-seeds.test.ts` against a cascade-deleted ephemeral
tenant. No tenant role, user, grant, or credential is seeded. Tenant role
definitions remain provisioning-time configuration per tenant.

| Role                   | Representative permissions                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| `platform_operator`    | tenant.read, subscription.manage, audit.view                                                                |
| `tenant_administrator` | org `*.manage`, user.manage, role.manage, grant.manage, approval.manage, audit.view, session/login.view_all |
| `branch_manager`       | branch.read, department.manage, user.read                                                                   |
| `receptionist`         | branch.read, user.read                                                                                      |
| `technician`           | branch.read                                                                                                 |
| `cashier`              | branch.read, approval.manage                                                                                |

## Governance

Adding a permission is additive (new row, new code); it never renames or removes
an existing code. High-risk permissions are the ones whose grants should carry
approval evidence (`role_grants.approval_ref`) — the enforcing workflow is
Phase-1-14.
