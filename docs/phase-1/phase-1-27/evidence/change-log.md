# P1-27 — change log

**CURRENT PHASE STATUS: OWNER ACCEPTANCE: FAIL.** The phase is not closed, `P1-G27` is not written, `main` is untouched, and P1-28 has not begun. Acceptance is the Product Owner's act against the running application; it is not derivable from any count in this repository and cannot be inferred from silence.

The artefact `P1-27-DOC-002` names and P1-27 did not ship.

`phase-1-19`, `phase-1-20` and `phase-1-21` each carry `evidence/change-log.md`,
and `scripts/p1-20-endpoint-inventory.mjs` and `scripts/p1-21-endpoint-inventory.mjs`
bind the identically-titled task to that path. This phase shipped nothing there,
and no document recorded a decision to drop it — half a named canonical
deliverable, covered by a `task-register.md` cell citing an automated proof that
did not exist.

`apps/web/tests/p1-27-doc-reconciliation.test.ts` fails if this file is missing,
if the sibling convention disappears, or if **any task the adjudication records
as `FIXED` on this branch is absent from the table below** — the row set is
derived from `final-task-adjudication.md`, not maintained by hand.

That derivation replaced a durability claim that was not true. This file
originally said the test fails "if this file stops naming the waves below", and
the test asserted four hard-coded strings, none of which was a wave heading:
every wave section could have been deleted and it would have stayed green. It
was also missing `FE-003` entirely — a live gate hole the adjudication records
as fixed on this branch — which is exactly what a derived row set catches and a
hand-written one does not.

**Status: `OWNER ACCEPTANCE: FAIL`.** The phase is not closed, `P1-G27` is not
written, `main` is untouched, and P1-28 has not begun.

---

## What changed, in the order it changed

Entries are grouped by the wave that produced them. Each names the defect rather
than the feature, because the feature was usually already there — the recurring
shape in this phase is something declared, described, or half-wired.

### Backend read contracts (before the frontend could proceed)

