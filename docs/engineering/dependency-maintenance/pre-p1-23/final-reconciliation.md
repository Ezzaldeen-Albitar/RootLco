# Pre-P1-23 — final deferred-dependency reconciliation

This is a **corrective and final** section appended to the pre-P1-23
dependency-maintenance record. It does not rewrite
[`README.md`](README.md), [`pr-inventory.md`](pr-inventory.md) or
[`overlap-matrix.md`](overlap-matrix.md); those stand as written, including the
parts this section corrects.

The main gate closed with two Dependabot pull requests deliberately left open —
#99 (Vitest 4) and #102 (TypeScript 7) — each with a documented owner, reason
and revisit condition. Leaving them open turned out to be the wrong shape for
the outcome: a permanently red pull request is not a tracking mechanism, it is
noise that trains reviewers to ignore the check column. This section resolves
both, and records the evidence that decided them.

Both were re-evaluated on trees that reflect **current protected `develop`**
rather than on the bots' own check columns. §1 records exactly which tree produced
each verdict, because two of them were measured on the pull requests' own
(provably npm-equivalent) trees rather than literally on `develop`.

## 1. Starting state

|                                       |                                                        |
| ------------------------------------- | ------------------------------------------------------ |
| `origin/develop`                      | `9452697f18724e14a5d18d5e78db2407d124127c`             |
| `origin/main`                         | `17514aaceb2c7eb8799a37915421e8cb9047e091`             |
| Both trees                            | `aba42973f5beea936c5beceffdb568a870c67176` (identical) |
| Open pull requests                    | 2, both Dependabot: #99, #102                          |
| Deployments / environments / new tags | 0 / 0 / 0                                              |
| P1-23                                 | not started                                            |

### The staleness finding, updated

