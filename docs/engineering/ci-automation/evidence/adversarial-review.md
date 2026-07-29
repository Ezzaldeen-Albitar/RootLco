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
The security workflow was later SPLIT into three single-job files (AR-28),
which removes the class entirely: with one job per file there is no task to
mistype.

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

## AR-28 — found by the first hosted run, not by any reviewer

```
Invalid workflow file: .github/workflows/pr-ci.yml#L149
The nested job 'code-security' is requesting 'security-events: write',
but is only allowed 'security-events: none'.
```

**Startup failure. Zero jobs ran.**

A caller’s `permissions:` are the CEILING for every job in the workflow it
calls — including jobs an `if:` would skip. GitHub validates this statically,
before any condition is evaluated. `_reusable-security.yml` held three jobs
selected by `inputs.task`, so the `secret-scan` and `dependency-security`
callers — which correctly granted only what they needed — were rejected because
the file also contained a job wanting SARIF write.

The tempting fix is to grant `security-events: write` to every caller. That
makes it start and hands write scope to the job whose whole purpose is
pattern-matching over untrusted-adjacent text. The real fix is one job per
file: `_reusable-secret-scan.yml`, `_reusable-dependency-security.yml`,
`_reusable-code-security.yml`.

Worth noting honestly: **three adversarial reviewers examined permissions and
token scope in depth and none caught this.** All three read the design as
correct — and by the rules they were reasoning about, it was. The rule they
were missing is one that only shows up when GitHub actually parses the file.
`actionlint` did not catch it either, and neither did the repository's own
workflow-security linter — which is why WFS-011 now exists.

It is now WFS-011, at _critical_, with a test that fails if the rule is
removed.

---

## AR-29 — the AR-01 fix carried its own defect, at all 21 sites

With the startup failure gone, the pipeline reached the runner and every job
died in the same place: `Set up the project`.

```
Dependencies lock file is not found in /home/runner/work/RootLco/RootLco.
Supported file patterns: package-lock.json,npm-shrinkwrap.json,yarn.lock
```

The message points at `setup-node`, which is three steps away from the cause.

AR-01 was fixed by bootstrapping a sparse checkout of `.github/actions` before
each `uses: ./…`, written in **non-cone** mode. The assumption was that the full
checkout inside the composite action would undo it — and `actions/checkout`
does call `git sparse-checkout disable` when given no sparse input, which is
why the design looked sound.

**Against a non-cone repository that command is a no-op.** It leaves
`core.sparseCheckout=true`, restores no file, and reports success. Every job
then ran against a one-file workspace.

Verified rather than argued, by replaying both checkouts locally. File counts are
as measured at `2654f23`; the tree has grown since, which is why no rule or comment
keys on the number:

| bootstrap                    | files after the composite's checkout | `package-lock.json` |
| ---------------------------- | ------------------------------------ | ------------------- |
| non-cone (what shipped)      | 1                                    | absent              |
| cone                         | 1399                                 | present             |
| non-cone + explicit teardown | 1399                                 | present             |

**Fixed** in three layers, because the outer two each failed once already:

1. All 21 bootstraps use cone mode — the default. The line is simply gone.
2. The composite explicitly tears down any sparse state before its checkout,
   so it stays correct for a caller that bootstraps sparsely by other means.
   Exercised in all four workspace states (cone, non-cone, plain, empty); note
   that the obvious teardown exits **5** in cone mode, because git writes the
   cleared flag into the _worktree_ config where `--unset-all` cannot see it.
3. The post-checkout assertion no longer just compares the commit. Being at the
   right commit is not the same as having the tree, so it now counts tracked
   files against files on disk and names the three that must exist. A partial
   workspace fails there, with the cause in the message, instead of three steps
   later in someone else's error text.

It is now WFS-012, at _critical_.

Two findings in a row have now come from the runner rather than from review,
and both were in the _remediation_ for an earlier finding. That is the honest
shape of this work: the fix for AR-01 was never executed before it shipped, and
neither was the fix for AR-28.

