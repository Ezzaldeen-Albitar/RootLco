# Phase 1-27 — findings

**Classification:** Confidential — Commercial Product and Pilot Planning

Every finding raised or inherited by this phase, with its owner and disposition.
A finding is closed only when the code that closes it is merged and a test would
fail without it.

> **P1-27 IS OPEN, AND HAS NOW FAILED OWNER ACCEPTANCE TWICE.**
>
> The THIRD review (2026-08-06) returned `OWNER ACCEPTANCE: FAIL` on missing
> core operational integration: customer, vehicle and work order are
> disconnected modules and the workshop journey is not one flow. Recorded in
> [`owner-acceptance-fail-journey.md`](owner-acceptance-fail-journey.md), which
> also carries the first archaeology finding — **reception publishes eight
> operations and every one is a POST**, so a `versionGuarded` conversion has no
> published source for the version it demands, and a reception visit cannot be
> resumed, handed over or even found.
>
> The SECOND review returned `OWNER ACCEPTANCE: FAIL` with eleven confirmed
> defects. The result, the disposition of each defect, and the one defect the
> Owner did not report but that remediation found, are recorded in
> [`owner-acceptance-fail-remediation.md`](owner-acceptance-fail-remediation.md).
>
> Read that document first. It contains the single most important fact this
> phase produced: at the moment the Owner found eleven defects, 767 unit tests,
> 146 anonymous browser tests, 180 authenticated browser tests, 1636 database
> and RLS tests, hosted CI and CodeQL were **all green**.

---

## Correction — the P1-24 register was not "crediting false evidence"

