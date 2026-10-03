# GHSA-vfj7-8cjw-p6xm — braces stack exhaustion, local patched copy

Task P1-32-PRE-OD-DEP3, branch `chore/dependency-security-2026-10-03-braces-depth-guard`, cut from
`develop` at `bfe4e773`. This file records the advisory, where braces sits in the tree, what can
reach it, the patch, the evidence, the limits of that evidence and when the copy goes away. The copy
itself and its provenance are in `scripts/vendor/braces/` (see its `README.md`).

**Functional remediation and scanner coverage are reported separately below, and they are not the
same thing.** The patch is verified by `tests/ci/braces-patched-copy.test.ts`. npm audit does not
verify it, and the audit going quiet is not evidence that the patch works.

## 1. The advisory

| Field         | Value                                                                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Advisory      | GHSA-vfj7-8cjw-p6xm (CVE-2026-93687), severity high, CWE-674 (uncontrolled recursion)                                                                                                         |
| Package       | `braces`, vulnerable range `<= 3.0.3`, `first_patched_version` null                                                                                                                           |
| Published     | 2026-09-18; updated 2026-10-02T22:36Z, when it reached the feed npm audit reads                                                                                                               |
| Effect        | Recursive AST walkers without a depth limit: a deeply nested brace pattern under the 10,000-character input limit exhausts the call stack, and the process ends with an uncaught `RangeError` |
| Gate effect   | `dependency-security` went red on every pull request: 14 high in the full tree and in the web full tree (npm 10.9.4 on the `bfe4e773` lockfile), 0 in production                              |
| Owner mandate | Owner decision of 2026-10-03: a patched copy in the repository, subject to evidence and review                                                                                                |

## 2. Upstream recheck (2026-10-03)

No official compatible fix exists, so the Owner's preferred route (take an upstream release) is not
available.

- The advisory still lists `first_patched_version: null` and is not withdrawn.
- npm: the latest braces is `3.0.3` (published 2024-05-21). The upstream repository's last commit is
  from 2025-01-19, and git tag `3.0.3` (`74b2db29`) matches the registry tarball file for file.
- Issue micromatch/braces#70 is open. PR #72 (a nesting limit of 100 plus walker guards) is open and
  not merged. Its stringify change also passes the parent node to child calls, which changes
  `escapeInvalid` output, so it was not taken as-is. PRs #68 and #69 are open and unrelated.
- No dependent has dropped braces or pinned a fixed version. The latest micromatch is 4.0.8, which
  asks for `braces@^3.0.3`; the latest chokidar 3 is 3.6.0, which asks for `braces@~3.0.2`; and
  tailwindcss 3.4.19 is the latest 3.x.

## 3. Dependency paths

The `bfe4e773` lockfile holds exactly one braces, `node_modules/braces@3.0.3`, marked `dev: true`.
Its only direct dependents are:

- `micromatch@4.0.8`, which is used by `fast-glob@3.3.1` (from `@next/eslint-plugin-next`, from
  `eslint-config-next@16.3.8`), `globby/node_modules/fast-glob@3.3.3` (from `globby`, from
  `stylelint`), `stylelint` and `stylelint/node_modules/fast-glob`, and `tailwindcss@3.4.19` and
  `tailwindcss/node_modules/fast-glob`;
- `tailwindcss/node_modules/chokidar@3.6.0`, used only in tailwind's watch mode.

Root, `apps/api` and `apps/web` all declare `eslint-config-next`, `stylelint` and
`stylelint-config-standard-scss`; only `apps/web` declares `tailwindcss`.

**Copies the lockfile cannot see.** braces is also bundled, as compiled source, inside `prettier`,
`vite`, `rollup` and `playwright-core`. npm overrides cannot replace those copies and npm audit
cannot see them. They are a recorded limitation (section 8), not part of this remediation.

## 4. Reachability

### Production

No braces code ships.

- braces, micromatch, every fast-glob, tailwindcss and chokidar 3.6.0 are all `dev: true`. The only
  `devOptional` chokidar (5.0.0, from sass) does not depend on braces.
- The only shipped artefact is the API runtime image. Its runner stage copies only
  `apps/api/.next/standalone`, `static` and `public`, so output tracing includes only modules the
  server actually requires. The web application is not built or shipped by any pipeline.
