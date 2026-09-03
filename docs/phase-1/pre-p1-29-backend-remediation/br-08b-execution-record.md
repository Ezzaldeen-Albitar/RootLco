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
later phase would rediscover this same one-word blocker. `export` on a module-private const adds a
binding to the module's public surface and changes nothing about how the route uses it.

**164 of the 169 are literally one word; five are not, and the difference is Prettier.** Adding
`export` pushed five declarations past the print width, so the formatter rewrapped them from one
line to three:

```
-const PatchBody = z.object({ effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();
+export const PatchBody = z
+  .object({ effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
+  .strict();
```

Strip the leading `export ` and all whitespace and each of the five is byte-identical to its
predecessor, so the substance of the claim holds — but "one word per file" is not true of them, and
the five are named here rather than rounded away: `iam/approval-limits/[limitId]`,
`inspections/[inspectionId]/completion`,
`reception-catalogue/damage-map-templates/[templateId]/versions`,
`vehicles/[vehicleId]/authorized-parties/[relationshipId]/retirement`, and
`work-orders/[workOrderId]/quality-controls`.

**170 route files changed, not 169.** The 170th is
`technicians/[technicianProfileId]/queue/route.ts`, which is a handler change rather than an export
— see §3.2.

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

### 3.1 `tech.technician-queue` sits in `work-order`

The operation is registered under `module: 'technician'`, so the obvious place for its envelope looks
like the technician module. It is declared in `work-order/application/job-assignment-service.ts`
instead, beside `QueueEntry` — the element type it wraps — and beside the method that produces the
entries. The route reaches the data through `workOrderModule().jobAssignments.queue(...)`.

**No import-graph argument supports this, and the first draft of this record claimed one that is
false.** It said declaring the envelope in the technician module "would have forced a
`technician → work-order` import that does not exist today". That import exists, and did before this
slice: `technician/application/labor-session-service.ts:44` is
`import { workOrderModule } from '@/modules/work-order';`. The edge runs both ways —
`job-assignment-service.ts:40` imports `technicianModule` — and barrel-to-barrel imports between
modules are the approved form, since the only cross-module rule in
`scripts/check-module-boundaries.mjs` is `B1-module-internals-are-private`, whose remedy is
literally "import `@/modules/<name>` instead". `QueueEntry` was already exported from the work-order
barrel, so the alternative placement would have needed one `import type` and nothing else.

The placement stands on the reason that is true — an envelope belongs beside the shape it wraps —
and the correction is recorded rather than quietly swapped, because a boundary claim the tree
contradicts is the kind of thing a later reader would act on. `validate:module-boundaries` passes
either way.

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

**Only the six named envelopes were touched**, because the contract enumerated exactly six and
widening beyond them would have been an unreviewed refactor riding along with a mechanical slice.

**The first draft justified that scope with a false claim** — that the other anonymous
`Promise<{…}>` return types in the tree "are not response envelopes; nothing serialises them to the
wire". Several do. It is now measured rather than asserted, by
`scripts/ci/check-named-wire-shapes.mjs`, which resolves each route's `body:` receiver chain back
through the module barrel to the class and reads that method's declared return type. Resolving the
receiver is the whole design: a name-keyed count attributes every `.create()` in the tree to
whichever `create` it found first, which is the same false-attribution defect the P1-19 endpoint
inventory carried until `BR-06`.

At `a63cad8b`:

| fact                                                       | figure  |
| ---------------------------------------------------------- | ------- |
| route `body:` calls resolved to a module method            | **231** |
| of those, returning a NAMED type                           | **223** |
| of those, returning an ANONYMOUS object literal            | **8**   |
| unresolved by the census and therefore counted neither way | **47**  |

**None of the eight is one of BR-08b's six** — which is the census answering, independently of the
diff, whether this slice did what it claims. The eight are the anonymous shapes that reach the wire
outside its scope:

| route                                             | method                                            | shape                                        |
| ------------------------------------------------- | ------------------------------------------------- | -------------------------------------------- |
| `/iam/grants`                                     | `AccessAdministrationService.issueGrant`          | `{id: string}`                               |
| `/iam/grants/{grantId}/scopes`                    | `AccessAdministrationService.addScope`            | `{id: string}`                               |
| `/iam/roles/{roleId}/permissions`                 | `AccessAdministrationService.addRolePermission`   | `{id: string}`                               |
| `/iam/approval-limits`                            | `AccessAdministrationService.createApprovalLimit` | `{id: string}`                               |
| `/organization/branches/{branchId}/status`        | `StatusTransitionService.describe`                | `{state, recordVersion, nextStates}`         |
| `/technicians/{id}/availability/{availabilityId}` | `TechnicianRosterService.withdrawAvailability`    | `{withdrawn: true}`                          |
| `/technicians/{id}/skills/{skillId}`              | `TechnicianRosterService.withdrawSkill`           | `{withdrawn: true}`                          |
| `/template-versions/{versionId}/preview`          | `TemplateService.previewVersion`                  | `{subject: string \| null, body, variables}` |

**`BR-08b-OPEN-01`.** None of the eight is in P1-29's operation set, which is why the contract did
not enumerate them and why they are not fixed here. They are recorded because the response surface
is the half `BR-08c` cannot statically gate, and a phase that later believes "every wire shape has a
name" would be wrong by at least eight. **Settled by:** `node scripts/ci/check-named-wire-shapes.mjs`
against the tree, then naming each shape in its owning module, in the slice that owns the
response-documentation surface. Four of the eight are the same `{id: string}` on one service, so the
fix is smaller than the count suggests.