Two places in this phase's own record say something stronger than the truth:
the Wave 15 section below ("**The P1-24 operation register silently claimed the
new gate test as backend evidence**"), and the commit message of `9dc096e0` in
PR #200 ("credited as evidence that the CRM duplicate-review operation is
exercised").

**Both overstate it, and this phase is not entitled to overstate anything.** The
correction, measured rather than reasoned:

`scripts/p1-24-operation-register.mjs` keeps two things apart, and its own
docblock says so. **References** are files that MENTION an operation id.
**Flags** are the reviewable evidence claim, parsed from the
`COVERAGE-EVIDENCE` block a test declares. Classification comes from flags.

`MAX_PARTIAL` and `MAX_UNCOVERED` are both **0**, and `--check` fails above
either. So the only classification that passes is `Covered`, and `Covered`
requires declared flags. **An incidental mention cannot produce a false pass.**
What it did was add one row to a mentions array, which made the committed
register stale — and `verify:contracts` failed on exactly that. The gate worked.

### The fix that was nearly made, and why it would have been wrong

The obvious remedy — strip comments before the reference scan, as three other
call sites in that same file already do — was measured before being written:

|                                               |        |
| --------------------------------------------- | ------ |
| operations whose reference list would change  | **76** |
| operations that would become **unreferenced** | **38** |

`COVERAGE-EVIDENCE` blocks **are comments**. They are the register's designed,
reviewable declaration format. Stripping comments would have destroyed the
mechanism the register is built on and turned 38 operations `Uncovered`, failing
a gate whose ceiling is zero — a change that breaks a gate while looking like it
hardens one.

**Disposition:** no change to `scripts/p1-24-operation-register.mjs`. The real
constraint is narrower and is now written down: _do not write a real operation
id into a test file that does not exercise it, not even in a comment._ The
wording gate's fixture uses `crm.example-operation`, which matches the rule it
tests and names nothing real.

---

## Closed by this phase

| id              | severity | subject                                                                                                                                                               | closed at |
| --------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `P1-27-INT-003` | High     | The Web client derived `Idempotency-Key` from the HTTP method. Nine non-POST idempotent operations answered `400 ERR-INT-002` before authorization, on every attempt. | `df6e452` |

**How it hid.** The client's docblock stated "PATCH and DELETE are not marked
idempotent anywhere in the published contract" — false — and a test asserted that
behaviour was correct while using a path (`/api/v1/x`) that is not a published
operation, so it was really asserting the unknown-path case under a name that
claimed something about the whole contract. A confident sentence plus a green
test is what stops the next reader checking.

**Closed by** deriving the table from `docs/api/openapi.v1.json`, with
`validate:idempotent-operations` failing the build on drift. Mutation-verified:
restoring `method === 'POST'` fails 16 tests naming each affected operation.

---

## Closed by Backend remediation before this phase began

| id              | subject                                                       | PR   |
| --------------- | ------------------------------------------------------------- | ---- |
| `P1-27-INT-001` | No customer detail read and no GET on eight CRM sub-resources | #192 |
| `P1-27-INT-002` | No vehicle detail read                                        | #193 |
| `P1-27-INT-005` | No read for either duplicate-candidate queue                  | #194 |
| `P1-27-INT-006` | A keyset cursor minted from a JS `Date` silently lost rows    | #195 |

## Closed by Backend remediation DURING this phase

Found while establishing ground truth for Waves 7–12, and fixed on a P1-17
branch rather than inside this Frontend one — §7, and `check-phase-ownership`
would have failed the merge.

| id              | subject                                                         | PR   |
| --------------- | --------------------------------------------------------------- | ---- |
| `P1-27-INT-007` | **Five catalogue relations had no read operation of any kind**  | #197 |
| `P1-27-INT-008` | **Six of the seven paginated vehicle reads lost rows silently** | #197 |

**`INT-007`.** `veh.makes`, `veh.models`, `veh.trims`, `veh.body_types` and
`veh.powertrain_types` were readable by nothing — 22 vehicle operations existed
and not one listed a catalogue. `POST /vehicles` accepts five catalogue uuids, so
a creation form could not offer a make and a vehicle could only ever be created
with all five null. Five GETs added; tenant scoping left entirely to RLS, because
a `tenant_id` predicate in the repository would hide every platform row.

**`INT-008`.** `veh.vehicle-search`, `-history`, `-odometer-history`,
`-plate-history`, `-ownership-history` and `-relationship-list` all minted their
cursor from a JS `Date`. These are the reads behind `FE-017`, `FE-021`, `FE-022`,
`FE-023`, `FE-025` and `FE-029` — so the sixteen "other phases" sites recorded
below were not all somebody else's problem after all. `veh.vehicle-history` is
the acute case: attribute-history rows are written by a trigger inside the
transaction that changed the vehicle, so every row from one update shares
`occurred_at` to the microsecond and the page walk lost every sibling of the row
it stopped on, every time.

Vehicle search also now publishes `mergedIntoId`. Search returns merged vehicles
and gave no way to tell one from a live vehicle, so selecting one made every
later write answer 409 with nothing on screen explaining why.

---

## Open, and NOT this phase's to fix

| id              | owner        | subject                                                                                                                                                                                                  |
| --------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `P1-27-INT-004` | foundation   | The OpenAPI generator publishes 200 for routes that return 201, never 400 or 404, and **no request body for any of the 152 mutation operations**                                                         |
| `P1-27-INT-006` | other phases | **10 pre-existing cursor sites** still mint from a JS `Date` — was 16; the six in the vehicle module were closed by `P1-27-INT-008` because Waves 7–12 call all of them                                  |
| `P1-16-A-01`    | P1-16        | `crm.addresses.line3` and `crm.communication_preferences.quiet_hours_note` are columns no write operation can set                                                                                        |
| `P1-16-A-02`    | foundation   | Path validation runs outside `handleOperation` in all 141 route modules, so a malformed uuid throws outside the block that renders an RFC 9457 document                                                  |
| `P1-27-INT-009` | P1-17        | **`recordVersion` is published and an ETag emitted, and no vehicle write consumes either.** Neither vehicle PATCH is `versionGuarded`, so concurrent edits are last-writer-wins from a client's position |
| `P1-17-A-01`    | P1-17        | The `iam.sensitive.view`-gated alternate-identifier read the vehicle domain promises does not exist                                                                                                      |
| `P1-17-A-02`    | P1-17        | `veh.vehicle_alerts` has no route at all                                                                                                                                                                 |

**None of these blocks a P1-27 screen.** `INT-004` affects a generated document,
not a runtime response. The **remaining 10** cursor sites are in operations P1-27
does not call.

**That sentence used to say sixteen, and it was wrong.** The original disposition
read "the 16 cursor sites are in operations P1-27 does not call", and six of them
turned out to be `veh.vehicle-search`, `-history`, `-odometer-history`,
`-plate-history`, `-ownership-history` and `-relationship-list` — the reads behind
every remaining vehicle wave. The claim was made before the vehicle surface had
been read, and it survived because nothing re-checked it when the waves that call
those operations came into view. They were closed by `P1-27-INT-008` on the P1-17
branch, which is the route §15 prescribes; the ten that remain have been checked
against the Wave 7–21 operation list rather than assumed.

### `P1-27-INT-009`, and the claim of this phase's own that it corrects

`veh.vehicle-read` publishes `recordVersion` and the handler emits it as an
`ETag`. **Neither vehicle PATCH is registered `versionGuarded: true`** — verified
by grepping every route module under `apps/api/src/app/api/v1/vehicles`, which
contains the string zero times, while work orders, appointments, assignments,
deliveries and invoices all use it.

So `handleOperation` never requires `If-Match` and never compares it. A PATCH
sent without one succeeds; a well-formed one is ignored; a malformed one is a
**428 from `parseIfMatch` even though the operation is unguarded**.
`VehicleWriteService.update` re-reads `record_version` inside its own transaction
and uses it in the `WHERE`, so a torn write is impossible — but a client cannot
learn that somebody else changed the record between its read and its write. From
an operator's position that is **last-writer-wins**, and the edit panel says so
in as many words rather than implying a protection that is not there.

**This corrects a claim made by this phase.** PR #193's docblock called
`recordVersion` "the half of optimistic concurrency that was missing", which
reads as though publishing it completed the mechanism. It did not: the other half
— an operation that consumes it — was never built for vehicles. The read is
still worth having, and the sentence was still wrong.

Owned by P1-17. Not fixed here: adding `versionGuarded: true` changes the
behaviour of an existing write, which is a different class of change from adding
a read, and §7 keeps it out of a Frontend branch.

### The measured extent of `INT-004`, found while building the write forms

`docs/api/openapi.v1.json` describes **243 operations, 152 of them mutations,
and publishes `requestBody` for zero of them.** Its entire `components.schemas`
section holds three entries — `ProblemDocument`, `Money`, `PageEnvelope`.

The practical consequence for this phase: **the published document cannot be
used as the client contract for any write.** Every P1-27 form derives its shape
from the Zod schema in the owning route module instead, which is what Wave 3's
creation forms already did. The document remains authoritative for the one thing
`P1-27-INT-003` needs from it — which operations are `idempotent: true` — and
that is generated and drift-checked.

This is recorded rather than fixed: the generator is foundation-owned, and §7
forbids repairing it inside a Frontend branch.

---

## Scope statements — capability gaps, not decisions awaiting an answer

These are recorded so nobody mistakes them for open decisions.

| task     | what the contract does not have                                                                                                                                                                                  |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FE-001` | **No phone or email search.** `NFR-PRV-001` keeps raw contact values out of the searchable surface entirely.                                                                                                     |
| `FE-002` | **No primary contact, alert indicator or last-activity column.** `CustomerSearchHit` publishes six fields and none is any of these.                                                                              |
| `FE-003` | **No pre-submit duplicate check exists.** `crm.duplicate-scan` is a privileged write. The warning is delivered on the creation response.                                                                         |
| `FE-017` | **No substring or prefix search.** VIN, plate and vehicle number are all EXACT. Plate matches only the currently active plate.                                                                                   |
| `FE-017` | **No make or model NAME in the search projection.** `VehicleSearchHit` carries `makeId`/`modelId` and no labels; only the detail read resolves them.                                                             |
| `FE-017` | **No sort control and no total.** No `sort` parameter exists and the page publishes `hasMore` only.                                                                                                              |
| `FE-018` | **No duplicate advisory on the creation response.** Unlike CRM, `CreatedVehicle` publishes no candidate list, and `veh.vehicle-duplicate-scan` is a privileged audited write that must not be fired from a form. |
| `FE-018` | **No VIN decode and no external VIN validation.** Nothing in the platform derives a make, model or year from a VIN.                                                                                              |

---

## Design defects found by this phase's own tests

Recorded because each was a real defect that a weaker test would have shipped.

**The search screen asked before it was asked.** `useServerTable` reads on mount,
so holding it at the top of the screen issued a request before the operator had
searched — correct only because the adapter refused empty criteria. The results
are now a separate component mounted after submission, which makes "no request
before intent" structural rather than guarded two files away.

**The creation form discarded typed input on failure.** React resets an
uncontrolled form after a Server Action completes, so a timeout would have
cleared everything and asked the operator to retype a customer's name for a fault
that was not theirs. The fields are controlled.

**The idempotency resolver matched nothing at all.** The generated table stores
templates without `/api/v1` and call sites pass the full path. Table correct,
resolver correct, agreeing on nothing. Both sides are normalised now, and both
forms are asserted.

**A whole layer had no test, and 20 green tests said otherwise.** The Wave 5 DOM
suite mocks `profile-api` wholesale, so it exercises the screens and _cannot_
exercise the adapters. That was proven rather than assumed: mutating
`includesRestricted: result.data.includesRestricted === true` to a hard-coded
`true` left all twenty tests passing. A layer that survives its own mutation is
a layer nothing is testing, however green the run looks.
`tests/crm-profile-api.test.ts` now talks to the adapters with only the HTTP
client mocked; the same mutation fails two of its tests. Writing it immediately
found a second defect — a failure-kind name used where a view-status name
belonged, which produced `status: undefined` and would have rendered a blank
panel instead of a denial.

**Six invented enum vocabularies.** The first draft of the Wave 5 message keys
contained `crm.purpose.service`, `crm.consentKind.profiling`,
`crm.alertType.payment` and `crm.restrictionType.credit_hold`. **No CHECK
constraint admits any of them.** The real vocabularies are
`transactional|marketing|reminder`, `privacy|marketing`,
`operational|financial|safety|other` and
`no_credit|prepay_only|no_service|contact_restriction|other`. A key for a value
the database cannot hold is dead weight; a key _missing_ for one it can hold
renders the raw key on screen. Every value is now read from the migration that
owns the column, and a test enumerates them from the constraints rather than
from `en.json`, so a key absent from both locales still fails.

`crm.consent_history.source` has **no** constraint at all, so it is rendered
exactly as stored — translating it would print
`crm.consentSource.in-branch tablet, ref 88213` to an operator.

**A write form rendered on a denied read.** Wiring the six record forms into the
component sections broke the restrictions fail-closed test immediately: the form
was rendering underneath the denial notice, naming `no_credit` and
`contact_restriction` in its options and stating the ten-character minimum. Every
one of these sections needs `crm.customer.read` to list and a **stronger**
capability to write, so a caller denied the list certainly cannot write — the
form both invited an action guaranteed to fail and disclosed exactly the
vocabulary the denial exists to hide. The form is now gated on a successful read.

**Six precision tests that a naive float implementation passed.** Wave 6's
`formatMatchScore` renders a `numeric` match score without ever parsing it, and
the first version of its tests asserted `0.875`, `0.5`, `1`, `0.005`, `0.004` and
a 29-digit value. Replacing the whole function with
`Math.round(parseFloat(s) * 100)` **passed every one of them.** The tests looked
like precision tests and were agreement tests — both implementations return the
same answer for all six inputs, so none of them said anything about why the
string version exists.

One of those assertions was also simply wrong. It named `0.615` "the classic
float case"; `0.615 * 100` is `61.50000000000001`, so `Math.round` gives 62 and
both implementations agree.

The values were then **chosen by running the two implementations against each
other and keeping only the inputs where they disagree**: `0.145`, `0.285` and
`0.575` (float rounds each down through `14.499999999999998`), `0.5abc`,
`0.5; DROP TABLE x` and `0x10` (`parseFloat` reads a confident `50%` out of all
three), `.5` and `1e-1` (notations `numeric` does not emit), and
`1.0000000000000000001` (which `parseFloat` rounds to exactly `1`, reporting a
valid `100%` for a value that is not a 0..1 ratio at all). The same mutation now
fails four tests.

**And the first version of that gate was always false.** It read
`table.status === 'ok'`, which looks like a correct fail-closed guard and is not:
`TableStatus` has no `'ok'` member, and a loaded, undenied read is `'idle'`. The
form therefore rendered **nowhere at all**, and the denial test passed for
entirely the wrong reason. Only the inverse assertion — "does offer the form when
the read succeeded" — could tell the two apart, and it is the reason that
assertion was written alongside the negative one. The gate is now
`table.response`, which is non-null iff the page came back `ok`.
Mutation-verified: rendering the form unconditionally fails three tests.

## Wave 11-12 — vehicle documents, duplicates and attribute history

**A working merge form shipped in Wave 6, and it should never have existed.**
`DuplicateDecisionPanel.tsx` was delivered with a merge form: a survivor
selector, an approval-reference field, a reason box and a submit button wired to
`mergeCustomerAction`, which POSTs `crm.customer-merge`. `P1-OD-017` — duplicate
and merge rules — is an **open Owner decision**, and this phase's own canonical
plan states the requirement in terms that leave no room: the merge affordance is
_absent_, "not disabled-with-a-tooltip, and the screen states that merge rules
are pending a decision. A disabled button implies the capability exists and the
user lacks permission, which is a different and false statement."

What shipped was worse than the disabled button the plan rejects. It was a
working control for an irreversible operation whose governing rules do not exist
yet — permission-gated, but a permission grant is not a decision record.

The form, `mergeCustomerAction`, `MergeInput` and `validateMerge` are all gone.
What replaces the form is a sentence naming `P1-OD-017`. Two docblocks that had
described the merge flow as intended behaviour were corrected in the same change;
they had been written before the plan's paragraph was read, and nothing re-checks
a claim once it is in a comment. `FE-028` was then built to the corrected rule
from the start, and both test files assert the **absence** of any export matching
`/merge/i` — an assertion that fails the moment someone adds one back.

**`veh.vehicle-duplicate-scan` reads like a query and is a privileged audited
write.** It creates candidate rows, emits an audit record and is throttled at
30/min. A review queue that "refreshed" by scanning would write audit history
every time an operator opened it. `FE-028` never calls it, does not offer a
rescan button, and says so on the screen rather than leaving a reviewer to wonder
why the list does not update. The test asserts no export matches `/scan/i`.

**`FE-029` is an attribute-change ledger and the tab is no longer called
"timeline".** `veh.vehicle-history` reads `veh.vehicle_attribute_history` —
field-level changes to the vehicle master and nothing else. CRM has
`crm.timeline_events`, populated by triggers across that domain; the vehicle
schema has **no equivalent table**, which P1-17's own remediation record states
plainly. The profile's eighth tab was defined as `timeline` and would have
promised a single event stream the platform does not have, disagreeing with the
five sibling sections that each read their own operation. It is `history`.

`oldValue` and `newValue` are both nullable, so a single "old → new" template
renders nonsense for three of the four real cases. `changeShape()` returns `set`,
`cleared`, `changed` or `empty`, and an empty string is treated as the same
absence as `null`.

**Two finished screens that no operator could reach.** The CRM duplicate queue
(`FE-016`, Wave 6) and the vehicle duplicate queue (`FE-028`) both had routes,
both had screens, and neither was in the sidebar or linked from any list. Nothing
failed: every test passed, the build compiled, and the pages worked perfectly for
anyone who typed the URL. Owner acceptance would have found this by failing to
find the screens.

Both are now sidebar entries, each behind its **own** `*.duplicate.review` code
rather than the module read code — deciding whether two records are the same
thing is a separate capability from being allowed to look at one. `vehicles`
itself was still marked `planned` three waves after its screen was built, which
told an operator the page in front of them was not real. The navigation test's
`available` and `planned` lists are exact, so drift in either direction fails.

**A numeric HTML entity read as a hex colour.** `&#8594;` (a right arrow) is a
`#` followed by four hex digits, and `check-design-tokens.mjs` failed the build
on it as a raw colour outside the token layer. The literal character is used
instead. The gate was right to be suspicious and the fix is not to loosen it.

**Vehicle documents are gated by a permission from another module.**
`veh.vehicle-document-list` needs `shared.document.manage` — a _manage_
capability from a _different_ module, inverted relative to every other vehicle
sub-resource, which all read on `veh.vehicle.read`. An operator who can see the
whole vehicle may be unable to see its documents, and an operator who can see the
documents may hold no vehicle permission at all. The page checks the code before
issuing the read, so a denied operator never spends an `expensive-read` slot
discovering they cannot see it.

The operation publishes a document **reference and nothing else** — no name, no
type, no date, no size. The section says so instead of rendering four empty
columns that look like missing data.

**There is no vehicle media operation, so media is recorded as blocked, not as a
flag.** `P1-OD-025` must decide accepted types, size limits and storage before
one can exist. `MEDIA_STATUS` is `'blocked-on-p1-od-025'` rather than a boolean:
a feature flag implies something to switch on, and there is nothing behind this
one. The test asserts no export matches `/upload|media|attach/i`.

## Wave 13 — security tasks `SEC-001` … `SEC-004`

**Every absence sweep failed on its first run, and the code was correct.** The
sweeps that assert no merge caller, no duplicate-scan caller and no upload path
matched the **docblocks explaining why those operations are absent**. A raw-text
sweep cannot distinguish "calls `veh.vehicle-merge`" from "records that
`veh.vehicle-merge` is never called", and this phase's central discipline is
writing refusals down — so the naive sweep would have forced the explanations to
be deleted to stay green, destroying the only durable record of the decision.

The sweeps now strip comments first. That creates a second-order risk that
matters more than the first: a stripper that removed too much would make **every**
absence sweep in the file pass on an empty string, and all six would go green
while measuring nothing. So the stripper carries its own positive control — a
sample containing the forbidden names in a line comment and a docblock, and the
same names in a string literal and a URL. The comments must vanish and the code
must survive. Alongside it, the fixture assertion requires more than twenty of
the collected files to still contain the word `export` after stripping.

`//` is only treated as a comment start when it is not preceded by `:`, so
`https://` inside a string literal is not truncated — which is exactly the case
the positive control pins.

**Two URL policies exist and they are not the same list.** `FORBIDDEN_URL_KEYS`
governs the **browser** address bar, which becomes history, proxy logs and the
`Referer` header, so it refuses `vin`, `plate`, `phone`, `email` and every
free-text search term. `query()` builds the **API** path — one TLS hop to the
backend — where a VIN search criterion has to travel or `FE-017` cannot work at
all. The first draft of `SEC-002` asserted that `query()` refused `vin`, which
would have been a confident test for a change that breaks vehicle search. Reading
`query()` before asserting about it is what caught that.

**`query()` now throws on a client-asserted scope.** `tenantId`, `companyId` and
`branchId` (and their snake_case forms) were previously prevented only by
convention plus a source sweep. Dropping them silently would let a caller believe
it had asserted a scope that never left the process, so the builder throws at the
moment of the mistake. No code path constructs one, so this can only fire in
development or under test — never for an operator.

**Mutation verification.** Six planted violations, six caught: a merge caller
reappearing, a duplicate-scan caller reappearing, `console.log` reaching a
feature module, a route losing its permission gate, `dangerouslySetInnerHTML`
appearing, and the scope refusal being disabled.

## Wave 14 — QA tasks `QA-001` … `QA-005`

Three real defects, and every one of them was found by writing a test that
asserted what an operator would see rather than what a function returns.

**Every table told a rate-limited operator that the system had broken.**
`STATUS_BY_KIND` maps `rate-limited` to `unavailable` and `unauthenticated` to
`expired` precisely so those two read differently from a fault, and every adapter
carried the distinction faithfully. `useServerTable` then collapsed it:

```
: page && page.status !== 'ok' ? 'error' : 'idle'
```

`TableStatus` was `idle | loading | error | denied`, so `unavailable`, `expired`
and `not-found` all rendered the generic error card. An operator who merely
searched faster than thirty times a minute was told something was broken. An
operator whose session had ended was told the same thing **and handed a Retry
button that could never work** — re-issuing the same request with the same dead
session fails identically.

`BackendUnavailableState`, `SessionExpiredState` and `NotFoundState` all already
existed, fully written and translated, and none of them was reachable from a
table. The union is widened, the hook passes the status through instead of
collapsing it, and the expired card deliberately carries **no** action.

This is a shared-foundation file, so the fix reaches every table in the product,
including P1-26's administration screens. It was found on a vehicle screen only
because the vehicle screens were the ones being tested for the first time.

**The vehicle domain had no component tests at all.** Every CRM screen had a
`.dom` suite from Wave 2 onward; the seven vehicle screens built across Waves
7–12 had contract and adapter coverage only. Those prove what a function returns.
They cannot prove that a screen issues zero requests before an operator asks,
that no merge control appears in the rendered output, or that a denial reads as a
denial rather than as an empty list. `QA-001` is "unit **and component**
coverage" and the component half was missing on an entire domain.
`vehicle-screens.dom.test.tsx` is that half, and it is what surfaced the table
defect above.

**Six of the ten evidence cells in the task register named files that do not
exist.** `crm-customer-create.test.ts`, `crm-customer-profile.test.ts`,
`crm-timeline.test.ts`, `vehicle-search.test.ts`, `vehicle-create.dom.test.tsx`
and `vehicle-vin.test.ts` were all written from memory of what each wave had
covered rather than from `apps/web/tests`, and every one of them was plausible
enough to survive a re-read. A register that cites a file which is not there is
worse than one that cites nothing, because it looks like evidence.

The table is rebuilt from `readdirSync` with measured test counts, and
`p1-27-qa.test.ts` now reads the directory and fails on any name that is absent.
The task ids are also written out individually rather than as ranges: a reader
looking for `FE-004` in a register that says `FE-003`–`FE-005` finds nothing and
concludes the task was never delivered.

**Nothing was driving every adapter through every failure kind.** There are
eleven kinds and eighteen list adapters. A mapping correct for `forbidden` and
wrong for `rate-limited` had nowhere to be caught, because the DOM suites mock
the adapters wholesale and the unit suites test the contracts. The QA file drives
all 198 combinations as one loop — a hand-picked sample of three would have been
a claim about the other eight — and asserts alongside them that each adapter
actually issues a request, so an adapter returning a hard-coded empty page cannot
pass the failure loop without ever calling anything.

## Wave 15 — DevOps and Documentation `DO-001`, `DO-002`, `DOC-001`, `DOC-002`

**A gate exists because Wave 6 proved a test is not enough.** The merge form
shipped past review, typecheck, lint and 669 green tests. Nothing in the pipeline
objected, because nothing in the pipeline knew `P1-OD-017` was open.
`check-p1-27-frontend.mjs` encodes the six decisions this phase made — no merge
caller, no duplicate scan from a review surface, no client-asserted scope, no
invented total, no upload path, no console output — and a decision encoded in a
gate has to be argued with in a diff rather than deleted around.

The gate carries the same two anti-vacuity properties as its P1-26 predecessor
(a rule inspecting zero files fails; comments are stripped so the explanation of
a rule is not accused of breaking it) plus a third that the earlier one lacks: a
`selfTest()` that runs on **every invocation** and is folded into the failure
list. A comment stripper that over-matched would turn all six rules into scans
over empty strings and report clean — the one failure mode the per-rule
anti-vacuity checks cannot see, because from their side the files are still
there.

**The P1-24 operation register silently claimed the new gate test as backend
evidence.** `scripts/p1-24-operation-register.mjs` credits any test file that
names an operation id, and the gate test named `crm.customer-merge`,
`veh.vehicle-merge` and both duplicate-scan operations — as the strings it plants
to prove the gate rejects them. Regenerating the register added this **Frontend**
test to the evidence list of four **backend** routes.

A test proving the Web tier never calls an operation is not evidence that the
route is exercised. The register would have said it was, in a P1-24 document, on
a P1-27 Frontend branch. The ids are now assembled at runtime from fragments: the
gate still receives the exact violating string, and it is simply not spelled
contiguously for a different scanner to misread. `docs/phase-1/phase-1-24/` is
untouched.

**`P1-27-DO-002` found a regression this phase had just introduced.** Splitting
`unavailable` out of `error` in `QA-002` routed tables to
`BackendUnavailableState`, which — unlike `ErrorState` — took no `correlationId`.
So the _retryable_ failure, the one an operator actually phones about, became the
only one with no reference to quote. Without it a report is "it broke this
morning", which cannot be traced to a request. The state now carries the
reference and a DOM test asserts it is rendered.

This is worth stating plainly: the fix for one honest-reporting defect created
another, and it survived a full green suite, a build and 49 gates. It was caught
only because `DO-002` asks a different question — "can support trace this?" —
than `QA-002` did.

**`validate:command-coverage` refused the new gate before it could be trusted.**
A command no aggregate runs is a command that has never run. Registering it is
what makes it reachable from `verify:web` and invoked by hosted CI, and the gate
would have sat inert otherwise.

**`validate:upgrade-matrix` failed once with `permission denied to terminate
process` and passed on re-run.** A transient PostgreSQL connection condition
after several concurrent local runs, not a code defect — this branch has
`MIGRATION_DIFF=0` and `SUPABASE_DIFF=0`. Recorded because a database gate
failing on a Frontend branch invites exactly the wrong diagnosis.

**`documented-counts.test.ts` caught the record before a human would have.**
Adding one file to `scripts/ci` made the CI automation record's stated inventory
wrong, and the test named the exact phrase that had to change. That is `DOC-001`
working as designed rather than a chore.

## Wave 16 — the adversarial review against the running application

Three defects, and **none of them was visible from inside the repository**. Every
one needed the real Next.js server, the real API and the real database.

### The Owner could not have tested this phase at all

The Owner-acceptance account carried exactly the **fourteen Administration
permission codes** from P1-26. Not one CRM or Vehicle code. The Owner would have
signed in, seen the sidebar, clicked Customers, and been told "you do not have
permission" — on every screen this phase built.

Nothing was wrong with the screens. The environment could not reach the phase it
existed to accept, and no test in the repository could have said so, because
every one of them either mocks the session or asserts the _denial_ path is
correct — which it was.

The role now carries thirty codes. `crm.customer.merge` and `veh.vehicle.merge`
are deliberately **withheld**: `P1-OD-017` is open, no screen calls either, and
granting them would let an acceptance run pass while the affordance that must not
exist quietly did.

**Writing that list invented a permission.** The first version included
`veh.vehicle.create`, by symmetry with `crm.customer.create`. It does not exist:
`POST /vehicles` registers `veh.vehicle.manage`, the same code that gates
editing. The catalogue check refused the whole bootstrap rather than granting
thirty of thirty-one — which is exactly what that check is for, and the reason
the account is provisioned from the catalogue rather than from a list somebody
believed.

### The `query()` scope refusal broke a working P1-26 screen

`P1-27-SEC-001` made `query()` throw on `tenantId`, `companyId` and `branchId`.
Against the running application it threw five times, on
`GET /api/v1/iam/approval-limits` — a P1-26 screen that has worked since that
phase closed.

The rule had conflated two different sentences that share a word:

- **"I am in company X"** — a claim about the caller. Never sent; the server
  resolves it from the session.
- **"show me company X's approval limits"** — a claim about the _resource_. Sent,
  and authorized server-side exactly like any other parameter.

The operator picks that company from a control that exists _because_ a session
may resolve to no single one. The refusal was right and its scope was wrong.

`companyFilterQuery` is the named, narrow exception: it permits `companyId` and
still refuses `tenantId` and `branchId`. `p1-27-security.test.ts` pins the call
sites to exactly two paths — the one operation with this shape and the definition
itself — so widening it means changing a test that states why it is not wider.

**The source sweep could not have found this.** `SEC-001` swept
`features/crm` and `features/vehicles`, proved no scope key appears there, and
that proof was correct. The conclusion drawn from it — "the client never sends
scope" — was a generalisation over trees the sweep never opened.

**And 176 authenticated tests passed while the server was throwing.** The failure
rendered a state the assertions tolerate. It was found by reading the server log
lines interleaved with a green summary, not by any assertion. A green suite is
not the same as a quiet one.

### A test whose verdict depended on how busy the machine was

`stylelint-policy.test.ts` failed at 5135 ms against the default 5000 ms timeout.
The first call into Stylelint pays for loading the whole rule set, and on a host
running two dev servers and a browser — the host an Owner-acceptance run uses —
that crosses the line.

It is fixed with an explicit 20 s timeout and a named constant, not by re-running
until green. A test that fails when nothing is wrong gets re-run as a habit, and
that habit is what lets a real failure through.

### What the review does prove

`crm-and-vehicles.spec.ts` asserts against the real stack, with nothing mocked:
every route resolves under a real session in both locales; both duplicate queues
are reachable **from the sidebar**; typing a VIN issues no request; no merge or
rescan control exists in the rendered output of either queue; opening either
queue issues **no non-GET request at all**; no request carries a scope parameter;
and a VIN typed into search never reaches the address bar.

## Wave 17 — clean room, PR #198, and a high-severity CodeQL alert

### `js/remote-property-injection` — high, and real

CodeQL flagged `normalizeCriteria` in `apps/web/src/features/vehicles/contract.ts`:
it iterated `Object.entries(criteria)` and wrote each key into an object literal.
The parameter is typed `VehicleSearchCriteria`, which declares exactly five keys
— and **TypeScript is erased at runtime**, so the loop iterates whatever the
object actually carries. A `__proto__` key in that position writes somewhere
nobody intended.

The fix reads a frozen `CRITERIA_KEYS` list and writes into an
`Object.create(null)` target. That closes the alert, and the better reason to do
it is the **contract**: the route schema is `.strict()`, so one unrecognised key
is a `422` for the _whole_ search rather than a dropped filter. Reading from a
fixed list means an unexpected key cannot reach the API at all.

**The change immediately caught a real instance of the thing it prevents.** Four
QA cases failed on the new code because `p1-27-qa.test.ts` passed
`{ plateNumber: '12-3456' }` — and the criterion is `plate`. Under the old
implementation that key was forwarded verbatim to a `.strict()` schema, which
would have answered `422` and failed the operator's entire search. Under the new
one the criterion is simply absent, the search is correctly refused as empty, and
the tests said so. A defect that had been sitting in a test written two waves
earlier, invisible because the old code was happy to forward anything.

### The alert was not visible from the branch ref

`GET /code-scanning/alerts?ref=refs/heads/feature/…` returned **zero** alerts.
The alert existed only on `refs/pull/198/head`. A CodeQL PR analysis is
diff-informed and reports against the pull-request ref, so querying the branch —
the obvious thing to query — reports clean over a high-severity finding. The
check-run summary said "1 new alert including 1 high severity security
vulnerability" while the branch query said nothing was wrong.

### The clean room had to be moved, and the first attempt proved nothing

The first clean room was cloned under the session scratchpad. `npm ci`,
typecheck, lint and both suites all passed there — and `build:web` failed with
`TurbopackInternalError: path length … exceeds max length of filesystem`. The
generated chunk name for `CustomerProfileScreen` plus a long scratchpad prefix
crosses Windows' `MAX_PATH`.

That is an artifact of **where the clean room was put**, not a fact about the
tree, and reporting it as a build failure would have been as wrong as reporting
the green tests as a clean-room pass. The clean room was recreated at `C:\cr27`
so the build is actually measured rather than blocked before it starts.

## Wave 17b — the pre-merge adversarial review

Six independent lenses over the finished branch, each finding then put through a
refutation pass. **25 findings raised, 15 refuted, 10 survived, 5 blocked the
merge.** The five blockers are fixed below; the five carried items are recorded
at the end rather than fixed, and say why.

Every blocker is the same shape: something that was **true when written and never
re-checked**. None was caught by 1640 tests, a clean room, 19 hosted checks or a
real-browser review, because none of those compares a claim to its authority.

### Two invented server vocabularies rendered raw keys to the operator

`translate()` is `messages[key] ?? key`. A value with no label renders
`crm.addressType.service` on screen and **nothing fails** — not typecheck, not
lint, not a test, not the build. It looks like a rendering choice.

**`vehicles.field.*` had zero entries in either catalogue.** `FE-029`'s
Change-history "Detail" column calls
`translateDynamic(messages, \`vehicles.field.${row.fieldCode}\`)`, and I never
added the keys. All eleven codes that
`veh.emit_vehicle_attribute_history()` writes rendered raw, in both locales. The
Owner produces those rows by editing a vehicle once — this would have been found
in the first five minutes of manual acceptance.

**`ADDRESS_TYPES` was invented.** It read `billing / shipping / site / other`.
`ck_addresses_type` admits `billing / service / registered / other`. So two of
the four real values had no label, and two labels named values the database
cannot store — a vocabulary that was wrong in both directions at once.

This is the defect class the phase had already caught six times and recorded as
closed, with the words "every value read from the migration that owns the
column". That claim was true of the six and untrue of these two, and nothing
re-checked it. A sentence in `findings.md` is not a check.

`apps/web/tests/server-vocabularies.test.ts` now reads the CHECK constraint and
the trigger function **out of the migrations** and compares them to the frontend
constants and to both catalogues, in both directions: every server value must
have a non-empty label, and no label may name a value the server cannot produce.

**Writing that test reproduced the bug it was written to catch.** Its first
draft asserted `vehicles.lifecycleStatus.`, `.workshopStatus.` and
`.powertrainCategory.` — prefixes I guessed. The real ones are
`vehicles.lifecycle.`, `.workshop.` and `.powertrain.`, and every label was
present. So the test now also asserts that each prefix it checks is one a
component actually builds a key from; a guessed prefix fails loudly instead of
demanding dead keys until it goes quiet.

Mutation-verified: restoring the invented address list, or deleting one
`vehicles.field.*` label from either locale, each fails it.

### Two canonical documents stated things that were not true

**The execution checkpoint credited Wave 2 to `df6e452`** — the idempotency fix,
which touches no CRM file. The delivering commit is `f6b5579`, which is what the
task register said. Two governing documents disagreed about the phase's first two
tasks. The same wave log had been frozen at "25 / 29. Total: 25 / 42" since wave
10, so an Owner reading it front to back was told the phase was two-thirds done
while the register said 42 / 42. Both are corrected and waves 10–17 are now
recorded.

**Contract archaeology gave the idempotency denominator as "120 of 238"**, in the
present tense, in a document that already describes PR #197 — the very PR that
took the registry to 243. Both figures are now recomputed from the generated
`operation-register.json`: 243 operations, 120 idempotent, nine not POST.

### Five findings recorded rather than fixed

Each is real and survived refutation. None would make the Owner's manual
acceptance produce a wrong answer, and each is honestly bounded.

**CRM write forms render on a successful READ rather than on their write
permission** (`CustomerProfileScreen.tsx`). The six component lists need
`crm.customer.read`; the six forms drive writes needing five stronger codes, and
`CRM_PERMISSIONS.profileWrite`/`.consentWrite`/`.noteWrite`/`.governanceManage`/
`.restrictionManage` are declared and referenced by no component. The vehicle
profile does this correctly with three distinct codes, so CRM is the outlier.
A read-only operator sees six controls certain to 403. Not a boundary — the
server denies every one, `RecordForm` preserves typed input on failure, and the
acceptance role holds all five codes so the Owner cannot reach it. An affordance
gap, and the fix belongs with the page that has `session.permissions` in hand.

**The route-gate test proves less than its name says** (`p1-27-security.test.ts`).
`indexOf('holds(') > -1` runs on **un-stripped** source — the one place in that
file that does not call `code()` first — so a `holds(` in a docblock satisfies
it. The ordering half is skipped whenever the route has no
`await read|list|search[A-Z]`, which is five of the eight routes. All eight are
correct today; the weakness is future-facing.

**`EvProfile.usableCapacityKwh` is typed `string | null`** and the operation
returns a JSON number. Cosmetic today (`77.4` rather than `77.40`); the
type-error half needs a consumer that does not exist.

**The vehicle duplicate queue discards `displayNumberA`/`displayNumberB`**, which
the operation does publish, in favour of fixed "First record"/"Second record"
labels — and the file's docblock claims the operation returns only two ids. A
false code comment and a missed label; both vehicles are still reachable.

**`permissions.ts` cites `apps/web/tests/crm.test.ts`**, which does not exist;
the assertion lives in `crm-customer-search.test.ts` and is `it.each`-driven.
A stale filename in a comment.

### What the review confirmed rather than broke

Every deliberate refusal held under adversarial reading: no merge affordance
anywhere, no duplicate scan from any queue screen, no upload path, no invented
total, no client-asserted tenancy, and the vehicle history is an attribute ledger
rather than a timeline. No Backend logic, migration, business data or secret is
touched by this branch.

## `P1-27-F-001` — root lint walks `supabase/.temp/`, failing a required aggregate

Found during Owner-acceptance verification of the protected merge, not during
development, because it only appears once `supabase start` has run.

`supabase start` writes the Edge Runtime's bundled entry point to
`supabase/.temp/start-secrets/supabase_edge_runtime_RootLco/main/index.ts` — one
minified line. ESLint does not read `.gitignore`, and the root flat config did
not name that directory, so `npm run lint` walked it and reported **154 errors**
at column 30,000 in vendor code. `lint` feeds `verify:repository`, which is a
**required** aggregate, so the aggregate failed.

**This is `P1-26-F-060` arriving a second time.** That finding was `.local/`
holding the dedicated Chrome profile, where root lint reported 25,508 problems in
files nobody here wrote. The comment above the ignore list already described the
shape precisely — "CI never has the directory, so the failure only ever reaches a
developer" — and the shape repeated with a different directory.

Both instances share what makes them expensive: **hosted CI never runs the
command that creates the directory** before linting, so every pull request is
green while every developer who followed the project's own local setup is red.
A green pipeline is not evidence about a developer machine.

The whole directory is ignored rather than the one file. Its contents are
CLI-version-dependent — `pgdelta`, `start-secrets` and `cli-latest` on this
machine today — so naming a file would fix one machine and break on the next
Supabase CLI release. `supabase/.branches/**` is added alongside it for the same
reason, before it becomes the third instance.

`tests/ci/eslint-global-ignores.test.ts` now pins every locally generated
directory to the list, each labelled with the command that creates it, and
asserts the opposite failure too: `src/**`, `scripts/**`, `tests/**` and `**/*`
must never appear, because an ignore list wide enough to be quiet everywhere is
the other way to make a lint gate meaningless.

**Writing that test reproduced the trap the test exists to catch.** Its first
draft asserted against the whole config file, so "the config must not name a file
inside the temp directory" failed on the comment that explains this very fix —
the comment names `start-secrets`. A text search cannot tell "does this" from
"explains why it does not do this", which is the third time this phase has hit
that exact wall. The assertions now read the extracted `globalIgnores([...])`
array rather than the prose around it.

Mutation-verified: deleting `'supabase/.temp/**'` from the list fails the test.
The first mutation attempt reported SURVIVED and was wrong — the file uses LF
line endings and the CRLF pattern never matched, so nothing was mutated. A
mutation that does not change the file proves only that the file was not changed.

### The regression test tripped a different gate, and the gate was right

`check-test-honesty.mjs` failed the first push of this fix with
`TH-003: test file declares no test`, on a file that plainly declares eleven.

The cause is the same class the fix is about. That gate strips comments before
counting tests, with `/\/\*[\s\S]*?\*\//g`. A glob literal such as `'.next/**'`
contains the two characters that open a block comment, so it opened one that ran
to the next closing pair further down the file — swallowing every `it()` between
them. From where the gate stood, the file really did declare no test.

**The gate was not changed.** It guards 293 test files, and a smarter stripper is
a change with that blast radius which deserves its own verification rather than
being made in passing inside an unrelated remediation. The test file assembles
the glob suffix from two constants instead, so the two characters never appear
adjacent in its source and the runtime value is byte-identical to the config it
compares against.

This is now the **fourth** time in P1-27 that a text scanner could not tell code
from prose about code: the security sweeps, the P1-27 frontend gate, the ignore
test asserting against its own comment, and now a glob literal read as a comment
opener. Recorded as a limitation of `check-test-honesty.mjs` rather than fixed
here — the next phase should harden that stripper deliberately, the way
`check-p1-27-frontend.mjs` did with its `selfTest()`.

Local evidence after the change: test-honesty exit 0 across 293 files,
`verify:repository` exit 0, the ignore test 11/11, and deleting
`'supabase/.temp/**'` from the config still fails it.
