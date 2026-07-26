# P1-19 — Execution checkpoint

Updated after every major wave. This file is the recovery point if context is lost.

## Context Continuity Policy

**Authoritative. Supersedes every earlier instruction in this file, in
`README.md`, or in any P1-19 evidence document that told execution to stop at
context pressure or to produce a session handoff.**

- Conversational context pressure is not a project blocker.
- Do not stop after a commit, push, test battery, review, CI run, or completed
  wave.
- Do not produce long narrative handoff reports during execution.
- Persist technical details, discoveries, commands, counts, findings and next
  actions in repository evidence files instead of repeating them in chat.
- Keep chat responses to zero or one short line unless there is a genuine owner
  decision.
- When context is becoming large, use the runtime's compaction capability as
  early as supported and continue from this checkpoint.
- Reviewer agents must write detailed findings to files under `evidence/` and
  return only a concise status to the coordinator.
- Test commands must write full output to evidence/log files; read and discuss
  only failures and final totals.
- Do not repeatedly restate protected SHAs, completed work, or repository
  archaeology already recorded in this checkpoint.
- Continue automatically through Waves 4–9.
- Owner input is required only for a genuine external blocker or the final
  complete P1-19 merge.

### Delivery model (wave-per-PR is revoked)

One long-lived branch, one Pull Request (**#82**), atomic commits per slice,
push after every locally verified wave, hosted CI verified against the exact new
SHA, then continue immediately to the next wave. An owner merge is requested
**once**, after Wave 9 is fully evidenced. Intermediate green CI proves that
checkpoint only and never authorises a merge.

## Current position

| Field               | Value                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Protected base SHA  | `f326e24c0340e2ce97a94a768868a26d0cfbb04f`                                                                                        |
| Current branch      | `feature/p1-19-module-foundation` (long-lived; carries the whole phase)                                                           |
| Current HEAD        | `f6f4ae4` — Waves 4–8 complete; Wave 9 slices A and B done, slice C next                                                          |
| `origin/develop`    | `f326e24…` — unchanged by this phase                                                                                              |
| `origin/main`       | `491c4e0…` — moved by the owner's PR #78 merge, not by this phase                                                                 |
| Pull request        | **#82**, base `develop`, **Draft**, do not merge until Wave 9 is evidenced                                                        |
| GitHub Actions runs | Green **4/4** on the Wave 4 and Wave 5 heads; Wave 6, 7 and 8 heads verified on their exact SHAs                                  |
| Delivery model      | **one branch, one PR, continuous waves** — wave-per-PR was revoked                                                                |
| Totals at HEAD      | Unit **843** / Backend **1074** / DB **1610**; OpenAPI **140 paths / 168 operations**; P1-19 **58/58** operation depth, 0 pending |

## Completed

| Wave | Content                                               | Status                              |
| ---- | ----------------------------------------------------- | ----------------------------------- |
| 0    | Protected ground truth                                | **Complete**                        |
| 1    | Repository archaeology and schema reconciliation      | **Complete**                        |
| 2    | Feature branch, protected baseline, documentation dir | **Complete**                        |
| 3    | Module skeleton, permission catalog, event CR         | **Complete**, CI green              |
| 4    | Work-order core                                       | **Complete**, 8/8 operation depth   |
| 5    | Technician execution                                  | **Complete**, 24/24 operation depth |
| 6    | Additional work and customer approvals                | **Complete**, 32/32 operation depth |
| 7    | Diagnostics                                           | **Complete**, 45/45 operation depth |
| 8    | Quality control, closure and rework                   | **Complete**, 58/58 operation depth |
| 9    | Phase-wide hardening and evidence                     | **In progress**                     |

## Wave 4 progress

| Slice                                                                          | Status          | Commit       |
| ------------------------------------------------------------------------------ | --------------- | ------------ |
| Work-order repository — locked read, versioned state write, history, job reads | **Done, green** | `1313c78`    |
| Closure eligibility — all six blockers, registry order, deferred set           | **Done, green** | `1313c78`    |
| Transition service — catalog edge, reason, terminal pre-report                 | **Done, green** | `1313c78`    |
| Cross-schema allow-list guard (B2/B4 reads, asserted read-only)                | **Done, green** | `1313c78`    |
| Job create / lock / update with `record_version`                               | **Done, green** | `a0fcbeb`    |
| DB tests pinning the blocker query against the deployed guard (9)              | **Done, green** | `a0fcbeb`    |
| Deferred scoped authorization threaded through every entry point               | **Done, green** | `0386553`    |
| Four work-order/job audit actions registered, pin 78 → 82                      | **Done, green** | `0386553`    |
| Reason carried through `app.status_reason` into the guard AND the ledger       | **Done, green** | Wave 4 close |
| Audit + outbox wiring, exactly one of each per transition                      | **Done, green** | Wave 4 close |
| List, aggregate-detail and paginated-history queries with DTOs                 | **Done, green** | Wave 4 close |
| Closure split behind `wo.work_order.close`, one shared write path              | **Done, green** | Wave 4 close |
| Eight routes restored/added, `wave-4-pending/` REMOVED                         | **Done, green** | Wave 4 close |
| 54 backend tests across three suites, 8/8 operation depth                      | **Done, green** | Wave 4 close |

Full evidence: [`evidence/wave-4-work-order-core.md`](evidence/wave-4-work-order-core.md).
Gates green at the Wave 4 head: format, lint, typecheck, module boundaries (279
files), authorization coverage (118), operation coverage (**P1-19 8/8, 0 pending**),
OpenAPI (**102 paths / 118 operations**), WO/TECH/DIA/QMS classification (657
columns), encoding, canonical docs, `security:all`, build.
Unit **843** / DB **1604** / Backend **825** (was 771).

Five defects Wave 4 found in already-reviewed code — full detail in the evidence
document, summarised so they are not rediscovered:

1. `app.status_reason` was never published, so every reason-required edge would have
   failed as a raw `23514` and every ledger reason would have been NULL.
2. `wo.work_order.close` was seeded and enforced nowhere; closure is now its own
   operation and the transition endpoint refuses a closing target.
3. `PATCH /jobs/{jobId}` had no scope target at all (P1-18-A-01 again).
4. A job insert raced by a close raised an unmapped `check_violation` → 500.
5. `parseOrFail` outside `handleOperation` threw out of the route instead of
   rendering a problem document → 500 where a 422 was owed.

Accepted and tracked:

- **P1-19-A-01** — the board's `(opened_at DESC, id DESC)` ordering is not
  index-aligned and no migration is authorised to add one.
- **P1-19-A-02** — `dia.diagnostic_reports.revision_number` has no unique index
  behind it, so monotonic revision numbering rests on an advisory lock alone. A
  partial unique index on `(tenant, company, branch, job_id, revision_number)
WHERE deleted_at IS NULL` would close it; no migration is authorised. Raised in
  Wave 7 archaeology, before any code depended on the claim.

## Wave 5 progress

| Slice                                                                       | Status          |
| --------------------------------------------------------------------------- | --------------- |
| `implementedIn` corrected for the three published events, both pins updated | **Done, green** |
| `wo.job.state_changed` audit action registered, sorted pin updated          | **Done, green** |
| Job transition — graph, reason GUC, assignment precondition mapped          | **Done, green** |
| Job status ledger — paginated, origin block                                 | **Done, green** |
| Technician assignment / unassignment / reassignment, queue                  | **Done, green** |
| Labour sessions — start, stop, pause/resume, correction, job log            | **Done, green** |
| Work-order service lines and required-part demand                           | **Done, green** |
| Available-technician query (ranked candidates)                              | **Done, green** |

Unit **843** / Backend **888** (was 825) / P1-19 operation depth **24/24**, 0
pending, OpenAPI **114 paths / 134 operations**. CI **#212 Success 4/4** on the
Wave 4 head `ff82189`, verified on the exact SHA.

Labour sessions, in one paragraph: `tech.labor_sessions` has ONLY `started_at` and
`ended_at`, so a PAUSE is stopping the session plus a job transition into `paused`
(whose `reason_required` is true) — the pause reason therefore lives in
`wo.job_status_history`, not on the session, and the two halves stay separate
requests because they are separate facts with different permissions. No timestamp
is accepted on the recording path; the one place a caller may state a window is a
correction, behind `tech.labor.correct` (high risk) rather than
`tech.labor.record` (low). One open session per technician is
`ex_labor_sessions_overlap`, a partial gist EXCLUDE over
`tstzrange(started_at, COALESCE(ended_at, infinity))` — two open sessions overlap
by construction — and it arrives as **23P01**, now named `exclusionViolation` in
the platform SQLSTATE map. `ended_at` is write-once, so an amendment is
`tech.correct_labor_session`: soft-delete the original, insert a linked
replacement. The suite resets open sessions in `afterEach`, because the EXCLUDE is
per technician and tenant-wide — a leaked open session would make the suite pass
or fail on execution order.

Assignment slice, in one paragraph so it is not re-derived: `wo.job_assignments`
is append-then-close — ending stamps `valid_to` plus a reason
(`ck_job_assignments_end_reason`) and the row survives, so the row set IS the
history. `uq_job_assignments_active_primary` is a PARTIAL unique index, so a
second live primary is `23505` mapped to `ERR-RES-002`, while `assist` is
unconstrained. Reassignment is ONE transaction because two client calls would
leave a window with no active assignment, during which the job cannot enter any
`assignment_required` state — and the rollback case is sharp: the end is written
BEFORE the incoming technician is evaluated, so an ineligible incoming profile
must leave the outgoing assignment open. Eligibility lives in the `technician`
module and is reached through its public surface, because it is decided entirely
from `tech` rows. Availability is checked against the UNION of intervals: a split
shift is two touching half-open rows and no single one spans a window crossing the
boundary.

Two false positives fixed in this phase's own guards while doing it: the
graph-mirroring assertion's `\b<state>\s*:` matched the EVENT KEY
`` `job.assigned:${id}` `` and flagged the one file that reads the catalog
correctly — now `(?<![\w.-])`, which still fails a bare `assigned:` object key.

A defect Wave 4 left and Wave 5 fixed: the three published events still carried
`implementedIn: null`. The foundation test asserted null for all eleven P1-19
entries, so the catalog claimed nothing was published while two events were being
written on the request path. Both pins now name exactly the published set.

The Wave 5 fact that shapes everything after it: the job-assignments migration
**REPLACED** `wo.guard_job_transition` to require an active `wo.job_assignments`
row before a job may enter a state whose `assignment_required` is true. So
`planned → assigned` is a configured, reason-free edge that STILL fails until a
technician is assigned. It is mapped to `ERR-TECH-001` rather than left to surface
as a bare `23514`, and it is why B1 can currently only be cleared by cancelling a
job. Assignment is the next slice and unblocks the rest.

Two schema facts to build the remaining slices against, verified not assumed:

- `tech.labor_sessions` has **only** `started_at` / `ended_at` — no pause column.
  A pause is therefore the job transition into `paused` (whose `reason_required` is
  true) plus the end of the open session, and the pause REASON lives in
  `wo.job_status_history`. One active session per technician is the partial gist
  `ex_labor_sessions_overlap` (SQLSTATE **23P01**), `ended_at` is write-once, and a
  correction is `tech.correct_labor_session` (soft-delete the original, insert a
  linked one).
- There is **no per-job required-skill storage** anywhere in the protected schema.
  Required skills, levels and certifications can only be supplied by the assigner
  at assignment time and evaluated then; they cannot be persisted or re-checked
  later. Record this as a reconciliation rather than inventing a table.

## The Wave 4 finding that changed its scope

**Work-order creation was already implemented, and re-implementing it would have
been wrong.** P1-18's reception conversion (`P1-18-BE-019`,
`reception-conversion-repository.ts`) inserts `wo.work_orders` — deliberately
writing only six columns plus the display number and leaving `kind`, `state`,
`parts_forward_state` and `opened_at` to their frozen defaults, with a comment
stating that choosing them "would be this module deciding how work is organised —
which is Phase 1-19's contract, not reception's".

