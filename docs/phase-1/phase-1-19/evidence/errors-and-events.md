# P1-19 — Error codes and events

_Delivers **P1-19-DOC-001** — contract, catalog and traceability synchronization, together with the generated [`endpoint-inventory.md`](endpoint-inventory.md) and [`task-traceability.md`](task-traceability.md)._

## The five error codes this phase adds

| Code           | Status | Owner        | Class    | Meaning                                                     |
| -------------- | ------ | ------------ | -------- | ----------------------------------------------------------- |
| `ERR-WO-001`   | 409    | `transition` | conflict | The whole-order closure gate B1–B6 refused                  |
| `ERR-WO-002`   | 409    | `transition` | conflict | One job movement refused: additional work awaits a decision |
| `ERR-TECH-001` | 422    | `validation` | client   | Technician is not eligible for this assignment              |
| `ERR-DIA-001`  | 409    | `transition` | conflict | Diagnostic report has unresolved mandatory items            |
| `ERR-QMS-001`  | 409    | `transition` | conflict | A quality or rework precondition is not satisfied           |

Raising sites, from the source:

| Code           | Raised in                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `ERR-WO-001`   | `work-order/application/work-order-service.ts`                                                                                       |
| `ERR-WO-002`   | `work-order/application/work-order-service.ts`                                                                                       |
| `ERR-TECH-001` | `technician/domain/technician.ts`, `technician/application/labor-session-service.ts`, `work-order/application/work-order-service.ts` |
| `ERR-DIA-001`  | `diagnostics/domain/diagnostics.ts`                                                                                                  |
| `ERR-QMS-001`  | `quality/domain/quality.ts`, `quality/application/rework-service.ts`, `diagnostics/domain/diagnostics.ts`                            |

### Why `ERR-WO-002` is not `ERR-WO-001`

Both are 409 `transition` conflicts and it would have been shorter to reuse one code.
They answer different questions, and the catalog's own description of `ERR-WO-001` says
so: it is the **whole-order** B1–B6 closure gate. `ERR-WO-002` refuses **one job
movement**, and only for requests naming that job as their origin — the order may be
perfectly closable and this job still may not start. Sharing the code would have made
the catalog's description of `ERR-WO-001` false, and a client that wanted to distinguish
"the order cannot close" from "this job cannot start" would have had to parse a message.

It is deliberately not `ERR-TRN-001` either: the edge exists in the graph and the job is
in a legal starting state. What blocks it is a sibling row. Pausing is never refused, so
a job can wait in a state where labour is not allowed while the customer is asked, and
**approved-but-unfulfilled does not refuse execution** — that is authorised work waiting
to be done, and gating it would make it undoable.

### Why `ERR-QMS-001` is raised in `diagnostics`

`diagnostics/domain/diagnostics.ts` raises `ERR-QMS-001` for reviewer separation. The
code's owner is the quality domain because the rule is a quality rule — a review is not
independent if the reviewer wrote the thing reviewed — and the module raising it is the
one that holds the report. A separate `ERR-DIA-002` would have described the same fact
twice under two codes, which is what the controlled catalog exists to prevent.

`ERR-DIA-001` is distinct because it is about the report's own completeness, not about
who signed it.

## Events

Ten catalog entries move from reserved to `implementedIn: 'P1-19'` in this phase. Every
one is published **inside the business transaction** through the outbox, so an event
cannot exist for a state change that rolled back, and a state change cannot commit
without its event.

