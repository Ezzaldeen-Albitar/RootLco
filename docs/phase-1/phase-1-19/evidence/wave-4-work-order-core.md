# Wave 4 — Work-order core

Tasks: **P1-19-BE-002 … P1-19-BE-010**. Eight operations, all at operation depth,
0 pending.

## What shipped

| Operation                           | Route                                       | Permissions                                        | Audit                         | Event                      |
| ----------------------------------- | ------------------------------------------- | -------------------------------------------------- | ----------------------------- | -------------------------- |
| `wo.work-order-list`                | `GET /work-orders`                          | `wo.work_order.read`                               | —                             | —                          |
| `wo.work-order-detail`              | `GET /work-orders/{id}`                     | `wo.work_order.read`                               | —                             | —                          |
| `wo.work-order-history`             | `GET /work-orders/{id}/history`             | `wo.work_order.read`                               | —                             | —                          |
| `wo.work-order-closure-eligibility` | `GET /work-orders/{id}/closure-eligibility` | `wo.work_order.read`                               | —                             | —                          |
| `wo.work-order-transition`          | `POST /work-orders/{id}/transition`         | `wo.work_order.transition`                         | `wo.work_order.state_changed` | `work-order.state-changed` |
| `wo.work-order-closure`             | `POST /work-orders/{id}/closure`            | `wo.work_order.transition` + `wo.work_order.close` | `wo.work_order.closed`        | `work-order.closed`        |
| `wo.job-create`                     | `POST /work-orders/{id}/jobs`               | `wo.job.manage`                                    | `wo.job.created`              | —                          |
| `wo.job-update`                     | `PATCH /jobs/{jobId}`                       | `wo.job.manage`                                    | `wo.job.updated`              | —                          |

**No `POST /work-orders`.** See the reconciliation below.

## Five findings this wave produced, all in code that had already been reviewed

1. **The transition reason never reached the database.** `wo.work_orders` has no
   reason column: `wo.guard_work_order_transition` reads
   `NULLIF(btrim(current_setting('app.status_reason', true)), '')` and raises
   `check_violation` when the edge or the target state requires a reason and it is
   unset, and `wo.emit_work_order_status_history` copies the same GUC into the
   ledger's `reason`. No module in `src/` set that GUC — reception never needed one.
   Every reason-required edge (`→ cancelled`, `in_progress → awaiting_parts`,
   `in_progress → awaiting_customer`, `qc_pending → in_progress`) would have failed
   as a raw `23514` **after** the service had validated the reason, and every ledger
   row's reason would have been NULL. `applyState` now publishes it
   transaction-locally and clears it after.

2. **`wo.work_order.close` was seeded and enforced nowhere.** Permissions are a
   conjunction, so one operation declaring both codes would demand the closing
   authority for every ordinary move, and declaring only `transition` would leave
   the second code documentary. Closure is now its own operation, and the transition
   endpoint refuses a terminal non-cancellation target so the split cannot be
   bypassed by choosing the other URL. Both commands enter one private service move,
   so B1–B6 and `wo.guard_work_order_closure` apply identically either way.

3. **`PATCH /jobs/{jobId}` had no scope target at all.** Addressed by job id alone,
   `scope: 'branch'` was inert (P1-18-A-01). `JobRow` now carries the job's own
   company and branch — `fk_jobs_work_order` guarantees they equal the parent's —
   and the check is re-decided against the locked row.

4. **A raced job insert would have been a 500.** `createJob` reads the parent
   without a lock to produce a readable refusal; `wo.guard_job_refs` locks it inside
   the INSERT. A parent that becomes terminal in that window makes the guard raise a
   bare `check_violation`, which was unmapped. Now `ERR-TRN-001`.

5. **Path and query validation escaped the pipeline.** `parseOrFail` ran before
   `handleOperation`, so a malformed id threw out of the route function instead of
   being rendered as the shared problem document — a 500 where a 422 was owed. Every
   Wave 4 route now parses inside the pipeline, and the list route reads its
   authorization target through the platform's `scopeTargetOption`, which yields no
   target unless both ids are well-formed UUIDs and therefore can only make
   authorization stricter.

## Two design decisions recorded rather than assumed

**Closure emits ONE audit record, not two.** The action catalog's original text said
both `wo.work_order.state_changed` and `wo.work_order.closed` would exist for a
closing transition. That is now corrected in the catalog itself: a closing
transition is recorded under `wo.work_order.closed` INSTEAD of the generic action,
so a count of state changes and a count of closures cannot double-count one event.
One transition writes exactly one ledger row, one audit record and one outbox event.

