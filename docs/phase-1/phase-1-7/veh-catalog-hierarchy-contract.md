# Vehicle Catalog Hierarchy Contract (P1-07-DB-006)

Five dual-scope reference catalogs: `veh.makes` → `veh.models` → `veh.trims`
(strict hierarchy), plus flat `veh.body_types` and `veh.powertrain_types`.

## Dual scope

Every catalog row carries an explicit `scope`:

| Scope      | tenant_id                            | Who reads it                             | Who writes it                                                                                                                                        |
| ---------- | ------------------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform` | NULL (enforced by `ck_scope_tenant`) | Every tenant (SELECT policy `…_visible`) | Platform/admin path only — the UPDATE policy is `USING (scope='tenant' AND tenant_id = current)`, so a tenant can NEVER claim or edit a platform row |
| `tenant`   | NOT NULL = owning tenant             | Owning tenant only                       | Owning tenant (`app_runtime`)                                                                                                                        |

Uniqueness is per scope: `uq_<cat>_platform_code` (WHERE scope='platform') and
`uq_<cat>_tenant_code` (WHERE scope='tenant', per tenant) — a tenant extension
can reuse a platform code without collision and vice versa.

## Hierarchy scope guards (fail-closed)

`veh.guard_model_make_scope` and `veh.guard_trim_model_scope` run SECURITY
INVOKER under RLS: a parent row the session cannot see is NOT FOUND and the
INSERT/UPDATE is rejected. This makes the following structurally impossible:

- a tenant model under another tenant's make (invisible → rejected),
- a tenant trim under another tenant's model,
- scope mixing that RLS would otherwise mask.

A platform model may only reference a platform make; a tenant model may
reference a platform make (extension) or its own tenant make.

## Vehicle-side consistency

`veh.guard_vehicle_catalog_refs` (on `veh.vehicles`) re-validates on every
catalog reference change: platform-or-same-tenant visibility (fail-closed),
model-belongs-to-make, trim-belongs-to-model, and
powertrain_type.category == vehicles.powertrain_category.

## Provisioning boundary

**Zero catalog rows ship in P1-07** (no-fake-data policy — even "illustrative"
makes are business data). Platform catalog provisioning is an admin-side
onboarding/curation activity; tenant extensions are created at runtime by the
tenant. The provisioning runbook owns the operational procedure.

Evidence: `tests/db/veh-catalogs.test.ts` (11 tests) + `veh-vehicles.test.ts`
catalog-guard cases.