---

## The third hosted run — the pipeline finally ran

At `2654f23` the pipeline executed properly for the first time: **seven jobs
green**, six failing, and `ci-gate` correctly returning **No-Go**. Every failure
below is a gate reporting something real rather than infrastructure collapsing,
which is the first evidence that any of this works.

The hosted logs are not readable from here — GitHub requires a signed-in session
to view Actions logs even on a public repository, and this environment has none.
So each failure was reproduced locally instead, and the four causes below are
reproductions, not inferences.

### AR-30 · a gate that could never pass on a runner, by construction

`static-quality` and `hosted-clean-room` both failed on `Repository gates`. All
eleven gates in that step pass in the working copy. In a **clean clone** the
cause is immediate:

```
- RootLco_Phase_1_Development_Plan_recovered_v01.docx
    expected at: ../RootLco_Phase_1_Development_Plan_recovered_v01.docx
    STATUS:      MISSING or unreadable
```

The two canonical Word documents live **outside** the repository by owner
decision, and nothing may copy them in. A hosted runner therefore cannot ever
see them. `validate:canonical-docs` was placed in a hosted step where the only
way to make it green would have been to commit the documents — destroying the
exact property the check exists to protect.

**Fixed** with a `--record-only` mode for CI that verifies what a runner
genuinely can: the reference record parses, every entry has a path, and every
entry carries a real 64-character hash. It is not an escape hatch — a document
that IS present is still compared, and a `pending` or absent hash still fails.
Five tests, each a mutation of exactly one of those properties.

### AR-31 · counting a ledger nothing writes

Both database jobs failed on `Apply every migration from zero`. The migrations
themselves were fine — 119/119 applied cleanly against a local PostgreSQL 17
container, and legacy `ci.yml` passed on the same commit. The next command was
the problem:

```
SELECT count(*) FROM supabase_migrations.schema_migrations
ERROR:  relation "supabase_migrations.schema_migrations" does not exist
```

That ledger is maintained by the **Supabase CLI**, not by this repository's
migration runner. Two places asked the database a question it had no way to
answer — the workflow step, and `postChecks` in `migration-replay-checks.mjs`,
which used it to assert that every migration file actually ran.

**Fixed** by making the claim true rather than deleting the check:
`apply-migrations.mjs` now maintains the ledger, writing each version **inside
that migration's own transaction**, so a rollback takes the ledger row with it.
A ledger written afterwards could record a migration that did not survive.

Safe because the runner already refuses to touch a database holding module
schemas, so it only ever sees a clean one and can never disagree with a ledger
the Supabase CLI is managing. Verified that the added table does **not** move
the frozen schema hash — `schema-inventory` reads an explicit module-schema
allowlist — by measuring before and after: `a677eb05…` both times.

### AR-32 · a real container finding

`hadolint` reported **DL3018** four times: `apk add` without pinned versions.
Reproduced exactly against the same image.

Not silenced with a threshold change, which would have muted every other
warning too, and not a repository-wide ignore. Each site carries a per-line
`# hadolint ignore=DL3018` with the reason recorded once at the first: an exact
Alpine package version disappears on the next `node:22-alpine` patch, so pinning
converts every base-image update into a build failure. What the image actually
contains is established from the SBOM, the Trivy scan of the built image, and
the recorded digest — evidence about the artefact rather than a version string
asserted in advance.

Verified that a **new** unpinned `apk add` is still reported, so the rule stays
live, and that the image still builds.

### AR-33 · a repository setting failing as though it were a code defect

```
Dependency review is not supported on this repository.
Please ensure that Dependency graph is enabled.
```

That is P1-21-A-01 — a setting the owner has not enabled — surfacing as a
blocking dependency failure on a pull request that cannot possibly fix it.

**Fixed** by probing the dependency-graph API first and reporting the state for
what it is. `200` runs the review and lets it block. `403`/`404` records a
warning naming P1-21-A-01, writes it into the job summary and the evidence
artifact, and continues — because the licence deny-list and severity thresholds
are independently enforced offline by `dependency-policy.mjs` in the same job.
**Any other status fails**, so a transient or unknown condition cannot be
mistaken for "the feature is off", and the outcome is never silent.

