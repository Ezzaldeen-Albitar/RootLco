<!-- seal: narrative masthead -->

# Phase 1-27 — continuous-integration evidence

**CURRENT PHASE STATUS: OWNER ACCEPTANCE: FAIL.** The phase is not closed, `P1-G27` is not written, `main` is untouched, and P1-28 has not begun. Acceptance is the Product Owner's act against the running application; it is not derivable from any count in this repository and cannot be inferred from silence.

**Classification:** Confidential — Commercial Product and Pilot Planning

Hosted CI on the pull requests this phase has run through. Recorded because a
local green run and a hosted green run prove different things, and neither is a
superset of the other.

Every value on this page is classified in
[`evidence/closing-value-ledger.json`](evidence/closing-value-ledger.json) and
the classes are explained on `clean-room-evidence.md`. A hosted figure is
`HOSTED_ARTIFACT_ATTESTED`: no command in this repository re-derives it, so the
record must name the run, the job or artefact, and the head it describes. The
gate proves that much and says plainly that it proves no more — the observation
itself is collected from the GitHub API during exact-head CI, by a reader of the
run.

<!-- seal: end masthead -->
<!-- seal: current candidate-seal -->

## The current seal — the candidate measurement exists

The section that stood here was headed "What is still to be collected" and said
no hosted run had been taken against the current tree. That was true until the
code candidate froze; the observation has now been taken, on the pull request
itself, and this table is it. The run head is a DOCUMENTATION-ONLY successor of
the candidate: recording a run changes the tree, so the honest unit is the code
candidate, and the equivalence is a derived value in this table — re-derived on
every gate run — rather than an adjective.

| property                                     | value                                                                         |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| `CODE_CANDIDATE_SHA`                         | `501f5f0d48d7b8cafc12dad51f6c501534b66a18`                                    |
| Run head — a documentation-only successor    | `f0804b2c7ad31e08f033f76096d49c5394d69c81`                                    |
| Executable paths changed since the candidate | **0** — derived on every gate run, over the whole span including the run head |
| Workflow run                                 | `31587707846`                                                                 |
| Required checks                              | **21 completed · 0 failed · 0 pending**                                       |
| `ci-gate` decision                           | **Go**                                                                        |
| `ci-gate` job                                | `94088792169`                                                                 |
| `hosted-clean-room` job                      | `94085356719` — success, on its own per-job conclusion                        |
| `Web quality` job                            | `94085356574` — success                                                       |
| `authenticated-browser` job                  | `94085356606` — success                                                       |
| Authenticated tier                           | 229 planned · 225 passed · 0 failed · 4 skipped · 224 executed · 6 spec files |
| CodeQL                                       | **none open** on the analysed refs — both legs completed                      |
| Dependency policy                            | passing — the `dependency-security` check succeeded                           |

The four skips are runtime-guarded no-data cases the suite itself states, and
the per-JOB conclusion on the commit is what every cell above reads — never the
run-level one, which is the mistake this page's own history records. The same
observation, with the same run id, job ids and head, is what
`evidence/lifecycle-ledger.json` carries under `CANDIDATE_HOSTED_CI` and
`CANDIDATE_AUTHENTICATED_BROWSER`, and the lifecycle gate refuses either record
without the other.

What remains genuinely uncollectable before the merge:

`PROTECTED_GATE_GO` — PENDING PROTECTED MERGE. `protected-gate` runs only on a
push to a protected branch.

`CODEQL_REPOSITORY_CEILING` — PENDING PROTECTED MERGE. A CodeQL pull-request
analysis is diff-informed and reports against the pull-request ref, so it cannot
establish a repository-wide ceiling. The open-alert statements on this page —
the current run's above and the superseded run's below — are what the analysed
refs carried, and neither is presented as the ceiling.

<!-- seal: end candidate-seal -->
<!-- seal: historical superseded-run -->

> **SUPERSEDED** — an exact-head run, at a head that is no longer the candidate.
> Every figure in this section is excluded from the current seal.

## SUPERSEDED — an exact-head run, at a head that is no longer the candidate

`P1-27-QA-005` asked for hosted-CI evidence at the head under audit and found
none. This was that record, and it is kept as history rather than deleted.

**It is not this phase's closing evidence.** Round five refuted the candidate it
describes, and `clean-room-evidence.md` explains why the measurement is taken
once, against the true final candidate. Until that exists, this page names no
current head — a stale head presented as current is exactly the defect `QA-005`
was raised about, and re-pointing it at a newer head each time the branch moves
would reproduce that defect in a fresher form.

