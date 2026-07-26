# P1-19 — QA evidence

## The battery, and what each number means

| Suite                        | Protected base `f326e24` | P1-19 HEAD | Delta    | P1-19's own tests |
| ---------------------------- | ------------------------ | ---------- | -------- | ----------------- |
| Unit (`npm test`)            | 829                      | 843        | **+14**  | 14                |
| Database (`npm run test:db`) | 1547                     | 1610       | **+63**  | 63                |
| Backend (`test:backend`)     | 771                      | 1060       | **+289** | 289               |

Every delta equals the phase's own new tests exactly. That is the point of listing
both columns: it shows this phase added tests and **changed none of the inherited
ones**. If a predecessor's assertion had been weakened to make a P1-19 change pass, the
delta and the own-tests count would disagree.

The three own-test figures were measured directly —
`vitest run --config vitest.config.<suite>.ts tests/<dir>/p1-19` — not inferred from
the deltas they are being checked against.

### Four inherited test files were edited, and none of them is an exception to the above

`git diff --name-only f326e24 HEAD -- tests` names exactly four files outside the
phase's own:

| File                                                          | Change                                      |
| ------------------------------------------------------------- | ------------------------------------------- |
| `tests/db/p1-15-shared-services-runtime-capabilities.test.ts` | The `iam.permissions` census: 71 → **93**   |
| `tests/foundation/p1-15-catalogs.test.ts`                     | The permission and audit-action censuses    |
| `tests/foundation/event-envelope.test.ts`                     | The event-catalog census                    |
| `tests/openapi-contract.test.ts`                              | Regenerated document (110 → 168 operations) |

All four are **censuses**: they assert how many permissions, audit actions, events or
published operations the registries hold. P1-19 seeds 22 new permission codes, so those
counts necessarily move, and a census left stale is simply broken rather than strict.
The pin is retained rather than removed — moving it with the seed is exactly what makes
it catch an accidental catalog edit — and each edit carries the arithmetic in a comment
at the assertion.

**No behavioural assertion anywhere in the repository was relaxed.** That is checkable
in the diff: none of the four touches a `toThrow`, a status-code expectation, or a
policy or RLS assertion.

## Test files

| File                                                     | Tests | Subject                                                             |
| -------------------------------------------------------- | ----- | ------------------------------------------------------------------- |
| `tests/foundation/p1-19-module-foundation.test.ts`       | 14    | The four module boundaries, their public surfaces, catalog wiring   |
| `tests/db/p1-19-catalog-reconciliation.test.ts`          | —     | The deployed `wo`/`tech` catalogs against the code's expectations   |
| `tests/db/p1-19-closure-blocker-reconciliation.test.ts`  | —     | B1–B6 against the deployed `wo.guard_work_order_closure` body       |
| `tests/db/p1-19-diagnostic-graph-reconciliation.test.ts` | —     | `REPORT_TRANSITIONS` against the deployed `dia` guard body          |
| `tests/db/p1-19-work-order-core.test.ts`                 | —     | The work-order creation preconditions as the database enforces them |
| `tests/backend/p1-19-work-order-core.test.ts`            | 25    | Transition, closure, closure eligibility                            |
| `tests/backend/p1-19-work-order-reads.test.ts`           | 14    | Work-order list, detail, history                                    |
| `tests/backend/p1-19-work-order-jobs.test.ts`            | 15    | Job create, update, history                                         |
| `tests/backend/p1-19-work-order-lines.test.ts`           | 10    | Service lines and required parts                                    |
| `tests/backend/p1-19-job-lifecycle.test.ts`              | 10    | Job transitions against the catalog graph                           |
| `tests/backend/p1-19-job-assignments.test.ts`            | 21    | Assignment, reassignment, ending, eligibility                       |
| `tests/backend/p1-19-labor-sessions.test.ts`             | 14    | Labour start/stop/correct and the overlap exclusion                 |
| `tests/backend/p1-19-additional-work.test.ts`            | 39    | Additional-work requests, restricted detail, withdrawal             |
| `tests/backend/p1-19-customer-approvals.test.ts`         | 31    | Approvals, evidence, the unapproved-work execution gate             |
| `tests/backend/p1-19-diagnostics.test.ts`                | 60    | The whole `dia` surface                                             |
| `tests/backend/p1-19-quality-rework.test.ts`             | 41    | QC, reopen refusal, rework                                          |
| `tests/backend/p1-19-operational-journey.test.ts`        | 1     | One vehicle, end to end, through the real routes                    |

