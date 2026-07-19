# Vehicle Legacy-Migration Target Model (for Phase 1-35)

Phase 1-35 (legacy data migration) will load real Vehicles from the legacy
system into the P1-07 schema. This document is the TARGET-MODEL contract only —
**no data is migrated in P1-07, and no staging table ships**. It exists so
P1-35 can be planned against a stable surface.

## Field mapping targets

| Legacy concept           | P1-07 target                                                                       | Rule                                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Legacy Vehicle ID        | `veh.vehicle_identifiers` row, `identifier_type='other'`, internal                 | Never overwrites the new `id`; preserves provenance lookup                                                            |
| VIN                      | `vehicles.vin_raw` (→ generated `vin_normalized`)                                  | Normalized by `veh.normalize_vin`; NO silent I/O/Q correction                                                         |
| Chassis number           | `vehicle_identifiers` `type='chassis'` (restricted)                                | Sensitive-gated on load                                                                                               |
| Engine number            | `vehicle_identifiers` `type='engine_no'` (restricted)                              | Same                                                                                                                  |
| Plate (+jurisdiction)    | `plate_history` interval(s)                                                        | Current plate open-ended; known prior plates as closed intervals                                                      |
| Make / model / trim      | Catalog references                                                                 | Resolve against platform catalog; unmatched → tenant-extension rows or curation queue — never free text on the master |
| Year / body / powertrain | `model_year`, `body_type_id`, `powertrain_type_id` + `powertrain_category`         | Category consistency guard applies                                                                                    |
| Owner / users / fleet    | `ownership_history` + `vehicle_relationships` via migrated `crm.business_partners` | Composite same-tenant FKs; single registered owner enforced                                                           |
| Odometer history         | `odometer_readings` (append-only)                                                  | Chronological load; a legacy decrease loads as a correction row (reason = migration annotation) or quarantines        |
| Mechanical history       | `engine_history` / `transmission_history` closed intervals                         | Overlaps must be resolved BEFORE load (EXCLUDE will reject them)                                                      |
| EV / battery             | `vehicle_ev_profiles` + `battery_masters`                                          | Powertrain coupling enforced on load                                                                                  |

## Quarantine and review lanes (P1-35 must provision, outside veh)

1. **Missing/invalid VIN** — load as `draft` + alternate identifier, or park in
   the P1-35 staging quarantine until curated (activation contract enforces the
   invariant either way).
2. **Duplicate intake** — same normalized VIN twice in one tenant: load the
   first, route the second to `duplicate_candidates`
   (`basis='vin_collision'`, restricted, no raw values in the basis) for the
   review flow; merge via the atomic primitive picks the survivor.
3. **Timeline overlap staging** — overlapping legacy ownership/plate/mechanical
   intervals fail EXCLUDE by design; P1-35 resolves them in staging, never by
   weakening constraints.
4. **Manual review** — anything unresolvable lands in the P1-35 review queue
   with source provenance (below).

## Source provenance

Every migrated row must carry its origin: `correlation_id` (one migration
batch id per run) on ledgers that expose it, plus the legacy-ID identifier row
per Vehicle. P1-35 defines the batch manifest format.

## Hard rules carried from P1-07

- No constraint, guard, RLS policy, or classification may be disabled for the
  load — the migration runs through the same enforcement as runtime writes.
- No prior-owner CRM PII may be copied into veh (crown-jewel rule).
- Merged legacy records load as merge PAIRS through `vehicle_merges` — never as
  pre-flattened survivors with lost provenance.
