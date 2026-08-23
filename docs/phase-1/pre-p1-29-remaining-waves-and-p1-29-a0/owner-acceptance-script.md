# Owner acceptance script — PRE-P1-29 and P1-29

**A script the Owner can run in Chrome without developer knowledge.** Each step says what to do,
what to expect, and — where it matters — what a _pass_ looks like when the expected outcome is a
refusal.

**Nothing here is marked PASS.** This is the script, not a result. Acceptance is recorded only by
an explicit written `OWNER ACCEPTANCE: PASS`, and silence is never a Pass.

---

## Before you begin — four preconditions, all hard

1. **A production build.** Never `next dev`. A development server compiles route bundles on first
   request while the API's authenticator is a module-level singleton installed as a side effect, so
   one valid token answered 200 on one route and 401 on two others on the same checkout, and a
   second process refused a different subset. Failures on a dev server are not defects and must not
   be recorded as any.
2. **A provisioned tenant, a user, and roles.** `iam.roles`, `iam.role_permissions`,
   `iam.role_grants`, `iam.grant_scopes`, `iam.user_accounts` and `org.tenants` all hold **zero
   rows** today. Until PRE-P1-29 Wave B7 provides the bootstrap — or a developer runs a controlled
   loopback — **no step below can be attempted**.
3. **At least one technician profile.** A production tenant has no supported means of acquiring
   one; that is `BE-9`. Steps 12–17 cannot run without it.
4. **Do not run `supabase db reset`** at any point. It destroys the acceptance environment, and the
   container is shared across worktrees.

If a precondition is unmet, stop and record which. An acceptance run against a half-provisioned
environment produces findings about the environment, not about the product.

---

## Part 1 — Sign in and workspace context

| #   | do this                                                         | expect                                                                                                                                                                                                                   |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Open the application. Sign in with **email and password only**. | You are signed in. **You are asked for no workspace, company, tenant or identifier of any kind.** Being asked for one is a failure of P-2.                                                                               |
| 2   | Look at the language switcher. Switch to Arabic and back.       | The whole interface flips to right-to-left and back. Your place in the page is kept.                                                                                                                                     |
| 3   | Note whether you were offered a choice of workspace.            | Today: **you will not be.** One identity resolves to one tenant. When Wave D lands, an operator with several memberships should see a **human-readable chooser with names, never identifiers**.                          |
| 4   | Open any screen that asks for a company or branch.              | **Today this is a known breach**: the selector's labels are raw identifiers and, for an unrestricted operator, a free-text field asking you to type one. Record it. It is `AMB-48`, and it is what P-1 exists to forbid. |

## Part 2 — The work queue

| #   | do this                                       | expect                                                                                                                               |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 5   | Open the work-order queue.                    | A list for one branch. If you see nothing, the empty state should tell you work orders arrive from reception and offer a link there. |
| 6   | Look for a "create work order" button.        | **There is none, and that is correct.** Work orders are created only by converting a reception visit.                                |
| 7   | Filter by state and by date. Switch language. | The filters survive the language switch — they live in the address bar.                                                              |
| 8   | Page to the second page, then back.           | Paging works and nothing double-counts.                                                                                              |

## Part 3 — Customer and vehicle context

| #   | do this                                                 | expect                                                                                                                                                                                 |
| --- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9   | Open one work order. Look for the customer.             | **Today: absent.** This is `BE-3`. When it lands, the customer should be visible **without any extra permission** and should be correct for both an appointment booking and a walk-in. |
| 10  | Look for the vehicle.                                   | Present.                                                                                                                                                                               |
| 11  | Look for where the job came from — the reception visit. | Present as a reference.                                                                                                                                                                |

## Part 4 — Assignment

| #   | do this                                                                | expect                                                                                                       |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 12  | Add a job to the work order.                                           | It appears in the jobs list in state `planned`.                                                              |
| 13  | Assign a technician. Note that you must give a **time window**.        | A list of available technicians for that window. It is a window, not a roster, and the screen should say so. |
| 14  | Try assigning a technician who is not eligible.                        | **Refused, and the refusal names the candidate, not the form.** Returning you to the picker is the pass.     |
| 15  | Reassign to someone else, then end an assignment without replacing it. | Three separate controls, three separate outcomes.                                                            |

## Part 5 — The technician

| #   | do this                                         | expect                                                                                                                                                                                                                        |
| --- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 16  | Sign in as the technician. Find their own work. | **Today: they cannot.** This is `BE-2` (and `BE-9` before it). Until then a supervisor must navigate to them. If any screen lets a technician _pick themselves from a list_, that is a defect, not a workaround.              |
| 17  | Start the job.                                  | Two things happen: the job moves to in progress **and** the clock starts. If only one happens, the screen must say which and offer to finish the other.                                                                       |
| 18  | Pause with a reason, then resume.               | The clock stops, then restarts. **The dangerous case to watch for:** the clock stops but the job stays in progress. If that happens the screen must say so loudly — silently losing time is the worst outcome in this script. |
| 19  | Reload the browser mid-pause.                   | Whatever state you were in survives the reload. A recovery that only lives in the page is no recovery.                                                                                                                        |
| 20  | Complete the job.                               | Terminal.                                                                                                                                                                                                                     |

