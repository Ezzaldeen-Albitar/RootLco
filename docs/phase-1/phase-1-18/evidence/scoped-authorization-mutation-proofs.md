# P1-18 — Scoped-authorization mutation proofs

Six mutations against the P1-18-A-01 remediation. Each one weakens the
protection in a way a reviewer could plausibly miss, and each is required to be
killed by the assertion that exists to prove that specific property — not by a
broad suite failing for an unrelated reason.

**Protocol.** Every mutation ran from a clean worktree. The exact original bytes
were copied to a scratch location outside the repository first, one narrow edit
was applied, only the targeted test was run, the edit was reverted by its
inverse, the restored file was compared to the backup by MD5, and the targeted
test was re-run green before the next mutation began. No `git reset --hard`,
`git clean -fd`, `git checkout HEAD --` or `git restore` was used at any point.
No mutated code was committed.

Branch `fix/p1-18-scoped-authorization-containment`, mutations run at
`68255af`. PostgreSQL 17.6.1 (`supabase_db_RootLco`), serial, no other DB or
backend Vitest process running.

| ID  | Property under test                             | Killed by                                                 | Restored  |
| --- | ----------------------------------------------- | --------------------------------------------------------- | --------- |
| M1  | reschedule re-authorizes after the lock         | containment (behavioural)                                 | MD5 match |
| M2  | condition-evidence re-authorizes after the lock | containment (behavioural)                                 | MD5 match |
| M3  | approval re-authorizes after the lock           | containment (behavioural)                                 | MD5 match |
| M4  | conversion re-authorizes after the lock         | containment (behavioural)                                 | MD5 match |
| M5  | the target is the LOCKED row, not the caller    | foundation (structural) **and** containment (behavioural) | MD5 match |
| M6  | a route runs under its OWN declaration          | foundation (structural)                                   | MD5 match |

---

## M1 — appointment reschedule

- **File and function:** `src/app/api/v1/appointments/[appointmentId]/reschedule/route.ts`, the `POST` handler.
- **Exact weakened behaviour:** the `authorizeScope` argument threaded into
  `appointments.reschedule` was replaced with `async () => {}`, so the locked
  appointment's branch was never re-evaluated. The pre-handler check still ran
  and still passed, because with no target it evaluates scope-blind
  `iam.has_permission`.
- **Targeted test file:** `tests/backend/p1-18-scope-containment.test.ts`
- **Targeted test names:**
  - `apt.appointment-reschedule: scoped-authorization containment > refuses the permission-union escalation and leaves nothing behind`
  - `apt.appointment-reschedule: scoped-authorization containment > admits a company-wide principal inside its company and refuses it outside`
- **Observed failure:** `expected 200 to be 403` as `fx_p1_18_sc_union`, and
  `expected 200 to be 403` as `fx_p1_18_sc_company_c`. The union principal —
  permission in B1, unrelated grant in B2 — successfully rescheduled a B2
  appointment. 2 failed, 5 passed, 67 skipped.
- **Restoration confirmation:** MD5 `7287df93174225411c97d1383b63b3fa` matches
  the pre-mutation backup byte for byte; `authorizeScope` present twice;
  `git status --short` empty, `git diff --check` exit 0.
- **Post-restoration result:** 7 passed, 67 skipped.

## M2 — reception condition evidence

- **File and function:** `src/app/api/v1/receptions/[receptionId]/condition-evidence/route.ts`, the `POST` handler.
- **Exact weakened behaviour:** `authorizeScope` replaced with `async () => {}`,
  so `requireRecordableVisit` re-authorized nothing.
- **Targeted test file:** `tests/backend/p1-18-scope-containment.test.ts`
- **Targeted test names:**
  - `rec.reception-condition-evidence: … > refuses the permission-union escalation and leaves nothing behind`
  - `rec.reception-condition-evidence: … > admits a company-wide principal inside its company and refuses it outside`
- **Observed failure:** `expected 201 to be 403` for both principals. A `201`
  here means the row was actually written: the union principal created a
  `rec.visual_inspections` record on a B2 reception it holds no capability for.
- **Restoration confirmation:** MD5 `f2a8a84118964b44aec9d1faee5af76a` matches;
  `git status --short` empty, `git diff --check` exit 0.
- **Post-restoration result:** 7 passed, 67 skipped.

## M3 — reception approval

- **File and function:** `src/app/api/v1/receptions/[receptionId]/approve/route.ts`, the `POST` handler.
- **Exact weakened behaviour:** `authorizeScope` replaced with `async () => {}`,
  so `requireVisit` re-authorized nothing before the lifecycle transition.
- **Targeted test file:** `tests/backend/p1-18-scope-containment.test.ts`
- **Targeted test names:**
  - `rec.reception-approve: … > refuses the permission-union escalation and leaves nothing behind`
  - `rec.reception-approve: … > admits a company-wide principal inside its company and refuses it outside`
- **Observed failure:** `expected 200 to be 403` for both. The approval
  committed: reception status, `record_version`, the status-history row, the
  audit record and the `reception.approved` outbox envelope all moved, which is
  what the probe equality in `expectRefusal` compares.
- **Restoration confirmation:** MD5 `b25e1475a736b28e95535d3a177e0eb0` matches;
  `git status --short` empty, `git diff --check` exit 0.
