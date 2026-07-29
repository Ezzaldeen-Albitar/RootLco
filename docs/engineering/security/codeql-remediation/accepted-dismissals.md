# Accepted dismissals

**One.** Every other alert in the 21-alert baseline was fixed.

## Why there is one at all

It is in a script this initiative wrote, which is uncomfortable and is exactly
why it carries a reproduction rather than an assertion. Dismissing a pre-existing
finding to avoid work and dismissing a genuine false positive in new code are
different acts; this document exists so a reader can tell which this is.

## `js/http-to-file-access` — `scripts/ci/check-commit-checks.mjs`

| Field    | Value                                |
| -------- | ------------------------------------ |
| Rule     | `js/http-to-file-access`             |
| Severity | medium                               |
| Path     | `scripts/ci/check-commit-checks.mjs` |
| Reviewer | platform-owner                       |
| Reviewed | 2026-07-29                           |
| Expires  | **2027-01-31**                       |

**Source.** The JSON body of an authenticated
`GET /repos/{owner}/{repo}/commits/{sha}/check-runs` response, over TLS. Not
attacker-controlled in any reachable sense: the request is made by a maintainer,
with that maintainer's own token, against this repository. Only `name`, `status`,
`conclusion`, `app.slug`, `output.title` and `html_url` are read. A party able to
forge that response already controls the repository the gate protects.

**Sink.** `writeFileSync` to a path the **operator** names via `--json`, in an
ephemeral working directory. The path is never derived from the response. Nothing
consumes the file automatically — it is evidence a human attaches to a gate
record.

**Reproduction.** CodeQL tracks HTTP-response data reaching a filesystem write and
does not model `safeText` as a sanitiser, so the flow persists however thoroughly
the content is cleaned. The content _is_ cleaned: every field passes through
`safeText`, which strips C0/C1 control characters, escapes backslashes and **then**
pipes, and caps length. Measured — the hostile input `evil\|name` yields exactly
one Markdown table cell, so it cannot break out of the cell it is rendered into.

**What remains** is the flow itself, which is the script's entire purpose: a
report about an API response necessarily contains data from that API response.

**Dismissed as a false positive in impact, not in existence.**

## What a dismissal cannot do here

- It cannot cover anything under `src/`. The gate fails outright.
- It cannot cover a rule generally — only a rule at an exact path. The same rule
  at another path is a new finding, not a covered one.
- It cannot outlive its expiry.
- It cannot omit `source`, `sink`, `reason`, `reviewer` or `reviewedOn`.
- It cannot survive the finding being fixed: a dismissal matching nothing fails
  the gate, so this entry must be removed when the flow is. That check is scoped
  to the files the analysis actually read — the `actions` matrix leg never opens
  a `.mjs` file and so reports this entry as _not judged here_ rather than stale.
  The `javascript-typescript` leg, which reads 717 files including this one, is
  the leg that owns it.
- It does not raise the ceiling. A dismissed finding is adjudicated rather than
  open, and `maximumOpenFindings` stays at **0**.

## Expiry

Two quarters. Long enough not to be busywork, short enough that it cannot become
permanent without somebody looking at `safeText` and this justification again.
