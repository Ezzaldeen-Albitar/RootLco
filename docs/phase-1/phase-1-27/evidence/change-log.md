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

**This entry also said "the job runs on pushes to `develop` and `main` only, so a
green pull request still does not include it". That was true when it was written
and is false at this head**, and it is corrected rather than deleted for the same
reason as the sentence below it. The job body has since moved to
`.github/workflows/_reusable-authenticated-browser.yml` and is called from two
places — `pr-ci.yml:251-269` on every pull request whose head is a branch of this
repository, and `protected-develop-verification.yml:191-202` on protected pushes
and by `workflow_dispatch`. Both gates wait for it (`pr-ci.yml:355`,
`protected-develop-verification.yml:227`) and
`scripts/ci/evaluate-ci-gate.mjs:97-101` declares it `alwaysRequired`.

**This entry also said, in the present tense, that the tier "has never executed on
a hosted runner even once". That was true when it was written and is false at this
head, and it is corrected rather than deleted because it is `H-15`.** The
`authenticated-browser` job has since PASSED on a GitHub-hosted runner — run
`31347643485`, **225 tests, 0 failed**, against candidate `78c4587` — by
`workflow_dispatch` before the merge rather than on a protected push. **That run
is now DISPUTED inside this repository and the dispute is recorded rather than
resolved by preference:** `.github/ci-baselines/unrun-test-tiers.json`
`hostedObservation`, rewritten on the branch that wired the gates, states that run
`31337158296` "is the only hosted execution of this tier in the repository's
history" and that it FAILED. Both cannot be true, a GitHub run record is not in
this tree, and the disagreement is finding `H-24`. The same spent premise sat in
three docblocks in `apps/web/tests/p1-27-security.test.ts`, which another branch
of this wave owns; those were corrected there and the correction is itself now
false in the union (`H-23`). The document half of `H-15` is closed here, in this
file, in `ci-evidence.md` and in `risk-register.md` §6.4. What is still unpaid is
narrower than the sentence that stood here — which said
`authenticated-browser` was "absent from `protected-gate`'s `needs`" and that "no
job the pull-request gate runs executes the tier at all", both false at this head.
What is unpaid is that the tier has not been observed to execute at the closing
candidate. That is why the task
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

### Closure wave three — re-judging three of the four remaining `PARTIAL`

`FE-006`, `SEC-003` and `QA-004` closed in wave two, leaving four: `SEC-002`,
`DO-002`, `DOC-001` and `QA-005`. Three of the four had been `PARTIAL` for
reasons that landed in the tree AFTER the last judgement, by agents who did not
own the matrix — so each was re-verified here rather than accepted, and each
mutation was run and then restored by file copy.

**`SEC-002` → `PASS`.** The binding reason was that only `file-access` had a gate
rule, leaving `export`, `document` and `media` on a deletable suite. The gate now
declares **eight** rules, not six: `no-export-surface` and `no-invented-media-limit`
are new and `no-upload-path` went from three constructs to seven. Verified by
planting `URL.createObjectURL` and a `MAX_FILE_SIZE_BYTES` constant into a real
source file — exactly two failures, naming exactly those two rules. The
deletability argument is answered too, which the named closure action did not
require: deleting the security suite fails ten of the gate suite's 133 cases, and
adding one undeclared suite rule fails the both-directions reconciliation. **The
residual is recorded rather than rounded away:** `storage` and `unescaped-html`
still have no gate rule, measured at 0 hits across 97 files, and of the two only
`storage` is inside this task's canonical wording at all — `unescaped-html` is
output encoding, which is `SEC-003` territory. **A naming error is corrected:** the
matrix named the closure action `no-export-caller`; the shipped rule id is
`no-export-surface`, and `export-caller` is a construct inside it.

**`DO-002` → `PASS`.** Alert routing existed nowhere; it exists now, as a severity
threshold validated against the same `LOG_LEVELS` tuple the logger orders by and
applied inside `deliveringAdapter` — the one place an event leaves the device, and
deliberately not in `report`, because the console is not egress. Verified by
mutation twice: an exclusive comparison fails six of forty-four cases, and
deleting `P1-27-OD-006`'s own owner line fails exactly one, which the earlier
file-scoped assertion did not. What remains absent is paging, and `ADR-012`
records there is no environment beyond Local to operate a collector in.