So the boundary is **reception opens the shell, P1-19 owns everything after**. A
second insert path would not be the one the reception visit lock and
`uq_work_orders_ordinary_origin` were designed around. Wave 4 consumes what
conversion created. This supersedes the "Wave 4 — contract already extracted"
section below, which was written before that code was read; the six preconditions
and the two `23505` constraints recorded there remain accurate and still matter
for anything that _reads_ a converted order.

## Traps found in Wave 4 — do not rediscover

1. **The module-boundary checker reads a call to the CommonJS loader as an import
   specifier.** Naming a service method with that bare verb produced four false
   `B9` violations, and a fifth from the comment explaining the rename. Avoid the
   name, and avoid writing it literally in a comment.
2. **`wo.jobs.state` has no value-list CHECK** — only a format regex. The
   vocabulary is entirely `wo.job_states`, so never default a job state to a
   literal.
3. **`fk_jobs_work_order` is the composite scope key** `(tenant, company, branch,
work_order_id)`, so cross-branch attachment is impossible at the database
   level; no service check is needed for it.

## Established facts — do not re-derive

1. `origin/develop` matched the expected P1-18 closure SHA exactly; no intervening
   commits. `main` moved only because the owner merged PR #78 (`491c4e0`, parents
   `3e2c44d` + `f326e24`); `develop` is unaffected and remains the correct base.
