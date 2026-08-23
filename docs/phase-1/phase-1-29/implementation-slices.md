# P1-29 — proposed implementation slices

A proposal, not an approved plan. It exists so the Owner can decide scope
against real dependencies rather than against a phase title.

Two properties are deliberate:

- **Every slice ends in something a person can use.** No slice delivers only
  infrastructure.
- **Every gate is built with the code it governs, never after.** A gate added
  once the screens exist ratifies whatever was built — which is how three
  adapters shipped in P1-28 looking wired and not being.

---

## 0. The Backend prerequisites, sized

None of these is P1-29 Frontend work. They are listed first because three of the
Frontend slices are shaped by whether they happen.

| id       | prerequisite                                                                                                    | size                       | unblocks                                           |
| -------- | --------------------------------------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------- |
| **BE-1** | publish the state catalogues over HTTP (`WorkOrderCatalogService` already computes all four; no route calls it) | **small** — one read route | `INS-06`; lets the job graph stop being hard-coded |
| **BE-2** | put `technicianProfileId` on the session payload, or add `GET /technicians/me/queue`                            | **small**                  | `INS-04` — the technician persona                  |
| **BE-3** | a customer projection on the work-order read                                                                    | **small**                  | `INS-10` — Owner requirement 2                     |
| **BE-4** | diagnostic template authoring: CRUD, versioning, publish, **plus new permission codes** (none exist)            | **large**                  | `INS-09` — Owner requirements 9, 10, 11            |
| **BE-5** | declaration-to-catalogue permission parity gate                                                                 | **very small**             | `INS-11` — the cheapest security control available |
| **BE-6** | consume `job.assigned` from the outbox                                                                          | medium                     | `INS-25` — Owner requirement 6                     |
| **BE-7** | `department_id` on work-order entities + a department HTTP surface                                              | medium                     | `INS-23` — Owner requirements 3, 4                 |
| **BE-8** | a job-level note/work-log and job-level evidence                                                                | medium                     | `INS-27`, `INS-28` — Owner requirements 8, 12      |

**BE-1, BE-2, BE-3 and BE-5 together are a small slice** and they lift the
phase's two worst constraints plus its cheapest security gap. If any Backend
work is funded for P1-29, it should be those four.

---

## 1. Slice A — foundation and the board

**Delivers:** `/work-orders`, the branch work-order board.

|                    |                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| **Depends on**     | nothing new                                                                                                               |
| **Routes**         | `app/[locale]/(dashboard)/work-orders/page.tsx`                                                                           |
| **Feature module** | `features/work-orders/` — `permissions.ts` (all 22 codes + `holds`), `contract.ts` (the mirror), `api.ts` (read adapters) |
| **Reads**          | `wo.work-order-list`                                                                                                      |
| **Nav**            | flip `work-orders` to `available`; update `navigation.test.ts:52`/`:96` in the same change                                |

**Gates built here, not later:**

- `check-p1-29-access` — `gate-before-read` for P1-29 routes (`INS-12`)
- `check-p1-29-adapter-reachability` Authority A — the contract mirror carries an
  exact row for every P1-29-consumed operation (`INS-01`, §3 of the test plan)
- **scope-pair required** — no work-order-domain collection adapter is callable
  without `companyId`/`branchId` (T-02)

**Exit criteria**

1. The board renders, filters (`state`, `kind`, `openedFrom`/`openedTo`) live in
   the query string, and cursor paging works with `CursorPager`.
2. No conclusion is drawn from a single page — `read-completeness` helpers are
   used wherever the UI says anything about the whole set.
3. The empty state explains that work orders arrive from reception and links to
   `/receptions`; there is no create action.
4. An arbitrary lower-snake `state` code is accepted without client validation;
   `kind` is a closed enum.
5. All three new gates are green **and demonstrably fail** when the invariant is
   broken (a red-proof, as P1-28 required for its guard).
6. `verify:web` green, including `format:check:web`, `lint:web`,
   `typecheck:web`, `style:check:web`.

---

## 2. Slice B — work-order detail, read only

**Delivers:** `/work-orders/[workOrderId]` with every read panel and no writes.

|                |                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| **Depends on** | A                                                                                                           |
| **Reads**      | detail, history, service lines, required parts, additional-work list, assignments, labour sessions, QC list |
| **Components** | `Tabs`; a **catalogue-driven** status badge (`INS-44`); a timeline or `DataTable`-based history (`INS-45`)  |

**Exit criteria**

