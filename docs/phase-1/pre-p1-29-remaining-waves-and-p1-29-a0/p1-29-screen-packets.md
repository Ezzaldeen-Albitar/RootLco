# P1-29 — screen implementation packets and the UI state matrix

**One execution packet per future P1-29 screen, and a complete state matrix.** No code, no
component, no route file.

Contracts named here are the ones that exist on `develop`. Where a screen needs a contract that
does not exist, the packet names the prerequisite from
[p1-29-a0-backend-prerequisites.md](p1-29-a0-backend-prerequisites.md) and says the screen is
**blocked**, rather than describing a design against a contract nobody has written.

---

## 1. Rules every packet inherits

- **Locales `ar` and `en`; `ar` is the default and is RTL.** Direction is decided once, on `<html>`.
  Components use logical utilities, never `[dir='rtl']` selectors.
- **Every collection call names `companyId` and `branchId`.** A scope declaration is inert without
  a target, and `app.branch_ids` is the permission-blind union of every active grant, so omitting
  the pair silently degrades authorization.
- **`If-Match` on every version-guarded write**, sourced from a read or the immediately prior
  response — **never** computed as `version + 1`.
- **Filters live in the query string**, so a locale switch preserves them.
- **The client hides; the server refuses.** Navigation capability is UX support, never security.
- **No conclusion from one page.** Any statement about a whole set uses the read-completeness
  helpers, or is labelled partial.
- **Nothing fabricated.** An empty catalogue renders as empty and says why.

---

## 2. The packets

### P-01 — Work-order active queue · `/work-orders`

|                            |                                                                                                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **persona**                | service advisor, workshop supervisor, branch manager                                                                                                                        |
| **permissions**            | `wo.work_order.read`                                                                                                                                                        |
| **reads**                  | `wo.work-order-list` — `companyId*`, `branchId*`, `state?`, `kind?`, `openedFrom?`, `openedTo?`, `cursor?`, `limit?`                                                        |
| **writes**                 | none                                                                                                                                                                        |
| **blocked on**             | `BE-3` for a customer column; **not** blocked for the rest                                                                                                                  |
| **loading**                | `SkeletonRows` inside `DataTable`                                                                                                                                           |
| **empty**                  | "work orders arrive from reception" + a link to `/receptions`. **No create action** — there is no collection create endpoint, deliberately                                  |
| **error**                  | banner + correlation id; the filter state survives                                                                                                                          |
| **blocked (subscription)** | see §3 — today unreachable, and the screen must not pretend otherwise                                                                                                       |
| **stale**                  | not applicable to a list read                                                                                                                                               |
| **mutations**              | none                                                                                                                                                                        |
| **responsive**             | table collapses to cards below the tablet breakpoint                                                                                                                        |
| **ar / en**                | state codes are **data**: translate known platform codes, humanise unknown tenant codes, never render a missing-key error                                                   |
| **acceptance tests**       | scope pair always sent · an arbitrary lower-snake `state` is accepted without client validation while `kind` is a closed enum · cursor paging · empty state names reception |

### P-02 — Work-order history · `/work-orders?view=history` or a sibling tab

|                      |                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **persona**          | advisor, branch manager                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **permissions**      | `wo.work_order.read`                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **reads**            | the same list operation, **one call per terminal state** — there is no separate history read. CORRECTED: `state` is a **single** optional lower-snake code in a `.strict()` query, compared by equality — **no array, no negation, no `isTerminal` filter**. The terminal codes are `closed` and `cancelled` today, and a tenant cannot add a third, but a **platform migration can** — so the set must be read from `BE-1`’s `isTerminal` flag, never hard-coded |
| **blocked on**       | **`BE-1`**, to enumerate the terminal codes. Until it lands the screen would hard-code them, which is the defect `BE-1` exists to prevent                                                                                                                                                                                                                                                                                                                         |
| **note**             | the _record_ history (transitions) is P-09. This packet is the closed-work-order queue, and the distinction must be visible in the UI or users will look for one in the other                                                                                                                                                                                                                                                                                     |
| **acceptance tests** | each terminal stream is paged independently and the view is **labelled partial** · the filter is in the URL · the test _“a closed order appears here and not in P-01”_ is **withdrawn as unsatisfiable** until P-01 can exclude terminal orders                                                                                                                                                                                                                   |

