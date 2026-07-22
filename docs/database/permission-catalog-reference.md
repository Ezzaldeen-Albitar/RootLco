# Phase 1-4 — Permission Catalog Reference

**Company:** RootLco · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential · **Phase:** 1-4 · **Date:** 2026-07-18 ·
**Task:** P1-04-DB-025

The permission catalog (`iam.permissions`) is **platform-owned reference data**,
seeded idempotently by `supabase/seeds/04_iam_permission_catalog.sql`. Codes are
stable and additive; `permission_code` is immutable; there is **no wildcard**
permission. Authorization is by these codes, never by role name.

## Catalog

**Reconciled against the executable seed on 2026-07-22 (Phase 1-14, finding PC-2).** This document
listed the 19 codes Phase 1-4 introduced and was never updated as Phases 1-10 … 1-11 added their
own; the seed contained 43. `supabase/seeds/04_iam_permission_catalog.sql` is the source of
truth, and `tests/db/iam-seeds.test.ts` asserts the count, so this table is a rendering of it
rather than a second authority. Regenerating it after a seed change is part of that change.

| Code                      | Domain | Risk   | Meaning                                           |
| ------------------------- | ------ | ------ | ------------------------------------------------- |
| `iam.approval.manage`     | iam    | high   | Manage approval limits                            |
| `iam.audit.view`          | iam    | medium | Read the audit trail                              |
| `iam.grant.manage`        | iam    | high   | Grant and revoke roles                            |
| `iam.login.view_all`      | iam    | medium | View all tenant login history                     |
| `iam.role.manage`         | iam    | high   | Create and update roles                           |
| `iam.role.read`           | iam    | low    | Read roles and mappings                           |
| `iam.sensitive.view`      | iam    | high   | View sensitive data                               |
| `iam.session.view_all`    | iam    | medium | View all tenant sessions                          |
| `iam.user.manage`         | iam    | high   | Provision and lifecycle users                     |
| `iam.user.read`           | iam    | low    | Read user directory                               |
| `inv.adjustment.approve`  | inv    | high   | Approve stock adjustments/opening batches         |
| `inv.cost.view`           | inv    | high   | View item/purchase/adjustment cost                |
| `inv.item.manage`         | inv    | medium | Manage item master, categories, UoM               |
| `inv.stock.operate`       | inv    | medium | Post movements, reserve, issue, return            |
| `inv.stock.read`          | inv    | low    | Read stock balances and movements                 |
| `org.branch.manage`       | org    | medium | Create and update branches                        |
| `org.branch.read`         | org    | low    | Read branches                                     |
| `org.company.manage`      | org    | medium | Create and update companies                       |
| `org.company.read`        | org    | low    | Read legal companies                              |
| `org.department.manage`   | org    | medium | Manage departments/structure                      |
| `org.settings.manage`     | org    | high   | Manage company/branch settings                    |
| `org.subscription.manage` | org    | high   | Manage tenant subscriptions                       |
| `org.tax.manage`          | org    | high   | Manage tax classes and rates                      |
| `org.tenant.read`         | org    | low    | Read tenant profile                               |
| `quo.decision.record`     | quo    | high   | Record quotation item approval decisions          |
| `quo.quotation.manage`    | quo    | medium | Create and manage quotations/revisions            |
| `rpt.export`              | rpt    | high   | Export report data (audited downstream)           |
| `rpt.report.configure`    | rpt    | medium | Manage report configurations                      |
| `sal.credit.manage`       | sal    | high   | Request and manage credit notes                   |
| `sal.delivery.complete`   | sal    | high   | Complete deliveries and close custody             |
| `sal.delivery.manage`     | sal    | medium | Manage deliveries, receivers, signatures          |
| `sal.delivery.view`       | sal    | high   | View delivery signatures/receiver evidence        |
| `sal.finance.view`        | sal    | high   | View financial amounts (invoices/receipts/events) |
| `sal.invoice.issue`       | sal    | high   | Issue invoices (allocate numbers)                 |
| `sal.invoice.manage`      | sal    | medium | Create and manage draft invoices                  |
| `sal.payment.allocate`    | sal    | medium | Allocate receipts to invoices                     |
| `sal.payment.record`      | sal    | medium | Record receipts                                   |
| `sal.reversal.approve`    | sal    | high   | Approve receipt reversals (dual control)          |
| `svc.price.manage`        | svc    | high   | Manage price lists, rules, discounts              |
| `svc.price.publish`       | svc    | high   | Publish immutable price-list versions             |
| `svc.service.manage`      | svc    | medium | Manage service catalog and versions               |
| `wty.policy.manage`       | wty    | medium | Manage warranty policies and coverage             |
| `wty.warranty.issue`      | wty    | medium | Issue warranty records                            |

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
