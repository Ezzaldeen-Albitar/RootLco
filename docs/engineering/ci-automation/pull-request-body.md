# ci(platform): build comprehensive automated assurance pipeline

## Protected base

- Base branch: `develop`
- Protected base at branch creation: `0f8268ef80a51441625cfe93d037e7c0804f40fa` (P1-21 Inventory Backend, closed Go)
- `origin/main`: `491c4e0882763b5d5864737e63b4e31ca708a6b5` — untouched, and no workflow in this change can touch it
- This is **not** P1-22. No business functionality is added, no migration is added, no phase is started.

The final reviewed SHA is recorded in the gate record after merge, not here. A
document that transcribes its own commit's SHA is false the moment it is
committed — the lesson P1-21 paid for.

## What this replaces

`ci.yml` proved the repository's commands pass. It did not prove the tree is
sound. The current-state audit
([`current-state-audit.md`](current-state-audit.md)) records 21 findings; these
shaped the design:

| ID     | Finding                                                                                                                                       |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| CSA-01 | `cancel-in-progress` on a shared PR/push concurrency group silently cancelled protected-push runs — the runs every gate record cites as proof |
| CSA-02 | No workflow uploaded an artifact anywhere. Evidence existed only in a log that expires                                                        |
| CSA-03 | Every action pinned to a mutable tag, on a public repository                                                                                  |
| CSA-04 | No zero-tables assertion, no schema hash, no clean-worktree check. Each fails silently                                                        |
| CSA-05 | `actions/checkout` used the merge ref, so no result described the commit being merged                                                         |
| CSA-06 | Required checks were job NAMES: a rename removed a check, a job that never ran left it Pending forever                                        |
| CSA-07 | A coverage provider was configured and no workflow ever invoked it                                                                            |
| CSA-08 | Production dependencies carried 3 HIGH advisories covering 13 CVEs                                                                            |
| CSA-09 | No SAST, no container scan, no dependency review                                                                                              |
| CSA-15 | Nothing detected `.only`, `\|\| true`, an empty suite, or a vacuous assertion                                                                 |

## Workflow architecture

```
.github/
├── actions/setup-project/          composite: exact-head checkout + node + npm ci
├── ci-baselines/                    coverage, build size, container, schema,
│                                    performance, dependency and idempotency baselines
├── dependabot.yml                   npm · docker · github-actions
└── workflows/
    ├── pr-ci.yml                    14 governed jobs + one stable ci-gate
    ├── protected-develop-verification.yml   never cancels
    ├── nightly-assurance.yml        11 jobs + nightly-gate
    ├── release-verification.yml     build once, SBOM, provenance
    ├── deploy-staging.yml           foundation — checks preconditions, does not deploy
    ├── deploy-production.yml        foundation — checks preconditions, does not deploy
    ├── _reusable-node-quality.yml
    ├── _reusable-database-assurance.yml
    ├── _reusable-integration-tests.yml
    ├── _reusable-secret-scan.yml
    ├── _reusable-dependency-security.yml
    ├── _reusable-code-security.yml
    ├── _reusable-container.yml
    ├── _reusable-clean-room.yml
    └── _reusable-release-artifact.yml
```

Counted precisely, because these numbers drifted once already and are now
reconciled against the filesystem by `tests/ci/documented-counts.test.ts`:
**10 reusable workflows**, **7 top-level workflows** (the six above plus the
retained `ci.yml`), **1 composite action**, **47 scripts in `scripts/ci`**,
**14 baselines**, **25 documents** under `docs/engineering/ci-automation`, and
**14 workflow-security rules**.

The baseline count moved from 13 to 14 in `P1-27-QA-001`, which added
`coverage-baseline.web.json` — the first coverage baseline the web tier has ever
had. Until then `apps/web/vitest.config.ts` declared two projects and no
`coverage` block at all, the repository-root config's `include` list was entirely
`apps/api/src`, and neither committed coverage baseline mentioned `apps/web`, so
"Unit and component coverage" was a task with nothing measuring either half.

