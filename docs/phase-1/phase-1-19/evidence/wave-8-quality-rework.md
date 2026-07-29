# Wave 8 — Quality control, reopen refusal and rework

Feature SHA `e18df4a`, remediated in the commit that follows it, on
`feature/p1-19-module-foundation`, PR #82. Base of this wave: `e90c4f5`.
**No migration and no seed changed.**

## Operations delivered

| Operation                 | Method | Path                                              | Permission                                        |
| ------------------------- | ------ | ------------------------------------------------- | ------------------------------------------------- |
| `qms.qc-record-open`      | POST   | `/work-orders/{workOrderId}/quality-controls`     | `qms.quality_control.record`                      |
| `qms.qc-record-list`      | GET    | `/work-orders/{workOrderId}/quality-controls`     | `qms.quality_control.read`                        |
| `qms.qc-record-detail`    | GET    | `/quality-controls/{recordId}`                    | `qms.quality_control.read`                        |
| `qms.qc-check-result`     | PUT    | `/quality-controls/{recordId}/checks/{qcCheckId}` | `qms.quality_control.record`                      |
| `qms.qc-record-finalize`  | POST   | `/quality-controls/{recordId}/finalization`       | `qms.quality_control.finalize`                    |
| `qms.reopen-attempt`      | POST   | `/work-orders/{workOrderId}/reopen-attempts`      | `wo.work_order.transition`                        |
| `qms.reopen-attempt-list` | GET    | `/work-orders/{workOrderId}/reopen-attempts`      | `qms.quality_control.read`                        |
| `qms.rework-create`       | POST   | `/work-orders/{workOrderId}/rework`               | `qms.rework.manage`                               |
| `qms.rework-list`         | GET    | `/work-orders/{workOrderId}/rework`               | `qms.quality_control.read`                        |
| `qms.rework-detail`       | GET    | `/rework-links/{reworkLinkId}`                    | `qms.quality_control.read`                        |
| `qms.rework-sign-off`     | POST   | `/rework-links/{reworkLinkId}/sign-off`           | `qms.rework.sign_off`                             |
| `qms.rework-cost-record`  | PUT    | `/rework-links/{reworkLinkId}/cost`               | `qms.rework.manage` + `iam.sensitive.view`        |
| `qms.rework-cost-read`    | GET    | `/rework-links/{reworkLinkId}/cost`               | `qms.quality_control.read` + `iam.sensitive.view` |

`permissions: [...]` is a conjunction, so the two cost operations require BOTH named
permissions. Rework cost is money attributable to a named technician's work being
redone; it is the one surface in this wave that is not readable by everyone who may
read quality outcomes.

## A failed check is never edited into a pass

`qms.guard_qc_finalize()` stamps `checker_id` and `finalized_at` from the session on the
`pending → passed | failed` edge and then FREEZES all three. A finalized record cannot
be re-judged — not by its checker, not by anyone.

Clearing a failure therefore means opening a NEW record, which the schema permits
because there is deliberately no unique index on `(work_order_id)`. Closure blocker B5
reads the SET of records rather than a current one, so a later pass clears closure while
the failure stays in the ledger, attributable to whoever performed it. Both halves are
asserted: the frozen record refuses a second finalization, and a second record on the
same order both opens and clears B5.

`ck_quality_control_records_finalized` pins the coupling in the other direction —
`pending` implies both `checker_id` and `finalized_at` are NULL — so a record cannot
claim a checker before anyone checked. The open path asserts that too.

### The record / finalize split is real, and now proven

`qms.quality_control.record` (medium) is what a technician needs to tick checks off;
`qms.quality_control.finalize` (high) is the authority to declare the vehicle fit to
release. The suite carries a principal — `QC_CHECKER` — that holds the first and not
the second: it writes check results and is refused at finalization. Before the review
that probe did not exist and the split was a claim about the seed rather than a
property of the surface.

### Unresolved mandatory checks are reported, not enforced

