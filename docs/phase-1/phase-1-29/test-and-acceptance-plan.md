# P1-29 — test and acceptance plan

What must be proven, by which tier, and — the part that matters most — **what
each tier structurally cannot see**. This plan is written against the defects
this repository has actually produced, not against a generic pyramid.

---

## 1. The tiers and their blind spots

| tier           | command                                                                                                                 | proves                                                | **cannot see**                                                                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| web unit / DOM | `npm run test:web` (vitest, 106 test files today)                                                                       | component behaviour, state handling, translation keys | **payload shape** — DOM tests mock the adapter, so a screen can send a body the API's strict schema rejects and every test stays green (the P1-28 Owner-acceptance defect) |
| web e2e        | `npm run test:web-e2e` / `…-authenticated` (playwright, `authenticated-en`, `authenticated-ar`, `authenticated-tablet`) | the real browser against a real server                | anything not on a scripted path; needs provisioned roles                                                                                                                   |
| backend        | `npm run test:backend`                                                                                                  | service and route behaviour                           | whether any screen invokes the operation                                                                                                                                   |
| db             | `npm run test:db`                                                                                                       | guards, RLS, constraints                              | everything above                                                                                                                                                           |
| static gates   | `npm run verify:policies`, `verify:web`, `verify:contracts`                                                             | structural invariants                                 | only what a gate was written to look for                                                                                                                                   |

**The single most important line in this table** is the web-unit blind spot. It
is the mechanism by which four Frontend defects reached the P1-28 Owner while
every tier was green.

---

## 2. The gate family P1-29 owes

P1-28 built seven gates and they are the template. Each one exists because a
specific defect class shipped past a green suite. P1-29 consumes a _larger_
surface than P1-28 did, so it needs the equivalents — and the P1-28 gates are
scoped to `apt.*`/`rec.*`, so **none of them covers P1-29**.

| P1-28 gate                                   | what it catches                                                                                                                                                                                                                                                                               | P1-29 equivalent                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `validate:p1-28-access` (`gate-before-read`) | a route page that reads before it checks a permission                                                                                                                                                                                                                                         | **required, first slice** (`INS-12`)                                      |
| `validate:p1-28-version-sourcing`            | _"every version-guarded write sources its `recordVersion` from a READ or the immediately prior command response, never a cached guess"_ — a screen sending `version + 1` satisfies every adapter test, because the adapter forwards whatever number it is handed                              | **required** — P1-29 has more version-guarded writes than any prior phase |
| `validate:p1-28-write-reachability`          | INT-113: an operation with a route, a permission, an audit class, an OpenAPI path and a register row — **and no screen from which anybody could invoke it**                                                                                                                                   | **required**                                                              |
| `validate:p1-28-adapter-reachability`        | two authorities: every published operation has its **exact row in the web contract mirror**, and `published operation → production adapter → production consumer` is complete. Three adapters shipped with a definition line and nothing else, green, because the **test** corpus called them | **required** — and it is also the answer to `INS-01`, see §3              |
| `validate:p1-28-matrix`                      | the task matrix is derived, not asserted                                                                                                                                                                                                                                                      | required at closure                                                       |
| `validate:p1-28-traceability`                | requirement → task → evidence                                                                                                                                                                                                                                                                 | required at closure                                                       |
| `validate:p1-28-evidence`                    | evidence exists and is current                                                                                                                                                                                                                                                                | required at closure                                                       |

Two more, not from the P1-28 family:

| gate                    | what it catches                                                                                                                                                                                                                                   | status                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **permission parity**   | a declared permission code that is not in `iam.permissions`. `defineOperation` never checks; the registry's own test registers `a.b.c` and passes; **no RLS policy in this domain consults a permission code**, so nothing else catches it either | **does not exist anywhere** (`INS-11`). Cheapest control in the phase. |
| **scope-pair required** | a work-order-domain collection adapter called without `companyId`/`branchId`, which silently degrades authorization to scope-blind (`P1-18-A-01`)                                                                                                 | **does not exist** — propose it as P1-29 work (T-02)                   |

