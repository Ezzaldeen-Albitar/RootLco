# Adversarial review record

Initiative §40. Three independent read-only reviewers, each given a distinct
lens and told to be hostile. None could modify a file.

| Reviewer                          | Scope                                                                                                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actions security and injection    | shell injection, permissions and token scope, cache poisoning, artifact leakage, third-party action provenance, CI bypass paths, `pull_request_target`, the composite action's exact-SHA claim |
| Gate correctness and test honesty | the full job-result state space, change-detection correctness, skip handling, coverage honesty, test-result honesty, and whether the gate's own tests are vacuous                              |
| Database, container, supply chain | migration replay, RLS matrix completeness, container policy, dependency policy, secret patterns, backup/restore, mutation targets, idempotency attribution                                     |

**Every finding below was personally reproduced before it was fixed.** Where a
reviewer's claim did not hold, that is recorded too.

---

## Fatal — the pipeline could not have run

### AR-01 · a local composite action with no prior checkout

Every job's first step was `uses: ./.github/actions/setup-project`. A local
`uses: ./…` is resolved from `$GITHUB_WORKSPACE`, which is empty when a job
starts, so all **21 call sites** would have failed with _"Can't find
'action.yml'"_.

Reproduced by scanning every workflow for a preceding `actions/checkout`: zero
of 21 had one.

Fail-closed — a job that errors makes `ci-gate` return No-Go — so it was never a
bypass. Rated fatal because it means **nothing in this change had ever
executed**, and the rollout plan's "expected first-run failures" table did not
anticipate it.

**Fixed**: a sparse, shallow checkout of `.github/actions` precedes each call.
The composite then performs the real exact-head checkout and replaces the
workspace.

---

## High — green results that were not earned

### AR-02 · an unrecognised `task` reported success over an empty job

Every substantive step in `_reusable-node-quality.yml` and
`_reusable-database-assurance.yml` is gated on `inputs.task`, with no validation
and no else-branch. A caller typo — `unit_coverage` — would check out, run
`npm ci`, skip every step, upload an empty artifact (`if-no-files-found:
ignore`) and exit **success**. `ci-gate` would read that success and say Go.

**Fixed**: each reusable workflow validates its task in its first step.
`_reusable-security.yml` gained an ungated `validate-task` job, because its
three `if:`-gated jobs would otherwise leave the outcome to skip semantics
rather than an assertion.

### AR-03 · a falsy `needs` entry produced Go

`evaluate-ci-gate.mjs` pushed `{result: 'absent', accepted: false}` and
`continue`d **without recording a failure**, while the decision was derived from
`failures.length` alone. Reproduced: `needs['secret-scan'] = null` →
**Go, 0 failures, secret-scan unaccepted**.

Reachable through any writer that rewrites the needs document —
`protected-classification.mjs` does exactly that.

**Fixed**: the branch records a failure, and the decision now additionally
requires every governed job to be positively accepted.

### AR-04 · a new advisory absorbed by an existing transitive waiver

In `dependency-policy.mjs`, root advisories were collected with
`.filter(Boolean)`, dropping any whose `via.url` carries no GHSA identifier —
then `matched.every(Boolean)` was evaluated over the _surviving_ subset. A new
HIGH advisory against `minimatch` with an unidentified root would be waived by
the `brace-expansion` exception, and the artifact would record an affirmative
but false `transitiveVia`.

Two further defects in the same block: only the _first_ matched exception was
validated for expiry and completeness, and `e.id === advisory.ghsa` matched
`undefined === undefined`, so an exception missing `id` waived every
unidentified advisory in the tree.

**Fixed**: every root must be identified or the node is unwaived; every matched
exception is validated; `e.id &&` guards the comparison.

### AR-05 · an `npm audit` error object read as zero advisories

`npm audit --json` writes `{"error":{"code":"ENETUNREACH",…}}` and exits 1 on a
registry failure. The workflow captures the file with a fallback, so the error
object parsed cleanly, `vulnerabilities` was `{}`, and both trees reported zero.

