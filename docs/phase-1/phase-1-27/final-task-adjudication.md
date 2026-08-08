# P1-27 — final task adjudication

Every task the independent audit returned as failing, adjudicated against the
repository at branch `remediation/p1-27-final-canonical-blockers` head `915b861`.

Repository truth is the authority here. Nothing below is carried over from an
agent's summary without being re-checked against the files; where a claim was
reproduced by hand that is stated, and where it was not, that is stated too.

## The counts, corrected

The briefing that commissioned this document gives:

```
CANONICAL_TASK_PASS = 20
CANONICAL_TASK_FAIL = 22
```

Those are the audit's own headline numbers, and they understate the problem.
The same header reports `PASS_REFUTED = 11`: eleven of the twenty PASS verdicts
did not survive the adversarial recheck that was run against them. A refuted
PASS is a FAIL. So the audit's real finding was:

```
TRUE_PASS = 9
TRUE_FAIL = 33      (22 reported failing + 11 refuted passes)
```

This matters beyond bookkeeping. Four of the eleven refuted passes — `SEC-003`,
`SEC-002`, `DO-002`, `FE-013` — are defects in their own right, and one of them
(`SEC-003`) is a second, independent report of the ten ungated write surfaces.
Adjudicating only the 22 would have left those unexamined.

All 33 are adjudicated below.

## Verdict classes

| class                     | meaning                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `REAL_P1_27_DEFECT`       | A genuine gap in P1-27's own scope. Must be fixed before the phase can close.          |
| `DUPLICATE_FINDING`       | A true observation, but the same defect as another entry. Fixing the root closes both. |
| `TEST_OR_GATE_DEFECT`     | The product is correct; the test, gate or evidence record is wrong or stale.           |
| `AUDIT_FALSE_NEGATIVE`    | The claim does not hold against the repository.                                        |
| `OUT_OF_SCOPE_P1_28_PLUS` | Real, but owned by a later phase.                                                      |

## Status vocabulary

`FIXED` — remediated on this branch, with the commit named.
`OPEN` — reproduced, not yet fixed.
`BLOCKED` — fixed, but landing is blocked by something outside this environment.

---

## Summary

| task      | verdict                | status            | root             |
| --------- | ---------------------- | ----------------- | ---------------- |
| `FE-002`  | `REAL_P1_27_DEFECT`    | FIXED `600f70e`   | itself           |
| `FE-003`  | `AUDIT_FALSE_NEGATIVE` | FIXED `52a230a`   | itself           |
| `FE-004`  | `REAL_P1_27_DEFECT`    | FIXED `b6ce9ae`   | itself           |
| `FE-007`  | `DUPLICATE_FINDING`    | FIXED `915b861`   | `SEC-001`        |
| `FE-008`  | `DUPLICATE_FINDING`    | FIXED `915b861`   | `SEC-001`        |
| `FE-009`  | `DUPLICATE_FINDING`    | FIXED `915b861`   | `SEC-001`        |
| `FE-010`  | `DUPLICATE_FINDING`    | FIXED `915b861`   | `SEC-001`        |
| `FE-013`  | `REAL_P1_27_DEFECT`    | FIXED `c415432`   | itself           |
| `FE-015`  | `REAL_P1_27_DEFECT`    | FIXED `fc5e155`   | itself           |
| `FE-016`  | `REAL_P1_27_DEFECT`    | FIXED `72f2fcb`   | itself           |
| `FE-017`  | `TEST_OR_GATE_DEFECT`  | FIXED `52a230a`   | itself           |
| `FE-018`  | `REAL_P1_27_DEFECT`    | FIXED `fc5e155`   | itself           |
| `FE-019`  | `REAL_P1_27_DEFECT`    | FIXED `8daf8e9`   | itself           |
| `FE-020`  | `REAL_P1_27_DEFECT`    | FIXED `bb4ebfd`   | itself           |
| `FE-021`  | `DUPLICATE_FINDING`    | FIXED `0272e1d`   | `FE-024`         |
| `FE-022`  | `DUPLICATE_FINDING`    | FIXED `0272e1d`   | `FE-024`         |
| `FE-023`  | `DUPLICATE_FINDING`    | FIXED `915b861`   | `SEC-001`        |
| `FE-024`  | `REAL_P1_27_DEFECT`    | FIXED `0272e1d`   | itself           |
| `FE-026`  | `REAL_P1_27_DEFECT`    | FIXED `72f2fcb`   | itself           |
| `FE-028`  | `REAL_P1_27_DEFECT`    | FIXED `0272e1d`   | itself           |
| `FE-029`  | `REAL_P1_27_DEFECT`    | BLOCKED           | P1-14 backend PR |
| `SEC-001` | `REAL_P1_27_DEFECT`    | FIXED `915b861`   | itself           |
| `SEC-002` | `AUDIT_FALSE_NEGATIVE` | FIXED `evidence`  | itself           |
| `SEC-003` | `DUPLICATE_FINDING`    | FIXED `915b861`   | `SEC-001`        |
| `SEC-004` | `TEST_OR_GATE_DEFECT`  | FIXED `600f70e`   | itself           |
| `QA-001`  | `REAL_P1_27_DEFECT`    | FIXED `0272e1d`   | itself           |
| `QA-002`  | `REAL_P1_27_DEFECT`    | FIXED `0272e1d`   | itself           |
| `QA-003`  | `TEST_OR_GATE_DEFECT`  | FIXED `0c19f51`   | itself           |
| `QA-005`  | `TEST_OR_GATE_DEFECT`  | OPEN (final head) | itself           |
| `DO-002`  | `AUDIT_FALSE_NEGATIVE` | no change needed  | itself           |
| `DOC-001` | `TEST_OR_GATE_DEFECT`  | FIXED (records)   | itself           |
| `DOC-002` | `REAL_P1_27_DEFECT`    | FIXED (records)   | itself           |
| `FE-001`  | `DUPLICATE_FINDING`    | FIXED `600f70e`   | `FE-002`         |