P1-27 was blocked: the CRM and Vehicle READ surface it needed did not exist.
Four Backend remediations (#192, #193, #194, #195) took the operation register
from 226 to 238. #195 fixed silent row loss found by an adversarial review — 13
candidates raised, 9 refuted, 4 survived.

### D1 — canonical writes that no screen could reach

Seven registered, permission-covered, audited mutations had no call site in
`apps/web`. Contacts and addresses could not be added; a plate could not be
assigned; an odometer reading could not be recorded; ownership could not be
transferred; a customer could not be linked to a vehicle; a customer's lifecycle
status could not be changed.

`scripts/ci/check-p1-27-write-reachability.mjs` now derives the canonical
mutation list from the P1-24 register at check time and refuses any operation it
cannot classify: **27 canonical / 23 REACHABLE / 4 DELIBERATELY_ABSENT / 0
BLOCKED / 0 UNCLASSIFIED**. A hand-written list would have omitted the next new
operation, which is the defect the gate exists to catch.

### D2 — partner identity (Frontend here, Backend on a SEPARATE branch)

Relationship and ownership rows printed a uuid under a heading that said "owner".
`PartyLabel` names the party or says it cannot; `Named<T>` makes the three
identity fields required-and-nullable, so a read that forgets to resolve them
does not compile.

**The Backend half was riding inside this Frontend branch and has been split
out.** `npm run validate:phase-ownership` failed with seven `apiSource`
violations — a Backend change reviewed as Frontend is reviewed by nobody and
gated by nothing, which is the entire reason that gate exists. The seven files
are now `remediation/p1-27-backend-partner-identity`, pushed, with the Backend
test they shipped without: every web test mocks the adapter, so the whole
resolution path could have returned an empty map and the Frontend suite would
have stayed green.

**Either merge order was safe, and neither was free.** While both halves were
open, `develop` rendered `row.partnerId` — the uuid — so Backend-first left that
uuid on screen until the Frontend merged, and Frontend-first rendered "Customer
unavailable" until the Backend merged. Backend-first was prescribed for review
reasons and is what happened: PR #213 merged first (`8451427` → `1045c15`).

`PartyLabel` was hardened for the second window: it tests `== null` rather than
`=== null`, because the row arrives as a typed CAST rather than a parse, so a
backend that does not publish the fields sends `undefined` and the strict check
would have rendered an EMPTY cell — which says nothing at all, and is worse than
either the sentence or the identifier. An earlier version of this paragraph
attributed the window to the wrong merge order.

### D3 — actor identity (Backend, MERGED as PR #212)

`veh.vehicle_attribute_history` stores an `actor_id` and no name. Composing IAM
to resolve it was impossible without Supabase configuration, because
`iamModule()`'s composition root boots the provider — a coupling two earlier
phases routed around in prose. `iamDirectory()` is a second, provider-free root.

**Merged.** `remediation/p1-14-actor-display-identity` head `76e37f0` merged to
`develop` as merge commit `61d8ded`. This section previously read "**Blocked.**
… this environment cannot create a pull request", which was true at the time.
`210aac2`, the SHA it named, is an ancestor of `76e37f0`; the branch gained three
further commits before merging — a docblock correction, coverage for the
environment accessors the composition guard made visible, and a fix for the
operation-coverage gate grazing the 5 s timeout under `--coverage`.

`FE-029` is closed. Four mutations were executed and reverted against the
integrated tree; the pair that matters is that unwiring resolution kills the
naming case while removing the `iam.user.read` guard kills the withholding case,
so neither case alone would have been evidence.

### D4 — cursor precision

A keyset cursor built from a JavaScript `Date` dropped rows.

### The Owner-acceptance remediation (this branch)

Eleven defects were found by hand while 767 unit, 146 anonymous browser, 180
authenticated browser and 1636 database tests, hosted CI and CodeQL were all
green. What followed is recorded in `final-task-adjudication.md`; the code
changes are:

| task                | what was wrong                                                                                                                                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SEC-001`           | Ten write forms rendered for anyone holding `crm.customer.read`. `WRITE_PERMISSIONS` had zero consumers.                                                                                                                         |
| `SEC-002`           | Reproduced against the repository and refuted; the record was corrected rather than the code.                                                                                                                                    |
| `SEC-004`           | The security sweep matched no file on Windows, so it passed locally and failed on `ubuntu-latest`.                                                                                                                               |
| `FE-002`            | A search matching nothing announced "Nothing here yet" — a claim about the whole tenant.                                                                                                                                         |
| `FE-003`            | The frontend gate exempted a file from the duplicate-scan rule for a call that does not exist. An allow-listed file is skipped entirely, so a privileged audited write added there would have passed. Every `allow` is now `[]`. |
| `FE-004`            | An unkeyed Zod bound rendered English library prose under an Arabic label. Seven adapters carried the same.                                                                                                                      |
| `FE-013`            | Ten client-side validators with one reference each: their own definition. Their tests were their consumers.                                                                                                                      |
| `FE-015`            | The customer timeline printed a raw actor uuid under "Recorded by".                                                                                                                                                              |
| `FE-016`            | The CRM duplicate queue was rendered by no test; its dismissal was proved by a mirror nothing called.                                                                                                                            |
| `FE-017`            | Two comments justified an absent link by a route that had existed since `FE-019`.                                                                                                                                                |
| `FE-018`            | The create screen discarded the id of the vehicle it had just created. The journey ended in a dead end.                                                                                                                          |
| `FE-019`            | Vehicle search offered no way to open a result. Route existence is not navigability.                                                                                                                                             |
| `FE-020`            | `VinField` implemented the canonical four verdicts and was mounted only on the update panel.                                                                                                                                     |
| `FE-021` / `FE-022` | On a SCRAPPED vehicle the ownership transfer and the plate form rendered a live Save whose only possible answer was 409. See the recheck section below.                                                                          |
| `FE-024`            | The client demanded a positive capacity where the route accepts zero, refusing a value the platform stores. Its lifecycle gate was then one status short — see the recheck section below.                                        |
| `FE-026`            | The documents adapter and section were in no test at all.                                                                                                                                                                        |
| `FE-028`            | The duplicate queue labelled each vehicle "First record" / "Second record" while the operation published both references.                                                                                                        |
| `QA-001` / `QA-002` | Two inventories that could only fail if a file was renamed, never if a component or adapter was untested.                                                                                                                        |
| `QA-003`            | Three browser observers filtered on a URL the browser never requests, asserting an emptiness they could not have found otherwise.                                                                                                |
| `DOC-001`           | §9 asserted eleven unreachable operations while the gate beside it proved four.                                                                                                                                                  |
| `DOC-002`           | This file.                                                                                                                                                                                                                       |

Eight further tasks were adjudicated `DUPLICATE_FINDING` and closed by fixing the
root rather than the symptom. They are named here because a task closed without a
row of its own reads as a task nobody looked at:

| task                                              | closed by |
| ------------------------------------------------- | --------- |
| `FE-001`                                          | `FE-002`  |
| `FE-007`, `FE-008`, `FE-009`, `FE-010`, `SEC-003` | `SEC-001` |
| `FE-023`                                          | `SEC-001` |

---

## The adversarial recheck of this branch's own fixes

Every task above had been recorded as fixed when seven attack agents were set on
the branch with instructions to refute rather than confirm. Four verdicts did not
survive, and the shape they share is worth stating: **in three of the four the
docblock beside the fix stated the correct rule while the code implemented a
narrower one, and the test asserted the code.**

| task                         | what the recheck found                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FE-021`, `FE-022`, `FE-024` | `isFrozen` covered `merged` only while three server writers refuse `merged` OR `scrapped`. On a scrapped vehicle the plate form, the ownership transfer, the authorised-party form and the electric-drive save all offered an action that could only fail. Each gate's own docblock said "a merged or scrapped vehicle"; one added "Verified against the server". |
| `FE-028`                     | The ordinal moved from the visible label to an `aria-label`, which wins the accessible-name computation outright — so the announced name stayed "First record" while the screen showed `V-0001`. WCAG 2.5.3 Label in Name, Level A. The test that should have caught it inspected `textContent`, which cannot see an `aria-label`.                                |
| `QA-001`                     | The component sweep matched a substring over RAW test text, including its own docblock listing the six components that shipped untested. Three components appeared in the whole corpus only inside comments.                                                                                                                                                      |
| `QA-002`                     | Three exclusions cited `vehicle-api.test.ts` for adapters it did not import. The only guard was "still exported".                                                                                                                                                                                                                                                 |

The fixes are in `0272e1d`, each mutation-proved. The two predicates the vehicle
profile now carries — `isFrozen` (merged) and `isTerminal` (merged or scrapped) —
exist because the server has two rules, not one: a scrapped vehicle's DETAILS can
still be corrected and its final odometer reading can still be recorded, so
widening the freeze would have removed two working controls.

### Round two — the same agents, set on round one's fixes

`PASS_REFUTED = 6`, fixed in `5041b26` and `9da20fb`. Two are worth reading even
in a summary, because they are the two directions a fix can be wrong:

- **A fix that would have shipped a false statement.** The 409 on vehicle create
  was mapped to "This VIN is already used", against the VIN field, on the premise
  that the active-VIN collision is the only 409 that route raises. `veh.vehicles`
  has TWO tenant-scoped unique indexes and the server maps both to one code
  without reading the constraint name — so a duplicate REFERENCE NUMBER would
  have accused the VIN. The copy now says a value is already used and does not
  say which.
- **A fix that removed a working control.** The lifecycle table said the
  authorised-party add AND retire both refuse a scrapped vehicle. Only add does;
  retire returns 200. Gating both on one prop took away the ability to remove an
  authorised driver from a written-off car — the same harm the two-predicate
  design was built to avoid, one method over.

And one about measurement: the accessibility rule for WCAG 2.5.3 carries axe's
`experimental` tag, so a tag-scoped run drops it. Adding the missing routes was
necessary and not sufficient; the rule is now enabled by name, with a planted
violation proving it fires.

### Round five — the panel refuted this wave's own fixes

`adversarial-round-five.md` is the register and its totals derive from its own
rows; this is the summary, not a second copy of them. Five reviewers were each
told to refute one claim rather than confirm it, and the claim they damaged most
was the headline — "6 forms, 7 selects, 1 checkbox, 0 radios, **0 uncovered**".
The inventory reported zero uncovered because it never opened the files holding
the defects. Three real product defects were sitting in them, one of them a
SILENT WRONG WRITE: `VehicleCreateScreen`'s client-validation branch did not
advance `attempt`, so a mistyped year, corrected and resubmitted, created a
vehicle with no make, no model and no body type — and reported success.

The web test floor was broken four independent ways at once (`WTF-01` …
`WTF-07`), of which the one worth remembering is that `numTotalTests` counts
SKIPPED tests: `it.skip` across the tier left the count, the failure count and
the success flag exactly where the floor wanted them, with nothing executed.

### `DOC-001`, `DOC-002` and the thirteen unassessed rows

Three waves, and the last of them is why this section exists at all.

- **The catalogue.** Twenty-nine `TC-P1-27-*` ids were declared in three
  documents and appeared in no executable file. They are bound to the tests that
  already prove them, as data a gate reads per FILE — which immediately found a
  title credited to the wrong file (`G-11`).
- **The guides.** Each guide sentence is now pinned to the executable thing it
  describes, in both catalogues (`D-01`) and over the ownership gate's wider scan
  roots (`D-02`). Writing the check found two defects in the guide it was written
  to prove, and the second was introduced by the fix for the first.
- **The matrix.** Thirteen of the forty-two rows — every Security, QA, DevOps and
  Documentation task — carried the literal string `NOT YET ASSESSED` in
  twenty-six of their twenty-eight fields, so no non-Frontend task could reach
  PASS on the matrix's own rule however good the implementation was. All thirteen
  are populated. **None was raised to PASS**: the honest verdict for each is
  PARTIAL, and each names what remains in terms someone can act on. Four were
  worth reading, and **all four are now closed — see "The four PARTIAL verdicts,
  answered" below.** As they stood at `9eff8bd`: `SEC-004` (the audit-event half
  had no executable assertion at all; `auditClass` existed in `apps/web` only
  inside comments), `QA-001` (there was no coverage measurement for `apps/web`
  whatsoever), `QA-002` (nothing derived the client's problem-document interface
  from the API's, so it could rot in silence a second time) and `DO-002` (the
  documented way to switch monitoring on could not work, because `connect-src`
  took no parameter for the sink). **Those four sentences are preserved in the
  past tense rather than deleted**; each was true when written and each is false
  at `26eab7e`, and a change log that silently updates a defect description is
  how a reader loses the ability to tell a fix from a rewrite.
