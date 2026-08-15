# P1-28 — change log

**Classification:** Confidential — Commercial Product and Pilot Planning

**CURRENT PHASE STATUS: OPEN.** `OWNER ACCEPTANCE` has not been asked for and
has not been returned. The permanent Frontend rule from P1-26 onward is that no
Frontend phase closes without the Product Owner testing the running application
in real installed Chrome and returning `OWNER ACCEPTANCE: PASS` verbatim, and
that silence is never Pass. Automated CI is necessary and is not sufficient.
Nothing in this file is a closure record; the phase remains open and `main` is
untouched.

`phase-1-19`, `phase-1-20`, `phase-1-21` and `phase-1-27` each carry
`evidence/change-log.md`, and P1-27's own change log opens by recording that the
phase shipped nothing at that path for a while and that **no document recorded a
decision to drop it** — half a named canonical deliverable, covered by a task
cell citing an automated proof that did not exist. This file exists so P1-28
does not repeat that, and
`apps/web/tests/p1-28-guidance-reconciliation.test.ts` fails if it disappears,
if the sibling convention disappears, or if it stops naming any canonical task
category.

Entries are grouped by the wave that produced them. Each names the **defect or
the decision**, not the feature — a list of features is a release note, and what
a later reader needs is why the product is shaped this way.

---

## Protected CodeQL policy remediation (`3187f18c`–`ea045d88`, PR #230)

The protected reproof after PR #229 exposed the pre-existing repository-wide
`js/http-to-file-access` finding in
`scripts/dev/owner-acceptance/provision-acceptance-fixtures.mjs`: loopback API
response objects were serialized into `.local/acceptance-fixtures.json`. The
path is local and git-ignored, but that does not make response bytes trusted, and
the CodeQL ceiling remains **0** rather than being raised.

`3187f18c` turns both the API boundary and the file boundary into exact
allow-lists. UUIDs are rebuilt from a local hexadecimal alphabet, catalogue and
party labels come from repository constants, malformed pages and ambiguous or
mismatched identities fail closed, newly created customer and vehicle records
are re-read before their ids are accepted, and the unused response-derived
release count is no longer persisted. Fifteen focused tests cover both existing
and created resources, legacy prospect reconciliation, uppercase-equivalent
relationship ids, malformed pages, substitution attempts and the exact manifest
shape. This is local acceptance/security tooling only; it changes no path under
`apps/**` or `supabase/**`, makes no Owner decision and does not start P1-29.

`a2095925` then repairs the seal bootstrap exposed by beginning this remediation
from protected `develop`: the valid `eeba15d7` measurement head is now base
ancestry rather than a current successor. The seal retains such heads only in a
separate `absorbedSuccessors` set whose entries Git must prove lie between the
candidate and resolved base and remain product-identical. Absorbed history can
preserve a pinned measurement, but it cannot satisfy current-branch successor
coverage. Two real scratch worlds take the seal suite from 94 to 96 cases.
Both local tiers were then re-recorded at that exact executable head in P1-27
ledger commit `6ea6bfdc`: unit 2592/2592 over 99 files and web 2726/2726 over
98 files, with 0 failures. The bound P1-28 tier pair remains unchanged until a
matching hosted run exists.

The first exact-head CI run for PR #230 (`31884032641`) exposed a strict-type
defect in the new boundary suite rather than a runtime fixture defect. At
`ea045d88`, four hostile-field assertions explicitly type the JavaScript result
as a string-keyed record and two mocked POST-body assertions keep their optional
`RequestInit` guard. Root typecheck and the focused 15-case suite pass; no case,
runtime fixture behavior, product path or database path changes.

Both authoritative local tiers were then re-recorded at `ea045d88` and committed
in P1-27 ledger commit `2e0f2191`: unit 2592/2592 over 99 files and web 2726/2726
over 98 files, with 0 failures. This replaces the earlier `a2095925` local
observation; the package moves the paired local/hosted tier figures only when a
matching hosted run for the current executable tree exists.

## Post-merge QA-005 seal remediation (`50a86014`–`eeba15d7`, PR #229)

PR #226 merged the reviewed P1-28 tree into protected `develop`, after which
the protected reproof exposed a topology defect in the QA-005 successor range:
subtracting current `origin/develop` subtracted the branch itself and collapsed
the range to empty. The first repair (`3f80bc2d`) recovered the historical base
from the merge, but adversarial review found three remaining fail-open shapes.