---

## The fourth hosted run — 11 of 13, and one gate that was wrong

At `9088013` every fix above held on the runner: `static-quality`,
`database-migration-replay`, `database-security`, `dependency-security`,
`integration-tests` and — importantly — **`hosted-clean-room`** all passed.
Only `container-security` failed, and `ci-gate` correctly returned No-Go.

### AR-34 · the CA trust store is not a leaked key

`Nothing sensitive is baked into the image` failed on:

```
/etc/ssl/cert.pem
/etc/ssl1.1/cert.pem
```

Those are the Alpine base image's **public CA certificates**. Every image has
them, TLS needs them, and they are not secret. The rule was matching `*.pem` by
**name**, which is both a false positive here and a false negative for a private
key named `server.crt`.

**Fixed** by replacing the name rule with a content rule: every file in the
image is searched for a PEM private-key header, whatever it is called. `.env`,
`id_rsa`, `.npmrc` and `.git` remain name-based, because there is no legitimate
reason to ship those under any name.

Verified in both directions — clean image passes; a private key planted in a
file called `harmless.txt` is **caught**.

### AR-35 · the base image shipped an affected package, and my own record overclaimed it

Found by running the container job's inventory locally before pushing. The
production image contained:

```
/usr/local/lib/node_modules/npm/node_modules/brace-expansion   2.0.2
/usr/local/lib/node_modules/npm/node_modules/minimatch         9.0.9
```

Not from this repository — `/app` had **zero** matches — but from **npm itself**,
bundled inside `node:22-alpine`. And `brace-expansion@2.0.2` is inside the
GHSA-mh99-v99m-4gvg range: the advisory API gives `<= 5.0.7`, patched only in
`5.0.8`.

So the exception record's `finalContainerReachable: false` was **false as
literally stated**. It had been reasoned about this repository's dependency
tree and quietly meant "not in _our_ node_modules".

**Fixed by making the claim true rather than rewording it.** The runner stage
now deletes `npm`, `npx` and `/usr/local/lib/node_modules/npm`: the container
starts `node server.js` and never invokes a package manager, so this is surface
with no purpose. The image fell from **5497 to 3533 files**, and no copy of
brace-expansion exists in the deployed artifact at all.

The exception record now carries the correction, the discovery, and the
resolution rather than the original claim. The gate additionally asserts three
separate things — nothing forbidden under `/app`, nothing forbidden anywhere
else, and npm absent — so a future base image that reintroduces one fails the
build and **names the base image as the source** instead of sending the next
person to edit `package.json`.

### AR-36 · a new check that could never fail, in the fix for AR-34

The first version of the content-based key scan used
`grep -rl … --exclude-dir=proc`. The image is Alpine, so that is **busybox
grep**, which has no `--exclude-dir`:

```
grep: unrecognized option: exclude-dir=proc
```

It printed its usage message, matched nothing, and exited **0**. A check that
could never fail — the exact defect this pipeline exists to catch, committed by
the person writing the catcher, one edit after writing it.

Caught by hostile-testing the new rule instead of trusting it: the planted key
was not reported.

**Fixed** with `find … -exec grep` (POSIX) and, more importantly, the scan now
reports how many files it examined and **fails if that number is implausible**.
Silence is only accepted from a scan that can prove it ran.

---

## Fifth run green — then an independent review of the fixes themselves

`ca4c594` passed **14/14 with `ci-gate` Go**. Because four of the defects so far
had been in the author's own remediation, the four commits `8740531..ca4c594`
were then handed to **four independent hostile reviewers**, each with a distinct
lens, and every finding was given to a separate agent instructed to **refute**
it. 29 raw findings, 9 verified, 5 confirmed.

The most important one says the same thing as AR-35, one layer further out.

### AR-37 · the same blind spot, one layer out — yarn was still there

