# P1-19 — Security review

Scope: the **58 operations** P1-19 delivers across `wo`, `tech`, `dia` and `qms`.
The surface itself is generated in [`endpoint-inventory.md`](endpoint-inventory.md);
this document is the argument about it, and every claim below names the assertion or
the code path that carries it.

Runtime role is `app_runtime` throughout — never a superuser, never `BYPASSRLS`, and
never the owner of an application table.

**No migration, no grant, no role, no policy and no function changed.** One seed file
did: `supabase/seeds/04_iam_permission_catalog.sql` gained 22 permission codes in Wave 3.
An earlier revision of this section claimed no seed changed at all, which was false and
is corrected here — the clean-room reproof found it, not a reviewer.

That change cannot widen anyone's access. A row in `iam.permissions` is a **name**; it
authorises nothing until a tenant role maps it to a principal, and this phase seeds no
role and no mapping. What it does do is make the 58 operations' declarations resolvable,
which is why `scripts/p1-19-endpoint-inventory.mjs` reconciles every declared code
against that file and fails the build on a code that is not there.

---

## 1. Every operation is guarded, and the guard is evaluated in the database

All 58 operations declare their permission codes in `defineOperation`; nothing
restates them, and `scripts/check-authorization-coverage.mjs` fails CI if a route is
reachable without one. Authorization is evaluated by `iam.has_permission` /
`iam.has_permission_in_scope` **inside the request transaction**, under the caller's
own session context — not by TypeScript comparing strings.

`permissions: [...]` is a **conjunction**. Four operations rely on that —
`wo.additional-work-detail-read`, `wo.additional-work-detail-record`,
`qms.rework-cost-read` and `qms.rework-cost-record` — each requiring
`iam.sensitive.view` alongside its functional permission. A caller holding only the
functional code is refused, and the suites assert that refusal rather than assuming the
conjunction holds.

Every one of the 58 declares `scope: 'branch'`.

### P1-18-A-01 is closed on this surface — but it was not, until the final review

**It was open on one operation and the final adversarial review found it.**
`tech.labor-session-list` (`GET /jobs/{jobId}/labor-sessions`) declared
`scope: 'branch'` while its handler destructured `{ db }` alone and its service method
took no `ScopeAuthorizer` at all — so the pre-handler check fell through to scope-blind
`iam.has_permission('tech.technician.read')` and the only narrowing left was
`sel_labor_sessions_scope` matching `iam.allowed_branch_ids()`.

It was the worst operation on the surface for that to happen to. A labour session says
**who worked and for how long**, so a caller permitted to read technicians in one branch
and RLS-visible in another through an unrelated grant could read that other branch's
timesheets. The suite for that operation made every read as a fully-permitted principal
and asserted a cross-tenant caller received `200` with an empty list — a comment in the
test justified it as "the job id is not resolved first here", which was describing the
defect as though it were a decision.

Fixed three ways, because one would not have been enough:

1. `forJob` resolves the job's scope through the `work-order` module's public `jobScope`
   and re-checks against it **before any session row is read**; the route forwards
   `authorizeScope`.
2. The suite now runs the same four-way probe as every other read, and the cross-tenant
   assertion is `404` rather than an empty `200`.
3. **A structural guard**, so no future operation can repeat it:
   `scripts/p1-19-endpoint-inventory.mjs` fails the build when an operation declares
   `scope: 'branch'` and its handler neither forwards `authorizeScope`, nor supplies an
   `authorizationTarget`, nor derives one with `scopeTargetOption`. Its first version was
   satisfied by the very comment explaining the fix — prose naming `authorizeScope` made
   the check pass — so it now strips comments first. It was mutation-tested: reverting the
   route fix makes it fail with exactly this operation named.

What follows is therefore true of the shipped tree, and was **not** true of the tree that
went through Waves 5 through 9.

`scope: 'branch'` is **inert** without a concrete `authorizationTarget`: the
pre-handler check falls back to scope-blind `iam.has_permission`, while RLS narrows on
`iam.allowed_branch_ids()`, which is the permission-**blind** union of every grant the
caller holds anywhere. A caller granted in branch A2 and RLS-visible in A1 through an
unrelated grant would pass both halves and write in a branch where they hold nothing.

P1-19's id-addressed operations therefore authorize **twice on every executing path**:
the pre-handler check, and a deferred `authorizeScope({companyId, branchId})` taken
from the authoritative row **after it is locked `FOR UPDATE`**. The deferred target is
the locked row's own scope — never caller-supplied, never body-derived, and unable to
move while the row is held. Seven services carry it:

| Service                                                | Rows it re-checks against     |
| ------------------------------------------------------ | ----------------------------- |
| `work-order/application/work-order-service.ts`         | `wo.work_orders`, `wo.jobs`   |
| `work-order/application/job-assignment-service.ts`     | `wo.job_assignments`          |
| `work-order/application/additional-work-service.ts`    | `wo.additional_work_requests` |
| `technician/application/labor-session-service.ts`      | `tech.labor_sessions`         |
| `diagnostics/application/diagnostic-report-service.ts` | `dia.diagnostic_reports`      |
| `quality/application/quality-control-service.ts`       | `qms.quality_control_records` |
| `quality/application/rework-service.ts`                | `qms.rework_links`            |

