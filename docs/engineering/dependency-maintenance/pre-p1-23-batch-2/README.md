# Pre-P1-23 dependency, GitHub Actions and Dependabot maintenance batch

Reviews the ten Dependabot pull requests open before P1-23 begins — #121 to #130
— decides each on executable evidence rather than on the colour of its status
icon, and records the result.

This is the **second** pre-P1-23 maintenance batch. The first is in
[`../pre-p1-23/`](../pre-p1-23/) and is not superseded by this one.

## Owner authorization

> The Product Owner authorizes an independent repository-maintenance initiative
> before P1-23.
>
> This does **not** authorize starting P1-23, implementing business
> functionality, reopening P1-22, deploying, creating a release or tag, direct
> pushes to `develop` or `main`, squash or rebase merges, or weakening lint,
> TypeScript strictness, coverage, CodeQL, dependency security, container
> security, workflow security or branch protection.

## Outcome in one table

| PR   | Dependency                          | From → To             | Disposition                                                                    |
| ---- | ----------------------------------- | --------------------- | ------------------------------------------------------------------------------ |
| #121 | `eslint`                            | 9.39.5 → 10.8.0       | **deferred** → [#132](https://github.com/Ezzaldeen-Albitar/RootLco/issues/132) |
| #122 | `sass`                              | 1.101.0 → **1.102.0** | merged via #135                                                                |
| #123 | `@types/node`                       | 20.19.43 → 26.1.2     | **deferred** → [#133](https://github.com/Ezzaldeen-Albitar/RootLco/issues/133) |
| #124 | `pino`                              | 9.14.0 → **10.3.1**   | merged via #135                                                                |
| #125 | `supabase`                          | 2.109.1 → **2.110.0** | merged via #135                                                                |
| #126 | `github/codeql-action` init+analyze | v4.37.3 → **v4.37.4** | merged via [#131](https://github.com/Ezzaldeen-Albitar/RootLco/pull/131)       |
| #127 | `docker/setup-buildx-action`        | v3.12.0 → **v4.2.0**  | merged via #131                                                                |
| #128 | `actions/dependency-review-action`  | v4.9.0 → **v5.0.0**   | merged via #131                                                                |
| #129 | `actions/checkout`                  | v4.4.0 → **v7.0.1**   | merged via #131 — **split pin corrected**                                      |
| #130 | `docker/build-push-action`          | v6.19.2 → **v7.3.0**  | merged via #131                                                                |

Plus the late arrival **#134** (`hadolint-action` 3.3.0 → 3.4.0), **deferred** →
[#136](https://github.com/Ezzaldeen-Albitar/RootLco/issues/136) after CI rejected
it.

**8 accepted · 3 deferred.**

> **On the state this document describes.** These records are committed **before**
> the promotion, because a documentation-only commit on `develop` afterwards is
> forbidden — so a record cannot truthfully report its own merge. An earlier draft
> handled that badly, asserting "0 left open" and "the batch closes with zero
> unresolved Dependabot pull requests" while #122, #124 and #125 were still open
> awaiting this very pull request. Those sentences described an intention as a
> fact.
>
> What is true when this is written: #121, #123, #126–#130 and #134 are closed
> with dispositions; #122, #124 and #125 are **open**, superseded by #135, and are
> closed once it merges. **The final open-PR count is reported in the closure
> report**, which is written after the fact and can therefore be measured.

## The three findings that shaped this batch

**1. Dependabot's `checkout` pull request installs a split pin.** #129 updates 16
workflow files and leaves the 17th — the composite at
`.github/actions/setup-project/action.yml` — on v4.4.0, because
`dependabot.yml`'s `directory: /` cannot see `.github/actions/*/action.yml`. Two
SHAs for one action, which the security model forbids and which WFS-001/002
cannot detect. It is also the wrong half to leave: the composite performs the
**real** exact-head checkout. Same blind spot as the `setup-node` migration last
round.

**2. The group that looked like an overlap is not one.** #126 is titled _"the
actions group with 2 updates"_ beside four standalone action pull requests. Its
two members are `codeql-action/init` and `/analyze` — the coupled pair, moved
together, which is exactly what a lone `analyze` bump broke previously. **Zero
dependencies overlap across the ten.**

**3. A green check is only evidence about the pipeline that produced it.** All
ten arrived correctly based on current `develop` — a real improvement on the
previous round, where all ten were 29 commits stale. But #131 replaced every CI
workflow, so the npm pull requests' greens described a gate the repository no
longer runs. The accepted npm updates were re-verified under the new workflows
rather than merged on that evidence.

## Records

| File                                                                       | Contents                                                      |
| -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| [`pr-inventory.md`](pr-inventory.md)                                       | exact per-PR inventory, built from patches not titles         |
| [`overlap-matrix.md`](overlap-matrix.md)                                   | mechanical overlap and file-collision analysis                |
| [`release-note-review.md`](release-note-review.md)                         | primary-source breaking-change review for all seven majors    |
| [`github-actions-review.md`](github-actions-review.md)                     | #126–#130, split-pin proof, action-execution proof            |
| [`application-dependencies-review.md`](application-dependencies-review.md) | Pino 10 and the supply-chain position                         |
| [`dev-tooling-review.md`](dev-tooling-review.md)                           | ESLint 10, Sass, `@types/node`, Supabase CLI                  |
| [`dependabot-policy.md`](dependabot-policy.md)                             | grouping, majors, security-update mechanism, deferred ignores |
| [`integration-order.md`](integration-order.md)                             | why not ten merges, and the order executed                    |
| [`review-adjudication.md`](review-adjudication.md)                         | supersession proofs and adversarial-review outcome            |
| [`develop-verification.md`](develop-verification.md)                       | protected-branch verification and waiter honesty              |
| [`main-promotion.md`](main-promotion.md)                                   | promotion method and deployment safety                        |
| [`execution-checkpoint.md`](execution-checkpoint.md)                       | chronological record and final state                          |

## Nothing weakened

No lint rule, TypeScript strict option, coverage threshold, critical-module
floor, test-count expectation, CodeQL setting, dependency-severity threshold,
licence policy, container policy, workflow-security rule or branch protection was
changed to make anything green. The `brace-expansion` exception is byte-identical
to the previous `develop` — not broadened, not re-fingerprinted.

## P1-23

**Not started.** No P1-23 branch, source, operation or migration. The paths
matching the string are this maintenance record and the P1-11 forward contract.