The AR-35 fix deleted exactly the three paths its new assertion grepped for, and
grepped for exactly the three paths it deleted. `node:22-alpine` also ships
**Yarn Classic 1.22.22** at `/opt/yarn-v1.22.22` (with `/usr/local/bin/yarn` and
`yarnpkg` symlinks) and **corepack 0.34.6**. Both survived. Both ran as uid 1001
in the built image.

Yarn is a single bundled `lib/cli.js` — 5,320,747 bytes — with
brace-expansion's implementation **inlined**: the `escSlash`/`escOpen`
sentinels, `expandTop`, `isAlphaSequence`, and a literal `"minimatch":"^3.0.4"`.
A reviewer proved it is live code rather than dead text by running, offline
inside the image, `yarn workspaces info` against a `packages/{a,b}` glob and
watching the brace expand.

Every detector was blind to it, because **all of them key on a literal
`/node_modules/<name>/` path segment** and a vendored copy has no such path.
Replaying the gate's arms over a real post-removal inventory produced `bad=0`
while `/opt/yarn-v1.22.22/lib/cli.js` sat plainly in the listing. Trivy reports
`yarn@1.22.22` with zero vulnerabilities without decomposing the bundle.

So `finalContainerReachable: false` was **false again, for the same reason it
was false the first time**. Corepack was worse than what had been removed: it
downloads and executes package managers from the network at runtime.

**Fixed** by removing every package manager — npm, npx, corepack, yarn, yarnpkg
and `/opt/yarn-*` — and asserting in the same Docker layer that none still
resolves, failing the build if one does. The gate now checks for package
managers by **resolving the binary** rather than grepping paths.

The record now also states the limit rather than implying there is none: **a
path inventory cannot prove the absence of vendored code.** That is exactly why
the image ships no package manager at all, instead of relying on a scanner to
find something it structurally cannot see.

Severity was reported `high` and corrected to `medium` by the verifier, which is
right: the entrypoint is `node server.js`, nothing invokes yarn, the advisory is
a DoS needing an attacker-supplied brace pattern, and ADR-012 means there is no
deployment target yet. It is an evidence-accuracy and incomplete-hardening
defect in a record still pending owner approval — not an exploitable hole.

### AR-38 · a status code is not a diagnosis

The dependency-graph probe treated **every** `403`/`404` as "the Dependency
graph is disabled". GitHub returns `403` for rate limits, for
`Resource not accessible by integration`, and for SSO/IP blocks; `404` for a bad
ref. Any of those would have been recorded as a governance gap and the review
silently skipped, with the log asserting a fact about repository settings
derived from a transient throttle.

Found twice over: by a reviewer, and independently by hitting a real
`403 {"message":"API rate limit exceeded…"}` while querying the API by hand.

**Superseded — see AR-41/AR-42 below, and AR-44.** The fix recorded here was
itself replaced twice more; what shipped is described there, not here. At the
time: the tolerated branch must be **positively identified from the
response body**. Verified against five real bodies — only the genuine
"feature disabled" text is tolerated; rate limit, token scope, bad ref and empty
body all fail loudly.

### AR-39 · the counter that could not detect what it was written to detect

The private-key scan's "proof it ran" file count came from a **second,
independent `find`** that never invoked grep — so a total failure of the grep
arm still produced a healthy count. The counter added to catch AR-36 could not
have caught AR-36.

**Fixed**: the count now comes from the same `find … -exec grep` invocation, and
the scan plants a **canary** private key and fails if it cannot find its own
canary. A scanner that cannot find a key it just wrote proves nothing about the
keys it did not find.

### AR-40 · three shell defects in the checks, found by three separate lenses

- **`hits="$(grep -c … || printf 0)"` yields the two-line string `0\n0`**,
  because `grep -c` prints `0` _and_ exits 1. `[ "0\n0" -gt 0 ]` is not a
  comparison — bash reports `integer expected` and returns 2, which `if` reads
  as false. Every clean run took that path for all ten packages in both loops:
  **the verdict was correct by accident**. Fixed with `x="$(…)" || x=0`, which keeps the
  count grep already printed and discards only the status.
