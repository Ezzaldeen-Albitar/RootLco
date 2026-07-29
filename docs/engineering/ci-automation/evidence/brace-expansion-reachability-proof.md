# brace-expansion — reachability proof

**Advisory**: [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg) ·
npm source `1124334` · severity **high** · affected `<=5.0.7` · patched **5.0.8**

**Status**: Open — upstream-blocked development-tooling exception with no proven
production or runtime reachability.

Every number below is derived mechanically by
[`scripts/ci/dependency-path-proof.mjs`](../../../../scripts/ci/dependency-path-proof.mjs),
re-run on every pull request and every protected push, and cross-checked by the
dependency gate against the recorded exception. Nothing here is asserted from
the `devDependencies` classification, which describes intent rather than what is
installed.

---

## 1. The exact dependency path from the root package

Seventy distinct root-to-target walks exist, because ESLint is reachable through
several plugin peer edges. They collapse to **three resolved instances**, of
which **two are affected**:

| Lockfile path                                         | Version   | Affected                             | Required by                          |
| ----------------------------------------------------- | --------- | ------------------------------------ | ------------------------------------ |
| `node_modules/brace-expansion`                        | **5.0.8** | **no — this is the patched release** | `minimatch@10.2.5` requires `^5.0.5` |
| `node_modules/glob/node_modules/brace-expansion`      | 2.1.3     | **yes**                              | `minimatch@9.0.9` requires `^2.0.2`  |
| `node_modules/minimatch/node_modules/brace-expansion` | 1.1.16    | **yes**                              | `minimatch@3.1.5` requires `^1.1.7`  |

npm's own `nodes` list for the advisory names exactly the two affected paths and
does **not** include the top-level 5.0.8 — because that instance is already
patched.

Representative walks, one per affected instance:

```
root → devDependencies → eslint@^9
                       → minimatch@^3.1.5
                       → brace-expansion@^1.1.7   (resolved 1.1.16)  AFFECTED

root → devDependencies → @vitest/coverage-v8@^3.2.4
                       → test-exclude@^7.0.1
                       → glob@^10.4.1
                       → minimatch@^9.0.4
                       → brace-expansion@^2.0.2   (resolved 2.1.3)   AFFECTED

root → devDependencies → @vitest/coverage-v8@^3.2.4
                       → test-exclude@^7.0.1
                       → minimatch@^10.2.2
                       → brace-expansion@^5.0.5   (resolved 5.0.8)   PATCHED
```

## 2. Every parent package in the path

`eslint`, `@eslint/config-array`, `@eslint/eslintrc`, `eslint-config-next`,
`eslint-plugin-import`, `eslint-plugin-jsx-a11y`, `eslint-plugin-react`,
`eslint-plugin-react-hooks`, `eslint-import-resolver-typescript`,
`typescript-eslint`, `@typescript-eslint/typescript-estree`,
`@vitest/coverage-v8`, `test-exclude`, `glob`, `minimatch`.

**Every one is a linter or a test-coverage tool.** None appears in the
application's runtime dependency set.

## 3. Development-only or production-reachable?

**Development-only.** All 70 root-to-target walks begin on a `devDependencies`
edge, and npm marks all three resolved instances `dev: true` — that is npm's own
graph resolution, not our classification.

## 4. Present in the production dependency tree?

**No.**

