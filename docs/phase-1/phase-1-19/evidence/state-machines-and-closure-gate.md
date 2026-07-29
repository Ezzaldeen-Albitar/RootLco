# P1-19 — State machines and the closure gate

Four state machines are reachable through this phase's surface. They are enforced in
three different ways, and the difference is not cosmetic — it decides where a rule can
live and whether TypeScript may hold a copy of it.

| Machine                 | Authority                                   | Mirrored in code? |
| ----------------------- | ------------------------------------------- | ----------------- |
| Work-order state        | `wo.work_order_transitions` (catalog TABLE) | **No**            |
| Job state               | `wo.job_transitions` (catalog TABLE)        | **No**            |
| Diagnostic report       | `dia.guard_diagnostic_report_transition`    | **Yes**           |
| Additional-work request | `wo.guard_additional_work_state`            | **Yes**           |

## Why two are mirrored and two are not

`wo.work_order_transitions` and `wo.job_transitions` are **tenant-overridable catalog
tables**. A tenant can be given an edge the platform did not ship. A TypeScript copy of
those graphs would refuse that tenant's own edge, and would do it silently and
correctly-looking, so the work-order module reads both graphs at request time and keeps
no copy at all. That read is not a performance concession — it is the only
implementation that cannot become wrong.

`dia.guard_diagnostic_report_transition` is the opposite: a fixed PL/pgSQL `IF` chain
(`draft → in_progress | cancelled`, `in_progress → completed | cancelled`, both
terminal) with no catalog table and no tenant override. It is code, and code can be
mirrored — which lets the application refuse an illegal edge before opening a
transaction rather than turning a constraint violation into a 500.

A mirror is worth only what keeps it honest.
`tests/db/p1-19-diagnostic-graph-reconciliation.test.ts` pins `REPORT_TRANSITIONS`
against the **deployed** function body, asserts both terminal statuses have no outbound
edge, asserts the mirror's key set equals the CHECK vocabulary exactly, and asserts the
completion gate still counts mandatory items of the report's **pinned** template
version. Without that test the distinction above would be a story rather than a
property.

## The additional-work machine, and why approval comes first

`pending → approved | rejected | withdrawn`, with `approved` additionally carrying a
fulfilment state whose CHECK vocabulary is `unfulfilled | fulfilled | waived`.

A caller may set only `fulfilled` or `waived`. `unfulfilled` is the column default and
the one value the workshop cannot choose: moving a request back to unfulfilled would
undo a completion nobody recorded, and `tg_additional_work_requests_immutable` does not
freeze the column, so nothing in the schema would refuse it. That limit is the
application's, and `SETTABLE_FULFILLMENT_STATES` is deliberately a separate constant
from the CHECK vocabulary so the two are never read as the same claim.

`wo.guard_additional_work_state` requires the **approval row to exist before** the
request moves to `approved`. That is not an ordering preference — it is what makes the
approval the cause of the state rather than a note attached to it afterwards. So the
decision and the state change are one transaction, and the service records the approval
first. One active approval per request, and its content is immutable once written.

## The closure gate: B1–B6

`wo.guard_work_order_closure()` is the protected authority and implements exactly six
blockers:

| Code   | Blocker                                                                                        |
| ------ | ---------------------------------------------------------------------------------------------- |
| **B1** | A non-terminal job remains on the work order                                                   |
| **B2** | An open-ended (`ended_at IS NULL`) labour session remains                                      |
| **B3** | A **required** additional-work request is `pending`, or `approved` + `unfulfilled`             |
| **B4** | A `requires_diagnostic` job has no `completed` diagnostic report                               |
| **B5** | QC failed with no passing record (**B5a**), or a mandatory check exists with no pass (**B5b**) |
| **B6** | Safety-critical rework on this work order lacks `independent_sign_off_by`                      |

### The trigger reports one blocker; the endpoint must report all six

The guard `RAISE`s `check_violation` on the **first** blocker it hits and aborts. A
caller told only "B1" fixes B1, retries, and is then told "B2" — an unbounded sequence
of round trips for a state they could have been shown at once.

`GET /work-orders/{id}/closure-eligibility` therefore re-evaluates all six
independently in a read-only path and returns every unmet blocker. The closure
**transition** still relies on the trigger as the authority: the service never becomes
the enforcement point, only the reporter. The two are pinned together by
`tests/db/p1-19-closure-blocker-reconciliation.test.ts`, which reads the deployed
function body and asserts the registry holds exactly six entries matching it — so a
seventh blocker added to the database can never be silently unreported.

### B5 has two limbs and they are different questions

**B5a** asks whether a failed record stands unsuperseded. **B5b** asks whether a
mandatory check is configured tenant-wide with no passing record at all. A work order
with no QC record whatsoever fails B5b and passes B5a. The registry keeps them separate
(`failedWithoutPass`, `mandatoryPassMissing`) because collapsing them would tell a
caller to re-run a check that was never run.

Clearing a failure is done by opening a **new** record, never by editing the old one:
`qms.guard_qc_finalize` freezes a finalized record's result, checker and time, and
there is deliberately no unique index on `(work_order_id)`. B5 reads the SET, so a later
pass clears closure while the failure remains attributable in the ledger.

### Cancellation bypasses all six

`is_cancellation` states skip B1–B6 while still writing history. Abandoning a job is
not the same act as certifying it complete, and requiring a cancelled order to satisfy
a quality gate would force the workshop to fabricate a QC pass in order to stop.

### Two blockers the brief lists and the database does not have

The brief names "no active reservation" and "no open part issue" as closure conditions.
`wo.guard_work_order_closure` contains neither, because stock reservation and issue
execution are **Phase 1-21**.

No always-passing placeholder blocker was added. A blocker that always passes is worse
than an absent one: it reads as coverage in every report and enforces nothing. The two
conditions are recorded in `DEFERRED_CLOSURE_BLOCKERS` — owner, conditions and the
reason — so the registry states its own incompleteness instead of implying six is the
final number.

## Reopen is not a transition

`wo.guard_work_order_transition` has **no outbound edge from `closed`** (BR-WO-002), so
reopening is not a state the graph can reach. `qms.attempt_reopen()` exists so the
_attempt_ is attributable: it writes a `qms.reopen_attempts` row whose `outcome` is
CHECK-fixed to the single value `'rejected'`, and never touches the order.

The endpoint returns **201 with the recorded attempt**, not an error — the refusal is
the successful outcome. An earlier implementation threw, which rolled back the very
ledger row the mechanism exists to write.

The sanctioned way forward from a closed order is a **rework** order: a new
`wo.work_orders` row with `kind = 'rework'`, sharing the original's reception visit,
linked by `qms.rework_links`. That link is what B6 reads, and until this phase nothing
in the platform could create one.
