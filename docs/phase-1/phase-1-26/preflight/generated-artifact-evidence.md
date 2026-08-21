# Pre-P1-26 — generated-artefact evidence

Measured on the remediation branch against the real tracked-file list.

## Result

| Property                                                 | Value                         |
| -------------------------------------------------------- | ----------------------------- |
| Tracked files inspected                                  | 1671                          |
| Tracked `node_modules`                                   | **0**                         |
| Tracked `.next`                                          | **0**                         |
| Tracked `*.tsbuildinfo`                                  | **0**                         |
| Tracked `coverage/`                                      | **0**                         |
| Tracked `test-results/`                                  | **0**                         |
| Tracked `playwright-report/` or `playwright-report.json` | **0**                         |
| Tracked `vitest-*.json`                                  | **0**                         |
| Lockfiles                                                | **1**, at the repository root |
| Nested lockfiles                                         | **0**                         |
| Required `.gitignore` rules present                      | **7 / 7**                     |

`npm run validate:generated-artifacts` exits 0.

## Why the ignore rules are checked, not just the tracked files

A path that is untracked today only because nobody happened to run the tool is one
`git add -A` away from being tracked tomorrow. That is not hypothetical — it is
`P1-25-F-025`: `.gitignore` carried the directory `playwright-report/`, a local browser
run produced `playwright-report.json`, a `git add -A` swept it in, and the hosted clean
room then failed because it regenerated the file and found the tree dirty.

So the gate treats directory rules and file rules as different things and **refuses to
accept a directory rule as covering a file of the same stem**. `tests/ci/generated-artifacts.test.ts`
pins that behaviour directly: it removes only the `.json` line, asserts the
`playwright-report/` directory line is still present, and requires the gate to fail
anyway. A gate that accepted the directory form there would have reported the repository
clean on the exact day the defect landed.

## Directory spelling

`node_modules/` and `.next/` are accepted in their trailing-slash form, which is the
idiomatic and strictly-better spelling for something that is always a directory. The
first draft of the gate demanded the bare form and failed against a perfectly correct
`.gitignore` — corrected by reading the real file rather than by assuming its contents.

## Environment files

| Path                                                       | Tracked | Kind                                                                                                                                                                               |
| ---------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.env.example`                                             | yes     | template, no real values                                                                                                                                                           |
| `apps/api/.env.example`                                    | yes     | template; the `DATABASE_URL` line is described in words rather than shaped like a credential, because the tracked-secrets gate rejects credential-shaped URLs even as placeholders |
| `apps/web/.env.example`                                    | yes     | template                                                                                                                                                                           |
| `.env.local`, `apps/api/.env.local`, `apps/web/.env.local` | **no**  | local only, ignored                                                                                                                                                                |

No secret value appears in this document or in any tracked file;
`npm run security:tracked-secrets` reports 0 credential-shaped values across 1671 files.