1. Seven tabs render (Overview, Jobs, Lines & parts, Additional work,
   Diagnostics, Quality, History), each degrading independently.
2. **Partial authority is proven**, not assumed: with `tech.technician.read`
   withheld the assignment and labour panels are absent and nothing crashes;
   with `iam.sensitive.view` withheld the restricted detail region is absent
   rather than empty.
3. The status badge is driven by the catalogue, and renders an unseeded tenant
   state code humanised rather than as a missing-key error.
4. The Diagnostics tab states plainly that diagnostics is unavailable and why —
   it does not render an empty list implying "none yet" (see Slice H).
5. Actor ids in history are rendered as ids, not invented names.

---

## 3. Slice C — work-order lifecycle

**Delivers:** transitions, the closure checklist, the reopen attempt.

|                |                                                                           |
| -------------- | ------------------------------------------------------------------------- |
| **Depends on** | B                                                                         |
| **Writes**     | `wo.work-order-transition`, `wo.work-order-closure`, `qms.reopen-attempt` |
| **Reads**      | `wo.work-order-closure-eligibility`                                       |

**Gates built here:** `check-p1-29-version-sourcing` and
`check-p1-29-write-reachability`.

**Exit criteria**

1. Actions come **only** from `nextStates`; a fabricated tenant state code
   proves nothing is hard-coded.
2. Reason-requiring transitions use `ReasonConfirmDialog` and refuse an empty
   reason.
3. Closure is a **checklist** driven by the eligibility read; `ERR-WO-001`
   re-reads eligibility rather than showing a bare banner.
4. `wo.work_order.close` withheld → the closure action is absent while
   transition actions remain.
5. The reopen attempt's **201 is rendered as a refusal** (`INS-37`), with the
   rework route offered as the remedy.
6. Every version-guarded write sources `recordVersion` from a read or the
   immediately prior response — enforced by the gate, red-proved.
7. `ERR-CON-001` and `ERR-TRN-001` have **visibly different** presentations, and
   neither auto-retries.

---

## 4. Slice D — jobs

**Delivers:** job create, edit, and the four composed actions.

|                |                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Depends on** | C                                                                                                                          |
| **Writes**     | `wo.job-create`, `wo.job-update`, `wo.job-transition`, `tech.labor-session-start`, `tech.labor-session-stop`               |
| **Constraint** | no `GET /jobs/{jobId}` (`INS-03`) — jobs are panels inside the parent, refreshed through it                                |
| **Constraint** | the job graph is unpublished (`INS-06`) — without **BE-1**, derive from the platform seed and fail safe on an unknown code |

**Exit criteria**

1. Ordering is enforced and tested: transition-then-session for start,
   session-then-transition for pause (because `paused` is not `labor_allowed`).
2. A partial-failure test exists **per step**, and the UI names the failed step
   and offers the completing step — never a blanket retry.
3. The pause partial failure (clock stopped, job still `in_progress`) is
   surfaced loudly and is **recoverable after a page reload** — i.e. derivable
   from a re-read, not held in component state.
4. `ERR-WO-002` is pre-empted: a job with a pending **required** additional-work
   request originating from it shows start/resume disabled with that reason
   _before_ the request, and the error path is still handled.
5. One idempotency key per intent, held across retries; a new intent mints a new
   key.
6. No labour total is displayed (`INS-31`), or one is displayed only after
   paging to exhaustion and is labelled.

---

## 5. Slice E — assignments, technicians and labour records

**Delivers:** the assignment lifecycle, the availability picker,
`/technicians` and `/technicians/[technicianProfileId]`.

|                |                                                                   |
| -------------- | ----------------------------------------------------------------- |
| **Depends on** | D                                                                 |
| **Writes**     | assignment create / reassign / end, `tech.labor-session-correct`  |
| **Reads**      | `tech.technician-available`, `tech.technician-queue`, labour list |
| **Nav**        | flip `technicians` to `available`                                 |

**Exit criteria**

1. The availability picker requires a window and presents itself as a window,
   not a roster.
2. Three distinct controls for assign / reassign / end — not one dropdown.
3. `ERR-TECH-001` returns the user to the picker with the refusal attached to
   the **candidate**.
4. A technician is identified by `technicianProfileId` (`INS-24`); **no
   client-side identity resolution of any kind exists** (T-11) — this is
   assertable by a gate or a test over the feature module.
5. Labour correction is presented as a **replacement with an audit trail**, not
   an edit, and requires `tech.labor.correct`.
6. Without **BE-2**, `/technicians/me` does not exist and nothing pretends it
   does.

