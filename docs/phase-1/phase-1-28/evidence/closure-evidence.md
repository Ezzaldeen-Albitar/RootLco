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

| Binding           | Value                                                                  |
| ----------------- | ---------------------------------------------------------------------- |
| `FINAL_CODE_SHA`  | `7b1252edebb5d7f48451213c71ab832cb44e46b5`                             |
| `FINAL_CODE_TREE` | `1ef831d2ecfcf94d07b73857b7448c3b424faca3`                             |
| Branch            | `feature/p1-28-appointment-vehicle-reception-frontend`                 |
| Pull request      | **#226**, base `develop`, 130 commits ahead                            |
| Subject           | `fix(p1-28): let the seal's own tests survive the package being bound` |

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
build are properties of a **run**, not of a checkout. Moving the candidate moves
what the package is _about_; it never manufactures an observation of it.

**The hosted half has since been taken, separately.** Eleven bindings stood
PENDING when this candidate was frozen. Hosted CI has now run at
`81cbd44bae5f8f64091416019458b3d2b514503e` — the documentation-only commit that
carries the freeze — and **all eleven are bound**; see
[What was PENDING, and what bound it](#what-was-pending-and-what-bound-it).

**On the two names, before anything else.** `FINAL_CODE_SHA` and
`FINAL_CODE_TREE` are the names this package was commissioned under. They are
**not** the P1-27 spelling — that phase says `CODE_CANDIDATE_SHA` for the same
idea — and no file in this repository used `FINAL_CODE_*` before this one. The
mapping is written down in `closure-candidate.json` rather than left for a reader
to infer, because two names for one commit is exactly how a superseded head gets
quoted as a current one.

### What freezing means, and what it does not

Every **local** figure in this package describes **that commit** — not a
successor of it, and not an average of both. The candidate is the newest commit
on this branch that touches an executable path, so **the successor list is
empty**, and every commit after it carries this record and nothing else.

That was not true until now, and the difference is worth stating because it is
what the re-freeze bought. The previous candidate,
`6392ccb4321b004ed12e5d04ad583298da3303dd`, accumulated **twelve** successors,
**five** of them executable and every one a repair to this seal: the PENDING
state, those rules proved against the tree rather than only synthetically, the
forward hosted citation, the merge-ref correction, and a lint rule that read a
callback parameter as a React Hook. Each repair forced a reseal, and any further
repair would have forced another, while the package went on describing a commit
ever further behind the tree hosted CI actually exercises.

Three more repairs have landed since — the unnamed-successor falsification
re-anchored so that re-freezing cannot make it vacuous, a CodeQL HIGH in the
citation resolver where `existsSync` then `statSync` then `readFileSync` asked
whether a path was a readable file and then read it, and the repair this
candidate carries — and **each was answered by moving the candidate rather than
by growing a successor list**. That is the rule this package now follows: while
the product is provably unchanged, the candidate follows the newest executable
commit, and `reFrozenFrom` carries what each move was for.

### Why this one moved: the seal's own tests could not survive being bound

Hosted CI ran at `55b932cb`, a documentation-only descendant of the previous
candidate `3c75f49a`, and every condition the gate imposes on a forward citation
held. The eleven hosted bindings were bindable for the first time — and binding
them took **eight** cases of `tests/ci/p1-28-evidence-manifest.test.ts` red.

That file predated the forward-citation rule and had encoded _"nothing is bound
yet"_ as though it were a rule of its own. It demanded that a non-pending tier
name the candidate **exactly**, with no forward branch at all; it **searched**
the package for a pending tier and guarded itself with
`expect(pendingTier).toBeDefined()`; it asserted `supersededBindings.length > 0`;
and it asserted three world flags to the constant `false`. Four of the eight were
**structurally unsatisfiable** the moment anything was bound, because no package
can be both bound and pending at once.

`7b1252ed` fixes the tests, not the rules, and the distinction is the whole
point:

- the tier rule now defers all four conditions to `pendingBinding` — the one
  place that asks `git` — so it is exactly as strict as the gate and not one
  condition looser;
- both anti-vacuity guards are **kept** and re-pointed onto **constructed**
  worlds, each asserted sound before it is mutated;
- the world flags are cross-checked against the package's own
  `pendingHostedBindings` declaration, which `worldFrom` never reads.

The file now passes **in both worlds** — 79/79 with the package pending and
79/79 with it bound — which is the property that lets a candidate be bound at
all. Nothing was removed: 72 known-bad worlds still run on every invocation and
`selfCheck` still reports 0 failures.

**What it cost.** The two local tiers, re-measured here — and the unit tier
**moved, 2559 → 2560**, because the fix adds one case. And it cost the eleven
bindings that had just been bound: `55b932cb` is now a head this candidate
supersedes, so all eleven returned to **PENDING**. That is the rule working, not
a regression — a run at an ancestor cannot describe this code.

**Re-freezing at the head ends the treadmill, and it costs nothing in product
terms, which is checkable rather than asserted:**

```text
git diff --name-only 6392ccb4321b004ed12e5d04ad583298da3303dd..7b1252edebb5d7f48451213c71ab832cb44e46b5 -- apps supabase
```

returns **nothing**. Not one file under `apps/**` or `supabase/**` differs
between the two candidates, so the product this package describes is the same
product it has always described; only the seal's own machinery moved. A
re-freeze across a **non**-empty product diff would be the opposite of this — it
would be re-pointing the record at software nobody had measured — and that is the
case the gate refuses and did refuse, at `38afa5c2`.

**What the eight once-named successors are now.**
`e2dd8b8d8ba6ce124c464409fbe827ceea82b1fc`,
`8f8c5cfaa8cbb25693affa6422e957fc4f914ab6`,
`f4ba407485a916a2848f2de7bf6df090d18840b1`,
`d37452ea888d4442f161295bc472df39d21ad15d`,
`34b3fca5706ea037c46f4a1d16f5dfe2c4d194b1`,
`b5e9919b0006a68fa694d650336c62f17095173c`,
`3c75f49a01e35b507461bf0929b0046e7140860a` and
`7b1252edebb5d7f48451213c71ab832cb44e46b5` — the last of which **is** the
candidate — are all **ancestors** of it, so they are successors of nothing and
the gate refuses a recorded successor that is not in the computed range. They are
kept in `closure-candidate.json` under `reFrozenFrom`, with what each one did
and why, rather than deleted: removing the record of what was once named is the
half-update this gate exists to catch. The three the candidate before _them_
named — `1b9811c8`, `89720963` and `5e97dc92` — are recorded in the same
place for the same reason.

**What the re-freeze itself did NOT buy.** Not one hosted figure. A hosted run is
taken by CI at a head and this workstation cannot take one at any candidate, so
at the moment of each re-freeze every hosted binding was still **PENDING**. That
is worth keeping on the page now that the bindings are closed, because the two
acts are independent and only one of them is evidence: re-freezing changed what
the package is _about_, and a **separate** hosted run — not this section — is
what made the package able to say anything about it.

**The rule, and the single hole it cannot close.** Every commit in
`git log 7b1252ed..HEAD` that touches an executable path — anything outside
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

## The regression statement — all five tiers, and where each was taken

**All five tiers carry a measurement of this candidate's product. Two carry two —
a local one at the candidate itself and a hosted one at the product-identical
successor — and they agree.**

| Tier                     | Tests       | Passed | Failed | Skipped | Files   | Where it was taken                                              |
| ------------------------ | ----------- | ------ | ------ | ------- | ------- | --------------------------------------------------------------- |
| Root unit and foundation | 2560        | 2560   | **0**  | 0       | 98      | **local** at `7b1252ed` **and hosted** job `94714715510`        |
| Web component and DOM    | 2726        | 2726   | **0**  | 0       | 98      | **local** at `7b1252ed` **and hosted** job `94714715522`        |
| Backend integration      | 2004        | 2004   | **0**  | 0       | 86      | **hosted** job `94714715651` — not takeable on this workstation |
| Database and RLS         | 1647        | 1647   | **0**  | 0       | 139     | **hosted** job `94714715750` — not takeable on this workstation |
| Authenticated browser    | 370 planned | 365    | **0**  | 5       | 7 specs | **hosted** job `94714715648` — not takeable on this workstation |

**One run, one head, all five tiers: 9307 cases planned, 9302 passed, 0 failed, 5
skipped.** That total is printed here for the first time, and only because it is
now true of a single observation: every one of the five hosted jobs above belongs
to run `31783658759` at head `81cbd44b`. While three tiers were pending, adding
the five together would have produced a number nobody had ever observed at one
head, and this page said so and refused to print one.

**The browser skip count moved, 4 → 5, and it is not a code change.** The
candidate touches nothing under `apps/**`. The extra skip is
`a dialog traps focus and returns it, signed in` in
`authenticated/accessibility.spec.ts` under `authenticated-en`, and it is a
**conditional** skip taken inside the test body: the case opens
`/en/administration/users`, counts the dialog openers, and calls
`test.skip(true, 'this screen exposes no dialog opener for the current permission
set')` when it finds none. Its condition is about the acceptance workspace the run
provisioned, not about the tree, so it can differ run to run at an identical
commit — and it did. It is recorded rather than smoothed over, because a moving
skip count is exactly the shape that hides a case which measured nothing.
**No P1-28 case is skipped**, which is checked per test entry, not inferred: all
141 entries owned by the phase spec carry status `expected`.

The unit figure **moved, 2559 → 2560**, and it moved because of the candidate
itself: one case was added to `tests/ci/p1-28-evidence-manifest.test.ts`. That
value is reconciled where it actually lives rather than only in the tier record —
`CR-A-UNIT-TESTS-ROW` in `docs/phase-1/phase-1-27/clean-room-evidence.md`, and
**both** of its twins in `closing-value-ledger.json`, the `locator` line and the
`value`. A locator left at the old text is a binding that resolves to nothing.

### What is measured here, and what is measured only on a runner

The **backend** and **database** tiers are **not runnable on this workstation**
and never were: both need a running PostgreSQL with all 120 migrations applied,
which this machine does not host. The **browser** tier needs the full acceptance
stack. That has not changed and is why none of the three carries a local half.
What changed is that their hosted half now describes **this** code.

Two arguments this page used to make, and no longer needs to:

- `supabase/**` is byte-identical across every head this package has cited, so
  the migrations, the policies and the shape of the 1356-cell matrix could not
  have moved. That reasoning was sound and was **deliberately not** converted
  into a measurement, because the database tier also executes tests outside
  `supabase/**` and an unchanged input is not a fresh result. The tier has now
  been executed, so the inference is retired rather than relied on.
- The same for the dependency audit: `package.json` and `package-lock.json` were
  unchanged, and the page declined to call that a result. The audit has now been
  run.

### Where each figure is checked, and what "checked" means for each kind

| Kind                 | Tiers                      | What the gate does with the number                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **arithmetic**       | all five                   | `passed + failed + skipped` must equal the declared total. The review set `passed: 3, failed: 812` beside `tests: 2475` and the first revision of the gate accepted it.                                                                                                                                                                                                                             |
| **computed**         | unit, web                  | the figures must equal the P1-27 run ledger's, read out of git at a **pinned commit**, and the tier may carry no figure the ledger does not write                                                                                                                                                                                                                                                   |
| **measurement head** | unit, web                  | the head the tier names must be executable-identical to the candidate, or a **named successor** carrying no product drift and declaring `measurementDrift` exactly equal to what `git diff` says. Both tiers name the candidate itself, so the first branch applies and a declared drift would be REFUSED                                                                                           |
| **pending**          | none, now                  | the rule is unchanged and still fires: a record describing a head the candidate **supersedes** must declare `describesSupersededHead`, name a head this repository **contains** and can prove is an **ancestor**, name what replaces it, and appear in `pendingHostedBindings` — a list the gate **derives** and compares in both directions, so it is empty by computation rather than by deletion |
| **run head**         | all eleven hosted bindings | a run cited at a head that is not the candidate must declare `describesProductIdenticalSuccessor`, and that head must be **contained** in this repository, **descend** from the candidate, and differ from it by **no** path under `apps/**` or `supabase/**` — computed, and a diff git refuses to take is UNKNOWN, not empty                                                                      |

### What the local record covers

`docs/phase-1/phase-1-27/evidence/local-run-ledger.json` records the unit and web
tiers at `7b1252edebb5d7f48451213c71ab832cb44e46b5` — **the candidate itself** —
and `5dce31c0a6f7d7d3779db2fbad0ef57b97420aa1` is the commit that carries that
record.
The gate reads that ledger **out of git at the commit that carries it**, through
`git show`, and requires `tests`, `passed`, `failed`, `skipped`, `files` and the
measured head to match this package exactly. It is pinned to a commit because the
ledger **moves**: `--record` rewrites it at whatever head it was last taken at, so
a check against the working copy would go red on the next unrelated re-record and
would then be relaxed rather than fixed.

Neither tier declares `measurementDrift`, because the measurement head and the
candidate are the **same commit** and nothing differs between them. That absence
is **checked, not assumed**: the gate refuses a `measurementDrift` field when
`git diff` computes no drift, exactly as it refuses a missing one when there is
drift to declare. Earlier revisions of this page measured at a named successor
and declared three executable paths; the re-freeze removed the need, and the rule
that policed it is unchanged and still fires.

`suites: 549` and `suites: 651` used to stand beside these figures and have been
**removed**. The run ledger records no suite count, so there was nothing those
numbers could be checked against and nothing that would have noticed them change.

**The hosted halves of these two tiers have now been taken, and they agree.** Job
`94714715510` reports **2560 over 98 files** for the unit tier and job
`94714715522` reports **2726 over 98 files** for the web tier — the same figures
the run ledger records, produced by GitHub-hosted runners on clean checkouts that
share nothing with this workstation. Both tiers therefore declare
`LOCAL_AND_HOSTED_AGREE`, which the gate refuses unless both halves exist: a tier
asserting agreement while its hosted half describes a superseded head is one of
the falsifications run against this tree.

The unit tier is the one worth watching, because it is the only figure that
**moved** with the candidate: 2559 at the superseded head `55b932cb`, 2560 here.
The difference is the case `7b1252ed` adds, and it appears in the hosted reading
as well as the local one — which is the agreement being worth something rather
than two copies of one number.

The web tier is measured a **third** time. `hosted-clean-room` (job
`94714715543`) re-derives it independently at the same head, from its own
checkout and its own install, and `clean-room-web-totals.json` reports the
identical **2726 over 98 files**.

### What no tier measures

No automated tier in this repository observes the product the way the Product
Owner will. Every mocked tier passed a seam this phase shipped dead — the walk-in
intake building `/reception/check-in`, singular, against a wizard mounted at
`/receptions/check-in`, plural — and the browser tier is what found it. That is
the standing reason `OWNER ACCEPTANCE` is required and CI is not sufficient.

---

## What was PENDING, and what bound it

Eleven hosted bindings in this package stood PENDING when this candidate was
frozen. **All eleven are now bound**, to hosted CI at
`81cbd44bae5f8f64091416019458b3d2b514503e`.

| Binding                            | Bound to                                              |
| ---------------------------------- | ----------------------------------------------------- |
| `tiers.unit.hostedAttestation`     | run `31783658759` · job `94714715510`                 |
| `tiers.web.hostedAttestation`      | run `31783658759` · job `94714715522`                 |
| `tiers.backend.hostedAttestation`  | run `31783658759` · job `94714715651`                 |
| `tiers.database.hostedAttestation` | run `31783658759` · job `94714715750`                 |
| `tiers.browser.hostedAttestation`  | run `31783658759` · job `94714715648`                 |
| `hostedCi`                         | runs `31783658759` and `31783658604` — 21 checks      |
| `browserByProject`                 | run `31783658759` · job `94714715648`                 |
| `codeql`                           | analyses `1618296034` and `1618288471`                |
| `dependencySecurity`               | run `31783658759` · job `94714715417`                 |
| `productionBuild`                  | run `31783658759` · job `94714715555`                 |
| `database`                         | run `31783658759` · jobs `94714715656`, `94714715543` |

`pendingHostedBindings.bindings` is now `[]`. **That emptiness is computed, not
declared:** the gate derives the pending set from the documents' own `headSha`
fields and refuses a difference in either direction, so a binding that quietly
described another head would repopulate the list, and a name left in the list
after being bound would fail as an unpaid debt that has been paid.

**Who took it.** The phase coordinator, by running CI at a head that **descends
from** this candidate — in practice the head this branch is pushed to.

**Not "at the candidate", and that is measured rather than assumed.**
`GET /repos/{owner}/{repo}/commits/{sha}/check-runs` returns `total_count: 0` for
`7b1252ed`, and returned `0` for `3c75f49a` and every other candidate this
package has named. CI runs at pushed heads; the record that names a candidate
lands after it. Route 1 below is therefore sound and unreachable, and route 2 is
the one every binding actually takes.

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

All eleven took the second route, and the repository is what says they may:

```text
git merge-base --is-ancestor 7b1252edebb5d7f48451213c71ab832cb44e46b5 81cbd44bae5f8f64091416019458b3d2b514503e
git diff --name-only 7b1252edebb5d7f48451213c71ab832cb44e46b5..81cbd44bae5f8f64091416019458b3d2b514503e -- apps supabase
```

The first holds; the second returns **nothing**. `81cbd44b` is the
documentation-only commit that carries this freeze and it changes no file outside
`docs/` at all, so what CI exercised is this candidate's software.

This is the local rule's escape on the local rule's evidence. It is **not** a rule
that accepts a run at "some head close enough to the candidate" — there is no such
thing, and 37 product files were "close enough" once. A run at a head the
candidate **supersedes** is still refused by it and still stays
`describesSupersededHead`, an ancestor, pending; so is a run at a head this
repository does not contain, and so is a run at a descendant whose product differs
by one path.

**Route 1 is sound and unreachable, which is measured rather than assumed.**
`GET /repos/{owner}/{repo}/commits/{sha}/check-runs` returns `total_count: 0` for
`7b1252ed`, and returned `0` for `3c75f49a` and every other candidate this package
has named. CI runs at pushed heads; the record that names a candidate lands after
it.

What the two superseded citations said — `55b932cb` and, before it, `38afa5c2` —
is kept in `supersededObservations` in `closure-candidate.json`, because deleting
the record of what was once claimed is the half-update this gate exists to catch.

---

## The authenticated browser tier · job `94714715648`

Run **`31783658759`** · job **`94714715648`** · head_sha
**`81cbd44bae5f8f64091416019458b3d2b514503e`** · conclusion **success**.

**Whole tier**, read from the report's own `stats` block: 370 planned · **365
passed** · **0 failed** · **5 skipped** · **0 flaky**.

**Five, not the four the superseded runs reported — and the fifth is worth the
paragraph.** All five sit in `authenticated/accessibility.spec.ts`. Four are the
pair repeated under `authenticated-en` and `authenticated-ar`: the customer
profile and the vehicle profile. The fifth is
`a dialog traps focus and returns it, signed in`, under `authenticated-en` only.

It is a **conditional** skip taken inside the test body, not a `.skip` in the
source: the case opens `/en/administration/users`, counts the buttons that could
open a dialog, and calls
`test.skip(true, 'this screen exposes no dialog opener for the current permission
set')` when it finds none. Its condition is a fact about the **acceptance
workspace the run provisioned** — which identity, holding which permissions — and
not about the tree. This candidate changes one file, under `tests/ci`, and
nothing under `apps/**`; the same commit's code produced four skips at `55b932cb`
and five here. So the count can move between runs at an identical product, and it
did.

It is recorded rather than smoothed over, because a moving skip count is exactly
the shape that hides a case which measured nothing: a skipped test still counts
toward a tier's executed total, and that is how a "0 uncovered" number gets
reported over a case that asserted nothing at all.

**No P1-28 case is skipped**, and that is checked rather than restated: all 141
entries owned by the phase spec carry status `expected`.

Whole-tier shape by project, for the same reason:

| Project                | Planned | Expected | Skipped |
| ---------------------- | ------- | -------- | ------- |
| `authenticated-en`     | 152     | 149      | 3       |
| `authenticated-ar`     | 152     | 150      | 2       |
| `authenticated-tablet` | 65      | 65       | 0       |
| `auth-setup`           | 1       | 1        | 0       |

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

**Both halves of the tablet fact now hold at this product.** The
`authenticated-tablet` project's `testMatch` at
`apps/web/playwright.config.ts:255` names two specs — `administration` and
`appointments-and-receptions` — which is a fact about the **config**, unchanged
at this candidate: documents written before the tablet merge (`88af8acd`, merged
as `4c6ccfe7`) that say otherwise remain wrong. The 47 executed tablet cases were
a fact about a **run** at a superseded head, and are now a fact about a run at
this candidate's product.

---

## Hosted CI · 21 checks at `81cbd44b`

**21 checks · 21 success · 0 failure · 0 pending**, at head_sha
`81cbd44bae5f8f64091416019458b3d2b514503e`. Taken from
`GET /repos/{owner}/{repo}/commits/{sha}/check-runs?per_page=100` — the
per-commit endpoint, because `/actions/runs` does not list every check — and the
conclusions were counted from that response rather than read off a run-level
verdict.

**Twenty-one checks, two workflow runs, and an earlier revision of this page was
wrong about it.** `PR CI` (run `31783658759`, `.github/workflows/pr-ci.yml`,
event `pull_request`, attempt 1) contributes **seventeen**, including the
required `ci-gate`. `CI` (run `31783658604`, `.github/workflows/ci.yml`, same
event, same attempt, same head) contributes **four**. The `CodeQL` check is
published by the github-advanced-security app and carries **no** Actions run id
at all — its `details_url` is `/runs/{id}`, not
`/actions/runs/{run}/job/{job}` — so it names none, and its analyses are cited
below instead. Each row therefore carries the run it belongs to, parsed from that
row's own `details_url`.

**One check had to be read twice, and this page says so.** `CodeQL` first
completed **`neutral`** at 08:24:02 with _"1 configuration not found"_, because
only the `actions` analysis had uploaded by then and the `javascript-typescript`
job was still running. It flipped to **`success`** once analysis `1618296034`
arrived at 08:26:03. A `neutral` conclusion is **not** a success and was not
recorded as one; the check was allowed to settle and then read again.

| Check                                                   | Job id        | Run           | Conclusion |
| ------------------------------------------------------- | ------------- | ------------- | ---------- |
| `ci-gate` — **the single required check**               | `94718462967` | `31783658759` | success    |
| `CodeQL`                                                | `94714889097` | —             | success    |
| `application-build / build`                             | `94714715555` | `31783658759` | success    |
| `code-security / code-security (javascript-typescript)` | `94714715655` | `31783658759` | success    |
| `integration-tests / integration-tests`                 | `94714715651` | `31783658759` | success    |
| `container-security / container-security`               | `94714715645` | `31783658759` | success    |
| `unit-tests-coverage / unit-coverage`                   | `94714715510` | `31783658759` | success    |
| `database-security / security-matrix`                   | `94714715750` | `31783658759` | success    |
| `code-security / code-security (actions)`               | `94714715672` | `31783658759` | success    |
| `secret-scan / secret-scan`                             | `94714715514` | `31783658759` | success    |
| `database-migration-replay / migration-replay`          | `94714715656` | `31783658759` | success    |
| `authenticated-browser / authenticated-browser`         | `94714715648` | `31783658759` | success    |
| `hosted-clean-room / hosted-clean-room`                 | `94714715543` | `31783658759` | success    |
| `Web quality / web-quality`                             | `94714715522` | `31783658759` | success    |
| `dependency-security / dependency-security`             | `94714715417` | `31783658759` | success    |
| `static-quality / static-quality`                       | `94714715494` | `31783658759` | success    |
| `change-detection`                                      | `94714648151` | `31783658759` | success    |
| `Docker build validation`                               | `94714647077` | `31783658604` | success    |
| `Secret and sensitive-file scan`                        | `94714647017` | `31783658604` | success    |
| `Database migrations and RLS tests`                     | `94714647112` | `31783658604` | success    |
| `Lint, types, tests, build`                             | `94714647118` | `31783658604` | success    |

### CodeQL

Two analyses at this exact head, ref `refs/pull/226/head`, selected by matching
each analysis's own `commit_sha` rather than by taking the two most recent:

| Analysis     | Language                | Rules | Results |
| ------------ | ----------------------- | ----- | ------- |
| `1618296034` | `javascript-typescript` | 201   | **0**   |
| `1618288471` | `actions`               | 27    | **0**   |

Open alerts repository-wide: **0**.

**What this does not prove.** A CodeQL run on a pull request is
**diff-informed**. Two analyses returned 0 results and the repository carries 0
open alerts on any analysed ref, but a pull-request analysis does not by itself
establish the repository ceiling — only a run on a protected ref does. It is
recorded here as the pull-request result it is.

**Why this one matters to this branch in particular.** The candidate two commits
back, `3c75f49a`, existed _because_ of a CodeQL HIGH: `js/file-system-race` at
`scripts/ci/check-p1-28-traceability.mjs:330`, where `existsSync` then `statSync`
then `readFileSync` asked three questions about a path that could stop being a
file between them — and the answer is what a sealed record quotes. Analysis
`1618296034` is a `javascript-typescript` analysis at a head containing that fix,
and it returns 0 results over the same 201 rules that reported it.

### Dependency security · job `94714715417`

Production vulnerabilities **0** · development vulnerabilities **0** · critical,
high, moderate and low all **0** across **830** resolved dependencies (68
production, 706 development, 145 optional). `dependency-policy.json` reports
`ok: true` with 0 blocking advisories on either side and 0 waived; licence policy
clean, no prohibited licence.

### Production build · job `94714715555`

Build **ok**, no failures and no warnings. 239 routes in the manifest against 237
route files on disk; 6249 files emitted; standalone server 37 476 308 bytes
against a committed baseline of 34 367 299, ×1.0905.

These figures are byte-for-byte what both superseded runs reported, and an
identical number arriving from a different head is the one shape a reader should
distrust — so the artefact's provenance was checked rather than assumed:
`GET /actions/artifacts/9212659547` reports `workflow_run.head_sha` = `81cbd44b`.
Here the identity is expected: the candidate changes one file under `tests/ci`,
which the production build does not compile.

### Database · jobs `94714715656` and `94714715543`

`database-migration-replay` applied all **120** migrations in the tree to an
empty database — `migrationsInTree` 120, `migrationsApplied` 120, 0 failures —
and recorded **242** tables, 516 functions, **631** policies, 543 triggers and
**0** `SECURITY DEFINER` functions. Seven tables hold rows and every one is a
structural catalogue (`iam.permissions`, `inv.units_of_measure`,
`sal.payment_methods` and the four `wo.*` state and transition tables); no
business table is populated, which is the standing no-fake-data policy holding.

`hosted-clean-room` re-applied them at the exact SHA from its own checkout and
re-derived the RLS matrix independently: **1356 cells** over 113 tables in 7
schemas, `ok: true`, 0 failures, 0 advisories. The two agree on the schema hash
to the character —
`f6b4f023d9e6b1e7d823dac4e5550379202a216ab1ae1fe9e5a2826703061f79` from the
replay, and the same value in the clean room's `schema-hash-before.txt` **and**
`schema-hash-after.txt`.

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
| the candidate **exists** | `git cat-file -e 7b1252ed^{commit}`                                                                                                                                                                                                                                                                                                                                                      |
| its **tree**             | `git rev-parse 7b1252ed^{tree}` must equal the recorded `1ef831d2ecfcf94d07b73857b7448c3b424faca3`                                                                                                                                                                                                                                                                                       |
| the **base branch**      | `git rev-parse --verify refs/remotes/origin/develop^{commit}`, tried before `refs/heads/develop` and the bare name, and RECOVERED from the merge ref's own base-side parent when no ref resolves. A base that can be found neither way makes the successor set UNKNOWN and the gate fails **closed**                                                                                     |
| the **head under test**  | `git rev-list --parents -n 1 HEAD`. Ordinarily HEAD itself; when HEAD is a two-parent merge with one parent that CONTAINS the candidate and one that does not, and no content of its own, this branch's side of that merge — printed, never substituted quietly. Classified by the candidate, so it needs no base ref; cross-checked against one when there is one                       |
| its **ancestry**         | `git merge-base --is-ancestor 7b1252ed <head under test>`                                                                                                                                                                                                                                                                                                                                |
| **product identity**     | `git diff --name-only 7b1252ed..<head under test> -- apps supabase` must be empty — computed, where the package used to assert it in a sentence                                                                                                                                                                                                                                          |
| **successors**           | `git log <head under test> --not 7b1252ed <base>`, every executable commit of which must be named by id; documentation-only ones are printed. The list is EMPTY at this candidate, which is the newest commit touching an executable path. The base is subtracted because a commit `develop` took after the freeze is not this phase's                                                   |
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

#### The property that makes a candidate bindable at all

**`tests/ci/p1-28-evidence-manifest.test.ts` passes 79/79 with this package
PENDING and 79/79 with it BOUND.** That sentence is the load-bearing one on this
page, and it was not true until `7b1252ed`.

The seal's own suite must be indifferent to which of the two states the package
is in, because **both states are ordinary and both recur**. A package is PENDING
on the head that first carries a new candidate — no run has been taken at a
descendant of it yet. It is BOUND on the head that records the run which
measured it. Every cycle of this phase passes through both, in that order.

A test that hard-codes either state makes the other unreachable. That is not a
theoretical risk: this file previously asserted `hostedCiRecorded === false`,
_searched_ the committed package for a pending tier, and required
`supersededBindings.length > 0`. Four of its cases were **structurally
unsatisfiable** the moment anything was bound — no package can be both bound and
pending — so binding and freezing had become **mutually exclusive**, and a phase
whose seal cannot be bound and frozen at once can never close. The suite was
green, the gate was correct, and the phase was stuck; nothing reported it,
because a test that cannot pass in a state you never reach looks exactly like a
test that passes.

What removed it was not a relaxation. Every rule kept its strength and moved its
subject: conditions are delegated to `pendingBinding` so the test cannot drift
looser than the gate; anti-vacuity guards are re-pointed onto **constructed**
worlds and each is asserted sound before it is mutated; and world flags are
cross-checked against the package's own declaration, which `worldFrom` never
reads. If a future change makes this suite pass in only one of the two states,
that is a defect in the suite — **not** a fact about the package.

#### The falsifications, run against this tree

1. a candidate SHA naming no object → `the candidate … names no commit in this repository`;
2. a recorded tree the commit does not have → `git rev-parse … is <other>`;
3. a successor touching an executable path and not named → `unrecorded executable successor: <sha>`;
4. a fabricated tier figure → `the package records 3; …local-run-ledger.json at 5dce31c0 records 2560`;
5. a fabricated `measurementDrift` list → `declares measurementDrift [scripts/ci/never-existed.mjs]; git diff --name-only <measured head>..7b1252ed computes […]`;
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
