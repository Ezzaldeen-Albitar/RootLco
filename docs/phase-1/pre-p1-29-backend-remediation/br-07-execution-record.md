# BR-07 — execution record

Work and Diagnostic Evidence. Closes the evidence half of `BE-8`, finding
`INS-28`, and Owner requirement 12 (`INT-093`…`095`).

|                      |                                                                                |
| -------------------- | ------------------------------------------------------------------------------ |
| Contract             | [br-07-work-and-diagnostic-evidence.md](br-07-work-and-diagnostic-evidence.md) |
| Branch               | `remediation/p1-29-backend-work-and-diagnostic-evidence`                       |
| Depends on           | **nothing**                                                                    |
| Migrations           | **one** — `wo.job_evidence` (125 → **126**)                                    |
| New permission codes | **zero**                                                                       |
| New operations       | **three** — 331 → **334**; paths 267 → **269**                                 |

---

## 1. What was missing

**A technician could not attach a photograph to the work they did.** Evidence
binding existed for exactly two subjects — a diagnostic **report** and a customer
**approval** — and for nothing else. There was no job-level, assignment-level or
work-order-level evidence anywhere, so Owner requirement 12 had no owner.

## 2. The constant was duplicated THREE times, not twice

The contract records `EVIDENCE_REFUSED_STATES` as duplicated twice and asks that
BR-07 not make a third. **There were already three**:

| module                                                 | identifier                   |
| ------------------------------------------------------ | ---------------------------- |
| `diagnostics/application/diagnostic-report-service.ts` | `EVIDENCE_REFUSED_STATES`    |
| `work-order/application/additional-work-service.ts`    | `EVIDENCE_REFUSED_STATES`    |
| **`delivery/application/delivery-service.ts`**         | **`REFUSED_VERSION_STATES`** |

All three were `Object.freeze(['rejected', 'quarantined'])`, all three refused
with `ERR-DOC-001`, and delivery's own use site says _"cannot be bound"_ — the
same rule about the same column, spelled three ways. A grep for the **identifier**
missed the third; a grep for the **values** found it, which is why the S5 test
greps values.

**Extracted to `shared-services/domain/attachment-policy.ts`**, because the rule
is about `shared.document_versions.status` and that is that module's column. It
sits directly beside `DOWNLOADABLE_STATES` so the asymmetry between them is
visible rather than surprising:

```
DOWNLOADABLE_STATES     = ['accepted']                 — download needs a clean scan
EVIDENCE_REFUSED_STATES = ['rejected','quarantined']   — binding refuses only these
```

**`pending` may be bound and may not be downloaded**, and that gap is deliberate.
Capture happens when the work happens and a scan takes as long as it takes;
refusing `pending` at bind time would make capture fail intermittently on scan
latency, **losing the photograph rather than delaying it**. The protection is
preserved where it matters — the bytes stay ungettable until the scan accepts.

No behaviour changed: same values, same refusal, same error code, and the two
existing evidence suites stayed green (92/92).

## 3. The table

`wo.job_evidence` — a **transcription**, not a design. `dia.diagnostic_evidence`
and `wo.customer_approval_evidence` are field-identical (`C-09`) down to their two
indexes and their `COMMENT` sentence, so this is the third instance of a shape
that has shipped twice. The `COMMENT` carries its siblings' sentence **verbatim**:
three tables that behave identically should describe themselves identically, and
a reworded one invites a reader to hunt for a difference that is not there.

**Parented on `wo.jobs`**, with both alternatives refused in the migration header:
the work order would lose _which piece of work_ is evidenced; the assignment would
make evidence vanish when the assignment ended and split work done by two
successive technicians across two parents.

**Append-only at the GRANT layer** — measured on the applied table as
`app_runtime|INSERT,SELECT`. No UPDATE, no DELETE, no `record_version`, no soft
delete, and **no UPDATE or DELETE policy either**: a policy for an ungranted verb
would suggest one exists.

**The consequence is stated rather than discovered: evidence cannot be unbound.**
A mis-attached photograph is permanent — exactly the property both shipped
evidence tables have, and something a UI must warn about _before_ submitting.

`evidence_type` stays **free text** to match its siblings. A CHECK here would give
three tables three contracts for one field name. The vocabulary
(`RECOMMENDED_EVIDENCE_TYPES`) is an API **convention**, not a database invariant,
and the column comment says so.

## 4. The three operations

