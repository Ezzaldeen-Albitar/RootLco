# Pre-P1-23 batch 2 — official release-note review

Every major in this batch was checked against its **primary** source — the
project's own release notes, migration guide or the GitHub changelog — and then
against what this repository actually uses. Compatibility is never inferred from
SemVer alone.

## ESLint 10 — refused

Source: [Migrate to v10.0.0](https://eslint.org/docs/latest/use/migrate-to-10.0.0)

| Change                                                                                                                                           | Applies here?                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| Minimum Node `>=20.19` / `>=22.13` / `>=24`                                                                                                      | satisfied — repository runs Node 22 |
| **Rule-context methods removed**: `context.getFilename()`, `getSourceCode()`, `getCwd()`, `getPhysicalFilename()`, `parserOptions`, `parserPath` | **YES — this is the blocker**       |
| `.eslintrc` format removed; flat config only                                                                                                     | already flat config                 |
| `Program` AST node range spans entire source                                                                                                     | no custom rules affected            |
| Three new rules in `eslint:recommended`                                                                                                          | not reached — lint never loads      |

`eslint-plugin-react` still calls the removed `context.getFilename()`, so lint
dies before rules run. Detail in
[`dev-tooling-review.md`](dev-tooling-review.md) and issue
[#132](https://github.com/Ezzaldeen-Albitar/RootLco/issues/132).

## `@types/node` 26 — refused on runtime alignment

There is no upstream incompatibility to quote: the DefinitelyTyped major simply
tracks the Node major. The governing fact is local — `engines.node` is
`">=22.0.0"`, CI runs `node-version: '22'`, and the Docker base is `node:22`.
Types describing Node 26 on a Node 22 runtime let code compile against APIs that
do not exist at run time. See issue
[#133](https://github.com/Ezzaldeen-Albitar/RootLco/issues/133).

## Pino 10 — accepted

Source: [pino releases](https://github.com/pinojs/pino/releases)

> "The only breaking change is dropping support for Node 18."

The repository requires Node `>=22.0.0`, so the single documented break does not
apply. Redaction internals moved to `@pinojs/redact`, which is why the redaction
and observability suites were run explicitly rather than assumed — results in
[`application-dependencies-review.md`](application-dependencies-review.md).

## actions/checkout 7 — accepted

Source: [Safer `pull_request_target` defaults for actions/checkout](https://github.blog/changelog/2026-06-18-safer-pull_request_target-defaults-for-github-actions-checkout/)

v7 refuses to check out fork pull-request code in `pull_request_target`
workflows, and adds `allow-unsafe-pr-checkout` as an explicit opt-out.

Two facts make this a no-op here, both verified rather than assumed:

1. **This repository has no `pull_request_target` workflow.** The only textual
   match is a comment in `pr-ci.yml` stating that there is none.
2. The changelog is explicit that **"Same-repository pull requests aren't
   affected, and the `pull_request` event is unchanged"**, and that the same
   enforcement was **backported to all supported versions on 2026-07-20** — so
   the security behaviour is already in force on v4.4.0 today.

Inputs still used — `sparse-checkout`, `fetch-depth`, `persist-credentials`,
`ref` — all survive v7. The `ref` pin (`steps.resolve.outputs.sha`) lives in the
composite under a plain `pull_request` event and is unaffected.

## actions/dependency-review-action 5 — accepted

Source: [dependency-review-action releases](https://github.com/actions/dependency-review-action/releases)

> "This is a new major version … which updates the runtime to node24. This
> requires a minimum Actions Runner version v2.327.1 to run."

That is the only documented breaking change. The three inputs this repository
sets — `fail-on-severity: high`, `comment-summary-in-pr: never`, and the
AGPL/SSPL `deny-licenses` list — are unchanged and **were not relaxed**.

## docker/build-push-action 7 — accepted

Source: [build-push-action releases](https://github.com/docker/build-push-action/releases)

| Breaking change                                                                | Applies here?                                   |
| ------------------------------------------------------------------------------ | ----------------------------------------------- |
| Node 24 runtime, runner ≥ v2.327.1                                             | satisfied on GitHub-hosted runners              |
| **Removed** `DOCKER_BUILD_NO_SUMMARY` and `DOCKER_BUILD_EXPORT_RETENTION_DAYS` | **neither is used anywhere** — verified by grep |
| Legacy export-build tool support removed                                       | not used                                        |
| Codebase switched to ESM; `@actions/core` 3.0.0                                | internal to the action                          |

Inputs actually used: `context`, `target`, `push: false`, `load: true`, `tags`,
`cache-from`/`cache-to` (`type=gha`), `build-args`. All unchanged in v7.
`push: false` at every call site, so **no registry is written**.

## docker/setup-buildx-action 4 — accepted

Source: [setup-buildx-action releases](https://github.com/docker/setup-buildx-action/releases)

| Breaking change                    | Applies here?                                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Node 24 runtime, runner ≥ v2.327.1 | satisfied                                                                                             |
| ESM migration                      | internal                                                                                              |
| "Remove deprecated inputs/outputs" | **this repository passes no inputs at all** — every call site is a bare `uses:` with no `with:` block |

## github/codeql-action 4.37.4 — accepted

A patch within the already-adopted v4 line. The only rule that matters is the one
learned the hard way: **`init` and `analyze` must carry the same version**, or
every CodeQL leg fails with _"Loaded a configuration file for version 'X', but
running version 'Y'"_. Dependabot grouped both this time; the integration keeps
them on a single SHA.

## Runner requirement, checked rather than assumed

Three of the five actions now require **Actions Runner ≥ v2.327.1** and Node 24.
Rather than trust that GitHub-hosted runners are current, each of #126–#130 was
confirmed to have **downloaded its new action SHA and succeeded** — see
[`github-actions-review.md`](github-actions-review.md). A green check that ran
the old version would prove nothing.