`validate:wo-tech-dia-qms-classification` already exists and covers data
classification for these schemas; P1-29 does not need to add to it.

---

## 3. Contract parity — the answer to the OpenAPI gap

`INS-01`: the OpenAPI document declares **0 request bodies and 0 typed success
schemas** across 305 operations, so a generated client is impossible and the
contract lives in the API's TypeScript service interfaces.

`apps/web` **cannot import `apps/api`** — `apps/web/scripts/check-api-boundary.mjs`
forbids it, correctly. So parity cannot be achieved by sharing a type.

**The P1-28 mechanism is the right one and already exists in miniature: a web
contract mirror with a gate asserting exact parity.** P1-29 should:

1. declare its contract mirror for the 58 operations (types + the fields each
   payload carries);
2. extend the adapter-reachability gate's Authority A to those operations, so
   that no operation in these four schemas can be published without a mirror
   row. Be exact about the ceiling: Authority A matches published register ids
   against the `operationId:` literals in the mirror, and neither the register
   nor `openapi.v1.json` carries **any payload information at all** — that is
   `INS-01`. **No gate here can turn red on a changed request body or a
   response shape.** The mirror is a transcription held true by review; the
   only thing that tests it against the Backend is a real response;
3. keep DOM tests as they are — they test behaviour — and rely on the mirror,
   not on the mock, for shape.

Without this, the P1-28 defect recurs at four times the surface area.

---

## 4. Frontend test plan by surface

### 4.1 Board (`/work-orders`)

- the scope pair is always sent; a call without it is impossible by construction
  (T-02)
- the `state` filter accepts an arbitrary lower-snake code and does **not**
  validate against a hard-coded enum (the catalogue is tenant-extensible), while
  `kind` **is** a closed two-value enum
- filters live in the query string, so a locale switch preserves them
  (`withCarriedQuery`)
- `hasMore` / `nextCursor` handling, and **no conclusion drawn from one page** —
  assert via the `read-completeness` helpers
- empty state says work orders arrive from reception; there is no create action

### 4.2 Work-order detail

- actions are rendered **from `nextStates`**, never from a hard-coded list —
  assert with a fabricated tenant state code that is not in the platform seed
- a reason-requiring transition opens `ReasonConfirmDialog` and refuses to submit
  empty
- **closure is a checklist**: all blockers from the eligibility read render
  together, each with its remedy; `ERR-WO-001` re-reads eligibility rather than
  showing a bare banner
- **`wo.work_order.close` withheld** → the closure action is absent while
  transition actions remain (the conjunction, `A7`)
- **`tech.technician.read` withheld** → jobs render, assignment and labour panels
  are absent, nothing crashes (T-05)
- **`iam.sensitive.view` withheld** → the restricted additional-work detail
  region is absent, not empty (T-04)
- `qc_pending` disables job, labour and additional-work affordances from the
  state flags, before any request
- **a required pending additional-work request on a job disables start/resume
  with that reason**, before the request — the `ERR-WO-002` rule
- `record_version` is sourced from a read or the prior response, never computed

### 4.3 Composed actions

Each of start / pause / resume / complete needs, at minimum:

- the **ordering** assertion (transition-then-session for start;
  session-then-transition for pause — because `paused` is not `labor_allowed`)
- a **partial-failure** test per step, asserting that the UI names the failed
  step and offers the _completing_ step, not a blanket retry
- the pause partial failure specifically: session stopped, transition refused →
  the UI states the clock is stopped and the job is still in progress
- **idempotency-key identity**: a retry of one intent reuses the key; a second
  intent mints a new one

### 4.4 Errors

One test per domain code, asserting the _distinct_ presentation:

