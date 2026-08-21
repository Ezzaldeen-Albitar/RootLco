# P1-25 remediation — web topology AFTER normalization

The machine-readable twin is [web-topology-after.json](web-topology-after.json).
The before-state is frozen in [web-topology-before.md](web-topology-before.md).

## The canonical topology

```text
apps/web/
├── package.json            workspace manifest (no lockfile — the root owns it)
├── next.config.ts          framework config, security headers (CSP excluded by design)
├── tsconfig.json           one alias: @/* -> ./src/*
├── eslint.config.mjs
├── .stylelintrc.json
├── postcss.config.mjs
├── tailwind.config.ts      content: ./src/** only; colours are var(--…) references
├── playwright.config.ts    testDir ./tests/e2e; ROOTLCO_E2E_CHANNEL selects installed Chrome
├── vitest.config.ts        logic (node) + dom (jsdom) projects over ./tests
├── .env.example            the complete local environment contract
├── public/                 static assets (brand assets land here when approved)
├── scripts/                the three web gates (boundary, brand, tokens)
├── src/
│   ├── app/                THE App Router — the only route tree
│   │   ├── layout.tsx      root layout
│   │   ├── page.tsx        locale redirect
│   │   ├── globals.scss    the single stylesheet entry point
│   │   └── [locale]/(dashboard)/…   shell, overview, gallery + route boundaries
│   ├── proxy.ts            per-request nonce CSP (Next 16's name for middleware)
│   ├── components/         ui, shell, navigation, data-table, forms, overlays,
│   │                       feedback, states, gallery, brand, print
│   ├── features/           feature modules (wrap shared components, never fork them)
│   ├── config/             brand.ts (the ONE brand authority), navigation.ts
│   ├── i18n/               config, get-messages, messages/{en,ar}.json
│   ├── lib/                api/ (the ONE network owner), money, format, permissions,
│   │                       security/csp, gallery-access, …
│   ├── styles/             tokens/ (the ONE raw-value layer), themes/, base, print
│   └── types/
└── tests/
    ├── *.test.ts[x]        vitest suites (logic + dom)
    └── e2e/                Playwright suites
```

## What changed, mechanically

| Move                                                                        | Kind                                             |
| --------------------------------------------------------------------------- | ------------------------------------------------ |
| `apps/web/app/**` → `apps/web/src/app/**` (10 files)                        | `git mv`, history preserved                      |
| `apps/web/middleware.ts` → `apps/web/src/proxy.ts`                          | `git mv` + export renamed `middleware` → `proxy` |
| `apps/web/e2e/foundation.spec.ts` → `apps/web/tests/e2e/foundation.spec.ts` | `git mv`                                         |

Path-bearing updates in the same change: `tsconfig.json` (dropped the unused `@app/*`
alias), `tailwind.config.ts` (one content root), the three web gates (scan `src` only,
**and now fail on a zero-file scan**), `security.test.ts` roots, the brand-replacement
guard (now watching `apps/web/src/app/`), `playwright.config.ts` (`testDir`,
`ROOTLCO_E2E_CHANNEL`), `globals.scss` `@use` paths, and the comments in
`next.config.ts` / `csp.ts` that describe where the CSP lives.

## Why `proxy.ts` and not `middleware.ts`

Verified against the installed package, not assumed: Next 16.2.12's constants define
`PROXY_LOCATION_REGEXP = "(?:src/)?proxy"`, its error messages call the convention
"proxy (previously called middleware)", and `setup-dev-bundler` throws outright when
both files exist. The nonce-CSP behavior is unchanged — same header flow, same matcher,
no `'unsafe-inline'`, and the browser suite still asserts a clean console under the
enforced policy.

## What enforces this now

`scripts/ci/check-web-topology.mjs` (`npm run validate:web-topology`) — required tier,
reachable from `verify:policies`, `verify:workspaces`, the `static-quality` hosted job
and the clean room. It requires the canonical directories to match at least one tracked
file (a zero-match expectation FAILS — the anti-vacuity rule PR #161 paid for), forbids
every competing root and stale convention, forbids nested lockfiles and tracked
generated artefacts, and counts exactly one brand authority, one colour-token authority
and no API-source or Supabase import in web runtime source.

Its mutation tests (`tests/ci/web-topology.test.ts`) prove it fails when: a root-level
`app/page.tsx` reappears · a nested lockfile is added · a second brand authority is
introduced · a required path matches zero files · a Playwright report is tracked · a
`middleware.ts` coexists with `proxy.ts` · web source imports API source · web source
imports a Supabase client.

## One defect the old topology was hiding

`globals.scss` lived at `apps/web/app/globals.scss`, **outside** the Stylelint scope
(`src/**/*.scss`) — the entry stylesheet was never linted. The move brought it into
scope, where it promptly failed `at-rule-empty-line-before` and was fixed. A file's
location was silently deciding whether a gate applied to it, which is exactly the class
of defect this normalization exists to end.
