# Pre-P1-23 batch 2 — develop verification

Protected `develop` was verified after **each** accepted merge, through
`/commits/{sha}/check-runs` — the complete check-run population, not the Actions
workflow list. `/actions/runs` does not list checks contributed by GitHub
Advanced Security, and a `CodeQL` check was red on five heads reported green in
an earlier initiative for exactly that reason.

## Waiter honesty

A verdict was accepted only when **all** of these held simultaneously:

- the token was non-empty — an empty Bearer returns HTTP 401 with no
  `check_runs` key, and a naive "no failures" test reads that as all-green;
- the check-run population was **non-zero**;
- **zero** workflow runs for the SHA were queued or in progress;
- **zero** check-runs were queued or in progress;
- the named required check was **present**, not merely not-failing;
- `neutral` was counted separately and never treated as a pass.

The "required check present" condition is not theoretical: on the promotion
pull request in the preceding gate the population went 36 → 37 as `ci-gate`
registered **last**. A waiter that declared terminal on "everything visible is
done" would have missed it.

## Measured results

| Stage                      | SHA                           | Population | Of which CI | Result                               |
| -------------------------- | ----------------------------- | ---------- | ----------- | ------------------------------------ |
| After #131 (actions)       | `027024d5`                    | 22         | **17**      | **22/22 success**, 0 live, 0 pending |
| Final maintenance baseline | see `execution-checkpoint.md` | —          | —           | recorded there                       |

**The population is not all CI, and saying "22/22" without that is inflation.**
Five of the twenty-two check-runs on `027024d5` are named literally `Dependabot`
— they are Dependabot's own **version-update jobs**, created 82–90 seconds
_after_ the merge commit existed, whose steps are `Set up job` / `Create job
directory` / `Run Dependabot` / `Complete job`. They check out nothing and assert
nothing about the merged tree. The verification population that matters is the
remaining **17**.

The seventeen: `protected-gate`, `static-quality`,
`unit-tests-coverage / unit-coverage`, `application-build / build`,
`database-migration-replay / migration-replay`,
`database-security / security-matrix`, `integration-tests / integration-tests`,
`dependency-security / dependency-security`,
`container-security / container-security`,
`hosted-clean-room / hosted-clean-room`,
`code-security (javascript-typescript)`, `code-security (actions)`,
`secret-scan / secret-scan`, `Secret and sensitive-file scan`,
`Docker build validation`, `Lint, types, tests, build`,
`Database migrations and RLS tests`.

> **A correction.** An earlier draft listed an eighteenth item — "GitHub's own
> `.github/dependabot.yml` configuration check" — and implied the whole 22 were
> verification. Both are wrong. That config check-run **does not exist on
> `027024d5`** (it appears on some commits, such as `b5e4f6f9`, and not on
> others), and the five `Dependabot` entries are updater jobs rather than checks
> of the tree. Counting them made the verification population look larger than it
> was.

## Invariants re-measured, not carried forward

| Item                 | Required  | Measured    |
| -------------------- | --------- | ----------- |
| Migrations           | 119       | 119         |
| Migration 120        | absent    | absent      |
| Schema hash          | unchanged | `a677eb05…` |
| Production audit     | 0         | 0           |
| Application Critical | 0         | 0           |
| Application High     | 0         | 0           |
| Split action pins    | 0         | 0           |
| Broadened exceptions | 0         | 0           |
| P1-23 work           | none      | none        |

The one open CodeQL alert is `#33 js/http-to-file-access` in
`scripts/ci/check-commit-checks.mjs` — Medium, non-application, pre-existing and
documented. It is not new and is not a regression from this batch.