| id                            | route                                     | permission           |
| ----------------------------- | ----------------------------------------- | -------------------- |
| `wo.job-evidence-record`      | `POST /jobs/{jobId}/evidence`             | `tech.labor.record`  |
| `wo.job-evidence-list`        | `GET /jobs/{jobId}/evidence`              | `wo.work_order.read` |
| `wo.work-order-evidence-list` | `GET /work-orders/{workOrderId}/evidence` | `wo.work_order.read` |

**Zero permission codes minted.** The write costs `tech.labor.record` because the
technician evidences the labour they performed, in the same act, as the same
person — requiring `wo.job.manage` would mean a technician cannot photograph their
own work, and the precedent is exact (`dia.diagnostic-evidence-record` carries
`dia.diagnostic.record`, not `shared.document.manage`). The reads cost
`wo.work_order.read` because evidence describes **work, not a person** — the
distinction that keeps assignments and labour sessions behind
`tech.technician.read` (`T-05`).

**The two-permission seam, stated because a UI will hit it:** attaching needs
`shared.document.manage` (to capture) **and** `tech.labor.record` (to bind). A
screen must check both before offering the control.

**No second media subsystem.** No upload route, no storage call, no `connect-src`
change — asserted by a test that reads both route files. The browser never PUTs to
the object store and that is structural: `connect-src` is assembled in one place
and admits `'self'` and the API origin only.

**Responses carry a reference, never a way in** (`T-09`): `documentVersionId` and
no storage key, URL, checksum or bytes.

## 5. One real name collision, resolved rather than papered over

The work-order domain already exported `MAX_EVIDENCE_TYPE = 64` — identical, so
**reused** — and `MAX_EVIDENCE_NOTE = 500`, which belongs to **customer-approval**
evidence while BR-07 specifies **1000** for job evidence. Two different numbers for
two different columns now carry two different names (`MAX_JOB_EVIDENCE_NOTE`);
sharing one identifier would have silently moved whichever limit was written
second.

## 6. Two guards that refused a fixture, and were right both times

- **`ck_job_states_tenant_not_terminal`** forbids a _tenant_ authoring a terminal
  job state at all, so P4 cannot invent one. It reaches a terminal state over the
  **shipped platform edge** `planned → cancelled`, and asserts the state really is
  terminal before claiming the case proves anything.
- **That edge requires a reason**, and `wo.guard_job_transition` says so. The
  fixture supplies `app.status_reason` — using the graph as designed rather than
  working around it.

## 7. Evidence

| tier                                         | result                                                                                                         |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| BR-07 suite                                  | **15 / 15**                                                                                                    |
| Backend tier                                 | **2232 / 2232**, 95 files — BR-06's 2217 plus BR-07's 15, no regression                                        |
| DB tier                                      | **1720 / 1720**, 143 files                                                                                     |
| `verify:contracts`                           | green — **334 operations / 269 paths**, agreeing across registry, OpenAPI, coverage checker and P1-24 register |
| Zero unindexed FKs (`wo`/`tech`/`qms`/`dia`) | re-measured green — two new FKs, two new indexes                                                               |
| `app_runtime` grant on `wo.job_evidence`     | `INSERT,SELECT` — measured                                                                                     |

**One transient failure, recorded rather than hidden.** The first DB-tier run
reported `shared-event-outbox` "claim(4) over 8 pending returned 7". The file
passes **alone** (17/17) and the tier passes **on re-run** (1720/1720); nothing in
this slice touches the outbox. It is a parallel-execution interaction in that
suite, not a BR-07 defect — and it is written down here rather than quietly
re-run, because a flake nobody records is a flake somebody later mistakes for a
regression.

## 8. Deferred, with justification

**`BR-07-OPEN-01` — `INS-15`, per-item diagnostic evidence.** Adding
`template_item_id`/`finding_id` to `dia.diagnostic_evidence` would let a
photograph be tied to the item it evidences. It is **not** in this slice because
that table is append-only and already carries rows in tenants that have used
diagnostics: a nullable column is safe, but **backfilling it is not possible**, so
historical evidence would be permanently unattributed and a UI showing per-item
evidence would show it inconsistently.

**Binding preserved for P1-29's frontend:** do **not** render evidence inside an
item row as though it were bound to that item. One report-level gallery.
Rendering otherwise is a false claim about the data.

Also out of scope by contract: a vehicle-side evidence read (a `veh` surface, not
P1-29's), recorded so it is not assumed to exist.
