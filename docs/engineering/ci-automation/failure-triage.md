# Failure triage

## Start with the gate summary, not the logs

Open the run, read the **`ci-gate`** job summary. It names every job, its result,
and _why_ the gate accepted or rejected it. Nine times in ten that is the whole
diagnosis.

Then download the artifact for the failing job. Every job uploads its evidence
**even when it fails** — that is deliberate, because diagnosing from a truncated
live log is one of the failure modes this pipeline exists to eliminate.

## By symptom

### `ci-gate` says a job was skipped although change detection required it

The job's `if:` condition and `classify-changes.mjs` disagree. Compare
`evidence-change-detection/classification.json` against the `if:` expression in
`pr-ci.yml`. The classification is authoritative — the gate reads it, not the
condition.

### `ci-gate` says a governed job is absent from `needs`

A job was renamed or removed without updating `DECLARED_JOBS` in
`scripts/ci/evaluate-ci-gate.mjs`. Fix the list. This failure is the whole point
of the gate: with a job-name-shaped required-check list, the rename would have
silently removed a required check instead.

### `ci-gate` says a job ran that the gate does not govern

A job was added to `pr-ci.yml` without registering it. Add it to `DECLARED_JOBS`
with the correct `alwaysRequired` value.

### Coverage gate fails with a drop

Read `coverage-gate.json` — it names the metric, the measured value, the baseline
and the delta. Then decide honestly which happened:

- coverage genuinely fell → add the tests;
- code was deleted, so the denominator moved → update the baseline in the same
  commit and say so in the message;
- cross-platform attribution drift → if it is inside 0.5 pp it already passed; if
  it is outside, it is not drift.

### Coverage gate fails with "vacuous"

A critical-module rule's `pathPrefix` matches no file. The module moved or was
renamed. Fix the prefix — do not delete the rule.

### Migration replay fails on the schema hash

The schema changed. If a migration in this pull request is responsible, raise
`schemaHash` in `.github/ci-baselines/schema-baseline.json` **in the same
commit**, so the diff shows the migration and the new hash together. If no
migration changed, something mutated the schema at runtime, which is a defect.

### Migration replay fails on "zero application tables"

The service container was not fresh. On a hosted runner this should be
impossible; if it happens, the job order changed or a step is reusing a database.

### Clean room fails on the schema hash after the suites

A test suite mutated the schema. **Every result above that step is unsound** —
do not diagnose anything else in the run until this is fixed. Find the suite that
issued DDL outside a rolled-back transaction.

### Clean room fails on "working tree clean"

A suite wrote a tracked file. Find it with the `git status --porcelain` output in
the log. This is a defect, not a nuisance: the next job would be testing a
different tree.

### Container job fails on runtime uid

The Dockerfile's `runner` stage stopped creating `nextjs:nodejs` at 1001:1001, or
the `USER` directive moved. ADR-007 requires a dedicated non-root account, and
the exact value is asserted so that silently falling back to the image's built-in
`node` user (1000) is caught.

### Container job fails on "the container exited before serving a request"

The image builds and then dies. Read `container.log` in the artifact — it is
captured before the container is removed.

### Container job fails on a vulnerability

`container-policy.json` separates **fixable** (blocking) from **unfixable**
(reported). If it is fixable, bump the package. If the report says unfixable and
the job still failed, a _secret_ was found in a layer — that always blocks, and
it needs rotating before anything else.

### Dependency policy fails on production

There are no exceptions for the production tree. Patch, override, or replace. If
the parent pins a vulnerable version exactly, an `overrides` entry is the
mechanism — that is how `postcss` and `sharp` were fixed.

### Dependency policy fails on an expired exception

Re-check whether a patched release now exists. If it does, remove the entry. If
it does not, extend the date **with a fresh reason** — not by editing the date
alone.

### Dependency policy fails on "matched no current advisory"

An exception outlived its problem. Remove it. This is intentional: the file
cannot quietly accumulate.

### Test honesty fails

Read the rule identifier. `TH-001` `.only`, `TH-003` empty suite and `TH-005`
vacuous assertion are all _critical_ — they mean a test that cannot fail. Fix the
test; do not suppress the rule.

### Workflow security fails

Read the rule identifier and `security-model.md` §2. `WFS-005`
(`pull_request_target`) and `WFS-006` (untrusted interpolation) are critical and
should never be suppressed. `WFS-001` means running
`node scripts/ci/check-workflow-security.mjs` locally and pinning the action.

### CodeQL cannot upload SARIF

Code scanning is not enabled on the repository (`security-model.md` §7). The
SARIF is still attached as an artifact, so nothing is lost — but the Security tab
stays empty until an owner enables it.

### A job is queued for a long time

Standard hosted runners queue. This is not a failure. Do not re-run — a re-run
goes to the back of the same queue.

## What never to do

- **Never re-run before reading the artifact.** The evidence is already there.
- **Never push an empty commit to clear a failure.** It breaks the link between
  the failure and its cause.
- **Never add `continue-on-error` to get past a red job.** `WFS-009` blocks it,
  and the two existing suppressions each explain themselves in full.
- **Never widen a secret-scan allow-list to a whole pattern class.** Entries name
  one file and one class, deliberately.
- **Never diagnose from a truncated log.** Download the artifact.