Reproduced: an error document produced **"Dependency policy: pass"**. After the
fix it exits 2 with _"An audit that did not run is not an audit that found
nothing."_

### AR-06 · the worktree secret scan scanned nothing

It ran in a job that sets `install: 'false'` and has no build step, so `.next`
did not exist. Default roots resolved to two files, and it printed _"No
unallowed credential shapes found."_

**Fixed**: the secret-scan job scans `docs`, `public`, `supabase` — **646
files** — and the **build** job scans its own output — **3715 files**, which is
where an inlined credential would actually be. The scanner now refuses to report
clean below a declared minimum, like every other gate script here.

### AR-07 · the nightly mutation gate was designed to be permanently red

`inventory-read-company-scope`'s replacement only appends a comment, so the
guard is never removed, the mutant is recorded as **survived**, the script exits
1, and `mutation-assurance` is tiered **blocking** — a nightly gate red every
night for a target that was never a real mutation.

**Fixed**: `anchorOnly: true` with the reason recorded in the manifest, counted
separately from kills and never presented as one. The other two targets gained
`expectFailureMatching`, because any non-zero exit — a compile error, a
connection failure — otherwise read as _"the guard is load-bearing"_.

---

## Medium

| ID    | Finding                                                                                                                                                             | Fix                                                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| AR-08 | `src/app/api/**` classified as `frontend`, which is not a `database-security` trigger — a route handler skipped the RLS matrix. **The test had enshrined the bug.** | new rule ahead of `frontend`; test corrected and a route-change job-decision test added                 |
| AR-09 | The `other` category triggered nothing, so an unmatched path (root `middleware.ts`, `.npmrc`, any new config) skipped six jobs including CodeQL                     | fails safe like an empty diff                                                                           |
| AR-10 | The workflow linter never scanned `.github/actions` — the action performing the exact-SHA checkout was exempt from every rule, including SHA pinning                | scanned, with the three job-only rules suppressed for composite actions                                 |
| AR-11 | `WFS-008`/`TH-009` were end-of-line anchored, so `$(cmd \|\| true)` evaded both — and the repository contained two, in the file whose comments forbid the pattern   | widened; both instances fixed; comment lines excluded                                                   |
| AR-12 | A non-numeric coverage tolerance made `delta < -NaN` always false, silencing the ratchet from a one-token edit                                                      | rejected                                                                                                |
| AR-13 | A mistyped critical-module `metric` scored 100% via the "nothing to cover" rule                                                                                     | rejected, plus a zero-total vacuity check                                                               |
| AR-14 | `pathPrefix` was a raw `startsWith`, so `src/server/errors` matched `errors-legacy/`                                                                                | boundary-aware                                                                                          |
| AR-15 | A narrowing coverage `include` list silently shrank what a floor protected                                                                                          | `minMatchedFiles` per rule                                                                              |
| AR-16 | `nightly-gate` treated a **skipped blocking** job as a pass — `skip-slow` produced a green nightly with no restore drill                                            | a skipped blocking job now fails                                                                        |
| AR-17 | `inputs.attest != false` is FALSE on a tag push, so every tag release silently requested no attestation                                                             | keyed on `github.event_name`                                                                            |
| AR-18 | `--min-tests` was implemented and passed by nothing                                                                                                                 | reads a committed per-tier baseline                                                                     |
| AR-19 | Migration immutability was skipped on the protected push — the run a gate record cites                                                                              | compares against `github.event.before` there                                                            |
| AR-20 | The schema-hash comparison could pass over two empty strings                                                                                                        | both sides must match `^[0-9a-f]{64}$`                                                                  |
| AR-21 | `checkNoDeveloperData` omitted `org`, `iam`, `svc`, `rpt`, `shared`                                                                                                 | one shared `MODULE_SCHEMAS` list                                                                        |
| AR-22 | The worktree-clean check excluded `*.json` — every file in `ci-baselines/` and `package-lock.json`                                                                  | root-level evidence only                                                                                |
| AR-23 | `container-policy` passed over an **empty** `Results` array — a distroless base would report a clean image that was never analysed                                  | requires a package-analysing result                                                                     |
| AR-24 | The image history guard omitted `_TOKEN` while the env guard included it; both are name-based, so a URL-embedded credential under an innocuous name passed          | patterns aligned, a value-shaped scan added, and both files redacted before upload to a public artifact |
| AR-25 | "0 unfixable" on a PR was a filter artifact reported as a measurement                                                                                               | reported as **not measured** when `ignore-unfixed` was on                                               |
| AR-26 | `collectEvidence` flattened by basename, so two artifacts with the same filename overwrote — and the gate summary is what a gate record cites                       | first wins, collision recorded                                                                          |

