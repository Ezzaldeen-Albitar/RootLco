# Pre-P1-23 Dependabot, dependency and CI compatibility maintenance gate

Reviews every Dependabot pull request open before P1-23 begins, decides each one on evidence
rather than on the colour of its status icon, and records the result.

## Owner authorization

> **OWNER AUTHORIZATION — PRE-P1-23 DEPENDENCY MAINTENANCE**
>
> The Product Owner authorizes a complete technical review of every currently open Dependabot
> pull request before P1-23 begins.
>
> This does **not** authorize starting P1-23, implementing business features, deploying,
> creating a release build that triggers deployment, direct pushes to `develop` or `main`,
> squash or rebase merges, or weakening CI, CodeQL, coverage, action-pinning, security or
> branch rules.

## The finding that governs every other decision

**All ten open Dependabot pull requests were based on `d9a2c1dc`** — twenty-nine commits behind
`develop`, and predating phase P1-22 entirely.

Seven of the ten showed a green tick. Those ticks were computed against a tree that does not
contain P1-22, so **not one of them was evidence about the tree this repository ships.** Every
accepted update was therefore re-applied onto current `develop` and re-verified there, and no
PR was merged on its own Dependabot run.

Two of the ten PR titles also mislead, and both were checked mechanically rather than read:

- **#96** is the `next-and-react` _group_, but this instance bumps only `react` and `react-dom`,
  both **patch**. `next` stays **16.2.12**, untouched. There is no Next.js major here.
- **#97** is the `dev-tooling` _group_ and contains **`prettier` and `stylelint` only** — no
  TypeScript, no Vitest. The suspected overlap with #99 and #102 does **not exist**; the three
  package sets are disjoint.

## Disposition of all ten

| PR   | Dependency / action               | From → To                                | Jump      | Disposition                                         |
| ---- | --------------------------------- | ---------------------------------------- | --------- | --------------------------------------------------- |
| #96  | `react`, `react-dom`              | 19.2.4 → **19.2.8**                      | patch     | **Merged** via #113                                 |
| #97  | `prettier`, `stylelint`           | 3.6.2 → **3.9.6**, 17.14.0 → **17.14.1** | patch     | **Merged** via #113                                 |
| #98  | `@supabase/ssr`                   | 0.8.0 → **0.12.4**                       | minor     | **Merged** via #113                                 |
| #99  | `vitest`                          | 3.2.7 → 4.1.10                           | **major** | **Deferred**, three blockers                        |
| #100 | `actions/upload-artifact`         | 4.6.2 → **7.0.1**                        | **major** | **Merged** via #111                                 |
| #101 | `actions/attest-build-provenance` | 2.4.0 → **4.1.1**                        | **major** | **Merged** via #111, execution unproven — see below |
| #102 | `typescript`                      | 5.9.3 → 7.0.2                            | **major** | **Deferred**, blocked upstream                      |
| #103 | `actions/setup-node`              | 4.4.0 → **7.0.0**                        | **major** | **Merged** via #111, **completed** by #114          |
| #104 | `github/codeql-action/analyze`    | 3.37.3 → **4.37.3**                      | **major** | **Remediated and merged** via #112                  |
| #105 | `actions/download-artifact`       | 4.3.0 → **8.0.1**                        | **major** | **Merged** via #111                                 |

Merged through four maintainer-controlled replacement pull requests, each based on current
`develop`: **#111** (artifact / provenance / setup-node), **#112** (CodeQL action), **#113** (npm
dependencies), **#114** (remediation of two review findings).

## The two red PRs that were remediable, and why they were red

Both failed for the _same_ reason, and neither was a repository defect: **Dependabot moved one
half of a coupled pair.**

**#104 — `github/codeql-action`.** It bumped only `analyze` to v4.37.3 and left `init` at
v3.37.3. The init action stamps its config with its own version and analyze refuses a config
from a different major:

```
Loaded a configuration file for version '3.37.3', but running version '4.37.3'
analyze post-action step failed: ...
```

Both language legs and `ci-gate` failed on that. Fixed in #112 by bumping **both** references to
the same v4.37.3 commit. Nothing in the repository-controlled SARIF policy was loosened. The
three checks that were red on #104 are green on #112.

