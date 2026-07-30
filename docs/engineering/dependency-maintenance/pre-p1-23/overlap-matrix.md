# Pre-P1-23 — mechanical overlap matrix

Built from package names, `package-lock.json` nodes, workflow action identifiers and affected
files. Not from PR titles, which mislead in two cases.

## npm package sets — disjoint

| PR  | Packages                |
| --- | ----------------------- |
| 96  | `react`, `react-dom`    |
| 97  | `prettier`, `stylelint` |
| 98  | `@supabase/ssr`         |
| 99  | `vitest`                |
| 102 | `typescript`            |

**Pairwise intersection: empty.** The suspected #97 ↔ #99 and #97 ↔ #102 overlaps do **not**
exist — #97's `dev-tooling` group carries neither TypeScript nor Vitest. #96's `next-and-react`
group carries no Next.js bump; `next` stays 16.2.12. No standalone Next.js or React PR exists,
so #96 overlaps nothing.

## Action PRs — shared files, disjoint lines

| Pair      | Shared files                                      | Line overlap                          |
| --------- | ------------------------------------------------- | ------------------------------------- |
| 100 ↔ 105 | `pr-ci.yml`, `protected-develop-verification.yml` | **none** — 117/327 vs 282; 184 vs 154 |
| 100 ↔ 101 | `_reusable-release-artifact.yml`                  | none                                  |
| 100 ↔ 104 | `_reusable-code-security.yml`                     | none                                  |

Verified with `git diff -U0` hunk headers. All four applied together with no conflict.

## A coupling the matrix did NOT initially capture

Two coupled pairs were split by Dependabot, and neither is visible as an "overlap" because the
halves are tracked as separate dependencies:

- `vitest` ↔ `@vitest/coverage-v8` (#99 moved one)
- `github/codeql-action/analyze` ↔ `github/codeql-action/init` (#104 moved one)

A third was invisible for a different reason: **`actions/setup-node` has a reference outside
`.github/workflows/`**, in the composite `.github/actions/setup-project/action.yml`, which
`dependabot.yml`'s `directory: /` does not scan. #103 therefore covered 3 of 24 call sites.

## Canonical paths chosen

Path 3 — a controlled integration set — for the compatible updates, split into reviewable units:
**#111** actions, **#112** CodeQL, **#113** npm, **#114** remediation. Path 4 — defer with
evidence — for #99 and #102.
