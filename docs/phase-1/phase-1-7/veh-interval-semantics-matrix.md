# Vehicle Interval Semantics Matrix (P1-07)

The five mutable-temporal tables share one model (the `crm.partner_roles`
pattern, deliberately NOT append-only): an interval is inserted open or closed,
its identity is immutable, and its ONLY lifetime mutation is closing —
`valid_to` may change exactly once, `NULL → date` (`veh.guard_temporal_close`).
`daterange(valid_from, valid_to, '[)')` gist EXCLUDE constraints forbid
overlap. There is no DELETE (no grant, no policy).

| Table                   | Non-overlap scope                | Extra exclusivity                                                                         | Point-in-time resolver                               | Immutable identity (close-only `valid_to` excepted)     |
| ----------------------- | -------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| `engine_history`        | (tenant, vehicle)                | —                                                                                         | `veh.engine_at(vehicle, ts)`                         | vehicle, attrs, `valid_from`                            |
| `transmission_history`  | (tenant, vehicle)                | —                                                                                         | `veh.transmission_at(vehicle, ts)`                   | vehicle, type/number, `valid_from`                      |
| `plate_history`         | (tenant, vehicle)                | Cross-Vehicle active plate per (tenant, country, plate_normalized) over the FULL interval | `veh.plate_at(vehicle, ts)`                          | vehicle, plate, country, `valid_from`                   |
| `ownership_history`     | (tenant, vehicle, partner, kind) | Single `registered_owner` per Vehicle over the interval                                   | `veh.owner_at(vehicle, ts)` → surviving partner uuid | vehicle, partner, kind, `valid_from`                    |
| `vehicle_relationships` | (tenant, vehicle, partner, role) | —                                                                                         | `veh.relationships_at(vehicle, ts)`                  | vehicle, partner, role, scope, granted_by, `valid_from` |

## Operation semantics (all five tables)

| Operation                                     | Outcome                                            |
| --------------------------------------------- | -------------------------------------------------- |
| INSERT open interval                          | OK if no overlap (else 23P01)                      |
| INSERT closed historical interval             | OK if no overlap — history backfill is legal       |
| UPDATE `valid_to` NULL → date                 | OK once (the close)                                |
| UPDATE `valid_to` date → NULL (reopen)        | 23514 (`guard_temporal_close`)                     |
| UPDATE `valid_to` date → other date (re-date) | 23514                                              |
| UPDATE any identity column                    | 23514 (`org.guard_immutable_columns`)              |
| DELETE                                        | 42501 (no grant, no policy)                        |
| Adjacent intervals (`[a,b)` then `[b,c)`)     | OK — `[)` ranges touch without overlap             |
| Concurrent overlapping INSERTs                | Exactly one winner; loser 23P01 (QA-008 §5/6/9/10) |

## Battery installation (related but not range-typed)

`battery_masters` uses `installed_on` / `removed_on` dates with coherence
CHECKs plus the partial-unique **one active traction battery per Vehicle**
(`uq_battery_masters_active_traction`; race-proven QA-008 §8). It is a mutable
master (soft delete), not an EXCLUDE-range table: replacement history is the
row sequence, and readings are the append-only `battery_readings`.

Evidence: `veh-mechanical.test.ts`, `veh-ownership.test.ts`,
`veh-concurrency.test.ts`.