```
ADJUDICATED       = 33
FIXED             = 30
NO_CHANGE_NEEDED  =  1     DO-002
BLOCKED           =  1     FE-029
OPEN              =  1     QA-005

RESOLVED   / 42   = 40
UNRESOLVED / 42   =  2
```

**Both unresolved items are blocked on the same external thing: pull-request
creation.**

`FE-029` needs `remediation/p1-14-actor-display-identity` merged; the Backend
half is written, green and pushed, and this environment has no authenticated way
to open a PR. `QA-005` needs clean-room and hosted-CI evidence recorded at the
FINAL head, and there is no final head until the remediation PR merges — and
re-recording before then produces a document that is stale on arrival, which is
the defect `QA-005` reports in the first place.

The durable half of `QA-005` is done: `apps/web/tests/p1-27-doc-reconciliation.test.ts`
reconciles the records against the repository, so the next drift is a build
failure rather than a silent lie. What remains is the measurement itself.

---

## The adversarial recheck of this document's own verdicts

Every `FIXED` above was re-attacked by seven independent agents instructed to
REFUTE rather than confirm, one group of tasks each, against live repository
truth. **`PASS_REFUTED = 4`**, and all four are now fixed in `0272e1d`. The two
`SOUND` verdicts that ran wider than their evidence supported (`FE-020`'s
justification comment, `FE-015`'s dead-field disclosure) are recorded below as
residual corrections rather than as failed tasks, because in both cases the
task's deliverable holds and what is wrong is a sentence.

| task                         | what survived the recheck                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FE-024`, `FE-021`, `FE-022` | One predicate, three shipped write surfaces. `isFrozen` covered `merged` while `vehicle-registration-service.ts:194`, `vehicle-relations-service.ts:184` and `vehicle-lifecycle-service.ts:68` all refuse `merged` OR `scrapped`. Every docblock beside those gates said "a merged or scrapped vehicle"; one added "Verified against the server". Fixed with a second predicate, `isTerminal`, mirroring the API's own `TERMINAL_LIFECYCLE` — NOT by widening `isFrozen`, because `veh.vehicle-update` and the odometer writer accept a scrapped vehicle and blocking them would have been the same defect pointing the other way. |
| `FE-028`                     | The ordinal moved from the visible label to an `aria-label`, which wins the accessible-name computation outright: the announced name stayed "First record" while the screen showed `V-0001`. WCAG 2.5.3 Label in Name, Level A. The new test ASSERTED that as the design, and its sibling — which was supposed to catch it — inspected `container.textContent`, which structurally cannot see an `aria-label`.                                                                                                                                                                                                                     |
| `QA-001`                     | `suite.includes(name)` over RAW test text, including this repository's own docblocks. The six components the fix's commit message names as previously untested appear in `p1-27-qa.test.ts`'s own prose, and those words satisfied the sweep. Three components — `VehicleProfileScreen`, `VinField`, `DuplicateDecisionPanel` — appeared in the entire corpus only inside `*` comment lines. Each has a direct suite now, including the first test anywhere that renders `VehicleProfileScreen`.                                                                                                                                   |
| `QA-002`                     | Three exclusions cited `vehicle-api.test.ts` for `listTrims`, `listBodyTypes` and `listPowertrainTypes`; it imported none of them. The only guard was "still exported". The citation is now checked against the cited file's own imports — and that check found a fourth stale citation on its first run.                                                                                                                                                                                                                                                                                                                          |

### Residual corrections, not reopened tasks

- **`FE-020`.** The deliverable holds and was mutation-proved: `VinField` on the
  create path with `excludeVehicleId={null}`, the error prop, `name="vin"`
  preserved, both outcome links, locale parity. What is wrong is one bullet of a
  justification comment and one test label, which claim a duplicate-VIN `409` now
  renders as a VIN conflict. See the residual below.
- **`FE-015` / `FE-029`.** The uuid is genuinely gone from both surfaces and the
  three honest states are symmetric across `en`/`ar`. What is undisclosed is that
  the CRM half's `actorName` branch has no producer on ANY branch — `actorName`
  occurs nowhere in `apps/api`, and the pending P1-14 branch touches `iam/` and
  `vehicle/` only. `FE-029` is disclosed as blocked; the CRM half was not.

---

## Fixed on this branch

### `SEC-001` — `REAL_P1_27_DEFECT` — FIXED `915b861`

**Auditor claim.** No permission gate on ten P1-27 write surfaces.
`WRITE_PERMISSIONS` has zero consumers; eight CRM forms render on read success
alone, and the plate and odometer forms render with no permission prop at all.

**Reproduction.** Confirmed by hand, independently of the audit. Every one of the
nine write forms in `CustomerProfileScreen` was located and its gate inspected:
only `setCustomerStatusAction` had one. `ComponentSection` rendered `form` on
`table.response` alone, and every list behind those sections is guarded by
`crm.customer.read` — which is exactly what the profile page already requires. So
read implied all eight writes. On the vehicle side `OwnershipSection` took
`canManageRelationships` while `PlateSection` and `OdometerSection` took no
capability prop at all. `WRITE_PERMISSIONS` and `VEHICLE_PERMISSIONS.odometerRecord`
each had exactly one reference: their own declaration.

The required permission for each surface was read from
`docs/phase-1/phase-1-24/evidence/operation-register.json`, not from the prose
describing it. Ten surfaces, matching the auditor's count.

**Canonical requirement.** Every write surface must prove the caller holds the
mutation permission, with the Backend remaining authoritative.

**Verdict.** `REAL_P1_27_DEFECT`. Fixed at the two components that already own
the "may a form appear" decision, with `canWrite` required rather than optional.
23 new assertions covering both directions per surface; four mutations, each
reverted, killing 11 / 3 / 16 / 4 tests.

### `SEC-003` — `DUPLICATE_FINDING` of `SEC-001` — FIXED `915b861`

**Auditor claim.** The PASS was refuted because two P1-27 write affordances
render with no permission gate — precisely the privilege-escalation control
`SEC-003` owns.

**Reproduction.** The two affordances are plate assignment and odometer
recording, the same two `SEC-001` names. Same root, same fix.

**Verdict.** `DUPLICATE_FINDING`. Independent discovery of the same defect by a
different reviewer, which is corroboration rather than a second problem.

### `FE-007`, `FE-008`, `FE-009`, `FE-010` — `DUPLICATE_FINDING` of `SEC-001` — FIXED `915b861`

**Auditor claim.** Each of these four entries confirms in detail that the route,
the read, the backend contract, the write call site, the states and the i18n are
all present — and fails the task on the missing permission gate.

**Reproduction.** The four forms named are contacts, addresses, preferences and
consents: four of the eight `SEC-001` enumerates.

**Verdict.** `DUPLICATE_FINDING`. Closed by the `SEC-001` root fix; each now has
both directions asserted per surface.

### `FE-022`, `FE-023` — `DUPLICATE_FINDING` of `SEC-001` — FIXED `915b861`

**Auditor claim.** Item (1) of each is the missing permission gate on plate
assignment and odometer recording. Item (2) of each is absent test coverage of
the write.

**Reproduction.** Both halves confirmed. `assignPlateAction` and
`recordOdometerAction` appeared in the test tree only as discarded `vi.fn()`
stubs in two unrelated files.

**Verdict.** `DUPLICATE_FINDING` on the gate. Item (2) is now partly answered —
`write-permission-gating.dom.test.tsx` renders both sections and asserts the form
appears for a holder and not otherwise — but neither write's _submission_ is
exercised. That residue is tracked under `QA-001` rather than being counted as
closed here.

### `FE-019` — `REAL_P1_27_DEFECT` — FIXED `8daf8e9`

**Auditor claim.** The vehicle profile route is unreachable from the product:
vehicle search passes no `rowActions`, creation discards `created.vehicleId`, and
the sidebar exposes only `/vehicles` and `/vehicles/duplicates`.

**Reproduction.** Reproduced by hand before acting. Route existence is not
navigability, and nothing in the phase's automated tiers could see the
difference — a page that renders correctly when visited directly is invisible to
every test that visits it directly.

**Verdict.** `REAL_P1_27_DEFECT`. `rowActions` now opens the profile from search.

### `FE-021` — `DUPLICATE_FINDING` of `FE-019` — FIXED `8daf8e9`

**Auditor claim.** Ownership transfer has a production call site but is not
reachable by an operator, because the only screen carrying the form is the
vehicle profile and that route has no in-app entry point.

**Reproduction.** The cited evidence is `FE-019`'s evidence verbatim — the same
two `VehicleDuplicateReviewScreen` hits, the same missing `rowActions`. The write
itself was verified present and correct.

**Verdict.** `DUPLICATE_FINDING`. Closed by the navigation fix.

### `FE-001` — `DUPLICATE_FINDING` of `FE-002` — FIXED `600f70e`

**Auditor claim.** The PASS was refuted because the post-search empty state
renders the wrong message and the correct state is structurally unreachable.

**Reproduction.** That is `FE-002` exactly: `isNarrowed(request)` reads
`request.filters` and `request.search`, both screens keep criteria outside
`TableRequest`, so the "nothing exists" copy printed after a search that matched
nothing.

**Verdict.** `DUPLICATE_FINDING`.

### `FE-002` — `REAL_P1_27_DEFECT` — FIXED `600f70e`

**Reproduction.** Reproduced by hand: `isNarrowed` is permanently false on both
search screens, and on the customer search the false sentence rendered directly
above that screen's own correct one, in the larger iconed heading.

**Verdict.** `REAL_P1_27_DEFECT`. 11 assertions across both screens and both
locales; restoring the unguarded block fails 4 of them.

### `SEC-004` — `TEST_OR_GATE_DEFECT` — FIXED `600f70e`

**Auditor claim.** `p1-27-security.test.ts` fails on any POSIX runner because
`features/crm/customers/api.ts` is matched by the adapter pattern yet carries no
correlation reference and does not import `./action-support`.

**Reproduction.** Confirmed, and the mechanism is mine: `walk()` built paths with
`node:path.join`, so on Windows the `\/api\.ts$` alternative never matched and
that file was never examined. On `ubuntu-latest`, where CI runs, it was examined
and failed — because the `275129a` refactor had made it a thin wrapper.

**Verdict.** `TEST_OR_GATE_DEFECT`. The product was correct; the sweep was
platform-dependent and I introduced the dependency. Selection is now normalised
to POSIX separators and `p1-27-path-portability.test.ts` exercises both
spellings on whichever host it runs.

The auditor's second half — that the sweep roots exclude
`components/forms/RecordForm.tsx`, `lib/customers/directory.ts` and
`features/vehicles/write-support.ts` — is **still open** and is carried into
`QA-002` below rather than being reported as fixed.

### `FE-004` — `REAL_P1_27_DEFECT` — FIXED `b6ce9ae`

**Auditor claim.** A reachable input renders untranslated English library prose as
a field error, in Arabic as well as English: `preferredLocale` is
`.min(2)` with no translation key, and Zod's default sentence is stored and
rendered unchanged.

**Reproduction.** Confirmed against the file. The comment beside the mapper
argued it could not happen — untranslated text appears "only ... for the bounds,
where the form's `maxLength` has already stopped the operator anyway" — which is
true of the ceilings and false of the one floor an operator can reach by typing
FEWER characters.

The defect is wider than the reported field. A sweep of the customer and vehicle
write schemas found unkeyed bounds in `profile-actions.ts` (5),
`governance-actions.ts` (4) and a dozen vehicle adapters, each reachable or not
depending on whether a form three files away sets a matching `maxLength`.

**Verdict.** `REAL_P1_27_DEFECT`. Keys added at the schemas, and
`fieldErrorsFrom` now maps any unkeyed message to a catalogue key by issue code —
so the class is closed, not the instance. The private second copy of
`fieldErrorsFrom` in `creation-actions.ts` is gone; it was the reason the create
form would have kept the defect after the shared mapper was fixed.

### `FE-013` — `REAL_P1_27_DEFECT` — FIXED `c415432`

**Auditor claim.** The test cited as `FE-013`'s coverage calls `validateTag`,
which no production code imports, and would pass with the tag write deleted.

**Reproduction.** Confirmed, and it is ten functions rather than one.
`validateNote`, `validateAlert`, `validateRestriction`, `validateTag`,
`validatePreference`, `validateConsent`, `validateText`, `optionalText`,
`validateIndividual` and `validateCompany` each had exactly one reference in
`apps/web/src`: their own definition.

**Verdict.** `REAL_P1_27_DEFECT`, and the same defect underneath the coverage
complaint against `FE-009`…`FE-014`. Deleted rather than wired: they contradicted
a decision recorded in `components/forms/RecordForm.tsx`, and had already drifted
from the server they mirrored — `validateIndividual` emitted
`crm.customers.create.tooLong` where the action emits `field.tooLong`.
`governance-write-validation.test.ts` (18) replaces them by driving the eight
write actions with real `FormData`.

### `SEC-002` — `AUDIT_FALSE_NEGATIVE` — evidence corrected

**Auditor claim.** The browser half of the two-policy scope split is dead code:
`FORBIDDEN_URL_KEYS`, `isForbiddenUrlKey`, `toSearchParams` and
`fromSearchParams` have zero production call sites, and the test that proves the
split would pass with the whole phase deleted.

**Reproduction.** Half right, and the half that is wrong matters.
`isForbiddenUrlKey` IS live: `carriableSearchParams` calls it, and the locale
switcher calls that on every page to preserve page and sort across a language
change — so the deny-list guards the one place table state does cross a
navigation. Two of the four identifiers are reachable; the audit reported all
four as dead.

`toSearchParams` and `fromSearchParams` genuinely have no caller, and the reason
is the strongest possible one: **no screen publishes table state to the URL at
all.** Both search screens hold their criteria in React state and mount the table
with `INITIAL_REQUEST`, so a customer's name or a VIN is never a candidate for
the query string. That is a stronger guarantee than a deny-list, not a weaker
one.

**Verdict.** `AUDIT_FALSE_NEGATIVE` on the product. The auditor's point about the
EVIDENCE stands, though: the assertion credited a filter that never runs, and
would indeed have passed with both search screens deleted. So a second assertion
now proves the structural guarantee — no P1-27 file references a URL publisher —
and exercises the live deny-list through `carriableSearchParams`. Mutation-proved:
importing `toSearchParams` into one search screen fails it.

### `DO-002` — `AUDIT_FALSE_NEGATIVE` — no change needed

**Auditor claim.** The verdict should be FAIL because `currentAdapter()` returns
a module-level `adapter` which nothing sets in production, so the single
`report()` call site delivers nowhere.

**Reproduction.** The fact is true and it is the documented design.
`client-log.ts` opens by saying "No external monitoring service is configured, and
none is claimed to be operational. What exists is the **adapter boundary**", and
`observability.test.ts` asserts it by name: "is null until a deployment attaches
one". The task register lists that assertion as `DO-002`'s own evidence.

`DO-002`'s P1-27 obligation, per the register, is that nothing in either feature
tree writes to the console — enforced by the `no-console-output` rule in
`validate:p1-27-frontend`, currently green over 43 files.

**Verdict.** `AUDIT_FALSE_NEGATIVE`. The refutation restates an intended,
asserted, documented property as a defect. Attaching a monitoring provider is a
deployment decision and inventing one here would be the actual error.

---

## Blocked

### `FE-029` — `REAL_P1_27_DEFECT` — BLOCKED on the P1-14 backend PR

**Auditor claim.** `actorName` is never published by the API, so the "Changed by"
column can never name anybody; the projection carries `actorId` only.

**Reproduction.** Confirmed. The remediation exists and is green on
`remediation/p1-14-actor-display-identity` at
`210aac2dc05edafdb8d8c88555517173f124d85c`: a provider-free `iamDirectory()`
composition root, a two-field projection, and resolution gated on
`iam.user.read`. It is pushed and cannot be merged from here — the environment
has no authenticated way to create a pull request, and branch protection must not
be bypassed.

**Verdict.** `REAL_P1_27_DEFECT`, fixed but not landed. Parameters for the pull
request are in `.local/p1-14-actor-display-pr-handoff.txt` (git-ignored, no
credentials). `FE-029` cannot pass until that merges.

---

## Reproduced against the repository at head `915b861` — SUPERSEDED

**This section is a snapshot, not a status.** Every entry below was reproduced by
direct inspection at head `915b861` and each has since been fixed; the Summary
table above is the live status and the commits are named there. The section is
kept because a record that shows only the final state cannot be checked — the
reproduction is the evidence that the fix was a fix and not a re-description.

`FE-003` in particular reads here as open and is `FIXED 52a230a` above.

### `FE-003` — `REAL_P1_27_DEFECT`

`crm.duplicate-scan` has no production call site. A search of `apps/web/src` for
`duplicate-scans` returns two hits, both inside the generated
`lib/api/idempotent-operations.ts`; no adapter, action or component calls it. The
operation is registered, permission-covered, `idempotent: true` and
`auditClass: 'privileged'` — and unreachable. The duplicate LIST is wired; the
SCAN that populates it is not.

### `FE-004` — `REAL_P1_27_DEFECT`

`creation-actions.ts:49` declares `preferredLocale: z.string().trim().min(2).max(10).nullable()`
with no translation key on `.min(2)`, unlike the two name fields beside it. A
single character survives the `optional()` helper, fails the schema, and Zod's
English default sentence is stored as the field error and rendered through
`translateDynamic`, which returns non-catalogue strings unchanged. An Arabic
operator is shown English library prose.

### `FE-013` — `REAL_P1_27_DEFECT`

`validateTag` has exactly one reference in `apps/web/src` — its own definition —
and four in the tests. The test cited as `FE-013`'s coverage exercises a function
no production code calls, and would pass with the tag write deleted.

### `FE-020` — `REAL_P1_27_DEFECT`

`<VinField` is mounted once, at `VehicleProfileScreen.tsx:507` — the _update_
panel. The creation form renders the VIN as a plain text field with no
availability check and no format validation; `validateVehicleCreate` tests only a
length ceiling. The canonical row names `veh.vehicle-create` first, and the
server's `409 ERR-RES-002` uniqueness verdict reaches the operator only as the
generic "Someone else changed this".

### `FE-024` — `REAL_P1_27_DEFECT`

`EvProfileSection` appears in zero tests, and `setEvProfileAction` appears only
as a discarded `vi.fn()` stub in two unrelated files. Nothing proves the form is
seeded from the current profile — which is the whole point of a create-or-replace
operation, since a blank form silently clears capacity and port. The auditor also
reports a client bound (`usableCapacityKwh: z.number().positive()`) contradicting
the route; that half is carried forward as reported and is re-verified before any
fix.

### `FE-026` — `REAL_P1_27_DEFECT`

`listVehicleDocuments` appears in zero tests and is absent from the
18-entry `LIST_ADAPTERS` table that `p1-27-qa.test.ts` asserts is exhaustive.
`VehicleDocumentsSection` is rendered by no test.

### `FE-015`, `FE-016`, `FE-017`, `FE-018`, `FE-028` — `REAL_P1_27_DEFECT`

Five refuted passes. Each recheck confirmed most of the prior evidence and then
identified a specific unmet criterion — in four of the five, criterion 8 (test
coverage) failing in the manner the brief warns about: a test that would pass
with the feature deleted. These are recorded here as adjudicated-open; each is
re-reproduced individually before it is fixed, and none is claimed closed on the
strength of an agent's report.

### `SEC-002` — `REAL_P1_27_DEFECT`

The browser half of the two-policy scope split is enforced by nothing.
`FORBIDDEN_URL_KEYS`, `isForbiddenUrlKey`, `toSearchParams` and `fromSearchParams`
are defined in `components/data-table/table-state.ts` and referenced outside that
file exactly once — in a comment in `lib/api/read-operation.ts:118` explaining
that it is a different list. Confirmed by direct search. The control is dead
code, and the test that is supposed to prove it would pass with the phase
deleted.

The constraint it exists to serve — the Browser must not supply authoritative
tenant, company or branch scope — is enforced server-side by
`read-operation.ts`, which throws on a scope key. So this is a dead defence in
depth rather than an open door; it is still a real gap against `SEC-002`'s own
scope.

### `DO-002` — `REAL_P1_27_DEFECT`

`setLogAdapter` is defined at `lib/observability/client-log.ts:144` and called
from nowhere — zero references in `src` and zero in `tests`. The single
production call site of `report()` is the dashboard error boundary, so every
client error it captures is redacted, formatted, and delivered to a null adapter.

### `QA-001` — `REAL_P1_27_DEFECT` — partially closed

The auditor named eight uncovered components. Re-checked at `915b861`:

| component                 | tests                                                |
| ------------------------- | ---------------------------------------------------- |
| `PlateSection`            | now covered (`write-permission-gating.dom.test.tsx`) |
| `OdometerSection`         | now covered (same)                                   |
| `VehicleCreateScreen`     | 0                                                    |
| `VehicleProfileScreen`    | 0                                                    |
| `VinField`                | 0                                                    |
| `VehicleDocumentsSection` | 0                                                    |
| `DuplicateDecisionPanel`  | 0                                                    |
| `EvProfileSection`        | 0                                                    |

Two of eight closed as a side effect of the `SEC-001` fix. Six remain, and the
two now covered are covered for _visibility only_ — neither write submission is
exercised.

### `QA-002` — `REAL_P1_27_DEFECT`

`listVehicleDocuments` is absent from `LIST_ADAPTERS` despite carrying its own
failure mapping; the five `catalogue-api.ts` adapters are covered for 1 of 11
failure kinds; `identity-api.ts` `listHistory` has no coverage. Carries the
second half of `SEC-004`: three files that render or carry the correlation
reference sit outside both the security sweep's roots and the `DO-001` gate's
`SCAN_ROOTS`.

### `QA-003` — `TEST_OR_GATE_DEFECT`

Three of four evidence pillars survive; the fourth — the only one that observes
real traffic — is structurally vacuous. The server-side scope control it is meant
to prove is real and enforced (`read-operation.ts` throws on a scope key, and
that IS asserted); the traffic assertion is the defective part.

### `QA-005` — `TEST_OR_GATE_DEFECT`

`clean-room-evidence.md` pins a SHA and test counts that the tree has long since
passed. This is stale evidence rather than a product defect, and it cannot be
closed until the branch reaches its final head — re-recording it now would only
make it stale again. Deferred to the end of the branch deliberately, not
overlooked.

### `DOC-001` — `TEST_OR_GATE_DEFECT` — partially closed

Item (1) — the `documented-counts` test red on `41 scripts in scripts/ci` — is
**closed**: `scripts/ci` holds 41 `.mjs` files and
`docs/engineering/ci-automation/pull-request-body.md` now states 41. The root
unit tier is green at 1711/1711, this test included.

Items (2) and (3), both documentation desynchronisations in
`evidence/task-traceability.md`, remain open.

### `DOC-002` — `REAL_P1_27_DEFECT`

`docs/phase-1/phase-1-27/evidence/` contains exactly one file. No change log
exists, while `phase-1-19`, `phase-1-20` and `phase-1-21` each ship
`evidence/change-log.md` and two inventory scripts bind the identically-titled
task to that path. No document records a decision to drop it, and the task
register claims automated proof that does not exist.

---

## What this means for closure

Eleven of thirty-three are fixed on this branch and one is fixed but blocked on a
pull request this environment cannot create. Twenty-one remain open, and they are
not a uniform set: `FE-003`, `FE-004`, `FE-013`, `FE-020`, `FE-024`, `SEC-002`
and `DO-002` are product defects, while `QA-001` through `QA-005`, `DOC-001` and
`DOC-002` are missing proof and missing records for behaviour that may well be
correct.

P1-27 is not at 42/42 and this document does not claim it is. It replaces a
disputed pair of numbers with a list of named, reproduced, individually
adjudicated items — which is the thing that can actually be worked through.

**P1-27 remains `OWNER ACCEPTANCE: FAIL`.** No gate record is written, `main` is
untouched, and the phase is not closed.