- **The findings that were in no register.** `H-01` … `H-11` existed only inside
  `task-matrix.json` cells. They are registered, re-verified against this head
  rather than copied, and three more were added for defects `continuation-checkpoint.md`
  §8.4 states in prose and no register carried. The register now runs to `H-16`
  and is re-derived rather than carried; five of its rows were published `OPEN`
  against a tree that already held their fix, which
  `adversarial-round-five.md` records as a finding about itself.

### The four PARTIAL verdicts, answered

Four branches ran in parallel and merged as one wave — `6d33739`
(`p1-27/core-api-boundary`), `bff8c71` (`p1-27/security-wiring`), `673fadb`
(`p1-27/frontend-coverage`), `821239d` (`p1-27/ci-gates`) — followed by `5d28569`,
`00d187b` and `26eab7e`. Each of the four PARTIAL verdicts above named exactly
what would close it, and each was closed by building that thing rather than by
arguing the verdict down.

- **`SEC-004` — the audit class (`6ba21e4`).** The record said the remedy was
  "buildable today: `openapi.v1.json` publishes `x-audit-class`; extend the
  generator to carry it". It does now:
  `scripts/ci/generate-idempotent-operations.mjs` reads the extension and writes
  `auditClass` onto all 243 `PublishedOperation` entries with six distinct values.
  The assertion is not a list — `p1-27-qa.test.ts:811` resolves the operation
  behind each of the twenty-three EXECUTED write adapters and requires
  `privileged`, and `:844` does the same for each list adapter and requires
  `none`. That is stronger than the prose it replaces, because it fails if the
  application calls an operation the contract does not publish at all.