- In the container-security artefact for `develop` `bfe4e773` (artefact id 11253347219),
  `image-node-modules.txt` lists 62 packages and none is braces, micromatch, fast-glob, chokidar,
  fill-range, to-regex-range or tailwindcss. `image-files.txt` has no braces path. It does contain
  `next/dist/compiled/picomatch`, which is a different library.
- `npm audit --omit=dev` is 0 on the root and the web trees, before and after this change.

### CI and build inputs

The bug is real in CI and build jobs, and it was reproduced. In those jobs braces only receives
patterns that come from repository configuration or source:

- tailwind's content glob `./src/**/*.{ts,tsx}` (in `apps/web/tailwind.config.ts`), through
  fast-glob, during the web build, the web tests and `validate:theme`;
- stylelint's script argument `src/**/*.scss`, `ignoreFiles` and `overrides` in `.stylelintrc.json`,
  through globby, fast-glob and micromatch;
- the Next ESLint plugin's fast-glob 3.3.1, driven by rule settings;
- chokidar 3, only in tailwind watch mode.

File names, branch names and pull-request text are matched against patterns. They are never
expanded as brace patterns. The repository's own scripts use `tinyglobby`, which goes through
picomatch and never loads braces.

So an attacker would have to plant a crafted pattern in a pull request. Every file that can carry
one (`tailwind.config.ts`, `eslint.config.mjs`, a vitest config, `package.json` scripts) is already
code that runs in that job. The realistic impact is a crashed job on the attacker's own pull
request, with no privilege gained. "Development-only" was not treated as "unreachable": the bug is
patched because it is functionally real in tools that CI runs.

## 5. The patch

`scripts/vendor/braces/GHSA-vfj7-8cjw-p6xm.patch` is a plain unified diff against the 3.0.3 tarball:
six library files and `package.json`, 93 lines added and 24 removed (`git apply --stat`). It adds `MAX_DEPTH = 100` to
`lib/constants.js`. `options.maxDepth` can only lower the limit: a value that is not a non-negative
number is ignored, and anything above 100 is capped at 100.

The guards are in the `lib/*` files, not in `index.js`, because `package.json` has no `exports` map
and `require('braces/lib/compile')` and the other deep imports are public in practice.