- **The "outside `/app`" loop counted _all_ hits** while asserting they were
  "base-image surface … do not fix this in package.json" — so a wholesale `/app`
  leak was reported twice, the second time pointing at the wrong file. That is
  precisely the misdirection the two-loop split was introduced to remove. The
  location is now **measured**, not asserted.
- **`find -type f` never lists symlinks**, and `/usr/local/bin/npm` and
  `/usr/local/bin/yarn` are symlinks — so the inventory arm for them could not
  match even with the package manager fully installed. Demonstrated: a
  reintroduced `yarn` is caught by the new resolve-based check and returns
  **0 matches** under the old path rule.

### AR-41 / AR-42 · the dependency-graph probe took four attempts

Worth recording in full, because the failure mode repeated and the lesson is
about method rather than about this endpoint.

| #   | Rule                                           | Why it was wrong                                                                  |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | any `403`/`404` means the feature is off       | a rate limit or a bad token silently disabled the check                           |
| 2   | the body must SAY the feature is off           | the API replies `404 Not Found`, which says nothing — failed where it should pass |
| 3   | rule out rate limit, token scope, and bad refs | the token-scope pattern included the generic word `forbidden`                     |
| 4   | …with `forbidden` removed                      | the observed reply is exactly `403 {"message":"Forbidden"}`                       |

Attempt 3 caught the precise case the branch existed to let through. GitHub
names a genuine token-scope failure specifically —
`Resource not accessible by integration` — so that is what is matched now, and
the generic word is not.

The only reason any of this was diagnosable is that the error message
interpolates the response body, so the failure annotation carried
`HTTP 403 … : Forbidden`. **Annotations are the only public surface on this
repository's Actions runs**; without the body in the message there would have
been nothing to read. Any check that fails on an external response should print
what it received.

Verified against eight bodies: `Forbidden`, `Not Found`, the documented
feature-disabled prose and an empty body all proceed to the ref probe; both
rate-limit forms, `Resource not accessible by integration` and the SAML SSO
message all fail.

The ref probe itself does **not** false-block fork pull requests. Verified
rather than assumed: `GET /repos/nodejs/node/commits/<head sha of an open fork
PR>` returns **200**, because GitHub makes pull-request head commits resolvable
through the base repository.

## A second review, of the fixes from the first

`d166449` and `c95e8d9` were both **14/14 green with `ci-gate` Go**. The four
commits since the previous review were nonetheless handed to three more hostile
lenses, with every finding given to a separate agent told to refute it. The
reviewers were told outright that the dependency-graph probe had been wrong four
times and to assume the fifth version was wrong too.

It was. So was the container claim — for the third time.

### AR-43 · the absence claim was never achievable, and that is why it kept failing

`finalContainerReachable: false` had been corrected twice: once for npm's
bundled tree (AR-35), once for yarn's vendored bundle (AR-37). It was **still
false**, and this time nothing could be deleted to fix it:

```
/usr/local/bin/node   127,260,816 bytes
  // node_modules/brace-expansion/dist/commonjs/index.js
  escSlash · expandTop · isAlphaSequence            (7 markers)
```

**Node bundles its internal tooling into the executable.** A Node application
image contains Node, so brace-expansion's code is present by construction. Three
corrections had been fixing the wrong claim: the record kept asserting ABSENCE,
which is unachievable, instead of NON-REACHABILITY, which is both true and the
security-relevant question.

Measured in the built image: `require("brace-expansion")` fails with
`MODULE_NOT_FOUND`, and the name is not in `module.builtinModules`. Nothing on
the request path — `node server.js` serving Next.js standalone — performs brace
expansion, and the advisory needs an attacker-supplied brace pattern.

**Fixed by changing the claim, not the image.** The record now states both facts:
`finalContainerCodePresent: true` with the node-binary evidence, and
`finalContainerReachable: false` meaning _not reachable from the running
application_. `dependency-policy.mjs` now says so in the rule itself, so the next
person cannot read the field as an absence claim. The package-manager removal is
kept as real hardening on its own merits — it is simply no longer what the claim
rests on.