**#99 — `vitest`.** It bumped `vitest` to 4.1.10 and left `@vitest/coverage-v8` at `^3.2.4`, so
`npm ci` failed outright — which is why **thirteen** checks went red from one cause, all before
running anything. That half is fixable, and with both at 4.1.10 install succeeds and the unit
tier passes 1252/1252. #99 is nevertheless deferred, for two further reasons below.

## Why #99 is deferred

**The coverage ratchet stops comparing like with like.** With `@vitest/coverage-v8` at 4.x the
provider measures a different and much smaller universe:

|                   | vitest 3 | vitest 4   |
| ----------------- | -------- | ---------- |
| files measured    | —        | **19**     |
| statements total  | **1480** | **501**    |
| global lines      | 93.26%   | **86.79%** |
| global statements | 93.26%   | **85.03%** |
| global branches   | 93.61%   | **81.27%** |

`coverage-gate.mjs` fails, and two critical-module floors are breached — `log-redaction` 64%
against a 72% floor, `environment-validation` 34.62% against a 50% floor. The same tests pass
either way, so this is a **measurement change, not a coverage loss**, which is precisely why it
cannot be waved through: the only routes to green are lowering thresholds or re-baselining onto
a denominator that collapsed from 1480 to 501.

**It silently changes a security exception's fingerprint.** The `brace-expansion` waiver in
`.github/ci-baselines/dependency-exceptions.json` pins an exact resolved-node fingerprint that
includes a node reached through `@vitest/coverage-v8@^3.2.4`. Bumping to 4.x removes that node
and `dependency-policy.mjs` fails: _"the dependency path changed, so the reachability evidence
behind this waiver no longer describes what is installed."_ The gate is working as designed, and
the change is arguably an improvement — nine dev highs instead of twelve — but the waiver is
owner-approved with explicit scope limits that exclude a changed dependency path, so
re-approving it is an owner governance action, not a maintenance action.

**Revisit when** `@vitest/coverage-v8` 4.x measures the `vitest.config.ts` include allow-list
equivalently _and_ the exception is re-approved for the new fingerprint; or when the exception
becomes removable entirely. Owner: platform-owner. Kept open deliberately.

## Why #102 is deferred

Blocked upstream, not by this repository:

```
typescript-eslint does not support TS 7.0.
See also https://github.com/typescript-eslint/typescript-eslint/issues/10940
```

`eslint` exits 2 during `static-quality`, and the resolution log shows a peer requiring
`typescript@6.0.3`. `typescript-eslint` reaches this project through `eslint-config-next`. The
only ways to make TS 7 green here would be to disable lint, drop the type-aware rules, or pin
around the peer — each of which weakens a gate that must not be weakened.

**Revisit when** `typescript-eslint` supports TS ≥ 7.1 _and_ the `eslint-config-next` chain
resolves a version carrying it. Owner: platform-owner. `typescript` remains `^5` (5.9.3).

## What independent adversarial review caught in my own work

Fifteen read-only reviews ran against the three replacement branches: **0 Critical, 28 High**,
of which the Highs collapse to a small number of distinct issues. Two were confirmed by
reproduction and fixed in **#114**. Both are the same failure class P1-22 recorded four times —
**a written claim outrunning the evidence** — and this time the claims were mine.

**1. The setup-node migration was half applied, and #111 said it was done.** #111 moved the
three direct references in `ci.yml` and left `.github/actions/setup-project/action.yml:192` on
v4.4.0 — and that composite is what **15 workflows and 21 call sites** use, including every job
that runs `npm ci`. So **21 of 24** invocations stayed on the old major.

Two reasons nothing caught it: `dependabot.yml`'s `github-actions` entry uses `directory: /`,
which does **not** cover `.github/actions/*/action.yml`, so Dependabot is structurally blind to
that pin and its #103 touched exactly one file; and **WFS-001/WFS-002 require each pin to _be_ a
SHA with a version comment, never that two references to one action _agree_** — a split pin is
undetectable. Not untidy either: setup-node v4 and v7 build the identical npm cache key with no
version discriminator while bundling `@actions/cache` v4 and v6.

**2. The canonical pin registry was left false, and its policy forbids what #111 and #112 did.**
`security-model.md` §3 had five of twelve rows wrong, and the paragraph beneath read _"deliberately
not the newest major"_ — exactly the migration performed. No gate reads that table, so the drift
was silent. Rows corrected; the rule **amended rather than quietly contradicted** — a
newest-major move is permitted **when proven on the current tree** — with `actions/checkout`
named as the remaining explicit exception.