**`DOC-001` stays `PARTIAL`, and is NOT rounded up.** The `recovery` path closed —
a case now presses Retry, asserts the adapter was called again, and asserts the
rows replace the failure; neutralising the button's `onClick` fails that one case
and no other, 1 failed against 1605 passed. The eighteen-path matrix is therefore
**12 PROVEN / 4 PARTIAL / 2 ABSENT**, not 11/4/3, and `matrixDischarged` stays
`false`. Six paths remain unproved and each is named in the row rather than
summarised.

**That wave took the matrix to 40 PASS / 2 PARTIAL / 0 FAIL**, the two being
`DOC-001` and `QA-005`. It is written as the outcome of a wave rather than as a
statement about this head, because as a statement about this head it is false:
`P1-27-OD-007` settled `DOC-001` two commits later. The figures for this head are
below and they are derived, not typed.

**One count was left stale by the commit that created it.** `78c4587` added a case
to `vehicle-screens.dom.test.tsx` and three documents still claimed 36; the
`derived: cases` gate caught all three. Corrected here, with the four line-count
cells the same edits moved.

### Closure wave four — the transport paths, verified rather than accepted

The previous entry named three of the six unproved paths as the only ones
closable from `apps/web`. A Frontend change (`8916e18`, merged here) attacked all
three. **Every case and every mutation it reported was re-run on the merged tree
before any status moved**, each mutated file restored by copy with its md5
compared, against a baseline of **70 files / 1614 passed**.

**`timeout` → `PROVEN`.** Its recorded reason — "proved in the shared client, on
no screen" — is now false. `vehicle-screens.dom.test.tsx:495-514` drives
`VehicleSearchScreen` → `useServerTable` → the REAL `searchVehicles` → a real
`ApiClient` over a transport that never answers, so the client's own deadline
ends the request and nothing between the screen and `fetch` is a fixture. It
asserts the translated copy, the correlation reference the failure carried, that
Retry is offered, and exactly one wire attempt. Emptying the `setTimeout`
callback fails that case **alone** — 1 failed / 1613 — and the suite that had
been cited as this path's whole proof, `api-client.test.ts`, **did not fail**: it
feeds the timeout error in rather than letting the deadline produce it, so the
classification was proved and the deadline was not.

**`cancellation` stays `PARTIAL`, narrowed.** The screen half closed the same
way — an abort the client did not raise puts no service-unavailable state on
screen; `const isAbort = false` fails it, 6 failed / 1608. The operator's half
did not: no P1-27 control cancels a request (`form.cancel` is a `Link`,
`admin.cancel` calls `setConfirming(false)`) and no adapter accepts an
`AbortSignal`, so the only production cause is navigating away — which unmounts
the screen the assertion is made against. That is the standard this record
already applies to `stale version`, and applying it to one row and not the other
would be the rounding-up this phase exists to stop.

**`idempotent replay` stays `PARTIAL`, on the two limits its own author wrote
down.** A real write now replays through the real client against a
key-arbitrating transport, counted as three deltas with a fresh-key control. But
the effects counted are an array in the test file, and no suite counts durable
consequences across a replay of any CRM or Vehicle operation; and `grep
idempotencyKey apps/web/src/` resolves to `lib/api/client.ts` alone, so no
shipped adapter can re-present a key.

**That wave took the path matrix to 13 PROVEN / 3 PARTIAL / 2 ABSENT**,
`matrixDischarged` stayed `false`, and it left `DOC-001` `PARTIAL` — its binding
reason being `canonical-plan.md` §6, which requires each of the twenty-nine ids to
expand into the matrix, while every figure here is measured across the surface
instead. That reading is what the next entry decides.

