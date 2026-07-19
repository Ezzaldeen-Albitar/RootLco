# VIN Normalization Contract (P1-07)

`veh.normalize_vin(text)` is the single normalization authority for VINs. It is
`IMMUTABLE`, `SECURITY INVOKER`, `search_path=''`, and is the generator of the
STORED column `veh.vehicles.vin_normalized` — the normalized form can never
drift from the raw value.

## Exact behavior

```sql
SELECT NULLIF(regexp_replace(upper(btrim(COALESCE(p_value, ''))), '[^A-Z0-9]', '', 'g'), '');
```

| Rule               | Behavior                                                                                                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Case               | Uppercased                                                                                                                                                                                                             |
| Separators         | Every non-`[A-Z0-9]` character removed (spaces, dashes, dots, Unicode punctuation)                                                                                                                                     |
| Whitespace         | Trimmed, and interior whitespace removed by the separator rule                                                                                                                                                         |
| `I`, `O`, `Q`      | **Preserved verbatim.** ISO 3779 excludes them from valid VINs, but silent "correction" (I→1, O→0) would forge an identifier. Rejection/repair is an explicit verification decision, never a normalization side effect |
| Silent correction  | None, ever                                                                                                                                                                                                             |
| Blank / NULL input | Normalizes to `NULL` (a Vehicle may legitimately lack a VIN)                                                                                                                                                           |

## Raw vs normalized

`vin_raw` preserves exactly what was entered (audit fidelity, blank-checked).
`vin_normalized` is generated and is the ONLY column used for uniqueness and
search. Consumers must never re-implement normalization — they call
`veh.normalize_vin` (granted to `app_runtime`/`app_readonly`).

## Uniqueness (P1-07-DB-002)

`uq_vehicles_active_vin` — UNIQUE `(tenant_id, vin_normalized)` WHERE
`vin_normalized IS NOT NULL AND deleted_at IS NULL AND lifecycle_status <>
'merged'`. Tenant-scoped (no cross-tenant probe oracle); merged and
soft-deleted Vehicles release their VIN; concurrency proven (QA-008 §2).

## Validation boundaries (what P1-07 does NOT do)

- **Format validation** — length/character-position rules are a verification
  concern, storable as `check_kind='format'` results in `veh.vin_verifications`.
- **Checksum validation** — `check_kind='checksum'` result storage only; no
  check-digit engine ships in this phase.
- **Manual override** — `result='overridden'` requires a non-blank
  `override_reason`; actor and time are server-stamped.
- **External decode services** — out of scope; `check_kind='external'` stores
  results if a later phase performs them. Nothing is fabricated.

## Missing-VIN activation contract (CR-VEH-03)

A Vehicle may be created as `draft` without any identity. Activation (INSERT as
`active` or transition to `active`) requires a VIN **or** at least one active
controlled alternate identifier; removing the last identity of an active
Vehicle is rejected under a lock (`guard_vehicle_activation`,
`guard_vehicle_identity_removal`).

## Reuse map

- **P1-15 (search):** the search projection stores `vin_normalized` verbatim
  ([search contract](../../database/veh-search-contract.md)).
- **P1-17 (operations):** API write paths call `veh.normalize_vin` for lookup
  parity and must map 23505 to a sanitized error (abuse case #5).
- **P1-35 (legacy migration):** staging normalizes with the same function;
  invalid/missing VINs quarantine per the
  [target model](./veh-target-data-model-phase-1-35.md).
