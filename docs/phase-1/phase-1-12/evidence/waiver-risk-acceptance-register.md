# P1-12 Waiver & Risk-Acceptance Register — Release 2 Database Gate

**Company:** RootLco — Root Link Company · **Release:** Release 2 — Core Business Database ·
**Phase:** P1-12 · **Base:** protected `origin/develop` = `5cd16da`.

**Governance / self-review note.** Acceptances recorded here are decisions of an
owner-authorized **self-review** by Eng. Ezzaldeen Al-Bitar under the Solo Developer Review
Policy and Standing Technical Authorization Policy — **not** an independent third-party audit.
Each entry states the control, residual risk, owner, and disposition. Nothing here is a silent
waiver: items pending an owner decision are recorded as **owner-decision-pending**, and no
Critical or High is accepted (there are none unresolved).

## Register

### WVR-P1-12-001 — Accepted residual M-wty-2b (carried from P1-11)

- **Type:** Accepted residual (Medium, structurally mitigated)
- **Origin:** Phase 1-11 warranty domain
- **Statement:** The finer `odometer_at_issue` / `start_date` value binding remains inside the
  `wty.issue_warranty` procedure rather than being enforced by a table constraint; warranty-claim
  adjudication is out of the P1-11 (and P1-12) scope.
- **Control in place:** The structural coherence guard `wty.guard_warranty_record_coherence` /
  `tg_warranty_records_coherence` (BEFORE INSERT) already requires a `delivered` delivery with a
  matching `vehicle_id` / `work_order_id`, so a raw `INSERT` into `wty.warranty_records` cannot
  bypass the delivery binding. Confirmed intact in the P1-12 integrated E2E (warranty bound to the
  delivered vehicle / work order / delivery).
- **Residual risk:** Low — value-level fields set only by the issue procedure; no runtime path
  inserts an incoherent warranty record.
- **Owner / disposition:** Eng. Ezzaldeen Al-Bitar — **Accepted**, carried unchanged from P1-11.
- **Evidence:** `phase-1-11-abuse-case-ledger.md` (S4 / M-wty-2), `integrated-scenario-report.md`.

### WVR-P1-12-002 — Performance targets PROPOSED (owner-decision-pending, not a waiver)

- **Type:** Owner-decision-pending (explicitly **not** a silent waiver)
- **Statement:** The Wave 6 performance baseline is a **PROPOSED validation baseline** measured on
  a generated, non-personal ephemeral dataset — **not** a production-capacity claim. No production
  performance target (throughput / concurrency / scale) is asserted or accepted at this gate.
- **Measured baseline (validation env, 30,000 partners + 30,000 vehicles, deleted after run):**
  - `partner_point_lookup` median 1.07 ms (p95 1.50, p99 1.75), index used, no seq scan
  - `vehicle_point_lookup` median 1.02 ms, index used, no seq scan
  - `partner` tenant-scoped count ~3.7 ms (bounded scan / isolation selectivity)
  - `partner_outstanding_balance` fn ~1.6 ms
- **Pending decision:** **P1-OD-027** (NFR-SCL) — production scale / capacity targets. Until the
  owner resolves it, these figures stand only as proposed validation baselines.
- **Owner / disposition:** Eng. Ezzaldeen Al-Bitar — **Owner-decision-pending**; recorded, not waived.
- **Evidence:** `evidence/performance-baseline.json`, `performance-baseline-report.md`.

## Open decisions carried (recorded, not accepted as waivers)

Carried from prior phases and tracked in `phase-1-12-traceability.md`; none blocks the gate:
**P1-OD-007, P1-OD-018…024, P1-OD-027, P1-OD-035, P1-OD-036, P1-OD-041, P1-OD-042.**

## Recovery-drill scope note (not a waiver — a stated boundary)

The Wave 7 backup/restore drill (restore measured at 8204 ms with schema-hash match) is a
**validation-environment drill only**. It does **not** establish a production backup scheduler,
and **no RPO/RTO compliance is asserted** beyond the measured restore time. Recorded as a scope
boundary, not an accepted risk.

## Status

**COMPLETE.** **Zero unresolved Critical or High.** One accepted residual (M-wty-2b) with an
active structural control; one owner-decision-pending item (performance targets, P1-OD-027)
recorded transparently rather than silently waived. No Medium remains unresolved beyond the
accepted residual.
