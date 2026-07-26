Implements Phase 1-19 — Work Order, Diagnostics, and Technician Backend. **58
operations** across four new modules, delivered over Waves 3–9 on one branch with one
pull request.

|                   |                                            |
| ----------------- | ------------------------------------------ |
| Protected base    | `f326e24c0340e2ce97a94a768868a26d0cfbb04f` |
| Evidence-verified | `8a76c7e1e82534c34d70fd014b433f3386d3e3cf` |
| Diff at that SHA  | 129 files, +47,609 / −1,935                |

Every figure below was measured at the evidence-verified SHA, which is where the clean
room ran and where all four checks passed. One later commit records this PR's own final
state in the execution checkpoint; it is **documentation-only** and its executable diff
against that SHA is empty.

**No migration. No grant, role, policy, function or trigger changed.** The
`wo`/`tech`/`dia`/`qms` schema has been frozen since Phase 1-12 and this phase is not
authorised to change it. **One seed file did change**:
`supabase/seeds/04_iam_permission_catalog.sql` gained 22 permission codes (+61 / −1),
which is why the `iam.permissions` census moves from 71 to 93. It is additive structural
reference data under `ON CONFLICT (permission_code) DO NOTHING`; a permission row grants
nothing until a tenant role maps it, and this phase seeds no role and no mapping.

## The surface

| Schema | Operations | Content                                                      |
| ------ | ---------- | ------------------------------------------------------------ |
| `wo`   | 26         | Work orders, jobs, service lines, additional work, approvals |
| `dia`  | 13         | Versioned diagnostic reports, entries, completion, review    |
| `qms`  | 13         | Quality control, reopen refusal, rework                      |
| `tech` | 6          | Labour sessions, technician queues and availability          |

Generated inventory: [`evidence/endpoint-inventory.md`](docs/phase-1/phase-1-19/evidence/endpoint-inventory.md).
OpenAPI goes from 110 to **168** published operations (94 → 140 paths).

## Evidence

| Gate                                                | Result                                  |
| --------------------------------------------------- | --------------------------------------- |
| Unit (`npm test`)                                   | **843** passed, 40 files (+14)          |
| Database (`npm run test:db`)                        | **1610** passed, 136 files (+63)        |
| Backend (`npm run test:backend`)                    | **1074** passed, 52 files (+303)        |
| P1-19 operation depth                               | **58/58**, 0 pending                    |
| `validate:module-boundaries`                        | OK — 324 files, 11 rules                |
| `validate:authorization-coverage`                   | OK — every route guarded and registered |
| `validate:openapi`                                  | OK — 140 paths / 168 operations         |
| `validate:p1-19-inventory` (**new**)                | OK — 58 operations reconciled           |
| `format:check`, `lint`, `typecheck`                 | green                                   |
| `validate:encoding`, `security:all`, `no-fake-data` | green                                   |

Each suite's delta **equals** the phase's own new tests exactly — 14, 63 and 303, each
measured directly rather than inferred. That is the check that no inherited assertion was
weakened to make this phase pass. Four inherited files changed and all four are
**censuses** (permission, audit-action, event, published-operation counts) that
necessarily move when a phase seeds new codes; no `toThrow`, status-code, policy or RLS
assertion was touched.

## Exact-SHA clean-room reproof

Fresh `postgres:17-alpine` (PostgreSQL 17.10), empty database, isolated port. All 119
migrations apply; migration 120 absent; migrations unchanged against `develop`; seven
declared seed files apply **twice** idempotently; business tables empty; structural review
**PASS** (537 FKs validated, no runtime-reachable destructive cascade, zero dictionary
drift). Full DB, backend and unit suites green against it.

```
schema_hash a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c
```

Byte-identical to the frozen P1-17/P1-18 baseline, and **measured again after all three
suites had run** — which proves the phase's 380 new tests leave no DDL residue.

Full detail: [`evidence/clean-room-validation.md`](docs/phase-1/phase-1-19/evidence/clean-room-validation.md).

## What this phase had to design rather than implement

**A rework work order had no creation path anywhere in the platform.** Reception's
conversion writes seven columns and leaves `kind` to its `'ordinary'` default, and nothing
else inserted `wo.work_orders` at all — so `qms.rework_links` was unreachable and closure
blocker B6 could never fire. `openRework` now lives in the `work-order` module (which owns
the table), is called from `quality` through the module's public surface, and commits the
new order and its link in one transaction.

**The closure gate reports one blocker; the endpoint must report six.**
`wo.guard_work_order_closure` raises on the first blocker and aborts, so
`GET /closure-eligibility` re-evaluates all six independently in a read-only path while
the closure transition still relies on the trigger as the authority. The two are pinned
together against the **deployed** function body, so a seventh blocker added to the
database can never be silently unreported.

**Reopen is a recorded refusal, not a transition.** `qms.attempt_reopen` writes the attempt
and never touches the order, so the endpoint returns 201 with the attempt. The first
implementation threw — which rolled back the very ledger row the mechanism exists to
write.

