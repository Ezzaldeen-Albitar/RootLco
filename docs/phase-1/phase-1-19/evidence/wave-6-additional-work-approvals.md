# Wave 6 — Additional work and customer approvals

Feature SHA `4f0a347`, on `feature/p1-19-module-foundation`, PR #82.
Base of this wave: `77a8f5a`. **No migration and no seed changed.**

## Operations delivered

| Operation                          | Method | Path                                         | Permissions                                         |
| ---------------------------------- | ------ | -------------------------------------------- | --------------------------------------------------- |
| `wo.additional-work-request`       | POST   | `/work-orders/{workOrderId}/additional-work` | `wo.additional_work.request`                        |
| `wo.additional-work-list`          | GET    | `/work-orders/{workOrderId}/additional-work` | `wo.work_order.read`                                |
| `wo.additional-work-detail-record` | PUT    | `/additional-work/{requestId}/detail`        | `wo.additional_work.request` + `iam.sensitive.view` |
| `wo.additional-work-detail-read`   | GET    | `/additional-work/{requestId}/detail`        | `wo.work_order.read` + `iam.sensitive.view`         |
| `wo.additional-work-withdraw`      | POST   | `/additional-work/{requestId}/withdrawal`    | `wo.additional_work.request`                        |
| `wo.additional-work-approval`      | POST   | `/additional-work/{requestId}/approval`      | `wo.additional_work.approve`                        |
| `wo.additional-work-approval-read` | GET    | `/additional-work/{requestId}/approval`      | `wo.work_order.read`                                |
| `wo.additional-work-fulfillment`   | POST   | `/additional-work/{requestId}/fulfillment`   | `wo.additional_work.request`                        |

Plus the **unapproved-work execution gate**, added inside the existing
`wo.job-transition` operation rather than beside it. Every command is
`scope: 'branch'`; every one addressed by `requestId` re-checks scope against the
LOCKED row's own company and branch inside the service, because the path names no
branch and `scope: 'branch'` is inert without a concrete target (P1-18-A-01).

## The ordering control, and why it forces one transaction

`wo.guard_additional_work_state` (BEFORE UPDATE OF state) refuses
`state = 'approved'` unless an `approved` row already exists in
`wo.customer_approvals` for that request. That is the forgery-resistance control:
a request cannot be marked approved by anyone who has not first recorded a decision
naming a real deciding party, a channel and the exact scope that party was shown.

It also settles the API shape. Recording the decision and moving the request must
be ONE call, because split into two there is a window in which a decision exists
and the request does not reflect it — during which the closure gate still sees a
pending required request while the customer has already agreed — and a failure
between the two leaves that window open permanently.