**One reported number did not reproduce, and it is recorded rather than
smoothed.** The "`send` issues the request twice" mutation was reported as 4
failed; re-applied here it fails **28**, because a duplicated request also
consumes the one-shot responses seven other suites queue. Both replay deltas
still fail, so the direction holds — but the aggregate in the originating commit
message does not describe the mutation as re-applied.

**Six stale citations were re-pinned, and one of them was wrong before the
merge.** The merged file grew by 173 lines above its own tail, shifting five
`file:line` ranges in the matrix and three in other documents; all were corrected
against the source text they had described. `FE-028` was the exception:
`vehicle-screens.dom.test.tsx:335-440` had always begun inside the `recovery`
case and ended inside the duplicate queue, straddling two describes. It is
re-pinned to `544-613`, the queue block its sentence actually claims. That is the
citation-drift defect `tests/ci/p1-27-matrix-citations.test.ts` was written for,
found by hand because the check verifies a range holds an assertion and cannot
verify it holds the RIGHT one.

### Closure wave five — `P1-27-OD-007`, and what `DOC-001` is judged on (`527320b`, `9f78c9c`; merged `748a238`, `711a90e`)

`DOC-001` had been `PARTIAL` for one reason across three waves: the eighteen-path
matrix in `canonical-plan.md` §6 was undischarged. That wave asked, for the first
time, whether §6 is `DOC-001`'s criterion at all — and the per-id reading did not
survive three of four checks. The ids in §6 are the TEST ids of the twenty-nine
Frontend tasks; §5.3, where `DOC-001` is declared, assigns it no test id; the
plan's per-task obligations are in §10 and are a different, shorter, qualified
list. The sibling precedent had not been consulted and decides it: `P1-19`,
`P1-20` and `P1-24` all discharged this task on generated registers matching the
tree, and where a sibling owned a path-coverage obligation it filed it under QA.

**The fourth check FAILED and is kept rather than dropped**, which is the part
that makes this a decision and not a rationalisation: `P1-27-OD-005` already reads
the same sentence as asking for "a per-task test path matrix", so §6 may well be
an acceptance criterion — for the twenty-nine Frontend test ids, not for this row.

So `DOC-001` moves to `PASS` on a recorded, gated reading, and **not** on a claim
that the paths are discharged: `matrixDischarged` stays `false`, the per-path
statuses stay exactly as measured, and the outstanding paths stay open against the
tasks that own them. Adopting the synchronization reading exposes the row to every
open documentation finding, which the per-id reading never had to face; two were
re-read on the spot, and `A42-11` — a false statement inside a `DOC-001`
deliverable — was fixed rather than noted.

### Closure wave six — the round-five dispositions (`2c81e08`, `079dc56`; merged `b4141fc`, `2467db5`)

Six documentation findings re-established against the merged tree rather than
carried forward. `A42-06` closed by reading the change history, which decides an
attribution the previous disposition said "nothing in this repository decides".
`E-03` closed **by deleting the number rather than relabelling it** — twenty of
the web test files build their cases at runtime, so no tier-wide total is
derivable, and a reader wanting the executed total is sent to the runner's own
report. `H-11` is the first non-zero `REFUTED` this register has carried: an id
that names no defect is not open debt, and carrying it as `OPEN` had overstated
the phase's debt by one at every re-derivation.

`H-04`, `H-15` and `H-20` were **handed over with the exact edit written out**
rather than described, because `apps/web` belongs to other branches of this wave.

The same wave found that three of its own fixes were not load-bearing. `B-01`'s
driver defined its own copy of the predicate it was meant to guard, so reverting
the production predicate to the anchored tautology broke nothing; `B-05`'s
widening is inert on the live corpus and now says so, with a case asserting the
zero; `A-05`'s remedy case had labelled itself with a different finding's id.
**All three rows stay `OPEN` anyway**, and the classification section of the
register now says why in a form a gate can read: they are `SEALED`, and a sealed
finding is judged against the closing candidate.

### Closure wave seven — the citation gate read a quarter of what it claimed (`eaa5ec1`, `7813d2e`, `b9896a3`; merged `7ba78bf`, `26ddd83`)