**A knock-on for P-01, recorded rather than glossed.** The word _active_ in P-01’s title is not
backed by a contract: `wo.work-order-list` has no negation and no multi-value `state`, and omitting
the filter returns closed and cancelled rows. `BE-1` lets the client **recognise** terminal codes
but still not exclude them server-side. The honest options are to label P-01 an unfiltered
work-order list, or to raise a further prerequisite for a terminal-exclusion filter. **Hiding
terminal rows from a cursor page client-side is not an option** — it breaks page-size semantics
and violates the no-conclusion-from-one-page rule in §1.

### P-03 — Work-order detail · `/work-orders/[workOrderId]`

|                       |                                                                                                                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **persona**           | advisor, supervisor                                                                                                                                                                                                                                       |
| **permissions**       | `wo.work_order.read`; panels additionally need `tech.technician.read`, `iam.sensitive.view`, `qms.quality_control.read`, `dia.diagnostic.read`                                                                                                            |
| **reads**             | detail (`{workOrder, jobs[], nextStates[]}`), closure-eligibility, service lines, required parts, additional work, assignments, labour sessions, QC list                                                                                                  |
| **writes**            | transitions, closure, reopen attempt, job create/update/transition, lines, parts                                                                                                                                                                          |
| **blocked on**        | `BE-3` (customer), `BE-1` (the job graph)                                                                                                                                                                                                                 |
| **partial authority** | **the defining property of this screen.** With `tech.technician.read` withheld the assignment and labour panels are **absent**, not empty; with `iam.sensitive.view` withheld the restricted additional-work detail is absent. Neither may crash the page |
| **actions**           | rendered **from `nextStates`**, never a hard-coded list. A reason-requiring edge opens `ReasonConfirmDialog`                                                                                                                                              |
| **frozen scope**      | `qc_pending` sets `allows_jobs`, `allows_labor` and `allows_additional_work` all false — the tabs must reflect that before the user composes a refused request                                                                                            |
| **acceptance tests**  | a fabricated tenant state code appears as an action · closure renders every blocker at once · the `close` conjunction hides the closure action while leaving transitions · `record_version` sourced from a read                                           |

### P-04 — Closure checklist · `/work-orders/[workOrderId]/closure`

|                           |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **permissions**           | `wo.work_order.read` to view; `wo.work_order.transition` **AND** `wo.work_order.close` to act                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **reads**                 | `wo.work-order-closure-eligibility` — `{workOrderId, state, eligible, blockers[], alreadyTerminal, deferred, inventoryCommitments}`. `blockers[]` is B1–B6 at once, **and is not the whole answer**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **design**                | a checklist, not a button that fails — and a **seven**-row checklist, not six                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **must not imply**        | that parts are settled by the six blockers alone. **This reverses a claim inherited from the frozen P1-29 preparation.** `CLOSURE_BLOCKER_REGISTRY` has six entries because `wo.guard_work_order_closure` enforces six; `DEFERRED_CLOSURE_BLOCKERS` _names_ the two it cannot express — `active-reservation`, `open-part-issue` — and **P1-21 evaluates both in the application**. The eligibility read carries `inventoryCommitments: {activeReservations, openIssues, blocking}`, counted from `inv.stock_reservations` and `inv.part_issues` net of returns, and sets `eligible: false` whenever `blocking`. Render it as a **seventh checklist row** beside the six, labelled with its own enforcer — not as a blocker of the guard |
| **drive from `eligible`** | never from `blockers.length`. The `blockers[]` array is B1–B6 only; the inventory condition arrives in a separate field, and `inventoryCommitments` is evaluated **even when the order is already terminal**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **two distinct refusals** | `ERR-WO-001` carries a non-empty `blockers` list and is only ever a race — re-read and re-render. The inventory refusal is **`ERR-TRN-001`**, raised at `work-order-service.ts:1346` **before** the B1–B6 check (`:1343-1352` vs `:1362-1373`), with `blockers` **empty**. Read its cause from `inventoryCommitments`, never from the blocker list. Clearing inventory may then reveal further blockers                                                                                                                                                                                                                                                                                                                                 |
| **acceptance tests**      | all six blockers **plus the inventory-commitment row** render with remedies · a non-zero `activeReservations` blocks with `eligible: false` and an **empty** `blockers` · `ERR-WO-001` re-reads rather than showing a bare banner · `ERR-TRN-001` from the closure command is presented as an inventory refusal, not as a state change                                                                                                                                                                                                                                                                                                                                                                                                  |

