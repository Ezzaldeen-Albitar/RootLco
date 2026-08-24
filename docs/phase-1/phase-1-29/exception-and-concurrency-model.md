# P1-29 — exception, concurrency and presentation model

Every way a P1-29 action can fail, what the Backend says, and what the interface
must do about it. This is the document that stops a phase from rendering
"Something went wrong" over a refusal that had a precise, actionable reason.

---

## 1. The error catalogue, complete

`apps/api/src/server/errors/catalog.ts`. Twenty-eight codes; the ones P1-29 can
receive are marked ●.

|     | code           |    HTTP | class    | retryable | title                                            |
| --- | -------------- | ------: | -------- | --------- | ------------------------------------------------ |
| ●   | `ERR-REQ-001`  |     400 | client   | no        | Malformed request                                |
|     | `ERR-REQ-002`  |     404 | client   | no        | Unsupported API version                          |
| ●   | `ERR-VAL-001`  |     422 | client   | no        | Request validation failed                        |
| ●   | `ERR-PAG-001`  |     400 | client   | no        | Invalid pagination cursor                        |
| ●   | `ERR-IAM-001`  |     403 | security | no        | Not permitted                                    |
| ●   | `ERR-IAM-002`  |     401 | security | no        | Authentication required                          |
| ●   | `ERR-TEN-001`  |     403 | security | no        | Feature not enabled                              |
|     | `ERR-CTX-001`  |     500 | server   | no        | Request context unavailable                      |
| ●   | `ERR-RES-001`  |     404 | client   | no        | Resource not found                               |
| ●   | `ERR-RES-002`  |     409 | conflict | no        | Resource already exists                          |
| ●   | `ERR-DEP-001`  |     503 | server   | **yes**   | Upstream dependency unavailable                  |
| ●   | `ERR-INT-001`  |     409 | conflict | no        | Idempotency key conflict                         |
| ●   | `ERR-INT-002`  |     400 | client   | no        | Idempotency key required                         |
|     | `ERR-INT-003`  |     400 | client   | no        | Idempotent request carries secret material       |
| ●   | `ERR-CON-001`  |     409 | conflict | **yes**   | Record version conflict                          |
| ●   | `ERR-CON-002`  | **428** | client   | no        | Record version required                          |
| ●   | `ERR-RTE-001`  |     429 | throttle | **yes**   | Too many requests                                |
|     | `ERR-STB-001`  |     501 | client   | no        | Not implemented                                  |
| ●   | `ERR-DOC-001`  |     409 | conflict | no        | Document version not available                   |
|     | `ERR-NTF-001`  |     409 | conflict | no        | Recipient consent not granted                    |
|     | `ERR-EXP-001`  |     422 | client   | no        | Export exceeds the permitted size                |
| ●   | `ERR-TRN-001`  |     409 | conflict | no        | Transition not permitted from the current state  |
| ●   | `ERR-WO-001`   |     409 | conflict | no        | Work order cannot be closed yet                  |
| ●   | `ERR-WO-002`   |     409 | conflict | no        | Additional work awaits a customer decision       |
| ●   | `ERR-TECH-001` |     422 | client   | no        | Technician is not eligible for this assignment   |
| ●   | `ERR-DIA-001`  |     409 | conflict | no        | Diagnostic report has unresolved mandatory items |
| ●   | `ERR-QMS-001`  |     409 | conflict | no        | Quality or rework precondition not satisfied     |
| ●   | `ERR-SYS-001`  |     500 | server   | **yes**   | Unexpected error                                 |

**`retryable` is a property of the code, not a guess the UI makes.** Only four
codes are retryable, and only one of them (`ERR-CON-001`) is retryable _by the
user_ — the rest are retryable by the transport.

---

## 2. The five domain codes are the phase's most important UX asset

These exist precisely so a refusal can be _explained_. Rendering any of them as
a generic error throws away the work the Backend did.

### `ERR-CON-001` vs `ERR-TRN-001` — the distinction the UI must preserve

