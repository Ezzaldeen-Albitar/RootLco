# Pre-P1-22 repository reconciliation and main promotion gate

Proves, before P1-22 begins, that every approved and still-relevant change is
contained in protected `develop`, that nothing coherent is stranded anywhere
else, and that the exact verified `develop` tree reached `main` through a
protected pull request.

## Owner authorization

> **OWNER AUTHORIZATION — DEVELOP TO MAIN PROMOTION**
>
> The Product Owner authorizes promotion of the complete approved RootLco
> `develop` baseline to `main` after repository reconciliation and successful
> full hosted verification.
>
> This does not authorize:
>
> - direct protected pushes;
> - merging stale or unreviewed branches;
> - bypassing failed checks;
> - beginning P1-22 before promotion closure;
> - production deployment;
> - weakening branch protection;
> - changing the approved merge strategy.

## The SHAs

| Name                                         | Value                                      |
| -------------------------------------------- | ------------------------------------------ |
| `DEVELOP_BASELINE_SHA` / `FINAL_DEVELOP_SHA` | `d9a2c1dc8d09e8fe2b3cf9ca8a2d4a6c905756de` |
| `FINAL_DEVELOP_TREE`                         | `13c1280e73c506b103380f853a130ef29ea13e3d` |
| `MAIN_BEFORE_SHA`                            | `491c4e0882763b5d5864737e63b4e31ca708a6b5` |
| `MAIN_BEFORE_TREE`                           | `96a01e738c71da55435f68ce7107a812a3e5c4eb` |

## The documents

| Document                                               | What it establishes                                                                     |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| [`branch-reconciliation.md`](branch-reconciliation.md) | All 73 remote branches classified; 70 contained, 2 superseded, 0 stranded               |
| [`pr-reconciliation.md`](pr-reconciliation.md)         | 0 open PRs; 92 merged all contained; 2 closed-unmerged superseded                       |
| [`develop-verification.md`](develop-verification.md)   | The frozen baseline: 17/17 checks, full-tree CodeQL, totals, deployment-risk assessment |
| [`main-promotion.md`](main-promotion.md)               | The promotion pull request and its merge                                                |
| [`final-tree-identity.md`](final-tree-identity.md)     | Byte-identity of `main` and the promoted `develop` tree, and containment proofs         |
| [`execution-checkpoint.md`](execution-checkpoint.md)   | What was done, in order, including what nearly went wrong                               |
| [`evidence/`](evidence/)                               | Raw measurement output                                                                  |

## Outcome

**Go — promoted.** `origin/main` = **`9c2fea162e5a270c740bac8db3546ed695a6f58a`**,
tree `13c1280e73c506b103380f853a130ef29ea13e3d` — **byte-identical** to the
promoted `develop` tree, zero drift, both parents exact. 17/17 protected checks
green on `main`, full-tree CodeQL 0 open / 0 application / 0 High, no deployment.

## Headline result

- Remote branches reviewed: **73** · fully contained: **70** · superseded: **2** · `main`: 1
- Open pull requests: **0** · approved work missing from `develop`: **0**
- P1-22 implementation found: **none** (two forward _contract documents_ from P1-11, no code)
- Frozen `develop`: **17/17** hosted checks green, full-tree CodeQL **0 open / 0 application / 0 High**
- Deployment workflows: `workflow_dispatch` only — **promotion cannot deploy**

## The one thing worth reading twice

`main` had **15 commits not on `develop`**, which looks alarming until measured.
All fifteen are merge commits from earlier promotions, every second parent is on
`develop`, and `git rev-list --no-merges --count origin/develop..origin/main`
returns **0**: no direct push has ever landed on `main`. `main`'s tree is
byte-identical to the tree of `merge-base(main, develop)`.

`main` therefore carries **no content of its own**, and nothing on it can be lost
by promoting `develop`. That had to be proven rather than assumed — a single
hand-made commit on `main` would have made a clean tree identity impossible.