`wo.guard_work_order_closure`'s B5b asks only whether a PASSED record exists when any
mandatory check is configured — it never reads per-check results. Refusing finalization
on an unticked mandatory check would be this layer inventing a rule the closure gate
does not apply, so `qms.qc-record-detail` returns `unresolvedMandatory` and finalization
does not consult it.

## A closed work order never reopens

`qms.attempt_reopen()` records the attempt and never mutates the order. So the
endpoint's success path is a **refusal**: HTTP 201 carrying the recorded attempt's id
and the refusal reason, not an error.

That shape was chosen after the first implementation threw: throwing rolled back the
transaction that had just recorded the attempt, so the ledger the mechanism exists to
maintain was empty exactly when it mattered. The suite asserts the order is unchanged
afterwards — state, version and closure timestamp — because "we refused" and "we
refused and changed nothing" are different claims.

BR-WO-002 is the database's rule (`wo.guard_work_order_transition` has no outbound edge
from `closed`); this surface exists so an attempt is attributable rather than a 422 that
leaves no trace.

## A rework work order could not previously be created at all

Before this wave nothing in the platform produced `kind = 'rework'`. Reception's
conversion writes seven columns and leaves `kind` to its default, so `qms.rework_links`
was unreachable and closure blocker B6 — an unsigned rework link on the original —
could never fire.

`qms.rework-create` therefore opens a new work order **and** the link in one
transaction. The new order:

- carries `kind = 'rework'`,
- shares the original's reception visit, company and branch, so both orders belong to
  the same customer visit,
- takes its display number from the same provisioned sequence as any other order
  (`numbers.isProvisioned` first, `null` when the sequence is not provisioned — the same
  fallback every other call site uses).

Order and link commit together or not at all; the rollback probe removes the accepted
custody event so `guard_work_order_refs` refuses AFTER the number has been allocated,
and asserts neither row exists.

`openRework` lives in `work-order`, not `quality`: ADR-001 rule 3 forbids `quality`
writing `wo` tables, and the Wave 4 boundary decision put every `wo.work_orders` write
behind the work-order module's own service. `quality` calls it through the module's
public surface.

### Only a closed original may be reworked

A **cancelled** original is refused. The seeded `cancelled` state carries
`is_closed = true` as well as `is_terminal = true`, which an earlier revision of this
wave got wrong in five places and which admitted a cancelled order to rework. Cancelled
work was never performed, so there is nothing to redo. The refusal is asserted through
the route.

## BR-QMS-001 is a CHECK, not application code

`ck_rework_links_signoff_distinct` refuses a `signed_off_by` equal to the original's
lead technician — independent sign-off is the database's rule. This layer reads the
pre-refusal so a caller gets a useful message instead of a constraint name, and the
suite drives BOTH: the readable refusal, and a case that reaches the CHECK itself.

## Evidence

- [`tests/backend/p1-19-quality-rework.test.ts`](../../../../tests/backend/p1-19-quality-rework.test.ts)
  — 41 tests, all through the real route handlers.
- Every read on this surface (QC list, QC detail, rework list, rework detail, reopen
  ledger) is probed for refusal against an unpermitted caller (403), a caller permitted
  in another branch but RLS-visible here (403 — P1-18-A-01), a caller with no grant here
  at all (404) and a cross-tenant caller (404). An earlier revision made every read as
  `FULL` and produced none of that evidence; the coverage gate cannot catch it, because
  it checks an operation id appears in executable code and not that an assertion backs
  the claimed flag. That is the same defect class that credited eight P1-17 operations
  falsely.

## Findings

The Wave 8 adversarial review raised 28, of which 12 were confirmed and 16 refuted.
0 Critical, 0 High, 3 Medium, 9 Low — all resolved in the remediation commit. The three
Mediums were: the cancelled-original admission above; a stale module header describing
an abandoned throwing design for number allocation; and `displayNumber` typed `string`
where the provisioning fallback can return `null`.
