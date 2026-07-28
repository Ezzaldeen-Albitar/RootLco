# Coverage policy

## The problem this solves

`vitest.config.ts` configured a v8 coverage provider with an explicit 13-entry
include list and **no thresholds**, and **no workflow ever invoked it**
(CSA-07). Coverage could have fallen to zero without a single check going red.

## Two tiers, measured separately

| Tier    | Scope                                                             | Harness                                                         | Baseline file                    |
| ------- | ----------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------- |
| unit    | the `include` list in `vitest.config.ts` — pure logic with no I/O | `npm run test -- --coverage`                                    | `coverage-baseline.unit.json`    |
| backend | `src/modules/**`, `src/server/**`                                 | `npm run test:backend -- --coverage`, against a live PostgreSQL | `coverage-baseline.backend.json` |

They are **not merged**. A single combined number would overstate both: the two
tiers exercise disjoint code through completely different harnesses, and adding
them together produces a figure that describes neither.

## Three rules, in order of strictness

**1. Global ratchet.** No metric may fall more than
`tolerancePercentagePoints` below the recorded baseline. The tolerance exists
because v8 line attribution shifts by fractions of a point across Node patch
releases — it is not a licence to lose coverage. Unit tier: 0.5 pp. Backend
tier: 1 pp (a database-bound tier is noisier).

**2. Critical-module floors.** Named modules hold an absolute minimum whatever
the global number does. An average hides a module going dark.

A floor whose path prefix matches **no file** is a hard failure, not a pass. A
floor over an empty set passes whatever happens to that module, which is worse
than no floor because it looks like protection. This is why the backend tier's
floors are listed as `plannedCriticalModules` and not yet enforced — they cannot
be added blind.

**3. Touched-file floor.** A production file changed by the pull request must
reach 60 % line coverage. A large global number cannot buy a new untested file.
`src/app/` and `src/styles/` are exempt: route handlers are covered through the
backend tier and stylesheets are not executable.

## Current unit-tier baseline

| Metric     | Value   |
| ---------- | ------- |
| Lines      | 91.06 % |
| Statements | 91.06 % |
| Functions  | 84.87 % |
| Branches   | 93.62 % |

Measured locally at the audit; corrected from the first GitHub-hosted run.

### Enforced floors

| Module                     | Floor | Why                                                                                  |
| -------------------------- | ----- | ------------------------------------------------------------------------------------ |
| `src/server/errors`        | 95 %  | decides which text reaches a caller; a leak here discloses SQL, paths or tenant data |
| `src/server/db`            | 90 %  | optimistic concurrency and pagination bugs corrupt data or truncate results silently |
| `src/server/cache`         | 92 %  | a cache that ignores tenant scope is a cross-tenant disclosure                       |
| `src/server/http`          | 88 %  | validation, rate limiting and trusted-proxy handling are the outermost guard         |
| `src/server/observability` | 86 %  | correlation identifiers are how an incident is reconstructed                         |
| `src/server/worker`        | 95 %  | outbox retry decides whether an event is delivered once, never, or forever           |
| `src/lib/logging`          | 72 %  | the last thing between a credential and a public Actions log                         |
| `src/config`               | 50 %  | a bad environment value must fail at start, not at first request                     |

Each floor sits a few points below its measured value — enough headroom for
cross-platform attribution drift, tight enough that a real regression trips it.

## Known gap

`src/shared/errors/app-error.ts` — 35 lines, **0 % covered**, and **zero
references anywhere in the repository**. It is dead code superseded by
`src/server/errors/**`.

It is deliberately **left in** the coverage include set. Excluding it would raise
the global number by 2.35 pp by hiding code rather than by testing it, and a
baseline that improves because something stopped being counted is a lie about
the codebase. Removal is tracked separately; when it lands, the baseline rises
and the commit must say why.

## The ratcheting procedure

Raising a baseline is a reviewable diff. So is lowering one — that is the point.

1. Make the change that improves coverage.
2. Run the tier's coverage locally, or read the number from the hosted run.
3. Update `global` in the baseline file **in the same commit**.
4. If a critical module rose meaningfully, raise its floor too. A floor that
   never moves stops being a ratchet.

To _lower_ a baseline, write the reason in the commit message. There is no
mechanism that stops you; there is a diff that makes it visible.

## Coverage artifacts

Uploaded even on failure: `coverage-summary.json`, `coverage-final.json`, the
HTML report, and `coverage-gate.json` with the per-metric comparison. No source
secret is uploaded — the reports contain file paths and hit counts only.