**The merge shas were missing from this heading while waves five and six named
theirs**, which is the kind of asymmetry that makes a reader assume the wave was
never integrated. They are here now, and one of them is not a merge:
`7ba78bf` merged `p1-27/doc-traceability` and `26ddd83` merged `p1-27/ci-gates`,
but `b9896a3` was committed **directly onto `26ddd83`**. That is recorded rather
than smoothed over — the merge-commit-only rule binds `develop` and `main`, not
this integration branch, so the difference is legitimate and is exactly the sort
of thing a later reader would otherwise reconstruct wrongly from a heading that
listed three commits and two merges without saying which was which.

`H-19`. The gate written to stop a matrix cell citing a range that asserts nothing
was reading **135 of 653** citations and could not see the other 518, because its
pattern required at least one directory separator. Widened, its corpus went from
161 to 673 — and **83 of the newly visible citations failed**. All 83 were
repaired, and none of the gate was weakened to make them pass.

Seventy were bare filenames identifying more than one tracked file and therefore
none; each was qualified with the least leading path that singles one out, and the
target was recovered by reading the cell and the file rather than by picking a
candidate. Thirteen ranges held no `expect(` at all and were repointed onto the
case that proves the sentence beside them.

**Two of those thirteen were not the off-by-one the brief expected, and one became
a finding.** Widening `SEC-004`'s range by a single line reaches an `expect(` and
turns the gate green over a range about a different rule — proved by mutation,
which is why it moved further instead. And `QA-002.NEGATIVE_OR_MUTATION_PROOF` is
a conjunction whose provenance half is asserted by nothing: the claim that
`REAL_RULES` holds tokens `apps/api/src` emits lives in a docblock, while the
assertion that exists checks them against the two message catalogues a fixture
author edits in the same commit. Registered as `H-22` rather than pointed at the
nearest assertion, which is the repair that would have hidden it.

### Closure wave eight — five parallel branches, and two defects only their union had (`415a869`, `c4c8efc`, `8355900`, `0d3f116`, `7c41760`; merged `f29a990`, `7723dbc`, `1436458`, `d8b7277`, `3f8ef6c`)

Five branches ran at once — `p1-27/ci-gates` (`415a869`),
`p1-27/doc-traceability` (`c4c8efc`), `p1-27/security-wiring` (`8355900`),
`p1-27/core-api-boundary` (`0d3f116`) and `p1-27/frontend-coverage` (`7c41760`) —
and merged in that order into `3f8ef6c`. **Each was green alone. Two defects
existed only in the union**, which is the property this wave is recorded for: no
branch could have found either, and no per-branch gate was wrong.

**The first was a HARD FAIL that a gate caught.** `p1-27/ci-gates` extracted the
`authenticated-browser` job out of `.github/workflows/protected-develop-verification.yml`
into `.github/workflows/_reusable-authenticated-browser.yml`, so both gates could
list it in `needs`; the old file went **684 lines to 294**. `p1-27/doc-traceability`
had, on its own tree, re-read and re-pinned the four citations naming that job.
In the union all four pointed past the end of the file, in **24 matrix cells**,
and `tests/ci/p1-27-matrix-citations.test.ts` failed on the merge. Re-pinned to
the reusable workflow — the job at `:89-442`, the variable at `:332`, the run at
`:338`, the zero-test refusal at `:340-398` — and **one of the four was already
wrong before the extraction**: `:502-520` was cited as where the run fails on zero
collected tests and covered the step header and a traversal helper, the refusal
being some fifty lines below it. It resolved only because the old file was long
enough to contain the number, so a silent renumber would have carried a
pre-existing defect across intact.

**The second was invisible to every gate**, which is why it is the more important
of the two. `adversarial-round-five.md` derived `ROUND5_ACTIONABLE_OPEN = 4` and
`CLOSURE_STATE = BLOCKED` **from its own rows and never from the tree**, and all
four of those fixes were present in the merged tree: `H-04` on
`p1-27/frontend-coverage`, `H-15` on `p1-27/security-wiring`, `H-20` on
`p1-27/ci-gates`, `H-22` on `p1-27/core-api-boundary`. A derivation that reads
only the register passes while being externally false. All four were verified
against this tree and closed here.

