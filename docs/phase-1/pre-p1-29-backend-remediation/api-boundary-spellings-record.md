# Web API boundary — every spelling (execution record)

Closes `RES-12`.

|                                   |                                                 |
| --------------------------------- | ----------------------------------------------- |
| Branch                            | `feature/pre-p1-29-web-api-boundary-spellings`  |
| Base                              | `345b9208` — `origin/develop` at the #279 merge |
| Ownership profile                 | `pre-p1-29-web`                                 |
| New migrations                    | **0**                                           |
| New operations / permission codes | **0**                                           |
| New CI gates                      | **0** — an existing REQUIRED gate is repaired   |

---

## 1. RES-12 was rated low severity on an assumption that is false

The register said:

> `check-api-boundary.mjs` cannot see the `@rootlco/api` spelling of an API-source
> import. Gate defect, low severity — `check-web-topology.mjs` covers the runtime
> case and IS in the required set.

Two things in that sentence are wrong.

**`validate:boundary` is itself tier `required`** — `check-command-coverage.mjs`
classifies it so, reached through `validate:web-boundary`. Nothing was standing
behind it.

**`check-web-topology.mjs` does not cover this.** Its only mention of the API
workspace is the string `apps/api/package-lock.json`. It is not a second opinion
on module boundaries.

## 2. It could not see four spellings, not one

The rule read `/from\s+['"][^'"]*apps\/api\//`. Each of these reaches API server
source, and the gate reported **0 violations** on a file containing all of them:

| spelling                                          | why it was invisible                |
| ------------------------------------------------- | ----------------------------------- |
| `import … from '@rootlco/api'`                    | no `apps/api/` in the text          |
| `await import('@rootlco/api/src/server/db/pool')` | not a `from` clause                 |
| `await import('../../../api/src/server/db/pool')` | not a `from` clause, no `apps/api/` |
| `import … from '../../../api/src/server/db/pool'` | a relative path has no `apps/api/`  |

`require(...)` and `export … from` were invisible for the same reasons.

### 2.1 The package spelling needs no setup at all

`apps/web` declares **no** dependency on `@rootlco/api`. That is not protection:
npm workspaces symlink every workspace package into the root `node_modules`, so
`@rootlco/api` resolves from `apps/web` regardless. The spelling the rule could
not see is the one that requires nothing of the author.

## 3. So the rules read the parser

The three import rules now test module specifiers collected from the AST —
`ImportDeclaration`, `ExportDeclaration`, dynamic `import()`, and `require()` —
rather than matching source text. A relative specifier is resolved against the
importing file and compared as a repository path, so depth and spelling stop
mattering.

`direct-fetch` and `unsafe-html` stay textual: they are about an identifier
appearing at all, not about a module boundary, and `stripComments` already keeps
prose out of them.

Two rules got stricter on the way past, because the same argument applies:

- `server-only-import` now names both spellings of each module. `node:fs` and
  `fs` are the same module; a rule naming only the prefixed form forbids a habit
  rather than a capability. `dns`, `tls`, `cluster` and `worker_threads` join the
  list for the same reason `net` was already on it.
- `supabase-import` matches the package by prefix and the directory by resolved
  path rather than by a substring that a relative import can miss.

## 4. The gate had no test, which is how four evasions survived

`validate:boundary` is required and had **no suite** — only a passing mention in
`attachments-contract.test.ts`'s docblock. `apps/web/tests/api-boundary-gate.test.ts`
now pins:

- the four spellings in §2, plus `require`, `export … from`, and a static package
  subpath — seven in all — are each caught, and reported **by name** rather than
  counted, so a failure says which spelling got through;
- both spellings of a server-only module;
- supabase by package and by resolved path;
- that ordinary Frontend imports — `react`, `next/link`, `@/lib/api`, siblings,
  and a lazy `import('./panel')` — are **not** flagged, because a boundary rule
  that fires on ordinary code gets an allowance carved into it and the allowance
  is what leaks;
- that a docblock or a commented-out import naming the forbidden module is not a
  finding — the parser does not offer comments, which closes the class this
  repository has recorded repeatedly;
- that the `fetch` allowance is still exactly one named file.

## 5. Scope

No product source changed. The diff is one gate, one new suite, the register, and
the two derived counts that move when a test file is added.

## 6. Status

`RES-12` moves to **F** on merge and protected reproof.