The catalogue states it explicitly: `ERR-TRN-001` means _"the target state is
registered for this aggregate, but the aggregate is not in a state the
transition may start from — including the case where it is already in the target
state. Distinct from `ERR-CON-001`, which means the caller held a stale record
version: re-reading and retrying fixes a version conflict and cannot fix this
one."_

|           | `ERR-CON-001`                                                                               | `ERR-TRN-001`                                                                        |
| --------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| cause     | your copy is old                                                                            | the move is illegal from here                                                        |
| remedy    | **re-read and try again**                                                                   | **re-read and pick a different action**                                              |
| retryable | yes                                                                                         | no                                                                                   |
| UI        | "This changed while you were working. Refresh to see the current state." + a refresh action | "This is no longer possible: the work order is now _X_." + the refreshed action list |

An interface that shows the same banner for both trains users to reload and
retry an action that will never succeed.

### `ERR-WO-001` — closure refused, and the remedy is a checklist

Raised by `wo.guard_work_order_closure` (blockers B1–B6). **Deliberately not
`ERR-TRN-001`**: the `ready_to_close→closed` edge exists and the aggregate is in
a legal starting state. The caller must _clear a condition_, not re-read or pick
a different target.

**The UI must never surface this bare.** `GET /work-orders/{id}/closure-eligibility`
returns every blocker at once, so the closure screen shows the whole checklist
_before_ the attempt, and `ERR-WO-001` is only ever a race — something became
blocking between the check and the attempt. Handle it by re-reading eligibility
and re-rendering the checklist.

### `ERR-WO-002` — the rule almost nobody would guess

> A job may not enter a state whose `wo.job_states.labor_allowed` is true while
> a **required** additional-work request **originating from that job** is still
> `pending` — work the customer has not authorised must not be started or
> resumed.

Three qualifications in the catalogue's own words, each of which changes the UI:

- **Pausing is never refused.** A job can wait in a non-labour state while the
  customer is asked. So the remedy offered on this error is _pause and chase the
  approval_, not _try again_.
- **Approved-but-unfulfilled does not refuse execution** — that is authorised
  work waiting to be done, and gating it would make it undoable.
- It refuses **one job movement**, only for requests naming _that job_ as their
  origin — unlike `ERR-WO-001`, which is the whole work order.

**Design consequence:** the Jobs tab must show, per job, whether a required
additional-work request originating from it is pending, and disable start/resume
with that reason _before_ the user tries. Discovering this only as a 409 is a
poor experience for a rule that is entirely predictable from data the screen
already has.

### `ERR-TECH-001` — 422, not 409, and the difference matters

_"The named technician does not satisfy the job's eligibility requirements: a
missing or insufficient skill level, a missing or expired certification, no
covering availability interval, an inactive profile, or an out-of-scope
company/branch. A client error rather than a conflict because the request named
the wrong technician; the same request will keep failing until a different
technician is chosen."_

So the remedy is **pick someone else**, and the UI should return the user to the
picker with the refusal attached to the _candidate_, not to the form.

Note this is also raised by `POST /jobs/{jobId}/transition` — a perfectly valid
edge that still fails without an assignment surfaces as `ERR-TECH-001` rather
than a bare `23514`.

### `ERR-DIA-001` — the list is the message

Completion is refused when mandatory items are unresolved, and _"a caller told
their report is incomplete without being told which of forty items is missing
has been told nothing"_ — so the service reports **the whole list** as
`ERR-DIA-001` violations **keyed by item code**, the template's own identifier,
which the caller is already reading to fill the form.

**The UI must map those violation paths back onto the checklist rows** and
scroll to the first. Rendering "report incomplete" as a banner discards a
precisely-designed payload. It is also mostly avoidable: `outstandingMandatory`
comes back on the detail read, so the completion button can be gated before the
attempt.

### `ERR-QMS-001` — and the one place it is deliberately _not_ used