| code           | assertion                                                                              |
| -------------- | -------------------------------------------------------------------------------------- |
| `ERR-CON-001`  | "changed while you were working" + refresh; **no auto-retry**                          |
| `ERR-CON-002`  | never reachable from the UI — the version was always sent                              |
| `ERR-TRN-001`  | "no longer possible" + refreshed action list; **not** the same banner as `ERR-CON-001` |
| `ERR-WO-001`   | re-reads eligibility, renders the checklist                                            |
| `ERR-WO-002`   | names the pending required request; offers pause, not retry                            |
| `ERR-TECH-001` | returns to the picker with the refusal on the candidate                                |
| `ERR-DIA-001`  | violation paths map back onto checklist rows; scrolls to the first                     |
| `ERR-IAM-001`  | denial + correlation ID; **does not name a permission**                                |
| reopen `201`   | rendered as a **refusal**, not a success (`INS-37`)                                    |
| every failure  | correlation ID is rendered                                                             |

### 4.5 i18n and direction

- every new key exists in **both** `en.json` and `ar.json`
- an unknown tenant state code is humanised, never rendered as a missing-key
  error
- the board, the closure checklist and any timeline render correctly in `ar`
  (RTL) — playwright already has `authenticated-ar` and `authenticated-tablet`
  projects

### 4.6 Navigation

- flipping `planned → available` updates `navigation.test.ts:52`/`:96` in the
  **same** change, and only once the screen exists
- a caller holding only `dia.diagnostic.read` sees the diagnostics child under a
  parent they cannot open (`navigation.test.ts:226`) and the parent route
  handles being reached that way

---

## 5. Backend-side checks P1-29 should run (not own)

Whether P1-29 changes `apps/api` is an open Owner decision — the Backend
prerequisites are sized in [implementation-slices.md](implementation-slices.md)
§0, and whichever are funded bring their own Backend tests. The checks below are
the separate case: facts in `apps/api` that P1-29 consumes without changing, and
that could drift:

- `verify:contracts` — `validate:authorization-coverage`,
  `validate:operation-coverage`, `validate:openapi`,
  `validate:idempotent-operations`
- `verify:inventories` — note this is **not** implied by `verify:contracts`; the
  two are separate scripts and running one proves nothing about the other
- `npm run test:db` for the guards P1-29 renders the consequences of
  (`wo.guard_work_order_closure`, `wo.guard_job_transition`,
  `wo.guard_additional_work_state`, `dia.guard_diagnostic_report_transition`)

---

## 6. Owner acceptance

### 6.1 Preconditions — both are hard

1. **Roles must be provisioned.** `iam.roles` and `iam.role_permissions` hold
   **0 rows** in the live database, so no actor holds any of the 22 domain codes
   and **every operation will refuse** (`INS-41`). Acceptance cannot begin until
   a tenant is provisioned with at least: an advisor role, a supervisor role
   with `wo.work_order.close` and `tech.assignment.manage`, and a technician role
   with `tech.labor.record` and `wo.job.transition`.
2. **The environment must be a production build.** `next dev` manufactures
   phantom 401s through a side-effect singleton. An Owner session on `next dev`
   will produce failures that are not defects, and has done so before. Use
   `npm run build:web` + `next start`.

Two more, from the same history:

3. **`supabase db reset` destroys the acceptance environment.** Do not run it
   mid-acceptance, and note that the Supabase container is **shared across
   worktrees** — another session's reset has silently reverted the schema
   mid-tier before.
4. Work orders **come from reception**, so the acceptance script begins with a
   P1-28 journey: appointment or walk-in → reception → authorization → custody →
   convert. There is no shortcut, by design.

### 6.2 The acceptance journey

