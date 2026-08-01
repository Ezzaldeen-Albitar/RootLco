# SEC-CODEQL-033 — `js/http-to-file-access` in `check-commit-checks.mjs`

| Field             | Value                                                                 |
| ----------------- | --------------------------------------------------------------------- |
| Finding           | **SEC-CODEQL-033**                                                    |
| GitHub alert      | **#33**                                                               |
| Rule              | `js/http-to-file-access` — "Network data written to file"             |
| Severity          | **Medium** (`security-severity` medium; CodeQL `warning`)             |
| CWE               | **CWE-434** (unrestricted upload), **CWE-912** (hidden functionality) |
| Original location | `scripts/ci/check-commit-checks.mjs:252`, columns 35–50               |
| Area              | CI tooling — not application source, never shipped to a runtime       |
| Created           | 2026-07-29 · first seen in `refs/heads/main`                          |
| Prior disposition | **Accepted dismissal**, reviewed 2026-07-29, expiring 2027-01-31      |
| Final disposition | **FIXED** — the data-flow edge no longer exists                       |

---

## 1. What the alert actually said

The flagged expression at column 35–50 is the **data** argument, not the path:

```js
if (mdOut) writeFileSync(mdOut, `${markdown}\n`);
//                              ^^^^^^^^^^^^^^^^
```

`Write to file system depends on Untrusted data.` This is **not** path injection. The
path came from the operator's own `--markdown` flag. What CodeQL objected to is that the
program fetched a remote body and then **persisted bytes derived from it** — the
CWE-434/912 shape.

**Source → sink, in full:**

```
fetch('https://api.github.com/repos/{repo}/commits/{sha}/check-runs')   ← remote source
  → await response.json()
  → payload.check_runs
  → evaluate(checkRuns)      — name, status, conclusion, app.slug, output.title, html_url
  → safeText(...) on each field
  → toMarkdown(result, sha)  — assembles the Markdown report
  → markdown
  → writeFileSync(mdOut, `${markdown}\n`)                                ← filesystem sink
```

The `--json` write on the line above is the same shape; CodeQL raised one alert for the
pair.

## 2. Why the previous disposition was a dismissal, and why that was not enough

The 2026-07-29 review argued two true things: the source is an authenticated TLS response
from this repository, and the sink path is operator-supplied and never derived from the
response. Both hold. Neither removes the edge.

A dismissal records a judgement about **impact**. It leaves the **shape** in the tree, and
the shape is what the next reader — and the next query version — sees. It was also due to
expire on 2027-01-31, at which point the gate would have failed unless somebody re-argued
it. Re-arguing a flow every two quarters is more expensive than not having the flow.

**This remediation removes the flow instead of renewing the argument.**

## 3. Security invariant

> **`check-commit-checks.mjs` never writes to the filesystem.** It renders a report from a
> remote response to **stdout**. If the operator wants that report on disk, their shell
> redirects it.

Redirection is the operating system writing bytes the operator explicitly asked for. It is
categorically different from the program taking bytes the network chose and persisting them
on the operator's behalf. The capability is unchanged:

```bash
node scripts/ci/check-commit-checks.mjs --repo o/n --sha <sha> > checks.md
node scripts/ci/check-commit-checks.mjs --repo o/n --sha <sha> --format json > checks.json
```

This is remediation option **1 and 2** of the preferred order — eliminate the file access,
keep the remote content in memory — not a suppression, not an annotation, and not a
narrowing of what the tool can do.

## 4. Root cause

The script was written to emit build-artifact evidence a human attaches to a gate record,
and "emit an artifact" was implemented as "open a file". Nothing required the program
itself to own that write; **no workflow invokes this script at all** — it is a manual
pre-merge instrument, verified by grep across `.github/workflows/`. The file write was
incidental to the purpose and carried the entire finding.

## 5. Remediation

| Change                                                                                | File                                        |
| ------------------------------------------------------------------------------------- | ------------------------------------------- |
| Removed `writeFileSync` and the `node:fs` import entirely                             | `scripts/ci/check-commit-checks.mjs`        |
| `--json <path>` / `--markdown <path>` replaced by `--format markdown\|json` to stdout | same                                        |
| Retired flags now **fail loudly** (exit 2) rather than being ignored                  | same                                        |
| Argument validation moved **before** the token read and the network request           | same                                        |
| `safeText` extended to strip bidi, invisible and line-separator code points           | same                                        |
| Dismissal entry removed — it would now match nothing, and the gate fails on that      | `.github/ci-baselines/codeql-baseline.json` |

`writeFileSync` occurrences in the file after the change: **0**. `node:fs` import: **absent**.

