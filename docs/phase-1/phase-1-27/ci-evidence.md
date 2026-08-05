# Phase 1-27 — continuous-integration evidence

**Classification:** Confidential — Commercial Product and Pilot Planning

Hosted CI on PR #198. Recorded because a local green run and a hosted green run
prove different things, and neither is a superset of the other.

---

## What hosted CI adds that local verification cannot

A **clean database**. `validate:seed-state` asserts business tables are empty
before seed execution, and the local machine deliberately holds the
Owner-acceptance fixtures so the Owner can sign in. Only hosted CI can answer
that gate honestly.

A **clean repository**. The Owner's canonical DOCX files sit beside the local
checkout; hosted CI fetches only what is committed.

**CodeQL over the whole analysis**, whose findings are not visible any other way
— see below.

## What local verification adds that hosted CI cannot

The **authenticated end-to-end tier**. It needs a running Supabase, a running
API and a real account with a real password, none of which a hosted runner is
given. `ROOTLCO_E2E_AUTH=1` gates it, and the five anonymous Playwright projects
carry `testIgnore` for that directory so CI does not go red on a capability that
only exists on the Owner's machine.

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

## Two API facts worth keeping

`/actions/runs` does **not** list every check that reports on a commit. Query
`/commits/{sha}/check-runs`, which is what the watcher in this phase used.

`gh` is not installed on this machine. `git credential fill` yields the same
token the CLI would use; it is held in process memory and never printed.