### AR-44 · the probe's default was fail-OPEN, which is the opposite of what it claimed

Both exclusions ran on the **extracted** `message`, which is the empty string for
any body that is not JSON with a string `message`. An unreadable body therefore
matched nothing, fell through, and was recorded as "the Dependency graph is not
enabled" — a claim about a repository setting derived from a body that could not
be parsed. A body of `<html>403 Forbidden. Rate limit exceeded.</html>` was
tolerated, because the words were never looked at.

That is the precise opposite of this step's own stated principle. **Fixed**: the
body must be readable before anything is concluded from it, and the exclusions
are additionally matched against the raw bytes. Verified across nine shapes —
`Forbidden` and `Not Found` tolerate; empty, HTML-encoded rate limit, and a
non-string `message` now all fail, as do both JSON rate-limit forms, token scope
and SAML SSO.

### AR-45 · a green pipeline did not notice one of its own scanners had gone blind

The most instructive failure here, because the pipeline reported it as success.

Four accuracy defects the second review flagged but had no budget to verify were
checked by hand; all four were real. One was that `/sbin/apk` resolved while the
container gate printed _"no package manager resolves in the production image"_ —
a false statement inside a security gate. So apk was removed.

**The removal took `/lib/apk/db` with it, and that is the installed-package
database Trivy reads.** Trivy still recognised `alpine 3.24.1` from
`/etc/alpine-release`, so it still produced an `os-pkgs` result — over nothing:

| image                 | os-pkgs packages | os-pkgs vulns |
| --------------------- | ---------------- | ------------- |
| `/lib/apk/db` present | **18**           | 0             |
| `/lib/apk/db` removed | **0**            | 0             |

The two rows are indistinguishable from the outside. "0 OS vulnerabilities"
meant the scanner could see nothing.

**Run 12 (`4520b36`) passed 14/14 with `ci-gate` Go while this was true.** Every
gate agreed the change was sound, including the container job whose own scanner
had been blinded by it. It was found only by asking whether the hardening could
have broken the scanner — nothing in the pipeline raised it, and nothing would
have.

**Fixed** by removing only the binary and keeping the database — apk does not
resolve, no package manager resolves, and Trivy enumerates 27 OS and 48 language
packages — and, more importantly, by making the class detectable: the container
job now **asserts the scan enumerated packages** before accepting its silence.
Verified in both directions; it fails on the blinded image. The JSON scan gained
`list-all-pkgs: true`, without which the report carries no `Packages` array and
the assertion would itself have had nothing to check.

The hardening was still right. The measurement is the argument for it: removing
the package managers took the image from **198 language packages to 48** and
removed **14 real advisories** that ship in stock `node:22-alpine` —
`brace-expansion 2.0.2` (×3), `tar` (×6), `picomatch` (×2), `sigstore`,
`@sigstore/core`, `ip-address`. It simply must not cost the scanner its
eyesight.

The general rule, now enforced rather than believed: **a scanner must prove it
looked at something before its silence is evidence of anything.** The same
principle already governs the secret scanners, which refuse to report clean
below a declared file count, and the private-key scan, which plants a canary it
must find. The container scan was the one place it had not been applied.

### Recorded but not fixed

Four findings reproduced mechanically and were then **refuted as defects** by
the verifier, each for a stated reason: the symlink arm (superseded by the
resolve check), WFS-012's coverage of exotic non-cone spellings, DER/PKCS#8 key
material having no PEM header, and the canary gap (an independent blocking
secret scan already covers that job). Twenty lower-severity findings were not
verified; they are listed in the workflow output rather than silently dropped.

---

## Result

**Critical unresolved: 0 · High unresolved: 0.**

One structural finding (AR-27) is documented rather than fixed, because it
cannot be fixed here. Everything else on the Critical, High and Medium lists was
reproduced and closed.