| property           | value                                                                                |
| ------------------ | ------------------------------------------------------------------------------------ |
| Pull request       | #214 → `develop`                                                                     |
| Head at that time  | `356f1a1e937e819b9db94f40a2d6f04f98f9ae39` — **superseded**                          |
| Workflow run       | `31312531302`                                                                        |
| Required checks    | **20 completed · 0 failed · 0 pending**                                              |
| `ci-gate`          | **Go** — 13 governed jobs, every one `accepted: yes`                                 |
| CodeQL open alerts | **0** on the branch, pull-request head and merge refs that analysis covered          |
| Dependency policy  | pass — 0 production advisories, 0 development, 0 prohibited packages                 |
| Secret scan        | pass                                                                                 |
| Container image    | `sha256:a8d1c7af634328f14b03cbfe3b1eea2debfc8001a0974f9276545c47d88e50d4`, 197.2 MiB |

The per-tier totals, the coverage figures and the RLS matrix are recorded once,
in `clean-room-evidence.md`, so the two records cannot drift into disagreeing
about a number.

**The web tier's floor was established from this run**, not from a local one.
Until `356f1a1e` the tier had no `minTests` entry, and every hosted run printed
`no minimum test count is recorded for tier \`web\`, so a shrinking suite would
not be detected`as an annotation that nothing was required to read.

The floor was set to 1180 against a measured 1216.

Why the headroom is 36 rather than 0 or 66 is recorded in
`.github/ci-baselines/test-count-baseline.json`.

Both of those figures belong to that head and to no other. The floor the
repository carries TODAY, and the total the tree runs today, are on
`clean-room-evidence.md` under `DERIVABLE_LOCAL`, where a command decides them
and this gate refuses a disagreement.

<!-- seal: end superseded-run -->
<!-- seal: narrative what-each-tier-adds -->

## What hosted CI adds that local verification cannot

A **clean database**. `validate:seed-state` asserts business tables are empty
before seed execution, and the local machine deliberately holds the
Owner-acceptance fixtures so the Owner can sign in. Only hosted CI can answer
that gate honestly.

A **clean repository**. The Owner's canonical DOCX files sit beside the local
checkout; hosted CI fetches only what is committed.

**CodeQL over the whole analysis**, whose findings are not visible any other way
— see below.

## What local verification adds that hosted CI does not run on every change

**This section used to be headed "…that hosted CI cannot", and said of the
authenticated end-to-end tier that it needs a running Supabase, a running API and
a real account with a real password, "none of which a hosted runner is given".
That was false and is corrected rather than deleted — it is the `H-15` premise, in
the evidence document.** A hosted runner has Docker and the Supabase CLI is a
devDependency of this repository. The `authenticated-browser` job — whose body is
`.github/workflows/_reusable-authenticated-browser.yml` — starts the stack,
bootstraps the real operator and a second tenant, sets the authenticated-tier
environment flag, runs the tier, and fails on a run that collected nothing.

**A second sentence here has since become false and is corrected rather than
deleted, for the same reason as the first.** This section said "no job the
pull-request gate runs executes the tier … the authenticated job runs only on
pushes to `develop` and `main` or by an explicit `workflow_dispatch`. So a green
pull request still does not include it." At this head the reusable workflow is
called from `pr-ci.yml` on every pull request whose head is a branch of this
repository, and `ci-gate` lists `authenticated-browser` in its `needs`;
`scripts/ci/evaluate-ci-gate.mjs` declares the job `alwaysRequired`. A green pull
request from this repository DOES include the tier.

What is still true, and is the reason this section exists at all: **a pull request
from a FORK does not get it.** Standing a Supabase stack, a production API and a
real operator account up on a runner is privileged execution, and untrusted code
is refused it — stated to the gate explicitly, so the skip is recorded as an
ineligibility rather than accepted as a pass. The authenticated-tier environment
flag still gates the tier and the five anonymous Playwright projects still carry
`testIgnore` for that directory, so any run that has not stood the stack up
covers none of it.

<!-- seal: end what-each-tier-adds -->
<!-- seal: historical authenticated-tier-history -->

> **HISTORICAL** — three executions of the authenticated tier, all of them before
> the closing wave. None is an observation of the current tree.

