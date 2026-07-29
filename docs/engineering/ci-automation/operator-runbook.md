# Operator runbook

Everything CI runs can be run locally. That is deliberate: a check you cannot
reproduce on your own machine is a check you will eventually stop trusting.

## Before you push

```bash
npm run format:check && npm run lint && npm run typecheck && npm run style:check
npm run test
node scripts/ci/check-test-honesty.mjs
node scripts/ci/check-workflow-security.mjs
node scripts/ci/check-route-registry-parity.mjs
node scripts/ci/check-env-contract.mjs
```

Roughly two minutes, and it catches most of what `static-quality` catches.

## The gate scripts

Every one is dependency-free (`node:` builtins only) except `rls-matrix.mjs`,
which needs `pg`. All accept `--json` and `--markdown`.

| Script                            | What it answers                                       |
| --------------------------------- | ----------------------------------------------------- |
| `classify-changes.mjs`            | which heavy jobs this diff needs                      |
| `evaluate-ci-gate.mjs`            | Go or No-Go, given job results and a classification   |
| `coverage-gate.mjs`               | did coverage regress, and are the floors held         |
| `check-test-honesty.mjs`          | can any test in this repository not fail              |
| `check-workflow-security.mjs`     | is any workflow unsafe                                |
| `check-route-registry-parity.mjs` | is any endpoint missing from the contract             |
| `check-env-contract.mjs`          | does the build need an undocumented variable          |
| `check-idempotency-evidence.mjs`  | is any retry promise unproven                         |
| `dependency-policy.mjs`           | is any advisory unwaived or expired                   |
| `container-policy.mjs`            | does the image carry a blocking finding               |
| `migration-replay-checks.mjs`     | is the migration set well-formed and the schema right |
| `rls-matrix.mjs`                  | role × table × action, from the catalog               |
| `scan-history.mjs`                | credential shapes in history or build output          |
| `mutation-assurance.mjs`          | is each security guard load-bearing                   |
| `performance-gate.mjs`            | did a query family regress                            |
| `backup-restore-drill.mjs`        | does a restore actually restore                       |
| `build-size-report.mjs`           | is the build output sound and within budget           |
| `summarise-vitest.mjs`            | test totals, and are they honest                      |
| `licence-inventory.mjs`           | what licences are installed                           |
| `nightly-summary.mjs`             | did the night pass                                    |

## Reproducing a database job

Needs Docker.

```bash
docker run -d --name rootlco-ci -e POSTGRES_PASSWORD=postgres -p 54322:5432 postgres:17-alpine
export DB_HOST=127.0.0.1 DB_PORT=54322 DB_NAME=postgres DB_USER=postgres DB_PASSWORD=postgres
npm run db:apply-migrations
npm run validate:seed-state
npm run test:db
node scripts/ci/rls-matrix.mjs --level critical
docker rm -f rootlco-ci
```

The container is throwaway. `DB_PASSWORD` above is the container's own literal —
it is not a credential and must never be replaced with one.

## Reproducing the clean room

**Use a short path.** On Windows, a clone root longer than about 100 characters
breaks `npm run build` with a Turbopack `path length exceeds max length` panic
that reads exactly like a build defect. It is not — it is `MAX_PATH`. This cost
real time in P1-21.

```bash
git clone --depth 1 <url> /c/cr/RootLco
cd /c/cr/RootLco
npm ci
# then the database block above, then:
npm run test && npm run test:db && npm run test:backend
npm run build
docker build --target runner -t rootlco/web:clean-room .
git status --porcelain    # must be empty
```

## Re-baselining

Each baseline lives in one file under `.github/ci-baselines/`, so raising or
lowering one is a reviewable diff.

```bash
npm run test -- --coverage --coverage.reportsDirectory=coverage/unit
node scripts/ci/coverage-gate.mjs \
  --summary coverage/unit/coverage-summary.json \
  --baseline .github/ci-baselines/coverage-baseline.unit.json --update

npm run build
node scripts/ci/build-size-report.mjs --update
```

Always commit a baseline change together with the change that caused it, and say
in the commit message which direction it moved and why.

## Running mutation assurance

```bash
node scripts/ci/mutation-assurance.mjs --dry-run          # verify the anchors only
node scripts/ci/mutation-assurance.mjs --only deferred-scope-target-required
```

It restores every mutated file in a `finally` block and then asserts
`git diff --quiet` over each. If the tree is ever left dirty it exits non-zero
rather than continuing.

## Triggering a workflow by hand

Every workflow has `workflow_dispatch`. From the Actions tab:

| Workflow                            | When you would                                                      |
| ----------------------------------- | ------------------------------------------------------------------- |
| `Nightly assurance`                 | after changing a guard, to get the mutation and full-RLS answer now |
| `Protected branch verification`     | to regenerate protected-branch evidence                             |
| `Release verification`              | to produce a release record from a commit on `main`                 |
| `Deploy — staging` / `— production` | to confirm the preconditions still hold; **neither deploys**        |

`Nightly assurance` accepts `skip-slow` to omit the performance and backup jobs.

## What you cannot do from here

- Enable Secret scanning, Push protection, Dependabot alerts or Code scanning.
  Repository settings; see `security-model.md` §7.
- Change branch protection. See `branch-ruleset.md`.
- Deploy anything. There is no hosting decision (ADR-012).
- Promote `develop` to `main`. Founders' reserved decision (ADR-006).