---

## 6. Slice F — additional work and customer approval

**Delivers:** the request → decision → fulfilment track, with evidence.

|                |                                                                       |
| -------------- | --------------------------------------------------------------------- |
| **Depends on** | C (it is independent of D/E and could run in parallel)                |
| **Writes**     | request, approval, detail (restricted), fulfilment, withdrawal        |
| **Adapter**    | `features/attachments` `captureDocument` → `documentVersionId` → bind |

**Exit criteria**

1. `is_required`, `state` and `fulfillment_state` render as **three separate
   facts**, never folded into one status.
2. `request` and `approve` are separately gated; a holder of one sees only their
   own control.
3. Evidence is a **two-step** flow (capture, then bind) with the orphan case
   handled.
4. The restricted detail sits behind `iam.sensitive.view` in its own adapter.
5. `rejected` is the vocabulary, not "declined"; there is no `partial` decision
   and none is offered (`INS-18`).
6. No quotation list and no per-line authorisation badge are built
   (`INS-19`, `INS-20`).

---

## 7. Slice G — quality handoff and rework

**Delivers:** the QC surface and the rework track.

|                |                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------- |
| **Depends on** | C                                                                                                  |
| **Writes**     | `qms.qc-record-open`, check results, `qms.qc-record-finalize`, `qms.rework-create`, cost, sign-off |
| **Nav**        | flip `work-orders.quality`; decide `INS-13` (entry point, not list)                                |

**Exit criteria**

1. A QC record opens and renders **with no checks** — `qms.qc_checks` is empty
   (`INS-38`) — and the screen says so rather than showing a broken list.
2. `record`, `finalize` and `sign_off` are three separate authorities in the UI.
3. Rework cost is behind `qms.rework.manage` **and** `iam.sensitive.view`, and
   uses `MoneyField`.
4. `/work-orders/quality` is an entry point, and the choice made for `INS-13` is
   recorded in the phase's own documentation.

---

## 8. Slice H — diagnostics — **BLOCKED**

**Cannot start.** `INS-09`: no templates exist, no operation authors one, and no
template-management permission code exists in the 115-row catalogue. `POST
/jobs/{jobId}/inspections` requires a `templateVersionId`.

**Depends on BE-4**, which is a Backend slice of real size — routes _and_ new
permissions.

If BE-4 lands, the slice is well-defined: one aggregate read drives one screen
with seven sections, the lifecycle is a fixed four-state graph (hard-coded,
unlike the work order), nothing is editable after recording, evidence is
report-level only, and `needs_rework` unlocks nothing. The design is in
[technician-and-diagnostics-design.md](technician-and-diagnostics-design.md)
Part B and does not need revisiting.

**Recommendation: exclude Slice H from P1-29 and rename the phase, or fund BE-4
and accept that P1-29 is not a Frontend-only phase.** That is the Owner's
decision and it should be taken before Slice A starts, because it determines
whether the diagnostics navigation entry is flipped at all.

---

## 9. Dependency graph

```
        BE-5 (parity gate, very small) ── advisable before anything
        BE-1, BE-2, BE-3 (small)  ┐
                                  │
   A ──► B ──► C ──┬──► D ──► E ◄─┘   (E needs BE-2 for "my queue")
                   │
                   ├──► F
                   │
                   └──► G

   H  ◄── BE-4 (large)      BLOCKED
```

D and E consume **BE-1** (the job graph) and **BE-2** (technician identity).
B consumes **BE-3** (the customer) for Owner requirement 2.
Nothing else in A–G is blocked.

---

## 10. What each option delivers

| option                   | slices            | Owner requirements met                    | honest description                                                               |
| ------------------------ | ----------------- | ----------------------------------------- | -------------------------------------------------------------------------------- |
| **Minimum honest phase** | A, B, C           | 1, 14 (partly), 15 (handoff), 16 (partly) | a usable work-order record with a correct lifecycle                              |
| **Workshop operations**  | A–G               | + 7 (partly), 14, 15                      | the supervisor's job, end to end; the technician still needs a supervisor's link |
| **+ small Backend**      | A–G with BE-1/2/3 | + 2, 5 (partly), 7                        | the technician persona works; the customer is visible                            |
| **Full phase title**     | A–H with BE-4     | + 9, 10, 11                               | not a Frontend phase                                                             |

Requirements 3, 4, 6, 8, 12 and 13 are **not reachable in any of these options**
without BE-6, BE-7 and BE-8. That is stated so no option is mistaken for
completeness.