**This tier has passed on a GitHub-hosted runner** — run `31347643485`, 225 tests, 0 failed, against candidate `78c4587`.
The disagreement recorded here as `H-24` is settled, and settled against the
baseline rather than against this page: `.github/ci-baselines/unrun-test-tiers.json`
`hostedObservation` had said run `31337158296` was the only hosted execution of
this tier in the repository's history and that merges stayed blocked until a
readiness race was repaired. The race was repaired and the tier then ran green.
It was decidable after all — from the GitHub run records, which are not in this
tree, which is why the dispute survived a full wave here. All three executions
are now recorded individually in that baseline, each with its run id and job id,
and the job conclusion is read on the commit rather than the run conclusion —
every one of these runs carries a run-level `failure` because other jobs at those
commits were red.

What this section could not claim when it was written — a run observed against
the closing candidate — has since been taken and is recorded in the current seal
above. Every execution in THIS section predates the closing wave, so none of
them is that evidence, and none is cited as it.

<!-- seal: end authenticated-tier-history -->
<!-- seal: narrative neither-is-a-superset -->

Neither tier is a superset. A change that passes one and is never run through the
other has been half-measured.

<!-- seal: end neither-is-a-superset -->
<!-- seal: historical codeql-findings -->

> **HISTORICAL** — three CodeQL findings from PR #198. They are lessons about
> where a finding hides, not statements about the current tree.

## The CodeQL findings, and why each was nearly missed

Three separate lessons in one pull request.

<!-- seal: end codeql-findings -->
<!-- seal: example codeql-ref-illustration -->

> **NON-NORMATIVE** — the refs below are spelled out to show which query surfaces
> a diff-informed alert. They illustrate the behaviour of an API. They measure
> nothing about any tree and are excluded from every seal.

**A high-severity alert invisible from the branch ref.**
`js/remote-property-injection` in `normalizeCriteria`. Querying
`/code-scanning/alerts?ref=refs/heads/feature/…` returned **zero**; the same
query against `refs/pull/198/head` returned the finding. A CodeQL pull-request
analysis is diff-informed and reports against the pull-request ref, so the
obvious ref to query is the one that reports clean.

<!-- seal: end codeql-ref-illustration -->
<!-- seal: historical codeql-remaining-findings -->

> **HISTORICAL** — two further findings from PR #198.

**A high-severity alert raised against the phase's own new gate.**
`js/incomplete-url-substring-sanitization` in `check-p1-27-frontend.mjs` —
the self-test that proves the comment stripper does not truncate a line at its
own `//` did so with `includes()` of a full URL. The rule is right in general and
the property never needed the host; all three copies now assert on the tail.

**A `note`-severity finding invisible through the alerts API entirely.**
`js/unused-local-variable`: two dead imports in the acceptance bootstrap. All
three refs — branch, PR head, PR merge — returned **zero** open alerts, because
GitHub does not surface a note-severity result as an alert. GitHub's own CodeQL
check reported the run as **SUCCESS**. The repository's policy step reported
**No-Go**, because its ceiling is zero _open findings_ rather than zero _high_
findings.

The finding was readable only by downloading the run's SARIF artifact and the
policy JSON beside it. An investigation that trusted the alerts API would have
concluded the tree was clean while the gate said otherwise — which is precisely
the failure mode the baseline's own note describes.

<!-- seal: end codeql-remaining-findings -->
<!-- seal: narrative reading-a-red-gate -->

## A red `ci-gate` that means nothing

Pushing a new commit while a run is in flight makes GitHub **cancel** the older
run. The long jobs — `hosted-clean-room`, `Web quality`, `integration-tests`,
`Docker build validation` — are the ones still going when that happens, so they
show `cancelled`, and `ci-gate` then reports `failure` because it cannot see
green from jobs that never finished.

This happened three times in this phase and each time the honest reading is "that
SHA was abandoned", not "that SHA is broken". The distinguishing evidence is
mechanical: a real failure has a `failure` conclusion on a _specific_ job with
output; a supersession has a cluster of `cancelled` long jobs and a `ci-gate`
failure with no failing job beneath it.

The only run that matters is the one on the **current branch head**, and it must
be allowed to finish before the branch is merged. `/commits/{sha}/check-runs` for
the head SHA is the query; a green run on an earlier SHA proves nothing about
what merges.

## Two API facts worth keeping

`/actions/runs` does **not** list every check that reports on a commit. Query
`/commits/{sha}/check-runs`, which is what the watcher in this phase used.

`gh` is not installed on this machine. `git credential fill` yields the same
token the CLI would use; it is held in process memory and never printed.

<!-- seal: end reading-a-red-gate -->