The probe that proves it is the same in every P1-19 suite and is deliberately not a
single 403: a principal permitted **in another branch but RLS-visible here** must get
**403**, and a principal with no grant here at all must get **404**. Two different
mechanisms, asserted separately, so a regression in either is visible. The Wave 8
suite runs that four-way probe over all five of its read operations in a loop, because
an earlier revision made every read as a fully-permitted principal and produced none
of the evidence its coverage manifest claimed.

**What the coverage gate cannot do.** It checks that an operation id appears in
executable code inside a test that declares the flag — not that an assertion backs the
flag. Eight P1-17 operations were credited on evidence that did not exist. Every
authorization claim in this phase was therefore re-derived from the assertions
themselves rather than from the manifest.

---

## 2. Restricted data is a separate surface, never a field on a projection

Three columns in the P1-19 schemas are classified `restricted`
(`docs/database/wo-tech-dia-qms-personal-data-classification.json`):

| Column                                                     | Reached by P1-19                                            |
| ---------------------------------------------------------- | ----------------------------------------------------------- |
| `wo.additional_work_request_details.description`           | `wo.additional-work-detail-read` / `-record` only           |
| `qms.rework_link_details.rework_cost`                      | `qms.rework-cost-read` / `qms.rework-cost-record` only      |
| `tech.technician_certification_details.certificate_number` | **not reached at all** — no P1-19 operation reads the table |

Both reachable columns live in a 1:1 detail table whose own RLS policies additionally
require `iam.sensitive.view` on SELECT, INSERT **and** UPDATE. The application does not
re-implement that rule; it exposes the detail as its own operation carrying the
sensitive permission, and the ordinary projection (`qms.rework-detail`,
`wo.additional-work-list`) never selects the column at all. So a caller without the
permission does not receive a masked value — they receive a response in which the
field does not exist, which cannot be un-masked by a client bug.

`rework_cost` is `numeric(14,4)` and crosses the boundary as a **string**. IEEE-754
cannot represent every value a `numeric` column can hold, and a currency amount that
silently changes in transit is a defect whether or not anyone notices.

### The five ways restricted data could leak, and why it does not

1. **Response bodies** — covered above: the column is absent, not blanked.
2. **Audit metadata** — the restricted description and the rework cost are never
   written to `iam.audit_record_details`. The audit rows for those operations record
   the entity id and the fact of the write. `wo.additional-work-detail-read` and
   `qms.rework-cost-read` are audit class **`security`** precisely because a _read_ of
   restricted data is itself the auditable event.
3. **Logs** — `handleOperation` logs operation id, outcome, timing and correlation
   identifiers; no request body and no row content is passed to it. Boundary rule B7
   additionally forces every backend module onto `@/server/observability/logger`
   rather than the Phase 1-1 bootstrap logger, so there is one logging path to reason
   about rather than two. B7 is an import rule, not a content filter — it constrains
   which logger is used, and the absence of row content in the call sites is what this
   claim actually rests on.
4. **Error messages** — refusals name the rule and the entity id, never the value.
   A caller lacking `iam.sensitive.view` gets the ordinary authorization refusal; the
   message does not vary by whether the restricted row exists.
5. **Event payloads** — `rework.linked` carries the link id, the two work-order ids,
   `isSafetyCritical`, the aggregate version and the scope
   (`rework-service.ts:347-359`); the restricted cost is written by a **different
   operation** and never enters this payload. The comment naming that reasoning is at
   the **audit** site of `writeCost` (`rework-service.ts:533-535`), not at the
   publication site. An earlier revision of this section said the omission was
   commented "at the publication site", which was wrong about where the comment is —
   the omission itself is real, and now has an assertion behind it rather than a
   misplaced citation.

The Wave 6 suite asserts leakage negatively with a unique token: the restricted
description contains a string that appears nowhere else, and the suite asserts that
token is absent from **every audit detail, every outbox payload and every non-detail
response** for the same request, while separately asserting the detail row itself does
hold it — so the claim is about where the text lives, not about it having been dropped.

**A correction, because this section previously overstated it.** Until the final
adversarial review, the leak test queried `iam.audit_record_details` **only**. This
document and `devops-observability.md` both claimed it covered event payloads and
responses as well, and neither was true. The test now covers all three; the claim was
made accurate by extending the test, not by narrowing the sentence.

Asserting "the response has no `description` key" would pass against a response that
leaked the same text under a different name, which is why the probe is a token search
across the whole serialised body rather than a key check.

### Evidence attachments carry no storage keys

Diagnostic evidence (`dia.diagnostic_evidence`) and approval evidence
(`wo.customer_approval_evidence`) bind an **exact document version id** obtained from
the Phase 1-15 attachment service. A client-supplied storage key is never accepted:
the key is an internal addressing detail, and accepting one would let a caller bind a
record to an object the platform never scanned. Both surfaces refuse a version whose
`attachments.scanState` is `rejected` or `quarantined`, and the suites drive both
refusals through the real routes.