### P-05 — Technician "My jobs" · `/technicians/me`

|                 |                                                                                                                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **persona**     | technician                                                                                                                                                                                                                                                     |
| **permissions** | `tech.technician.read`                                                                                                                                                                                                                                         |
| **status**      | **BLOCKED on `BE-9` then `BE-2`.** Without a roster there is no profile; without the resolution contract the caller cannot reach their own                                                                                                                     |
| **hard rule**   | **no client-side identity resolution of any kind.** Not by name, not by email local-part, not by iterating ids, and **not** by the technician selecting themselves from `GET /technicians/available` — that is the same self-assertion in a friendlier costume |
| **interim**     | a supervisor navigating to `/technicians/[technicianProfileId]`. That serves the supervisor persona fully and the technician persona only through a supervisor. There is no interim "My jobs"                                                                  |

### P-06 — Technician job workspace

|                      |                                                                                                                                                                                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **persona**          | technician                                                                                                                                                                                                                                                           |
| **permissions**      | `wo.job.transition` + `tech.labor.record`; `tech.labor.correct` (high) for a correction                                                                                                                                                                              |
| **reads**            | the parent work-order detail (there is no single-job read — `INS-03`), labour sessions                                                                                                                                                                               |
| **writes**           | job transition; labour session start/stop; labour correction                                                                                                                                                                                                         |
| **composed actions** | start, pause, resume, complete are **each two calls with no shared transaction**. Ordering is asymmetric: transition-then-session to start; **session-then-transition to pause**, because `paused` is not `labor_allowed`                                            |
| **partial failure**  | every packet must name the failed step and offer the _completing_ step. The dangerous case is pause: clock stopped, job still `in_progress`, technician believes time is not accruing. It must be recoverable **after a page reload**, i.e. derivable from a re-read |
| **`ERR-WO-002`**     | pre-empt it: a job with a pending **required** additional-work request originating from it shows start/resume disabled **with that reason**, before the request. Pausing is never refused                                                                            |
| **no totals**        | there is no labour-total endpoint; do not display one, or page to exhaustion and label it                                                                                                                                                                            |
| **acceptance tests** | ordering · a partial-failure test per step · one idempotency key per intent, reused across retries                                                                                                                                                                   |

### P-07 — Diagnostics workspace · inspection detail

|                       |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **persona**           | diagnostic technician, reviewer                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **permissions**       | `dia.diagnostic.read`; `dia.diagnostic.record`; `dia.diagnostic.complete`; `dia.diagnostic.review` — four separate authorities                                                                                                                                                                                                                                                                                                                                                                             |
| **status**            | **BLOCKED on `BE-4`**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **reads**             | one aggregate read returns everything, including `outstandingMandatory`                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **writes**            | item results (PUT), measurements, DTCs, findings, recommendations, evidence, transition, completion, review                                                                                                                                                                                                                                                                                                                                                                                                |
| **immutability**      | **CORRECTED — everything except a checklist answer is append-only.** `dia.diagnostic-item-result` is the module's only `PUT` and upserts on `(report, template_item)` (`ON CONFLICT … DO UPDATE`), so an answer **may be corrected in place** — no `If-Match`, no new row. Measurements, DTCs, findings, recommendations, evidence and reviews are POST-only, with no update and no delete route anywhere in the module: those forms need a review-before-submit step and must say the record is permanent |
| **correction window** | the answer freezes when `lockRecordableReport` refuses — the report has left `draft`/`in_progress`, **or** the parent work order has reached a terminal state. Both are **application** rules; the database enforces neither. So the answer form offers edit while recordable and must state the real condition — _"answers are locked once the inspection is completed"_ — never _"permanent"_                                                                                                            |
| **evidence**          | report-level only — no `template_item_id`, `finding_id` or `measurement_id`. Do not render evidence inside an item row as though it were bound there                                                                                                                                                                                                                                                                                                                                                       |
| **vocabularies**      | severity (5, on findings) and priority (3, on recommendations) are **two vocabularies on two entities**. No report-level roll-up exists; inventing one is inventing data                                                                                                                                                                                                                                                                                                                                   |
| **review**            | records an opinion and unlocks nothing. **Never offer "send back for rework"**                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **acceptance tests**  | `ERR-DIA-001` violation paths map back onto checklist rows · `measuredValue` client validation matches the server regex exactly · DTC format                                                                                                                                                                                                                                                                                                                                                               |