A quality or rework precondition. Notably, the **reopen attempt does not use
it**: `POST /work-orders/{id}/reopen-attempts` returns **201 with the recorded
attempt and its refusal**, not a 409 — because a throw would abort the
transaction and roll back the ledger row it had just written. A work order that
is _not_ closed is a different refusal (`ERR-TRN-001`, there is nothing to
reopen).

**So the UI must treat a 201 from that endpoint as a refusal to display, not as
a success.** This is the one place in the phase where 2xx means "no".

---

## 3. Optimistic concurrency

Every state-changing operation on an existing row is `versionGuarded`. The
client sends `If-Match` carrying the row's `record_version`.

| situation      | response                          |
| -------------- | --------------------------------- |
| header absent  | **428** `ERR-CON-002`             |
| header stale   | **409** `ERR-CON-001` (retryable) |
| header current | proceeds                          |

`shared.touch_row_m…` bumps `record_version` on every UPDATE, so any concurrent
change — including one by a trigger — invalidates a held version.

### 3.1 Rules for P1-29

1. **Every rendered entity carries its `record_version` in client state.** A
   screen that displays a work order but not its version cannot act on it.
2. **A version is per-row, not per-screen.** The work-order detail holds the
   order's version _and_ one per job. A job action must send the job's.
3. **Never send a version the user has not seen the state of.** Re-reading in
   the background and silently adopting a new version defeats the entire
   mechanism — it turns "someone else changed this" into "your change silently
   overwrote theirs".
4. **Recovery is re-read → re-render → let the user decide.** Never auto-retry a
   409, even though the code is marked retryable; that flag means the _request
   shape_ is retryable after a re-read, not that the _intent_ is still valid.
5. `ERR-CON-001` is also raised for a **moved record** — e.g. an approval
   decision against an additional-work request that changed in between, which
   _"is `ERR-CON-001`, not silently attached to different work."_ Same handling.

### 3.2 Idempotency

`idempotent: true` requires an `Idempotency-Key`; omitting it is `ERR-INT-002`
(400). Reusing a key with a **different** payload is `ERR-INT-001` (409).

- **Mint one key per user intent**, not per HTTP attempt. A retry of the same
  intent must reuse it; a new intent must not.
- **Never reuse a key across a composed action's two calls** (see section 4) —
  they are different operations.
- `PUBLISHED_OPERATIONS` (generated from the OpenAPI document) carries each
  operation's idempotency posture; resolve from it rather than hard-coding.

---

## 4. Multi-call actions and partial failure

Four P1-29 actions are compositions with no shared transaction — start, pause,
resume, complete (see
[technician-and-diagnostics-design.md](technician-and-diagnostics-design.md)
A3). Attaching evidence is a fifth (capture a document version, then bind it).

**The model P1-29 must adopt:**

1. **Never present a composed action as atomic.** No spinner that hides two
   calls behind one label with one outcome.
2. **On partial failure, name the step that failed and offer the completing
   step** — not a blanket retry, which re-runs the successful call.
3. **The dangerous case is pause**: session stopped, transition refused. The
   technician believes the clock is paused and the job is still `in_progress`
   with no open session. This must be surfaced loudly and recoverable in one
   action.
4. **The recoverable state must be derivable from a re-read**, so the recovery
   survives a page refresh. A recovery that lives only in component state is
   lost the moment the browser reloads — which is exactly when a user reloads.

---

## 5. Multi-user concurrency — what actually collides

The realistic collisions in a workshop, and what the platform does:

| scenario                                                                 | mechanism                                                                                                                         | UI obligation                                                                                  |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| two advisors transition the same work order                              | second gets `ERR-CON-001`                                                                                                         | re-read, re-render actions                                                                     |
| an advisor closes while a technician is still clocked in                 | B2 blocks closure → `ERR-WO-001`                                                                                                  | show the running session in the closure checklist                                              |
| a technician starts a job while an advisor cancels it                    | `ERR-TRN-001` on one of them                                                                                                      | the refused party re-reads and sees the cancellation                                           |
| two technicians open a session on the same job                           | **not prevented by the platform** — `tech.labor_sessions` has no one-open-session-per-job constraint visible in the schema        | the UI shows existing open sessions before offering to start one; it cannot prevent the second |
| an advisor raises required additional work while a technician is working | `ERR-WO-002` on the technician's next start/resume, **not** on the current session                                                | show the pending required request on the job                                                   |
| two callers decide the same additional-work request                      | `uq…` + the approval guard; second sees a conflict                                                                                | re-read the decision                                                                           |
| two callers decide the same quotation line                               | `uq_approval_decisions_item` makes the first decision **final**; an opposite decision aborts the whole command with `ERR-CON-001` | never offer to "change" a recorded decision                                                    |