The four DB files hold 63 tests between them; the per-file split is not listed because
several are table-driven and a hand-written count would be a number nobody re-derives.

## Reconciliation tests exist because mirrored knowledge rots

Three of the four DB tests exist for the same reason: this phase mirrors protected
database knowledge into TypeScript in exactly three places, and each mirror is pinned
against the **deployed** object rather than against the migration file that created it.

- **B1–B6.** `wo.guard_work_order_closure` raises on the FIRST blocker and aborts, but
  `GET /closure-eligibility` must report every unmet blocker, so the six are
  re-evaluated independently in a read-only path. The reconciliation test reads the
  deployed function body and asserts the registry has exactly six entries matching it —
  so a seventh blocker added to the database can never be silently unreported.
- **The diagnostic report graph.** `dia.guard_diagnostic_report_transition` is a fixed
  PL/pgSQL `IF` chain with no catalog table, so mirroring it is legitimate. The test
  asserts the mirror's key set equals the CHECK vocabulary, that both terminal statuses
  have no outbound edge, and that the completion gate still counts mandatory items of
  the report's **pinned** version.
- **The work-order and job graphs are deliberately NOT mirrored.**
  `wo.work_order_transitions` and `wo.job_transitions` are tenant-overridable catalog
  tables. A TypeScript copy would refuse a tenant's own edge the moment one was added,
  so those graphs are read at request time and no copy exists to reconcile.

## Operation depth

`scripts/check-operation-test-coverage.mjs` reports **58/58** P1-19 operations at
operation depth with **0** pending, **0** invocation-only, **0** unit-only, **0**
unreferenced and **0** metadata-only. The per-operation evidence flags are restated
beside each surface in [`task-traceability.md`](task-traceability.md).

**The gate's limit, stated plainly.** It verifies that an operation id appears in
executable code within a test that declares an evidence flag. It does **not** verify
that an assertion backs the flag. Eight P1-17 operations were credited on evidence that
did not exist, and an earlier revision of this phase's own Wave 8 suite claimed
authorization, denial and isolation evidence for five reads while performing every one
of them as a fully-permitted principal. Both were found by reading the assertions, not
by running the gate. Every evidence claim in this phase was re-derived the same way.

## What the journey test proves that the unit suites cannot

`p1-19-operational-journey.test.ts` is one test, and it is the most expensive one here.
It drives a single vehicle through the real route handlers: reception conversion → work
order → job → assignment → labour start/pause/resume/stop → diagnostic report with a
measurement, a DTC, a finding, evidence, a recommendation, completion and review →
additional-work request → customer approval → execution gate cleared → fulfilment → job
completion → quality control → closure eligibility → closure → reopen refused → rework
order → independent sign-off → rework closure.

It ends by asserting **two closed work orders against one reception visit**, which is
the property the whole rework mechanism exists to produce and which no single-surface
suite can observe. It also caught a real ordering defect the per-surface suites did not:
a diagnostic report cannot be completed before a recommendation exists.

## Concurrency, rollback and stale-version coverage

- **Rollback.** `qms.rework-create` writes a work order and a rework link in one
  transaction. The rollback probe removes the accepted custody event so
  `wo.guard_work_order_refs` refuses **after** the display number has been allocated,
  then asserts neither row exists. Testing the refusal alone would not distinguish
  "refused" from "refused and left half a record behind".
- **Stale version.** Every `If-Match` command has a probe that submits a version the
  row has moved past and asserts `ERR-CON-001`. The four commands that decline
  idempotency (`wo.job-update`, `wo.job-assignment-end`, `tech.labor-session-stop`,
  `tech.labor-session-correct`) rely on this check alone and each refuses a missing
  `If-Match` outright with `ERR-CON-002`.
- **Locking.** Every id-addressed command locks its authoritative row `FOR UPDATE`
  before reading the state it will branch on, so a concurrent transition cannot commit
  between the read and the write. The deferred scope check runs against that locked row.
- **Labour overlap** is an `EXCLUDE` constraint in the database, not application code;
  the suite drives the overlap through the route and asserts the database's refusal.

## Known limits

- **`P1-19-A-02`** — diagnostic revision numbering rests on an advisory lock with no
  unique constraint behind it. Closing it requires a migration, which this phase is not
  authorised to write.
- **`P1-19-A-03`** — seven `P1-19-BE-nnn` annotations reach operations in two different
  schemas, so the in-code annotations are not a reliable task map.
- **`P1-19-A-04`** — `wo.work-order-detail` declares `standard-command` where the other
  22 reads declare `expensive-read`, without justification.
