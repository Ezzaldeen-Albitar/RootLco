# Phase 1-28 — closing evidence

**Classification:** Confidential — Commercial Product and Pilot Planning

**THIS IS NOT A CLOSURE RECORD.** The phase is **OPEN**. `OWNER ACCEPTANCE` has
not been asked for and has not been returned, and the permanent Frontend rule
from P1-26 onward is that no Frontend phase closes without the Product Owner
testing the running application in real installed Chrome and returning
`OWNER ACCEPTANCE: PASS` verbatim. **Silence is never Pass.** Automated CI is
necessary and is not sufficient. `main` is untouched.

What this document is: the technical evidence an acceptance session rests on,
frozen against one named commit, sealed so it cannot be revised without the
revision showing in the diff, and honest about the three things this phase could
not close and the one decision it was forbidden to pre-empt.

---

## How to read a value on this page

Every figure below carries the head it was taken at and the artefact it came
from. That is not decoration. P1-27 shipped a closing page pinning a head 47
commits behind the tree it described, and it went on reading like evidence
because nothing compared the claim with the repository.

The machine-readable half of this package is
`docs/phase-1/phase-1-28/evidence/closure-candidate.json`. It is not a summary of
this page and this page is not a summary of it: the gate
(`npm run validate:p1-28-evidence`) refuses a disagreement between the two about
the candidate, and refuses either half that fails to name an unclosed task.

---

## The frozen candidate

| Binding           | Value                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `FINAL_CODE_SHA`  | `6392ccb4321b004ed12e5d04ad583298da3303dd`                                                  |
| `FINAL_CODE_TREE` | `9a4cd553e7fe1501b9a340a7c4d86d125bdc2ad3`                                                  |
| Branch            | `feature/p1-28-appointment-vehicle-reception-frontend`                                      |
| Pull request      | **#226** (draft), base `develop`, 110 commits ahead                                         |
| Subject           | `chore(p1-28): regenerate the operation register and evidence seal after the finding fixes` |

### This candidate is a RE-FREEZE, and the seal is why

The previous candidate was `38afa5c28e5b78d484a442cf6b8596fb2a5c34aa`, tree
`bbae6c90dd51059be7ea949e0b5bca36cf17402d`. Three finding-fix waves landed after
it was frozen — `648fa46f` (product honesty), `4eaf5d6a` (evidence integrity),
`3bd2298d` (record accuracy), and the two fixes beneath them — and they changed
**37 files under `apps/**`**.

The gate **computed** `git diff --name-only 38afa5c2..HEAD -- apps supabase`,
found it non-empty, and refused the package. Five `tests/ci` cases went red for
that one reason. That refusal is the rule working: the package was describing
software the branch no longer held, and nothing but a computed diff would have
noticed.

