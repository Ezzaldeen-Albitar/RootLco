# P1-12 Remediation Register — Release 2 Database Gate

**Company:** RootLco — Root Link Company · **Release:** Release 2 — Core Business Database ·
**Phase:** P1-12 · **Base:** protected `origin/develop` = `5cd16da`.

**Governance / self-review note.** Remediations recorded here were performed by an
owner-authorized **self-review** by Eng. Ezzaldeen Al-Bitar under the Solo Developer Review
Policy and Standing Technical Authorization Policy — **not** an independent third-party audit.
P1-12 permits only narrowly-scoped **additive** remediation migrations for evidence-backed gate
blockers; no such blocker was found, so **no remediation migration was applied**. All
remediations below are review-criteria corrections that changed how a finding is classified,
not the schema.

## Summary

| Measure                                                  | Value |
| -------------------------------------------------------- | ----- |
| Gate-blocking defects requiring code/schema remediation  | **0** |
| Additive remediation migrations applied                  | **0** |
| Review-criteria corrections (false-positive resolutions) | **2** |
| Migrations edited (merged)                               | **0** |

The 113 merged migrations are unchanged; all remain additive / forward-only with a
rollback-classification header (113/113).

## Remediations

### REM-P1-12-001 — Cascade classification corrected to runtime-reachability

- **Corresponds to:** DEF-P1-12-002 (structural false-positive)
- **Type:** Review-criteria correction (no schema change)
- **Action:** The structural review's destructive-cascade check was corrected to test **runtime
  reachability** — i.e., whether any application role actually holds a `DELETE` grant on a
  cascade parent — instead of flagging every `ON DELETE CASCADE` definition.
- **Result:** The five `ON DELETE CASCADE` foreign keys (see `defect-register.md`
  DEF-P1-12-001) are confirmed **not runtime-reachable**; classified administrative-only.
  Post-correction: **0 runtime-reachable destructive cascades**.
- **Evidence:** `evidence/structural-review.json`
  (`no_runtime_reachable_destructive_cascade: true`,
  `runtime_reachable_destructive_cascades: []`).
- **Migration required:** None.

### REM-P1-12-002 — Duplicate-index classification corrected to full-definition equivalence

- **Corresponds to:** DEF-P1-12-003 (structural false-positive)
- **Type:** Review-criteria correction (no schema change)
- **Action:** The duplicate-index check was corrected to require **full-definition** equivalence
  (columns, predicate, opclass, order, uniqueness) rather than column-overlap alone.
- **Result:** No true duplicate indexes across the 999 live indexes. Post-correction: **0 TRUE
  duplicate indexes**.
- **Evidence:** `evidence/structural-review.json`
  (`no_duplicate_indexes: true`, `duplicate_indexes: []`).
- **Migration required:** None.

## Carried residual (not remediated in P1-12)

- **M-wty-2b** (carried from P1-11): finer `odometer_at_issue` / `start_date` value binding remains
  inside `wty.issue_warranty`; the structural coherence guard `tg_warranty_records_coherence`
  already enforces the `delivered` delivery + matching `vehicle_id` / `work_order_id` binding.
  Accepted as residual; claim adjudication is out of scope. Recorded in
  `waiver-risk-acceptance-register.md`, not remediated here.

## Status

**COMPLETE — no remediation migration required.** Both remediations are review-criteria
corrections that resolved tooling false-positives; the integrated schema and the 113 merged
migrations are unchanged. Zero gate-blocking defects remained to remediate.
