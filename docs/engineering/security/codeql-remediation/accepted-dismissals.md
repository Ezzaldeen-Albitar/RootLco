# Accepted dismissals

**None.** The list is empty, and the way it became empty matters more than the fact.

Every alert in the 21-alert baseline was fixed. Exactly one was ever dismissed rather than
fixed — the entry below — and on 2026-08-01 it was **withdrawn because the finding was
fixed**, four months before its expiry, rather than renewed.

## Withdrawn — `js/http-to-file-access` — `scripts/ci/check-commit-checks.mjs`

| Field         | Value                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------- |
| Rule          | `js/http-to-file-access`                                                                        |
| Severity      | medium                                                                                          |
| Path          | `scripts/ci/check-commit-checks.mjs`                                                            |
| Reviewer      | platform-owner                                                                                  |
| Reviewed      | 2026-07-29                                                                                      |
| Expiry (was)  | 2027-01-31                                                                                      |
| **Withdrawn** | **2026-08-01 — finding FIXED, see [`SEC-CODEQL-033`](./sec-codeql-033-http-to-file-access.md)** |

### What the dismissal argued

**Source.** The JSON body of an authenticated
`GET /repos/{owner}/{repo}/commits/{sha}/check-runs` response, over TLS. Not
attacker-controlled in any reachable sense: the request is made by a maintainer, with that
maintainer's own token, against this repository. Only `name`, `status`, `conclusion`,
`app.slug`, `output.title` and `html_url` are read. A party able to forge that response
already controls the repository the gate protects.

**Sink.** `writeFileSync` to a path the **operator** names via `--json`, in an ephemeral
working directory. The path is never derived from the response. Nothing consumes the file
automatically — it is evidence a human attaches to a gate record.

**Both of those statements were true, and they remain true.** They are why the dismissal
was defensible. They are not why it was removed.

### Why it was withdrawn anyway

A dismissal records a judgement about **impact**. It leaves the **shape** in the tree: a
program that fetches a remote body and persists bytes derived from it. That shape is what
the next reader sees, what the next version of the query sees, and what somebody would have
had to re-argue on 2027-01-31.

The remediation removed the shape. `check-commit-checks.mjs` no longer opens a file at all
— it renders to stdout and the operator redirects. The capability is unchanged; the
network-to-filesystem edge is gone, so there is nothing left to adjudicate.

Withdrawing a dismissal because the flow was eliminated is the outcome this register exists
to make possible. An entry that survives its own finding is the failure mode.

### What the reproduction turned up on the way

Proving the old justification also probed `safeText`, and it was **not** as complete as the
dismissal implied. It stripped C0/C1 control characters but let `U+202E` RIGHT-TO-LEFT
OVERRIDE through — Trojan Source, CVE-2021-42574 — along with directional isolates,
zero-width characters and `U+2028`/`U+2029`. A report carrying an RLO renders reversed, so
the artifact showed something other than what the API returned: precisely the property the
function claimed. That is fixed in the same change and carries its own tests and mutants.

The dismissal's own words were _"a report should be a report whatever the API returns."_
It was right about the principle and wrong about having achieved it.

## What a dismissal cannot do here

- It cannot cover anything under `src/`. The gate fails outright.
- It cannot cover a rule generally — only a rule at an exact path. The same rule at another
  path is a new finding, not a covered one.
- It cannot outlive its expiry.
- It cannot omit `source`, `sink`, `reason`, `reviewer` or `reviewedOn`.
- It cannot survive the finding being fixed: a dismissal matching nothing fails the gate, so
  the entry had to be removed in the **same change** that removed the flow. That check is
  scoped to the files the analysis actually read — the `actions` matrix leg never opens a
  `.mjs` file and so reports such an entry as _not judged here_ rather than stale. The
  `javascript-typescript` leg is the one that owns it.
- It does not raise the ceiling. `maximumOpenFindings` stays at **0**.
