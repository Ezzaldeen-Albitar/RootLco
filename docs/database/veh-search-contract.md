# Vehicle Search Contract (P1-07-DB-019)

Phase 1-7 stores the Vehicle search projection in the existing shared primitive
`shared.search_metadata`. This document is the authoritative contract for **what
may be searched, what must never be projected, and who may write it**. It is
enforced by `tests/db/veh-search.test.ts`, the classification registry
(`docs/database/veh-personal-data-classification.json`, `searchable` flags), and
`scripts/check-veh-classification.mjs` (restricted columns can never be
searchable).

## Projection identity

- `entity_type = 'veh.vehicle'` (the Vehicle is the only searchable veh entity).
- `entity_id = veh.vehicles.id`.
- One `shared.search_metadata` row per searchable `field_code`.

## Searchable fields (the complete allow-list)

| `field_code`     | Source column                                           | Normalization         |
| ---------------- | ------------------------------------------------------- | --------------------- |
| `vin`            | `veh.vehicles.vin_normalized`                           | `veh.normalize_vin`   |
| `plate`          | `veh.plate_history.plate_normalized` (current interval) | `veh.normalize_plate` |
| `display_number` | `veh.vehicles.display_number`                           | verbatim (tenant #)   |
| `make_name`      | `veh.makes.name` (approved)                             | trim / casefold       |
| `model_name`     | `veh.models.name` (approved)                            | trim / casefold       |
| `trim_name`      | `veh.trims.name` (approved)                             | trim / casefold       |

VIN and plate reuse the same `veh.normalize_vin` / `veh.normalize_plate`
functions the master and plate history use, so a searched value and the stored
value never diverge.

## Explicitly prohibited from the search projection

Owner name; previous-owner identity; any CRM contact data; **engine number**;
**chassis number** (both live in `veh.vehicle_identifiers` as `restricted` and
are gated by `iam.sensitive.view` — never projected); battery references;
odometer values; authorization scope; relationship evidence; ownership evidence;
alert message text; and merge `match_basis` / `merge_summary` content.

The two restricted columns (`veh.vehicle_identifiers.raw_value` /
`normalized_value`) are marked `searchable: false` in the classification registry
and the classification guard fails the build if either is ever flipped to
searchable.

## Write path and roles

- `shared.search_metadata` grants ordinary runtime roles **SELECT only**
  (`app_runtime`, `app_readonly`). A runtime INSERT/UPDATE/DELETE is denied
  (SQLSTATE 42501). The projection is written by the backend/admin projection
  path (Phase 1-15/1-17), never by the request-scoped runtime role.
- Rows are tenant-scoped (`tenant_id`) with the standard RLS SELECT policy, so a
  tenant only ever searches its own Vehicles.

## Refresh / lifecycle behaviour (backend contract)

- **Catalog rename**: when an approved make/model/trim name changes, the
  projection rows for affected Vehicles are re-derived.
- **Plate change**: the `plate` projection tracks the current plate interval
  (`veh.plate_at(vehicle, now())`); a closed plate is removed/replaced.
- **Soft delete**: a soft-deleted Vehicle (`deleted_at IS NOT NULL`) is removed
  from the projection.
- **Merge**: a merged source Vehicle (`lifecycle_status = 'merged'`) is removed
  from the projection and its display number / VIN redirect to the survivor
  (`veh.resolve_vehicle_survivor`). This mirrors the active-VIN uniqueness index,
  which already excludes merged Vehicles.

## Phase handoff

Phase 1-15 (search API) and Phase 1-17 (vehicle orchestration/merge) own the
projection writer and refresh triggers. Phase 1-7 owns the field allow-list, the
normalization functions, the PII exclusion, and the read-only runtime contract.