## Low

`setup-project` now resolves a tag before comparing (its assertion previously
failed on the tag input `release-verification.yml` documents) and validates the
ref shape before writing to `GITHUB_OUTPUT`. Four `${{ }}` interpolations moved
out of `run:` blocks into `env:`. `FORCE_RLS_EXEMPT` emptied — two entries were
never consulted and one named a table that does not exist. Partitioned tables
(`relkind = 'p'`) included in the RLS matrix and the empty-business-table sweep.
`preChecks` reads `pg_class` rather than `information_schema`, which lists only
what the connecting role can see. `CODEOWNERS` extended to `scripts/ci`,
`.github/actions` and `.github/ci-baselines`.

---

## Three surviving mutations, now caught

The gate-correctness reviewer identified three mutations that all 98 tests would
have missed. Each now has a test:

1. **Deleting `frontend`/`backend` from the trigger lists** — no job-decision
   test used a `src/app/` path. Added.
2. **Adding a job to `pr-ci.yml` and omitting it from `ci-gate.needs`** — the
   gate is blind to this direction and the test compared `DECLARED_JOBS` to a
   hardcoded array. The test now **reads the workflow** and asserts all three
   lists agree.
3. **Blanking a committed baseline** — no test opened `.github/ci-baselines/`.
   `tests/ci/baseline-integrity.test.ts` runs the real coverage gate against the
   real baseline, so blanking it fails.

---

## Claims that did not hold

Recorded because a review is only useful if its misses are visible too.

- **`ci.yml` cache scoping.** A reviewer noted the legacy workflow uses an
  unscoped `type=gha` cache for both build targets. Correct, and it is why the
  new container workflow scopes per target — but `ci.yml` is scheduled for
  deletion in the rollout plan, so it was not changed.
- **Shell injection.** Both reviewers looked hard and found none. Every
  `github.event.*` reference in the tree is `head.sha`, `base.sha`, `base.ref`
  or `number`.
- **`pull_request_target`.** Absent, confirmed twice.
- **Action pinning.** All 12 third-party actions verified as full 40-hex SHAs
  with version comments; zero tags.

## The structural finding that cannot be fixed here

**AR-27 — the PR gate is self-certifying.** On a `pull_request`, the workflow
file, the composite action, the gate scripts and the baselines _all_ come from
the PR head. A change that weakens a gate and deletes the check that would catch
it, in the same commit, passes — both sides agree on the same truncated list.
This is the P1-20 contract-test failure mode one level up.

It is inherent to `pull_request` and cannot be closed inside the repository. The
mitigations are: `CODEOWNERS` now covers all four surfaces, and
`protected-develop-verification.yml` — which runs _after_ the merge, on the
protected branch, with no change detection and no permitted skip — is the
authoritative record. Required-reviewer enforcement is an owner setting; see
`branch-ruleset.md`.

---

## Result

**Critical unresolved: 0 · High unresolved: 0.**

One structural finding (AR-27) is documented rather than fixed, because it
cannot be fixed here. Everything else on the Critical, High and Medium lists was
reproduced and closed.
