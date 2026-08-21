# P1-25 remediation — frontend duplicate register

Exact-content duplicate detection ran over every tracked file under `apps/web` using Git
blob SHAs (the machine-readable results are in
[frontend-duplicate-register.json](frontend-duplicate-register.json) and
[web-topology-before.json](web-topology-before.json)). A "duplicate" here means **same
bytes at two paths**, or **two implementations owning one responsibility** — never two
files that merely share a name.

## Findings

| Class                                   | Count | Evidence                                                                                                 |
| --------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------- |
| Exact duplicate source files            | **0** | zero blob SHAs appear at two tracked paths                                                               |
| Duplicate route roots                   | **0** | one App Router at `apps/web/src/app/`; the topology gate forbids `apps/web/app/`, `pages/`, `src/pages/` |
| Duplicate App Router directories        | **0** | same gate                                                                                                |
| Duplicate token authorities             | **0** | one `_colors.scss` under `src/styles/`; the gate counts them and fails on ≠ 1                            |
| Duplicate brand authorities             | **0** | one `export const brand` in runtime source; the gate counts them and fails on ≠ 1                        |
| Duplicate API-client authorities        | **0** | `src/lib/api/client.ts` is the only network owner; `check-api-boundary.mjs` fails on any other `fetch`   |
| Duplicate data-table implementations    | **0** | one `src/components/data-table/`                                                                         |
| Duplicate money parsers                 | **0** | one `src/lib/money.ts`; `validate:exact-money` guards the API side                                       |
| Duplicate i18n authorities              | **0** | one catalogue pair `src/i18n/messages/{en,ar}.json`; the i18n suite proves key parity                    |
| Duplicate toast/dialog systems          | **0** | one `src/components/overlays/`                                                                           |
| Duplicate locale switchers              | **0** | one `LocaleSwitcher`                                                                                     |
| Nested package lockfiles                | **0** | root lockfile only; the gate forbids `apps/*/package-lock.json`                                          |
| Duplicate Playwright output folders     | **0** | one `testDir` (`tests/e2e`), outputs ignored, tracked reports forbidden by the gate                      |
| Unexplained competing shared components | **0** | see the same-name dispositions below                                                                     |

**Deleted duplicate files: 0. Merged duplicate files: 0.** There was nothing to delete
or merge — the register's value is that this is now _proven and enforced_ rather than
believed: `scripts/ci/check-web-topology.mjs` fails the build if any of the single-authority
counts above ever reads ≠ 1, and its mutation tests in `tests/ci/web-topology.test.ts`
prove it fails when a second authority is introduced.

## Same-basename dispositions (not duplicates)

- **`layout.tsx` / `page.tsx` / `error.tsx` / `loading.tsx` / `not-found.tsx`** at
  several depths under `src/app/` — Next.js route-boundary conventions. Each file is a
  different route segment's boundary; the framework requires the repeated names.
- **`index.ts`** barrel files in distinct component families — each exports its own
  directory; none re-export another's implementation.
- **Feature wrappers around shared components** — permitted by design (a feature may
  wrap `DataTable` with feature semantics). None currently exists; when one appears it
  wraps, it does not fork.

## Method

1. `git ls-tree -r HEAD -- apps/web` → path + blob SHA for every tracked file.
2. Group by blob SHA; any group > 1 is an exact duplicate. Result: none.
3. Group by basename; every group > 1 dispositioned above by reading the files.
4. Single-authority checks (`brand`, colour tokens, network owner) counted by content
   scan — now permanent in the topology gate.
