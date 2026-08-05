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

| id              | owner        | subject                                                                                                                                                                 |
| --------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `P1-27-INT-004` | foundation   | The OpenAPI generator publishes 200 for routes that return 201, never 400 or 404, and **no request body for any of the 152 mutation operations**                        |
| `P1-27-INT-006` | other phases | **10 pre-existing cursor sites** still mint from a JS `Date` — was 16; the six in the vehicle module were closed by `P1-27-INT-008` because Waves 7–12 call all of them |
| `P1-16-A-01`    | P1-16        | `crm.addresses.line3` and `crm.communication_preferences.quiet_hours_note` are columns no write operation can set                                                       |
| `P1-16-A-02`    | foundation   | Path validation runs outside `handleOperation` in all 141 route modules, so a malformed uuid throws outside the block that renders an RFC 9457 document                 |
| `P1-17-A-01`    | P1-17        | The `iam.sensitive.view`-gated alternate-identifier read the vehicle domain promises does not exist                                                                     |
| `P1-17-A-02`    | P1-17        | `veh.vehicle_alerts` has no route at all                                                                                                                                |

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