2. **The execution brief's table names are wrong.** Use only the verified names in
   README §2. The authoritative handoff is
   `docs/phase-1/phase-1-9/p1-19-backend-contract.md`.
3. **44 tables and 27 functions** exist across `wo`, `tech`, `dia`, `qms`.
4. `wo.guard_work_order_closure()` defines blockers **B1–B6** and raises on the
   **first** one only. The eligibility endpoint must independently re-evaluate all
   six. There is no reservation or part-issue blocker — that is Phase 1-21.
5. Cancellation states (`is_cancellation`) bypass B1–B6 by design.
6. **Zero** `wo`/`tech`/`dia`/`qms` permissions are seeded. P1-19 must extend
   `supabase/seeds/04_iam_permission_catalog.sql` — a seed, not a migration.
7. `EVT-WO-001` / `EVT-TECH-001` / `EVT-DIA-001` / `EVT-QMS-001` **do not exist**
   in the repository. See `ECR-P1-19-001`. Decision taken: follow the shipped
   unsuffixed convention with P1-09 granularity.
8. Module convention: `src/modules/<name>/{application,data,domain}/*.ts` plus
   `index.ts` as the only public surface; cross-module imports must use
   `@/modules/<name>`.
9. Baseline is green: Unit **829** / DB **1547** / Backend **771**, 110 OpenAPI
   operations, 1104 tracked files.
10. `validate:seed-state` ignores `DATABASE_URL` and fails on a dev database after
    `test:db` — pre-existing `P1-05-SEEDRESIDUE`, not a P1-19 signal.

## Open decisions

| ID              | Decision needed                        | Blocking                                   |
| --------------- | -------------------------------------- | ------------------------------------------ |
| `ECR-P1-19-001` | Event type names and suffix convention | Acceptance 6 only; implementation proceeds |

## Wave 3 progress

| Slice                                                                     | Status                                        | Commit    |
| ------------------------------------------------------------------------- | --------------------------------------------- | --------- |
| `work-order` module — domain, catalog repository, catalog service, index  | **Done, green**                               | `0445ee1` |
| Error codes `ERR-WO-001` / `ERR-TECH-001` / `ERR-DIA-001` / `ERR-QMS-001` | **Done, green**                               | `0445ee1` |
| `technician` module                                                       | **Done, green**                               | `e8d6235` |
| `diagnostics` module                                                      | **Done, green**                               | `e8d6235` |
| `quality` module                                                          | **Done, green**                               | `e8d6235` |
| IAM permission seed for the `wo`/`tech`/`dia`/`qms` domains (22 codes)    | **Done, green**                               | `e8d6235` |
| Event envelope registrations (11 reserved names)                          | **Done, green**                               | `e8d6235` |
| Module-boundary tests for the new modules (11 tests)                      | **Done, green**                               | `e8d6235` |
| Permission-total pin `71 → 93`                                            | **Done, green**                               | `662b2f3` |
| Clean room at `662b2f3`                                                   | **Done, green**                               | —         |
| Wave 3 evidence document                                                  | **Done**                                      | —         |
| Adversarial review (2 reviewers, 0 Crit / 1 High / 10 Med, all fixed)     | **Done**                                      | `81c9d5c` |
| Clean room re-run at the remediated SHA                                   | **Done**                                      | `81c9d5c` |
| Branch pushed                                                             | **Done**                                      | `595bfd5` |
| Wave 3 PR                                                                 | **BLOCKED** — no browser, no gh CLI, no token | —         |
| Hosted CI                                                                 | Blocked on the PR                             | —         |