| #   | step                                                | expected                                                         | notes                                  |
| --- | --------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------- |
| 1   | convert a reception into a work order               | the work order exists in `draft`                                 | P1-28 surface                          |
| 2   | open the board, filtered to the branch              | the new order appears                                            | scope pair required                    |
| 3   | open the detail                                     | header, no jobs, `nextStates` offers `open`                      |                                        |
| 4   | `draft → open → in_progress`                        | two transitions, no reason required                              |                                        |
| 5   | add two jobs                                        | both `planned`                                                   |                                        |
| 6   | assign a technician to job 1                        | requires a window on the availability search                     | needs a provisioned technician profile |
| 7   | start job 1                                         | job `in_progress` **and** a labour session opens                 | two calls — watch for a partial        |
| 8   | pause job 1 with a reason                           | session stops, job `paused`                                      | ordering matters                       |
| 9   | resume and complete job 1                           | job `completed`                                                  |                                        |
| 10  | raise a required additional-work request from job 2 | request `pending`, `is_required` true                            |                                        |
| 11  | try to start job 2                                  | **refused, `ERR-WO-002`**, with a clear reason                   | this is a _pass_, not a failure        |
| 12  | record the customer's approval                      | request `approved`; job 2 can now start                          | separate authority                     |
| 13  | complete job 2                                      |                                                                  |                                        |
| 14  | attempt closure with a session still open           | eligibility lists B2                                             |                                        |
| 15  | move to `qc_pending`                                | job, labour and additional-work affordances freeze               |                                        |
| 16  | open a QC record                                    | renders with **no checks** — `qms.qc_checks` is empty (`INS-38`) | expected, not a defect                 |
| 17  | `qc_pending → ready_to_close → closed`              | closure checklist clean, then closed                             | needs the `close` conjunction          |
| 18  | attempt a reopen                                    | **201** with a recorded refusal, presented as a refusal          | `INS-37`                               |
| 19  | create a rework case                                | new work order with `kind = 'rework'`, linked                    |                                        |
| 20  | review the four history surfaces                    | each renders; ids not names for actors                           | `INS-30`                               |

**Diagnostics is absent from this journey** because it cannot be entered
(`INS-09`), not because it has left the phase. Diagnostics remains in P1-29
final scope; when template authoring lands (`BE-4`, Backend work), this journey
gains its diagnostics steps and they become part of what the Owner accepts.
Until then, a pass on the twenty steps above **does not close P1-29** — only an
explicit, recorded Owner deferral naming the phase that will own diagnostics can
do that, and silence is not deferral.

### 6.3 What acceptance may **not** conclude

- that parts are settled (closure does not check reservations — `INS-36`)
- that the customer was notified (nothing consumes `job.assigned` — `INS-25`)
- that a total labour figure is correct (there is no totals endpoint — `INS-31`)
- that any screen is correct for a tenant with a customised state graph, unless
  the acceptance tenant actually has one

### 6.4 The Owner rule that applies

Every Frontend phase closes **only** on an explicit `OWNER ACCEPTANCE: PASS`.
Silence is not Pass. P1-26 was closed once on unproven claims and reopened; the
rule was applied without exception thereafter.

---

## 7. Traps, from this repository's own history

| trap                                                                                                | consequence                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| root `format:check`, `lint` and `typecheck` **do not cover `apps/web`**                             | run `format:check:web`, `lint:web`, `typecheck:web` explicitly. Five undefined identifiers passed the root typecheck and were `TS2304` under `typecheck:web`.  |
| `verify:contracts` does **not** imply `verify:inventories`                                          | they are separate scripts                                                                                                                                      |
| skipped tests count toward a suite total                                                            | a `minTests` floor can be satisfied by skips                                                                                                                   |
| adversarial/parallel agents write probe files into `apps/web/tests`                                 | any suite count taken mid-run is fiction, and `git add -A` would commit them                                                                                   |
| `getByLabelText` does not honour `aria-hidden`; `getByLabel` matches a **substring**                | accessibility assertions can pass on the wrong element                                                                                                         |
| a `waitFor` asserting "still there" passes **before** the change lands                              | assert the change, then the absence                                                                                                                            |
| real-filesystem tests flake under `--coverage`                                                      | note it before diagnosing                                                                                                                                      |
| a scanner reading prose as code has produced a false gate result **seven times** in this repository | gates over source must parse, not regex — the P1-28 gates were rebuilt on the TypeScript AST after a nested template literal turned fail-closed into fail-open |
| a DRAFT pull request triggers **no CI**                                                             |                                                                                                                                                                |
| `validate:phase-ownership` defaults to the **wrong** profile, and is invoked by no CI job           | pass the profile explicitly                                                                                                                                    |
