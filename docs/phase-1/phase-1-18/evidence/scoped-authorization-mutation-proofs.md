# P1-18 — Scoped-authorization mutation proofs

Six mutations against the P1-18-A-01 remediation. Each weakens the protection in
a way a reviewer could plausibly miss, and each is required to be killed by an
assertion that exists to prove that specific property.

## Candidate

```
Candidate SHA   c6a21f19eb1c5ce1ed8b6465ae1f8f98e8f889ec
Branch          fix/p1-18-final-gate-evidence-remediation
Based on        origin/develop = 7caafbee0faf17183a19ca76f85ebc16d8e85c54
                (the protected merge of PR #79)
Database        PostgreSQL 17.6.1 (supabase_db_RootLco), serial, no other
                DB/backend Vitest process running
```

This document is committed one commit after the runs it records, at `aedfcef`,
whose **only** change is this file — the executable-path diff against `c6a21f1`
is empty. That is stated here rather than left to inference, because an unstated
tree delta is exactly what invalidated the previous set.

**These proofs were re-run at this candidate, and that matters.** The previous
set ran at `68255af`, five commits before the tree that was actually merged. The
intervening candidate changed `src/server/auth/authorization.ts`,
`src/modules/reception/application/appointment-service.ts` and
`reception-service.ts` — the module every kill depends on, M1's choke point, and
the file containing M5's mutated `requireVisit` — and the record neither stated
the delta nor argued the results carried forward. It also still cited
`appointment-service.ts:393` for a mapper that had moved to line 403. Stale line
numbers are how a record stops being checkable, so this version anchors on
function names and states its own candidate SHA.

## Protocol

Every mutation ran from a clean worktree. The exact original bytes were copied
outside the repository first, one narrow edit was applied, only the targeted
test was run, the edit was reverted by its inverse, the restored file was
compared to the backup by MD5, and the targeted test was re-run green before the
next mutation began. No `git reset --hard`, `git clean -fd`,
`git checkout HEAD --` or `git restore` at any point. No mutated code was
committed.

| ID  | Property under test                             | Killed by                                                       | Restored        |
| --- | ----------------------------------------------- | --------------------------------------------------------------- | --------------- |
| M1  | reschedule re-authorizes after the lock         | containment (behavioural)                                       | MD5 `7287df93…` |
| M2  | condition-evidence re-authorizes after the lock | containment (behavioural)                                       | MD5 `f2a8a841…` |
| M3  | approval re-authorizes after the lock           | containment (behavioural)                                       | MD5 `b25e1475…` |
| M4  | conversion re-authorizes after the lock         | containment (behavioural)                                       | MD5 `c170460a…` |
| M5  | the target is the LOCKED row, not the caller    | foundation (structural) **and** containment (behavioural)       | MD5 `a663815e…` |
| M6  | a route runs under its OWN declaration          | foundation (structural) **and** reception-parties (behavioural) | MD5 `f7ee4439…` |

---

## M1 — appointment reschedule

- **File and function:** `appointments/[appointmentId]/reschedule/route.ts`, the `POST` handler.
- **Weakened behaviour:** the `authorizeScope` argument threaded into
  `appointments.reschedule` replaced with `async () => {}`. The pre-handler check
  still ran and still passed, because with no target it evaluates scope-blind
  `iam.has_permission`.
- **Targeted test:** `tests/backend/p1-18-scope-containment.test.ts`
  — `apt.appointment-reschedule … refuses the permission-union escalation and leaves nothing behind`
  and `… admits a company-wide principal inside its company and refuses it outside`.
- **Observed failure:** `expected 200 to be 403` as `fx_p1_18_sc_union`, and again
  as `fx_p1_18_sc_company_c`. 2 failed, 5 passed, 69 skipped.
- **Restored:** MD5 match; `git status --short` empty.

## M2 — reception condition evidence

- **File and function:** `receptions/[receptionId]/condition-evidence/route.ts`, the `POST` handler.
- **Weakened behaviour:** `authorizeScope` replaced with `async () => {}`, so
  `requireRecordableVisit` re-authorized nothing.
- **Targeted test:** containment — `rec.reception-condition-evidence` union
  escalation and company cases.
- **Observed failure:** `expected 201 to be 403` for both. A `201` here means the
  row was written: a `rec.visual_inspections` record on a B2 reception the caller
  holds no capability for.
- **Restored:** MD5 match.

## M3 — reception approval

- **File and function:** `receptions/[receptionId]/approve/route.ts`, the `POST` handler.
- **Weakened behaviour:** `authorizeScope` replaced with `async () => {}`, so
  `requireVisit` re-authorized nothing before the lifecycle transition.
- **Targeted test:** containment — `rec.reception-approve` union and company cases.
- **Observed failure:** `expected 200 to be 403` for both. The approval
  committed: status, `record_version`, status history, audit and the
  `reception.approved` envelope all moved.