Gates green at `595bfd5`: format, lint, typecheck, module boundaries (**269**
files scanned), OpenAPI (94 paths / 110 operations), authorization coverage,
operation coverage, encoding, `security:all`, build. Unit **842** (was 829) /
DB **1595** (was 1547) / Backend **771**.

Clean room at `81c9d5c`: 119 migrations, 7 seeds, `schema_hash a677eb05…`
**unchanged** from the P1-18 baseline, 242 tables / 212 functions / 631 policies /
541 triggers / 999 indexes, 0 SECURITY DEFINER, 0 unforced RLS, 93 permissions
(22 P1-19), `validate:seed-state` exit 0, business tables empty. Full evidence in
[`evidence/wave-3-module-foundation.md`](evidence/wave-3-module-foundation.md).

The `baseline_fingerprint` moved `0ee203f2…` → `f7baf9b0…`. That is correct, not a
regression: the fingerprint covers seed content, and the permission catalog grew
by 22 rows. A fingerprint that had NOT moved would mean the seed had not landed.

One flake, recorded rather than hidden: the first full `test:db` run failed
`shared event-outbox worker lifecycle > a single claim never returns more than its
limit`. It passed in isolation and on a clean re-run. Not attributable to this
wave — every P1-19 event entry is `implementedIn: null` and nothing in the diff
touches the outbox.

## Corrections made during Wave 3 — do not re-derive

1. **Four vocabularies in the phase brief were wrong**, caught only by reading
   `pg_constraint` rather than trusting the brief: `wo.work_orders.kind` is
   `('ordinary','rework')` with no `warranty` or `internal`; `parts_forward_state`
   is `('none','requested','reserved_elsewhere')` with no `reserved` and no
   `issued`; additional-work state uses `rejected` not `declined`; fulfillment uses
   `waived` not `not_required`. **Verify every remaining vocabulary the same way
   before writing it.**
2. **`ERR-TRN-001` already exists** and already means "transition not permitted
   from the current state" (409, conflict, owner `transition`). Plain graph
   refusals reuse it; the four new codes cover only genuinely new semantics.
3. **`SafeDetails` is a closed platform shape** — only `violations`,
   `retryAfterSeconds`, `contract`, `requiredPermissions`. Do not widen it from a
   module. `message` is log-only and never reaches a caller.
4. **`src/server/events/envelope.ts` IS a formal `EVT-` registry** with 20 codes
   allocated (IAM, CRM, VEH, APT, REC, DOC, NTF, TPL, ORG) and none for
   `wo`/`tech`/`dia`/`qms`. This refines `ECR-P1-19-001`: the registry exists, and
   P1-17 and P1-18 both allocated new codes in it with documented rationale, so
   allocating `EVT-WO-*` and siblings is precedented rather than novel.
5. **Three inventories move together** when an error code is added — the sorted
   code list and the sorted status/owner/class inventory, both in
   `tests/foundation/p1-15-catalogs.test.ts`, plus the error enum in
   `docs/api/openapi.v1.json`. All three are alphabetically ordered.
6. The transition graph is **rows, not code**. Read it through
   `WorkOrderCatalogRepository`; never mirror it in TypeScript.

## Current blocker

