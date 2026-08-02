# Pre-P1-26 — `apps/api` file ownership BEFORE remediation

Frozen at protected `develop` `9e70c61c`, before any file was removed. The
machine-readable twin is [api-file-ownership-before.json](api-file-ownership-before.json).

## What was there

**456 tracked files.** 196 of them Route Handlers; the rest Backend modules, server
runtime, configuration and shared utilities — and twenty files that were Frontend.

| Classification                                                       | Files |
| -------------------------------------------------------------------- | ----- |
| API Route Handler (`src/app/api/**/route.ts`)                        | 196   |
| Backend module (`src/modules/**`)                                    | 181   |
| Backend runtime source (`src/server/**`)                             | 47    |
| Frontend scaffold — stylesheet tier (`src/styles/**`)                | 17    |
| Backend shared utility (`src/lib`, `src/shared`)                     | 4     |
| Backend configuration (`src/config/**`)                              | 1     |
| Frontend scaffold — React (`src/app/page.tsx`, `src/app/layout.tsx`) | 2     |
| Frontend scaffold — CSS Module (`src/app/page.module.scss`)          | 1     |
| public runtime asset (`public/.gitkeep`)                             | 1     |
| workspace configuration                                              | 6     |

## `apps/api/src/app/api/**` is correct and was never in question

The repeated word is not a defect. `apps/api` is the workspace; `src/app/api` is the
Next.js Route Handler namespace that publishes `/api/**`. All 196 handlers were kept
untouched, and the gate written in this remediation explicitly permits them.

## What was Frontend, and how that was established

Twenty files, and they formed a **closed island** — proven by import search across
every tracked file, not by their names:

| File                       | Imported by                                            | Verdict            |
| -------------------------- | ------------------------------------------------------ | ------------------ |
| `src/app/page.tsx`         | nothing (Next discovers it by convention)              | remove             |
| `src/app/page.module.scss` | `src/app/page.tsx` only                                | remove             |
| `src/app/layout.tsx`       | nothing (Next discovers it by convention)              | remove — see below |
| `src/styles/**` (17 files) | `src/app/layout.tsx` only, via `@/styles/globals.scss` | remove             |

Nothing else in the repository referenced them. `page.tsx` said so itself:

> "This is NOT a product screen and contains NO business functionality. It is replaced
> when real frontend work begins (Phase 1-25 onward…)"

P1-25 landed on 2026-08-02. The scaffold's own stated replacement condition was met.

## The root layout was decided by the build, not by reading

`src/app/layout.tsx` was the one genuinely open question: does Next.js require a root
layout for a Route-Handler-only application? That was settled empirically rather than by
guessing — the file was removed and `npm run build:api` re-run:

```text
BUILD_EXIT=0
196 /api/** routes emitted
0 page routes emitted
0 non-/api routes emitted
```

Next.js **16.2.12 does not require it**. The gate's framework allowlist is therefore
empty, and `tests/ci/api-backend-only.test.ts` asserts that emptiness — so a future
version that does require one has to arrive with the build output that proves it.

## What was kept and why

`src/shared/constants/app.ts` stays. It is Backend-consumed: `DESCRIPTIVE_TITLE` and
`VENDOR_NAME` by the OpenAPI document, `APP_NAME`/`APP_VERSION` by the logger and the
health route. Only `PRODUCT_NAME_PLACEHOLDER` lost its consumer with the scaffold, and
it is retained deliberately — it is the constant of record for ADR-011, and a string
constant is not Frontend material. The divergence it exposes is recorded as a finding
rather than resolved here (see [findings.md](findings.md), `PRE-P126-F-004`).

`public/` stays, holding `.gitkeep` only. There were no decorative Next.js logos or
scaffold images to remove — a rare piece of good news for this audit.