**There is no realtime channel.** No WebSocket, no SSE, no polling convention
exists in `apps/web`. Every screen is as fresh as its last read. P1-29 must
therefore:

- refresh after every successful write (the `useServerTable` `refresh()` and the
  read adapters already support this);
- treat a 409 as _information_, not as a failure — it is the platform telling
  the user the world moved;
- **not** invent polling. That is a platform decision, not a phase decision.

---

## 6. Presentation of failure

### 6.1 The `ActionState` contract

Every Server Action returns
`ActionState {status, messageKey?, fieldErrors?, correlationId?, attempt?}`,
with `status ∈ idle | success | invalid | conflict | denied | expired |
throttled | unavailable | error`.

Mapping from the API failure kind (`STATUS_BY_KIND`):

| API kind                            | `ActionStatus` |
| ----------------------------------- | -------------- |
| `unauthenticated`                   | `expired`      |
| `forbidden`                         | `denied`       |
| `not-found`                         | `error`        |
| `conflict`                          | `conflict`     |
| `validation`                        | `invalid`      |
| `rate-limited`                      | `throttled`    |
| `server`, `cancelled`               | `error`        |
| `unavailable`, `timeout`, `network` | `unavailable`  |

Three rules the module states in its own docblock, all of which P1-29 inherits:

1. **A result may carry translation _keys_ and nothing else that came from the
   backend.** The correlation ID is the only diagnostic safe to show.
2. **`problem.errors` does not exist and never has.** The API publishes
   `violations` — `{path, rule}` pairs carrying **no prose**. `violationKeysOf`
   turns each into a catalogue key; an unknown rule becomes
   `form.violation.invalid`. So **every value in `fieldErrors` is a key**, and
   every render site translates it.
3. **A whole-request violation is not dropped.** `{path: 'body', rule: …}` names
   no control, so it becomes the `messageKey` and appears in the banner every
   form already renders — one shape, nothing new for a screen to forget.

`attempt` is bumped on every submission so an identical result can be
re-announced; without it, the second identical failure is announced to nobody.

### 6.2 Toasts

`notifyActionResult(state, messages)` owns the tone map:

| status                                      | tone                                      |
| ------------------------------------------- | ----------------------------------------- |
| `success`                                   | success                                   |
| `conflict`, `throttled`                     | **warning**                               |
| `denied`, `expired`, `unavailable`, `error` | error                                     |
| `invalid`                                   | **not toasted** — it belongs on the field |

`check-notification-authority` enforces four rules: `ToastRegion` is rendered in
exactly one place, that place is `NotificationHost`, it is mounted once in the
locale layout, and there is no second notification library. **P1-29 raises
toasts through `notifyActionResult` and never renders its own region.**

A `conflict` being a _warning_ rather than an _error_ is deliberate and P1-29
should preserve it: the user did nothing wrong, the world moved.

### 6.3 Denial

`ERR-IAM-001` is _"Not permitted"_ and the backend **never explains what was
missing** — deliberately, because explaining would be a permission-enumeration
oracle. So:

- the client hides what the caller cannot do (`hasPermission`, exact match, fail
  closed);
- a `denied` that still arrives means the client's picture and the server's
  disagree — render it as a denial with a correlation ID, and **do not** try to
  say which permission was missing.

### 6.4 The correlation ID

The only diagnostic a user ever sees. Every failure surface in P1-29 must render
it when present. It is an opaque token that finds the server-side log without
telling the browser anything.

