# Pre-P1-23 batch 2 — application dependency review

Covers the one **production** dependency in the batch (`pino`) and the
supply-chain position after it.

## Pino 9 → 10 (#124) — accepted

`pino` is the only runtime dependency in this batch. Its surface here is small
and was measured rather than assumed: **exactly one file imports it**,
`src/server/observability/logger.ts`.

Upstream documents a single breaking change — _"The only breaking change is
dropping support for Node 18."_ The repository requires Node `>=22.0.0`, so it
does not apply. Redaction internals moved to `@pinojs/redact`, which is why the
redaction and observability paths were exercised explicitly instead of trusted.

### Results, on a clean worktree from current `develop`

| Check                                                        | Result                                         |
| ------------------------------------------------------------ | ---------------------------------------------- |
| `npm ci`                                                     | exit 0, lock reproducible, resolved **10.3.1** |
| `npm run typecheck`                                          | pass                                           |
| `npm run lint`                                               | pass                                           |
| `npm run build`                                              | pass                                           |
| `npm run test` (unit)                                        | pass                                           |
| `tests/foundation` (logging, redaction, error serialisation) | **899 passed / 37 files**                      |
| Coverage ratchet                                             | **pass**                                       |

### Coverage — no regression in any floor

| Metric     | Measured | Baseline | Δ        |
| ---------- | -------- | -------- | -------- |
| lines      | 93.38%   | 93.26%   | +0.12 pp |
| statements | 93.38%   | 93.26%   | +0.12 pp |
| functions  | 84.87%   | 84.75%   | +0.12 pp |
| branches   | 93.73%   | 93.61%   | +0.12 pp |

| Critical module                          | Measured   | Floor |      |
| ---------------------------------------- | ---------- | ----- | ---- |
| `error-mapping`                          | 100%       | 95%   | pass |
| `http-validation-and-limits`             | 94.21%     | 88%   | pass |
| `db-concurrency-and-pagination`          | 95.38%     | 90%   | pass |
| `cache`                                  | 97.15%     | 92%   | pass |
| **`observability`** (where `pino` lives) | **91.79%** | 86%   | pass |
| `worker-backoff`                         | 100%       | 95%   | pass |
| **`log-redaction`**                      | **77.78%** | 72%   | pass |
| `environment-validation`                 | 56.94%     | 50%   | pass |

The two floors that matter for a logging upgrade — `observability`, which
contains `logger.ts` itself, and `log-redaction`, the last thing between a
credential and a public Actions log — are **unchanged from the develop
baseline**. No threshold was lowered.

No secret, credential or financial value appears in any log assertion; the
redaction suite is the gate for that and it passes unchanged.

## Supply-chain position

Measured on the accepted tree:

| Item                   | Result                                                                       |
| ---------------------- | ---------------------------------------------------------------------------- |
| `npm audit --omit=dev` | **0 vulnerabilities**                                                        |
| Production Critical    | **0**                                                                        |
| Production High        | **0**                                                                        |
| Development advisories | 1 distinct (`brace-expansion`, GHSA-mh99-v99m-4gvg) across 9 nodes, 8 waived |
| Licence policy         | 0 prohibited packages                                                        |
| Lockfile               | reproducible — `npm ci` clean                                                |
| New exceptions         | **0**                                                                        |
| Broadened exceptions   | **0**                                                                        |

The `brace-expansion` exception is **byte-identical** to `develop`. It was not
rewritten, not broadened, and not re-fingerprinted.

## The exception fingerprint, and a correction

Before this batch, the expectation on record was that **ESLint 10 would be the
upstream fix that removes the `brace-expansion` waiver entirely** — the exception
itself records `fixAvailable: {eslint@10.8.0, isSemVerMajor: true}`.

**That expectation was wrong, and #121's own CI proved it.** ESLint 10 is a
_partial_ fix that swaps one affected node for another:

```
records  ["node_modules/glob/node_modules/brace-expansion",
          "node_modules/minimatch/node_modules/brace-expansion"]
resolves ["node_modules/eslint-config-next/node_modules/brace-expansion",
          "node_modules/glob/node_modules/brace-expansion"]
```

Under ESLint 10, eslint's own `minimatch` chain resolves the **patched**
`brace-expansion@5.0.8` — genuine progress — but `eslint-config-next`'s plugin
chain (`eslint-plugin-import` / `jsx-a11y` / `react` → `minimatch@^3.1.2`)
introduces `brace-expansion@1.1.18`, and `@vitest/coverage-v8 → glob →
minimatch@^9.0.4` still resolves `2.1.3`. Development advisories stay at **9**.

So the waiver survives, against a different node set, and `dependency-policy.mjs`
correctly fails the tree rather than absorbing the change. The exception was
**not** silently rewritten to accept it. Recorded in issue
[#132](https://github.com/Ezzaldeen-Albitar/RootLco/issues/132) so the next
attempt does not start from the same wrong premise.

## Sass 1.101 → 1.102 (#122) — accepted

Build-time only. `lint`, `typecheck`, `format:check`, `style:check`, production
`build` and the unit tier all pass. Stylelint is unchanged and its
`--max-warnings 0` setting was not relaxed. No deprecation warning appears in the
build output that was not already present.

## Supabase CLI 2.109.1 → 2.110.0 (#125) — accepted

**Local developer tooling only.** No workflow invokes the `supabase` binary —
verified by grep; the four `supabase` matches in workflows are all the
`supabase/migrations/` **path**, not the CLI. CI obtains its database from a
`postgres:17-alpine` service container, so migration replay, RLS and the
database tier are entirely independent of this package.

Note the declared range moves `^2.34.3 → ^2.110.0`, a larger step than the title
suggests, though the resolved version moves only one minor.

Migrations remain **119**, migration 120 absent, schema hash `a677eb05…`
unchanged — measured on this branch. (An earlier draft said "re-verified on the
promoted tree"; at the time of writing no promotion of this batch existed, so
that sentence described something that had not happened. The post-promotion
figures are reported in the closure report.)