The 47 unresolved calls are stated rather than hidden. The census is a source walk, not a
type-checker — `ts.createProgram` appears nowhere in this repository — so it resolves only the
`xModule().accessor.method(...)` chain, and a `body:` assembled from a local built over several
statements, or served from a foundation contract rather than a module, is reported unresolved rather
than guessed at. **Eight is a lower bound, not a total**, and the script's own output says so.

**`BR-08-OPEN-01`** — the 19 operations returning an undocumented `201` — is **not** closed here. It
belongs to the response-documentation surface, which this slice does not open, and the DoD assigns it
slice-wide rather than to `BR-08b`.

## 7. The adversarial pass, and what it cost this record

Six independent reviewers were run over `a63cad8b` — export purity, envelope fidelity, behaviour
invariance, the `TransitionResult` rename, registries and gates, and the security surface — each
finding then handed to a separate agent instructed to refute it.

**Nothing was wrong with the code. Three things were wrong with this document**, and they were all
the same defect: a correct decision defended with a false fact.

| what the record claimed                                              | what is true                                                         | §    |
| -------------------------------------------------------------------- | -------------------------------------------------------------------- | ---- |
| a `technician → work-order` import "does not exist today"            | it exists, at `labor-session-service.ts:44`, and predates this slice | §3.1 |
| the change is "one word per file"                                    | true of 164; Prettier rewrapped five to three lines                  | §2   |
| other anonymous return types — "nothing serialises them to the wire" | eight do, measured                                                   | §6   |

That distribution is worth recording on its own. A mechanical slice is easy to get right and easy to
narrate wrongly, and the narration is what the next phase reads. The refutation pass killed five of
the eight raised findings, including two that were factually accurate but immaterial — the five
Prettier rewraps are whitespace-normalized identical to their predecessors — and the accurate-but-
immaterial ones still earned a correction here, because "immaterial" is a judgement a later reader
should be allowed to make for themselves rather than inherit.

One finding was raised against a gate rather than this slice and is **not** BR-08b's to fix:
`apps/web/scripts/check-api-boundary.mjs:77` matches the literal substring `apps/api/` in an import
specifier, so it does not see `@rootlco/api/src/...` — the workspace spelling, live on disk as a
`node_modules/@rootlco/api` symlink. BR-08b does not create that gap, but it does widen what sits
behind it from 14 schemas to 183. It is mitigated twice over — `scripts/ci/check-web-topology.mjs:85`
does match `@rootlco/api` and is inside the required `verify:policies` set, and a relative deep
import fails `typecheck:web` because every route imports `@/server/…`, which `apps/web`'s
`tsconfig.json` maps to its own `src`. Recorded as an observation against that gate's own docblock
promise, not as a defect of this slice.

## 8. Gates

| gate                                | result                                                    |
| ----------------------------------- | --------------------------------------------------------- |
| `typecheck:api`                     | green                                                     |
| `typecheck` (root)                  | green                                                     |
| `typecheck:web`                     | green — the root typecheck does **not** reach it          |
| `build:api`                         | ✓ Compiled successfully in 27.3s                          |
| `lint`                              | green                                                     |
| `format:check` · `format:check:api` | green — the root prettier run does not reach `apps/**`    |
| `validate:module-boundaries`        | green                                                     |
| `validate:openapi`                  | 269 paths, 334 operations, structurally valid             |
| `verify:contracts`                  | green — register reconciled at 334 operations             |
| `verify:inventories`                | green — P1-19 58 operations, P1-20 17, P1-21 14, P1-22 20 |
| `validate:generated-artifacts`      | 2367 tracked file(s), 0 failure(s)                        |
| `validate:phase-ownership`          | `p1-29-backend`, 180 changed file(s), **0 violation(s)**  |
| `verify:policies`                   | green — 0 problem(s)                                      |
| unit tier                           | **2979 / 2979**, 107 files, recorded at `1a9e9c9f`        |
| web tier                            | **2889 / 2889**, 102 files, recorded at `1a9e9c9f`        |
| backend tier                        | **2232 / 2232**, 95 files                                 |

### 8.1 One red run, and why it is not re-run-until-green

The first `--record web` was taken while a six-agent review was running against the same machine, and
`apps/web/tests/stylelint-policy.test.ts` failed with `STACK_TRACE_ERROR` — a blown time budget, not
an assertion. That test already carries a raised `COLD_START_TIMEOUT_MS` and a docblock that says
exactly what to do about this:

> _A test whose verdict depends on how busy the host is has stopped being a check. It gets re-run
> until it passes, and that habit is what lets a real failure through._

So the red is recorded here rather than discarded. It was re-recorded on an idle machine, in a
dedicated worktree, with the two tiers run sequentially and nothing else running — the load was
mine, it was identified, and it was removed. `judgeRunLedger` would have refused the red record
anyway; the point of writing it down is that the reason was diagnosed rather than assumed.

## 9. Definition of Done

| DoD item                                                                          | state                                                    |
| --------------------------------------------------------------------------------- | -------------------------------------------------------- |
| The Next.js export question is settled by execution, and the answer is recorded   | **met** — §1                                             |
| 34 `Body` constants exported, or the AST fallback implemented and limits recorded | **met, exceeded** — 169 newly exported, 0 remaining (§2) |
| Six response interfaces exported from `apps/api`; zero new frontend-only names    | **met** — §3; `apps/web` byte-unchanged                  |
| `TransitionResult` disambiguated                                                  | **met** — §4                                             |
| No wire shape changed                                                             | **met** — §5                                             |

Contract test cases `B1`–`B4` all discharged: `B1` §1, `B2` §8 (including `typecheck:web`, which the
root typecheck does not reach), `B3` §3, `B4` §4.