**The history view carries an `origin` block, and nothing is fabricated.**
`wo.emit_work_order_status_history` is AFTER UPDATE only, so the insert that opens a
work order emits no ledger row and the oldest entry is the FIRST transition. A
backfilled genesis row would be worse than none: `shared.stamp_status_history`
forces `occurred_at := now()`, so it would claim the order opened at the moment of
the backfill. The opening is therefore reported from columns that hold it —
`opened_at`, `created_by`, and the oldest entry's own `fromState` (or the current
state while the ledger is empty).

## The `POST /work-orders` reconciliation

The execution brief asked for a creation endpoint. It is deliberately absent, and
this is the phase boundary rather than an omission.

`POST /receptions/{receptionId}/convert-to-work-order` (P1-18-BE-019) already
inserts `wo.work_orders`. It holds the reception-visit lock, answers a replay with
the work order it already created, and is the path
`uq_work_orders_ordinary_origin` — a PARTIAL unique index on
`(tenant, company, branch, reception_visit_id) WHERE kind = 'ordinary' AND deleted_at IS NULL`
— was designed around. A second insert here would not hold that lock, so two
concurrent callers using two different paths would race that index and one would
receive a raw `23505`. Reception writes only six columns plus the display number and
leaves `kind`, `state`, `parts_forward_state` and `opened_at` to their frozen
defaults, with a comment saying why: choosing them "would be this module deciding
how work is organised — which is Phase 1-19's contract, not reception's".

So reception opens the shell and P1-19 owns everything after. The boundary is proved
end to end rather than asserted: the shared fixture creates every work order through
the real conversion route, and the integration case walks conversion → `draft`
shell → transition → job → closure blocked (B1) → blocker cleared → closed.

A **rework** work order against an already-converted visit remains legal — the index
constrains `kind = 'ordinary'` only, and `guard_work_order_refs` admits a
`converted` visit. That creation path belongs to Wave 8, and `EVT-WOR-001`
(`work-order.created`) stays `implementedIn: null` until it exists: conversion's own
merged gate evidence asserts its tenant outbox stays empty, and publishing from
reception would also require a producer prefix the envelope refuses.

## Evidence

### Local battery at the Wave 4 head

| Gate                           | Command                                           | Result                                             |
| ------------------------------ | ------------------------------------------------- | -------------------------------------------------- |
| Formatting                     | `npm run format:check`                            | **Pass** — all files                               |
| Lint                           | `npm run lint`                                    | **Pass** — 0 problems                              |
| Type checking                  | `npm run typecheck`                               | **Pass**                                           |
| Module boundaries              | `npm run validate:module-boundaries`              | **Pass** — 279 files scanned                       |
| Authorization coverage         | `npm run validate:authorization-coverage`         | **Pass** — 118 operations                          |
| Operation coverage             | `npm run validate:operation-coverage`             | **Pass** — P1-19 **8/8** depth                     |
| OpenAPI                        | `npm run validate:openapi`                        | **Pass** — 102 paths / 118 ops                     |
| Unit                           | `npm test`                                        | **843** passed / 40 files                          |
| Backend                        | `npm run test:backend`                            | **825** passed / 41 files                          |
| Database                       | `npm run test:db`                                 | **1604** passed / 135 files                        |
| WO/TECH/DIA/QMS classification | `npm run validate:wo-tech-dia-qms-classification` | **Pass** — 657 columns, 3 restricted, 0 searchable |
| Encoding                       | `npm run validate:encoding`                       | **Pass**                                           |
| Canonical documents            | `npm run validate:canonical-docs`                 | **Pass** — 2 verified, unmodified                  |
| Security                       | `npm run security:all`                            | **Pass** — 4 scanners, 1135 files                  |
| Production build               | `npm run build`                                   | **Pass**                                           |

Backend moved **771 → 825** (+54: 25 core, 14 reads, 15 jobs). Unit and database
totals are unchanged, which is the expected shape — Wave 4 adds no migration, no
seed and no catalog row.

### Operation depth

`docs/phase-1/phase-1-19/evidence/operation-test-matrix.json` is generated by the
gate. P1-19: 8 registered, 8 at operation depth, 0 invocation-only, 0 pending,
0 unit-only, 0 unreferenced, 0 metadata-only.

The gate was extended for the four P1-19 namespaces (`wo.`, `tech.`, `dia.`,
`qms.`), including the **strict** comment-stripping ratchet P1-18 introduced: an
operation counts as invoked only when its id appears in executable code, never in
prose about a test.

### The two isolation mechanisms, told apart