## Part 6 — Diagnostics

| #   | do this                                                                               | expect                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 21  | Try to start an inspection on a job.                                                  | **Today: impossible.** No inspection template exists and nothing can create one — `BE-4`. The screen must say that plainly and must not show an invented "standard inspection". |
| 22  | _(after `BE-4`)_ As an administrator, create a template, add items, publish it.       | Published versions freeze. Try to edit an item afterwards — **refused, and that is the pass.**                                                                                  |
| 23  | _(after `BE-4`)_ As a technician, open an inspection against it and record a finding. | The finding is recorded. **Try to edit it afterwards: you cannot, permanently.** The screen must have warned you before you submitted.                                          |
| 24  | _(after `BE-4`)_ Complete the inspection with a mandatory item unanswered.            | Refused, **and the refusal lists every unanswered item**, not just the fact of incompleteness.                                                                                  |

## Part 7 — Parts and approvals

| #   | do this                                                                  | expect                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 25  | Record a required part.                                                  | Recorded. Note there is **no fulfilment state to track** — that is inventory's, and this screen must not imply otherwise.                                                         |
| 26  | Raise an additional-work request and mark it required.                   | Three separate facts visible: required (technical), pending (commercial), and unfulfilled (execution).                                                                            |
| 27  | Try to start the job that raised it.                                     | **Refused, and the refusal explains that the customer has not authorised the work.** This is a pass. Better still: the button should already have been disabled with that reason. |
| 28  | Record the customer's decision, with the channel and what was presented. | Recorded. Now the job can start.                                                                                                                                                  |

## Part 8 — Quality and closure

| #   | do this                                                   | expect                                                                                                                                                                      |
| --- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 29  | Move the work order to QC.                                | Jobs, labour and additional work all freeze. The screen should show them frozen, not merely refuse later.                                                                   |
| 30  | Open a quality-control record.                            | It opens **with no checks to perform** — the check catalogue is empty. Expected, not a defect, and the screen must say so.                                                  |
| 31  | Try to close the work order with the clock still running. | Refused, **with the full list of what is blocking**, not one blocker at a time.                                                                                             |
| 32  | Clear the blockers and close.                             | Closed.                                                                                                                                                                     |
| 33  | Try to reopen it.                                         | **You get a confirmation that your attempt was recorded and refused.** That is the designed behaviour and the one place in the product where a success response means "no". |
| 34  | Create a rework case against the closed order.            | A new work order, marked as rework, linked to the original.                                                                                                                 |

## Part 9 — History, permissions and isolation

| #   | do this                                                                                      | expect                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 35  | Open the work order's history.                                                               | Every transition, with a reason where one was required. **Actors appear as identifiers, not names** — that is honest, not broken. |
| 36  | Sign in as a user **without** technician-read permission. Open a work order.                 | You see the order and its jobs. **You do not see who worked on them, and the page does not break.**                               |
| 37  | Sign in as a user with read but not close permission.                                        | Transition actions present; the close action **absent**.                                                                          |
| 38  | Sign in as a user whose branch is different. Try to open a work order from the first branch. | Refused. You should not be able to tell whether it exists.                                                                        |
| 39  | Do the whole of Part 2 in Arabic.                                                            | Everything reads correctly right-to-left; nothing overflows; the filters still work.                                              |

## Part 10 — Subscription

| #   | do this                                                          | expect                                                                                                                                                                                                                                                                                    |
| --- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 40  | Ask for the tenant's subscription to be suspended, then sign in. | **Today: you sign in exactly as before and nothing is blocked.** That is a real, recorded gap — nothing reads tenant status at authentication and no operation declares a feature flag. Record it; do not treat a blocked-looking screen as evidence of a control, because there is none. |
| 41  | _(after the enforcement design lands)_ Repeat.                   | Application usage blocked, **data preserved**, the blocked state explained in a sentence that is different from "you are not permitted", and a Company Owner able to see why. Reactivation restores access without data loss.                                                             |

---

## Recording the result

For each step: **as expected**, **not as expected**, or **could not run** — with the precondition
that blocked it. A step whose expected outcome is a refusal is a **pass** when it refuses.

Steps 9, 16, 21–24 and 40 are expected to fail today. They are in the script because P1-29 does not
close without them, and because an acceptance run that omits them would misrepresent the phase as
complete.

Finish with an explicit written verdict. **Silence is not a Pass.**