**Verifying them produced two new findings, which is why the count did not reach
zero.** `H-23`: the three docblocks `p1-27/security-wiring` wrote to close `H-15`
are false in the union — they say the tier "runs in no pull-request job" and cite
six line numbers in the 294-line workflow, while `pr-ci.yml:251-269` now runs it
on every same-repository pull request. `H-24`: this tree contradicts itself about
whether the one hosted PASS exists at all — four phase documents record run
`31347643485` passing, and `.github/ci-baselines/unrun-test-tiers.json`, rewritten
on `p1-27/ci-gates`, states that a different run is the only hosted execution in
the repository's history and that it failed. Neither is decidable from the tree.

**One reason for an outstanding reproof was DISCHARGED here.** Twenty-two
`PROTECTED_REPROOF` cells said the tier was outstanding because
`authenticated-browser` "is still absent from `protected-gate`'s `needs`" and "no
job the PULL-REQUEST gate runs executes this tier at all". Both are false at this
head: `protected-develop-verification.yml:227`, `pr-ci.yml:355` and
`scripts/ci/evaluate-ci-gate.mjs:97-101` (`alwaysRequired`). What is still
outstanding is one thing and it is not a wiring gap — the tier has not been
observed to execute at the closing candidate.

### Where the record stands at this head

Every figure in this section is **derived**, and a document that restates one
wrongly fails `validate:p1-27-doc-counts`. That is not decoration: the two
sentences above that had to be superseded — "the matrix is 40 PASS / 2 PARTIAL"
and "`DOC-001` stays `PARTIAL`" — were both typed, both true when typed, and both
falsified two commits later by a wave this file had not yet recorded.

| what                                       | at this head                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The 42-task matrix                         | <!-- derived: matrix PASS = 41 --> **41** PASS · <!-- derived: matrix PARTIAL = 1 --> **1** PARTIAL · <!-- derived: matrix FAIL = 0 --> **0** FAIL. The one is `QA-005`, sealed last by design.                                                                                                                                                                      |
| Protected reproof                          | <!-- derived: matrix OUTSTANDING = 23 --> **23** rows OUTSTANDING. The phase cannot close while this is non-zero, and it is not the same question as the column beside it.                                                                                                                                                                                           |
| Round five, actionable                     | <!-- derived: round5 ACTIONABLE_OPEN = 2 --> **2** open, <!-- derived: round5 ACTIONABLE_PARTIAL = 0 --> **0** partial. The four that stood here closed at `3f8ef6c`; both replacements were produced by verifying them — `H-23`, a docblock correction the union falsified, and `H-24`, a contradiction between two committed records that this tree cannot decide. |
| Round five, sealed until `QA-005` executes | <!-- derived: round5 SEALED_OPEN = 17 --> **17** open, and they may be. They measure the record of the closing candidate, which does not exist yet.                                                                                                                                                                                                                  |
| Round five, dispositioned                  | <!-- derived: round5 DISPOSITIONED_PARTIAL = 1 --> **1** — `A42-13`, true and decided by `P1-27-OD-005`. It is not counted as a blocker and it is not marked fixed.                                                                                                                                                                                                  |
| The eighteen-path matrix                   | <!-- derived: catalogue pathProven = 13 --> **13** PROVEN · <!-- derived: catalogue pathPartial = 3 --> **3** PARTIAL · <!-- derived: catalogue pathAbsent = 2 --> **2** ABSENT, `matrixDischarged` still `false`. `P1-27-OD-007` decided that this is not what `DOC-001` is judged on; it did not discharge it.                                                     |

**The phase status is unchanged by any of it: `OWNER ACCEPTANCE: FAIL`.** None of
these numbers is an acceptance, and the row that matters most —
<!-- derived: round5 CLOSURE_BLOCKERS = 2 --> **2** actionable blockers — is the

one no automated tier reported. That number moved from four to two by closing
four and opening two, and the two it opened were found by checking that the four
were real. Reading the register's own rows would have reported zero.

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
