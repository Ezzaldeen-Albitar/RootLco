# Pre-P1-23 — exact Dependabot PR inventory

Retrieved from the live GitHub API. Every PR's base SHA was `d9a2c1dc8d09e8fe2b3cf9ca8a2d4a6c905756de`.

| PR  | Head SHA   | Dependency / action               | From → To                    | Jump      | Class       | Files | Checks at inventory        | Overlap                 |
| --- | ---------- | --------------------------------- | ---------------------------- | --------- | ----------- | ----- | -------------------------- | ----------------------- |
| 96  | `19138edd` | `react`, `react-dom`              | 19.2.4 → 19.2.8              | patch     | production  | 2     | 19/19 success              | none                    |
| 97  | `aecbfcdb` | `prettier`, `stylelint`           | 3.6.2→3.9.6, 17.14.0→17.14.1 | patch     | development | 2     | 19/19 success              | none                    |
| 98  | `fc088e84` | `@supabase/ssr`                   | 0.8.0 → 0.12.4               | minor     | production  | 2     | 19/19 success              | none                    |
| 99  | `357a58bf` | `vitest`                          | 3.2.7 → 4.1.10               | **major** | development | 2     | **13 failure / 6 success** | none                    |
| 100 | `e2c25719` | `actions/upload-artifact`         | 4.6.2 → 7.0.1                | **major** | CI          | 15    | 19/19 success              | shares 2 files with 105 |
| 101 | `706777d5` | `actions/attest-build-provenance` | 2.4.0 → 4.1.1                | **major** | CI          | 1     | 19/19 success              | shares 1 file with 100  |
| 102 | `4e9a862b` | `typescript`                      | 5.9.3 → 7.0.2                | **major** | development | 2     | **7 failure / 12 success** | none                    |
| 103 | `6d7ddacf` | `actions/setup-node`              | 4.4.0 → 7.0.0                | **major** | CI          | 1     | 19/19 success              | none                    |
| 104 | `73454ebc` | `github/codeql-action/analyze`    | 3.37.3 → 4.37.3              | **major** | CI          | 1     | **3 failure / 15 success** | shares 1 file with 100  |
| 105 | `9d6d18f5` | `actions/download-artifact`       | 4.3.0 → 8.0.1                | **major** | CI          | 2     | 19/19 success              | shares 2 files with 100 |

Totals: **10** open · **7** green in UI · **3** red · **7** major · **3** production
(`react`, `react-dom`, `@supabase/ssr`) · **3** development · **5** GitHub Actions.

## Failed check detail

**#99** — one root cause, thirteen symptoms. `npm ci` aborts:

```
npm error While resolving: @vitest/coverage-v8@3.2.7
npm error Found: vitest@4.1.10
npm error peer vitest@"3.2.7" from @vitest/coverage-v8@3.2.7
npm error Conflicting peer dependency: vitest@3.2.7
```

Every downstream job failed at install, not at test. The coverage gate then reported
`cannot read coverage summary at coverage/unit/coverage-summary.json: ENOENT` — refusing rather
than reading absence as success.

**#102** — `eslint` exits 2: `typescript-eslint does not support TS 7.0`, upstream tracking
issue typescript-eslint#10940, plus a peer requiring `typescript@6.0.3`.

**#104** — both language legs: `Loaded a configuration file for version '3.37.3', but running
version '4.37.3'`. `init` was left at v3 while `analyze` went to v4.
