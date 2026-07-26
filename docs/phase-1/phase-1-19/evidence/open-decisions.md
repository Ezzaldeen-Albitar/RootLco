# P1-19 — Open decisions and accepted findings

Everything here is **open at the close of the phase**. Nothing in this file is a
resolved item written up after the fact; each entry states what is wrong, what it costs,
and why it was not closed in this phase.

| ID           | Severity | Subject                                                      | Raised in | Status |
| ------------ | -------- | ------------------------------------------------------------ | --------- | ------ |
| `P1-19-A-01` | Low      | The job board's ordering is not index-aligned                | Wave 4    | Open   |
| `P1-19-A-02` | Medium   | Diagnostic revision numbering rests on an advisory lock      | Wave 7    | Open   |
| `P1-19-A-03` | Low      | `P1-19-BE-nnn` annotations are not a reliable task map       | Wave 9    | Open   |
| `P1-19-A-04` | Low      | `wo.work-order-detail` declares the wrong rate-limit tier    | Wave 9    | Open   |
| `P1-19-A-05` | Low      | `originating_finding_id` has no foreign key                  | Wave 9    | Open   |
| `P1-19-A-06` | Low      | Diagnostics parent-terminal refusal reads the order unlocked | Wave 9    | Open   |

`A-01` and `A-02` were raised and numbered by the waves that found them; `A-03` through
`A-06` are new here — `A-06` from the pre-merge completeness audit. The numbering is not re-sorted by severity — an identifier that
moves is worse than a table that is not ordered the way a reader might prefer.

---

## `P1-19-A-01` — the job board's ordering is not index-aligned

**What.** The board orders by `(opened_at DESC, id DESC)` and no index covers that
ordering: `ix_work_orders_open_by_branch` is
`(tenant, company, branch, state) WHERE deleted_at IS NULL`.

**Impact.** Correctness is not affected and the scan is bounded — the branch predicate
and the `LIMIT` confine it, and the sort happens over one branch's rows only. What is
missing is index alignment, so the sort is performed rather than read.

**Why it is not closed.** Adding an index is a migration, and none is authorised in
this phase.

---

## `P1-19-A-02` — diagnostic revision numbering has no constraint behind it

**What.** `dia.diagnostic_reports` carries a revision number per (job, template)
lineage, and there is **no unique index** enforcing it. `nextRevisionNumber` takes a
PostgreSQL advisory lock, reads the current maximum, and returns the next value.

**What that guarantees, and what it does not.** Two concurrent writers going through
the repository are serialised by the lock and cannot produce a duplicate. A writer that
does not take the lock — a future repository method, a maintenance script, a direct
`INSERT` — can. The lock is a convention enforced by one code path, not an invariant
enforced by the schema.

**Why it is not closed.** A unique index is a migration. The schema was frozen at
Phase 1-12 and this phase is explicitly not authorised to change it.

**Recommended closure.** A partial unique index on the lineage columns where
`deleted_at IS NULL`, in the first phase that carries a `dia` migration. Until then the
advisory lock stays, because it is strictly better than nothing and its limit is
documented rather than assumed away.

---

## `P1-19-A-03` — the `P1-19-BE-nnn` annotations are not a reliable task map

**What.** Seven of the eighteen annotated identifiers — `BE-009` through `BE-012`, and
`BE-017` through `BE-019` — reach operations in **two different schemas**. `BE-009`
annotates both `wo.job-create` and the four diagnostic-report operations; `BE-017`
annotates both the quality-control record surface and two labour-session operations.

**Cause.** The work-order and technician waves annotated their files before the
additional-work, diagnostics and QMS waves did, and the two numberings were assigned
independently against a plan that is not in this repository.

**Why it is not closed.** The canonical Phase 1 Development Plan is the only authority
on what each identifier means, and it lives outside this repository by owner decision.
Renumbering the annotations to make the traceability table look tidy would replace a
visible inconsistency with an invisible invention — a map that agrees with itself and
with nothing else. The annotations are left exactly as the implementing commits made
them.

**What carries the traceability instead.**
[`task-traceability.md`](task-traceability.md) is generated from the operation registry
and joined against the coverage gate's own matrix. It establishes, independently of the
identifiers, that every operation this phase exposes is guarded, audited where it
changes state, implemented in a module, and covered by an assertion-backed test at
operation depth.