---

## 3. Attribution cannot be forged

Every server-stamped identity in this phase is stamped by the **database**, from the
session GUC, not by the application:

| Fact                                | Stamped by                   |
| ----------------------------------- | ---------------------------- |
| QC checker and finalization time    | `qms.guard_qc_finalize()`    |
| Reopen requester and time           | `qms.stamp_reopen_attempt()` |
| Rework sign-off time                | `qms.guard_rework_signoff()` |
| Diagnostic reviewer and review time | `dia.stamp_review()`         |
| Every `created_by` / `updated_by`   | `org` stamping triggers      |

Three of those are additionally **frozen** after the fact, so a record cannot be
re-attributed once written: a finalized QC record's checker, result and time; a rework
link's sign-off; and (via `org.guard_immutable_columns`) a rework link's work-order
ids and lead technician — the last of which matters because swapping the lead is
exactly how a signature that violates BR-QMS-001 would be made to look legal.

**Separation of duties.** BR-QMS-001 is a database `CHECK`
(`ck_rework_links_signoff_distinct`) — the signer may not be the lead technician.
Diagnostic reviewer separation is **not** enforced by the database and is an
application rule (`assertReviewerSeparation`); this document says so rather than
claiming the stronger form, and the difference is recorded again in
[`wave-7-diagnostics.md`](wave-7-diagnostics.md).

---

## 4. A refusal is recorded, not merely returned

`qms.reopen-attempt` is the clearest case. BR-WO-002 means a closed work order never
reopens, and `wo.guard_work_order_transition` has no outbound edge from `closed`. The
operation's job is to make the _attempt_ attributable: `qms.attempt_reopen` writes a
`qms.reopen_attempts` row whose `outcome` is CHECK-fixed to `'rejected'`, and never
touches the order.

The endpoint therefore returns **201 with the recorded attempt**, not an error. The
first implementation threw — which rolled back the transaction that had just written
the ledger row, leaving no trace of the attempt exactly when one mattered. Its audit
class is `security`. The suite asserts the work order is unchanged afterwards: state,
version and closure timestamp.

---

## 5. Rate limiting, caching and idempotency

Every one of the 58 declares `cacheCategory: 'never'`. Nothing in this phase is
cacheable: every read is tenant- and branch-scoped and several are restricted.

Rate-limit policies are declared per operation and P1-19 uses two of the four:
**36** `standard-command` and **22** `expensive-read`. No P1-19 operation is
`auth-adjacent` — none of them authenticates — and none is `low-risk-metadata`,
because even the catalog reads in this phase are scoped reads of tenant data rather
than platform metadata.

The split is method-aligned with **one** exception, which is recorded as a finding
rather than rationalised. All 30 `POST`, 4 `PUT` and 1 `PATCH` are `standard-command`;
22 of the 23 `GET` are `expensive-read`; and `wo.work-order-detail` is a `GET` declared
`standard-command`. `standard-command` is the **looser** budget (120/min against
30/min), and that read is not a single-row lookup — its summary is "read one work order
with its jobs and reachable states", so it fans out exactly like the reads that were
given the tighter budget. Nothing justifies the difference; it is an inconsistency in
this phase's own declarations, logged as **`P1-19-A-04`** (Low). Neither policy is a
security control — both are keyed `operation + tenant + user`, so the divergence bounds
accidental client loops differently and nothing else.

**31** of the 58 declare `idempotent: true`: 31 of the 35 commands. Those are the ones
where a retried `Idempotency-Key` must not produce a second row — a second labour
session, a second approval, a second rework order.

The four commands that do not are `wo.job-update`, `wo.job-assignment-end`,
`tech.labor-session-stop` and `tech.labor-session-correct`. Each is an **update of an
identified row guarded by `If-Match`**, so a replayed request either finds the version
it expects and applies the same change, or finds a moved version and is refused. The
optimistic-concurrency check already answers the question idempotency would answer, and
adding a second answer would let a stale replay be served from the idempotency record
after the row had moved on. The remaining 22 are reads.

---

## 6. What this review does not claim

- **`P1-19-A-02` is open.** `dia` revision numbering rests on an advisory lock with no
  unique constraint behind it. Two concurrent writers in different sessions are
  serialized by the lock; a writer that bypasses the repository is not. The schema is
  frozen, so closing this needs a migration and a migration is not authorized in this
  phase.
- **`P1-19-A-03` is open.** Seven `P1-19-BE-nnn` annotations reach operations in two
  different schemas, so the in-code annotations are not a reliable task map. See
  [`task-traceability.md`](task-traceability.md).
- **Reservation and part-issue closure blockers do not exist.** The brief lists them;
  `wo.guard_work_order_closure` does not implement them, because stock reservation and
  issue execution are Phase 1-21. No always-passing placeholder blocker was added.
- **This phase adds no security control to the database.** Every enforcement above is
  either a pre-existing protected object or an application rule that is explicitly
  identified as one.