The `scripts/ci` count moved from 27 to 28 in the Main Branch Governance and
Ruleset Alignment gate, which added `check-promotion-source.mjs` — the gate that
enforces ADR-006 §45 and §47, previously prose only. It moved from 29 to 30 in the P1-25 topology remediation, which added `check-web-topology.mjs` — one App Router root under `src`, the proxy convention, no nested lockfile, no tracked artefacts. It moved from 35 to 36 in P1-26, which added `check-p1-26-frontend.mjs` — no token in browser storage, no floating-point money, no redirect parameter in the authentication flow, one session-cookie authority, and only async exports from a `'use server'` module. It moved from 36 to 37 in the P1-26 shared-UX acceptance remediation, which added `check-notification-authority.mjs` — exactly one `ToastRegion`, rendered by the notification host, mounted once in the locale layout, with no competing notification library installed. It moved from 37 to 38 in P1-27, which added `generate-idempotent-operations.mjs` — the generator that derives the Web client's idempotency table from the published contract instead of guessing it from the HTTP method (`P1-27-INT-003`), and, run with `--check`, the gate that fails the build when the table and the contract disagree. It moved from 40 to 41 in the P1-27 final canonical remediation, which added `check-p1-27-write-reachability.mjs` — the gate that asks whether a person can reach a mutation, not merely whether the operation is correct. Ten canonical P1-27 writes had shipped with a route, a permission, an audit class, an idempotency entry, an OpenAPI path and a register row, and no screen from which anybody could invoke them, while every automated tier stayed green. A branch ruleset cannot
express it, because rulesets constrain the TARGET ref and not where a pull
request came from, so until that script existed a feature branch could open a
pull request straight into `main` and every check would pass.

The count moved from 26 to 27 in P1-22, which added
`check-exact-money.mjs` — the gate that refuses `Number()`, `parseFloat`, `Math.*`,
`toFixed`, a unary plus and a JSON number schema on the declared financial surface.
The count is stated here rather than left to drift because
`tests/ci/documented-counts.test.ts` reconciles it against the filesystem, and it
failed on exactly this discrepancy rather than being noticed in review.

`pr-ci.yml` declares **14 governed jobs plus `ci-gate` = 15**, which appear as
**16 checks** on a pull request because `code-security` is a two-language matrix
(`javascript-typescript` and `actions`). All three numbers are correct and they
are not interchangeable — `ci-gate` governs 14, the file declares 15, and 16
report.

The reusable-workflow count moved from 9 to 10, and the governed-job count from
13 to 14, when `authenticated-browser` was put under both gates.
`apps/web/tests/e2e/authenticated/**` is the repository's only end-to-end
tenant-isolation proof and its only route-level accessibility proof; it ran on no
pull request at all, and the protected job that did run it was outside
`protected-gate`'s `needs`, so BOTH gates could report Go while it was red. The
body now lives in `_reusable-authenticated-browser.yml` — a tenth reusable
workflow, called from `pr-ci.yml` and `protected-develop-verification.yml`,
because `DECLARED_JOBS` is shared by the two gates and GitHub has no
cross-workflow `needs`. On a FORK pull request the job does not run, and the gate
is told so explicitly: the state is recorded as
`NOT_ELIGIBLE_FOR_SECURITY_REASON`, never as a pass, and a skip with no such
statement fails the gate closed.

`ci.yml` is retained and still runs. Its four job names are the current required
checks, and §24 requires them to stay until `ci-gate` is proven on a real pull
request and a real protected push. The cutover is
[`rollout-plan.md`](rollout-plan.md).

## Required PR jobs

`change-detection` · `static-quality` · `unit-tests-coverage` ·
`application-build` · `database-migration-replay` · `database-security` ·
`integration-tests` · `dependency-security` · `code-security` ·
`container-security` · `secret-scan` · `hosted-clean-room` · **`ci-gate`**

`ci-gate` runs `if: always()` and fails when a required job failed, was
cancelled, was skipped without a recorded reason, vanished from `needs` because
it was renamed, appeared in `needs` without being governed, or when the tested
SHA differs from the SHA under review.

Six jobs may be skipped on a documentation-only change, each with a reason
recorded by change detection and re-checked by the gate. `hosted-clean-room`
may **never** be skipped — a clean room that can be skipped is not one, and the
documentation-only gate PR has to demonstrate it.

## Test layers