**One review finding was already remediated before the review landed.** Two lenses reported that
#113 would be merged on checks computed against a stale base. That was true of head `7b8df3c`,
which they saw; the branch was then updated from `develop` (merge `4d892ed`) and re-verified at
19/19 with `ci-gate` before merging. Confirmed: `4d892ed` contains both `886428d` and `1e0a163`.

## Two things this gate does not claim

**`actions/attest-build-provenance` v4.1.1 is merged but its execution is unproven.** It appears
only in `_reusable-release-artifact.yml`, whose sole caller is `release-verification.yml` —
triggered by a `release-*`/`v*` tag or by dispatch. No pull request and no `develop` push
executes it, and the step carries `continue-on-error: true`, so a v4 incompatibility would
produce no provenance while the job stayed green. A dispatch against the maintenance branch was
attempted and **correctly refused by the workflow's own guard** — _"The commit must be on
`main`"_ — which skipped the `artifact` job entirely. The upgrade can therefore only be proven
after promotion, and that dispatch is recorded in `main-promotion.md`.

**Intermediate `develop` commit `f0c2486` carries cancelled `ci.yml` checks.** `ci.yml` uses
`concurrency: cancel-in-progress: true`, and the #112 merge landed 57 seconds after #111's, so
the older protected-push run was cancelled. `protected-develop-verification.yml` was written to
avoid exactly this and is unaffected; `ci.yml` was never given the same treatment. The
**final** maintenance baseline is fully verified — that is the SHA this gate rests on — but
`f0c2486` as an intermediate commit is not, and `check-commit-checks.mjs` classifies `cancelled`
as a failure.

## Final dependency and action state

|                                   | Version                        |
| --------------------------------- | ------------------------------ |
| `next`                            | 16.2.12 (unchanged)            |
| `react` / `react-dom`             | **19.2.8**                     |
| `@supabase/ssr`                   | **^0.12.4**                    |
| `typescript`                      | ^5 (5.9.3) — deferred          |
| `vitest` / `@vitest/coverage-v8`  | ^3.2.4 / ^3.2.4 — deferred     |
| `prettier` / `stylelint`          | **^3.9.6** / **^17.14.1**      |
| `actions/upload-artifact`         | **v7.0.1**                     |
| `actions/download-artifact`       | **v8.0.1**                     |
| `actions/setup-node`              | **v7.0.0** — all 24 call sites |
| `github/codeql-action/*`          | **v4.37.3** — init and analyze |
| `actions/attest-build-provenance` | **v4.1.1**                     |
| `actions/checkout`                | v4.4.0 (explicit exception)    |

Twelve actions, **0 pin mismatches against the registry, 0 split pins**. Every reference is a
full 40-character SHA with a matching version comment; no pin was replaced by a mutable tag.

## Verification

Migrations **119**, migration `120` absent, schema hash
`a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c` — unchanged throughout.

Production dependency audit **critical 0 / high 0**. The twelve development-tree highs all trace
to the single `brace-expansion` advisory and remain covered by the existing exception, **exact
and unbroadened** — same two resolved dependency nodes, not expired. No new dev advisory.

Local, on the merged tree: `npm ci`, typecheck, eslint, `prettier --check` (**no reformatting**
from the prettier bump), `style:check`, unit **1252**, backend **1603**, production build,
OpenAPI, operation coverage, module boundaries, `security:all`, dependency-policy with the
reachability proof.

Hosted, with every check-run population asserted non-zero and enumerated through
`/commits/{sha}/check-runs`: #111 19/19, #112 19/19, #113 19/19 on its updated head, #114 all
five required checks plus `ci-gate`, CodeQL and the clean room green.

## No deployment

`DEPLOYMENT_TRIGGERED = false`. Both deploy workflows remain `workflow_dispatch`-only, no
workflow declares an `environment:`, and **no tag was created** — the only tag in the repository
remains `release-2-database-baseline` from P1-12.

## P1-23

**Not started.** No P1-23 branch, no P1-23 source, no P1-23 operation.

## Decision

**Go — RootLco Pre-P1-23 Dependency and CI Maintenance Gate Passed**