- **`QA-001` — coverage measured for the first time (`82acb66`, `00d187b`).**
  `apps/web/vitest.config.ts` gained a root-level `coverage` block — root-level
  deliberately, because with `projects` Vitest ignores a per-project block without
  warning — and `.github/ci-baselines/coverage-baseline.web.json` records the
  establishment run as LOCAL and says so. Two things in it are worth carrying
  forward. The `include` glob has to escape `[locale]` and `(dashboard)`: written
  as they appear on disk they are a character class and a group, matching **0
  files** instead of 26, which would have dropped every route from the measurement
  while the percentage went UP. And `coverage.all` is `true` so nothing can
  silently join the denominator later — the trap where a percentage FALLS because
  v8 newly entered code. Nothing is excluded, and the exclusion list says so: the
  dashboard routes at 7.62% and two zero-coverage library modules are recorded as
  `knownGaps` rather than deleted, because excluding them would delete the finding
  and raise the number.
- **`QA-002` — the client contract derived from the API's (`5048c8f`).**
  `api-client.test.ts:977-1050` reads `ProblemDocument` off disk from
  `apps/api/src/server/errors/problem.ts` and `ProblemDetails` off disk from
  `lib/api/client.ts` and requires the same field names, every client field
  optional, and the violation member type derived too. The reader is proved before
  it is trusted (`:930-976`) — two empty field lists compare equal, so an
  unparsed file would otherwise pass the comparison it was meant to make.
