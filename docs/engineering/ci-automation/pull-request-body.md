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
    ├── pr-ci.yml                    13 jobs, one stable ci-gate
    ├── protected-develop-verification.yml   never cancels
    ├── nightly-assurance.yml        10 jobs
    ├── release-verification.yml     build once, SBOM, provenance
    ├── deploy-staging.yml           foundation — checks preconditions, does not deploy
    ├── deploy-production.yml        foundation — checks preconditions, does not deploy
    ├── _reusable-node-quality.yml
    ├── _reusable-database-assurance.yml
    ├── _reusable-integration-tests.yml
    ├── _reusable-security.yml
    ├── _reusable-container.yml
    ├── _reusable-clean-room.yml
    └── _reusable-release-artifact.yml
```

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

Measured first, ratcheted second. Every baseline that has never been measured on
a hosted runner is committed **unset**, with the reason stated in the file:

| Baseline         | State                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------- |
| Unit coverage    | 91.06 / 93.62 / 84.87 / 91.06, from local measurement; corrected by the first hosted run |
| Backend coverage | unset — never measured; first hosted run records it                                      |
| Build size       | unset — `.next` was never measured by any workflow                                       |
| Image size       | unset — the image was never measured by any workflow                                     |
| Performance      | unset — only ever measured on a developer machine                                        |
| Schema hash      | `a677eb05…`, migrations 119, permissions 100 — from the P1-21 hosted clean room          |

## Security

- **Production dependencies: 0 HIGH/CRITICAL.** Was 3, covering 13 advisories
  (`next` SSRF ×2, unauthenticated Server Function disclosure, proxy bypass,
  cache confusion ×2, DoS ×2, image DoS; `postcss` ×3; `sharp` libvips).
  Closed by `next` 16.2.10 → 16.2.12 plus `overrides` for `postcss` and `sharp`.
- **Development: one itemised, expiring exception** — `GHSA-mh99-v99m-4gvg`
  in `brace-expansion`, which has no consumable patched release in any major
  line. Overriding to the patched 5.0.8 breaks eslint; this was verified, not
  assumed.
- Every action pinned to a full commit SHA with a version comment, enforced by
  `check-workflow-security.mjs` (10 rules).
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

- **10 IAM operations declare `idempotent: true` with no replay evidence**,
  including `iam.grant-issue` and `iam.role-permission-add`. Whether the code
  honours the promise is a P1-14 question and cannot be settled by a CI change.
  Itemised in `.github/ci-baselines/idempotency-exceptions.json` with owners and
  a 2026-10-31 expiry. Any **new** unproven promise fails the gate immediately.
- **`src/shared/errors/app-error.ts` is dead code** with 0% coverage and zero
  references repo-wide. Deliberately left in the coverage set — excluding it
  would raise the number by hiding code rather than by testing it.
- **GitHub-native security features are still disabled** (P1-21-A-01): Secret
  Scanning, Push Protection, Dependabot alerts, Code scanning. These are owner
  settings changes, not repository content. Listed in
  [`security-model.md`](security-model.md) §7.

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
