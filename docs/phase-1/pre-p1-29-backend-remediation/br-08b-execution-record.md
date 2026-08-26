# BR-08b — execution record

**Payload contract exposure.** The mechanical slice that stands between this repository and a
payload parity gate: make the request schemas readable from outside their route files, and give the
six anonymous response envelopes a name on the side that owns them.

|                                |                                                             |
| ------------------------------ | ----------------------------------------------------------- |
| Branch                         | `remediation/p1-29-backend-api-contract-parity-b`           |
| Base                           | `f0412be2` — `origin/develop` at the BR-07 merge            |
| Ownership profile              | `p1-29-backend`                                             |
| `B1-PGNET-BLOCKER`             | **OPEN** — untouched by this slice, and independent of it   |
| `BR-09`                        | **BLOCKED** and preserved — see `br-09-execution-record.md` |
| New migrations                 | **0**                                                       |
| New permission codes           | **0**                                                       |
| Files changed under `apps/web` | **0**                                                       |
| Operations before / after      | **334 / 334** — this slice adds none                        |

---

## 1. `B1` of the contract — the day-one unknown, settled by execution

The contract would not let this slice commit to exporting anything until one question was answered:

> **Unknown that must be settled before the slice commits to this.** Next.js App Router route files
> may export only recognised handlers plus specific config, and an extra named export may be
> rejected by the build.

**The answer is that Next.js permits it, and the repository already proved it before this slice
started.** Fourteen route files on `f0412be2` were already exporting a schema constant, and those
fourteen have been building green in hosted CI for the whole life of the tree. The prescribed
experiment was still run rather than inferred from that: after all 169 remaining exports were added,

```
npm run build:api   →   ✓ Compiled successfully in 27.3s
```

**The AST fallback was therefore not taken**, and none of its costs were paid — no re-implementation
of zod semantics, no hand-resolution of `schemas.uuid`, `z.enum(REPORT_STATUSES)` or `MAX_SUMMARY`.
Recording this either way is a DoD item, so it is recorded plainly: the build accepts extra named
exports from a route module, and `BR-08c` may read the schemas as values.

## 2. The count is 183, not 34 — and the difference is deliberate

The contract says "34 `Body` constants". That figure was measured against `develop c081a019` at 305
operations, **and it was scoped to P1-29's 58 operations** — 34 of that slice's 35 writes carry a
body, `tech.labor-session-stop` being the one that does not.

Measured on the live base instead:

| fact                                                  | figure  |
| ----------------------------------------------------- | ------- |
| route files declaring a `Body` constant on `f0412be2` | **183** |
| of those, already exported                            | **14**  |
| newly exported by this slice                          | **169** |
| route files with an unexported `Body` remaining       | **0**   |

**Exporting the whole tree rather than P1-29's 34 was a decision, not drift.** A payload gate reads
whatever it is pointed at; if only the P1-29 subset were exported, the gate's coverage would be a
property of which files someone had happened to export rather than a property of the gate, and every
later phase would rediscover this same one-word blocker. The change is one word per file and cannot
alter behaviour: `export` on a module-private const adds a binding to the module's public surface
and changes nothing about how the route uses it.

## 3. The six envelopes, named where they are produced

Six operations returned an anonymous object literal type. Each now has an exported interface in
`apps/api`, declared beside the service that produces the shape:

| operation                     | interface                      | declared in                                                |
| ----------------------------- | ------------------------------ | ---------------------------------------------------------- |
| `wo.job-reassignment`         | `JobReassignmentResult`        | `work-order/application/job-assignment-service.ts`         |
| `wo.additional-work-approval` | `AdditionalWorkDecisionResult` | `work-order/application/additional-work-service.ts`        |
| `qms.rework-create`           | `ReworkCreationResult`         | `quality/application/rework-service.ts`                    |
| `qms.reopen-attempt`          | `ReopenAttemptResult`          | `quality/application/rework-service.ts`                    |
| `tech.technician-available`   | `TechnicianCandidateResult`    | `technician/application/technician-eligibility-service.ts` |
| `tech.technician-queue`       | `TechnicianQueueResult`        | `work-order/application/job-assignment-service.ts`         |

All six are re-exported from their module barrel. **Zero new frontend-only type names were created**
— `apps/web` is byte-unchanged by this slice, which the diff shows directly.

### 3.1 `tech.technician-queue` sits in `work-order`, and that is not a boundary violation

