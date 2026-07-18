# Phase 1-3 — Organization Schema Design

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-3 · **Date:** 2026-07-17 · **Tasks:** P1-03-DB-001..022 design record ·
**Review:** owner-authorized self-review
([Solo Developer Review Policy](../../governance/solo-developer-review-policy.md))

## 1. The hierarchy as implemented

```
Platform
└── org.tenants (root scope — its id IS the scope value)
    ├── org.tenant_status_history         (append-only lifecycle evidence)
    ├── org.tenant_subscriptions ───────► org.subscription_plans (platform catalogue)
    ├── org.tenant_feature_overrides ───► org.feature_flags      (platform register)
    ├── shared.number_sequences           (org FKs attached this phase)
    └── org.legal_companies (UNIQUE (tenant_id, id))
        ├── org.company_settings          (versioned append-only)
        ├── org.cost_centers              (effective-dated)
        ├── org.tax_classes ──► org.tax_rates (NUMERIC, effective-dated)
        └── org.branches (UNIQUE (tenant_id, company_id, id))
            ├── org.branch_status_history (append-only)
            ├── org.branch_settings       (versioned append-only)
            ├── org.departments
            └── org.warehouses (UNIQUE (tenant, company, branch, id))
                └── org.storage_locations
```

Reference plane: `shared.currencies` / `shared.timezones` / `shared.languages`
(Class 1, code-keyed by documented exception). Platform plane: `org.feature_flags`,
`org.subscription_plans`, `shared.idempotency_keys`.

## 2. Composite-key strategy (the load-bearing decision)

Every child reference **carries its ancestors**: branches reference
`(tenant_id, company_id)`, locations reference the full
`(tenant_id, company_id, branch_id, warehouse_id)`. A cross-tenant or cross-scope
parent is therefore a **foreign-key violation**, independent of RLS, session
context, or application correctness. RLS is the visibility layer; the composite
keys are the integrity layer; both are tested independently.

## 3. Decisions recorded (each tested)

| #   | Decision                                                                                                                              | Why                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| D1  | `org.tenants` carries **no tenant_id** (root exception, asserted in `org-security`)                                                   | A tenant does not belong to a tenant; misreading this as a missing scope column is prevented by the documented exception list  |
| D2  | Organizational **codes are user-supplied at creation and immutable afterwards** (trigger-guarded); recoding = soft-delete + recreate  | Codes are referenced externally (documents, integrations); silent recoding falsifies history                                   |
| D3  | Human-facing **numbers are generated** via `shared.number_sequences` only; never edited                                               | Phase 1-2 standard, unchanged                                                                                                  |
| D4  | **Company/branch codes stay reserved while archived**; child-structure codes (departments, warehouses, locations) **free on archive** | Company/branch codes are external identities; child codes are internal labels — the "where approved" ruling, made explicit     |
| D5  | Tenants are **closed, never deleted**; no soft-delete columns on `org.tenants`                                                        | The root row anchors all historical data forever                                                                               |
| D6  | Settings are **versioned append-only rows**, immutable even to admin (identity trigger)                                               | "No destructive overwrite" as a structural property, not a convention                                                          |
| D7  | JSONB for plan entitlements/capacities and setting values, contained by real validation triggers                                      | Open, growing catalogues; one-column-per-key would migrate the schema for every new key (full justification in the migrations) |
| D8  | Platform writes (tenant lifecycle, subscriptions, overrides, provisioning) are **not application-role capabilities** in this phase    | The authorized surfaces are Phase 1-4/1-14; granting early would create an unaudited path                                      |
| D9  | Reference tables use **natural-code PKs** (narrow documented exception in the naming standard)                                        | Owner instruction + idempotent seed conflict targets                                                                           |
| D10 | Tax rates are NUMERIC(9,6) **fractions in [0,1]**                                                                                     | 0.16 = 16%; float prohibited by the architecture standard                                                                      |

## 4. Code governance register (P1-03-DB-016)

| Code                            | Origin        | Mutability                                 |
| ------------------------------- | ------------- | ------------------------------------------ |
| `tenant_code`                   | user-supplied | immutable                                  |
| `company_code`                  | user-supplied | immutable; frees on soft delete only       |
| `branch_code`                   | user-supplied | immutable; frees on soft delete only       |
| `department/warehouse/location` | user-supplied | immutable; frees on soft delete OR archive |
| `cost_center_code`              | user-supplied | immutable; new validity = new row          |
| `sequence_code`                 | provisioning  | immutable                                  |
| display numbers (`DOC-000001`)  | **generated** | never edited, never reissued               |
| `plan_code` / `flag_code`       | platform      | immutable                                  |

## 5. Provisioning register — pilot configuration status (nothing invented)

**Phase 1-5 forward correction (2026-07-18):** the controlled data now lives at
`supabase/packages/pilot-provisioning.package.json` and is run manually through
the generic gated CLI under `docs/database/pilot-provisioning-runbook.md`. It is
not a seed and cannot run on reset or in CI. The package uses only approved facts;
everything unknown is NULL or explicitly draft:

| Item                             | Status                                              |
| -------------------------------- | --------------------------------------------------- |
| Tenant/company display names     | Approved (public company name)                      |
| Legal registration numbers       | **UNKNOWN → NULL — pending owner input**            |
| Official Arabic legal rendering  | **Pending owner confirmation**                      |
| Base currency JOD, tz Asia/Amman | **DRAFT pilot configuration, pending confirmation** |
| Subscription                     | DRAFT status against the generic `pilot` plan       |
| Settings / feature overrides     | None approved → none seeded                         |
| Production reference currencies  | **PENDING — OIR-04 remains OPEN**                   |

## 6. What was deliberately NOT built

No users/roles/permissions/memberships (Phase 1-4). No customers, vehicles,
appointments, inspections, quotations, work orders, parts, stock, invoices,
payments (their own phases — the foundation allow-list test rejects any of them).
No backend API or Server Action, no frontend page, no billing/pricing logic, no
production infrastructure, no real pilot data migration.

## 7. ERD and Figure 4.9 synchronization

Repository ERD source: [`docs/database/erd/phase-1-3-organization.mmd`](../../database/erd/phase-1-3-organization.mmd)
(matches the implementation; regenerated with schema changes). The canonical Master
document's Figure 4.9 shows the planned organization model; the implemented model
follows it with **no requirement-level divergence** — additions are elaborations
(status-history tables, versioned settings, idempotency keys) inside the approved
scope, so no change-request record is required. If a future increment must diverge
from a canonical figure, a change request is raised instead of silently drifting;
the Figure 4.9 refresh itself rides the canonical DOCX synchronization window
(pending, non-blocking).