**None.** The Wave 3 PR-open blocker is RESOLVED: PR
[#82](https://github.com/Ezzaldeen-Albitar/RootLco/pull/82) is open in Draft
against `develop` and carries the whole phase. Hosted CI ran green 4/4 on the
Wave 3 head. Pushes to this branch update #82 automatically.

## Wave 4 — contract already extracted, do NOT re-derive

Read from the live catalog before Wave 4 implementation began. Every fact below is
verified; start from these rather than re-querying.

### Creation is gated by `wo.guard_work_order_refs()` (BEFORE INSERT)

An insert into `wo.work_orders` is refused unless **all** of these hold:

| #   | Precondition                                                                       | Failure SQLSTATE |
| --- | ---------------------------------------------------------------------------------- | ---------------- |
| 1   | The `rec.reception_visits` row exists in the **same** tenant + company + branch    | `23503`          |
| 2   | `work_orders.vehicle_id` equals the visit's `vehicle_id`                           | `23514`          |
| 3   | Visit `reception_status` is `authorized` **or** `converted`                        | `23514`          |
| 4   | An `approved` row exists in `rec.authorizations` for that visit                    | `23514`          |
| 5   | A `rec.custody_history` row with `to_state = 'accepted'` exists for that visit     | `23514`          |
| 6   | The initial `state` resolves to a defined **active** state and is **not** terminal | `23514`          |

So the service must not invent its own eligibility rules — it maps these six to
readable refusals. Note precondition 3 admits `converted`, which is what makes a
second **rework** work order legal against an already-converted visit.

### Exactly-one conversion is an index, not a trigger

```
uq_work_orders_ordinary_origin
  UNIQUE (tenant_id, company_id, branch_id, reception_visit_id)
  WHERE kind = 'ordinary' AND deleted_at IS NULL
```

Duplicate conversion therefore arrives as **`23505`**, not a check violation, and
only for `kind = 'ordinary'`. A `rework` order against the same visit is
deliberately permitted — that is how corrective work attaches. The service must
map `23505` on this index to a deterministic conflict rather than a generic 500.

`uq_work_orders_active_display_number` is `(tenant_id, display_number)` where the
number is non-null and not deleted — a second `23505` with a different meaning, so
the two must be told apart by constraint name.

### Numbering already exists

`src/modules/shared-services/domain/sequence-registry.ts:105` registers sequence
code `work_order` targeting `wo.work_orders`. Borrow it through
`@/modules/shared-services` exactly as the reception module does — do not mint a
second allocator.

### A nuance worth keeping

`guard_work_order_refs` resolves the initial state with `status = 'active'` **in
the WHERE**, whereas `guard_work_order_transition` resolves first and checks status
after. The two guards genuinely differ. Wave 3's catalog reads follow the
_transition_ guard's shape (resolve then filter), which is correct for transitions;
creation should read the state list and check `isTerminal` itself rather than
assume the two resolutions coincide.

## Wave 6 — contract already extracted, do NOT re-derive

Read from the protected migration `20260722100000_wo_services_parts_approvals.sql`
before Wave 6 implementation began. Every fact below is verified against it.

### Approval comes BEFORE the state change, and the guard enforces that order

`wo.guard_additional_work_state` (BEFORE UPDATE OF state) refuses
`state = 'approved'` unless an `approved` row already exists in
`wo.customer_approvals` for that request. So the only legal sequence is:

1. record the customer approval (`decision = 'approved'`);
2. then move the request to `approved`.

That is the forgery-resistance control, and it means one service method must do both
in one transaction — a client doing them as two calls would leave a window where an
approval exists and the request does not reflect it. Attempting the state change
first fails as a `check_violation` and must be mapped, never surfaced as a 500.

### One active approval per request, and its content is immutable

`uq_customer_approvals_active` is
`(tenant, company, branch, additional_work_request_id) WHERE deleted_at IS NULL`, so
a second decision on the same request is `23505`.
`tg_customer_approvals_immutable` freezes `decision`, `channel`, `presented_scope`,
`quotation_revision_ref`, `decided_at` and `deciding_party_role_id` — a recorded
decision can never be edited, and no application role holds DELETE (INSERT + UPDATE
grants only), so it cannot be erased either.

### The deciding party must belong to the SAME reception visit

`wo.guard_customer_approval_coherence` resolves request → work order →
`reception_visit_id` and refuses a `deciding_party_role_id` whose
`rec.reception_party_roles.reception_visit_id` differs, or whose tenant differs. The
deciding party is therefore not free text and not any customer — it is a party
already recorded on the visit that produced the work order. `23514` for a foreign
visit, `23503` for an unresolvable role.

### The customer-facing description is RESTRICTED at the RLS layer

`wo.additional_work_request_details` is 1:1 with the request, its `classification`
is CHECK-fixed to `'restricted'`, and all three policies (SELECT, INSERT, UPDATE)
additionally require `iam.has_permission('iam.sensitive.view')`. A caller without
that permission can neither read nor write it — the row does not exist for them. So
Wave 6 must treat the detail as a separate, separately authorized surface and must
NOT fold it into the request projection, or the request read would silently return
nothing for an ordinary service advisor.

### `originating_finding_id` has no foreign key

It is an opaque soft link to `dia.findings`, which Wave 7 builds. Provenance from a
diagnostic finding can be RECORDED in Wave 6 and cannot be validated until Wave 7
exists. `originating_job_id` by contrast IS a composite foreign key and must belong
to the request's own work order — the same explicit check the service lines needed,
because the key alone admits a job under a different order in the same branch.

### Vocabularies, verbatim

- `state`: `pending` | `approved` | `rejected` | `withdrawn` (never `declined`).
- `fulfillment_state`: `unfulfilled` | `fulfilled` | `waived` (never `not_required`).
- `channel`: `in_person` | `phone` | `email` | `sms` | `portal` | `other`.
- `decision`: `approved` | `rejected` — there is no `pending` decision row.
- `is_required` is IMMUTABLE after insert (`tg_additional_work_requests_immutable`).

### Closure blocker B3 is why this wave matters

B3 fires when a REQUIRED request is `pending`, or `approved` with
`fulfillment_state = 'unfulfilled'`. Wave 4 already reports it; Wave 6 is the first
wave that can create the condition and clear it, so its integration case should walk
request → blocked closure → approval → fulfilment → closure.

### Permissions and events already seeded

`wo.additional_work.request` (medium) and `wo.additional_work.approve` (high) are
seeded. `EVT-WOR-004` `additional-work.requested` and `EVT-WOR-005`
`customer-approval.recorded` are registered with owner `wo` and
`implementedIn: null` — Wave 6 sets both, and must add them to the two
`implementedIn` pins (`tests/foundation/p1-19-module-foundation.test.ts` and
`tests/foundation/event-envelope.test.ts`) in the same commit.

Audit actions for this wave are NOT yet registered. Add them to
`src/server/auth/audit-actions.ts` and to the sorted pin in
`tests/foundation/p1-15-catalogs.test.ts`; the sort is by the FULL code, so
`wo.additional_work.*` sorts before `wo.job.*`.

### Attachment evidence

`wo.customer_approval_evidence` is append-only and binds an exact document version.
The Phase 1-15 attachment service is the only way to create one, and the route must
never accept a storage key — the same rule P1-18 reception evidence follows.

## Wave 6 progress — COMPLETE at `4f0a347`

| Slice                                                                              | Status          |
| ---------------------------------------------------------------------------------- | --------------- |
| Request rows, detail row, approval row, evidence row in the repository             | **Done, green** |
| `AdditionalWorkService` — raise, list, detail write/read, withdraw, decide, fulfil | **Done, green** |
| `diagnostics` module gains `findingOrigin`, so finding provenance is checkable     | **Done, green** |
| Eight routes; `ERR-WO-002` registered; six audit actions; two events published     | **Done, green** |
| The unapproved-work execution gate, inside `wo.job-transition`                     | **Done, green** |
| 63 backend tests across two new suites                                             | **Done, green** |

Full evidence:
[`evidence/wave-6-additional-work-approvals.md`](evidence/wave-6-additional-work-approvals.md).

Three facts from this wave that shape the ones after it:

1. **The execution gate uses B3's FIRST limb only, and the reason is a deadlock.**
   B3 blocks closure on a required request that is `pending` OR `approved` +
   `unfulfilled`. The gate uses only `pending`. Including the second limb would
   stop the job entering any `labor_allowed` state, so the approved work could
   never be done, the request could never become fulfilled, and B3 could never
   clear. Wave 8's closure work must not "fix" this by aligning them.
2. **`iam.sensitive.view` is now a real second permission on two operations.** The
   `SENSITIVE` fixture principal exists beside `FULL` for exactly that reason —
   they differ by one permission. Any later wave touching a restricted table must
   use the same pattern rather than granting `FULL` the permission.
3. **`quotation_revision_ref` is a REAL foreign key** to `quo.quotation_revisions`
   (migration 20260723097000), whatever the Phase 1-9 comment says. Nothing writes
   it in this phase.

## Wave 7 — contract extracted, do NOT re-derive

Read from `20260722093000_dia_qms_catalogs.sql`,
`20260722101000_dia_templates_versions_items.sql`, `20260722102000_dia_reports.sql`
and `20260722103000_dia_findings_measurements_evidence.sql` before implementation.

### The report graph IS code, unlike the work-order and job graphs

`dia.guard_diagnostic_report_transition` holds a FIXED lifecycle in a PL/pgSQL
`IF` chain, not in a catalog table:

```
draft        → in_progress | cancelled
in_progress  → completed   | cancelled
completed, cancelled: terminal
```

So this graph MAY be mirrored in TypeScript — the reason the work-order and job
graphs may not is that theirs are tenant-overridable ROWS. Mirroring this one is
the same decision every pre-P1-19 module made, and the reconciliation test pins it
against the deployed function body.

`dia.emit_diagnostic_report_status_history` is AFTER UPDATE only and reads
`app.status_reason` — the same GUC contract as `wo`, so the reason must be
published or every ledger reason is NULL. Creation emits NO row, so the report
history needs the same derived `origin` block the work-order and job histories use.
`dia.guard_diagnostic_report_status_coherence` refuses a ledger row whose
`to_state` differs from the report's current status, so the ledger cannot be
written independently.

### Creation preconditions, from `dia.guard_diagnostic_report_refs`

| #   | Precondition                                                     | SQLSTATE |
| --- | ---------------------------------------------------------------- | -------- |
| 1   | `job_id` belongs to `work_order_id` (same tenant/company/branch) | `23514`  |
| 2   | The pinned `template_version_id` is **`published`**              | `23514`  |

Both arrive as `check_violation` and must be told apart by message or by
pre-checking, or the caller gets one opaque 409 for two different mistakes.

### Revision numbering has NO constraint behind it — this is a real limitation

`dia.diagnostic_reports.revision_number` carries only `CHECK (> 0)`. There is **no
unique index** on `(job_id, revision_number)` anywhere. So monotonic numbering is
entirely the application's, and two concurrent creations on one job would both
compute `max + 1` and both be accepted.

The mitigation is the platform's own established pattern:
`pg_advisory_xact_lock(hashtextextended(...))` then `COALESCE(MAX(...), 0) + 1`,
exactly as `shared-services/data/document-repository.ts:208` does for document
versions. But note the honest difference, which that file states explicitly: there,
"the advisory lock makes a collision rare, and the constraint makes one
impossible." **Here there is no constraint.** Record this as an accepted limitation
(`P1-19-A-02`) and a change request; do NOT claim guaranteed monotonicity.

### Template versions freeze, and their items freeze with them

`dia.guard_template_version_publish`: `draft → published → retired` only, never
back; publish stamps `published_at`. `dia.guard_template_item_frozen` refuses ANY
insert or update on `dia.template_items` — including a soft-delete — once the
parent version is not `draft`. A report may pin only a `published` version, so a
pinned report is reproducible for ever.

**No `dia` catalog rows are seeded at all** — types, templates, versions and items
are operator configuration with no write route in this phase, exactly like the
`tech` catalogs in Wave 5. Fixtures seed them as admin and say so.

### Vocabularies, verbatim

- report `status`: `draft` | `in_progress` | `completed` | `cancelled`
- template version `status`: `draft` | `published` | `retired`
- template item `response_type`: `numeric` | `text` | `boolean` | `select`;
  `ck_template_items_unit` makes `unit` **required** when `numeric`
- finding `severity`: `info` | `low` | `medium` | `high` | `critical`
- finding `disposition`: `monitor` | `repair_recommended` | `repair_required` | `no_action`
- DTC `dtc_status`: `active` | `pending` | `stored` | `cleared`;
  `ck_dtc_records_code_format` is `^[PBCU][0-9][0-9A-F]{3}$` (upper-case hex only)
- recommendation `priority`: `low` | `medium` | `high`
- review `review_result`: `approved` | `rejected` | `needs_rework`

### Range validation is the application's, and the rule lives in jsonb

`dia.measurements.measured_value` is bare `numeric` with **no** precision, scale or
range constraint; `unit` is NOT NULL; `within_range` is a nullable boolean the
application computes. The configured range is
`dia.template_items.validation_rule` (`jsonb`, nullable) — so its shape is this
phase's decision and must be documented, not invented silently. `within_range`
must be NULL when no rule exists, because `false` would assert an out-of-spec
reading nobody checked.

### Reviewer attribution cannot be forged, but reviewer SEPARATION is not enforced

`dia.stamp_review()` overwrites `reviewer_id` with `iam.current_user_id()` and
`reviewed_at` with `now()` on every insert, and raises when the session has no
actor. `dia.diagnostic_reviews` is append-only (SELECT + INSERT only).

There is **no separation constraint**: nothing stops the report's own author
reviewing it. `dia.diagnostic_reports.created_by` is the only comparison available,
so separation is an APPLICATION rule against that column and must be stated as
such.

### Two provenance links the brief asks for do NOT exist

- `dia.recommendations` has **only** `diagnostic_report_id`. There is no
  `finding_id`, so **finding → recommendation provenance is not storable.** Report
  it as a reconciliation; do not invent a column.
- `wo.additional_work_requests.originating_finding_id` links to a **finding**, not
  to a recommendation. So the real chain is
  finding → additional work, not recommendation → additional work. Wave 6 already
  validates that link through `diagnosticsModule().completion.findingOrigin`.

### Permissions and events

`dia.diagnostic.record` (medium), `dia.diagnostic.complete` (medium),
`dia.diagnostic.review` (high) and `dia.diagnostic.read` (low) are seeded.
`EVT-DIA-001` `diagnostic-report.completed` is registered with owner `dia` and
`implementedIn: null` — Wave 7 sets it and updates both pins. No audit action for
`dia.*` is registered yet.

`dia.diagnostic_evidence` is append-only and binds an exact document version,
identically to `wo.customer_approval_evidence` — reuse the Wave 6 pattern
(`attachments.scanState` for visibility, refuse `rejected`/`quarantined`, never
accept a storage key).

## Wave 8 — contract extracted, do NOT re-derive

Read from `20260722104000_qms_quality_control.sql` and
`20260722105000_qms_rework_closure_gate.sql`.

### A rework work order has NO creation path anywhere in the platform

This is the finding that shapes the whole wave. `qms.guard_rework_link_coherence`
demands that the rework work order have `kind = 'rework'` and share the original's
`reception_visit_id`. But reception's conversion —
`reception-conversion-repository.ts:80` — inserts exactly seven columns and leaves
`kind` to its `'ordinary'` default, and nothing else in the platform inserts
`wo.work_orders` at all. So **no shipped code can produce a rework work order**, and
without one `qms.rework_links` is unreachable and B6 can never fire.

Wave 8 must add that path, and doing so does NOT contradict the Wave 4 boundary
decision. That decision was about the ORDINARY path, which reception owns because it
originates from an authorized visit. A rework order originates from a CLOSED work
order, which is entirely inside this phase, and `kind = 'rework'` exists for exactly
this. Two schema facts confirm it was designed for: `guard_work_order_refs`
precondition 3 admits a `converted` visit, and `uq_work_orders_ordinary_origin` is
PARTIAL on `kind = 'ordinary'` so a second rework order against the same visit is
deliberately permitted.

The insert belongs in `work-order` (it owns `wo.work_orders`) and is reached from the
rework command through that module's public surface, so the new order and its
`qms.rework_links` row land in ONE transaction. Borrow the display number from
`sequence-registry` code `work_order`, as reception does — never a second allocator.

### The sign-off separation IS enforced by the database, unlike Wave 7's

`ck_rework_links_signoff_distinct` refuses `independent_sign_off_by` equal to
`lead_technician_id`, and `ck_rework_links_safety_lead` makes a lead technician
mandatory when `is_safety_critical`. So BR-QMS-001 is a CHECK here, where diagnostic
reviewer separation had to be an application rule. Say so rather than claiming credit
for it.

`qms.guard_rework_signoff` makes sign-off write-once and stamps `sign_off_at`;
`independent_sign_off_by` and `lead_technician_id` are **technician profile ids**, not
user ids, and both are foreign-keyed with the full branch scope key.
`org.guard_immutable_columns` freezes both work-order ids and `lead_technician_id`,
so the lead cannot be swapped to make a signature legal after the fact.

### Reopen is a recorded refusal, never a mutation

`qms.attempt_reopen(work_order, reason)` is `SECURITY INVOKER`, granted to
`app_runtime`, and is the ONLY sanctioned path. It records a `qms.reopen_attempts`
row whose `outcome` is CHECK-fixed to `'rejected'` — the vocabulary has one value —
and never touches the work order (BR-WO-002). It raises `no_data_found` when the order
is not visible and `check_violation` when it is not closed; both must be mapped.
`requested_by`/`requested_at` are server-stamped by `qms.stamp_reopen_attempt()`.

### Quality control

`overall_result`: `pending` | `passed` | `failed`. `qms.guard_qc_finalize()`
server-stamps `checker_id` and `finalized_at` on `pending → passed|failed` and then
FREEZES all three, so a finalized record can never be re-judged. There is NO unique
index on `(work_order_id)`, so a repeat QC is a NEW record — which is what B5 reads.

`qms.qc_check_results.result`: `pass` | `fail` | `na`, one live row per
`(record, check)`. `qms.qc_status_history` is the append-only ledger.

**B5 has two limbs and they are different questions.** B5a: a `failed` record with no
`passed` record blocks. B5b: if ANY mandatory `qms.qc_checks` row is configured
tenant-wide, a `passed` record is REQUIRED. Wave 4's `QualityGateStatus` already
separates them as `failedWithoutPass` and `mandatoryPassMissing`; keep that split.

### The restricted rework cost

`qms.rework_link_details` is 1:1 with a link, `classification` is CHECK-fixed to
`'restricted'`, and all three policies additionally require `iam.sensitive.view` —
the same shape as `wo.additional_work_request_details`. Reuse the Wave 6 pattern
exactly: its own operations declaring the sensitive permission alongside the
functional one, never folded into the link projection. `rework_cost` is
`numeric(14,4)`, so it crosses as a STRING; `cost_currency` is `^[A-Z]{3}$`.
It is an internal quality KPI and explicitly NOT a billing artifact.

### Permissions and events

`qms.quality_control.record` (medium), `qms.quality_control.finalize` (high),
`qms.rework.manage` (high), `qms.rework.sign_off` (high) and
`qms.quality_control.read` (low) are seeded. `EVT-QMS-001`
`quality-control.finalized` and `EVT-QMS-002` `rework.linked` are registered with
`implementedIn: null`. No `qms.*` audit action is registered yet.

## Wave 8 progress — COMPLETE at `e18df4a`, remediated at `ddc30b5`

| Slice                                        | Status       | Commit    |
| -------------------------------------------- | ------------ | --------- |
| A — quality control (5 operations)           | **Complete** | `e18df4a` |
| B — reopen refusal and rework (8 operations) | **Complete** | `e18df4a` |
| Operational journey through the real routes  | **Complete** | `980d1a8` |
| Adversarial review remediation               | **Complete** | `ddc30b5` |

Thirteen `qms.*` operations, 41 route-level tests, no migration and no seed change.
Full detail in [`evidence/wave-8-quality-rework.md`](evidence/wave-8-quality-rework.md).

### What Wave 8 established — do not re-derive

- **`kind = 'rework'` now has a creation path.** `work-order`'s `openRework` is the
  only one, reached from `quality` through the module's public surface, so the new
  order and its `qms.rework_links` row commit in one transaction.
- **The seeded `cancelled` state carries `is_closed = true`.** Not just
  `is_terminal` — five comments in this branch asserted otherwise before the review.
  Only a genuinely closed original may be reworked.
- **Reopen's success path is a refusal.** `qms.attempt_reopen` records the attempt and
  never mutates the order, so the endpoint returns 201 with the attempt id. An earlier
  implementation threw, which rolled back the very ledger row the mechanism exists for.
- **The record/finalize permission split is proven, not asserted.** `QC_CHECKER` in
  `tests/backend/p1-19-helpers.ts` holds `qms.quality_control.record` and not
  `.finalize`.

## Wave 9 — in progress

Phase-wide hardening and evidence. The remaining P1-19-BE/SEC/QA/DO/DOC tasks, the
endpoint inventory, the authorization and sensitive-data maps, the permission, event,
error and audit reconciliations, the transition-graph coverage, the B1–B6 matrix, the
concurrency and rollback suites, structured logging, the security, state-machine,
closure-gate, OpenAPI, event and error documentation, the change log, the traceability
matrix, the open-decision register and the DevOps/CI integration — then the final
adversarial review, the final local battery at the exact final SHA, the final clean-room
reproof, and PR #82's final preparation.

**Do not merge PR #82. Do not create a gate-record PR. Do not start P1-20.**

## Next action

**Wave 9, slice A — the phase-wide reconciliations.** Build the endpoint inventory
from the registry rather than from memory, then reconcile permissions, events, audit
actions and error codes against the seeded catalogs, and write the authorization and
sensitive-data maps. Then slice B: the transition-graph coverage, the B1–B6 closure
matrix, and the concurrency and rollback suites. Then slice C: documentation, the
change log, the traceability matrix and the open-decision register. Then the final
adversarial review, the final battery, the clean-room reproof and PR #82's
preparation.

---

_Superseded by Wave 8's completion._

**Wave 8, slice A — quality control.** Then slice B: reopen refusal and the rework
link, including the `kind = 'rework'` work-order creation the platform currently
cannot perform. Then Wave 9.

---

_Superseded by Wave 7's completion._

**Wave 7, slice A — report creation, the pinned template version, and the report
read.** Add a `dia` repository write surface and a
`DiagnosticReportService` beside `DiagnosticsCompletionService`; register
`dia.diagnostic-create` (POST `/jobs/{jobId}/inspections`, preserving the approved
API vocabulary while the internal model uses the real `dia` names),
`dia.diagnostic-detail` and `dia.diagnostic-history`. Then slice B: item results,
measurements with range validation, DTCs, findings, evidence. Slice C: completion,
recommendations, review with separation. Run the same command sequence after each
slice.

---

_Superseded — kept because its facts remain accurate for anything that reads a
converted order._

**Wave 6, slice A — additional-work requests.** Extend
`src/modules/work-order/data/work-order-repository.ts` with the request rows, add an
`AdditionalWorkService` beside `JobAssignmentService`, and register
`wo.additional-work-request` (POST `/work-orders/{workOrderId}/additional-work`),
`wo.additional-work-list` (GET, same path) and `wo.additional-work-withdraw`.

Then slice B: the approval command that records the decision AND flips the request to
`approved` in one transaction; the restricted-detail surface behind
`iam.sensitive.view`; and the evidence link through the shared attachment service.

Run after each slice, in order:

```bash
npm run typecheck && npm run lint && npm run validate:module-boundaries
```

```bash
UPDATE_OPENAPI=1 npx vitest run tests/openapi-contract.test.ts
```

```bash
npm run format && npm test && npm run test:backend && npm run validate:operation-coverage
```