- **Restored:** MD5 match.

## M4 — work-order conversion

- **File and function:** `receptions/[receptionId]/convert-to-work-order/route.ts`, the `POST` handler.
- **Weakened behaviour:** `authorizeScope` replaced with `async () => {}`, so
  `convertToWorkOrder` authorized nothing after `lockVisit`.
- **Targeted test:** containment — `rec.reception-convert-to-work-order` union and
  company cases.
- **Observed failure:** `expected 200 to be 403` for both. An unauthorized work
  order and its reception linkage were created.
- **Restored:** MD5 match.

## M5 — caller scope substituted for the locked row

- **File and function:** `reception-service.ts`, `requireVisit`.
- **Weakened behaviour:** target changed from the locked row's own scope to the
  CALLER's resolved scope — `db.context.companyIds[0] ?? visit.companyId`,
  `db.context.branchIds[0] ?? visit.branchId`. The subtle one: still after the
  lock, still `iam.has_permission_in_scope`, still a scoped target. It only asks
  the wrong question — "may this caller act somewhere it already reaches?"
  instead of "may it act HERE?" — and `app.branch_ids` is the union of every
  grant, so the answer is yes for anyone holding the permission anywhere.
- **Targeted tests:** foundation
  `F10 … reception-service.ts authorizes against the LOCKED row own scope`, and
  containment `rec.reception-party-role` union and company cases.
- **Observed failure:** structural — `expected null not to be null` (the
  locked-row regex requires both fields from the SAME row variable); behavioural
  — `expected 201 to be 403` for both principals.
- **Restored:** MD5 match.

## M6 — sibling operation metadata bound at the route boundary

- **File and function:** `receptions/[receptionId]/party-roles/route.ts`, the `POST` handler.
- **Weakened behaviour:** `handleOperation` given
  `RECEPTION_AUTHORIZATION_OPERATION` instead of
  `RECEPTION_PARTY_ROLE_OPERATION`. Because `authorizeScope` re-runs whichever
  declaration the handler was given, party-role then evaluated
  `rec.reception.authorization.verify` and never evaluated
  `rec.reception.party.manage` at all.
- **Targeted tests, both run at this candidate:**
  - foundation `F10 … rec.reception-party-role runs under its OWN declaration` →
    `expected '…' to contain 'handleOperation(\n    RECEPTION_PARTY…'`. 1 failed,
    9 passed, 72 skipped.
  - `tests/backend/p1-18-reception-parties.test.ts` —
    `refuses /party-roles to a caller holding only rec.reception.authorization.verify`
    → **`expected 201 to be 403`**. 1 failed, 15 skipped.
- **Restored:** MD5 match.

---

## What these proofs do and do not establish

**They prove attribution. They cannot prove exclusivity.** The protocol runs only
the targeted test, which is what makes a kill attributable to a named assertion —
and which therefore makes "nothing else would catch this" a conclusion the
protocol cannot support. An earlier revision of this document drew exactly that
conclusion for M6, claiming it was "killed by exactly one assertion in the
repository" and would otherwise "have survived every gate the project had". That
was false, an independent review found it, and the second kill above is the
empirical correction: **M6 is killed by at least the dedicated foundation binding
assertion and the reception-parties behavioural permission-split test.**

**The authorization coverage gate does not prove operation-identity binding.**
With M6 in place `npm run validate:authorization-coverage` reported
`OK: every operation is guarded and every route is registered` and exited 0. It
checks declaration completeness and route-to-registration reconciliation; it does
not inspect the `handleOperation` argument. Recorded as `P1-18-GATE-IDENTITY`,
and no document in this repository describes that gate as proving identity.

**Route-level threading is mutation-proved for five of the ten, not ten.** M1–M4
bypass the authorizer at the reschedule, condition-evidence, approve and convert
routes; M5 substitutes the target at `requireVisit`, which party-role rides.
**Cancel, no-show, authorization, signature and refusal were never mutated.**
Their containment rests on sharing a choke point with an operation that was —
cancel and no-show with reschedule via `requireAppointment`, authorization with
party-role via `requireVisit`, signature and refusal with condition-evidence via
`requireRecordableVisit` — and on the behavioural matrix, which exercises all
ten. That is a real argument and weaker than a mutation; the table above should
not be read as ten route-level proofs.

**No assertion discriminates the deferred authorizer's 403 from a row-policy 403.** Both map to `ERR-IAM-001`; the services' mappers sit at
`appointment-service.mapWriteFailure`, `reception-service.mapWriteFailure`,
`reception-evidence-service.mapEvidenceFailure` and
`reception-conversion-service.mapConversionFailure`. For the five mutated
operations the mutation settles it — remove the authorizer and the call succeeds.
For the other five the attribution is inferred from those policies being pure
tenant/company/branch predicates with no permission clause. Correct, but
inferred, and named here rather than implied away.