### P-08 — Inspection template selection and authoring

|                 |                                                                                                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **persona**     | tenant administrator (authoring); technician (selection)                                                                                                                   |
| **status**      | **BLOCKED on `BE-4`.** Both halves                                                                                                                                         |
| **permissions** | the derived `dia.catalogue.manage` for authoring; `dia.diagnostic.record` to open an inspection                                                                            |
| **must not**    | seed or display a fabricated "standard inspection". A platform template is **not representable** — `dia.inspection_templates.tenant_id` is NOT NULL with no `scope` column |
| **empty state** | "no templates exist; an administrator must create one" — honest, and correct until `BE-4` lands                                                                            |

### P-09 — History and activity timeline

|                   |                                                                                                                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **permissions**   | `wo.work_order.read` for work-order **and job** history; `dia.diagnostic.read`; `qms.quality_control.read`                                                                                                                                                                                       |
| **reads**         | CORRECTED: **three** separately keyset-paged histories, not four — `wo.work-order-history` and `wo.job-history` (both under `wo.work_order.read`), and `dia.diagnostic-history`. Filtering the register to the four modules yields 58 operations and exactly three histories                     |
| **no QC history** | none of the thirteen `qms` operations is a history read. `qms.reopen-attempt-list` is the nearest by shape and is **not** one: it lists refused reopen attempts, which is a ledger of a different thing. `qms.quality_control.read` therefore buys nothing on this screen and should not gate it |
| **blocked on**    | nothing to render them separately; **`DEP-B7` / `INS-30`** to unify them                                                                                                                                                                                                                         |
| **must not**      | merge three independently paginated streams and claim completeness. Ordered is not complete                                                                                                                                                                                                      |
| **actors**        | `actor_id` is an id and no directory read is in scope. Render the id, or "a user" — never an invented name                                                                                                                                                                                       |
| **component**     | none exists. Build a timeline, or use `DataTable` + `CursorPager`                                                                                                                                                                                                                                |

### P-10 — Integration: parts, quotation and approvals

|                          |                                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **permissions**          | `wo.work_order.line.manage`; `wo.additional_work.request`; `wo.additional_work.approve`; `+ iam.sensitive.view` for the restricted detail                                                                                                        |
| **reads/writes**         | required parts, service lines, additional-work request/decision/fulfilment/withdrawal, approval evidence                                                                                                                                         |
| **three separate facts** | `is_required` (technical, immutable), `state` (commercial), `fulfillment_state` (execution). Never folded into one status                                                                                                                        |
| **evidence**             | two steps — capture a document version, then bind it. The orphan case must be recoverable                                                                                                                                                        |
| **must not build**       | a partial-approval view (storable, folded lossily on read), a quotation list for a work order (no such read), a per-line authorisation badge (no per-line authority exists), a parts fulfilment tracker (`parts_forward_state` is never written) |

---

## 3. The UI state matrix

Every cell is a state a screen must handle. **A blank cell is not "won't happen" — it is "not
applicable to this screen".**