**Recommended closure.** The owner reconciles the seven identifiers against the
canonical plan and the annotations are corrected in one commit.

---

## `P1-19-A-04` — `wo.work-order-detail` declares `standard-command`

**What.** 22 of the 23 P1-19 `GET` operations declare `rateLimitPolicy:
'expensive-read'` (30/min). `wo.work-order-detail` declares `standard-command`
(120/min) — the **looser** budget — and it is not a cheap read: it returns one work
order _with its jobs and reachable states_, so it fans out exactly like the reads that
were given the tighter tier.

**Impact.** Low and bounded. Neither policy is a security control; both are keyed
`operation + tenant + user`, so no caller can affect another and no tenant can affect
the instance. The divergence changes only how quickly an accidental client loop is
throttled.

**Why it is not closed here.** Changing it is a one-line edit, but it is a behavioural
change to a published operation's declared policy and it landed in Wave 4, which has
been reviewed and evidenced under the current value. Correcting it silently in the
hardening wave would make five wave documents disagree with the code. It is recorded so
the change is made deliberately, with its own evidence, rather than folded into an
unrelated commit.

---

## `P1-19-A-05` — `originating_finding_id` has no foreign key

**What.** `wo.additional_work_requests.originating_finding_id` is a plain `uuid` with
no foreign key to `dia.findings`, so the database will accept an id that names no
finding at all.

**Why the schema is like that.** A cross-schema FK from `wo` to `dia` would couple two
schemas that are otherwise independent, and P1-09 wrote the column that way knowingly.
This is a gap in what the database guarantees, not evidence that the database is wrong.

**What is done instead.** `additional-work-service.ts` validates that the finding
exists and belongs to the same work order before writing the request, and refuses
otherwise. That closes the path callers use and not the one they do not: a direct
database writer holding `app_runtime` could still store a dangling id.

**Impact.** A broken provenance link on a request — "this work was proposed because of
that finding" pointing at nothing. Not a privilege escalation and not a data leak, since
the read path resolves the finding under RLS and returns nothing when it does not
resolve.

**Why it is not closed.** The constraint would be a migration.

---

## `P1-19-A-06` — the diagnostics parent-terminal refusal reads the order unlocked

**What.** `lockRecordableReport` and the report status `move` path now refuse when the
report's work order is terminal — that refusal did not exist before the pre-merge audit,
and its absence let an `in_progress` report keep accepting entries, and be COMPLETED,
after its order had closed. The refusal resolves the parent through the `work-order`
module's public `jobScope`, and **that read is not locked**.

**Residual window.** A closure committing between the parent check and the entry insert
would still admit the entry. `dia` carries no trigger that reads `wo.work_orders`, so
nothing behind the application refuses it.

**Why it is not closed.** Two options, both blocked. A database guard on
`dia.diagnostic_reports` and its entry tables is a migration, which this phase is not
authorised to write. A cross-module lock — `diagnostics` locking `wo.work_orders` — would
either breach ADR-001 rule 3 or require exporting a locking primitive from the work-order
module, leaking transaction semantics across a boundary this phase deliberately keeps
closed.

**Impact.** Low and bounded. The outcome is a late diagnostic entry on a closed order,
not a wrong closure decision: B4 is evaluated by the database trigger at closure time
from the rows that exist then, and this window cannot change what the gate saw. The
non-racing case — the one that was actually reachable, indefinitely, with no concurrency
at all — is now refused.

---

## Deferred by design, not open findings

These are **not** defects and are listed only so a reader does not mistake them for
omissions.

- **Closure blockers for stock reservation and part issue.** The brief lists them;
  `wo.guard_work_order_closure` implements neither, because reservation and issue
  execution are Phase 1-21. No always-passing placeholder was added — a blocker that
  always passes reads as coverage in every report and enforces nothing.
  `DEFERRED_CLOSURE_BLOCKERS` records the owner, the two conditions and the reason.
- **Diagnostic reviewer separation is an application rule.** Unlike BR-QMS-001, which
  is the CHECK `ck_rework_links_signoff_distinct`, no database object enforces that a
  diagnostic reviewer differs from its author. `assertReviewerSeparation` does, and
  this phase says so rather than claiming the stronger form.
- **`tech.technician_certification_details.certificate_number`** is classified
  `restricted` and is reached by no P1-19 operation. It is listed in the sensitive-data
  map as unreached rather than omitted, so a future phase does not have to rediscover
  that it exists.
