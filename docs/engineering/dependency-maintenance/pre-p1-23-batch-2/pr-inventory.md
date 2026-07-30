# Pre-P1-23 batch 2 — pull-request inventory

Ten Dependabot pull requests, #121–#130, opened 2026-07-30 12:29–12:30Z.

Every row was derived from the GitHub API and from each pull request's own
`package.json` / workflow patch — **never from the title**. Titles have been wrong
before in this repository, and one is wrong again here (see #125).

## The good news first

**All ten were based on `b5e4f6f9`, the current protected `develop`.** In the
previous round all ten were 29 commits stale, which made every green tick
evidence about a tree we did not ship. That is not the case here: these greens
describe the real tree. They still do not describe the _combined_ tree, and after
#131 merged they no longer describe the current _workflows_ — see
[`integration-order.md`](integration-order.md).

No non-Dependabot pull request was mixed into the batch.

## Inventory

| PR   | Dependency                                | Old            | Proposed | Resolved | Class     | Kind           | Files | Lockfile | CI at intake | Disposition                                                                            |
| ---- | ----------------------------------------- | -------------- | -------- | -------- | --------- | -------------- | ----- | -------- | ------------ | -------------------------------------------------------------------------------------- |
| #121 | `eslint`                                  | ^9 (9.39.5)    | ^10      | 10.8.0   | **major** | dev            | 2     | yes      | **RED** 4/19 | **deferred, closed** → [#132](https://github.com/Ezzaldeen-Albitar/RootLco/issues/132) |
| #122 | `sass`                                    | ^1.101.0       | ^1.102.0 | 1.102.0  | minor     | dev            | 2     | yes      | green 19/19  | **superseded** by #135                                                                 |
| #123 | `@types/node`                             | ^20 (20.19.43) | ^26      | 26.1.2   | **major** | dev            | 2     | yes      | green 19/19  | **deferred, closed** → [#133](https://github.com/Ezzaldeen-Albitar/RootLco/issues/133) |
| #124 | `pino`                                    | ^9.14.0        | ^10.3.1  | 10.3.1   | **major** | **production** | 2     | yes      | green 19/19  | **superseded** by #135                                                                 |
| #125 | `supabase`                                | **^2.34.3**    | ^2.110.0 | 2.110.0  | minor     | dev (CLI)      | 2     | yes      | green 19/19  | **superseded** by #135                                                                 |
| #126 | `github/codeql-action` **init + analyze** | v4.37.3        | v4.37.4  | —        | patch     | CI             | 1     | —        | green 19/19  | **superseded** by #131                                                                 |
| #127 | `docker/setup-buildx-action`              | v3.12.0        | v4.2.0   | —        | **major** | CI             | 3     | —        | green 19/19  | **superseded** by #131                                                                 |
| #128 | `actions/dependency-review-action`        | v4.9.0         | v5.0.0   | —        | **major** | CI             | 1     | —        | green 19/19  | **superseded** by #131                                                                 |
| #129 | `actions/checkout`                        | v4.4.0         | v7.0.1   | —        | **major** | CI             | 16    | —        | green 19/19  | **superseded** by #131                                                                 |
| #130 | `docker/build-push-action`                | v6.19.2        | v7.3.0   | —        | **major** | CI             | 2     | —        | green 19/19  | **superseded** by #131                                                                 |

Totals: **7 majors**, 3 minor/patch · 1 grouped, 9 standalone · 1 red, 9 green ·
1 production dependency, 4 dev, 5 CI.

## Two titles that do not match their contents

**#125 says "Bump supabase from 2.109.1 to 2.110.0".** The installed version was
2.109.1, but the **declared range** in `package.json` is `^2.34.3`. The pull
request therefore moves the declared range `^2.34.3 → ^2.110.0` — a range
tightening across 76 minor versions, not the one-minor step the title implies.
The resolved version moves only 2.109.1 → 2.110.0, so the practical change is
small, but the declared floor rises a long way. Read the patch, not the title.

**#126 says "the actions group with 2 updates"** without naming them. The two are
`github/codeql-action/init` and `github/codeql-action/analyze`, both v4.37.3 →
v4.37.4 — the coupled CodeQL pair, moved **together**, which is correct and is
exactly what a lone `analyze` bump broke last round. It has nothing to do with
the four standalone action pull requests, so the group-versus-standalone conflict
one would assume from the name does not exist. See
[`overlap-matrix.md`](overlap-matrix.md).

## Runtime impact

| PR                 | Runs in production? | Blast radius                                                                                                    |
| ------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------- |
| #121 `eslint`      | no                  | lint gate only                                                                                                  |
| #122 `sass`        | build-time          | SCSS compilation, `style:check`, production build                                                               |
| #123 `@types/node` | no (types erased)   | compile-time surface — see [#133](https://github.com/Ezzaldeen-Albitar/RootLco/issues/133)                      |
| #124 `pino`        | **YES**             | the only runtime dependency in this batch; imported by exactly one file, `src/server/observability/logger.ts`   |
| #125 `supabase`    | no                  | **local developer CLI only** — no workflow invokes the binary; CI uses a `postgres:17-alpine` service container |
| #126–#130          | no                  | CI workflows only                                                                                               |

## Security relevance

None of the ten is a security update. `npm audit --omit=dev` is **0** before and
after. The development tree carries the single pre-existing `brace-expansion`
advisory (GHSA-mh99-v99m-4gvg), waived exactly and unbroadened; #121 would have
changed its resolved-node fingerprint, which is recorded in
[`application-dependencies-review.md`](application-dependencies-review.md).

## A late arrival: #134

Dependabot re-evaluated after #131 merged and opened **#134** at 14:01Z —
`hadolint/hadolint-action` v3.3.0 → **v3.4.0**, a minor, collected correctly by
the `actions` group, based on the then-current `develop` (`027024d5`).

It is **in scope**: the batch aims to leave no unresolved Dependabot pull
request behind, and leaving it untriaged would break that. (An earlier draft
asserted the batch _had_ closed with zero open — it had not, at the time of
writing; the measured final count is in the closure report.) It could not simply be merged as
proposed, for the same reason #129 could not: `hadolint/hadolint-action` has a
row in the pin registry at
`docs/engineering/ci-automation/security-model.md`, and Dependabot does not
maintain that table. Merging the workflow change alone would leave the registry
false — the exact defect corrected twice already in this initiative.

It was first folded into #135 together with its registry row — and **CI rejected
it**, which is the most useful thing that happened in this batch.

### It was reverted, and why

`container-security` failed at the step **"Dockerfile best practices
(hadolint)"**. The cause is not the action wrapper but the linter it bundles:
hadolint-action **3.4.0 ships hadolint v2.15.0**, which reports **DL3025** — _"Use
arguments JSON notation for CMD and ENTRYPOINT arguments"_ — at `Dockerfile:179`.
The step runs with `failure-threshold: warning`, and DL3025 is a `warning`, so
the job fails. (Two `DL3066` findings also appear, but they are `note` level and
below the threshold.)

**The Dockerfile is unchanged by this batch.** Only the linter moved. The line it
objects to is deliberate:

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1
```

That healthcheck uses **shell form on purpose**, for the `|| exit 1` fallback.
Rewriting it in JSON notation to satisfy DL3025 would remove the fallback and
change how an unhealthy container reports itself — a production behaviour change,
not a dependency bump.

The three ways to make 3.4.0 green were therefore:

1. rewrite the `HEALTHCHECK` in JSON form — degrades the healthcheck;
2. add a `.hadolint.yaml` or inline `# hadolint ignore=DL3025` — suppressing a
   lint finding to force an upgrade green;
3. lower `failure-threshold` from `warning` to `error` — weakening the gate.

All three are excluded: **nothing may be weakened to accept an upgrade**, and the
first is out of scope for dependency maintenance.

**#134 is therefore deferred and closed**, not superseded. `hadolint-action`
remains **v3.3.0**, the workflow diff against `develop` is **0 files**, and the
pin registry is back in agreement with the tree — 12 rows, 12 live actions, 0
mismatches.

Recorded so the next attempt starts from the finding rather than rediscovering
it: adopting hadolint-action ≥ 3.4.0 requires an owner decision about the
`HEALTHCHECK` form first. **No Dependabot ignore was added** — this is a minor,
not a major, and suppressing minors for a linter would hide genuine findings. It
will be re-proposed, and that is correct.