- **Post-restoration result:** 7 passed, 67 skipped.

## M4 — work-order conversion

- **File and function:** `src/app/api/v1/receptions/[receptionId]/convert-to-work-order/route.ts`, the `POST` handler.
- **Exact weakened behaviour:** `authorizeScope` replaced with `async () => {}`,
  so `convertToWorkOrder` authorized nothing after `lockVisit`.
- **Targeted test file:** `tests/backend/p1-18-scope-containment.test.ts`
- **Targeted test names:**
  - `rec.reception-convert-to-work-order: … > refuses the permission-union escalation and leaves nothing behind`
  - `rec.reception-convert-to-work-order: … > admits a company-wide principal inside its company and refuses it outside`
- **Observed failure:** `expected 200 to be 403` for both. An unauthorized
  work order and its reception linkage were created.
- **Restoration confirmation:** MD5 `c170460a986e33efb0e12c8ed14c1e13` matches;
  `git status --short` empty, `git diff --check` exit 0.
- **Post-restoration result:** 7 passed, 67 skipped.

## M5 — caller scope substituted for the locked row

- **File and function:** `src/modules/reception/application/reception-service.ts`, `requireVisit`.
- **Exact weakened behaviour:** the target changed from the locked row's own
  scope to the CALLER's resolved scope —
  `{ companyId: db.context.companyIds[0] ?? visit.companyId, branchId: db.context.branchIds[0] ?? visit.branchId }`.
  This is the subtle one: the call still reads as scoped re-authorization, still
  runs after the lock, still uses `iam.has_permission_in_scope`. It simply asks
  the wrong question — "may this caller act somewhere it already reaches?"
  instead of "may this caller act HERE?" — and `app.branch_ids` is the union of
  every grant, so the answer is yes for any principal holding the permission
  anywhere.
- **Targeted test files:** `tests/foundation/p1-18-scoped-authorization.test.ts` and `tests/backend/p1-18-scope-containment.test.ts`
- **Targeted test names:**
  - `F10 · structural completeness of the locked-row path > src/modules/reception/application/reception-service.ts authorizes against the LOCKED row own scope`
  - `rec.reception-party-role: … > refuses the permission-union escalation and leaves nothing behind`
  - `rec.reception-party-role: … > admits a company-wide principal inside its company and refuses it outside`
- **Observed failure:** structural — `expected null not to be null`: the
  locked-row regex requires `companyId` and `branchId` to come from the SAME
  row variable, and they no longer did. Behavioural — `expected 201 to be 403`
  for both principals; the union principal wrote a party role in B2.
- **Restoration confirmation:** MD5 `8ed9c51300e16ab5f6a80dad2f95d573` matches;
  `git status --short` empty, `git diff --check` exit 0.
- **Post-restoration result:** foundation 69 passed; party-role 7 passed, 67 skipped.

## M6 — sibling operation metadata bound at the route boundary

- **File and function:** `src/app/api/v1/receptions/[receptionId]/party-roles/route.ts`, the `POST` handler.
- **Exact weakened behaviour:** `handleOperation` was given
  `RECEPTION_AUTHORIZATION_OPERATION` instead of
  `RECEPTION_PARTY_ROLE_OPERATION` (imported from the sibling route). Because
  `authorizeScope` re-runs whichever declaration the handler was given, the
  party-role command then evaluated `rec.reception.authorization.verify` and
  never evaluated `rec.reception.party.manage` at all. The two codes are
  distinct, so a principal holding only the authorization capability could
  assign party roles.
- **Targeted test file:** `tests/foundation/p1-18-scoped-authorization.test.ts`
- **Targeted test name:**
  `F10 · structural completeness of the locked-row path > rec.reception-party-role runs under its OWN declaration`
- **Observed failure:** `expected '…' to contain 'handleOperation(\n    RECEPTION_PARTY…'`.
  1 failed, 9 passed, 59 skipped.
- **Restoration confirmation:** MD5 `f7ee4439592dd60ba4b295f3a9d5b3f5` matches;
  `git status --short` empty, `git diff --check` exit 0.
- **Post-restoration result:** foundation 69 passed.

### A gap M6 exposed, recorded rather than glossed

The **authorization coverage gate did not catch M6**. With the substitution in
place `npm run validate:authorization-coverage` still reported
`OK: every operation is guarded and every route is registered` and exited 0.
That gate checks that every operation declares permissions and that every route
is registered; it does not check that a route's `handleOperation` call binds
that route's OWN declaration. The containment suite cannot see it either,
because every permission-bearing fixture principal holds both sibling codes, so
both bindings produce identical allow/deny outcomes at runtime.

M6 is therefore killed by exactly one assertion in the repository, and that
assertion was added for it: `%s runs under its OWN declaration`, together with
`%s declares exactly one operation` and the rule that no route may hand-roll
`requirePermissions` or `requireScopedPermissions`. Without those three, this
mutation would have survived every gate the project had.

---

## Scope of these proofs

These six cover the deferred scoped-authorization path and nothing else. They
do not speak to the rest of P1-18, and this document is not a substitute for the
full validation battery, the mutation coverage of any other phase, or the clean
room — none of which has been run at the time of writing. The owner gate remains
`Decision: Pending`.