- **`DO-002` — the enablement path made to work (`f0ce4bf`).** Two docblocks told
  the reader to add the sink origin to `connect-src` "in `src/proxy.ts`", a file
  where no directive is written and which could not hold one. `contentSecurityPolicy`
  now takes `monitoringUrl`, `src/proxy.ts:43-46` passes the same variable the
  beacon uses, only the ORIGIN is emitted, a non-`http(s)` value is dropped rather
  than interpolated, and with the variable unset the header is byte identical.
  **`DO-002` is still `PARTIAL`**, for one reason and a different one: alert
  routing is the third word of the task name and nothing in `apps/web` defines a
  threshold, a route or a recipient.

### The authenticated tier, and a claim withdrawn (`7c60549`)

`DO-001` and `QA-003` were both `PARTIAL` for the same reason: the authenticated
browser tier — the repository's only end-to-end tenant-isolation proof and its
only route-level accessibility proof — was gated behind `ROOTLCO_E2E_AUTH=1`, and
no workflow set it. `.github/ci-baselines/unrun-test-tiers.json` had recorded that
a hosted runner could not be given a live Supabase, a live API and a real account.
**That was false and the file now says so in its own words:** a hosted runner has
Docker and the Supabase CLI is a devDependency of this repository. The
`authenticated-browser` job in `protected-develop-verification.yml` starts the
stack, bootstraps the real operator and a second tenant, runs the production API
build as a database login holding neither SUPERUSER nor BYPASSRLS, sets the
variable, and then fails unless every authenticated spec contributed an executed
test.

What did NOT change, and is recorded rather than glossed: the job runs on pushes
to `develop` and `main` only, so a green pull request still does not include it,
and **it has never executed on a hosted runner even once**. That is why the task
matrix now carries a `PROTECTED_REPROOF` column separate from `FINAL_VERDICT` — a
feature that is complete and a re-run that is unpaid are different states, and
recording both as `PARTIAL` made the register unable to tell them apart.

### The web coverage floor that could not fire (`00d187b`, `26eab7e`)

The touched-file coverage minimum was added and then found to be unable to fail,
four ways at once, by an adversarial pass over the same wave's own work — the
recurring shape of this phase. `26eab7e` also restored root formatting and moved a
statement of gate blindness to the file where the check reads it, rather than
leaving it where a reader would not look.

