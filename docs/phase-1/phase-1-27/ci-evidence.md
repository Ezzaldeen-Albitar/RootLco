# Phase 1-27 — continuous-integration evidence

**CURRENT PHASE STATUS: OWNER ACCEPTANCE: FAIL.** The phase is not closed, `P1-G27` is not written, `main` is untouched, and P1-28 has not begun. Acceptance is the Product Owner's act against the running application; it is not derivable from any count in this repository and cannot be inferred from silence.

**Classification:** Confidential — Commercial Product and Pilot Planning

Hosted CI on PR #198, then on PR #214. Recorded because a local green run and a
hosted green run prove different things, and neither is a superset of the other.

---

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
| CodeQL open alerts | **0**, repository-wide, not merely on this ref                                       |
| Dependency policy  | pass — 0 production advisories, 0 development, 0 prohibited packages                 |
| Secret scan        | pass                                                                                 |
| Container image    | `sha256:a8d1c7af634328f14b03cbfe3b1eea2debfc8001a0974f9276545c47d88e50d4`, 197.2 MiB |

The per-tier totals, the coverage figures and the RLS matrix are recorded once,
in `clean-room-evidence.md`, so the two records cannot drift into disagreeing
about a number.

**The web tier's floor was established from this run**, not from a local one.
Until `356f1a1e` the tier had no `minTests` entry, and every hosted run printed
`no minimum test count is recorded for tier \`web\`, so a shrinking suite would
not be detected`as an annotation that nothing was required to read. The floor is
now 1180 against a measured 1216 — see`.github/ci-baselines/test-count-baseline.json`
for why the headroom is 36 rather than 0 or 66.

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
bootstraps the real operator and a second tenant, sets `ROOTLCO_E2E_AUTH`, runs
the tier, and fails on a run that collected nothing.

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
ineligibility rather than accepted as a pass. `ROOTLCO_E2E_AUTH=1` still gates the
tier and the five anonymous Playwright projects still carry `testIgnore` for that
directory, so any run that has not stood the stack up covers none of it.

**One claim that stood here is now DISPUTED inside this repository, and this
document will not settle it by preference.** It recorded that the tier had
**passed on a GitHub-hosted runner** — run `31347643485`, 225 tests, 0 failed,
against candidate `78c4587`. `.github/ci-baselines/unrun-test-tiers.json`
`hostedObservation` states instead that run `31337158296` is the only hosted
execution of this tier in the repository's history and that it FAILED in the
acceptance bootstrap. Both cannot be true; a GitHub run record is not in this
tree; the disagreement is finding `H-24` in `adversarial-round-five.md`. Either
way, no run has been observed against the closing candidate.

Neither tier is a superset. A change that passes one and is never run through the
other has been half-measured.

## The CodeQL findings, and why each was nearly missed

Three separate lessons in one pull request.

**A high-severity alert invisible from the branch ref.**
`js/remote-property-injection` in `normalizeCriteria`. Querying
`/code-scanning/alerts?ref=refs/heads/feature/…` returned **zero**; the same
query against `refs/pull/198/head` returned the finding. A CodeQL pull-request
analysis is diff-informed and reports against the pull-request ref, so the
obvious ref to query is the one that reports clean.

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
