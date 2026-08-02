# Pre-P1-26 — `apps/api` file ownership AFTER remediation

Machine-readable twin: [api-file-ownership-after.json](api-file-ownership-after.json).
Before-state: [api-file-ownership-before.md](api-file-ownership-before.md).

## The canonical API workspace

```text
apps/api/
├── package.json          workspace manifest — no lockfile, no stylesheet scripts
├── next.config.ts
├── tsconfig.json
├── eslint.config.mjs     composes the root policy + no-restricted-globals
├── .prettierignore
├── .env.example          the local environment contract, no credential-shaped values
├── public/               .gitkeep only
└── src/
    ├── app/api/**/route.ts    196 Route Handlers — the ENTIRE app tree
    ├── config/               backend configuration
    ├── lib/                  backend shared utilities
    ├── modules/              backend domain modules
    ├── server/               backend runtime (http, auth, db, openapi, observability)
    └── shared/               backend shared constants and types
```

## Measured result

| Property                                                                                     | Value                      |
| -------------------------------------------------------------------------------------------- | -------------------------- |
| Tracked files                                                                                | 456 → **436** (20 removed) |
| Route Handlers                                                                               | **196 — unchanged**        |
| Non-route files in the app tree                                                              | **0**                      |
| Stylesheets (`.css/.scss/.sass/.less`)                                                       | **0**                      |
| Frontend tiers (`components`/`features`/`hooks`/`providers`/`store`/`theme`/`styles`/`i18n`) | **0**                      |
| `use client` directives                                                                      | **0**                      |
| Web-workspace imports                                                                        | **0**                      |
| Tracked generated output                                                                     | **0**                      |
| Nested lockfiles                                                                             | **0**                      |

## What enforces it

`scripts/ci/check-api-backend-only.mjs` — required tier, reached from `verify:policies`
(and therefore `verify:workspaces`), plus the hosted `static-quality` job and the clean
room. It rejects a page, template, loading, error, not-found or layout file; any
stylesheet or CSS Module; the Frontend directory tiers; UI route groups; a nested
lockfile; tracked build output; `use client`; web-workspace imports; React client hooks;
React-DOM and Next client-module imports; UI-framework imports; and browser storage.

Every expectation is **counted**, and a scan that matches zero files fails rather than
passing quietly.

### The split with ESLint, and why it exists

Browser-global detection is deliberately **not** a text search in the gate. The first
draft matched `window`/`document` by regex and flagged four lines of correct Backend
code: `input.window.from` is a job-assignment time window, and `const document = …` is
an attachment record. Deciding whether an identifier is the DOM or a local needs scope,
and only a parser has that.

So `no-restricted-globals` in `apps/api/eslint.config.mjs` owns `document`, `navigator`,
`localStorage` and `sessionStorage` — proven to fire (a probe using the real globals was
reported; a local named `document` was not). The gate asserts that restriction is still
declared, so deleting it cannot be silent.

`window` is deliberately unrestricted: its one legitimate Backend use is the server-only
guard `typeof window !== 'undefined'`, which `config/env.ts` and
`server/config/backend-config.ts` use to refuse to run in a browser. Restricting it
would put a disable comment on the very pattern that enforces the boundary.

## Stylesheet ownership moved rather than being deleted

`apps/api` ran `stylelint "src/**/*.scss"`. With no stylesheets left that command matches
nothing, and a stylesheet linter scanning zero files is not a pass — so the API's style
scripts were removed outright, and `style:check` / `style:lint` / `style:fix` at the root
now resolve to `apps/web`, the one workspace that holds stylesheets. The command names
ADR-013 and CONTRIBUTING name as the gating form keep working.

`static-quality` no longer runs the stylesheet gate: `web-quality` owns it, runs
unconditionally in both the PR and protected workflows, and additionally proves the
Stylelint rules actually fire. Running it in both jobs would lint the same files twice
and imply a coverage `static-quality` does not have.

## Regression coverage

`tests/ci/api-backend-only.test.ts` — 32 tests. One healthy-tree test with anti-vacuity
assertions on the counts; one mutation per violation class; and four false-positive tests
pinning the cases the first draft got wrong (a domain variable named `document`, a domain
property named `window`, browser words inside comments and strings, and the server-only
`typeof window` guard).

Two of those tests exist because the mutation suite caught a real defect before it
shipped: the gate originally scanned import rules against string-stripped source, and an
import specifier **is** a string literal — so all five import rules silently matched
nothing while the gate reported success. Rules now declare the view they are scanned in,
and a rule with a missing or misspelt scope throws rather than being quietly inert.