---

## 7. Feature entitlement — a mechanism that exists and is unused here

`apps/web`'s counterpart of subscription blocking is `ERR-TEN-001`
_"Feature not enabled"_ (403), raised by the entitlement middleware from
`org.resolve_feature_enabled(flag, at)`, which applies tenant override → plan
effective at the instant → platform default, and **raises rather than returning
false for an unregistered flag** so that a typo cannot silently disable _or_
enable a feature. Entitlement runs **after** authorization, so an unauthorized
caller cannot learn which features a tenant has bought.

**No operation in `apps/api/src/app/api/v1` declares a `featureFlag` — zero,
repository-wide.** So `ERR-TEN-001` is currently unreachable.

For P1-29 this means:

- subscription-based blocking of work-order features is **available as a
  platform mechanism and wired to nothing**;
- P1-29 must **not** implement subscription gating client-side. A client-side
  entitlement check is not a control, and building one would create a second,
  divergent source of truth;
- if the Owner requires subscription-gated workshop features, the work is
  Backend: declare `featureFlag` on the relevant operations and register the
  flags. The client's part is only to render `ERR-TEN-001` distinctly from
  `ERR-IAM-001` — _"your plan does not include this"_ rather than _"you are not
  permitted"_. `INS-22`.

---

## 8. Internationalisation of failure

Two catalogues, `en.json` and `ar.json`, 1868 keys in `en`, both updated in the
same change. Every `messageKey` and every `fieldErrors` value is a key into
them.

P1-29-specific problems:

- **Nine domain codes need message keys**, and the five domain-specific ones
  (`ERR-WO-001`, `ERR-WO-002`, `ERR-TECH-001`, `ERR-DIA-001`, `ERR-QMS-001`)
  need _remedy_ text, not just a title — the remedy is what makes them worth
  having.
- **Tenant-defined state codes have no translation and cannot have one at build
  time.** Needed: translate known platform codes; humanise an unknown code from
  the code itself. Never render a missing-key error for data the tenant
  legitimately created.
- **RTL**: `dir` is set once on `<html>`; use logical utilities (`ps-*`,
  `border-e`, `start-*`). Error banners, checklists and timelines are all
  direction-sensitive layouts — check them in `ar` as well as `en`.
- **Board filters must live in the query string**, because `LocaleSwitcher`'s
  `withCarriedQuery` preserves the query across a language change and nothing
  preserves component state.

---

## 9. The activity timeline

Four history surfaces exist, all keyset-paginated, all newest-first:

| surface           | endpoint                                  | permission                                        |
| ----------------- | ----------------------------------------- | ------------------------------------------------- |
| work order        | `GET /work-orders/{id}/history`           | `wo.work_order.read`                              |
| job               | `GET /jobs/{jobId}/history`               | `wo.work_order.read` (**not** a job or tech code) |
| diagnostic report | `GET /inspections/{id}/history`           | `dia.diagnostic.read`                             |
| QC                | `qms.qc_status_history` via the QC detail | `qms.quality_control.read`                        |

Each returns `{origin: {…}, transitions: […]}` — an origin record plus the
transition list, with `from_state`, `to_state`, `reason`, `correlation_id`,
`actor_id` and `occurred_at`.

Design constraints:

- **`actor_id` is an id.** There is no user-directory read in scope to resolve
  it to a name. Render the id, or render "a user", but do not invent a name.
- **These are four separate reads with three different permissions.** A unified
  "activity" tab must degrade per-source, showing what the caller may see.
- **There is no timeline component** in `apps/web` — the word appears only in
  docblock prose. Build one, or render history through `DataTable` +
  `CursorPager`.
- **Do not merge the four into one client-side stream and claim completeness.**
  Each is independently paginated; interleaving pages produces a list that is
  ordered but not complete, which is the P1-28 round-two defect in a new
  costume. If they are merged, use the `read-completeness` helpers and label the
  result honestly.
- `shared.status_history` exists and **is not used** by these schemas. Do not
  build against it.
