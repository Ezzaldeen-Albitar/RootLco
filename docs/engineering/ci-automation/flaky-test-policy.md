# Flaky-test policy

**A flaky test is a defect until proven otherwise.**

The default assumption is that a test which failed and then passed found a real
race, a real ordering dependency, or a real resource leak. "Flaky" is a
conclusion you reach _after_ investigating, not a label you apply to avoid it.

## No blanket retries

There is no `retry` setting in any vitest configuration, and there must not be.
`check-test-honesty.mjs` rule **TH-006** fails the build if one appears with a
value above zero.

A runner-level retry converts a deterministic failure into an intermittent one
and hides it behind a green tick. The first failure — the one carrying the actual
diagnostic information — is discarded, and the defect surfaces later in an
environment where it costs far more to diagnose.

## When a job fails

1. **Keep the first failure.** The Actions run and its artifacts are the
   evidence. Do not re-run before reading them. Every job in this pipeline
   uploads its evidence _on failure_, precisely so a re-run is never needed to
   find out what happened.
2. **Classify before re-running.** One of:

   | Class                   | Signal                                                                                  | Action                 |
   | ----------------------- | --------------------------------------------------------------------------------------- | ---------------------- |
   | Deterministic defect    | Fails the same way on the same input                                                    | Fix now. Do not re-run |
   | Test defect             | The test depends on ordering, wall-clock time, or another test's fixture                | Fix the test now       |
   | Infrastructure incident | Runner died, image pull failed, service container never became healthy, network timeout | Record it, then re-run |
   | Genuine non-determinism | Fails intermittently with no infrastructure cause                                       | Quarantine — see below |

3. **A re-run must be visible.** Re-running a job is recorded by GitHub as an
   attempt. Never work around a failure by pushing an empty commit: that
   destroys the link between the failure and the code that caused it.

## No unlimited retries

At most **one** re-run, and only after classification. A second failure of the
same job is a defect by definition — treat it as one.

## Quarantine

A test may be quarantined only with **all five** of:

| Requirement             | Why                                                       |
| ----------------------- | --------------------------------------------------------- |
| An owner, by name       | Somebody has to come back to it                           |
| A tracking issue        | Otherwise it is forgotten                                 |
| The reason, written out | "Flaky" is not a reason                                   |
| An expiry date          | A quarantine with no expiry is a deletion nobody approved |
| Replacement evidence    | What still covers the behaviour while this test is out    |

Mechanically: a `.skip` requires a `// test-honesty-allow: TH-002 -- <reason>`
comment on an adjacent line, or `check-test-honesty.mjs` fails the build. The
comment is where the five items go.

**A recurring flaky test becomes blocking.** If the same test is quarantined
twice, it is not flaky — the behaviour it exercises is non-deterministic, and
that is a product finding.

## Why this pipeline is structurally less flaky

- Database-bound suites run with `fileParallelism: false`, enforced by TH-007.
  Parallel files against one mutable database race each other's fixtures, and the
  resulting failure looks exactly like a product bug.
- The database and backend tiers run in **separate jobs with separate service
  containers**, so neither can leave state for the other.
- The clean room runs everything in one job against one database, serially, which
  is the ordering a real deployment has.
- The container job detects an **exited** container rather than waiting out the
  full health timeout, so a crash-loop fails in seconds with the container log
  attached instead of after two minutes with nothing.
- The performance gate has a noise floor: below 5 ms the ratio is arithmetic
  about jitter, and a gate that cries wolf gets ignored.

## Observability

Every test tier uploads its vitest JSON report, which carries per-test duration.
`summarise-vitest.mjs` publishes the fifteen slowest tests to the job summary on
every run. A test whose duration is climbing is usually the next flaky one.
