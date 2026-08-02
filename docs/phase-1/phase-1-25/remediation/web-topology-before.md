# P1-25 remediation — web topology BEFORE normalization

Frozen at `6cc45390` (tree `f288f203`),
**before** any file was moved. The machine-readable twin is
[web-topology-before.json](web-topology-before.json), which carries every tracked path
with its Git blob SHA — exact-content identity, not name similarity.

## Shape being remediated

The App Router lives at `apps/web/app/` while every other source tier lives under
`apps/web/src/`. That split is supported by Next.js but it is **not** the accepted
final organization, and it already produced one real defect: a documentation check that
named `apps/web/src/app/` — a directory that did not exist — and therefore could never
fail (corrected in PR #161).

## Tracked inventory (92 files)

| Role                                             | Files |
| ------------------------------------------------ | ----- |
| style                                            | 21    |
| component                                        | 17    |
| test suite                                       | 13    |
| workspace config                                 | 12    |
| route (App Router — current root-level location) | 10    |
| lib                                              | 8     |
| i18n                                             | 4     |
| gate script                                      | 3     |
| config (runtime)                                 | 2     |
| e2e suite                                        | 1     |
| middleware (nonce CSP)                           | 1     |

## Exact duplicates (same blob at two paths)

**None.** No two tracked files under `apps/web` share content.

## Same-basename files (dispositioned individually — a shared name is not a duplicate)

- `page.tsx`: apps/web/app/[locale]/(dashboard)/gallery/page.tsx · apps/web/app/[locale]/(dashboard)/page.tsx · apps/web/app/page.tsx
- `layout.tsx`: apps/web/app/[locale]/(dashboard)/layout.tsx · apps/web/app/[locale]/layout.tsx · apps/web/app/layout.tsx
- `_index.scss`: apps/web/src/styles/base/_index.scss · apps/web/src/styles/mixins/_index.scss · apps/web/src/styles/print/_index.scss · apps/web/src/styles/themes/_index.scss · apps/web/src/styles/tokens/_index.scss

## Competing frontend roots across the repository

- `app/` → 0 tracked file(s)
- `src/app/` → 0 tracked file(s)
- `web/` → 0 tracked file(s)
- `frontend/` → 0 tracked file(s)
- `client/` → 0 tracked file(s)
- `apps/frontend/` → 0 tracked file(s)

## Untracked files under `apps/web` at freeze time

None.

## Move plan

One move, Git-aware, history-preserving:

1. `git mv apps/web/app apps/web/src/app`
2. `middleware.ts` moves to the source level required by the installed Next.js
   version's convention (verified against the running build, not assumed).
3. Every path-bearing configuration, gate, test and document follows in the same
   commit, each verified to still match at least one real file.

Nothing is deleted by the move itself. Deletions, if any, happen only through the
duplicate register with a recorded disposition per file.
