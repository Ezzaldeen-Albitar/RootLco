# P1-25 remediation — findings

Numbered in the remediation's own series to keep them distinct from the phase findings
(`P1-25-F-001` … `F-025` in the execution checkpoint and evidence documents).

## `P1-25-R-001` (Low, fixed) — the entry stylesheet was never linted

`globals.scss` lived at `apps/web/app/globals.scss`, outside the Stylelint scope
`src/**/*.scss`. Every stylesheet under `src/styles/` was linted; the one file that
stitches them together was not, and it carried a live violation
(`at-rule-empty-line-before`) that surfaced the moment the move brought it into scope.
The defect class: **a file's location silently deciding whether a gate applies to it.**
Fixed by the topology itself — all web source now lives under `src/`, and the topology
gate forbids source outside it.

## `P1-25-R-002` (Medium, fixed) — three gates could pass on an empty scan

`check-api-boundary.mjs`, `check-brand-isolation.mjs` and `check-design-tokens.mjs`
walked a hard-coded root list. Had those roots drifted from the real tree (exactly what
a topology move does), each gate would have scanned zero files, found zero violations,
and **passed** — the same vacuous-evidence failure PR #161 recorded in documentation
form. All three now fail explicitly on a zero-file scan, and the topology gate
additionally fails on any required path matching zero tracked files.

## `P1-25-R-003` (Low, fixed) — a dead alias pointing at the wrong convention

`tsconfig.json` carried `"@app/*": ["./app/*"]` with **zero** imports using it. Dead
configuration is not free: the alias advertised the root-level router location as
importable API surface and would have silently broken (or worse, silently kept working
against a stale directory) after the move. Removed; `@/*` is the one alias.

## `P1-25-R-004` (informational) — the launcher exit-code trap, again

During this remediation the full verification was twice believed green because its exit
code was read through a pipe (`npm run … | tail`), making the observed status `tail`'s.
The same trap was recorded in the P1-25 execution checkpoint against CI polling loops.
The rule stands: **read the exit code of the command, never of the pipeline around it.**
Both misreads were caught by re-running with the code captured directly; the failures
they hid (a TS narrowing error and two unformatted documents) were fixed at cause.

## Dispositions

| ID            | Severity | State                                             |
| ------------- | -------- | ------------------------------------------------- |
| `P1-25-R-001` | Low      | Fixed — structural (the topology move itself)     |
| `P1-25-R-002` | Medium   | Fixed — zero-file scans now fail, mutation-tested |
| `P1-25-R-003` | Low      | Fixed — alias removed                             |
| `P1-25-R-004` | —        | Process note, recorded for the next session       |

No Critical or High finding. No open finding.
