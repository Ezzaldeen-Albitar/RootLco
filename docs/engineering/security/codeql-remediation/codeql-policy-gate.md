# The CodeQL / SARIF policy gate

Closes the governance gap **AR-52** exposed, in two scripts — because the gap
has two halves and only one of them can run inside the pipeline.

## The gap

The previous initiative shipped CodeQL analysis and then discovered, at the
merge gate, that a `CodeQL` check produced by GitHub Advanced Security had been
**red on five consecutive heads** while every report said the workflow was 14/14
green.

Nothing was careless. The workflow _was_ green — uploading SARIF is what that
job does. The alerts it uploaded were judged by a separate check-run belonging
to no workflow run, which `/actions/runs` therefore never mentions. The commit
carried **19 checks**; the run listed **14 jobs**.

Two lessons, wired in separately.

## `scripts/ci/codeql-policy.mjs` — the repository's opinion of its own SARIF

Refuses to report clean unless it can show the analysis happened:

| Condition                              | Verdict                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| no SARIF at all                        | No-Go — _"a scan that did not run must never read as a scan that found nothing"_ |
| `runs: []`                             | No-Go — nothing was analysed                                                     |
| `results` absent                       | No-Go — absent is not the same as empty                                          |
| `version` not `2.1.x`                  | No-Go                                                                            |
| an expected language produced no SARIF | No-Go                                                                            |
| `filesAnalysed === 0`                  | No-Go — an empty scan is not a clean scan                                        |

Then it counts by security severity, precision, rule and scope, and fails on
every unresolved Critical or High — **in tooling as well as application source**,
because "CI only" is not a disposition.

Deliberately **not** a full JSON-schema validation. A gate that pulls in a
900-line schema and then reports "invalid" tells nobody anything; this checks the
exact fields it reads and names the one that is wrong.

### Dismissal governance

A dismissal matches on **rule AND path**, never rule alone. It fails when:

- it matches nothing — the finding was fixed or moved, so the entry is stale
- the same rule appears at a path nothing covers — dismissals are per-path
- it has expired
- it omits `source`, `sink`, `reason`, `reviewer` or `reviewedOn`
- **it covers anything under `src/`** — application findings are fixed or
  refuted, never waived

A dismissed finding is **adjudicated, not open**: it does not count toward
`maximumOpenFindings`. Otherwise "dismiss it" and "raise the ceiling" would be
the same action, which is precisely the laxity the ceiling exists to prevent.

#### Staleness is scoped to what the leg actually read

`code-security` is a **matrix**, one language per leg, so each leg has only its
own SARIF. The `actions` leg analyses workflow YAML — 17 files — and no
JavaScript at all. Judging a `.mjs` dismissal there is a claim that leg has no
evidence for, and the gate made exactly that claim on a real hosted run against a
live entry.

So staleness is now judged only for dismissals whose path appears in
`run.artifacts` — CodeQL's own record of the files it read. Anything else is
reported as **not judged here**, with a count in the summary table, because
silence about an unjudged entry is how a stale one survives.

Two guards keep this from becoming a loophole:

- a dismissal whose path **was** analysed and matched nothing still **fails**;
- when no run reports artifacts at all, the gate judges everything anyway and
  **warns that it is doing so blind** — losing the check silently is worse than
  an occasional false stale report, because the first is invisible.

Both directions are mutation-pinned (M-19, M-20, M-21). This was filed by an
adversarial reviewer, refuted on a technicality about their reproduction, and
then proved by a red check on the final head.

## `scripts/ci/check-commit-checks.mjs` — the half that cannot run inside the run

A run cannot enumerate the checks of the commit it is still producing, so this is
a **pre-merge instrument**, not a job. It reads `/commits/{sha}/check-runs` — the
only endpoint that sees checks belonging to no workflow run — and fails on any
red, any still-running, any absent required check, and an empty list.

It reports how many checks came from apps **other than** GitHub Actions, and
**warns when that number is zero** rather than treating it as confirmation. It
refuses to render a verdict with no token rather than reporting a green it cannot
support, prints sanitized response context on failure, and never prints the
token.

### Honest limit

This is invoked by a maintainer before merge; it is **not** wired into `ci-gate`,
because it cannot be. What enforces it is procedure plus the gate record, which
records the full check-run list at the merged SHA. That is weaker than a job and
is stated as such rather than implied.

## Three defects the gate found in the gate

On its first hosted run it failed, and every failure was real.

**1 — it could not find a SARIF that was sitting right there.**
CodeQL names the output after the **language**, not the pack: analysing
`javascript-typescript` writes `javascript.sarif`. An exact-substring match on
the filename therefore never matched, and the gate reported the one condition it
exists to prevent — claiming an analysis did not happen when it did. A pack now
matches the whole name or any hyphen-separated part of it, and a test proves
`--language actions` against a javascript SARIF still fails.

**2 — `js/http-to-file-access`, medium**, in the new
`check-commit-checks.mjs`: unbounded GitHub API strings written into a report.
GitHub's own CodeQL check reported that run **success** — it blocks only on high
and critical. The repository ceiling of zero is what caught it. Content is now
bounded by `safeText`; the residual flow is dismissed with a full reproduction,
the only dismissal in the baseline.

**3 — `js/incomplete-sanitization`, high**, in the fix for defect 2:
`safeText` escaped pipes without escaping backslashes first, so the input `\|`
became `\\|` — a literal backslash followed by a **live** table separator. The
escaper handed back what it was added to prevent. Backslash-first now, verified
by reproduction: the hostile input `evil\|name` yields exactly **one** table cell.

An escaper that runs in the wrong order is worse than none, because it looks
handled.

## Evidence

`tests/ci/codeql-policy.test.ts`, **39 tests**. Each is a mutation in disguise:
each asserts that some specific way of being blind produces No-Go rather than
silence — missing SARIF, empty runs, absent results, malformed version, a skipped
language, zero files, an injected High, a broadened dismissal, a dismissal
matching nothing, a dismissed rule reappearing elsewhere, an expired dismissal, a
dismissal covering `src/`, a red non-Actions check, a check still running, an
absent required check, and an empty check list.
