# P1-25 remediation — test evidence

Every tier, run at the remediation head in the owner checkout, exit codes read from the
commands themselves (never from a pipeline — `P1-25-R-004`).

| Tier                                                                                       | Result                                                                     |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `verify:workspaces` (policies → repository → api → web → contracts → inventories → format) | **exit 0**                                                                 |
| Root unit / CI-contract suites                                                             | **1340 / 1340** (includes the 10 new topology-gate mutation tests)         |
| Web unit / component (vitest, logic + dom)                                                 | **235 / 235** (includes the 4 new readiness-classification tests)          |
| Web security suite                                                                         | **17 / 17** (includes the new dev-only-eval scope proof)                   |
| Web browser matrix — chromium (inside `verify:web`)                                        | **81 / 81**                                                                |
| Web browser matrix — **installed Chrome channel**                                          | **81 / 81** (4 project-scoping skips by design)                            |
| Backend tier (`test:backend`)                                                              | **1752 / 1752**                                                            |
| Database / RLS tier (`test:db`)                                                            | **1636 / 1636**                                                            |
| Command coverage                                                                           | **62 / 62** required commands reachable, both dimensions                   |
| Web topology gate                                                                          | 18 expectations, 75+ matched files, **0 failures**                         |
| API boundary / brand isolation / design tokens                                             | 39 · 61 · 61 files inspected, **0 violations**, zero-file scans now fail   |
| Migrations                                                                                 | **119**, none changed, no Migration 120, schema hash `a677eb05…` unchanged |
| Dependency audit                                                                           | 0 vulnerabilities, 0 waivers (root lockfile, both workspaces)              |

**Failed executable tests: 0. Suppressed failures: 0.** The only "skipped" entries are
the four project-scoping exclusions of the reduced-motion-only browser test, which runs
— and passes — in its own project.

Failures encountered on the way and fixed at cause rather than excluded: the
documented-counts contract (the record now states **30** scripts in `scripts/ci` with
provenance), a TS narrowing error on the gate's JSDoc signature, the gallery dom test's
path to the moved route file, one Stylelint violation in the newly-in-scope
`globals.scss`, and the two runtime findings recorded in
[local-runtime-evidence.md](local-runtime-evidence.md).