`50a86014` closes them. Git ancestry is tri-state, failed `diff-tree --cc` is
UNKNOWN rather than empty, both-parent candidate ancestry is resolved only by an
exact base parent or the protected first-parent line, and a stale base that
cannot distinguish its continuation from a sibling is refused. The suite now
constructs all required topology worlds in scratch repositories, including
reverse parent order, advanced first-parent history, genuine empty-range
anti-vacuity, real product drift, contentful merge, and Git command failure.
The frozen product candidate remains unchanged and `apps/**` / `supabase/**`
remain byte-identical; this is evidence machinery, not a P1-29 feature and not a
phase closure.

The lint-clean executable head is `eeba15d7`: it removes the retired
`execFileSync` import left by the tri-state Git reader. Both local tiers were
re-recorded there after the executable commit, with 2575/2575 root tests and
2726/2726 web tests, 0 failed and 98 files in each.

Exact remediation head `b12b9f0f` then passed 21/21 hosted checks in PR CI run
`31877658859` and CI run `31877658813`. The package binds unit job `94995683335`
and web job `94995683404` to that executable-identical head; CodeQL, dependency
security, authenticated browser, hosted clean room and `ci-gate` all concluded
success.

## Before the first screen — the day-one authority

P1-27 spent five adversarial rounds paying for a task register that did not exist
when its first screen was built: 33 adjudicated items were counted as 42
canonical tasks and nine tasks appeared in no status table anywhere.

P1-28 started the other way round. `docs/phase-1/phase-1-28/canonical-plan.md`,
`contract-archaeology.md`, the derived 35-task matrix and the gate that refuses
drift (`validate:p1-28-matrix`) all landed **before the first component**. The
universe is derived from the plan rather than maintained beside it, so the state
"a task nothing lists" cannot come to exist.

The archaeology found the phase's governing fact: at the P1-27 closure head the
entire appointment and reception public surface was **12 POST commands and no
read of any kind**. Every wave below is sequenced by that fact. What the surface
holds TODAY is stated once, derived from the P1-24 operation register, in
`contract-archaeology.md` — never restated here, because a figure restated in a
second document is a figure that will disagree with the first.

## Backend remediation, before any of it could be consumed (`P1-28-DOC-001`)

Five of the eight remediations the archaeology registered were executed on
Backend-owned branches and merged to `develop` before the Frontend consumed
them — never inside this Frontend branch, per the standing ownership rule.