| Code          | Event type                    | Aggregate                    | Published by                   |
| ------------- | ----------------------------- | ---------------------------- | ------------------------------ |
| `EVT-WOR-002` | `work-order.state-changed`    | `wo.work_order`              | `work-order-service.ts`        |
| `EVT-WOR-003` | `work-order.closed`           | `wo.work_order`              | `work-order-service.ts`        |
| `EVT-WOR-004` | `additional-work.requested`   | `wo.additional_work_request` | `additional-work-service.ts`   |
| `EVT-WOR-005` | `customer-approval.recorded`  | `wo.customer_approval`       | `additional-work-service.ts`   |
| `EVT-TEC-001` | `job.assigned`                | `wo.job`                     | `job-assignment-service.ts`    |
| `EVT-TEC-002` | `job.state-changed`           | `wo.job`                     | `work-order-service.ts`        |
| `EVT-TEC-003` | `labor.session-changed`       | `tech.labor_session`         | `labor-session-service.ts`     |
| `EVT-DIA-001` | `diagnostic-report.completed` | `dia.diagnostic_report`      | `diagnostic-report-service.ts` |
| `EVT-QMS-001` | `quality-control.finalized`   | `qms.quality_control_record` | `quality-control-service.ts`   |
| `EVT-QMS-002` | `rework.linked`               | `qms.rework_link`            | `rework-service.ts`            |

The mapping is regenerated by `scripts/p1-19-endpoint-inventory.mjs` into
[`endpoint-inventory.md`](endpoint-inventory.md); this table restates it with the
reasoning below.

### `work-order.closed` and `work-order.state-changed` come from one call site

`work-order-service.ts` chooses between them with a ternary on whether the target state
closes. Closure is a state change, so publishing both would tell a consumer the same
fact twice; publishing only the generic one would make "the order closed" a thing
consumers had to derive by reading the catalog. The idempotency key differs per branch
too, so a retried closure cannot produce one of each.

This is also the shape that broke the first version of the phase's own event
reconciliation gate, which looked for a lone string literal after `eventType:` and
reported `work-order.state-changed` as unpublished. The checker was wrong, not the code;
it now reads the whole line.

### `EVT-WOR-001` (`work-order.created`) is still reserved

Reception's conversion creates the ordinary order and belongs to P1-18, which did not
publish it. This phase added the **second** creation path — the rework order — and
deliberately did not publish `work-order.created` from it either: an event emitted by
one of two creation paths is worse than no event, because a consumer counting orders
would be silently wrong rather than visibly unserved. `rework.linked` carries the fact
that matters here, and the reserved name stays reserved for whichever phase wires both
paths at once.

### `labor.session-changed` covers start, stop and correction

One type for three transitions of one aggregate, each carrying the session's own
version. Splitting it into three would have made "what happened to this session" three
subscriptions, and the aggregate version is what a consumer needs to order them.

## Audit actions

37 of the 58 operations declare an `auditAction`; 21 reads declare none.
`handleOperation` logs every call regardless, so a read with no audit action is not
silent — it is simply not an entry in the append-only, hash-chained business ledger.

Two reads **do** carry one, and the reason is the same in both cases: they read
restricted data, so the read is itself the auditable event. Their audit class is
`security`, not `privileged`:

- `wo.additional-work-detail-read` → `wo.additional_work.detail_read`
- `qms.rework-cost-read` → `qms.rework.cost_read`

`qms.reopen-attempt` is the third `security`-class operation: refusing to reopen a
closed work order is a security-relevant fact about who tried.

Four operations are class `approval` — `dia.diagnostic-review`,
`qms.qc-record-finalize`, `qms.rework-sign-off` and `wo.additional-work-approval`.
Each records a person taking responsibility for a judgement rather than performing a
change, which is what distinguishes the class from `privileged`.

**`dia.diagnostic.entry_recorded` is one action across six entry tables**, each record
naming its `entry_kind`. They are the same fact — something was added to this report —
and splitting them would turn "what went into this report" into six audit queries.

Every action above is in the controlled catalog with a fixed class and entity type, and
`scripts/p1-19-endpoint-inventory.mjs --check` fails the build if an operation declares
an action the catalog does not hold, **or declares a class the catalog disagrees with**.
The class check matters: without it a security action could be filed as `privileged` and
quietly change how it is triaged.
