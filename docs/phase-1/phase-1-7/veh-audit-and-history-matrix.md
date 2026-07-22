# Vehicle Audit and History Matrix (P1-07)

What is recorded, where, and by which mechanism — and what is deliberately NOT
claimed. **No forensic audit integration exists in this phase**: no `veh` write
path calls `iam.audit_append`, and the forensic trail is Phase 1-16/1-17. The
attributable record at the database layer is the append-only history set below.

> **Amended 2026-07-21 (DBCR-P1-13-001).** This page originally said
> `iam.audit_append` "is not granted to any app role". That is no longer true —
> `app_runtime` now holds EXECUTE on it, tenant-scoped, so the Phase 1-13 backend
> foundation can emit audit records. Nothing about the `veh` ledgers below
> changed: they are still trigger-written, and no `veh` code path appends an
> audit record.

| Ledger                      | Trigger mechanism                                                                                | What writes it                  | Attribution                                                        | Forgery posture                                                                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vehicle_attribute_history` | AFTER UPDATE emit on `veh.vehicles` (one row per changed tracked attribute, same tx, no-op safe) | The master UPDATE path          | `shared.stamp_status_history` (actor + occurred_at server-stamped) | Attribution unforgeable; direct content insert remains possible while runtime holds INSERT for the trigger path — attributable, accepted Medium #33 ([abuse record](../../database/veh-abuse-case-record.md)) |
| `vehicle_status_history`    | AFTER UPDATE emit on `veh.vehicles` (one row per changed axis)                                   | The master UPDATE path          | server-stamped                                                     | **Coherence-guarded**: `to_state` must equal the live master → forged transitions rejected (23514). Stronger than the CRM timeline analogue                                                                   |
| `vin_verifications`         | Direct INSERT (results storage)                                                                  | Verification path (P1-17)       | server-stamped; override requires reason                           | Same accepted-Medium posture as attribute history                                                                                                                                                             |
| `odometer_readings`         | Direct INSERT under per-Vehicle lock                                                             | Reading capture paths           | `recorded_by` server-stamped                                       | Downward movement only via reasoned anomaly-flagged correction; cycles impossible                                                                                                                             |
| `battery_readings`          | Direct INSERT                                                                                    | Capture path                    | server-stamped                                                     | Append-only, 42501 on mutation                                                                                                                                                                                |
| `relationship_evidence`     | Direct INSERT                                                                                    | Evidence path                   | server-stamped                                                     | Append-only; same-tenant document link only                                                                                                                                                                   |
| `vehicle_merges`            | Direct INSERT = the atomic merge primitive                                                       | Merge path (P1-17 orchestrates) | `merged_by`/`merged_at` server-stamped                             | One record per source; the AFTER trigger owns the state transition; failed merge leaves no partial state                                                                                                      |

## Mutable tables' change accounting

Mutable masters/config (`vehicles`, catalogs, `vehicle_identifiers`,
`vehicle_ev_profiles`, `battery_masters`, `vehicle_alerts`,
`duplicate_candidates`) carry `record_version` + touch metadata
(`updated_at/by`) and immutable identity columns; `veh.vehicles` additionally
emits attribute + status history (above). Temporal tables are close-only (see
the [interval matrix](./veh-interval-semantics-matrix.md)) — their history IS
the row set.

## Ordering and correlation

Every append-only ledger has `seq bigint GENERATED ALWAYS AS IDENTITY` for
deterministic same-timestamp/same-transaction ordering, and a nullable
`correlation_id` (populated from `app.correlation_id` where emitted by
trigger) so P1-17 can stitch multi-table operations.

## Phase 1-16/1-17 boundary (honest claim)

This phase provides: attributable, ordered, tenant-scoped history with
server-stamped actors. It does NOT provide: hash-chained forensic audit
(`iam.audit_*` — P1-16), API-gated write paths (P1-17), or retention execution
(shared retention framework applies at P1-16+).
