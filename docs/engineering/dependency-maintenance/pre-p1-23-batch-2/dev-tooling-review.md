# Pre-P1-23 batch 2 — development tooling review

Covers #121 `eslint`, #122 `sass`, #123 `@types/node`, #125 `supabase`.

## ESLint 9.39.5 → 10.8.0 (#121) — **deferred**

The only red pull request in the batch. Four checks failed: `static-quality`,
`Lint, types, tests, build`, `dependency-security` and `ci-gate`.

### Reproduced cause — a removed API, not a peer warning

```
Oops! Something went wrong! :(
ESLint: 10.8.0

TypeError: Error while loading rule 'react/display-name':
  contextOrFilename.getFilename is not a function
Occurred while linting /home/runner/work/RootLco/RootLco/eslint.config.mjs
    at resolveBasedir (.../eslint-config-next/node_modules/eslint-plugin-react/lib/util/version.js:31:100)
    at detectReactVersion (.../eslint-plugin-react/lib/util/version.js:85:19)
```

ESLint 10 [removed the deprecated rule-context
methods](https://eslint.org/docs/latest/use/migrate-to-10.0.0) —
`context.getFilename()`, `getSourceCode()`, `getCwd()`,
`getPhysicalFilename()`, `parserOptions`, `parserPath` — in favour of direct
property access. `eslint-plugin-react` still calls `getFilename()`, so lint dies
while **loading** the rule. Nothing in this repository's configuration is
reached.

> **A correction.** An earlier draft of this document, and of issue
> [#132](https://github.com/Ezzaldeen-Albitar/RootLco/issues/132), quoted that
> banner as `ESLint: 9.39.5`. It is **`ESLint: 10.8.0`** — the string `9.39.5`
> appears in those logs only in the six
> `npm warn Conflicting peer dependency: eslint@9.39.5` lines, which report what
> the **plugins require**, not what ran. The two were conflated. The conclusion is
> unaffected — ESLint 10 installed, ran, and crashed on the plugin — but a quoted
> log line has to be the line that was logged.

The install also emits `Conflicting peer dependency: eslint@9.39.5` six times;
that is the plugins' declared peer range, not the installed version, which
`npm warn Found: eslint@10.8.0` confirms.

### No published plugin release accepts ESLint 10

Checked against the npm registry, not inferred from SemVer:

| Plugin                      | Latest published | `peerDependencies.eslint`          | Accepts 10? |
| --------------------------- | ---------------- | ---------------------------------- | ----------- |
| `eslint-plugin-react`       | 7.37.5           | `^3 \|\| … \|\| ^9.7`              | **no**      |
| `eslint-plugin-import`      | 2.32.0           | `^2 \|\| … \|\| ^9`                | **no**      |
| `eslint-plugin-jsx-a11y`    | 6.10.2           | `^3 \|\| … \|\| ^9`                | **no**      |
| `eslint-plugin-react-hooks` | 7.1.1            | `… \|\| ^10.0.0`                   | yes         |
| `typescript-eslint`         | 8.65.0           | `^8.57.0 \|\| ^9.0.0 \|\| ^10.0.0` | yes         |

All three blockers reach this repository through `eslint-config-next@16.2.12`,
which **depends on** them — so its own permissive `eslint: >=9.0.0` peer does not
help, and there is no newer `eslint-config-next` to move to (16.2.12 is latest).

ESLint 10's Node requirement (`>=20.19` / `>=22.13` / `>=24`) is satisfied; the
runtime is not the obstacle.

### Second, independent failure

`dependency-security` also failed, and not for the same reason — see the
fingerprint analysis in
[`application-dependencies-review.md`](application-dependencies-review.md).
ESLint 10 changes the `brace-expansion` waiver's resolved-node set, so
`dependency-policy.mjs` refuses the tree by design.

### What was not done

No rule disabled, no blanket ignore, no severity downgraded, no repository-wide
`eslint-disable`, no TypeScript strictness weakened. Any of those would have made
the check green while removing the guard it exists to provide.

**Disposition:** deferred and closed against issue
[#132](https://github.com/Ezzaldeen-Albitar/RootLco/issues/132); `eslint`
semver-major ignored, patches and minors retained.

## Sass 1.101.0 → 1.102.0 (#122) — **accepted**

Minor, build-time. Verified on a clean worktree from current `develop`:

| Check                                                 | Result                   |
| ----------------------------------------------------- | ------------------------ |
| `npm ci`                                              | exit 0, resolved 1.102.0 |
| `npm run lint`                                        | pass                     |
| `npm run typecheck`                                   | pass                     |
| `npm run format:check`                                | pass                     |
| `npm run style:check` (Stylelint, `--max-warnings 0`) | pass                     |
| `npm run build` (production)                          | pass                     |
| `npm run test` (unit)                                 | pass                     |

Stylelint configuration unchanged and its zero-warning setting not relaxed. No
new deprecation surfaced in the build output. SCSS module semantics
(`@use`/`@forward`), variables, mixins and the Tailwind interaction all compile
unchanged.

## `@types/node` 20 → 26 (#123) — **deferred**

**Every gate passes.** This is refused on policy, and the distinction matters:
there is no red check to point at.

| Check         | `^26`    | `^22`    |
| ------------- | -------- | -------- |
| `npm ci`      | pass     | pass     |
| `typecheck`   | **pass** | **pass** |
| `lint`        | **pass** | **pass** |
| `test` (unit) | **pass** | **pass** |
| `build`       | **pass** | **pass** |

The supported runtime is **Node 22** — `engines.node: ">=22.0.0"`, CI
`node-version: '22'`, Docker `node:22`. Moving to 26 means the compiler would
accept calls to Node 23–26 APIs that are **absent on Node 22**; such code
compiles, lints, passes any test that does not exercise it, and fails in
production.

> **A correction, and it cuts against the earlier framing.** An earlier draft of
> this document argued that types _behind_ the runtime (20 on 22) are "the safe
> direction — everything that typechecks also exists at run time". **That is
> false**, and adversarial review disproved it by measurement rather than
> argument:
>
> |                          | `@types/node` 20.19.43 | `@types/node` 22.20.1 | Node 22 runtime |
> | ------------------------ | ---------------------- | --------------------- | --------------- |
> | `crypto.createCipher`    | **declared** (5 decls) | absent                | **`undefined`** |
> | `crypto.createDecipher`  | **declared**           | absent                | **`undefined`** |
> | `zlib.constants.Z_TREES` | **declared** (3 decls) | absent                | **`undefined`** |
>
> Verified against the installed type packages and against `node:22-alpine`
> itself (`node v22.23.1`). So the **current** `^20` state has the same defect in
> the opposite direction: it declares APIs Node 22 has **removed**. Types behind
> the runtime are not safe; they are unsafe by deletion instead of by addition.
>
> The conclusion — do not jump to 26 — is unchanged. But the reason is not "20 is
> safe"; it is that **types and runtime should match**, and 26 moves further from
> the runtime rather than closer.

CI cannot distinguish the two columns above, which is exactly why the refusal is
recorded in writing rather than left to a gate.

**Recommended instead:** `@types/node@^22`, matching the runtime — verified green
above (resolves 22.20.1). The measurement above makes this stronger than a
preference: it is the only one of the three options that neither declares removed
APIs nor advertises unavailable ones. Offered as evidence-backed advice in issue
[#133](https://github.com/Ezzaldeen-Albitar/RootLco/issues/133) rather than
applied here, because substituting a different major than the one proposed is an
owner decision.

**Disposition:** deferred and closed; `@types/node` semver-major ignored,
patches and minors retained.

## Supabase CLI 2.109.1 → 2.110.0 (#125) — **accepted**

Local developer tooling. `typecheck`, `lint`, unit and `build` all pass, and the
installed binary reports **2.110.0**.

Blast radius is smaller than it looks: **no workflow invokes the CLI**. The
`supabase` strings in workflows are all the `supabase/migrations/` path, and CI
uses a `postgres:17-alpine` service container. The CLI affects only local
`dev:up` / `supabase:start|stop|status|reset`.

Worth recording: the declared range moves **`^2.34.3` → `^2.110.0`**, not the
one-minor step the title implies, even though the resolved version moves only
2.109.1 → 2.110.0.