**P1-18-A-01 is closed on this surface — and was not until the final review.**
`scope: 'branch'` is inert without a concrete target, so every id-addressed command
re-checks scope via `authorizeScope` against the row **after** it is locked `FOR UPDATE`,
and each read is probed four ways: unpermitted → 403, permitted-elsewhere-but-RLS-visible →
403, no-grant-here → 404, cross-tenant → 404. One operation was missing all of it and the
final review found it — see below.

Reasoning per surface: [`evidence/state-machines-and-closure-gate.md`](docs/phase-1/phase-1-19/evidence/state-machines-and-closure-gate.md),
[`evidence/security-review.md`](docs/phase-1/phase-1-19/evidence/security-review.md),
[`evidence/errors-and-events.md`](docs/phase-1/phase-1-19/evidence/errors-and-events.md).

## Review history

Waves 6, 7 and 8 were each reviewed adversarially before the next began, and each review
found real defects in that wave's own work — 28 raised in Wave 8 alone, 12 confirmed, 16
refuted. A final adversarial review ran over the whole phase diff with refute-first
verification.

The **final** review raised 24, refuted 15 and confirmed 9 — **1 High, 8 Low, 0 Critical,
0 Medium** — and every one is FIXED in the tree; none was accepted as an open item and none
needed a migration. Full record:
[`evidence/final-adversarial-review.md`](docs/phase-1/phase-1-19/evidence/final-adversarial-review.md).

The High is the one that matters. `tech.labor-session-list` declared `scope: 'branch'` and
its handler forwarded no authorizer, so P1-18-A-01 was left **open on timesheet data** — a
caller permitted in one branch and RLS-visible in another could read who worked there and
for how long. Its own suite had made every read as a fully-permitted principal and asserted
a cross-tenant caller got `200` with an empty list, with a comment justifying it. It is
fixed three ways: the service re-checks the job's scope before any row is read, the suite
runs the four-way probe, and a **structural guard** now fails the build for any operation
declaring `scope: 'branch'` whose handler enforces nothing. The guard's first version was
satisfied by the comment explaining the fix, so it strips comments — and it is
mutation-tested against the defect it exists to catch.

The remaining eight are Low: two unlocked parent reads (both fixed, the second needing a
deliberate parent-first lock order to avoid inverting the module's own), `eligible: true`
on a terminal order, a `reason` field accepted and discarded, and four false claims in
this phase's own evidence.

The findings that mattered across the phase were mostly in the **evidence**, not the code,
and each is recorded with what it previously claimed rather than quietly replaced:

- Wave 8's manifest claimed authorization, denial and isolation evidence for five reads
  while performing every one of them as a fully-permitted principal. The coverage gate
  cannot catch that — it checks an operation id appears in executable code, not that an
  assertion backs the flag.
- Five comments in one file asserted that the seeded `cancelled` state is not `is_closed`.
  It is, and the code admitted a cancelled order to rework because of it.
- Three phase-level documents claimed no seed changed. The clean room disproved it.
- The restricted-token leak test inspected only the audit trail, while two documents said
  it covered event payloads and responses. The test was extended rather than the sentence
  narrowed.
- The per-file test table summed to 295 against a 303 delta, because one file is a
  `describe.each` and was counted by grepping for `it(`.

## Open at close

Five accepted findings — one Medium, four Low — listed with reasons in
[`evidence/open-decisions.md`](docs/phase-1/phase-1-19/evidence/open-decisions.md):

| ID           | Severity | Subject                                                    |
| ------------ | -------- | ---------------------------------------------------------- |
| `P1-19-A-01` | Low      | The job board's ordering is not index-aligned              |
| `P1-19-A-02` | Medium   | Diagnostic revision numbering rests on an advisory lock    |
| `P1-19-A-03` | Low      | Seven `P1-19-BE-nnn` annotations span two schemas each     |
| `P1-19-A-04` | Low      | `wo.work-order-detail` declares the looser rate-limit tier |
| `P1-19-A-05` | Low      | `originating_finding_id` has no foreign key                |

`A-01`, `A-02` and `A-05` can only be closed by a migration this phase is not authorised
to write. `A-03` needs the canonical Phase 1 Development Plan, which lives outside this
repository by owner decision — renumbering the annotations to make the traceability table
look tidy would replace a visible inconsistency with an invisible invention.

Also **deliberately not implemented**: closure blockers for stock reservation and part
issue. The brief lists them; `wo.guard_work_order_closure` implements neither, because
those are Phase 1-21. No always-passing placeholder blocker was added — a blocker that
always passes reads as coverage in every report and enforces nothing.
`DEFERRED_CLOSURE_BLOCKERS` records the owner, the conditions and the reason.

## Not done

No gate record. No owner gate. P1-20 not started. `origin/develop` unchanged at
`f326e24`; `origin/main` untouched.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