### 5.1 A second, unrelated defect found while proving the first

`safeText` stripped C0/C1 control characters but nothing else. Measured before the fix,
every one of these survived it and reached the report:

| Input                      | Survived as | Why it matters                                                                                                                  |
| -------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `U+202E` RLO               | yes         | **Trojan Source, CVE-2021-42574** — the name renders REVERSED, so the artifact shows something other than what the API returned |
| `U+2066`–`U+2069`          | yes         | directional isolates, same class                                                                                                |
| `U+200E` / `U+200F`        | yes         | directional marks                                                                                                               |
| `U+200B`/`U+200D`/`U+FEFF` | yes         | zero-width — two different check names render identically                                                                       |
| `U+2028` / `U+2029`        | yes         | line and paragraph separators — one table cell becomes two rows                                                                 |

That directly contradicted the function's own stated purpose: _"a report should be a report
whatever the API returns."_ All of them are now replaced with a space — **visibly**, so the
text does not silently close up into a different, legitimate-looking name. `U+0085` NEL was
already covered by the C1 range.

This was found by probing the function, not by reading it.

## 6. Regression coverage

Behavioural, in `tests/ci/codeql-policy.test.ts`. **None inspects source text** — a test
that greps for `writeFileSync` passes against a rename and fails against a refactor.

**`SEC-CODEQL-033 — the program must not persist network-derived bytes` (7 tests).** Each
runs the real CLI as a subprocess in a fresh empty temp directory and asserts on the exit
code, stderr and **what the directory contains afterwards**:

- `--json out.json` → exit 2, stderr names the retirement, **directory still empty**
- `--markdown out.md` → exit 2, **directory still empty**
- a rejected invocation emits **no report on stdout** either
- `--format xml` → exit 2, nothing created
- argument errors surface **without** a token, proving validation precedes the network
- no token → exit 2 · no `--repo`/`--sha` → exit 2, nothing created

**`SEC-CODEQL-033 — safeText neutralises what the C0/C1 rule does not` (6 tests).** RLO,
isolates and marks, zero-width, `U+2028`/`U+2029`, the same characters carried through
`evaluate()` and the rendered report, and a guard that the backslash-before-pipe ordering
(a previous `js/incomplete-sanitization` finding) has not regressed.

Suite: **63 tests, 63 passed** — 50 pre-existing, 13 added.

## 7. Mutation evidence

Run against a **green** baseline; restored green afterwards. A mutant is CAUGHT only on an
assertion failure — a crashed runner or an unmatched anchor scores STILLBORN, because it
measured nothing.

| Mutant     | Removal                                                                   | Expected          | Actual             | Verdict    |
| ---------- | ------------------------------------------------------------------------- | ----------------- | ------------------ | ---------- |
| **M-33-1** | drop the bidi / invisible / line-separator strip                          | assertion failure | exit 1, assertions | **CAUGHT** |
| **M-33-2** | drop the C0/C1 control strip                                              | assertion failure | exit 1, assertions | **CAUGHT** |
| **M-33-3** | escape pipe **before** backslash — the old incomplete-sanitization defect | assertion failure | exit 1, assertions | **CAUGHT** |
| **M-33-4** | accept the retired `--json` flag silently                                 | assertion failure | exit 1, assertions | **CAUGHT** |
| **M-33-5** | accept any `--format` value instead of the two-value allowlist            | assertion failure | exit 1, assertions | **CAUGHT** |

**5/5 CAUGHT · 0 survived · 0 stillborn.**

M-33-2 and M-33-3 are deliberately included: they prove the **pre-existing** protections
are still load-bearing after the refactor, not merely that the new line is.

## 8. Non-impact

| Area                | Impact                                                                    |
| ------------------- | ------------------------------------------------------------------------- |
| Database            | **none** — 119 migrations, no `120`, `supabase/` diff 0 files             |
| Schema hash         | **unchanged** — `a677eb05…`                                               |
| Application source  | **none** — no file under `src/` is touched                                |
| Operation coverage  | **unchanged** — 226/226, OpenAPI 195 paths / 226 operations               |
| P1-24 documentation | **unchanged**                                                             |
| P1-25               | **none** — this is a pre-P1-25 CI-tooling remediation and starts no phase |
| CI workflows        | **none invoke this script**; no workflow file changed                     |

## 9. Disposition

**FIXED.** The dismissal is withdrawn because the finding it adjudicated no longer exists,
not because the argument was abandoned. The reasoning that produced it is preserved in
[`accepted-dismissals.md`](./accepted-dismissals.md), which now records the outcome rather
than an open acceptance.