```
$ npm ls brace-expansion --omit=dev --all
rootlco-platform@0.1.0
`-- (empty)
```

```
$ npm ls --omit=dev --all --json   # searched for the string
contains "brace-expansion": false
contains "minimatch":       false
contains "eslint":          false
```

The production tree's top level is exactly: `@supabase/ssr`,
`@supabase/supabase-js`, `next`, `pg`, `pino`, `react`, `react-dom`, `zod`.

```
$ npm audit --omit=dev
found 0 vulnerabilities
```

## 5. Copied into the final Docker runner image?

**No.** The `runner` stage copies three paths from the build stage and **never
copies `node_modules`**:

```dockerfile
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
```

`output: standalone` emits only the modules the server actually resolves.

That is a claim about the Dockerfile. The check that the claim **held** runs on
a GitHub-hosted runner in the `container-security` job, which enumerates the
image filesystem with `find / -xdev -type f` and fails if a `node_modules/`
directory for `eslint`, `prettier`, `vitest`, `typescript`, `@typescript-eslint`,
`brace-expansion`, `minimatch`, `test-exclude`, `@vitest` or `stylelint` is
resolvable, or if any npm/yarn/pnpm cache is. It also asserts `/app/server.js`
**is** present, so a check that only looks for absences cannot pass over an empty
image.

The resulting inventory is fed straight back into
`dependency-path-proof.mjs --image-inventory`, so `packageDirInRunnerImage` is a
measurement rather than a claim, and the dependency gate fails if it is ever
`true`.

### What this does NOT claim

It does not claim the vulnerable code is absent from the image, and it must not
be read that way. Node bundles brace-expansion into the `node` binary itself via
esbuild, so a copy of the code ships inside every image that contains a Node
runtime, and no build step can remove it. Deleting `node_modules` does not delete
it; neither does a distroless base.

The claim that is both **true** and **sufficient** is narrower: no
`node_modules/brace-expansion/` directory exists in the image, so nothing the
application runs can resolve or `require()` the package. Unreachable, not absent.
The exception record states it the same way — `finalContainerCodePresent: true`
alongside `finalContainerReachable: false` — and the two fields exist separately
precisely so that nobody can collapse them back into a comfortable falsehood.

## 6. Imported by application runtime code?

**No** — not directly and not transitively. No file under `src/` or `scripts/`
imports `brace-expansion`, `minimatch` or `glob`. Verified on every run.

## 7. Can attacker-controlled input reach brace expansion?

**No.**

The vulnerability is a denial of service triggered by an attacker-supplied brace
expression. Reaching it requires an attacker-controlled pattern to be passed to
brace expansion or to a glob.

Every glob and brace pattern evaluated in this repository comes from committed
configuration: `eslint.config.mjs`, the three vitest configs, and the argument
lists in `package.json` scripts. The application does not depend on
`brace-expansion` at all, so there is no code path from an HTTP request, a
database value, or any other input to it.

## 8. Does GitHub Actions invoke it on anything but repository-controlled patterns?

**No.** The workflows pass no event-supplied value into a glob. The complete set
of `${{ }}` expressions that reach a shell is `github.event.pull_request.head.sha`,
`github.event.pull_request.base.sha`, `github.event.pull_request.base.ref`,
`github.event.pull_request.number`, `github.event.before`, `github.sha` and
`github.event_name` — none of which is free text, and none of which is passed to
a pattern-matching tool. This is enforced by `check-workflow-security.mjs` rule
WFS-006.

## 9. Does removing the override restore compatibility?

**Yes, and it was necessary.**

The attempted remediation was a `package.json` override forcing
`brace-expansion` to `^5.0.8` across the tree. Result:

```
$ npm run lint
TypeError: expand is not a function
    at Minimatch.braceExpand (node_modules/minimatch/minimatch.js:271:10)
    at Minimatch.make (node_modules/minimatch/minimatch.js:180:33)
    at doMatch (node_modules/@eslint/config-array/dist/cjs/index.cjs:422:13)
```

`brace-expansion@5` changed its export shape; `minimatch@3` and `minimatch@9`
call the v1/v2 default export, which v5 no longer provides. **Verified by
execution, not inferred.**

The override was reverted **completely**. With it removed:

| Check                  | Result |
| ---------------------- | ------ |
| `npm run lint`         | pass   |
| `npm run typecheck`    | pass   |
| `npm run test`         | pass   |
| `npm run format:check` | pass   |

ESLint is not weakened, no rule is disabled, and no lint coverage is removed.

## 10. Is the production audit clean after the compatible patch upgrades?

**Yes.**

```
$ npm audit --omit=dev
found 0 vulnerabilities
```

| Package   | Was     | Now         | Advisories closed                                                                                            |
| --------- | ------- | ----------- | ------------------------------------------------------------------------------------------------------------ |
| `next`    | 16.2.10 | **16.2.12** | 9 — proxy bypass, SSRF ×2, unauthenticated Server Function disclosure, cache confusion ×2, DoS ×2, image DoS |
| `postcss` | 8.4.31  | **8.5.24**  | 3 — XSS via unescaped `</style>`, arbitrary file read, path traversal                                        |
| `sharp`   | 0.34.5  | **0.35.3**  | 1 — inherited libvips CVEs                                                                                   |

`postcss` and `sharp` need an `overrides` entry because Next pins `postcss` at
exactly 8.4.31, and npm's only suggested remedy was downgrading Next to 9.3.3.

---

## Required outcome — measured

| Requirement                                                       | Measured   |
| ----------------------------------------------------------------- | ---------- |
| Production dependency High/Critical findings                      | **0**      |
| Production image High/Critical attributable to next/postcss/sharp | **0**      |
| brace-expansion runtime reachability                              | **0**      |
| brace-expansion direct application usage                          | **0**      |
| Incompatible override                                             | **absent** |
| ESLint                                                            | **green**  |

## Why this remains open rather than resolved

There is **no consumable fix**. The advisory affects every release up to and
including 5.0.7; the only patched release is 5.0.8, and the `minimatch` versions
in this tree cannot consume it. npm's own assessment agrees:

```json
"fixAvailable": { "name": "eslint", "version": "10.8.0", "isSemVerMajor": true }
```

— that is, the only fix npm can find is a major-version ESLint upgrade.

The exception therefore expires. `reviewBy` **2026-09-30** produces a warning;
`expiresOn` **2026-10-31** turns the gate red. And the gate fails _before_ either
date if the package becomes production-reachable, if the dependency path
changes, or if a compatible patched version becomes installable — because an
exception that outlives its cause is worse than none.
