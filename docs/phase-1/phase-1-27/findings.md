# Phase 1-27 — findings

**Classification:** Confidential — Commercial Product and Pilot Planning

Every finding raised or inherited by this phase, with its owner and disposition.
A finding is closed only when the code that closes it is merged and a test would
fail without it.

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