| Layer                                                  | Where                       | Blocking                          |
| ------------------------------------------------------ | --------------------------- | --------------------------------- |
| Static verification                                    | `static-quality`            | yes                               |
| Unit + coverage ratchet                                | `unit-tests-coverage`       | yes                               |
| Database, RLS, constraints, concurrency                | `database-security`         | yes                               |
| Migration replay from zero                             | `database-migration-replay` | yes                               |
| Backend integration through the Route Handler boundary | `integration-tests`         | yes                               |
| Idempotency replay evidence                            | `integration-tests`         | yes                               |
| Exact-SHA clean room                                   | `hosted-clean-room`         | yes                               |
| Full role × table × action matrix                      | nightly                     | blocking nightly                  |
| Mutation assurance                                     | nightly                     | blocking nightly                  |
| Backup/restore drill                                   | nightly                     | blocking nightly                  |
| Performance baseline                                   | nightly                     | informational                     |
| Compatibility matrix                                   | nightly                     | informational (experimental rows) |
| Browser E2E                                            | **not implemented**         | —                                 |

No browser end-to-end tier exists and none is claimed. The frontend phases are
not implemented, so a Playwright suite would assert against a UI that does not
exist. The activation plan is in
[`automated-testing-strategy.md`](automated-testing-strategy.md).

## Baselines

Measured first, ratcheted second. Every baseline was committed **unset** until a
GitHub-hosted runner had produced the number. All but one are now recorded, from
the artifacts of **PR CI run 19** (`30431556718`) at `8d7bfff`. Per-number
provenance — workflow, run, job, artifact, file, SHA — is in
[`evidence/hosted-baselines.md`](evidence/hosted-baselines.md).

| Baseline         | State                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| Unit coverage    | 93.26 / 93.26 / 84.75 / 93.61 — hosted-confirmed, **not** lowered to the 84.43 / 93.41 the run measured |
| Backend coverage | **86.38 / 86.38 / 86.73 / 80.08**, plus six critical-module floors promoted from planned to enforced    |
| Build size       | **34,367,299** standalone bytes (ratcheted) · 632,213 static · 66,333,419 total across 4954 files       |
| Image size       | **202,909,674** bytes, uncompressed, 12 layers — no compressed figure exists, the image is never pushed |
| Structural       | 242 tables / 514 functions / 631 policies / 541 triggers / 0 SECURITY DEFINER, and 7 seeded catalogs    |
| Test counts      | hosted 1082 / 1624 / 1380; unit floor raised 1000 → 1050                                                |
| Schema hash      | `a677eb05…`, migrations 119, permissions 100 — reproduced three times in run 19                         |
| Performance      | **still unset** — its job lives in nightly, and `schedule:` fires only from the default branch          |

Two figures are recorded with their disagreement rather than without it. The
same run reports **514** functions and **212** functions for the same database:
`migration-replay-checks.mjs` filters only `pg_catalog`/`information_schema`,
while `schema-inventory.mjs` restricts to the 17 RootLco schemas, whose
per-schema breakdown sums to exactly 212. The 302-function difference is
extension-owned code. 514 is committed because this baseline is enforced by the
script that produces 514; 212 remains the number that describes RootLco's own
schema. The explanation ships in the baseline so nobody later "reconciles" them.

The unit baseline was deliberately **not** re-recorded downward. Run 19 measured
functions 0.32 pp and branches 0.20 pp below the recorded floor, inside the
0.5 pp tolerance. Lowering a floor to match the last measurement converts a real
decline into the new normal.

## Security

- **Production dependencies: 0 HIGH/CRITICAL.** Was 3, covering 13 advisories
  (`next` SSRF ×2, unauthenticated Server Function disclosure, proxy bypass,
  cache confusion ×2, DoS ×2, image DoS; `postcss` ×3; `sharp` libvips).
  Closed by `next` 16.2.10 → 16.2.12 plus `overrides` for `postcss` and `sharp`.
  **Production dependency advisories: Resolved through compatible patch upgrades.**

**brace-expansion advisory: CLOSED on 2026-08-01. The waiver was removed and the
tree carries zero advisories.**

- It closed the way the record said it would: **the gate failed and told us to
  remove it.** The entry's own `removalCondition` said an exception that outlives
  its cause is worse than none, and named the trigger — npm reporting a
  non-semver-major `fixAvailable`.
- All three exactness rules fired at once, each describing the same upstream
  change from a different angle: the advisory was **re-scoped** from `<=5.0.7` to
  `<1.1.17`; the dependency fingerprint **collapsed from two resolved nodes to
  one**; and npm reported a **non-breaking fix**.
