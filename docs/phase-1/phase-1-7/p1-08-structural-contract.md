# Phase 1-7 → Phase 1-8 Structural Contract

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-7 — Vehicle Database · **Date:** 2026-07-20

Phase 1-8 (Workshop Core Operations Database) and every later Vehicle consumer
builds on a small, deliberately stable subset of the `veh` schema. This
document states that contract in prose; it is enforced by
[`tests/db/veh-structural-contract.test.ts`](../../../tests/db/veh-structural-contract.test.ts)
(6 assertions), so a change that would break it fails the build. The exhaustive
object list lives in `foundation.test.ts` and the
[object inventory](./veh-object-inventory.md); this contract is the narrower
promise the next phase may rely on.

## 1. Vehicle master

`veh.vehicles` is the single Vehicle root. A consumer may bind to: `id`,
`tenant_id`, `display_number`, `vin_raw`/`vin_normalized` (generated),
`lifecycle_status`, `workshop_status`, `merged_into_id`,
`powertrain_category`, `record_version`, `created_by`, `deleted_at` — all
asserted present by the contract test.

## 2. Same-tenant FK pattern

The composite candidate key `uq_vehicles_tenant_id (tenant_id, id)` is the
contract anchor: every P1-08 table referencing a Vehicle MUST use
`FOREIGN KEY (tenant_id, vehicle_id) REFERENCES veh.vehicles (tenant_id, id)
ON DELETE RESTRICT`, making cross-tenant references a FK violation by
construction.

## 3. Identity and status vocabulary (stable)

- Active-identity uniqueness: `uq_vehicles_active_vin`,
  `uq_vehicles_active_display_number` (both exclude soft-deleted; VIN also
  excludes merged).
- `lifecycle_status ∈ {draft, active, inactive, merged, scrapped}`;
  `workshop_status ∈ {none, in_workshop, awaiting_parts, ready_for_delivery}` —
  both pinned by the contract test. **P1-08 owns workshop transitions
  operationally but must go through the master UPDATE path** (status history
  emits automatically; direct history forgery is coherence-rejected).
- Active-Vehicle validation: an `active` Vehicle always has a VIN or a
  controlled alternate identifier (CR-VEH-03 guards).

## 4. Merge resolution

A consumer must treat `lifecycle_status='merged'` as terminal-frozen and
resolve through `veh.resolve_vehicle_survivor(uuid)` (cycle-safe). New
operational rows must attach to the survivor.

## 5. Stable resolvers (consumer-callable, SECURITY INVOKER, locked search_path)

`resolve_vehicle_survivor`, `plate_at`, `owner_at`, `relationships_at`,
`engine_at`, `transmission_at`, `latest_odometer`, `odometer_at`,
`normalize_vin`, `normalize_plate` — existence + security posture asserted by
the contract test. EV profile: one live row per Vehicle
(`uq_vehicle_ev_profiles_vehicle`); active alerts:
`is_active AND deleted_at IS NULL` within the effective window.

## 6. RLS expectations

Every veh table is ENABLE + FORCE RLS with tenant-scoped default-deny policies
(asserted). P1-08 tables MUST adopt the same posture; nothing in P1-08 may
grant DELETE on veh objects or add SECURITY DEFINER accessors over them.

## 7. Allowed references and forbidden duplication

P1-08 MAY reference: `veh.vehicles (tenant_id, id)`; the resolvers above; and
`crm.business_partners` via its own composite FKs.
P1-08 MUST NOT duplicate: VIN/plate/identifier values into its own columns
(reference the Vehicle), odometer state (insert readings via the odometer
contract), status state (the master is canonical), or any CRM party PII
(crown-jewel rule).

## 8. No Phase 1-8 object exists yet

The contract test asserts that no table matching `reception`, `appointment`,
`work_order`/`workorder` exists in any module schema at P1-07 close. Phase 1-8
has NOT been started.