The main gate recorded that all ten Dependabot pull requests were based on
`d9a2c1dc`, 29 commits behind `develop`. **That is no longer the case for these
two.** Dependabot rebased both onto `2423201c` (the #113 merge) at
2026-07-30T09:43Z, so their bases moved forward — but they are still **4 commits
behind** `develop`:

```
9452697  Merge pull request #115  (docs: maintenance gate record)
1ebdf03  docs(maintenance): record the pre-P1-23 dependency and CI maintenance gate
991f986  Merge pull request #114  (ci: complete setup-node, correct pin registry)
fc19b5b  ci: complete the setup-node migration and correct the action-pin registry
```

That gap touches `.github/actions/setup-project/action.yml` and four
documentation files, and **no npm surface** — verified mechanically, not
assumed:

```
git diff --name-only 2423201c origin/develop | grep -E '^(package\.json|package-lock\.json)$'
→ (no match)
```

So each proposal applies to `develop` unchanged, and each is exactly **one line**
of `package.json` against it.

**Exactly which tree produced which verdict**, because an earlier draft claimed
that "every verdict below was produced by re-running on `develop`" and that is not
precisely true:

| Verdict                                                             | Tree it was measured on                           |
| ------------------------------------------------------------------- | ------------------------------------------------- |
| #102 Blocker 1 (install, `npm ls`, peer range, lint, unit)          | the PR's **exact proposed tree**, head `3e4f8832` |
| #102 Blocker 2 (production build) and the typecheck re-confirmation | **`develop` + `typescript@^7`**, freshly resolved |
| #102 build control                                                  | **`develop` unchanged**                           |
| #99 variant A (`npm ci` ERESOLVE)                                   | the PR's **exact proposed tree**, head `072bdce5` |
| #99 variant B (coupled) and all coverage / dependency-gate results  | **`develop` + both packages at `^4.1.10`**        |
| #99 vitest-3 control                                                | **`develop` unchanged**                           |

The two rows measured on a PR tree are equivalent to `develop` for their purpose,
and that equivalence is proved rather than assumed: the 4-commit gap changes only
a composite action and four documents, and touches **no** `package.json` or
`package-lock.json`, so npm resolution and lint behaviour are identical either
way. But "measured on `develop`" and "measured on a tree provably equivalent to
`develop` for this question" are different sentences, and only the second one is
true here.

## 2. PR #102 — TypeScript 7 → **deferred and closed**, tracked in [#117](https://github.com/Ezzaldeen-Albitar/RootLco/issues/117)

Proposed `typescript` `^5` → `^7` (5.9.3 → 7.0.2). Two **independent** blockers,
both reproduced by execution.

### Blocker 1 — no typescript-eslint release accepts TypeScript 7

The **latest published** `typescript-eslint` is `8.65.0`:

```json
"peerDependencies": { "typescript": ">=4.8.4 <6.1.0" }
```

There is **no `typescript-eslint@9.x` on the registry**; the only versions above
8.65.0 are `8.65.1-alpha.*` prereleases. `eslint-config-next@16.2.12` pins
`typescript-eslint@^8.46.0`, so the constraint is held twice over.

`npm ls typescript` → `ELSPROBLEMS`, `invalid: typescript@7.0.2`.
`npm run lint` → **exit 2**:

```
typescript-eslint does not support TS 7.0.
Error: typescript-eslint does not support TS 7.0.
    at .../eslint-config-next/node_modules/typescript-eslint/dist/index.js:52:11
```

Upstream tracking issue
[typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)
is **open**, and describes the work as design exploration, not an imminent
feature.

**A correction.** The main gate's record stated the peer "wants
`typescript@6.0.3`". The actual declared range is `>=4.8.4 <6.1.0`. The
conclusion was right and the specific fact was not; the range is what a future
reader should check against.

### Blocker 2 — Next.js also needs the compiler API

**This blocker was already red in the pull request's own checks; what missed it
was the main gate's record.** An earlier draft of this document said the opposite
— that it "did not appear in the pull request's failing checks" and was
"invisible in the pull request's own check column because `static-quality` fails
first". Both statements were false, and independent review caught them:

- On head `3e4f8832`, the check **`application-build / build` has conclusion
  `failure`**, and its job log contains the identical error at
  `2026-07-30T09:44:08Z` — **before** the local measurement below was taken.
  Four further red checks on #102 are also build failures.
- The stated mechanism was structurally impossible: in `pr-ci.yml`,
  `application-build` declares only `needs: change-detection`, so
  `static-quality` failing cannot suppress it, and `classify-changes.mjs` maps
  `package.json` to the `dependencies` category, which triggers
  `application-build`. The job was required, it ran, and it went red.

What is true, and all that should have been claimed: the main gate's written
record ([`pr-inventory.md`](pr-inventory.md)) named only the eslint failure for
#102, so **the record** missed a blocker its own CI had already found. The
correction matters because the earlier framing took credit for discovering
something CI had surfaced, which inflates this work and understates the checks.

`npm run build`, reproduced locally on `develop` + TypeScript 7:

```
✓ Compiled successfully in 8.5s
  Running TypeScript ...
TypeScript 7.0.2 does not provide the compiler API required by Next.js.
Enable experimental.useTypeScriptCli in your Next.js config to use the TypeScript CLI,
or install TypeScript 6 instead.
Next.js build worker exited with code: 1
```

**Controlled.** `develop` without the TypeScript change built successfully
(`exit 0`) in the same session at an **equally short path — both 50 characters**
(`…/claude/bc/dev` and `…/claude/bc/ts7`). Equal length, not an identical path, is
the property that matters, because the artefact being excluded was a Windows
`MAX_PATH` limit. So the failure is attributable to the compiler.

> **A harness artefact, recorded rather than reported as evidence.** The first
> attempt at this build failed with a Windows `MAX_PATH` Turbopack panic —
> `path length for file ".../[vehicleId]/authorized-parties/[relationshipId]/retirement/route/build-manifest.json" exceeds max length of filesystem`
> — caused by the depth of the scratch worktree, not by TypeScript. It was
> discarded and the measurement re-run at a 50-character path with a control.
> Reporting that panic as a TypeScript 7 failure would have been false, and
> would have hidden the real Next.js blocker underneath it.

### Root cause

TypeScript 7.0 **ships without a programmatic compiler API**. Microsoft's
[TypeScript 7.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
defers a new API to **7.1** and directs tools needing programmatic access to run
side-by-side against the 6.0 API via `@typescript/typescript6`:

```json
{
  "devDependencies": {
    "@typescript/native": "npm:typescript@^7.0.2",
    "typescript": "npm:@typescript/typescript6@^6.0.2"
  }
}
```

Both blockers are that single fact, observed from two consumers.

**That official arrangement was deliberately not adopted.** It aliases package
names, installs two compilers and changes which binary `tsc` resolves to — an
architecture change, not a dependency bump, and outside this gate's
authorisation. Also not done: `skipLibCheck` as a workaround, `any`,
`@ts-ignore`, disabled strict flags, downgraded ESLint rules, unsafe assertions.

### What passes under TypeScript 7

Recorded so the deferral is not misread as the repository being unready:

| Check                                | Result                                             |
| ------------------------------------ | -------------------------------------------------- |
| `npm ci`                             | exit 0                                             |
| `npm run typecheck` (`tsc --noEmit`) | **exit 0 — this repository's source is TS7-clean** |
| `npm run test` (unit)                | exit 0                                             |
| `npm run lint`                       | **exit 2**                                         |
| `npm run build`                      | **exit 1**                                         |

### Disposition

**Temporarily deferred and closed** — disposition 3. Not "superseded": no
replacement carries this upgrade, and saying otherwise would be untrue.

- **Owner:** platform-owner · **Next review:** 2026-10-31
- **Revisit condition:** TypeScript 7 may be reconsidered only when the
  repository's approved typescript-eslint stack officially supports it and the
  complete RootLco CI platform passes without weakening strictness.
- `typescript` remains `^5` (5.9.3) on `develop`.

## 3. PR #99 — Vitest 4 → **deferred and closed**, tracked in [#118](https://github.com/Ezzaldeen-Albitar/RootLco/issues/118)

Tested in both shapes the gate requires: the proposal as written, and a
correctly coupled maintainer variant.

### A. As written — half a coupled pair

`@vitest/coverage-v8@4.1.10` declares `peerDependencies: { "vitest": "4.1.10" }`
— an **exact** peer. #99 moves only `vitest`, leaving `@vitest/coverage-v8` at
`^3.2.4`, so `npm ci` fails outright:

```
npm error Found: vitest@4.1.10
npm error peer vitest@"3.2.7" from @vitest/coverage-v8@3.2.7
npm error Conflicting peer dependency: vitest@3.2.7
```

All 13 red checks failed before executing anything. Reproduced on the current
base. **This half is fixable and is not the reason for deferral** — which is
exactly why the coupled variant had to be tested rather than the PR simply
rejected on its check column.

### B. Correctly coupled — both at 4.1.10

The coupled set is `vitest@4.1.10` + `@vitest/coverage-v8@4.1.10`. No Vitest
workspace or reporting package is declared in this repository, so those two are
the complete set. `@vitest/browser` is an **optional** peer and is not needed.

| Check                                          | Result                              |
| ---------------------------------------------- | ----------------------------------- |
| `npm install` / `npm ci`                       | exit 0 / exit 0 — lock reproducible |
| `npm ls vitest` / `npm ls @vitest/coverage-v8` | clean, both 4.1.10                  |
| Unit tier                                      | **1252 / 1252 passing**, 57 files   |
| JSON result generation                         | produced, 574,775 bytes             |
| Coverage generation                            | produced                            |
| Coverage summary parsing                       | the repository's parser reads it    |
| Test-count gate (`summarise-vitest.mjs`)       | **pass**                            |
| `npm run typecheck` / `npm run lint`           | exit 0 / exit 0                     |
| Mutation harness                               | loads, exit 0                       |
| `npm audit --omit=dev`                         | **0**                               |
| **Coverage ratchet**                           | **fail**                            |
| **`dependency-policy.mjs`**                    | **fail**                            |

#### Blocker 1 — the ratchet stops comparing like with like

Both columns were measured on the same machine, with the same invocation, with
each tier **fully green at 1252/1252**, so the provider is the only variable.

**How to reproduce, exactly.** Both columns come from CI's own coverage command
plus one added flag, `--testTimeout=60000`. The flag is not part of the CI
invocation; it is there because this machine is slow enough that a
filesystem-scanning suite times out at the 5-second default **under either
provider** (see the artefact note below). It changes no threshold and no measured
value — it only stops an environmental timeout from failing the run. In a clean
worktree at the relevant commit:

```
npm ci
npm run test -- --coverage --testTimeout=60000 \
  --reporter=default --reporter=json --outputFile=vitest-unit.json \
  --coverage.reportsDirectory=coverage/unit \
  --coverage.reporter=json-summary --coverage.reporter=json \
  --coverage.reporter=text-summary
node scripts/ci/coverage-gate.mjs \
  --summary coverage/unit/coverage-summary.json \
  --baseline .github/ci-baselines/coverage-baseline.unit.json
```

Run that on `develop` unchanged for the left column, and on `develop` with both
`vitest` and `@vitest/coverage-v8` at `^4.1.10` for the right column. The numbers
below are the `coverage/unit/coverage-summary.json` totals each run produces.
They are stated as reproducible commands rather than as a citation to a private
log, because an earlier draft asserted the left column without publishing
anything a reader could check — and a reviewer reasonably read that as
back-computed from a remembered percentage.

| Metric              | vitest 3.2.7                   | vitest 4.1.10          | Baseline | Δ                |
| ------------------- | ------------------------------ | ---------------------- | -------- | ---------------- |
| files measured      | 19                             | **19**                 | —        | —                |
| lines               | 1382 / **1480** = 93.37%       | 381 / **439** = 86.78% | 93.26%   | **−6.47 pp**     |
| statements          | 1382 / **1480** = 93.37%       | 426 / **501** = 85.02% | 93.26%   | **−8.23 pp**     |
| functions           | 101 / 119 = 84.87%             | 109 / 132 = 82.57%     | 84.75%   | **−2.17 pp**     |
| branches            | 344 / 367 = 93.73%             | 295 / 363 = 81.26%     | 93.61%   | **−12.34 pp**    |
| `coverage-gate.mjs` | **pass**, +0.12 pp on all four | **fail**               |          | tolerance 0.5 pp |

The instrumented **file set is identical at 19 files**, and every
`minMatchedFiles` guard in `coverage-baseline.unit.json` is satisfied — so this
is _not_ the "a coverage include list narrows silently" failure that guard was
written to catch. The line denominator collapses from **1480 to 439 inside the
same files**: the two providers count lines, statements and branches on
different bases.

Two critical-module floors follow it down:

| Critical module                         | vitest 3 | vitest 4   | Floor |     |
| --------------------------------------- | -------- | ---------- | ----- | --- |
| `log-redaction` (`src/lib/logging`)     | 77.78%   | **64%**    | 72%   | ❌  |
| `environment-validation` (`src/config`) | 56.94%   | **34.62%** | 50%   | ❌  |

The same tests pass either way, so this is a **measurement change, not a
coverage loss** — which is precisely why it must not be waved through. The only
routes to green are lowering thresholds or re-baselining onto a denominator that
fell by 70%, and both shrink what the ratchet protects while reporting success.
Neither is permitted here.

#### Blocker 2 — a security exception's fingerprint changes

`.github/ci-baselines/dependency-exceptions.json` waives GHSA-mh99-v99m-4gvg
(`brace-expansion` DoS) for development tooling, pinning an **exact resolved-node
fingerprint**. One of its two nodes is reached via
`@vitest/coverage-v8@^3.2.4 → test-exclude → glob → minimatch → brace-expansion@2.x`.
Under 4.x that path disappears and `dependency-policy.mjs` fails:

```
exception GHSA-mh99-v99m-4gvg records dependency nodes
["node_modules/glob/node_modules/brace-expansion","node_modules/minimatch/node_modules/brace-expansion"]
but the installed tree resolves ["node_modules/minimatch/node_modules/brace-expansion"].
The dependency path changed, so the reachability evidence behind this waiver no longer
describes what is installed.
```

**Controlled:** `dependency-policy.mjs` exits **0 on `develop`** and fails only
with the coupled bump applied, so the failure is attributable.

The change is arguably a security _improvement_ — development high/critical
findings fall from 12 to 9 and one vulnerable node disappears. The gate is
nonetheless working as designed: the waiver is owner-approved with explicit
scope limits — _"this approval does not apply to any new advisory, package,
**dependency path**, production-reachable condition, or expired exception"_ — so
re-approving it for a new fingerprint is an owner governance action, not a
dependency-maintenance one. The exception was left **exact and unbroadened**.

> **Two measurement artefacts, recorded rather than reported as evidence.** An
> initial coupled run showed 3 failing tests and produced **no coverage report
> at all**. Both were my harness, not vitest 4:
>
> - The 3 failures were 5-second timeouts in
>   `tests/foundation/operation-coverage-gate.test.ts`, a filesystem-scanning
>   suite, under load from my own concurrent work. That file passes alone at the
>   default timeout, and **the same timeouts reproduce on `develop` under vitest
>   3.2.7** — so they are environmental, not a regression.
> - The absent coverage report was a consequence of the failed run. With the
>   tier green, the report is produced normally.
>
> A third apparent failure — `dependency-policy.mjs` and
> `dependency-path-proof.mjs` both exiting 2 — was my own invocation error
> (`cannot read production audit at undefined`, `missing --package`). Re-run with
> CI's exact arguments, `dependency-path-proof.mjs` passes and
> `dependency-policy.mjs` produces the real finding above.
>
> None of the three is a reason to defer. Had they been reported as blockers,
> the record would have carried three fabricated failures and understated the two
> real ones.

### Disposition

**Temporarily deferred and closed** — disposition 3.

- **Owner:** platform-owner · **Next review:** 2026-09-30, aligned with the
  waiver's `reviewBy`
- **Revisit condition:** Vitest 4 may be reconsidered only when Vitest and its
  coverage provider can be upgraded as one supported set and the protected
  coverage ratchets pass without lowering thresholds.
- `vitest` and `@vitest/coverage-v8` both remain `^3.2.4` on `develop`.

## 4. Dependabot ignore policy

Both majors are now ignored in `.github/dependabot.yml`, narrowly:

| Entry                 | Scope                              |
| --------------------- | ---------------------------------- |
| `typescript`          | `version-update:semver-major` only |
| `vitest`              | `version-update:semver-major` only |
| `@vitest/coverage-v8` | `version-update:semver-major` only |

What that deliberately does **not** do: it does not ignore patches or minors, it
does not touch unrelated dev tooling, and there is no blanket
`dependency-type: development` ignore.

### Security updates — a claim I got wrong, and the real mechanism

An earlier draft of this document and of the YAML comment stated that "a
`version-update:semver-*` ignore applies to version updates" and so "does not
affect Dependabot **security** updates". **That is false as a general rule**, and
it is corrected here rather than quietly deleted, because it is the kind of
sentence a future maintainer acts on.

From GitHub's options reference, read from the raw source rather than the
rendered summary:

- `## ignore` carries **both** the "Version updates" and the "Security updates"
  markers, and the page's convention statement is: _"All options marked with a
  [shield-check] Security updates icon also change how Dependabot creates pull
  requests for security updates, **except where `target-branch` is used**."_
- `### update-types (ignore)` contains **no** security carve-out.
- The exemption sentence that does exist — _"`update-types` only affects version
  updates, not security updates"_ — sits under `### update-types` (**`allow`**).
  It is an `allow` rule, and the earlier draft transplanted it onto `ignore`.
- The how-to is explicit in the other direction for `ignore`: Dependabot can be
  configured to ignore dependencies "when it opens pull requests for version
  updates **and security updates**".

So why is security coverage not reduced here? Because of a line the earlier draft
never cited: **`target-branch: develop`**. `## target-branch` is marked "Version
updates only", and when it is set, _"Options defined for this
`package-ecosystem` no longer apply to security updates because security updates
always use the default branch for the repository."_ This repository's default
branch is `main`. The npm block is therefore out of scope for security updates
entirely, and the ignores cannot suppress one.

The outcome was safe, but it was safe **by a mechanism the record did not state**
— which is not the same as being right.

### Open question for the owner, not changed here

The same documentation facts mean a Dependabot **security** update for npm
targets **`main`**, not `develop`, and arrives with none of the npm block's
`labels`, `commit-message` prefixes, `groups`, `ignore` or
`open-pull-requests-limit` applied, and outside its pull-request limit. That
interacts directly with ADR-006, which reserves promotion to `main` as a
founders' decision.

The pre-existing comment above `target-branch` asserted the opposite — "Security
updates target the working branch, never `main`" — and has been corrected to
state the documented behaviour. **The behaviour itself is deliberately not
changed in this pull request**, because changing `target-branch` changes where
security pull requests land and is an owner decision, not a maintenance one.
Flagged here so it is a known open question rather than a surprise.

`@vitest/coverage-v8` is included **because** `vitest` is. Its peer on `vitest`
is exact, so ignoring only one half would let the mirror-image half-pair be
proposed and fail `npm ci` identically — which is precisely how #99 arrived.
Ignoring one half of a coupled pair reproduces the bug the main gate spent three
pull requests fixing.

Each entry carries a comment naming its tracking issue and the fact that decided
it. Remove an entry when its issue's revisit condition is met.

## 5. Final state

|                                        |                                                                                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Open Dependabot pull requests          | **0**                                                                                                                                                  |
| Red pull request without a disposition | 0                                                                                                                                                      |
| Tracking issues                        | [#117](https://github.com/Ezzaldeen-Albitar/RootLco/issues/117) TypeScript 7, [#118](https://github.com/Ezzaldeen-Albitar/RootLco/issues/118) Vitest 4 |
| `typescript`                           | `^5` (5.9.3)                                                                                                                                           |
| `vitest` / `@vitest/coverage-v8`       | `^3.2.4` / `^3.2.4` (both 3.2.7) — one supported set                                                                                                   |
| `next`                                 | 16.2.12                                                                                                                                                |
| `react` / `react-dom`                  | 19.2.8                                                                                                                                                 |
| `@supabase/ssr`                        | `^0.12.4`                                                                                                                                              |
| `prettier` / `stylelint`               | `^3.9.6` / `^17.14.1`                                                                                                                                  |
| Migrations                             | 119, no 120                                                                                                                                            |
| Schema hash                            | `a677eb05…` unchanged                                                                                                                                  |
| Production audit                       | 0                                                                                                                                                      |
| `brace-expansion` exception            | exact, unbroadened, unchanged                                                                                                                          |
| P1-23                                  | not started                                                                                                                                            |

### Accepted maintenance containment, re-verified

Every accepted maintenance merge is an ancestor of **both** `develop` and
`main`, by `git merge-base --is-ancestor` (exit 0):

| PR                         | Merge commit | In `develop`       | In `main` |
| -------------------------- | ------------ | ------------------ | --------- |
| #111 actions               | `f0c2486`    | yes                | yes       |
| #112 codeql-action v4      | `27b29da`    | yes                | yes       |
| #113 npm dependencies      | `2423201c`   | yes                | yes       |
| #114 setup-node completion | `991f986`    | yes                | yes       |
| #115 gate record           | `9452697f`   | yes                | yes       |
| #116 promotion             | `17514aac`   | — (targets `main`) | yes       |

Action pins on `develop`: **12 distinct actions, 0 pin mismatches, 0 split
pins**. `setup-node` resolves to one SHA
(`820762786026740c76f36085b0efc47a31fe5020`, v7.0.0) across all **4** direct
`uses:` lines — 1 in the `setup-project` composite and 3 in `ci.yml` — which is
21 composite invocations across 15 workflows plus those 3, the 24 effective call
sites. `github/codeql-action/init` and `/analyze` share one SHA
(`e4fba868…`, v4.37.3).

## 6. What this section corrects

Recorded plainly, because a maintenance record that only documents other
people's mistakes is not worth much:

1. **Leaving two red pull requests open was the wrong shape.** The main gate
   defended it as "kept open deliberately so the upgrade is not forgotten". A
   tracking issue does that job; a permanently red PR just erodes the check
   column. Both are now closed against issues.
2. **The TypeScript peer range was stated imprecisely** as `typescript@6.0.3`.
   It is `>=4.8.4 <6.1.0`.
3. **The Next.js compiler-API blocker was missing from the record, not from
   CI.** The main gate attributed #102 solely to typescript-eslint, when
   `application-build / build` was already red on the pull request with the
   compiler-API error in its log. There are two independent blockers, and the
   written record named one.

## 7. What independent review corrected in THIS section

This document was reviewed adversarially before it was merged, and three of its
own claims did not survive. They are corrected in place above and listed here so
the corrections are not silent:

1. **A false rule about Dependabot security updates** (§4). The claim that a
   `version-update:semver-*` ignore cannot affect security updates was
   transplanted from the `allow` documentation onto `ignore`, where it does not
   hold. Corrected, with the real mechanism (`target-branch`) named, and the
   resulting ADR-006 question flagged for the owner.
2. **A false claim that the Next.js blocker was invisible in #102's checks**
   (§2). It was red on `application-build / build`, with the error in the job
   log, before this work measured it locally. The mechanism offered for the
   invisibility was also structurally impossible. Corrected, and the credit
   moved from "we found it" to "the record missed it".
3. **Unpersisted provenance for the vitest-3 column** (§3). A reviewer read the
   control log, found the first vitest-3 attempt had failed with no coverage
   produced, and concluded the 1382/1480 figures were back-computed from a
   remembered percentage. The figures are genuine — they come from a re-run with
   a raised timeout, and the artefact carrying them is real — but that run's
   output was not written to any log file, so the record cited numbers a reader
   could not check. §3 now states the exact command that reproduces them.

4. **"Every verdict was produced by re-running on `develop`"** (§1). Two of the
   six verdict sets were measured on the pull requests' own trees, not on
   `develop`. They are provably equivalent for the question asked — the 4-commit
   gap touches no npm surface — but the sentence as written was not true. §1 now
   carries a table naming the exact tree behind each verdict.
5. **"The identical CI invocation"** (§3). Both coverage columns added
   `--testTimeout=60000`, which CI does not pass. The comparison between the two
   columns is still like-for-like, and the flag changes no measured value — but
   under CI's exact invocation the coupled tier is **not** green on this machine,
   so "identical CI invocation" and "both tiers fully green" could not both be
   said. §3 now publishes the exact command instead of claiming CI parity.
6. **"At the same short filesystem path"** (§2). The two builds ran at two
   different paths of equal length. Equal length is the property that matters,
   but this was the one paragraph whose job was to prove a path artefact had been
   eliminated, so it now says "equally short path (50 characters)".

Items 1 and 2 were substantive defects. Items 3–6 were imprecision in the
direction that flattered this work: each one made the evidence sound stronger,
more independent, or more CI-faithful than it was. That is the same pattern as
the four false claims in the P1-22 record and the false pin registry in the main
maintenance gate — which is why the corrections are itemised here rather than
smoothed into the prose.

Four of these six also went out in public statements — PR #102's and #99's final
comments, issues #117 and #118, and PR #119's body. Those were corrected in place
or by follow-up comment rather than left standing. 4. **The main gate reported the PR bases as `d9a2c1dc`.** True when written;
Dependabot has since rebased both to `2423201c`. Staleness is a moving fact
and has to be re-measured, not carried forward.