- **Remediation:** `npm audit fix --package-lock-only` bumped
  `node_modules/minimatch/node_modules/brace-expansion` from 1.1.16 to 1.1.18.
  Lockfile only — `package.json` unchanged and **no override added**. The `^5.0.8`
  override that broke ESLint in July stays reverted and must not return.
- **Verified by execution, not inferred**, because the record insisted on that
  after the override attempt: `npm run lint` clean and the unit tier 1285/1285
  after `npm ci`. A 1.1.x patch keeps the v1 export shape `minimatch@3` calls.
- `npm audit` now reports **0 vulnerabilities** across production and development.
- The entry is retained under `removedAdvisories` rather than deleted, so the
  waiver's history survives its removal.
- **What remains true, and is not about the advisory:** the code is NOT absent
  from the image and this repository does not claim it is. Node vendors
  brace-expansion into the `node` binary via esbuild, so a copy ships inside any
  image containing a Node runtime and no build step removes it. Absence was never
  achievable; the claim that is both true and sufficient is narrower — the running
  application cannot **resolve or invoke** it. AR-35, AR-37 and AR-43 are three
  corrections in a row that arrived at that, and the reasoning is preserved in
  [`evidence/brace-expansion-reachability-proof.md`](evidence/brace-expansion-reachability-proof.md).
- Ten gate rules, each with a mutation test: remove the exception, broaden its
  range, omit the dependency path, claim production-safety without evidence,
  expire it, add an unwaived High, return an audit error object, make the package
  production-reachable, land a compatible patched version while keeping the
  exception. Each makes the gate fail; deleting a rule makes its test fail. The
  last of those is the one that fired here, so the rule set is now guarding an
  **empty** exception list — the state it was built to make reachable.

- Every action pinned to a full commit SHA with a version comment, enforced by
  `check-workflow-security.mjs` — **14 rules** (WFS-001…WFS-014), a count the
  report now carries so that "0 findings" cannot be mistaken for "0 rules ran".
- CodeQL over `javascript-typescript` **and** `actions`, `security-and-quality`
  suite, SARIF uploaded. `security-events: write` is granted to that job alone.
- Trivy over the production image: vulnerabilities, secrets, misconfigurations.
  Fixable findings block; unfixable ones are reported, because the action there
  is a base-image change and conflating the two teaches people to ignore the gate.
- Secret scanning extended to git history (nightly) and to build output.
  **No matched value is ever recorded** — findings name the file and the pattern
  class only.
- No workflow consumes a repository secret. No `pull_request_target` anywhere.

## Open findings, recorded rather than hidden

- ~~**10 IAM operations declare `idempotent: true` with no replay evidence**~~ —
  **CLOSED** after this initiative, by the CodeQL Application Remediation
  change, which imported the replay evidence and removed all ten entries
  atomically. 107 of 107 idempotent operations proven, 0 waived, no defect
  found. Any **new** unproven promise still fails the gate immediately.
- **`src/shared/errors/app-error.ts` is dead code** with 0% coverage and zero
  references repo-wide. Deliberately left in the coverage set — excluding it
  would raise the number by hiding code rather than by testing it.
- **GitHub-native security features are still disabled** (P1-21-A-01): Secret
  Scanning, Push Protection, Dependabot alerts, Code scanning, **and the
  Dependency graph**. These are owner settings changes, not repository content.
  Listed in [`security-model.md`](security-model.md) §7. The dependency-review
  step now probes for the graph and records its absence as this open item rather
  than failing the pull request over a setting a pull request cannot change; the
  licence deny-list and severity thresholds are enforced offline regardless.
- **Canonical-document hashes are not verified on a runner.** The two Word
  documents are external by owner decision and must never be committed, so CI
  runs `validate:canonical-docs --record-only`: the reference record must parse
  and every entry must carry a real hash, but the documents themselves are
  compared only on the owner workstation. A document that _is_ present is still
  compared, and a `pending` hash still fails, so this cannot hide a mismatch.
- **`apk` package versions are not pinned** (hadolint DL3018, four sites).
  Suppressed per line with the reason recorded, not by threshold or by a
  repository-wide ignore; a new unpinned `apk add` is still reported. Image
  composition is evidenced by the SBOM, the Trivy scan and the recorded digest.

