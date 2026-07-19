# Vehicle Classification Matrix (P1-07-SEC-003)

The single source of truth is the validator-enforced registry
[`veh-personal-data-classification.json`](../../database/veh-personal-data-classification.json)
(**320 columns — every live veh column**), reconciled against the live schema
by `scripts/check-veh-classification.mjs` (same canonical implementation
locally and in CI; negative-fixture-tested by
`tests/db/veh-classification-guard.test.ts`). This matrix summarizes; the
registry decides.

## Distribution (registry, validator-verified)

| Classification      | Columns | Notes                                                                                                                                                                                  |
| ------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `restricted`        | 2       | `vehicle_identifiers.raw_value`, `vehicle_identifiers.normalized_value` — chassis/engine numbers live HERE, row-gated by `iam.has_permission('iam.sensitive.view')` for read AND write |
| `internal`          | 318     | Everything else — tenant-internal operational data                                                                                                                                     |
| `public` / `secret` | 0       | No veh column is public; secrets never enter module schemas                                                                                                                            |

## Search eligibility (6 columns — the complete set)

`vehicles.vin_normalized`, `vehicles.display_number`,
`plate_history.plate_normalized`, `makes.name`, `models.name`, `trims.name`.
The validator FAILS if a restricted column is ever flagged searchable, and
`veh-search.test.ts` pins the searchable set to exactly this list.

## Per-column dimensions

For every column the registry records `classification`, `searchable`, and
`dataType` (live-type drift fails the validator). The behavioral dimensions —
history eligibility, audit eligibility, retention, masking/gating — are
governed at the TABLE level in this phase and documented in the
[audit and history matrix](./veh-audit-and-history-matrix.md) and the
[data dictionary annex](./veh-data-dictionary.md):

- **History-eligible**: the tracked `veh.vehicles` master attributes (attribute
  history) + both status axes (status ledger). Restricted identifier values
  are structurally EXCLUDED from history (never master columns).
- **Audit-eligible**: all append-only ledgers (server-stamped); forensic audit
  is P1-16.
- **Retention**: veh rows follow the shared retention framework (Phase 1-5);
  no veh-specific retention class exists yet — nothing is deleted in this
  phase (no DELETE grants at all).
- **Masking/gating**: row-level permission gate on restricted identifier rows;
  no column-masking views (same posture as CRM, by design).

## Downgrade protection

`vehicle_identifiers.classification` is immutable per row (guard, 23514); the
registry validator rejects restricted+searchable and type drift; the
data-dictionary guard keeps every column documented. Executable: QA-008 §18,
`veh-classification-guard.test.ts` (6 negative fixtures).
