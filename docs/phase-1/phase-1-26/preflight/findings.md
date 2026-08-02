# Pre-P1-26 — findings

Numbered in their own series so they stay distinct from P1-25's findings and from the
P1-26 phase findings that will follow.

## `PRE-P126-F-001` (Medium, fixed) — the API workspace shipped a Frontend

`apps/api` carried a rendered page, a CSS Module and a seventeen-file Sass architecture
from the Phase 1-1 scaffold. Nothing imported any of it outside itself, and `page.tsx`
documented its own replacement condition — "replaced when real frontend work begins
(Phase 1-25 onward)" — which P1-25 met on 2026-08-02.

Left alone it would have been actively harmful, not merely untidy: P1-26 is the first
phase to build authentication and administration screens, and a workspace that already
contains a page, a layout and a stylesheet tier is a workspace where a P1-26 screen can
be added to the wrong side of the boundary and still compile, still lint, and still pass
CI. Removed, and made permanent by `scripts/ci/check-api-backend-only.mjs`.

## `PRE-P126-F-002` (High, fixed) — the gate's import rules matched nothing

Caught by the mutation tests before the gate shipped. The gate strips comments and string
literals before scanning, so a browser word in prose cannot be a false accusation — but
**an import specifier is a string literal**, so stripping strings deleted exactly the
text the import rules were looking for. All five of them (`use client`, web-workspace
import, stylesheet import, React-DOM import, UI-framework import) silently matched
nothing while the gate reported success.

This is the defect class this repository keeps paying for: a check that exists, runs, and
measures nothing. Fixed by giving each rule an explicit `scope` — `imports` (comments
stripped, strings kept) or `code` (both stripped) — with a test asserting every rule
declares a valid one, and an evaluator that throws rather than silently skipping a rule
whose scope is unrecognised.

## `PRE-P126-F-003` (Medium, fixed by design) — a text search cannot see scope

The first draft of the browser-global rule flagged four lines, **every one of them
correct Backend code**: `input.window.from` (a job-assignment time window),
`document.record_version` (an attachment record), and two `typeof window !== 'undefined'`
server-only guards.

A gate that cries wolf is a gate somebody switches off, so the ambiguous half was moved
to where scope analysis exists: `no-restricted-globals` in `apps/api/eslint.config.mjs`.
It was proven to fire — a probe reading the real `navigator` and `localStorage` globals
was reported; a local named `document` was not. The gate keeps only `localStorage` and
`sessionStorage` as text rules (0 occurrences in the workspace, no domain meaning) and
asserts the ESLint restriction is still declared, so removing it cannot be silent.

`window` is deliberately unrestricted. Its one legitimate Backend use is the server-only
guard that refuses to run in a browser; restricting it would force a disable comment onto
the very pattern that enforces the boundary.

## `PRE-P126-F-004` (Low, recorded not fixed) — two product-name placeholders exist

`apps/api/src/shared/constants/app.ts` defines
`PRODUCT_NAME_PLACEHOLDER = '[PRODUCT NAME — Pending Final Approval]'`, while
`apps/web/src/config/brand.ts` defines `systemName: '[SYSTEM NAME]'`. Two placeholders
for one undecided name.

Deliberately **not** resolved here. Choosing the single central placeholder is a branding
decision that changes the web brand authority, and this is an API file-boundary
remediation; making that edit here would be exactly the cross-boundary change the phase
ownership gate exists to prevent. Recorded for P1-26, which owns the Frontend brand
surface, and it is a governance-visible discrepancy rather than a defect: both strings
correctly refuse to name the product.

## `PRE-P126-F-005` (Low, fixed) — a stylesheet gate with no stylesheets

Removing the API's Sass left `stylelint "src/**/*.scss"` matching zero files, which
stylelint correctly treats as an error. The fix was not to make it pass on nothing: an
API workspace has no stylesheets, so it runs no stylesheet linter. Its style scripts were
removed and the root command names repointed at `apps/web`.

Root `style:check` and `style:check:web` now resolve to the same run, so `style:check`
was reclassified from `required` to `informational` in the command register — carrying
the same coverage twice and calling both required would overstate what is enforced. The
command-coverage gate caught this within one run of the change.

## Dispositions

| ID               | Severity | State                                                     |
| ---------------- | -------- | --------------------------------------------------------- |
| `PRE-P126-F-001` | Medium   | Fixed — 20 files removed, gate + 32 tests added           |
| `PRE-P126-F-002` | High     | Fixed — rule scopes, caught by mutation tests pre-merge   |
| `PRE-P126-F-003` | Medium   | Fixed by design — ESLint owns scope, gate asserts it      |
| `PRE-P126-F-004` | Low      | **Open — carried to P1-26**, which owns the brand surface |
| `PRE-P126-F-005` | Low      | Fixed — stylesheet ownership moved to `apps/web`          |

No Critical finding. No unresolved High or Medium finding.