| state                        | P-01 queue                      | P-03 detail                                        | P-04 closure                | P-06 technician                   | P-07 diagnostics                                 | P-09 history       |
| ---------------------------- | ------------------------------- | -------------------------------------------------- | --------------------------- | --------------------------------- | ------------------------------------------------ | ------------------ |
| **loading**                  | skeleton rows                   | skeleton panels per tab                            | skeleton checklist          | skeleton                          | skeleton                                         | skeleton rows      |
| **loaded**                   | table + cursor pager            | tabs, each independently authorised                | checklist + action          | job panel + clock                 | aggregate sections                               | paged list         |
| **empty**                    | "arrives from reception" + link | no jobs yet                                        | eligible, nothing to clear  | no assigned work                  | no entries recorded                              | no transitions yet |
| **permission denied**        | route denies before first read  | **panel absent, page renders**                     | view allowed, action absent | action absent                     | section absent                                   | source absent      |
| **subscription blocked**     | see below                       | see below                                          | see below                   | see below                         | see below                                        | see below          |
| **tenant switched**          | full remount, filters reset     | navigate to the queue                              | navigate to the queue       | navigate to the queue             | navigate to the queue                            | full remount       |
| **branch changed**           | refetch with the new pair       | **navigate away** — the record may not be in reach | navigate away               | navigate away                     | navigate away                                    | refetch            |
| **stale version**            | n/a                             | `ERR-CON-001`: re-read, re-render, user decides    | re-read eligibility         | re-read the job                   | `ERR-CON-002`/`001` on transition and completion | n/a                |
| **network failure**          | persistent banner + retry       | persistent banner                                  | persistent banner           | **loud** — the clock may be wrong | persistent banner                                | persistent banner  |
| **mutation pending**         | n/a                             | control disabled, not hidden                       | disabled                    | disabled, clock unchanged         | disabled                                         | n/a                |
| **mutation success**         | n/a                             | refetch + success toast                            | refetch eligibility         | refetch + clock update            | refetch aggregate                                | refetch            |
| **mutation error**           | n/a                             | per-code presentation (§4)                         | `ERR-WO-001` → re-read      | `ERR-WO-002` → offer pause        | `ERR-DIA-001` → map to rows                      | n/a                |
| **deleted / disabled actor** | rows persist; actor id renders  | the actor id renders                               | —                           | assignment ends; clock must stop  | reviewer id renders                              | actor id renders   |
| **cross-tenant denial**      | 403, generic                    | 403, generic                                       | 403                         | 403                               | 403                                              | 403                |

**Two global rules.**
**Errors remain persistent until the user acts.** A banner that fades is a banner that was not read.
**Global notifications are viewport-fixed**, rendered by the single `NotificationHost` — never by a
screen. A `conflict` is a **warning**, not an error: the user did nothing wrong, the world moved.

### Subscription-blocked — the honest row

There is **no subscription-blocked state to render today**. Zero of the 305 operations declare a
`featureFlag`, `ERR-TEN-001` is unreachable, and nothing reads `org.tenants.status` during
authentication. Every screen must therefore:

- **not** implement a client-side subscription gate — it would be a second, divergent source of
  truth and it would not be a control;
- render `ERR-TEN-001` **distinctly from `ERR-IAM-001`** if it ever arrives — _"your plan does not
  include this"_ is a different sentence from _"you are not permitted"_;
- treat the blocked state as a **design placeholder pending a Backend decision**, documented in
  [subscription-enforcement-plan.md](subscription-enforcement-plan.md).

---

## 4. Error presentation, per code

| code           | HTTP    | presentation                                                                                                     |
| -------------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| `ERR-CON-001`  | 409     | "this changed while you were working" + refresh. **Never auto-retry**                                            |
| `ERR-CON-002`  | 428     | should be unreachable — the version was always sent                                                              |
| `ERR-TRN-001`  | 409     | "no longer possible: the order is now _X_" + the refreshed action list. **Visibly different from `ERR-CON-001`** |
| `ERR-WO-001`   | 409     | re-read eligibility, render the checklist                                                                        |
| `ERR-WO-002`   | 409     | name the pending required request; offer **pause**, not retry                                                    |
| `ERR-TECH-001` | 422     | return to the picker with the refusal attached to the **candidate**                                              |
| `ERR-DIA-001`  | 409     | map violation paths onto checklist rows, scroll to the first                                                     |
| `ERR-IAM-001`  | 403     | denial + correlation id. **Never name a missing permission**                                                     |
| `ERR-TEN-001`  | 403     | plan-level message, distinct from the above                                                                      |
| reopen attempt | **201** | render as a **refusal**. The one place in the phase where 2xx means "no"                                         |

**`ERR-TRN-001` is not exclusively a graph refusal, and does not always speak about the work
order.** The catalogue intends it to be — `ERR-WO-001`’s entry says of the closure blockers
_"Deliberately NOT ERR-TRN-001 … so this is not a graph refusal. The caller must clear a
condition."_ One shipped site departs from that intent: `work-order-service.ts:1343-1350` raises
`ERR-TRN-001` when a closing transition meets `inventoryCommitments.blocking`, **after** the edge
has already been resolved as legal. There the order’s state has not moved and the action list is
unchanged, so _"the order is now X"_ would state something false. The aggregate named also varies:
the diagnostics service raises it about a **report**, not a work order. **Re-read before
composing the sentence.**

Every failure surface renders the **correlation id**. It is the only diagnostic that is safe to
show and the only one that finds the server log.