The operation is registered under `module: 'technician'`, so the obvious place for its envelope
looks like the technician module. It is not. `QueueEntry` — the element type the envelope wraps — is
declared in `work-order/application/job-assignment-service.ts`, and the route reaches the data
through `workOrderModule().jobAssignments.queue(...)`. Declaring `TechnicianQueueResult` in the
technician module would have forced a `technician → work-order` import that does not exist today.
The envelope is declared where its contents are produced; `validate:module-boundaries` passes
unchanged.

### 3.2 The queue envelope is annotated, not merely inferred

Five of the six envelopes are the declared return type of a service method, so naming the interface
binds it to the implementation automatically — a drifting field fails `tsc`.

`tech.technician-queue` had no such anchor. As the contract observed, the envelope existed **only in
the route handler**; the service returns a bare `QueueEntry[]`, so "even a type-checker pointed at
the service layer would not find it". An interface that merely _described_ that route's response
without ever being checked against it would have been decoration. The route now builds the response
through an explicit `const body: TechnicianQueueResult = {…}`, which is what makes the name
load-bearing.

## 4. `TransitionResult` disambiguated

Two declarations of the same name existed, and the contract's concern was that a gate keyed on type
**name** would bind to whichever it found first:

| file                                                       | shape                                                            |
| ---------------------------------------------------------- | ---------------------------------------------------------------- |
| `work-order/application/work-order-service.ts`             | `{state, recordVersion}` — narrow                                |
| `shared-services/application/status-transition-service.ts` | `{aggregate, id, from, to, recordVersion, nextStates}` — generic |

The **work-order** one was renamed to `WorkOrderTransitionResult`; the shared-services one keeps the
generic name, because it is the generic thing. Six references in total, none of them in `apps/web`.
The rename carries a docblock stating why the two are not the same type, so the next reader does not
re-collapse them.

## 5. No wire shape changed

The DoD asserts this two ways, and both hold:

| assertion                   | result                                                                     |
| --------------------------- | -------------------------------------------------------------------------- |
| `openapi.v1.json` unchanged | digest `ec11509f618824a8b9b381e9` before and after — the file is untouched |
| backend tests unchanged     | **no test file was modified or added by this slice**                       |

That second row is worth stating explicitly rather than leaving as an absence. **This slice writes
no new tests, and that is correct.** Every change it makes is one the type system already checks
completely: an added `export` keyword, and a set of interfaces whose only claim is "this method
returns this shape" — a claim `tsc` verifies at every call site. A test asserting that
`JobReassignmentResult` has an `opened` field would assert what the compiler already refuses to let
be false. The slice's proof is `typecheck:api`, `typecheck`, `typecheck:web` and `build:api`, plus
the unchanged behaviour of every case that was already there.

## 6. What this slice deliberately did not do

**Only the six named envelopes were touched.** A tree-wide grep finds many other anonymous
`Promise<{…}>` return types — in repositories, in private service helpers, in internal resolvers.
They are not response envelopes; nothing serialises them to the wire. The contract enumerated exactly
six, and widening beyond them would have been an unreviewed refactor riding along with a mechanical
slice.

**`BR-08-OPEN-01`** — the 19 operations returning an undocumented `201` — is **not** closed here. It
belongs to the response-documentation surface, which this slice does not open, and the DoD assigns it
slice-wide rather than to `BR-08b`.

## 7. Gates

| gate                                | result                                                 |
| ----------------------------------- | ------------------------------------------------------ |
| `typecheck:api`                     | green                                                  |
| `typecheck` (root)                  | green                                                  |
| `typecheck:web`                     | green — the root typecheck does **not** reach it       |
| `build:api`                         | ✓ Compiled successfully in 27.3s                       |
| `lint`                              | green                                                  |
| `format:check` · `format:check:api` | green — the root prettier run does not reach `apps/**` |
| `validate:module-boundaries`        | green                                                  |
| `validate:openapi`                  | 269 paths, 334 operations, structurally valid          |
| `verify:contracts`                  | green — register reconciled at 334 operations          |

## 8. Definition of Done

| DoD item                                                                          | state                                                    |
| --------------------------------------------------------------------------------- | -------------------------------------------------------- |
| The Next.js export question is settled by execution, and the answer is recorded   | **met** — §1                                             |
| 34 `Body` constants exported, or the AST fallback implemented and limits recorded | **met, exceeded** — 169 newly exported, 0 remaining (§2) |
| Six response interfaces exported from `apps/api`; zero new frontend-only names    | **met** — §3; `apps/web` byte-unchanged                  |
| `TransitionResult` disambiguated                                                  | **met** — §4                                             |
| No wire shape changed                                                             | **met** — §5                                             |

Contract test cases `B1`–`B4` all discharged: `B1` §1, `B2` §7 (including `typecheck:web`, which the
root typecheck does not reach), `B3` §3, `B4` §4.