| Recursive path in 3.0.3                                                | Reached from                                                                                                                                                                                    | Guard                                                                                                                                                                           |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/parse.js` builds an AST of unlimited `{` and `(` depth            | `braces()`, `create`, `parse`, and `compile`, `expand` and `stringify` with a string; `micromatch.braces`, `braceExpand` and `parse`                                                            | throws `SyntaxError: Input nesting depth exceeds max depth (100)` before nesting a block past the limit                                                                         |
| `lib/compile.js` `walk`                                                | `braces()`, `create`, `compile` (string or AST), `require('braces/lib/compile')`                                                                                                                | carries a depth; throws `RangeError` with the same message past the limit, which also stops a cyclic `nodes`                                                                    |
| `lib/expand.js` `walk`                                                 | `braces(…, { expand: true })`, `expand` (string or AST), fast-glob, chokidar, `require('braces/lib/expand')`                                                                                    | the same depth guard                                                                                                                                                            |
| `lib/stringify.js` inner `stringify`                                   | `stringify` (string or AST), `parse` itself, `expand` for invalid blocks, `require('braces/lib/stringify')`                                                                                     | the same depth guard; the child call still passes no parent, so `escapeInvalid` output is unchanged                                                                             |
| `lib/expand.js` `append`                                               | `expand` of a caller-built AST: a nested array taken from the queue of a non-brace node's caller-supplied `parent` chain (`q.pop()` or `queue.pop()`), or nested inside a queue the walk builds | carries a depth; throws `RangeError` with the same message past the fixed `MAX_DEPTH` (100)                                                                                     |
| `lib/utils.js` `flatten`                                               | the queue `expand` returns (including one taken from a `parent` chain), `append`, `require('braces/lib/utils')`                                                                                 | rewritten as a loop over an explicit stack, so it cannot exhaust the call stack; an array nested past `MAX_DEPTH`, or a cyclic array, throws `RangeError` with the same message |
| a nested-array `node.value` (engine string conversion, `utils.reduce`) | `compile`, `expand` and `stringify` of a caller-built AST whose `node.value` is a deeply nested array                                                                                           | `TypeError: Expected node.value to be a string` where a walker or `utils.reduce` reads the value                                                                                |

The first revision of this patch guarded `append` and `flatten` only through `node.value`. Review of
PR #501 showed that `expand` takes the queue of a non-brace node from its caller-supplied `parent`
chain without checking it, so a nested array placed there reached both functions unguarded and
exhausted the stack at Node's default stack size, exactly as in 3.0.3. Both functions now bound
their own recursion, whatever route the array arrives by. The `append` limit is the fixed
`MAX_DEPTH`, not `options.maxDepth`: queue values built from a pattern nest at most one level in
`append` and two in `flatten` (measured over nested patterns up to depth 100), so lowering
`maxDepth` has no reason to apply there. `append` unwraps two array levels per call, so it refuses
an array nested more than about 200 levels deep.

Expansion is never truncated: input past the limit is refused with an error. `package.json` gets
version `3.0.3-rootlco.1` and a `rootlcoLocalPatch` field naming the upstream version, tarball,
integrity, advisory, patch file and owner. Name, author, contributors, repository, licence and
dependencies are unchanged. The tarball keeps upstream's `devDependencies` and `scripts`, which npm
does not install or run for a dependency.

## 6. Packaging

- The root `devDependencies` entry `braces: file:scripts/vendor/braces/braces-3.0.3-rootlco.1.tgz`
  plus the override `braces: $braces` make micromatch and chokidar resolve to one real
  `node_modules/braces` directory. It is not a symlink, and npm installs no `devDependencies` from
  it. The override references the direct dependency, so there is no EOVERRIDE conflict.
- Two other forms were rejected. An override written as `file:./vendor/braces` resolves relative to
  each dependent and breaks `npm ci`. A linked directory installs the copy's own development
  dependencies and creates a symlink.
- A source directory was also rejected. Pristine braces fails the root `prettier --check .` and root
  ESLint, and excluding it would need new ignore entries, which this change does not add.
- `package-lock.json` was regenerated with `npm install --package-lock-only` (npm 11.17.0). The diff
  is the root devDependency plus the `node_modules/braces` version, `resolved` and `integrity`, 4
  lines added and 3 removed. With npm 10.9.4, the version CI uses, the same lockfile installs
  unchanged. When the patch was revised after review, the tarball kept its file name and version,
  and `npm install --package-lock-only` left the old integrity in place, so the lockfile was
  regenerated with `npm install --save-dev braces@file:scripts/vendor/braces/braces-3.0.3-rootlco.1.tgz --package-lock-only`
  (npm 11.17.0). That changes only the `node_modules/braces` `integrity` line. The test compares that
  value with the tarball's real digest.
- The Dockerfile `deps` stage copies the tarball before `RUN npm ci`. The runner stage is unchanged.
- The tarball was produced with `npm pack` (npm 11.17.0; the revision with `--ignore-scripts`, and
  braces has no pack lifecycle script) from the patched tree. The test proves it equals pristine plus the patch, so it is reproducible from the two committed inputs.
  Packing the first revision's tree again reproduced its committed tarball byte for byte.

## 7. Functional remediation — evidence

| Check                                                                                                                                                                                                                                                                                                                                                                                              | Result                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/ci/braces-patched-copy.test.ts`, root unit tier (13 cases)                                                                                                                                                                                                                                                                                                                                  | pass locally (Node 24.19); the hosted unit tier runs it on Node 22                                                                                                                                                                                                         |
| Provenance: pristine tarball sha512 equals the registry integrity; patched tarball equals pristine plus the patch, applied hunk by hunk with exact context                                                                                                                                                                                                                                         | asserted by the test                                                                                                                                                                                                                                                       |
| Regression: 31 entry points (`braces()`, `create`, `compile`, `expand`, `stringify`, parse then walk, deep `lib/*` imports, deep, cyclic and nested-array ASTs, a nested or cyclic array in a caller-supplied `parent` queue through the `flatten` route and the `append` route, and `require('braces/lib/utils').flatten`) run in a child process with `--stack-size=500` and a 60-second timeout | original 3.0.3: `RangeError: Maximum call stack size exceeded` at all 31; patched: the controlled error at all 31                                                                                                                                                          |
| Uncaught: the string payload through `braces.expand`, and the `parent`-queue payload through the `flatten` route and the `append` route, with no handler                                                                                                                                                                                                                                           | original dies with the stack-exhaustion `RangeError` each time; patched dies with the documented `SyntaxError` (string) or `RangeError` (`parent` queue) instead                                                                                                           |
| The same `parent`-queue probes at Node's default stack size, against the installed copy (manual run, 2026-10-03)                                                                                                                                                                                                                                                                                   | first revision: stack exhaustion on both routes, as in 3.0.3; revised copy: the controlled `RangeError` on both routes, and on the cyclic variants                                                                                                                         |
| Through the real dependents, in-process: installed `micromatch.braces`, `braceExpand`, `parse`, and `generateTasks` of each of the four installed fast-glob copies                                                                                                                                                                                                                                 | each throws the controlled error                                                                                                                                                                                                                                           |
| Limit: nesting 100 accepted and 101 refused, for `{` and for `(`, and for caller-built ASTs; `maxDepth: 3` lowers the limit; `maxDepth: 1000` and `NaN` leave 100; `flatten` accepts a 100-deep array and refuses 101; a shallow `parent` queue expands as in 3.0.3 and a 300-deep one is refused                                                                                                  | asserted by the test                                                                                                                                                                                                                                                       |
| Compatibility, in the repository: 45 patterns (the project globs, ranges, steps, sets, nested sets, escapes, quotes, extglobs, invalid braces, a 100-deep pattern) times 10 option sets (including fast-glob's `expand` plus `nodupes`, `keepEscaping`, `keepQuotes`, `escapeInvalid`, `noempty`, `rangeLimit`, `maxLength`)                                                                       | output identical between original and installed patched copy for `braces()`, `compile`, `expand`, `stringify` and a parse round trip                                                                                                                                       |
| Compatibility, upstream suite: the upstream mocha suite at tag `3.0.3`, run outside the repository (mocha was not added here)                                                                                                                                                                                                                                                                      | 764 passing against the original and 764 passing against the first revision of the patch; not re-run against the revised patch (the upstream test files are not in the npm tarball)                                                                                        |
| Real tools: every installed fast-glob against `tinyglobby` on three `apps/web` globs                                                                                                                                                                                                                                                                                                               | identical file sets (asserted by the test)                                                                                                                                                                                                                                 |
| Real tools: `npm run style:check:web`; stylelint with the brace glob `src/{app,components,features,styles}/**/*.{scss,css}`                                                                                                                                                                                                                                                                        | first revision: exit 0, both select the same 27 files with 0 warnings; revised patch: `npm run style:check:web` exit 0 (the 27-file comparison was not repeated)                                                                                                           |
| Real tools: tailwind through postcss with `apps/web/tailwind.config.ts` (content glob `./src/**/*.{ts,tsx}`)                                                                                                                                                                                                                                                                                       | first revision: CSS byte-identical with the original and the patched braces (32,670 bytes); not repeated for the revised patch, whose fast-glob selection for that glob is asserted against `tinyglobby` by the test                                                       |
| Real tools: `npm run lint:web` on three files (the Next plugin's fast-glob)                                                                                                                                                                                                                                                                                                                        | first revision: exit 0; not repeated for the revised patch                                                                                                                                                                                                                 |
| Install: `npm ci` with npm 11.17.0 in the worktree and with npm 10.9.4 in a clean directory; `npm ls braces --all`                                                                                                                                                                                                                                                                                 | both resolve micromatch and the tailwindcss chokidar to the one patched directory; `npm ls` exit 0. Revised patch: `npm ci` (npm 11.17.0) in the worktree and `npm ls braces --all` repeated with the same result; the npm 10.9.4 clean-directory install was not repeated |

## 8. Scanner coverage — reported separately

**npm audit cannot verify the patch.**

| Audit (as `_reusable-dependency-security.yml` runs it)                    | `bfe4e773` lockfile (npm 10.9.4) | this branch (npm 10.9.4 and npm 11.17.0)              |
| ------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------- |
| `npm audit --omit=dev`                                                    | 0                                | 0                                                     |
| `npm audit`                                                               | 14 high (braces and dependents)  | 0                                                     |
| `npm audit --workspace @rootlco/web --omit=dev`                           | 0                                | 0                                                     |
| `npm audit --workspace @rootlco/web`                                      | 14 high (braces and dependents)  | 0                                                     |
| `scripts/ci/dependency-policy.mjs` (with the licence inventory and proof) | fails on the advisories          | pass; braces is inventoried as `3.0.3-rootlco.1`, MIT |

The audit still sees a braces package: `braces@3.0.3-rootlco.1` is in the tree and in the licence
inventory. It reports nothing for it only because npm's semver check leaves a prerelease outside the
range `<=3.0.3` (`semver.satisfies('3.0.3-rootlco.1', '<=3.0.3')` is false; it is true with
`includePrerelease`). The audit is not detecting the fix. It will be equally blind to every future
braces advisory for as long as this copy is installed. The bundled copies in prettier, vite, rollup
and playwright-core are invisible to every scanner. If the repository's dependency graph is ever
enabled, Dependabot or dependency-review may report the prerelease.

The audit commands, the exception file and the security gate are unchanged. No exception or waiver
was added. The verification is the test in section 7, which runs in the required unit tier on every
pull request.

## 9. Limitations

- **Scanner blindness** — see section 8.
- **Bundled copies** in prettier, vite, rollup and playwright-core keep the unpatched code. Their
  inputs are repository configuration: prettier CLI patterns, vitest and vite config globs and
  `import.meta.glob`, playwright `testMatch`. They are fixed only when those tools ship a release
  with a fixed braces.
- **Behaviour change**: a pattern that opens more than 100 nested `{` or `(` is refused even if the
  blocks never close, where 3.0.3 would have flattened it. A caller-built AST with an array
  `node.value` is refused. No project glob comes near either.
- **A caller-built AST with a cyclic `parent` chain** still makes `expand` loop forever. That is a CPU
  hang (CWE-835), not a stack overflow, and it is not reachable from a pattern string. The `parent`
  chain is walked by a loop, so it is not a stack-overflow route; the queue it leads to is bounded by
  the `append` and `flatten` limits above.
- **Argument spreading outside the CWE-674 walkers** (found by the independent review): an array
  input to `braces()` with `expand: true` and a very large expansion (for example `'{a,b}'` repeated
  19 times, 95 characters, which the same string expands to 524,288 entries without error) and a
  caller-built range node with about 300,000 children (spread into `fill(...args)`) still throw
  `Maximum call stack size exceeded`, because spreading that many arguments overflows the stack.
  3.0.3 and the patched copy behave the same, the error is thrown synchronously and can be caught,
  and no installed dependent passes braces an array or an AST. The patch does not change these
  paths. The array case was reproduced against the installed copy; the range-node case is taken from
  the review.
- **`options.maxDepth` does not lower the `append` and `flatten` limits**, which stay at the fixed
  `MAX_DEPTH`; see section 5.
- **Integrity**: `npm ci` does not check the integrity of a `file:` tarball, so an altered tarball
  would install silently. The test compares the lockfile integrity with the tarball's real digest
  and the installed files with the tarball's contents on every run.
- **An uncaught controlled error still stops the caller**: fast-glob and micromatch do not catch it.
  The difference is that the failure is immediate, deterministic and catchable, and the stack is not
  exhausted.

## 10. Ownership and replacement condition

RootLco owns the patch and its maintenance under the Owner decision of 2026-10-03. The upstream
authors are not responsible for it.

**Replace this copy with the first official braces release that fixes GHSA-vfj7-8cjw-p6xm, or remove
it when no dependency needs braces.** To do that, delete `scripts/vendor/braces/`, the root
`devDependencies` and `overrides` entries for `braces`, the Dockerfile `COPY` line for the tarball and
`tests/ci/braces-patched-copy.test.ts`, then regenerate `package-lock.json` with npm. The follow-up is
tracked as CC-OD-55 in `docs/product/owner-directive-2026-09-16/change-control.md`. Until it closes,
re-check the advisory and the upstream repository by hand whenever dependency security is reviewed,
because npm audit will not raise a braces advisory against this copy.

## 11. Where else this is recorded

- `scripts/vendor/braces/README.md` — the provenance, beside the copy.
- `docs/engineering/ci-automation/security-model.md` section 4 — a status line pointing here.
- `package.json` `comment:overrides` — names the copy and the test that verifies it.
- `.github/ci-baselines/dependency-exceptions.json` is **not** changed. Its `remediationRecord` is
  free text that the gate does not read, and no document names it as the place to record a
  remediation. Its `developmentAdvisories` list stays empty, so no exception or waiver exists.
