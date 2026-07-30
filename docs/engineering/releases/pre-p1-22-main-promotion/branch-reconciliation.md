# Branch reconciliation

Every remote branch, measured against `origin/develop`
`d9a2c1dc8d09e8fe2b3cf9ca8a2d4a6c905756de`.

Raw measurement: [`evidence/branch-containment.txt`](evidence/branch-containment.txt),
produced by `git merge-base --is-ancestor`, `git rev-list --count`,
`git diff --name-only develop...BRANCH` and `git cherry` for all 73 branches.

**Containment was measured, never inferred from a branch name.**

## Result

| Classification                                          | Count                             |
| ------------------------------------------------------- | --------------------------------- |
| 1 — fully contained in `develop`                        | **70**                            |
| 2 — superseded by later merged work                     | **2**                             |
| 3 — documentation/history branch with no unique content | 0 (all such branches are class 1) |
| 4 — experiment or abandoned                             | 0                                 |
| 5 — unreviewed unique work                              | 0                                 |
| 6 — **approved unique work that must be merged first**  | **0**                             |
| 7 — P1-22 or later work to exclude                      | 0                                 |
| — `origin/main` (promotion target, handled separately)  | 1                                 |

**Nothing is stranded. Nothing needs merging before promotion.**

## The 70 fully-contained branches

Every `feature/*`, `gate/*`, `docs/*`, `chore/p1-01-*`, `revert-*` and all but one
`fix/*` branch is an **ancestor** of `develop`: 0 commits ahead, 0 files differing
on a three-dot diff, `git cherry` reporting no unique patch.

These are the historical heads of work already merged through pull requests. They
are eligible for later deletion as housekeeping (§8) and are **not** deleted here.

## The two not contained

### `chore/remove-dead-shared-app-error` — **superseded, redundant, do not merge**

| Field          | Value                                                                                 |
| -------------- | ------------------------------------------------------------------------------------- |
| Head           | `f3dbba994f1e499ce7718d439a57a1bca4714d69`                                            |
| Merge base     | `0f8268ef80a51441625cfe93d037e7c0804f40fa`                                            |
| Unique commits | 1 — `chore(shared): remove the dead app-error module superseded by src/server/errors` |
| Files touched  | `src/shared/errors/app-error.ts` (delete), `vitest.config.ts` (modify)                |
| Pull request   | **none — never proposed**                                                             |

**Proven redundant, not assumed:**

- `git cat-file -e origin/develop:src/shared/errors/app-error.ts` → **absent**. The
  file this branch deletes is already gone from `develop`, removed by `f1e469b`
  _"chore(ci): close the app-error coverage gap by deleting the dead module"_.
- `git rev-parse origin/chore/remove-dead-shared-app-error:vitest.config.ts` and
  `git rev-parse origin/develop:vitest.config.ts` both yield
  **`fea9dfe0ec52acf5554f035b2aaa0b7fbd5dc95f`** — the same blob. The branch's
  edit to the coverage `include` list is already on `develop`, byte for byte.

The branch's intended end state is **already fully realised**. Its one commit
carries a unique SHA and zero unique content. Merging it would achieve nothing;
it is recorded as stale and excluded.

### `fix/p1-14-idempotency-replay-evidence` — **absorbed, and merging it would REGRESS**

| Field          | Value                                                                             |
| -------------- | --------------------------------------------------------------------------------- |
| Head           | `c27b2a06680b1325a76b08c0f7f6ff51e2174711`                                        |
| Merge base     | `0f8268ef80a51441625cfe93d037e7c0804f40fa`                                        |
| Unique commits | 1 — `test(p1-14): prove the ten declared-idempotent IAM operations really replay` |
| Pull request   | **none** — it was cherry-picked instead                                           |
| `git cherry`   | `-` — an **equivalent commit already exists** on `develop`                        |

Its content reached `develop` as **`b32024cbe4788c2973656c91a890a2c6ddd42cea`**,
cherry-picked during the CodeQL remediation with **authorship preserved**
(`Ezzaldeen-Albitar <ezzaldeenalbitar9@gmail.com>` on both). Blob comparison:

| File                                                          | Branch vs develop                                   |
| ------------------------------------------------------------- | --------------------------------------------------- |
| `tests/backend/p1-14-idempotency-replay.test.ts`              | **identical** — `98cf679…`, 34 305 bytes both sides |
| `docs/phase-1/phase-1-14/evidence/operation-test-matrix.json` | **identical** — `a460cee…`                          |
| `tests/foundation/operation-coverage-gate.test.ts`            | **identical** — `5f2c6e1…`                          |
| `scripts/check-operation-test-coverage.mjs`                   | **differs — the branch is OLDER**                   |

That last row is the reason this branch must not be merged. The branch carries the
**pre-remediation** version of that script:

```
branch:  for (const entry of readdirSync(dir)) { const st = statSync(full); …
develop: for (const entry of readdirSync(dir, { withFileTypes: true })) { …

branch:  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
develop: try { return readFileSync(join(ROOT, rel), 'utf8'); }
         catch (error) { if (error.code === 'ENOENT') return null; throw error; }
```

Both `develop` forms are the **`js/file-system-race` (TOCTOU) fixes** delivered by
the CodeQL remediation. Merging this branch would reintroduce two resolved
high-severity race conditions.

**Superseded. Excluded. Eligible for deletion as housekeeping.**

## `origin/main`

15 unique commits, **all merge commits** from earlier promotions, every second
parent already on `develop`. `git rev-list --no-merges --count origin/develop..origin/main`
= **0** — no direct push has ever landed on `main`.

`main`'s tree `96a01e738c71da55435f68ce7107a812a3e5c4eb` is **byte-identical** to
the tree of `merge-base(main, develop)` = `f326e24`, so `main` carries no content
of its own and nothing on it can be lost by promoting `develop`.

## Deletion

No branch is deleted here. §8 makes deletion housekeeping, separate from
promotion, and repository governance has not authorised it in this gate. The 72
non-`main` branches are recorded as eligible for a later cleanup.