### Re-assessment against `26eab7e` (this entry)

The forty-two matrix rows were re-evaluated field by field against this head,
because three independent judges reported rows stating, in the present tense,
defects the tree no longer had — `QA-001` said coverage was not measured,
`QA-002` said nothing derived the client interface, `QA-003` said no workflow set
`ROOTLCO_E2E_AUTH`, `SEC-004` said `auditClass` lived only in comments, `FE-019`
said the edit panel neither re-read nor rendered field errors. All five were true
at `9eff8bd` and false here. Thirty-one stale `file:line` citations were
re-pinned; the scope assertion the Frontend rows cite had moved from
`p1-27-security.test.ts:241-251` to `:270-276`, and the old range is now a
comment-stripper case, which is a citation that resolves to the wrong assertion —
the `G-11` shape.

The verdicts moved 21 PASS / 21 PARTIAL to **35 PASS / 7 PARTIAL / 0 FAIL**. Each
of the seven carries ONE binding reason stated so it can be acted on: `FE-006`
(`readCustomer` executed by nothing), `SEC-002` (three of five conjuncts held by a
deletable suite with no gate rule), `SEC-003` (privilege escalation cited from
nowhere), `QA-004` (the concurrency conjunct unbuilt), `QA-005` (sealed last, by
design), `DO-002` (alert routing absent) and `DOC-001` (the eighteen-path matrix
undischarged). Twenty-three of the thirty-five passes carry an OUTSTANDING
protected reproof.

---

## The through-line

Almost every entry above is the same defect wearing different clothes:
**something declared and not wired**. A permission table with no consumer. Ten
validators nobody called. A component mounted on one of the two journeys its task
names. A field published by the API and omitted from the client type. An
allow-list exempting a call that does not exist. An inventory listing filenames
instead of the things it claims to cover.

None of it was visible to a green test suite, because in each case the test
asserted the declaration rather than the wiring.

---

## Sealing the record — `QA-005`, the last task closed

Held to the end on purpose: it records the clean-room and hosted-CI measurement,
and any head that is not the final one produces a document stale on arrival —
which is the defect the task reports.

Three things changed, and only one of them is a document.

**A digest over the evidence.** `evidence/evidence-manifest.json` carries SHA-256
over the _bytes_ of every `.md` and `.json` file in the phase directory, walked
rather than listed — <!-- derived: manifest fileCount = 36 --> **36** of them at
this head. That number was written here as "29" and stayed there while the phase
directory grew by seven documents: a sentence about a walk, holding a figure
nothing read. It is derived now, so the next document that joins the tree fails
this gate instead of ageing the paragraph.
`validate:p1-27-evidence` fails when a document moves and the
manifest does not, and names the file that moved. It says in its own text what it
is not: anyone who can edit a document can re-run the generator, so this removes
_silent_ revision, not revision. It caught one within a minute of being written —
Prettier reformatting `ci-evidence.md` after generation.

**A count that is derived rather than typed.** The audit's finding was that
`clean-room-evidence.md` "pins e14984e and 763/38 while the tree is 47 commits
and 5 test files further on". Nothing was comparing the claim to the repository.
Now the web test-file count is read off the tree and the document must agree with
it. Beside it sits an assertion that looks unrelated and is not: no `*.test.tsx`
may exist that is not `*.dom.test.tsx`, because the `logic` project includes
`tests/**/*.test.ts` and `dom` includes `tests/**/*.dom.test.{ts,tsx}` — a plain
`*.test.tsx` matches neither, runs nowhere, and is still counted.

**A guard that used to switch itself off.** The requirement that every evidence
record state the current Owner status was nested inside "while tasks remain
open". The commit closing the last task would have taken that count to zero and
silently disabled it — a guard that disarms on success, in a file written to
catch exactly that. It is now unconditional.

This entry claimed the task count was **42 of 42**. **It is not, and the
adversarial pass run immediately afterwards is what withdrew it.**