- **R1 (#220)** — the reception read surface: six GETs and the
  `rec.reception.read` seed. The single highest-leverage change in the phase. It
  is what lifted the Owner-named readiness blocker: before it, approve and
  convert worked only inside one unbroken browser session, and closing the
  browser left a vehicle in custody with no path forward.
- **R2 (#220)** — the appointment read surface and its seed.
- **R3 (#220)** — seven catalogue reads. The registered ids took the
  `apt.catalogue-*` / `rec.catalogue-*` form rather than the form the register
  proposed, and the register was corrected to the tree rather than the other way
  round.
- **R4 (#221)** — `crm.customer-vehicle-list`. The customer-to-vehicle
  relationship had been write-only platform-wide.
- **R5 (#220)** — `close-without-work` and `refuse`. Both terminal visit states
  had been unreachable by any operation, so an abandoned visit blocked its
  vehicle permanently. That is the INT-013 defect shape, and this was its
  sibling.

`R6` (the receiving-employee referent), `R7` (customer search by telephone) and
`R8` (per-reception documents) are still open, and each is stated on the screen
that meets it rather than papered over.

## The intake catalogues — a contract landed, a surface deliberately did not (#227, `P1-28-OD-001`)

**PR #227** published the intake-catalogue MANAGEMENT surface on the Backend
branch that owns it: create, update and status-set across all seven catalogues,
plus one management-projection read each, every one behind
`apt.catalogue.manage` or `rec.catalogue.manage`.

It changed nothing an operator can see, and that is the entry. **No canonical
P1-28 task binds a catalogue-administration screen.** The 35-task register is
the OPERATOR surface — booking, check-in, approval, conversion — so building one
would have been scope this phase was never given, and inventing the task would
be the P1-27 failure of treating an adjudicated item as though it were a
canonical one. Both permission codes are granted to **no role by any seed**, so
the capability is held by nobody until somebody decides who should hold it.

That decision is recorded as `P1-28-OD-001` (`canonical-plan.md` §7) with both
halves left open — WHO administers the catalogues, and THROUGH WHICH SURFACE —
and the twenty-one writes are classified `DELIBERATELY_ABSENT` against it rather
than parked as not-yet-wired, which the SEC-004 ratchet would have refused
anyway. The consequence is stated where an operator meets it: until a catalogue
is populated no appointment can be booked and none can be cancelled.

That sentence used to end "which is why `FE-002` and `FE-004` are PARTIAL against
a decision rather than against any Frontend defect", and **that is no longer what
the register says**: both rows are **PASS**. The reason is recorded at
`canonical-plan.md` §7 — a task is graded against the capability it canonically
owns, and both screens are now proved on both sides of this decision in one
browser run: they book and cancel against a workspace configured through these
very management contracts, and they state the blocked truth to a workspace that
is not configured. What they cannot do is CONFIGURE a tenant, and that is the
surface this decision withholds, which no canonical P1-28 task binds. The
verdicts file is the authority; this sentence is corrected to agree with it
rather than left to contradict it in front of the Owner.

The half nobody had noticed until this wave: **the record went stale again in
the same week it was corrected.** Three rows of the archaeology, one row of the
gap register and two paragraphs of the change log still said no operation
anywhere could add a catalogue row, four days after #227 registered twenty-one
that could. See the Documentation entry below for what replaced them.

## Wave A — the contract layer and the reachability gate (`P1-28-SEC-004`)

The typed apt/rec/customer-vehicle contract modules were written from route
source, and `validate:p1-28-write-reachability` landed with them. It derives the
canonical write list from the P1-24 operation register at check time — 14
operations when the wave landed, **35 today** after PR #227 registered the
intake-catalogue management writes — and refuses any it cannot classify. The
number is never written into the gate; that the count moved without anybody
editing a list is the derivation working.

It exists because of `P1-27-INT-113`: ten canonical P1-27 writes shipped with a
route, a permission, an audit class, an idempotency entry, an OpenAPI path and a
register row, and no screen from which anybody could invoke them, while every
automated tier stayed green. The allow-list only shrinks, and an allow-listed
operation that IS called fails the gate — so the wave that lands a screen must
flip the entry in the same change.

Wave A also produced the finding that shaped the gate: **an adapter nobody
consumes is not reachability.** The whole reception adapter surface landed
before its screens, so a write can have a real call site and still be invocable
by nobody. Teaching the gate to resolve a path helper by shape would have
flipped five screenless writes to REACHABLE — INT-113 certified by the gate
built to catch it — so consumption is required as well as a call site.

The gate was hardened once more when the catalogue writes arrived. Its third
classification, `DELIBERATELY_ABSENT`, is the one the ratchet does not
constrain, and it used to require only a NON-EMPTY `decisionRef` — an
adversarial refuter walked `decisionRef: 'FAKE-DECISION-999'` straight through
it, which made the whole route worthless, because a fabricated reference reads
exactly like an approved one. The gate now RESOLVES every reference against the
decisions recorded in `canonical-plan.md` §7 and names what it did find when it
fails; a missing §7 is exit 2 rather than a pass, and an empty §7 refuses
everything. `tests/ci/p1-28-write-reachability.test.ts` holds the refuter's
fabrication as a fixture, and pins the live `DELIBERATELY_ABSENT` count so the
classification cannot be entered without a reviewer seeing the number move.

## Waves B–H — the screens (`P1-28-FE-001` … `P1-28-FE-022`)

- **B — walk-in intake (`FE-006`)** with two degradations stated on screen: no
  telephone search (R7 open), and the customer-to-vehicle list only after R4.
- **C — appointments (`FE-001`…`FE-005`)**. The truthful-labelling obligation
  bites here: **"Confirm" is not an operation.** Confirmation is a side effect of
  `apt.appointment-reschedule`, so the control says "Confirm by rescheduling"
  and the awaiting-confirmation state carries the same sentence.
- **D — the check-in wizard core (`FE-007`/`FE-008`/`FE-009`)**, including the
  walk-in-to-check-in seam and the receiving-employee field, which records an
  identifier and says so because no employee register exists (R6).
- **E — pre-service condition evidence (`FE-010`…`FE-016`, `FE-019`)**. The
  wave's own record is `EVIDENCE_KIND_COVERAGE`: of the eight evidence kinds
  four record unconditionally, three appear only when the reference data they
  need exists, and one is blocked outright because its contract requires a
  registered document that nothing in this product can produce. A coverage claim
  nobody can check is what that table exists to stop.
- **F/G — summary, approval, the two terminal exits, conversion, the
  acknowledgement document and the branch board (`FE-020`, `FE-021`,
  `FE-022`)**. Conversion is the only way a work order comes to exist, and a
  replay on a converted visit answers 200 `alreadyConverted: true`, which the
  step renders as the success it is.
- **H — media (`FE-017`)**: the named-open-decision notice, and the ban proved.
  Nothing on that screen takes, chooses or records a picture or a file. Two CI
  rules refuse an upload control and refuse an invented size or file-type limit
  while `P1-OD-025` is open, so a "sensible default" of 10 MB and JPEG/PNG —
  which looks like care and is an undecided policy presented as though it had
  been decided — cannot be added back quietly.

## Security, QA and DevOps riders

- `P1-28-SEC-001`/`-002`/`-003` ride the waves they police: the role-to-grant
  mapping, the sensitive-narrative controls for complaint and contents (where
  the application check passes and the DATABASE refuses), and the no
  client-asserted-scope rule.
- `P1-28-QA-001`…`-004` ride them too: the contract-mirror suites, the error and
  replay-shape coverage, tenant isolation, and the `recordVersion` sourcing
  discipline.

- `P1-28-QA-005` — the freeze, and the two things a digest cannot check. The
  phase's last task packages a regression result against ONE named commit and
  seals it: `docs/phase-1/phase-1-28/evidence/closure-evidence.md` for a reader,
  `evidence/closure-candidate.json` for a machine, and
  `evidence/evidence-manifest.json` digesting every file in the phase directory
  over its BYTES. Each figure carries the head it was taken at and the artefact it
  came from, because P1-27 shipped a closing page pinning a head 47 commits behind
  the tree it described and it went on reading like evidence.

  **The candidate has been re-frozen twice, for two different reasons.** The
  first was forced and the seal is why: three finding-fix waves changed 37 files
  under `apps/**` after `38afa5c2` was frozen, the gate COMPUTED the product
  diff, found it non-empty and refused the package. The second was deliberate and
  cost nothing —
  `git diff --name-only 6392ccb4..3c75f49a -- apps supabase` is **empty**, so no
  product file had moved and only the seal's own machinery had. Twelve commits
  had accumulated after `6392ccb4`, five of them executable and every one a
  repair to the seal; each forced a reseal and any further repair would force
  another, while the package described a commit ever further behind the tree
  hosted CI exercises. The candidate is now
  `7b1252edebb5d7f48451213c71ab832cb44e46b5`, the successor list is empty, and
  the two local tiers were re-measured **at it** — root unit 2560 and web 2726, 0
  failures, 5286 cases. The three hosted-only tiers still could not be, because a
  hosted run is taken by CI at a head and this workstation cannot take one. Those
  three, and eight other hosted bindings, remain PENDING rather than restated
  from the head they were measured at. Re-freezing moved what the package is
  about; it manufactured no observation of it.

  **The seal's own tests could not survive the package being bound, and that is
  what the current candidate fixes.** Hosted CI ran at `55b932cb`, a
  documentation-only descendant of the previous candidate, and every condition
  the gate imposes on a forward citation held — so the eleven bindings were
  bindable for the first time. Binding them took EIGHT cases of
  `tests/ci/p1-28-evidence-manifest.test.ts` red, because that file predated the
  forward-citation rule and had encoded "nothing is bound yet" as though it were
  a rule: it demanded a non-pending tier name the candidate EXACTLY, it SEARCHED
  the package for a pending tier, it asserted `supersededBindings.length > 0`,
  and it asserted three world flags to the constant `false`. Four were
  structurally unsatisfiable the moment anything was bound. The fix widens the
  tests, not the rules — the tier rule now defers all four conditions to
  `pendingBinding`, the one place that asks git; both anti-vacuity guards are
  kept and re-pointed onto CONSTRUCTED worlds, each asserted sound before it is
  mutated; and the world flags are cross-checked against the package's own
  pending declaration, which `worldFrom` never reads. The file passes in BOTH
  worlds, 79/79 either way, which is the property that lets a candidate be bound
  at all. 72 known-bad worlds, `selfCheck` 0 failures, nothing removed.

  That fix is executable, so the candidate moved to it and the eleven bindings
  returned to PENDING at `55b932cb` — a run at an ancestor cannot describe this
  code. The unit tier moved 2559 -> 2560 with it, and the moved value is
  reconciled where it lives: `CR-A-UNIT-TESTS-ROW` in P1-27's
  `clean-room-evidence.md` and BOTH of its twins in `closing-value-ledger.json`,
  the `locator` line and the `value`.

  **All eleven are now bound**, to runs 31783658759 and 31783658604 at
  `81cbd44b` — the documentation-only commit carrying that freeze, product-
  identical to the candidate by a computed diff. 21 checks, 21 success, 0
  failure, none pending; all five tiers in one run at one head: 9307 planned,
  9302 passed, 0 failed, 5 skipped, none of them a P1-28 case.
  `pendingHostedBindings.bindings` is empty BY DERIVATION, not by deletion, and
  both superseded citations — `55b932cb` and `38afa5c2` — are kept in
  `supersededObservations`.

  Two things that run reported and this package refuses to smooth over. The
  BROWSER SKIP COUNT MOVED, 4 to 5, at a product the gate computes to be
  identical: the extra skip is `a dialog traps focus and returns it, signed in`,
  a CONDITIONAL skip taken inside the test body when
  `/en/administration/users` exposes no dialog opener for the acting permission
  set — a fact about the provisioned workspace, not about the tree, so it can
  differ run to run at one commit. And the CodeQL check first completed
  `neutral` ("1 configuration not found") because only the `actions` analysis
  had uploaded; it flipped to `success` when the `javascript-typescript`
  analysis arrived. A `neutral` is not a success and was not recorded as one.

  **The exact-head rule was itself a circularity, and it is removed.** The
  seal’s own machinery cannot live inside the commit it seals, so hosted CI
  necessarily runs at a later head; under a rule that demanded the candidate
  exactly, every hosted run forced another re-freeze whose seal commit moved the
  head again. A binding may now cite a run at a head that is not the candidate
  only while it declares `describesProductIdenticalSuccessor` and the gate
  COMPUTES that the head is a commit this repository contains, DESCENDS from the
  candidate, and differs from it by no path under `apps/**` or `supabase/**`. An
  ancestor head is refused by it and stays pending. The same commit stops a
  merge-ref checkout making the base branch this phase’s: `actions/checkout`
  defaults for a pull request to the merge ref, and hosted CI reported a
  `develop` commit absent from this branch as an unnamed executable successor of
  this candidate.

  The seal is mostly its P1-27 sibling. **Two rules are not, because a digest
  cannot check either.** The first refuses a candidate the two halves of the
  package disagree about: a half-update that re-freezes the JSON and leaves the
  prose naming the old commit produces two documents that both read like
  evidence, one of them describing a tree nobody measured. The second is the one
  written for the Owner — the unclosed-task set is **DERIVED from
  `task-matrix-verdicts.json` on every run**, never listed, so a row that quietly
  stops being mentioned fails the gate instead of reading like a row that closed.
  Flip a fourth task to PARTIAL and the gate stays red until both halves of the
  package name it, with a blocker and an owner.

  And it is proved able to fail rather than asserted to be: eight rules fire in
  one function, the gate drives that function over seventy-two known-bad worlds on
  every invocation before it reads the tree, and
  `tests/ci/p1-28-evidence-manifest.test.ts` shows a single edited byte in a
  packaged document turning the check red — using an oracle that never calls
  `digest()`, because verifying a hash with the function that produced it is
  `f(x) === f(x)`.

  Packaging also found two of its own documents stale, and both are corrected
  above rather than quietly refreshed: the tablet-coverage paragraph, and the
  claim that `FE-002`/`FE-004` are PARTIAL.

  **It closes nothing.** The package says so in its own first paragraph: the
  phase is OPEN, `OWNER ACCEPTANCE` has not been asked for, and silence is never
  Pass.

- `P1-28-DO-001` — the two P1-28 gates are now named by hosted jobs directly
  rather than reached only through the clean-room aggregate, and the trace ends
  at the required-check list rather than at "a workflow mentions it":
  `validate:p1-28-matrix` runs in `static-quality`,
  `validate:p1-28-write-reachability` in `web-quality`, both jobs are
  `alwaysRequired`, both are in `ci-gate`'s `needs`, and `ci-gate` is the single
  required check.

  The same task found a co-maintenance failure and fixed it: the P1-28 plan §9
  names three Frontend trees and the frontend gate had adopted one of them, so
  `features/appointments` — the booking, calendar and detail screens — was
  scanned by no rule at all, including the two that enforce the media
  disposition. Adopting it required a `MODULE_DISPOSITION` decision for
  `components/overlays` and moved two derived doc-count markers, and all three
  landed in the same change, which is what the obligation says.

- `P1-28-DO-002` — the correlation reference was already surfaced across the
  apt/rec surface and nothing was measuring it. It is measured now: every
  recoverable failure in both feature trees and all three route trees is swept
  structurally, in both directions, so a missing reference on a backend failure
  and an invented one on a client-side gate both fail.

## The browser tier — the first evidence in this phase that is not a mock

Before it, the authenticated browser tier contained **zero** occurrences of
"appointment" or "reception" anywhere under `apps/web/tests/e2e/**`. That tier is
governed — `authenticated-browser` sits in the `needs` of both `ci-gate` and
`protected-gate` — so its green tick is quoted as this repository's
production-integration evidence, and for P1-28 it had observed nothing the phase
built. Every other P1-28 tier mocks the transport, and a mock returns what the
test author believed the operation returns.

That is not hypothetical here. This phase shipped a seam — the walk-in intake
building `/reception/check-in`, singular, against a wizard mounted at
`/receptions/check-in`, plural — that every mocked tier passed while no operator
could reach the second screen.

The tier now runs the P1-28 surface in the `authenticated-en` and
`authenticated-ar` projects against the running application, the running API and
the real database under RLS.

**This entry used to end by saying the tier does not run at a tablet viewport,
citing an `authenticated-tablet` project that matched `administration.spec.ts`
alone. That was true when it was written and stopped being true four commits
later**, when the tablet merge widened the match; the sentence is corrected
rather than left standing, because a documented gap that has closed is a reader
being told to expect less evidence than exists. `apps/web/playwright.config.ts:255`
now matches this phase's spec as well, at 1024×768 — a fact about the CONFIG,
unchanged at the current candidate. The most recent run that executed **47 P1-28
cases in that project** measured `55b932cb`, a head the candidate now supersedes,
so the EXECUTION half of this correction is PENDING again and the package records
it as such rather than restating it. The numbers are recorded once, in
`docs/phase-1/phase-1-28/evidence/closure-evidence.md`, and are not restated
here.

**It seeds no business row to manufacture a green path.** The Owner-acceptance
workspace holds no customers, no vehicles, no appointment types and no visits, so
several things a reader would expect to see proved cannot be against it — and
each is asserted as the HONEST BLOCKED STATE the screen actually shows rather
than skipped or weakened. An empty appointment-type catalogue blocks booking and
says why; that sentence is what the browser asserts. Neither is any case a skip:
a skipped test still counts toward the tier's executed total, which is how a
"0 uncovered" number gets reported over a case that measured nothing.

## A second workspace, so the configured path is proved as well as the empty one

Proving only the empty half would have said the screens are honest and nothing
about whether they WORK. Proving only the configured half would have deleted the
evidence that production's own first-day state renders truthfully. Both now run,
in the same file and the same run.

`scripts/dev/owner-acceptance/acceptance-fixtures.mjs`
(`npm run acceptance:provision-fixtures`) provisions a THIRD acceptance tenant
whose seven intake catalogues are populated **at run time, through the published
PR #227 management contracts an administrator would use**. Nothing is seeded:
nothing entered `supabase/` or `apps/`, no migration was touched, and the
Owner-acceptance workspace stays UNCONFIGURED so the truthful "not configured"
sentences keep being asserted. §18 of the browser spec runs the four
catalogue-blocked capabilities against that workspace — an appointment booked
with a catalogued type and channel, confirmed by rescheduling, cancelled with a
catalogued reason, a second one marked no-show, a visit opened with a catalogued
fuel level and a state-of-charge reading read back off the stored record, and a
warning lamp recorded and read back translated — with one Arabic case over both
configured pickers.

The browser tier is also where two defects were found that every mocked tier
passed, and both were **required fields the database refuses**:

- **`observedState` on the warning-light step** was a free-text box whose own
  hint asked for the operator's words, while `ck_warning_light_observations_state`
  admits exactly `on`, `flashing` and `intermittent`. Measured against the running
  stack, "steady while running" answered 422 `incoherent_reference` and rendered
  as "This value is not accepted here", with no way to learn what would be.
- **`leakType` on the inspection step** was the same defect and worse, because
  the field is REQUIRED: `ck_leak_observations_type` admits exactly seven values,
  so every leak recorded in an operator's own words was refused and the step was
  one no operator could complete.

Both are now translated selects over the migrations' own vocabularies, restated
in `receptions-contract.ts` with the constraint named beside the list. The rule
applied is not "never restate a database list"; it is "never invent one".

## The receiving employee is a name, not a UUID

`canonical-plan.md` §7 disposes of G-EMP with one sentence — "The UI shows names,
never UUIDs" — and two surfaces broke it: the wizard header and the
acknowledgement sheet a customer signs and takes away both rendered
`receivingEmployeeId` inside a `<code>` element, with a DOM case asserting the
identifier was on screen, so the defect had a test holding it in place.

The name was resolvable the whole time: `iam.user-detail` is registered under the
same `iam.user.read` the check-in employee picker already consumes and already
discloses beside the control, so resolving it widens nobody's access and adds no
new disposition. Both surfaces now render one of four states — named, denied,
unresolved, unavailable — and none of them prints the identifier. The three
non-name outcomes are separate on purpose: a denial learned nothing, a 404 means
the identifier names nobody (and `receiving_employee_id` has no foreign key, so
that is a state the database permits), and a failed read is not an observation —
which is `F1` on this very document, a failed read printed as an observed
absence.

The referent itself is still undecided, and that half of G-EMP stays open.

## The acceptance environment must be a production build

`npm run acceptance:serve` was added, and it is not a convenience. `next dev`
compiles a route bundle the first time that route is requested, and the API's
authenticator is a module-level singleton installed as a SIDE EFFECT of
composing the IAM module inside the login handler — so a bundle compiled without
that composition holds the unconfigured authenticator, which fails closed.

Measured twice on this checkout, one valid owner token, one process:
`GET /api/v1/receptions` answered 200 while `GET /api/v1/vehicles` and
`GET /api/v1/work-orders` answered 401 `ERR-IAM-002`, and a second `next dev`
process refused a completely different subset. On a production `next build` plus
`next start` of the same tree, every one answered 200.

An Owner acceptance session on a development stack would therefore have reported
product defects that do not exist. The launcher is one implementation serving
both modes — one lock, one process discovery, one plan, one `dev:stop` — and a
mode disagreement is a terminal verdict (`REFUSE_MODE_MISMATCH`) rather than an
adoption, because an operator certain they were on a production build is exactly
the failure this mode exists to prevent.

## Integration fixes that changed the product, not just the record

- **The walk-in-to-check-in seam** — `/reception/check-in` against
  `/receptions/check-in`. Two green waves, dead at the join. The handoff is now a
  parser and a builder that round-trip, and the browser tier resolves the address
  in the running application.
- **A damage-mark coordinate was silently wrong.** `toFixed(2)` in the submit
  path turned a typed `0.125` into `0.13` beside a `step="0.01"` a browser would
  itself have refused. The read-out is assembled without rounding, and the
  contract suite asserts the typed digits travel.
- **The no-fake-data gate read a comment as code, for the seventh time in this
  repository.** The offending comment was reworded, and the gate itself was
  taught to strip comments on `develop` (#228) rather than each document being
  edited around it.
- **CodeQL `js/incomplete-sanitization`** — five sites in the P1-28 gates escaped
  only the dollar sign of a regular expression. All five now escape every
  metacharacter, and the first attempt at the fix introduced a character range
  where three literal characters were meant, which the follow-up corrected.
- **A refused sensitive-narrative write left a submit control mid-flight** in the
  DOM suite, which is a real race the operator would see as a form that had not
  settled.

## Documentation

- `P1-28-DOC-001` — both authority documents were re-verified against the tree
  at this head. The correction that mattered: an addendum had exempted the
  contract tables from the document's own rule ("if the tree disagrees, the tree
  wins"), leaving the archaeology asserting that operations which now exist and
  which P1-28 screens now call were MISSING — including its most load-bearing
  claim of all, that no read operation existed anywhere in either domain. The
  exemption is withdrawn and every row states what is true at this head, with
  the source-head fact kept and labelled as history where it explains a
  decision. Three documents carried a citation to gate rules that had moved; all
  three are corrected. `FE-020`'s operation binding was missing the two terminal
  exits the reachability manifest already attributed to it, and now names them.

  **And then that correction went stale in four days**, because PR #227
  published a catalogue-management surface three of the rows it had just fixed
  said could not exist. Correcting them again by hand would have produced
  sentences that will be wrong again, so this wave replaced the method rather
  than the sentences: `scripts/ci/check-p1-28-traceability.mjs`
  (`validate:p1-28-traceability`, required, reachable from `verify:policies`)
  substitutes the tree's own answer for every figure a P1-28 document states
  about the platform, refuses the exact claims withdrawn here, resolves every §5
  operation binding against the P1-24 register, and binds each canonical
  `TC-P1-28-*` id to quoted cases matched against comment-stripped source.
  `evidence/traceability.json` and `evidence/traceability.md` are the record it
  checks. P1-27 declared twenty-nine canonical test ids that appeared in no
  executable file anywhere; all twenty-two of this phase's now resolve, and an
  id with no proof must state its gap.

- `P1-28-DOC-002` — `operator-guide.md`, the new `developer-guide.md`, and this
  file. The canonical name of the task is a conjunction — operator **and**
  developer guidance, **and** the change-log update — and only two thirds of it
  had been delivered: this phase had no developer guide at all, where P1-27
  shipped one whose reconciliation case required it to list exactly the rules its
  gate enforced. P1-28 had added four gates and more than ten rule ids and
  documented none of them for a developer.

  The developer guide now lists them, and the list is **derived from the gates**
  rather than copied: writing it found that `check-p1-28-access.mjs` is headed
  "The six rules" and enforces **seven** — `composed-permission`, which verifies
  every composed-permission row against the migration and policy it cites, is
  enumerated in that docblock nowhere. The operator guide gained the three things
  it was missing for the person at the desk: what party roles and authority
  actually record, why every intake catalogue is empty and that the reason is
  `P1-28-OD-001` rather than a setting, and that an acceptance session is run on
  `npm run acceptance:serve` and never on `dev:all`.

  Sentences on both pages are pinned to the executable thing they describe,
  because a guide that only has to exist passes while describing a product
  nobody built.

## The record's own citations, and three reads nothing called

A final material review read the sealed records against the tree and found the
citation half of `P1-28-DOC-001` had never been checked at all.

- **Seven `surface` citations named files that had been renamed or had never
  existed** — `IdentityStep.tsx` and `FuelStep.tsx` were never written,
  `ComplaintStep`/`DamageStep`/`ReceptionAcknowledgementScreen`/`steps.ts` had
  been renamed, and `FE-022`'s conversion was attributed to `SummaryStep.tsx`
  when it lives in `ConversionStep.tsx`. `traceability.json`'s own header
  promised that "a citation here names a FILE" and that a rename "breaks the
  record instead of quietly hollowing it out"; the gate tested the field for
  NON-EMPTINESS, so a surface pointed at `NoSuchFile.tsx:4242` reported zero
  disagreements. Every path in every surface is now repository-relative and
  RESOLVED against the filesystem, with the line checked where one is cited, and
  a task whose surface names no file at all fails. `tests/ci/p1-28-matrix.test.ts`
  drives each refusal.

- **The operator guide said thirteen steps and listed fourteen**, the extra one
  being a "fuel" step that does not exist: there is no `receptions.steps.fuel*`
  key in either catalogue, and the fuel level is a picker on the screen that
  opens the visit, shown back read-only inside Arrival readings. The same page
  said so correctly two paragraphs earlier and then contradicted itself again in
  the catalogue section. The one enumerated sequence on the page was the one
  thing outside the reconciliation harness; it now derives the count AND the
  ordered list from `CHECK_IN_STEPS` and fails on an inserted, dropped or
  reordered item.

- **Three read adapters had zero production consumers** — `listReceptionHistory`
  (`rec.reception-history`), `listVisitReasons`
  (`rec.catalogue-visit-reason-list`) and `conditionEvidenceKinds`, whose
  docblock described a filter control nobody built. No canonical task binds
  either operation, and a visit reason has no field to fill in any apt/rec
  write, so wiring them would have meant screens no task binds. All three are
  deleted, on the `crm/customers/identity-api.ts` precedent (`P1-27-QA-002`);
  the QA-001 drive corpus lost the two entries and its one exclusion with them.
  The operations themselves are untouched and still published — unconsumed is a
  different fact from missing, and `contract-archaeology.md` rows B9-B10 and
  B12-B13 now say which one applies instead of claiming the phase consumes all
  six reception reads.

---

## What is deliberately NOT in this release

Stated here so the absence is a record rather than a discovery:

- **Media capture** — `P1-OD-025` is open. No approved file types, no invented
  size limit, no object store assumed. Even after the decision the honest state
  of a registered file is "registered, pending": no storage provider and no
  scanner are configured, so nothing can be retrieved back out.
- **The signature image** — the write requires a registered signature document
  and its exact version, and nothing in this product registers a document. The
  step shows what a signature would attribute and records nothing.
- **Warning-light entries, and every other intake catalogue** — the seven
  catalogues ship no rows at all. This entry used to end by asserting that
  nothing anywhere could add one; that stopped being true when PR #227 registered
  21 management
  writes, and the sentence is corrected rather than left standing. What is
  absent now is the SURFACE: no screen in this product reaches those writes, no
  canonical P1-28 task binds a catalogue-administration screen, and the
  `apt.catalogue.manage` / `rec.catalogue.manage` codes are granted to no role
  by any seed. Who administers the intake catalogues and through which surface
  is `P1-28-OD-001` (`canonical-plan.md` §7), and the 21 writes are recorded
  `DELIBERATELY_ABSENT` against it in `write-reachability.json` rather than
  parked. The consequence is stated where an operator meets it: **a fresh tenant
  cannot book or cancel an appointment until somebody configures it.** That is a
  missing SURFACE recorded against the decision that withholds it, not a defect
  in the booking or cancellation screens — both of which are now proved to work
  against a configured workspace and to state the blocked truth against an
  unconfigured one, in the same browser run. No row is invented; the
  no-fake-data policy and this decision are two different reasons and neither
  substitutes for the other.
- **Road test** — no operation, status or report for one exists anywhere in the
  platform. Nothing is labelled as a road test.
- **Everything after the work order exists** — no work-order editing, no
  technician assignment, no department routing, no diagnostics. P1-28 ends where
  the work order begins; those are P1-29.
