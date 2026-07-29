# Execution checkpoint

What was done, in order, and what the measurements actually said — including the
two moments where the obvious reading would have been wrong.

## 1 — Ground truth

`git fetch --all --prune`, clean worktree, single worktree, one remote.

```
DEVELOP_BASELINE_SHA = d9a2c1dc8d09e8fe2b3cf9ca8a2d4a6c905756de
MAIN_BEFORE_SHA      = 491c4e0882763b5d5864737e63b4e31ca708a6b5
```

Both match the authoritative state given for this gate. 73 remote branches, 1
tag, 0 releases.

## 2 — The first thing that looked wrong

`git branch -a --contains origin/main` returned only `main` itself. **`develop`
does not contain `main`.** On a repository about to promote `develop` over
`main`, that is exactly the shape of a problem: if `main` carried work of its
own, promoting `develop` would destroy it.

Measured rather than assumed:

- `git rev-list --count origin/develop..origin/main` → **15** commits.
- Every one of the fifteen is a **merge commit**, and every second parent is on
  `develop`.
- `git rev-list --no-merges --count origin/develop..origin/main` → **0**. No
  direct push has ever landed on `main`.
- `main`'s tree `96a01e73…` is **byte-identical** to the tree of
  `merge-base(main, develop)` = `f326e24`.

So the divergence is entirely the merge commits that past promotions created on
`main` and never back-merged. `main` carries **no content of its own**. The alarm
was correct to raise and wrong to act on.

## 3 — Branch reconciliation

All 73 branches measured with `merge-base --is-ancestor`, `rev-list --count`,
three-dot `diff --name-only`, and `git cherry`. **70 fully contained.** Two not,
plus `main`.

**Containment was never inferred from a branch name.** `fix/*` branches that
sound unmerged are ancestors; a `chore/*` branch that sounds trivial was the one
that needed the most work to disposition.

## 4 — The second thing that looked wrong

A two-dot `git diff origin/develop origin/chore/remove-dead-shared-app-error`
reports **136 files differing**, which reads like a branch carrying a great deal
of unique work.

It is the opposite. Those 136 are almost entirely `D` entries — files `develop`
has that the _branch_ lacks, because the branch was cut at `0f8268e`, before the
CI/CD and CodeQL initiatives. **The branch is 136 files behind, not ahead.**

The instrument that answers "what would this add" is the three-dot diff, and it
shows exactly two files. Both were then resolved by blob hash:

- `src/shared/errors/app-error.ts` — **already absent** from `develop`, deleted by
  `f1e469b`.
- `vitest.config.ts` — the branch's blob and `develop`'s blob are the **same
  object**, `fea9dfe0ec52acf5554f035b2aaa0b7fbd5dc95f`.

Zero unique content. Redundant, excluded.

## 5 — The branch that would have caused a regression

`fix/p1-14-idempotency-replay-evidence` looks like exactly the sort of approved
work a promotion gate exists to rescue: real test evidence, never merged through
a pull request, one commit ahead of `develop`.

`git cherry` reports `-` — an equivalent already exists. Its content reached
`develop` as `b32024c`, cherry-picked with authorship preserved. Three of its
four files are **identical blobs** on `develop`.

The fourth is the point. `scripts/check-operation-test-coverage.mjs` differs, and
the branch holds the **older** version — the one before the CodeQL remediation
replaced `statSync` with `readdirSync(dir, { withFileTypes: true })` and replaced
`existsSync(…) ? readFileSync(…)` with a try/catch on `ENOENT`. Both were
`js/file-system-race` TOCTOU fixes.

**Merging this branch would have reintroduced two resolved high-severity race
conditions.** "Merge everything that exists" would have been a security
regression dressed as thoroughness.

## 6 — Pull requests

94 total: **0 open**, 92 merged, 2 closed-unmerged. All 71 develop merges and all
21 main merges are contained in their respective branches. The two closed PRs are
superseded P1-05 attempts whose branch was later merged and is now an ancestor.

Nothing is stranded in a pull request, because there is no open pull request.

## 7 — Forbidden future work

Path search matched `docs/phase-1/phase-1-11/phase-1-11-p1-22-backend-contract.md`
and its P1-23 sibling. Read rather than pattern-matched: both are **forward data
contracts written during the closed P1-11 database phase**, and both state on
their own first lines that no backend is implemented. `git grep -l -i 'p1-22'`
over `src`, `tests`, `scripts` and `supabase` returns nothing.

Migrations: **119**, highest `20260730090000_…`, zero prefixed `120`.

## 8 — Deployment risk, checked before promoting rather than after

Every workflow's trigger block was read. `deploy-production.yml` and
`deploy-staging.yml` are **`workflow_dispatch` only** — no push trigger, no tag
trigger, and both demand an explicit image digest as input.
`release-verification.yml` fires on tags matching `release-*` or `v*`; no such
tag is created by this gate.

Promotion cannot deploy anything. Stopping condition 6 does not apply.

## 9 — The merge result, computed before performing it

```
git merge-tree --write-tree origin/main origin/develop
→ 13c1280e73c506b103380f853a130ef29ea13e3d   (exit 0, no conflicts)

origin/develop^{tree}
→ 13c1280e73c506b103380f853a130ef29ea13e3d
```

The resulting tree was proven **byte-identical to `develop`'s, and conflict-free,
without touching a single ref**. The promotion's outcome was known before the
pull request existed.

## 10 — Adversarial verification

Nine independent read-only lenses were pointed at the reconciliation with
instructions to break it: stranded commits, pull requests, each of the two
uncontained branches, forbidden future work, tree identity, required containment,
protected-history integrity, and orphaned refs. Every blocker- or major-severity
finding was then handed to a separate refuter.

Outcome recorded in [`final-tree-identity.md`](final-tree-identity.md).