Thirty-three items were adjudicated; forty-two are canonical. The nine that were
never enumerated — `FE-005`, `FE-006`, `FE-011`, `FE-012`, `FE-014`, `FE-025`,
`FE-027`, `QA-004`, `DO-001` — rested on an undisputed audit PASS, from an audit
whose passes had been refuted eleven times in twenty. And two are conjunctions
with a conceded half: `DO-002`'s alert routing is unattached and `QA-004`'s
concurrency half is contradicted by `P1-27-INT-009`. The count written here at the
time was **40 delivered and proven, 2 partially delivered**, derived in
`final-task-adjudication.md`.

**THAT NUMBER IS ALSO WITHDRAWN, and by the same mechanism.** It was a hand-count
of thirty-three adjudicated items plus a remainder, and the first full assessment
of all forty-two rows returned 21 PASS and 21 PARTIAL — in the same commit that
this page still said `40 / 42`, with nothing comparing the two. A count restated
in prose disagrees with its own source eventually; this one did so immediately.
The authority is `task-matrix.json` → `totals`, regenerated by
`validate:p1-27-matrix` and reconciled against its own rows by
`tests/ci/p1-27-task-matrix.test.ts`. No number for this appears anywhere in this
document from here on.

Both claims are left standing above with their retractions beneath them, because
the useful part of this record is not the final number but the sequence of numbers
that turned out to be wrong.

**And the commit that did all this went red in hosted CI**, which is worth
recording rather than quietly fixing. Adding one file took `scripts/ci` from 41
to 42. That count is asserted in **two** places in two different workspaces —
`tests/ci/documented-counts.test.ts` in the root tier and
`apps/web/tests/p1-27-doc-reconciliation.test.ts` in the web tier — against two
different documents. The root tier was run before committing and passed; the web
tier was not, and `deliverable-manifest.md` still said 41.

The root aggregate does not cover `apps/web`. That is the same shape as the two
already recorded here — root `format:check` cannot see `apps/web` because the
root `.prettierignore` contains `apps/`, and root `typecheck` does not cover it
either — and it is now the third instance. Local green over a tier that never
ran is indistinguishable from local green.

---

## Audit progression, preserved

| stage                                      | result                                                              |
| ------------------------------------------ | ------------------------------------------------------------------- |
| Initial claim                              | 42 / 42                                                             |
| Adversarial audit                          | 20 PASS / 22 FAIL, `PASS_REFUTED = 11`                              |
| Corrected reading of that same audit       | **9 PASS / 33 FAIL** — a refuted pass is a fail                     |
| After this branch's remediation            | **40 / 42 proven, 2 partial** — WITHDRAWN; see the retraction above |
| The 42-task matrix, first full assessment  | 21 PASS / 21 PARTIAL (`9eff8bd`)                                    |
| Re-assessed against `26eab7e` (this entry) | see `task-matrix.json` → `totals`                                   |

**The last row states no number of its own, and that is the point.** Every
earlier row is a figure somebody typed, and three of the four turned out to be
wrong — including the one directly above it, which read `40 / 42` while the
matrix it claimed to summarise recorded 21 PASS and 21 PARTIAL, in the same
commit, with nothing comparing them. `task-matrix.json` is generated by
`scripts/ci/build-p1-27-task-matrix.mjs` from `canonical-plan.md` and
`task-matrix-verdicts.json`, `validate:p1-27-matrix` regenerates it and refuses
any byte of difference, and `tests/ci/p1-27-task-matrix.test.ts` requires
`totals` to equal what its own rows support. A count restated here could disagree
with it; a pointer cannot.

Read alongside it: `totals.PASS` is the verdict on the FEATURE, and
`protectedReproof.OUTSTANDING` is the count of rows whose evidence includes a job
only a protected push starts. The phase cannot close while the second is
non-zero, and neither number can substitute for the other.

The first row and the last describe the same universe. They are not the same
claim: the first was asserted, the last is derived and re-derived on every run.
That difference is the whole phase.

The mistakes are kept deliberately. A record that shows only the final number
cannot be checked by the next reader, and this phase has now been closed once on
numbers nobody could check.