## What the hosted runs actually found

Nineteen runs, and the first two could not execute at all. Recorded in full in
[`adversarial-review.md`](evidence/adversarial-review.md).

| Run | Head      | Outcome                                                  |
| --- | --------- | -------------------------------------------------------- |
| 1   | `8740531` | `startup_failure`, **zero jobs** — AR-28                 |
| 2   | `67014fc` | every job failed in `Set up the project` — AR-29         |
| 3   | `2654f23` | **ran**: 7 green, 6 real gate failures — AR-30 … AR-33   |
| 4   | `9088013` | 11 of 13 green — AR-34, AR-35, AR-36                     |
| 5   | `ca4c594` | 14/14 green — but latent AR-37 not yet found             |
| 6   | `f741d2f` | 12/13 — AR-41                                            |
| 7   | `0e492bb` | 12/13 — AR-42                                            |
| 8   | `d166449` | **14/14 green, `ci-gate` Go**                            |
| 9   | `c95e8d9` | **14/14 green, `ci-gate` Go** — then AR-43, AR-44 found  |
| 10  | `a243295` | **14/14 green** — reachability reworded, AR-43/44 closed |
| 12  | `4520b36` | **14/14 green** — while a scanner was blind (AR-45)      |
| 15  | `8bbe263` | failed — WFS-013 caught its own gap                      |
| 16  | `c766ea0` | **14/14 green** — AR-48, an apostrophe, fixed            |
| 18  | `5cb7347` | **14/14 green, `ci-gate` Go**                            |
| 19  | `8d7bfff` | **14/14 green, `ci-gate` Go** — the baselines below      |

AR-28 and AR-29 were both defects in the _remediation_ for an earlier finding,
and neither was reachable by reading the files: three adversarial reviewers,
`actionlint` and this repository's own workflow linter all passed the first.
Each now has a linter rule at _critical_ — WFS-011 and WFS-012.

Eleven of the fifty-two findings were defects inside this initiative's own
remediations. The three worth carrying all arrived **after** a run had already
reported success:

- **AR-45** — run 12 was **14/14 green while one of its own scanners was
  blind.** Removing `/lib/apk/db` from the image left Trivy enumerating zero
  packages and reporting zero vulnerabilities, and nothing noticed, because a
  scan that found nothing and a scan that scanned nothing produce the same
  green tick. Every scanner now has to prove it was armed.
- **AR-49** — found not by a run but by reading the artifacts a green run
  produced. The published reachability proof asserted the vulnerable code was
  absent from the image, which is false and which the owner's approval
  explicitly forbids stating. Fixed by narrowing the claim to the measurement.
- **AR-52** — found at the merge gate, by listing the commit's **check-runs**
  rather than its **workflow runs**. A `CodeQL` check produced by GitHub
  Advanced Security from this pipeline's own SARIF had been **red on every
  head** while the workflow reported 14/14, because the endpoint that reports
  run conclusions does not mention it. It was objecting to nine alerts in the
  gate scripts, two of them real: a vacuous-assertion rule with an unbound back
  reference that had **never fired**, and a CRITICAL workflow rule one
  list-entry away from silently matching the wrong text.

Each was accurate about the question it was asked. A green tick reports that the
checks which ran did not object — not that the right checks ran, nor that
anything else was watching.

None of them was fixed by weakening a gate; each was reproduced first, because
GitHub requires a signed-in session to read Actions logs even on a public
repository, and only check-run annotations are public.

## Deferred

- Browser E2E — no UI exists.
- Real staging/production deployment — no hosting decision (ADR-012). Both
  workflows check their preconditions and then explicitly refuse.
- OIDC credentials — none exist; §31 requires short-lived credentials only, and
  this change introduces no long-lived cloud secret.
- Markdown linting — the canonical documents use deliberate non-ASCII and heavy
  tables; a default ruleset produces noise rather than signal. Encoding
  validation and canonical-document validation cover the real risks.

## No production deployment

Nothing in this change deploys anything. `deploy-staging.yml` and
`deploy-production.yml` verify that the artifact is immutable, that the commit
is on `main`, and that a change record exists — then stop and record why.
Promotion to `main` remains a founders' reserved decision (ADR-006).

Critical unresolved: **0** · High unresolved: **0**