The guard is proved rather than described. No route can express the illegal order,
so the DEPLOYED guard is probed directly with an admin `UPDATE`
(`p1-19-customer-approvals.test.ts`, "records the approval BEFORE the state
change"). A control nobody can reach through the API still has to be shown to
work, or the whole surface rests on an assumption.

## The restricted description is a separate authority, not a field

`wo.additional_work_request_details` is 1:1 with the request, its `classification`
is CHECK-fixed to `'restricted'`, and all three policies —
`sel_`/`ins_`/`upd_additional_work_request_details_gated` — additionally require
`iam.has_permission('iam.sensitive.view')`. For a caller without that permission
the row does not exist, for reading **or** writing.

Two consequences, both load-bearing:

1. **It cannot be a field on the create request.** A caller without the sensitive
   permission would have had the request row written and then the detail INSERT
   refused by RLS in the same transaction — so raising a request at all would fail
   for every ordinary service advisor.
2. **It cannot be folded into the request projection.** The list read would
   silently return nothing useful for exactly those callers.

So it has its own two operations, and each declares `iam.sensitive.view`
ALONGSIDE the functional permission. `defineOperation` treats a permission list as
a conjunction, so that is a real second requirement checked before any row is
touched; the RLS policy is defence in depth behind it.

The control is tested in both directions with two principals **one permission
apart** — `FULL` (refused 403) and `SENSITIVE` (served). And the negative that
matters is asserted, not described: `iam.audit_records` is NOT gated by
`iam.sensitive.view`, so the audit record carries the classification, the fact and
the length and never the text, and a query over `iam.audit_record_details` for a
token unique to the restricted string proves it. The same query initially failed
against the request's own perfectly legitimate summary audit, which is why the
token is now distinctive — an assertion that reads as a leak when there is none is
worse than no assertion.

`GET .../detail` is audit class **security**, the only read in this module that is
audited at all. Every other read here is `none`, which is right for work-order
state and wrong for the one table the platform gates behind `iam.sensitive.view`:
who looked is itself the fact worth keeping. A 404 from it genuinely means "no
detail was written" rather than "hidden from you", precisely BECAUSE the operation
demands the permission — a caller who reaches the service holds it.

## Provenance is checked, because the database cannot check it

At least one of `originatingJobId` and `originatingFindingId` is required. That is
this layer's rule and is stated as such: both columns are nullable, and additional
work whose provenance is unrecorded cannot be traced to what discovered it.
Supplying both is accepted rather than refused — a finding is discovered while
working a job, so naming both is more informative and nothing in the schema treats
them as alternatives.

Neither reference is self-enforcing:

- `fk_additional_work_requests_job` is the composite scope key
  `(tenant, company, branch, originating_job_id)`, so it pins the **branch** and
  not the work order. A job under a different order in the same branch satisfies
  it, and that is exactly the fixture the test uses.
- `originating_finding_id` has **no foreign key at all**. An arbitrary uuid would
  have been stored happily.

The finding is therefore resolved through the `diagnostics` module, which gains a
narrow `findingOrigin` read joining `dia.findings` → `dia.diagnostic_reports`
(whose `work_order_id` and `job_id` are both NOT NULL). Reading `dia.findings`
from `work-order` would be the cross-module table access ADR-001 rule 3
prohibits, so the read lives in the module that owns the schema. This is the only
possible check for that column, and its absence would have been invisible to the
database.

## The deciding party is not free text

`wo.guard_customer_approval_coherence` resolves request → work order →
`reception_visit_id` and refuses a `deciding_party_role_id` whose
`rec.reception_party_roles.reception_visit_id` differs, or whose tenant differs.
So the party who agrees is one already recorded on the visit that produced the
work order.

Both refusals are mapped, and they are different facts:

| Cause                                   | SQLSTATE | Mapped to     |
| --------------------------------------- | -------- | ------------- |
| Role belongs to another visit or tenant | `23514`  | `ERR-VAL-001` |
| Role is not resolvable                  | `23503`  | `ERR-RES-001` |
| A second live decision on one request   | `23505`  | `ERR-RES-002` |

The `23514` case is the interesting one: `fk_customer_approvals_party_role` is
**satisfied** there — the role exists and is in the tenant — so only the coherence
guard catches it, and without the mapping it would have surfaced as a 500. The
constraint names are used for deterministic mapping and never reach a caller.

## Evidence binds an exact version and no storage key exists anywhere

`wo.customer_approval_evidence` is append-only: `app_runtime` holds SELECT and
INSERT and nothing else, so a bound version can be neither substituted nor
removed. Evidence is named by `documentVersionId`, never by document id and never
by storage key — the table has no column for one and the route has no field for
one, which the strict-schema 422 proves.

The version is validated through the Phase 1-15 attachment service's own
`scanState`, which reads it under RLS, so a version in another tenant is a uniform 404. `fk_customer_approval_evidence_version` is `(tenant_id, document_version_id)`
and is the database backstop behind that.

**`accepted` is deliberately NOT required**, and that is not laxity. P1-15
documented that acceptance is unreachable: `shared.guard_document_version_transition`
needs a `clean` row in `shared.file_scan_results` and no application role may write
that table (DBCR-P1-15-001 withheld it). Requiring `accepted` would make approval
evidence impossible for every caller. What CAN be refused is a version somebody
rejected or quarantined, and that is what is refused (`ERR-DOC-001`).

Evidence is validated BEFORE the approval is inserted, so an unusable version
cannot leave a decision recorded with its evidence missing from it. It is bound
only inside the decision transaction — there is no path to attach evidence to an
already-recorded decision, because that would let one person record the decision
and another supply its proof.

The Phase 1-19 surface is stricter than P1-18's reception evidence here, which
binds a version and leaves the status entirely to the foreign key. Recorded as a
difference, not as a criticism of P1-18.

## `ERR-WO-002` and the unapproved-work execution gate

A job may not enter a state where LABOUR is allowed while additional work it
discovered is still awaiting the customer's decision.

**It lives inside `transitionJob`**, not beside it. A second entry point that
moved a job would be an alternate start path and the gate would be bypassable by
choosing the other URL — the same mistake the closure split had to be built to
avoid in Wave 4.

**It keys on `wo.job_states.labor_allowed`, not a state name.** That is the
catalog's own answer to "is work happening in this state", and the graph is
tenant-overridable so a TypeScript state name would be a mirror. On the seeded
platform graph the flag is true for `assigned` and `in_progress` and false for
`planned`, `paused`, `completed` and `cancelled` — so starting and resuming are
gated, and **pausing is not**. That asymmetry is the point: the intended sequence
is that a technician who finds extra work pauses the job while the customer is
asked, and a gate that blocked the pause would trap the job in a state it must not
stay in.

**The predicate is B3's FIRST limb only.** B3 blocks closure while a required
request is `pending`, **or** `approved` with `fulfillment_state = 'unfulfilled'`.
The gate uses only the first. The second describes work the customer HAS
authorised and the workshop has not yet carried out — exactly the state in which
execution must be allowed. Including it would stop the job entering a labour
state, so the approved work could never be done, the request could never become
fulfilled, and B3 could never clear: a deadlock rather than a control. The suite
asserts the non-deadlock rather than leaving it to be discovered.

A `rejected` or `withdrawn` request does not gate either, and that also follows
B3: the customer has settled the question, and the originally authorised work
continues.

`ERR-WO-002` is a new code rather than a reuse. `ERR-WO-001` is documented as
specifically the whole-order B1–B6 closure gate, and `ERR-TRN-001` means the
aggregate is not in a state the transition may start from. This is neither: the
edge exists, the job is in a legal starting state, and what blocks it is a sibling
row. Reusing either would have made the catalog's own description false.

## Fulfilment, and why the wave would otherwise ship a deadlock

Nothing else in this phase writes `fulfillment_state`. Without
`wo.additional-work-fulfillment`, every approved required request would block its
work order's closure permanently through B3's second limb, escapable only by never
approving required work.

`unfulfilled` is in the CHECK vocabulary and is deliberately **not settable**:
`tg_additional_work_requests_immutable` does not freeze the column, so nothing in
the schema would refuse a move back to it, and it would un-record a completion
nobody retracted. Stated as this layer's rule, not pretended to be the schema's.

Only an APPROVED request may move. Fulfilling a `pending` one would record work
the customer has not authorised; fulfilling a `rejected` or `withdrawn` one would
record work that was cancelled. A waiver carries a mandatory reason, and since the
row has no reason column that reason lives in the audit record — stated rather
than left to be discovered.

Permission is `wo.additional_work.request` rather than the approve code: obtaining
consent and administering the work already consented to are different acts, and
this is the second.

## Withdrawal

`withdrawn` is the only exit from `pending` that does not involve the customer, so
it sits behind `wo.additional_work.request` — retracting a question you asked is
not deciding the answer. It is what keeps a mistaken request from becoming
permanent: a required pending request blocks both closure and its originating
job's execution, so without it the only escape would be to ask a customer to
decide on work that was never really needed.

## Audit and events

Six audit actions registered, and the pinned sorted inventory updated
(**90 → 96** platform-wide):

| Action                                   | Class      | Records                                     |
| ---------------------------------------- | ---------- | ------------------------------------------- |
| `wo.additional_work.requested`           | privileged | summary + provenance, never the description |
| `wo.additional_work.detail_recorded`     | privileged | classification + fact + length only         |
| `wo.additional_work.detail_read`         | security   | that a restricted read happened             |
| `wo.additional_work.state_changed`       | privileged | every edge, with the previous value         |
| `wo.additional_work.fulfillment_changed` | privileged | the move, and a waiver's reason             |
| `wo.customer_approval.recorded`          | approval   | decision, channel, party, evidence count    |

An approval writes **two** audit records — `wo.customer_approval.recorded` and
`wo.additional_work.state_changed` — deliberately and not by accident. Capturing a
decision and moving the request are separate facts with separate consequences, and
an auditor asking "when did the customer agree" must not have to infer it from a
state change.

`EVT-WOR-004` `additional-work.requested` and `EVT-WOR-005`
`customer-approval.recorded` moved from `implementedIn: null` to `'P1-19'`, and
both `implementedIn` pins were updated in the same commit. Payloads carry metadata
only: a consumer needing the customer-facing description reads it under its own
authorization, behind `iam.sensitive.view`. An event is a notification that
something happened, never a way around a read gate.

## Gates at `4f0a347`

| Gate                                      | Result                                     |
| ----------------------------------------- | ------------------------------------------ |
| `format:check`                            | Pass                                       |
| `lint`                                    | Pass                                       |
| `typecheck`                               | Pass                                       |
| `validate:module-boundaries`              | Pass, 300 files scanned                    |
| `validate:authorization-coverage`         | Pass, every operation guarded              |
| `validate:operation-coverage`             | **P1-19 32/32 operation depth, 0 pending** |
| `validate:openapi`                        | **119 paths / 142 operations**             |
| `validate:wo-tech-dia-qms-classification` | Pass, 657 columns, 3 restricted            |
| `validate:encoding`                       | Pass, 1148 files                           |
| `validate:canonical-docs`                 | Pass, both hashes match                    |
| `security:all`                            | Pass                                       |
| `build`                                   | Pass                                       |
| Unit                                      | **843**                                    |
| Backend                                   | **951** (was 888)                          |
| Database                                  | **1604** (unchanged — no migration)        |

63 new backend tests across `p1-19-additional-work.test.ts` (33) and
`p1-19-customer-approvals.test.ts` (30).

## Defects this wave found in already-shipped material

1. **A stale coverage note.** The `wo.required-part-record` MANIFEST note still
   claimed `item_ref` is "an opaque forward reference with no foreign key". The
   repository, service and route had already been corrected in Wave 5 when the real
   `fk_required_parts_item` was discovered; the note had not, so the operation's own
   evidence contradicted the code it describes. Corrected here.
2. **`quotation_revision_ref` has the same stale comment problem.** The Phase 1-9
   table comment calls it a forward reference with no FK; migration 20260723097000
   added `fk_customer_approvals_quotation_revision`. Nothing writes it in this
   wave, so no defect resulted — recorded so the next wave does not trust the
   comment.

## Fixture corrections made while writing the suites

- `shared.guard_document_version_transition` refuses an INSERT whose status is not
  `pending` with terminal timestamps unset, so the rejected-version fixture inserts
  `pending` and UPDATEs. Even the fixture takes the transition the platform takes.
- `iam.audit_record_details` is the table name, not `iam.audit_details`, and its
  columns are `new_value_masked` / `old_value_masked`.
- `createOpenWorkOrder` advanced tenant-B orders as tenant A's principal, which RLS
  refused before the graph was consulted — a fixture defect that would have read as
  a P1-19 one. It now advances as the order's own tenant principal.

## Deferrals, stated rather than silently omitted

- **Pricing and quotation revisions** are Phase 1-20.
  `wo.customer_approvals.quotation_revision_ref` stays NULL.
- **Stock reservation and issue** are Phase 1-21. Nothing here reads or writes an
  `inv` row.
- **`originating_finding_id` cannot be validated against a REPORT's status.** Wave
  6 confirms the finding resolves to this work order; whether its report is
  completed is Wave 7's question, and there is no shipped path to create a finding
  yet, so the check is exercised only through its refusal.
- **Two-person integrity between raising and approving** is a tenant policy
  choice, not something this code enforces: `wo.additional_work.request` and
  `wo.additional_work.approve` are separate seeded permissions, and a tenant that
  grants both to one role has decided that. The schema has no column for a second
  approver on this table.