Every id-addressed operation is probed with **two** narrowed principals, because
they fail differently and conflating them would credit RLS with a control it does
not provide:

- `PERMISSION_ELSEWHERE` holds the work-order permissions in `BRANCH_A2` **and an
  unrelated permission in `BRANCH_A1`**. `iam.allowed_branch_ids()` is the union of
  every active grant regardless of the permission it carries, so RLS makes the
  `BRANCH_A1` row **visible** — it cannot answer 404. The **403** therefore proves
  the deferred scoped permission evaluation is what refuses the write. This is
  P1-18-A-01 exactly.
- `SCOPED_ELSEWHERE` holds no grant in `BRANCH_A1` at all, so the row is invisible
  and the answer is the uniform **404** — defence in depth, and no existence oracle.

A cross-tenant caller with an **unrestricted** grant is a third case and gets
neither: `iam.has_permission_in_scope` short-circuits on `scope_mode =
'unrestricted'` without consulting the target, so authorization cannot refuse it.
What contains it is the tenant predicate, and the list endpoint answers an empty
page — which discloses less than a 403 or 404 would.

## Deliberately deferred, with the reason

| Deferred                                                    | Why                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Technician filter on the board                              | `wo.job_assignments` has no write path until Wave 5, so a filter over it could not be exercised against data the shipped code produces                                                                                                                                                    |
| Assignments / approvals / diagnostics / QC in the aggregate | Each becomes writable in Waves 5–8; an always-empty block would publish a contract nothing can populate                                                                                                                                                                                   |
| Job state transitions                                       | Wave 5. `wo.guard_job_transition` was REPLACED by the assignments migration to require an active assignment before an `assignment_required` state, so `planned → assigned` is unreachable until then. The integration case clears B1 via `planned → cancelled`, which needs no assignment |
| `EVT-WOR-001` (`work-order.created`)                        | Wave 8, with the rework creation path — see the reconciliation above                                                                                                                                                                                                                      |

## Known limitation, recorded rather than hidden

The board orders by `(opened_at DESC, id DESC)` and no index covers that ordering:
`ix_work_orders_open_by_branch` is `(tenant, company, branch, state) WHERE deleted_at IS NULL`.
The branch predicate and the `LIMIT` bound the scan, and the sort happens over one
branch's rows only, so it is correct and bounded — but the ordering itself is not
index-aligned. Adding an index would be a migration, and no migration is authorised
in this phase. Tracked as **P1-19-A-01** for the Wave 9 open-decision register.

The history ledger ties on `id` rather than `seq` even though
`ix_work_order_status_history_wo` is `(…, occurred_at DESC, seq DESC)`, because
`decodeCursor` requires a UUID tie-breaker platform-wide (P1-15-SR-013) and a bigint
there would surface a malformed cursor as a raw `22P02` 500 instead of
`ERR-PAG-001`. The index's `occurred_at DESC` prefix is still used for the seek.

## OpenAPI

Regenerated with the canonical command, never hand-edited:

```
UPDATE_OPENAPI=1 npx vitest run tests/openapi-contract.test.ts
```

94 paths / 110 operations → **102 paths / 118 operations**, which is the eight new
operations exactly. The arithmetic is checked externally rather than by the
generator comparing against itself: `check-authorization-coverage.mjs` counts
registered operations and `check-openapi.mjs` counts published ones, and both report 118. All eight route modules were added to the hand-maintained import list in
`tests/openapi-contract.test.ts` — the mechanism that once hid all twelve P1-18
operations from the published contract while every gate read green — and `dia`,
`qms`, `tech` and `wo` were added to `SEEDED_DOMAINS` in the same file, without
which the permission-catalog assertion is vacuous for this phase.

The generated document describes operations at metadata depth — operation id,
summary, tags, security, required permissions, scope, audit class, rate-limit
policy, cache category, and the shared problem document for every failure. Request
bodies, response schemas and query parameters are **not** in the generated shape for
any of the 118 operations; `buildOpenApiDocument` emits a generic
`{ type: 'object' }` success body platform-wide. Publishing per-operation schemas
would mean rewriting the generator for every previously merged phase, which is not a
change a feature phase may make to a published contract. Recorded here as the
reconciliation of the brief's schema-level OpenAPI requirement against the shipped
generation mechanism.

## The temporary recovery directory is gone

`docs/phase-1/phase-1-19/wave-4-pending/` held two route handlers as `.txt` while
their tests did not exist. Both are now restored to `src/`, both are at operation
depth, and the directory has been removed. Executable code is not preserved under
documentation as an architecture.