**What the re-freeze cost, and what it did not.** The two LOCAL tiers were
re-measured here and are bound as usual. The **hosted** tiers could not be. A
hosted figure is produced by a GitHub-hosted runner at a head, and this
workstation cannot take one at any candidate — the backend and database tiers
need a running PostgreSQL it does not host, the browser tier needs the full
acceptance stack, and hosted CI, CodeQL, the dependency audit and the production
build are properties of a **run**, not of a checkout. So **every hosted binding
in this package is recorded PENDING at this candidate**; see
[What is PENDING at this candidate](#what-is-pending-at-this-candidate).

**On the two names, before anything else.** `FINAL_CODE_SHA` and
`FINAL_CODE_TREE` are the names this package was commissioned under. They are
**not** the P1-27 spelling — that phase says `CODE_CANDIDATE_SHA` for the same
idea — and no file in this repository used `FINAL_CODE_*` before this one. The
mapping is written down in `closure-candidate.json` rather than left for a reader
to infer, because two names for one commit is exactly how a superseded head gets
quoted as a current one.

### What freezing means, and what it does not

Every **local** figure in this package describes **that commit**, or a named
successor of it whose drift from it is declared path by path. Commits landing
after it are successors, and they are named by their full id rather than glossed:

1. **`e2dd8b8d8ba6ce124c464409fbe827ceea82b1fc` — the machinery commit that
   taught the seal to say PENDING.** Two rules were added, both demanding more
   than the silence they replace. **Hosted:** a binding whose head is not the
   candidate must declare `describesSupersededHead`, that head must be a commit
   this repository contains **and** an ancestor of the candidate, it must name
   what replaces it, and it must appear in `pendingHostedBindings` — a list the
   gate computes from the documents' own `headSha` fields and compares in both
   directions. A tier may not claim `LOCAL_AND_HOSTED_AGREE` while its hosted
   half describes a superseded head. **Local:** a tier measurement may be taken
   at a named executable successor of the candidate, provided no product path is
   in the drift and the package declares `measurementDrift` exactly equal to what
   `git diff` computes.

   **This successor is NOT a documentation-only recording, and does not claim to
   be.** P1-27's rule is that `DOCUMENTATION_ONLY_RECORDING` may be claimed only
   when `git diff --name-only CODE_CANDIDATE_SHA..EVIDENCE_RECORD_SHA` excluding
   `docs/` and `*.md` is exactly zero, and this commit changes three executable
   files. It claims the narrower and checkable thing instead:

   ```text
   git diff --name-only 6392ccb4321b004ed12e5d04ad583298da3303dd..HEAD -- apps supabase
   ```

   returns **nothing** — and that is **run by the gate**, not offered to the
   reader as an exercise. No file under `apps/**` or `supabase/**` differs
   between the candidate and HEAD, so the product these measurements describe is
   the product at the candidate. A successor that changes either tree fails
   `validate:p1-28-evidence`, and the candidate must be re-frozen and re-measured
   — which is precisely what this cycle did.

   **This entry is itself the proof of the rule it carries.** At that commit the
   gate reported `unrecorded executable successor: e2dd8b8d`, exit 1, because a
   commit that changes executable code and is not named must fail. The
   documentation-only commit that names it is what discharges the complaint —
   and that commit, being documentation-only, is the one the gate prints rather
   than demands.

   It adds fourteen known-bad worlds to the gate's self-check.

2. **`8f8c5cfaa8cbb25693affa6422e957fc4f914ab6` — the two new rules proved
   against the tree.** The self-check proves a rule can compute a verdict from a
   synthetic world; it cannot prove the **committed** package satisfies that rule,
   and a package satisfying none of them would leave every synthetic case green.
   Seven cases in `tests/ci/p1-28-evidence-manifest.test.ts` close that gap
   against this repository, and three existing cases move with the rules rather
   than around them. Executable, and named here for the same reason as (1).

   **This was the head both local tiers were measured at, and is no longer.**
   The seal cannot be inside the candidate it seals, so the measurement follows
   the machinery: successor (3) below adds twelve cases of its own, a tier run
   before it would report a suite that does not contain them, and both tiers are
   now measured there. The three executable paths that differ between either of
   those heads and the candidate — `.github/ci-baselines/unrun-test-tiers.json`,
   `scripts/ci/build-p1-28-evidence-manifest.mjs` and
   `tests/ci/p1-28-evidence-manifest.test.ts` — are the same three, are declared
   on each local tier as `measurementDrift`, and are compared by the gate against
   `git diff --name-only <measured head>..6392ccb4`. None is under `apps/**` or
   `supabase/**`, which is the only reason a measurement taken away from the
   candidate is admissible at all.

3. **`f4ba407485a916a2848f2de7bf6df090d18840b1` — the circularity removed, and
   the merge-ref false positive with it.** Two corrections, both to the seal
   itself.

   **The hosted rule is made symmetric with the local one.** Until this commit a
   hosted binding cleared only when its `headSha` **was** the candidate — and the
   seal's own machinery cannot live inside the commit it seals, so hosted CI
   necessarily runs at a later head. Every hosted run therefore forced another
   re-freeze, whose seal commit moved the head again, without end. A binding may
   now cite a run taken at a head that is not the candidate **only** while it
   declares `describesProductIdenticalSuccessor` and every one of the following
   is **computed** by the gate: that head is a commit this repository contains;
   it **descends** from the candidate; `git diff --name-only
<candidate>..<runHead> -- apps supabase` is **empty**, and a diff git refuses
   to take is UNKNOWN rather than empty; and `headSha` names that head, so a
   reader is told which commit was exercised. An **ancestor** head stays exactly
   where it was — `describesSupersededHead`, unchanged — and a binding may not
   wear both markers. This is the local rule's escape on the local rule's
   evidence: the claim is about the **product**, and the product is provably the
   same.

   **A merge-ref checkout no longer makes the base branch this phase's.** Hosted
   CI reported `0c89647de1a661105ec3a612955789989da58a0d` — a `develop` commit
   authored by another session, absent from this branch — as an executable
   successor of this candidate that the package had failed to name.
   `actions/checkout` defaults, for a `pull_request` event, to the pull request's
   **merge ref**, so `git log <candidate>..HEAD` swept in the base branch's own
   history; the same ref would have made `git diff <candidate>..HEAD -- apps
supabase` report the base's product changes as a broken freeze. The successor
   set is what **this branch** added after the freeze, so it is computed that
   way, in two independent subtractions: the base branch is resolved to a commit
   and excluded from the range, and a checkout that is a synthetic merge of this
   branch with its base is judged as the branch side of that merge — but only
   when that merge carries no content of its own, so an evil merge is never
   stepped past. Both fail **closed**: a base branch this checkout cannot resolve
   makes the successor set UNKNOWN, and unknown is not none.

   **This was the head both local tiers were measured at, and is no longer** —
   successor (4) moves it on. It adds eleven known-bad worlds to the gate's
   self-check and twelve cases to `tests/ci/p1-28-evidence-manifest.test.ts`, and
   every one of the fifty-six worlds and seven tree-level cases that stood before
   it still fails. Nine mutations of the seal were applied one at a time and each
   was observed red: the descent check, the product-identity check, the
   containment check, the refused-diff check, the undeclared-head check, the base
   subtraction, the merge-ref unwrap, the fail-closed base, and the evil-merge
   guard.

4. **`d37452ea888d4442f161295bc472df39d21ad15d` — the merge-ref rule made
   independent of the checkout, and the tests with it.** Hosted CI took three of
   the seal's own cases red at `10e2ce3e`, and the failure output identifies the
   cause exactly: `unwrappedMergeRef` came back `ac60f35d…` where the case
   expected `null`, and **that field is written only on the success path of
   `phaseHead`** — a path unreachable while `baseSha` was falsy. So the base ref
   resolved in that job, the unwrap fired, the subtraction happened, and
   `ac60f35d` is a two-parent commit: the pull request's own merge ref.

   **What failed was three tests.** They asked the ambient repository for `HEAD`
   and built their worlds around it. On a workstation that is this branch's tip;
   under `actions/checkout` on a `pull_request` it is the merge ref, so those
   cases fed a merge commit in as the _branch side_ of a synthetic merge and then
   reported it as an unnamed executable successor. A case whose verdict depends
   on which refs the machine carries is measuring the machine. Both tree-level
   suites are rebuilt against a repository **each case creates and tears down** —
   a base branch, a candidate with product content before and after it, an
   executable successor, a documentation successor, a clean merge ref and a merge
   carrying a tree neither parent has. No case reads `HEAD` and none skips.

   **Three hardenings to the seal, which the report was right to ask for.**
   `phaseHead` classifies a merge's parents by which one contains the
   **candidate** rather than by which one is contained in the base, so it needs
   no base ref to run at all and the base is **recovered** from the merge ref's
   other parent when nothing names one — the shallow-clone case. The base-ref
   cross-check requires only that one of the two commits **contains** the other,
   in either direction: a merge ref is computed by the forge while a
   remote-tracking ref is a snapshot that may sit either side of it, and a probe
   that reproduced the CI condition against this repository declined the unwrap
   for no better reason than which snapshot had been fetched. And a `git log` or
   `git diff` that **refused to run** is captured as UNKNOWN and refused, where
   `lines(null)` had quietly made a refusal read as _no successors_ and _no
   product file differs_ — a fail-open in the one direction this package exists
   to prevent.

   **This is the head both local tiers are measured at.** It takes the
   known-bad table from sixty-seven worlds to seventy-two and the seal's own
   suite from seventy-four cases to seventy-eight; every one of those
   sixty-seven is retained and still fails. Thirteen mutations were applied one
   at a time and each observed red — the nine above plus the base recovery, the
   UNKNOWN range, the UNKNOWN product diff and the one-directional cross-check —
   and the whole `tests/ci` suite was run with this checkout's HEAD detached at a
   real merge ref built over this branch, 1376 cases green, which is the
   condition the hosted job runs in.

**Documentation-only successors sit between them, and are not hidden.**
`333ca9c90abb2e20508262684c72d68e967a692d` carries the P1-27 run ledger as it
stood mid-bootstrap, with two failures recorded against the unit tier. Both were
the same case — the seal reconciles each local tier against a ledger read out of
git at a **pinned** commit, and until a commit held a ledger with these figures
there was nothing for it to read. `94e180008c81816d32003bfe8e44eab8226907dd`
re-records the same run at `8f8c5cfa` with **0 failed**, and
`d41c90980e63ecd7132861473b324a48938f3a5d` re-records both tiers again at
`f4ba4074` — 2555 and 2726, 0 failed. `b63fbd622eac49ffec5c21ca4884a22d178c2ee4`
re-records them once more at `d37452ea` — 2559 and 2726, 0 failed — and that is
the ledger this package pins.
All three are documentation-only, so the gate prints them rather than demanding
they be named.

**Three successors the previous candidate named are no longer successors of
anything.** `1b9811c8f489cd40b24dd1677add0f0dbfecfd7e` (the packaging commit),
`897209637c43af8db7633d7e8b91a3766b0933cc` (the seal's own test corrected) and
`5e97dc9241179ca56d8aeb38599090072536e32d` (the seal bound to the repository) are
all **ancestors** of this candidate now, and the gate refuses a recorded successor
that is not in `git log <candidate>..HEAD`. They are kept in
`closure-candidate.json` under `reFrozenFrom` rather than deleted, because
removing the record of what was once named is the half-update this gate exists to
catch.

**The rule, and the single hole it cannot close.** Every commit in
`git log 6392ccb4..HEAD` that touches an executable path — anything outside
`docs/` that is not `*.md` — must appear in `closure-candidate.json` by its full
40-character id, and the gate computes that range and refuses an unnamed one. A
**documentation-only** successor may go unnamed, and the gate **prints** the ones
that did. The reason is arithmetic, not policy: a commit cannot write its own id
into a file it contains, so "the recorded list is exactly `git log`" is not a
rule any repository can satisfy. The hole is therefore exactly one commit wide,
it is always the commit carrying this record, and it is reported rather than
hidden.

Why the candidate is a _code_ candidate rather than a head: recording the result
of a run changes the tree, so a literal exact-head rule is stale the moment it is
satisfied.

---

## The regression statement — what was re-run, and what was not

**Two tiers were re-measured at this candidate. Three were not, and are recorded
PENDING rather than restated.**

| Tier                     | Tests       | Passed | Failed | Skipped | Files   | State at THIS candidate                                      |
| ------------------------ | ----------- | ------ | ------ | ------- | ------- | ------------------------------------------------------------ |
| Root unit and foundation | 2559        | 2559   | **0**  | 0       | 98      | **measured here**, computed against the run ledger           |
| Web component and DOM    | 2726        | 2726   | **0**  | 0       | 98      | **measured here**, computed against the run ledger           |
| Backend integration      | 2004        | 2004   | **0**  | 0       | 86      | **PENDING** — figures are run `31750364479`'s, at `38afa5c2` |
| Database and RLS         | 1647        | 1647   | **0**  | 0       | 139     | **PENDING** — figures are run `31750364479`'s, at `38afa5c2` |
| Authenticated browser    | 370 planned | 366    | **0**  | 4       | 7 specs | **PENDING** — figures are run `31750364479`'s, at `38afa5c2` |

**Measured at this candidate: 5285 automated cases, 0 failures.** The other three
rows are the superseded head's numbers, kept so a reader can fetch the same
artefacts, and they are **not** a measurement of this commit. Adding all five
together would produce a total nobody has ever observed at one head, so this page
does not print one.

### What was NOT measured here, stated plainly

The **backend** and **database** tiers were **not run on this workstation** and
cannot be: both need a running PostgreSQL with all 120 migrations applied, which
this machine does not host. The **browser** tier needs the full acceptance stack.
None of the three is takeable here at any candidate, so the re-freeze did not
make them unavailable — it made the previously-available hosted measurement stop
describing the code.

What **does** move and what does not, said precisely:

- `supabase/**` is byte-identical between `38afa5c2` and this candidate, computed
  by the same `git diff` the product-identity rule runs. The migrations, the
  policies and the shape of the 1356-cell matrix therefore do not move. This
  package still records the database tier as **PENDING**, because the tier also
  executes tests that live outside `supabase/**` and an unchanged input is not a
  fresh result.
- `apps/web/src` changed in 20 files, six of them reception and appointment
  surfaces the browser spec drives. That tier's 366 passes describe screens that
  have since been edited, which is why it is the binding this re-freeze matters
  most to.

### Where each figure is checked, and what "checked" means for each kind

| Kind                 | Tiers                      | What the gate does with the number                                                                                                                                                                                                                                                                                             |
| -------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **arithmetic**       | all five                   | `passed + failed + skipped` must equal the declared total. The review set `passed: 3, failed: 812` beside `tests: 2475` and the first revision of the gate accepted it.                                                                                                                                                        |
| **computed**         | unit, web                  | the figures must equal the P1-27 run ledger's, read out of git at a **pinned commit**, and the tier may carry no figure the ledger does not write                                                                                                                                                                              |
| **measurement head** | unit, web                  | the head the tier names must be executable-identical to the candidate, or a **named successor** carrying no product drift and declaring `measurementDrift` exactly equal to what `git diff` says                                                                                                                               |
| **pending**          | backend, database, browser | the record must declare `describesSupersededHead`, name a head this repository **contains** and can prove is an **ancestor** of the candidate, name what replaces it, and be listed in `pendingHostedBindings`                                                                                                                 |
| **run head**         | any hosted binding         | a run cited at a head that is not the candidate must declare `describesProductIdenticalSuccessor`, and that head must be **contained** in this repository, **descend** from the candidate, and differ from it by **no** path under `apps/**` or `supabase/**` — computed, and a diff git refuses to take is UNKNOWN, not empty |

### What the local record covers

`docs/phase-1/phase-1-27/evidence/local-run-ledger.json` records the unit and web
tiers at `d37452ea888d4442f161295bc472df39d21ad15d`, the fourth named machinery
successor, and `b63fbd622eac49ffec5c21ca4884a22d178c2ee4` is the commit that
carries that record.
The gate reads that ledger **out of git at the commit that carries it**, through
`git show`, and requires `tests`, `passed`, `failed`, `skipped`, `files` and the
measured head to match this package exactly. It is pinned to a commit because the
ledger **moves**: `--record` rewrites it at whatever head it was last taken at, so
a check against the working copy would go red on the next unrelated re-record and
would then be relaxed rather than fixed.

That the measurement head differs from the candidate by exactly three executable
paths, none of them product paths, is **computed by the gate** and compared
against the `measurementDrift` list the package declares. A previous revision of
this page asked the reader to "verify with `git diff`", which is an assertion with
a suggested homework exercise attached.

`suites: 549` and `suites: 651` used to stand beside these figures and have been
**removed**. The run ledger records no suite count, so there was nothing those
numbers could be checked against and nothing that would have noticed them change.

**The hosted halves of these two tiers are pending as well.** Run `31750364479`
reported 2475 over 97 files for the unit tier and 2669 over 98 files for the web
tier, at `38afa5c2`. Those are a different commit and, for the unit tier, a
different suite. They are cited in `hostedAttestation` and are not restated as
this candidate's figures, so the two tiers declare
`LOCAL_COMPUTED_HOSTED_PENDING` rather than `LOCAL_AND_HOSTED_AGREE` — nothing
here claims two halves agree when only one of them has been taken.

### What no tier measures

No automated tier in this repository observes the product the way the Product
Owner will. Every mocked tier passed a seam this phase shipped dead — the walk-in
intake building `/reception/check-in`, singular, against a wizard mounted at
`/receptions/check-in`, plural — and the browser tier is what found it. That is
the standing reason `OWNER ACCEPTANCE` is required and CI is not sufficient.

---

## What is PENDING at this candidate

Eleven hosted bindings in this package describe `38afa5c2`, a head this candidate
supersedes. Each names that head in its own record, is marked
`describesSupersededHead`, and is listed by name in `pendingHostedBindings` — a
list the gate **derives** from the documents' own `headSha` fields and refuses a
difference from in either direction, so a pending binding cannot go unlisted and a
listed one cannot be decorative.

| Binding                            | What is awaited                                                     |
| ---------------------------------- | ------------------------------------------------------------------- |
| `tiers.unit.hostedAttestation`     | the hosted half of a tier whose local half **is** measured here     |
| `tiers.web.hostedAttestation`      | the hosted half of a tier whose local half **is** measured here     |
| `tiers.backend.hostedAttestation`  | the only measurement this tier can have                             |
| `tiers.database.hostedAttestation` | the only measurement this tier can have                             |
| `tiers.browser.hostedAttestation`  | the only measurement this tier can have                             |
| `hostedCi`                         | the 21-check result, at this head                                   |
| `browserByProject`                 | the per-project P1-28 spec result, at this head                     |
| `codeql`                           | both analyses, at this head                                         |
| `dependencySecurity`               | the audit, at this head                                             |
| `productionBuild`                  | the build, at this head                                             |
| `database`                         | the migration replay and the clean-room re-derivation, at this head |

**Who takes it.** The phase coordinator, by running CI at the candidate.

**The constraint, and the circularity it used to carry.** A binding left the
pending state only when its `headSha` **was** the candidate — and the seal's own
machinery cannot live inside the commit it seals, so hosted CI necessarily runs
at a later head. Every hosted run therefore demanded another re-freeze, whose
seal commit moved the head again: a loop with no exit, and this package walked
into it.

A binding now leaves the pending state in one of exactly two ways, and it must
say which:

1. its `headSha` **is** the candidate; or
2. its `headSha` is a commit this repository **contains**, which **descends**
   from the candidate, whose `apps/**` and `supabase/**` the gate **computes** to
   be byte-identical to the candidate's, and which the binding declares as
   `describesProductIdenticalSuccessor`.

The second is the local rule's escape on the local rule's evidence. It is not a
rule that accepts a run at "some head close enough to the candidate" — there is
no such thing, and 37 product files were "close enough" last time. It accepts a
run at a head whose **product is the same product**, computed by `git diff` on
every invocation, and it names that head in the record so a reader sees which
commit was exercised. A run at a head the candidate **supersedes** is refused by
it and stays where it was: `describesSupersededHead`, an ancestor, pending.

Everything below this line under _the superseded head_ is kept because it is
fetchable and a reader may want to compare, **not** because it describes this
commit.

---

## The authenticated browser tier — at the superseded head `38afa5c2`

**These are not this candidate's numbers.** Run **`31750364479`** · job
**`94614564003`** · head_sha
**`38afa5c28e5b78d484a442cf6b8596fb2a5c34aa`** · conclusion **success**
(11m 37s).

**Whole tier:** 370 planned · **366 passed** · **0 failed** · 4 skipped · **0
flaky**.

The four skips are two cases each in `authenticated/accessibility.spec.ts` under
`authenticated-en` and `authenticated-ar`. **No P1-28 case is skipped** — which
matters, because a skipped test still counts toward a tier's executed total, and
that is how a "0 uncovered" number gets reported over a case that measured
nothing.

**The P1-28 spec specifically** —
`authenticated/appointments-and-receptions.spec.ts`, read per test entry out of
the run's own `playwright-report.json` and grouped by `projectName`:

| Project                | Viewport | Locale  | Planned | Passed  | Failed | Skipped |
| ---------------------- | -------- | ------- | ------- | ------- | ------ | ------- |
| `authenticated-en`     | 1440×900 | `en-GB` | 47      | **47**  | 0      | 0       |
| `authenticated-ar`     | 1440×900 | `ar-JO` | 47      | **47**  | 0      | 0       |
| `authenticated-tablet` | 1024×768 | `en-GB` | 47      | **47**  | 0      | 0       |
| **Total**              |          |         | **141** | **141** | **0**  | **0**   |

These are **hosted** figures. They are not the local Playwright numbers and are
not a keyword count over the spec file.

**The one half of this that survives the re-freeze, and the half that does not.**
The `authenticated-tablet` project's `testMatch` at
`apps/web/playwright.config.ts:255` names two specs — `administration` and
`appointments-and-receptions` — and that is a fact about the **config**, which is
unchanged at this candidate: documents written before the tablet merge
(`88af8acd`, merged as `4c6ccfe7`) that say otherwise remain wrong. The 47
executed tablet cases are a fact about that **run**, and they are not carried
forward.

---

## Hosted CI at the superseded head `38afa5c2`

**Not at this candidate.** Run **`31750364479`** — workflow **PR CI**
(`.github/workflows/pr-ci.yml`), event `pull_request`, attempt 1, head_sha
`38afa5c28e5b78d484a442cf6b8596fb2a5c34aa`.

**21 checks · 21 success · 0 failure · 0 pending.** Taken from
`GET /repos/{owner}/{repo}/commits/{sha}/check-runs` — the per-commit endpoint,
because `/actions/runs` does not list every check.

| Check                                                   | Job id        | Conclusion |
| ------------------------------------------------------- | ------------- | ---------- |
| `ci-gate` — **the single required check**               | `94617578352` | success    |
| `CodeQL`                                                | `94614731700` | success    |
| `code-security / code-security (actions)`               | `94614564183` | success    |
| `Web quality / web-quality`                             | `94614564128` | success    |
| `integration-tests / integration-tests`                 | `94614564122` | success    |
| `hosted-clean-room / hosted-clean-room`                 | `94614564119` | success    |
| `code-security / code-security (javascript-typescript)` | `94614564116` | success    |
| `secret-scan / secret-scan`                             | `94614564097` | success    |
| `container-security / container-security`               | `94614564067` | success    |
| `dependency-security / dependency-security`             | `94614564057` | success    |
| `static-quality / static-quality`                       | `94614564036` | success    |
| `authenticated-browser / authenticated-browser`         | `94614564003` | success    |
| `database-security / security-matrix`                   | `94614564002` | success    |
| `database-migration-replay / migration-replay`          | `94614563937` | success    |
| `unit-tests-coverage / unit-coverage`                   | `94614563908` | success    |
| `application-build / build`                             | `94614563886` | success    |
| `change-detection`                                      | `94614500823` | success    |
| `Lint, types, tests, build`                             | `94614499574` | success    |
| `Secret and sensitive-file scan`                        | `94614499549` | success    |
| `Database migrations and RLS tests`                     | `94614499541` | success    |
| `Docker build validation`                               | `94614499502` | success    |

### CodeQL

Two analyses at this exact head, ref `refs/pull/226/head`:

| Analysis     | Language                | Rules | Results |
| ------------ | ----------------------- | ----- | ------- |
| `1616577501` | `javascript-typescript` | 201   | **0**   |
| `1616569830` | `actions`               | 27    | **0**   |

Open alerts repository-wide: **0**.

**What this does not prove.** A CodeQL run on a pull request is
**diff-informed**. Two analyses returned 0 results and the repository carries 0
open alerts on any analysed ref, but a pull-request analysis does not by itself
establish the repository ceiling — only a run on a protected ref does. It is
recorded here as the pull-request result it is.

### Dependency security · job `94614564057`

Production vulnerabilities **0** · development vulnerabilities **0** · critical,
high, moderate and low all **0** across **830** resolved dependencies. Licence
policy clean; no prohibited licence.

### Production build · job `94614563886`

Build **ok**. 239 routes in the manifest against 237 route files on disk; 6249
files emitted; standalone server 37 476 308 bytes, ×1.0905 against the committed
baseline.

### Database · jobs `94614563937` and `94614564119`

120 migrations applied to an empty database; 242 tables, 631 policies, a
1356-cell RLS matrix, **0** `SECURITY DEFINER` functions. The clean room
re-applies them at the exact SHA and re-derives the same matrix independently.

---

## The 35-task matrix

Derived from `docs/phase-1/phase-1-28/canonical-plan.md`, recorded in
`docs/phase-1/phase-1-28/task-matrix.json` and
`docs/phase-1/phase-1-28/task-matrix-verdicts.json`, regenerated by
`npm run matrix:p1-28` and held against drift by `npm run validate:p1-28-matrix`.

**35 tasks · 32 PASS · 3 PARTIAL · 0 FAIL.**

Supporting records, each sealed by the manifest:
`docs/phase-1/phase-1-28/evidence/traceability.json` and
`docs/phase-1/phase-1-28/evidence/traceability.md` (the record against the tree),
`docs/phase-1/phase-1-28/write-reachability.json` (write classification),
`docs/phase-1/phase-1-28/composed-permissions.json`,
`docs/phase-1/phase-1-28/contract-archaeology.md`,
`docs/phase-1/phase-1-28/media-capture-decision-record.md`,
`docs/phase-1/phase-1-28/operator-guide.md`,
`docs/phase-1/phase-1-28/developer-guide.md` and
`docs/phase-1/phase-1-28/evidence/change-log.md`.

---

## The three tasks this phase could NOT close

**Each is blocked on a decision or a contract that belongs to someone else. This
phase may not pre-empt any of them, and did not try.** The gate derives this list
from the verdicts file on every run: a fourth task turning PARTIAL fails
`validate:p1-28-evidence` until this section names it.

### `P1-28-FE-007` — vehicle check-in wizard core · **PARTIAL**

- **Blocker:** `G-EMP` / **R6** — Owner register question A.
- **OWNER: the Product Owner**, with the contract half owned by **P1-18**.
- **What is open:** the receiving-employee **referent**. The wizard writes
  `receiving_employee_id` on every check-in while the column has no foreign key
  and no defined meaning, so the visit records a value whose meaning is
  undecided. That is not an empty catalogue an administrator can fill — it is an
  open question about what the column _means_, aimed by name at a field of this
  row's own form.
- **What is NOT open:** the UUID-on-screen defect this row used to carry is
  **fixed**. Both read-back surfaces resolve the name through `iam.user-detail`
  and render one of four honest outcomes — named, denied, unresolved,
  unavailable — and none prints the identifier. The plan §7 sentence "The UI
  shows names, never UUIDs" is now true.

### `P1-28-FE-012` — exterior damage marking · **PARTIAL**

- **Blocker:** `P1-OD-025` — document and media file policy, an **OPEN Owner
  decision this phase is forbidden to pre-empt** — with `G-MEDIA` / **R8** behind
  it.
- **OWNER: the Product Owner** (the decision) and **P1-15 / P1-18** (the contract
  half). Neither is P1-28's to close.
- **What is open:** the damage-map half. `damage_map` requires a registered
  `documentId` **and** the exact `documentVersionId`, and neither can exist while
  the document-category table is empty, no storage provider is configured and no
  version can be accepted. Because a mark hangs off a map, the wired mark capture
  is unreachable in practice too, and the step says exactly that where the
  control would have been.
- **What is NOT open:** the mark write itself is delivered and unusually well
  proved — the operator's exact coordinates travel unrounded, the mark is
  placeable by keyboard, it clamps at the contract bounds and it refuses a blank
  coordinate by name.

### `P1-28-FE-018` — customer signature capture · **PARTIAL**

- **Blockers:** `P1-OD-025` (**OWNER: the Product Owner**), and the unowned
  signature read-back gap (**OWNER: P1-18, unassigned**).
- **What is open:** the task binds exactly one operation,
  `rec.reception-signature`, and the product calls it **zero** times. The write
  needs a registered document and its exact version, and nothing in this product
  registers a document. The blocker is a document registration, not an empty
  catalogue.
- **What is NOT open:** what ships is honest — the block, the roles and purposes
  a signature would attribute, the hash bound, the visit's active parties, and no
  control that could not work. The **absence** of a submit control is asserted, so
  it cannot creep back.

### The rule applied to all three

A task is graded against **the capability it canonically owns** — its §5 binding
in `canonical-plan.md` — and against nothing else. A row does not stay PARTIAL
merely because a fresh tenant starts empty, provided both halves are evidenced:
its own journey works against a configured tenant, and the unconfigured state is
truthful. Equally, **a row does not close while its own canonical journey is
impossible**, and a capability no canonical P1-28 task binds is not this
register's to withhold a verdict over.

---

## `P1-28-OD-001` — the open decision this package does not pre-empt

**Who administers the intake catalogues, and through which surface · OPEN ·
raised by this phase.** Recorded at `docs/phase-1/phase-1-28/canonical-plan.md`
§7. **OWNER: the Product Owner.**

**What the Owner must decide:** (a) **who** administers the intake catalogues — a
tenant administrator, a head-office role, or the platform operator; and (b)
**through which surface** — a screen inside this product, a separate
administration application, or provisioning performed outside the product
altogether. Nothing here pre-empts either half and no candidate answer is
recommended.

**The consequence today, stated plainly:** seven intake catalogues ship zero rows
and no screen in this product can add one. Two of those tables sit on a
**required** foreign key of an operator path — `appointmentTypeId` on
`apt.appointment-create` and `cancellationReasonId` on `apt.appointment-cancel` —
so **until a catalogue is populated no appointment can be booked and none can be
cancelled**.

**What shipped instead:** the API capability and nothing in `apps/web`. PR #227
registered 21 catalogue-management writes behind `apt.catalogue.manage` /
`rec.catalogue.manage`; **no seed grants either code to any role**, so the
capability is held by nobody until somebody decides who should hold it. All 21
are recorded `DELIBERATELY_ABSENT` against this decision in
`docs/phase-1/phase-1-28/write-reachability.json`, and
`check-p1-28-write-reachability.mjs` resolves that reference against the §7
headings — so the classification cannot be entered with a fabricated decision id.

**On the identifier:** `P1-28-OD-001` is an id in **this phase's own namespace**,
following the `P1-26-OD-###` and `P1-27-OD-###` precedent. It is **not** a
`P1-OD-###` allocation and must not be read as one. If the Owner records this
decision, the number the Owner assigns supersedes it.

---

## The seal, and how to prove it can fail

`docs/phase-1/phase-1-28/evidence/evidence-manifest.json` records a SHA-256 over
the **bytes** of every file in the phase directory, derived by walking the tree
rather than from a hand-written list. Regenerate with `npm run evidence:p1-28`;
check with `npm run validate:p1-28-evidence`.

**What it proves:** an evidence document cannot be edited without the manifest
changing in the same diff. Digests are over bytes, so an encoding change counts
as a change.

**What it does NOT prove:** this is not a tamper-proof seal. Anyone able to edit a
document is able to re-run the generator and commit both. It removes **silent**
revision, not revision.

### The seal is now bound to the repository

**The first revision of this seal never invoked `git`.** `candidateBinding`
tested `FINAL_CODE_SHA` with `/^[0-9a-f]{40}$/` and compared the two halves of
the package with each other; the tier figures were copied into
`closure-candidate.json` and verified against nothing. A final material review
put that to the test and it failed in the two ways it was built to prevent:

- replacing the candidate with `deadbeef…` — forty hex characters naming no
  object in this repository — **in both halves** produced
  `evidence manifest in sync … candidate deadbeef`, exit 0, and every test green;
- setting `tiers.unit.passed = 3, failed = 812` while leaving
  `provenance: "LOCAL_AND_HOSTED_AGREE"` also passed.

Well-formedness is not existence, and two documents agreeing is not evidence
about a repository. What the gate now computes, on every invocation:

| Binding                  | How it is established                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the candidate **exists** | `git cat-file -e 6392ccb4^{commit}`                                                                                                                                                                                                                                                                                                                                                      |
| its **tree**             | `git rev-parse 6392ccb4^{tree}` must equal the recorded `9a4cd553e7fe1501b9a340a7c4d86d125bdc2ad3`                                                                                                                                                                                                                                                                                       |
| the **base branch**      | `git rev-parse --verify refs/remotes/origin/develop^{commit}`, tried before `refs/heads/develop` and the bare name, and RECOVERED from the merge ref's own base-side parent when no ref resolves. A base that can be found neither way makes the successor set UNKNOWN and the gate fails **closed**                                                                                     |
| the **head under test**  | `git rev-list --parents -n 1 HEAD`. Ordinarily HEAD itself; when HEAD is a two-parent merge with one parent that CONTAINS the candidate and one that does not, and no content of its own, this branch's side of that merge — printed, never substituted quietly. Classified by the candidate, so it needs no base ref; cross-checked against one when there is one                       |
| its **ancestry**         | `git merge-base --is-ancestor 6392ccb4 <head under test>`                                                                                                                                                                                                                                                                                                                                |
| **product identity**     | `git diff --name-only 6392ccb4..<head under test> -- apps supabase` must be empty — computed, where the package used to assert it in a sentence                                                                                                                                                                                                                                          |
| **successors**           | `git log <head under test> --not 6392ccb4 <base>`, every executable commit of which must be named by id; documentation-only ones are printed. The base is subtracted because a commit `develop` took after the freeze is not this phase's                                                                                                                                                |
| **local tier figures**   | `git show <ledger commit>:…/local-run-ledger.json`, matched field by field, plus the measured head either executable-identical to the candidate or a named successor whose drift is declared path by path and compared against `git diff`                                                                                                                                                |
| **hosted tier figures**  | not computable here, so required to be fetchable: run id, job id, head sha, artefact. A head that is not the candidate must declare which of the two it is — an **ancestor**, superseded, listed in `pendingHostedBindings`; or a **descendant** whose `apps/**` and `supabase/**` `git diff` computes to be identical to the candidate's — and must be a commit `git cat-file` resolves |
| **documented claims**    | anchored sentences measured against the tree, and `PROTECTED_REPROOF` citations resolved into the files they name                                                                                                                                                                                                                                                                        |

### The eight rules, each of which can be made to fail

Every rule fires in exactly one function, `judge`, and the gate drives that
function over a table of **known-bad inputs on every invocation, before it looks
at the tree**. This is not decoration: an adversarial pass once defeated the
P1-27 sibling three ways and it exited 0 each time, because no test named the
reporters and the real tree was sound — so a rule that always returns true and a
rule that works produced identical output.

| Rule             | What it refuses                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| digest **shape** | a digest that is not 64 lower-case hex, or repeats across different files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| digest **bytes** | a digest that is not the hash of the file it names — checked by an oracle that **does not call** `digest()`, because verifying a hash with the function that produced it is `f(x) === f(x)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **reachability** | a sealed document no index cites; a cited document that was deleted; an exemption that outlived its file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **candidate**    | a `FINAL_CODE_SHA` that is not 40 hex characters, or a candidate the prose half of this package does not state                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **blockers**     | an unclosed task this document fails to name, one recorded without a blocker or without an owner, or a closed task still presented as blocked                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **repository**   | a candidate that names no commit, a recorded tree that commit does not have, a candidate that is not an ancestor of the head under test, a product file changed after the freeze, an unnamed executable successor, a successor id in no commit range, a base branch this checkout can neither resolve nor recover, a merge carrying content of its own being unwrapped past, a merge whose base side is on neither side of the base branch, and a `git log` or `git diff` that REFUSED to run being read as an empty answer                                                                                                                                                                                                                                                                                               |
| **tiers**        | figures that do not add up, a local figure the run ledger contradicts, a local figure the ledger cannot carry at all, a measurement head that is neither identical to the candidate nor a named successor with its drift declared exactly, a hosted figure with no run id, job id, head or artefact, a superseded head that names no commit or is no ancestor, a pending binding the package does not list, a decorative pending marker on a binding that is in fact bound, a tier claiming the two halves AGREE while its hosted half is superseded, a run head that this repository does not contain, does not descend from the candidate, or differs from it by a product path, a product diff git refused to take being read as an empty one, and a binding claiming its head both precedes and follows the candidate |
| **claims**       | a sentence the candidate refutes — in a verdict cell, in the CI baseline or on this page — in **both** directions now: one that DENIES evidence the package records, and one that asserts an observation of this candidate while the package records none; and a `PROTECTED_REPROOF` citation that is missing, out of range, or comment-only                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

#### The self-check was itself the defect, and is rebuilt

The previous self-check handed `judge` an analysis a human had already written
by hand — `{ dangling: ['…'] }` — and asked whether `judge` complained. Fifteen
cases drove the candidate rule that way, and not one of them could have noticed
that **nothing in the file ever computed a candidate verdict from a repository**.

`WORLD_CHECK_CASES` now hands the **analysers** a synthetic world — a `git` that
answers from a table, a candidate document, a verdict register, a
`playwright.config.ts` — and each case passes only if the code derives the
failure itself. Seventy-two known-bad worlds run on every invocation. Two of them are cases that must be **ACCEPTED**, because a table of only-bad inputs is satisfied by a `judge` that always returns false: the same tablet sentence against a narrowed config is true and is allowed, and a candidate whose hosted bindings are all pending, declared and computed is sound.

#### The falsifications, run against this tree

1. a candidate SHA naming no object → `the candidate … names no commit in this repository`;
2. a recorded tree the commit does not have → `git rev-parse … is <other>`;
3. a successor touching an executable path and not named → `unrecorded executable successor: <sha>`;
4. a fabricated tier figure → `the package records 3; …local-run-ledger.json at b63fbd62 records 2559`;
5. a fabricated `measurementDrift` list → `declares measurementDrift [scripts/ci/never-existed.mjs]; git diff --name-only d37452ea..6392ccb4 computes […]`;
6. a superseded head naming no commit here → `names no commit in this repository`;
7. a pending marker on a binding that is bound → `is marked describesSupersededHead while the head it names IS the candidate`;
8. a tier claiming both halves agree while its hosted half is superseded → `claims a hosted observation OF THE CANDIDATE while its attestation describes a head the candidate supersedes`;
9. a run cited at a head this repository does not contain → `names no commit in this repository — a head nobody can fetch is not a citation`;
10. a run cited at a head the candidate SUPERSEDES, wearing the forward marker → `does not descend from the candidate … a run at a head the candidate SUPERSEDES must say describesSupersededHead instead`;
11. the same forward citation against a head whose product differs → `where 37 PRODUCT path(s) differ from the candidate … That run measured different software`;
12. a base-branch commit swept in by a merge-ref checkout → judged as the base's, not this phase's, while an unnamed executable successor of **this branch** still fails;
13. a base branch this checkout can neither resolve nor recover → `the successor set is UNKNOWN and this gate fails closed`;
14. a merge ref with no base ref in sight → the base is recovered from its own base-side parent and the range is subtracted all the same;
15. a `git log` that refused to run → `An empty answer from a command that refused to run is not "this branch added nothing"`;
16. a `git diff` that refused to run → `product identity … is UNKNOWN. Unknown is not identical`.

`tests/ci/p1-28-evidence-manifest.test.ts` drives each rule against fixtures in a
temporary directory, so the repository is never mutated, and asserts that the
intact fixture is sound **before** each mutation — otherwise the proof would be
two empty sets agreeing.

---

## What closes this phase

Not this document. **`OWNER ACCEPTANCE: PASS`, returned verbatim by the Product
Owner after testing the running application in real installed Chrome.**

Run the acceptance session on `npm run acceptance:serve` — a **production build**,
never `dev:all`. A development stack compiles route bundles lazily and the API's
authenticator is installed as a side effect of composing the IAM module, so an
acceptance session on a dev stack reports product defects that do not exist:
measured twice on this checkout, `GET /api/v1/receptions` answered 200 while
`GET /api/v1/vehicles` and `GET /api/v1/work-orders` answered 401, and a second
`next dev` process refused a completely different subset.

The Owner-acceptance workspace holds **no business rows** — no customers, no
vehicles, no appointment types, no visits. That is deliberate and permanent
policy, not an oversight: several things a reader would expect to see proved are
asserted instead as the honest **blocked state** the screen actually shows. The
configured half is proved separately, in the same browser run, against a
fixture tenant provisioned at run time through the published management contracts
an administrator would use.
