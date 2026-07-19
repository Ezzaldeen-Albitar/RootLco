# Phase 1-7 Review-Response Ledger

Red-team review of the full branch diff (base `416cf9e`) across 12 lenses
(data architecture, temporal integrity, VIN/identifier security, ownership
privacy, authorized-person scope, odometer fraud, EV/battery, RLS/grants,
duplicate/merge, QA coverage, documentation accuracy, final integration),
under the owner-authorized technical/security self-review policy — **not** an
independent third-party review. Findings are dispositioned below; a second
validation pass (clean-room + full guards) was run after the correction commit.

## Findings and dispositions

| ID   | Lens                    | Severity | Finding                                                                                                                                                                                                                                        | Disposition                                                                                                                                                                                                                                                                                                    |
| ---- | ----------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RT-1 | VIN/identifier security | **High** | `tg_vehicles_activation_guard` fired only on `INSERT OR UPDATE OF lifecycle_status`. `UPDATE veh.vehicles SET vin_raw = NULL` on an **active, identifier-less** Vehicle bypassed CR-VEH-03, committing an active Vehicle with zero identity.   | **FIXED** — migration `20260720105000` re-fires the guard on `UPDATE OF vin_raw` and re-validates on any VIN change while active. Regression: `veh-review-hardening.test.ts` (rejects blanking without an alternate; allows it with one; still allows a VIN swap).                                             |
| RT-2 | EV/battery              | **High** | `tg_vehicle_ev_profiles_powertrain` did not fire on `UPDATE OF deleted_at`. Sequence: soft-delete the bev profile → change the Vehicle to `ice` (now legal) → un-soft-delete the profile → a **live bev profile on an ICE Vehicle** committed. | **FIXED** — migration `20260720105000` adds `deleted_at` to the trigger's firing columns and validates whenever the row is (or becomes) live; a dying row is exempt. Regression: `veh-review-hardening.test.ts` (rejects resurrection onto ICE; still allows soft-delete and same-powertrain resurrection).    |
| RT-3 | duplicate/merge         | Medium   | `veh.valid_match_basis` / `veh.jsonb_no_raw_values` comment claimed "no raw identifier values", but the control is a heuristic (sensitive-key scan + 128-char leaf bound); a short raw value under an innocuous key passes.                    | **ACCEPTED (Medium)** — the DB CHECK is defense-in-depth; the P1-17 backend sanitizer is the primary control. Function comment corrected in `20260720105000`; recorded in the [abuse-case record](../../database/veh-abuse-case-record.md) accepted register with rationale, present control, and owner phase. |

## Confirmed-sound areas (no findings)

The following were probed and found correct against the SQL and tests:

- Vehicle-master independence (zero owner/partner columns) and composite
  same-tenant FKs throughout.
- Temporal EXCLUDE constraints and `guard_temporal_close` on all five interval
  tables; boundary-correct `[)` resolvers.
- Active-VIN partial-unique predicate; restricted-identifier gate on
  SELECT+INSERT+UPDATE; classification immutability.
- Crown-jewel privacy: no veh function reads a CRM PII table; `owner_at`
  returns a uuid only; cross-tenant zero.
- Authorized-person scope validator (unknown/duplicate action, wrong version,
  non-object, wrong-role rejection; scope immutable in place).
- Odometer canonical-km computation equals the generated expression;
  correction ordering + per-Vehicle lock; no cycle.
- Merge atomicity (AFTER-INSERT primitive, whole-tx rollback on rejection),
  survivor resolution, same-source/symmetric race single-winner.
- RLS/FORCE on every table; no grant beyond the documented matrix; no
  SECURITY DEFINER; resolvers filter under RLS with no cross-tenant existence
  oracle (invisible rows return empty/NULL, no distinguishing error).

## Post-fix revalidation

After `20260720105000` + the regression suite, the clean-room sequence and the
full DB suite were re-run green (see the
[evidence register](./phase-1-7-evidence-register.md)). Zero unresolved
Critical or High findings remain; the five accepted Mediums and two accepted
Lows are centralized in the abuse-case record's accepted register.
