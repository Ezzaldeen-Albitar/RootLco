# Run-ledger zero-case guard

**Status:** Binding engineering standard (repository tooling, owned by no phase) ·
**Related:** `scripts/ci/check-p1-27-closing-values.mjs` · `tests/ci/p1-27-closing-values.test.ts` ·
`.github/ci-baselines/test-count-baseline.json`

---

## 1. The defect class

A test file can be **counted** in a vitest JSON report and contribute **zero assertions**. It
happens when a file fails to collect, when a suite throws at the top level before any `it`
registers, or when a `describe` returns early.

vitest reports `numFailedTests: 0` for every one of those. So a run ledger that records
`tests / passed / failed / files` sees a **smaller green run** and nothing else. The tier total
moves on an unchanged tree and no gate objects.

This is the same family as every other false green this repository has paid for: the control exists,
the report is green, and the thing the control was meant to observe never happened.

## 2. The invariant

> Expected executable coverage cannot disappear without turning the gate red.

Concretely: a run record must be able to distinguish a file that **ran and passed** from a file that
**ran nothing**, and `0 cases` must never be read as `0 failures`.

## 3. The executable guard

`--record` writes four facts about EXECUTION that outcome counts cannot express:

| field               | what it answers                              |
| ------------------- | -------------------------------------------- |
| `exitCode`          | what the runner itself returned              |
| `reporterSuccess`   | the reporter's own verdict                   |
| `failedSuites`      | suites that failed without failing a case    |
| `filesWithoutCases` | files present in the report that ran nothing |

`judgeRunCompleteness` then refuses a record that:

- carries none of them — an absent field is **not** evidence of absence, so a legacy record is
  `RUN_RECORD_INCOMPLETE` rather than clean;
- lists any file in `filesWithoutCases` (`RUN_RECORD_FILE_RAN_NO_CASES`);
- lists any suite in `failedSuites` (`RUN_RECORD_SUITE_FAILED`);
- carries a non-zero `exitCode`, or `reporterSuccess: false`
  (`RUN_RECORD_RUN_NOT_SUCCESSFUL`).

It runs **before** the staleness rules and outside their short-circuits: a record naming an
unresolvable commit `continue`s, and a run that ran nothing would otherwise never be judged at all.

## 4. Proof that it is load-bearing

Not a structural test that the guard exists. The guard was **temporarily neutered** and the exact
historical shape — a counted file contributing zero cases, `reporterSuccess: true`, zero failed
cases — was judged:

```
WITHOUT the guard:  []                              -> GREEN (the defect)
WITH the guard:     RUN_RECORD_FILE_RAN_NO_CASES    -> RED
```

`tests/ci/p1-27-closing-values.test.ts` carries `Z1`–`Z5` driving the same shapes through
`runCompleteness` and `judgeRunCompleteness`, plus self-check cases `J`–`M` so each of the four new
failure names is reachable by an input — the gate's own rule that a declared failure no input
produces is itself a defect.

## 5. Test-floor basis

**No new floor mechanism was added, deliberately.** `.github/ci-baselines/test-count-baseline.json`
already carries a per-tier `minTests`, enforced by `summarise-vitest.mjs`, covering unit, database,
backend and web. A historical `tests/ci/web-test-floor.test.ts` was considered and **not** brought
forward: the existing floor is tier-wide and stronger than a single-tier file, and duplicating it
would create two numbers that can disagree.

The floor and this guard answer different questions and both are needed. A floor catches a **large**
drop in executed cases. This guard catches a **single file** that stopped contributing — which a
floor with ordinary headroom will not see.

## 6. Residual limitations

- The guard reads what the reporter emitted. A file that is never **discovered** — excluded by a
  config change, renamed out of the glob — appears in no report and is invisible here. The
  `files` cross-check against a walk of the tree is what covers that, and it is a separate rule.
- `skipped` cases are counted as cases. A file whose every case is `it.skip` contributes assertion
  results and is not flagged. That is deliberate: skipping is a visible, reviewable act, and the
  existing skipped-count reporting is where it belongs.

## 7. Recording a tier from the runner whose verdict the repository ships against

`exitCode` records the RUNNER'S OWN VERDICT, and that verdict is a property of the machine
as much as of the tree. This repository's unit tier exits **0** on the hosted runner and
**1** on a slower one — all 3051 cases passing, `success: true`, no failed suite, no file
without cases, and three unhandled `[vitest-worker]: Timeout calling "onTaskUpdate"` errors
that **the JSON report has no field for**. Three test files each hold a worker's event loop
past birpc's sixty-second deadline; the hosted runner completes the same tier in 72 seconds
and raises none.

`judgeRunCompleteness` refuses that local record, and it is right to. So the record may be
taken from the run that produced it:

```
node scripts/ci/check-p1-27-closing-values.mjs --record <tier> --hosted-run <runId>
```

This is the same class of evidence the gate already defines as `HOSTED_ARTIFACT_ATTESTED`:
no local command can re-derive a hosted observation, and the gate does not pretend
otherwise. What it checks is INTERNAL CONSISTENCY.

**Nothing is typed.** Given a run id, `scripts/lib/hosted-run-report.mjs` reads:

- the head, from the run — and the recorder refuses unless it is `HEAD`, because filing a
  run of one tree against another is the only way this writer could manufacture a green
  record;
- the job, found by the **step** that runs the tier and **that actually reached a verdict**.
  One reusable workflow defines every step and each task instantiates all of them, so three
  jobs carry a `Unit tier with coverage` step and two skip it. A run that ran the tier twice
  is refused as ambiguous rather than resolved by taking the first;
- the **exit code, from that step's own conclusion** — the one fact the report cannot carry;
- the counts, from the uploaded artifact, whose bytes are checked against the digest the
  API publishes for them.

`judgeRunProvenance` then refuses a record that claims a hosted runner and cannot account
for it: incomplete provenance (`RUN_RECORD_HOSTED_PROVENANCE_INCOMPLETE`), a run describing
a different head than the record (`RUN_RECORD_HOSTED_HEAD_MISMATCH`), or a hosted record
carrying dirty working-tree paths no hosted checkout has
(`RUN_RECORD_HOSTED_CLAIMS_LOCAL_MEASUREMENT`).

**Authority is not an exemption.** The completeness rules run on a hosted record unchanged:
a hosted run that exited non-zero, failed a suite or produced a file with no cases is
refused exactly as a local one is. `H6` in `tests/ci/p1-27-closing-values.test.ts` is the
case that pins this, and if it ever returns `[]` the authority has become a loophole.

A hosted record buys authority, not permanence. It is filed against the commit its run ran,
and the staleness rules expire it the moment an executable path changes.
