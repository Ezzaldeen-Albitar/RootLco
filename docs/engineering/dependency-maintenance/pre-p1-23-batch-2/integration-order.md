# Pre-P1-23 batch 2 — integration order

Ten pull requests were **not** merged rapidly and inspected afterwards. Each was
verified in isolation first, then integrated in a deliberate order derived from
the real dependency and file-collision graph.

## Why not merge the originals one at a time

Two hard constraints, both measured rather than assumed:

1. **All five npm pull requests edit `package.json` _and_ `package-lock.json`.**
   Any two conflict textually, so **at most one could ever merge as-is**; the
   rest need a Dependabot rebase and a fresh CI cycle each.
2. **#129 alone touches 16 workflow files** and therefore collides with all four
   other action pull requests, which share `ci.yml`,
   `_reusable-container.yml`, `_reusable-code-security.yml`,
   `_reusable-dependency-security.yml` and `_reusable-release-artifact.yml`.

Beyond cost, sequential merging never tests the tree that finally ships: each
intermediate tree is a combination nobody reviewed.

A third constraint decided #129 specifically — it installs a **split pin**
(see [`github-actions-review.md`](github-actions-review.md)) and therefore could
not be merged as-is under any ordering.

## Order executed

| #   | Unit                        | Vehicle                                                                     | Rationale                                                                                                                                                                                                                                                    |
| --- | --------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | GitHub Actions × 5          | maintainer PR [#131](https://github.com/Ezzaldeen-Albitar/RootLco/pull/131) | Highest file-collision count; must include the composite #129 misses; setup-buildx + build-push must be validated as one coupled Docker toolchain (§15). Nothing else depends on it, so it goes first and every later PR is tested by the **new** workflows. |
| 2   | npm accepted × 3            | maintainer PR #135                                                          | `sass`, `pino`, `supabase` — each proven in isolation, then combined because they mutually conflict on the lockfile.                                                                                                                                         |
| 3   | Dependabot policy + records | same PR #135                                                                | §25 requires every record on `develop` **before** promotion; folding them in avoids a documentation-only commit after promotion, which is forbidden.                                                                                                         |
| 4   | Promotion                   | `develop → main`                                                            | Tree identity pre-proven with `git merge-tree`.                                                                                                                                                                                                              |

## After each accepted merge

Per §18, and actually performed:

- `git fetch --all --prune`
- protected `develop` checks enumerated through `/commits/{sha}/check-runs`, not
  the Actions run list
- non-zero population required, zero live/queued/pending
- **stale green evidence invalidated** — see below
- remaining candidates re-evaluated for conflict

After #131 merged, protected `develop` measured **22/22 success** at
`027024d5` — of which **17 are CI check-runs**; the other five are Dependabot
updater jobs that check out nothing and assert nothing about the tree. The
seventeen include `protected-gate`, both CodeQL legs, hosted clean room,
container security and the full test tiers on the new action versions.

## Stale green evidence — invalidated deliberately

The batch arrived with nine green pull requests, all correctly based on the then
current `develop` (`b5e4f6f9`). That was a genuine improvement over the previous
round, where all ten were 29 commits stale.

**Merging #131 invalidated that evidence anyway**, for a reason worth stating
plainly: #131 replaced **every CI workflow file** and the composite. The green
checks on #122, #124 and #125 were produced by the _previous_ workflows — a
different `checkout`, a different `dependency-review-action`, a different Docker
toolchain. They still describe the right _tree_, but no longer the right _gate_.

So the three accepted npm updates were re-verified on a branch cut from
`027024d5` and gated by the new workflows, rather than merged on the strength of
checks the pipeline no longer runs. A green tick is only evidence about the
pipeline that produced it.

## What was deliberately not batched

`eslint` (#121) and `@types/node` (#123) are not in any integration unit. Both
are deferred, and bundling a refused major with accepted work is how a refusal
becomes invisible.
