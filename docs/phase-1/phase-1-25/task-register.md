# P1-25 — Task register

35 tasks: 18 frontend, 5 security, 6 QA, 3 DevOps, 3 documentation.

**Status vocabulary.** `Complete` means implemented, tested and evidenced.
`Pending Owner Input and Fidelity Review` means the technical work is complete and the
remaining condition is a decision only the Product Owner can make. No task is marked
complete on the strength of an intention.

Evidence paths are relative to the repository root. `WNE` is
[workspace-normalization-evidence.md](workspace-normalization-evidence.md); `FFE` is
[frontend-foundation-evidence.md](frontend-foundation-evidence.md).

---

## Frontend — 18

| ID          | Task                                                     | Status   | Test reference                                          | Evidence |
| ----------- | -------------------------------------------------------- | -------- | ------------------------------------------------------- | -------- |
| P1-25-FE-01 | Sass token architecture and CSS custom-property emission | Complete | `apps/web/tests/stylelint-policy.test.ts`               | FFE §3   |
| P1-25-FE-02 | Tailwind as a reference layer over the tokens            | Complete | `apps/web/scripts/check-design-tokens.mjs` (59/0)       | FFE §3   |
| P1-25-FE-03 | Centralised brand configuration and `BrandMark`          | Complete | `apps/web/tests/brand-replacement.test.ts`              | FFE §11  |
| P1-25-FE-04 | Locale-aware routing, `lang`/`dir` from the server       | Complete | `apps/web/tests/i18n.test.ts`, `e2e/foundation.spec.ts` | FFE §7   |
| P1-25-FE-05 | Application shell: header, main, secondary panel, drawer | Complete | `apps/web/tests/shell.dom.test.tsx`                     | FFE §1   |
| P1-25-FE-06 | Breadcrumbs, page title, description, page actions       | Complete | `apps/web/tests/shell.dom.test.tsx`                     | FFE §1   |
| P1-25-FE-07 | Configuration-driven modular sidebar, 15 modules         | Complete | `apps/web/tests/navigation.test.ts`                     | FFE §1   |
| P1-25-FE-08 | Collapsed mode, tablet drawer, focus management          | Complete | `apps/web/tests/shell.dom.test.tsx`, `e2e`              | FFE §6   |
| P1-25-FE-09 | Server-driven data table                                 | Complete | `apps/web/tests/table-state.test.ts` (41 cases)         | FFE §5   |
| P1-25-FE-10 | Table loading, empty, no-results, error, denied          | Complete | `apps/web/tests/shell.dom.test.tsx`                     | FFE §1   |
| P1-25-FE-11 | Form control set with wired accessible relationships     | Complete | `apps/web/tests/shell.dom.test.tsx`                     | FFE §6   |
| P1-25-FE-12 | Decimal money as canonical strings                       | Complete | `apps/web/tests/money.test.ts` (37 cases)               | FFE §4   |
| P1-25-FE-13 | Overlays: dialog, alert dialog, drawer, tabs, toast      | Complete | `apps/web/tests/overlays.dom.test.tsx`                  | FFE §6   |
| P1-25-FE-14 | Three confirmation kinds including mandatory reason      | Complete | `apps/web/tests/overlays.dom.test.tsx`                  | FFE §6   |
| P1-25-FE-15 | Ten shared application states                            | Complete | `apps/web/tests/gallery-and-print.dom.test.tsx`         | FFE §1   |
| P1-25-FE-16 | Typed API client against the published contract          | Complete | `apps/web/tests/api-client.test.ts` (31 cases)          | FFE §3   |
| P1-25-FE-17 | Print foundation, A4, both directions                    | Complete | `apps/web/tests/gallery-and-print.dom.test.tsx`, `e2e`  | FFE §1   |
| P1-25-FE-18 | Internal component gallery                               | Complete | `apps/web/tests/gallery-and-print.dom.test.tsx`, `e2e`  | FFE §1   |

## Security — 5

| ID          | Task                                                                         | Status   | Test reference                                           | Evidence |
| ----------- | ---------------------------------------------------------------------------- | -------- | -------------------------------------------------------- | -------- |
| P1-25-SE-01 | Client authorisation is usability only; unknown means denied                 | Complete | `apps/web/tests/security.test.ts`, `navigation.test.ts`  | FFE §8   |
| P1-25-SE-02 | No sensitive value in a URL                                                  | Complete | `apps/web/tests/table-state.test.ts`, `security.test.ts` | FFE §5   |
| P1-25-SE-03 | No sensitive value in browser storage                                        | Complete | `apps/web/tests/security.test.ts`                        | FFE §8   |
| P1-25-SE-04 | Content Security Policy without `unsafe-eval` or wildcards                   | Complete | `apps/web/tests/security.test.ts` (16 cases)             | FFE §8   |
| P1-25-SE-05 | API/Web boundary: no direct fetch, no API or Supabase import, no unsafe HTML | Complete | `apps/web/scripts/check-api-boundary.mjs` (37/0)         | FFE §3   |

## QA — 6

| ID          | Task                                                          | Status   | Test reference                                           | Evidence |
| ----------- | ------------------------------------------------------------- | -------- | -------------------------------------------------------- | -------- |
| P1-25-QA-01 | Web unit and component test system with RTL/LTR helpers       | Complete | `apps/web/tests/render.tsx`, 231 tests                   | FFE §2   |
| P1-25-QA-02 | Automated accessibility assertions in both directions         | Complete | `axe` in overlays, shell, gallery/print suites           | FFE §6   |
| P1-25-QA-03 | Translation completeness and untranslated-copy detection      | Complete | `apps/web/tests/i18n.test.ts`                            | FFE §7   |
| P1-25-QA-04 | Playwright browser smoke across viewports and directions      | Complete | `apps/web/e2e/foundation.spec.ts`, 81 across 5 projects  | FFE §2   |
| P1-25-QA-05 | Backend and database tiers re-proven after the workspace move | Complete | 1752 backend, 1636 DB/RLS                                | WNE §5   |
| P1-25-QA-06 | Manual keyboard and print review in a real browser            | Complete | `e2e` skip link, focus trap, tab arrows, print emulation | FFE §6   |

## DevOps — 3

| ID          | Task                                                               | Status   | Test reference                                       | Evidence |
| ----------- | ------------------------------------------------------------------ | -------- | ---------------------------------------------------- | -------- |
| P1-25-DO-01 | npm workspace normalization: `apps/api` + `apps/web`, one lockfile | Complete | `tests/ci/repository-paths.test.ts`                  | WNE §1   |
| P1-25-DO-02 | API-only Docker image built from the workspace                     | Complete | local build, run, healthcheck and content assertions | WNE §4   |
| P1-25-DO-03 | Hosted CI covers both workspaces; no hidden gate                   | Complete | `tests/ci/command-coverage.test.ts`, 68/68           | WNE §2   |

## Documentation — 3

| ID          | Task                                                        | Status   | Test reference | Evidence                             |
| ----------- | ----------------------------------------------------------- | -------- | -------------- | ------------------------------------ |
| P1-25-DC-01 | Workspace-normalization evidence                            | Complete | —              | WNE                                  |
| P1-25-DC-02 | Frontend foundation evidence, including findings and limits | Complete | —              | FFE                                  |
| P1-25-DC-03 | Execution checkpoint and task register                      | Complete | —              | this file, `execution-checkpoint.md` |

---

## The one thing that is not complete

**P1-25-OWNER-01 — final visual identity and fidelity approval.**

**Status: Pending Owner Input and Fidelity Review.**

Three inputs are required and none can be supplied by the implementation:

1. the final product name, replacing `[SYSTEM NAME]`
2. the final logo asset
3. the final colour palette

Applying them touches four places and no component:

| File                                           | What changes                                                    |
| ---------------------------------------------- | --------------------------------------------------------------- |
| `apps/web/src/config/brand.ts`                 | name, short name, logo mode, asset path, `isProvisional: false` |
| `apps/web/src/styles/tokens/_colors.scss`      | the primitive ramps and, at most, the primary mapping           |
| `apps/web/src/styles/themes/_provisional.scss` | renamed and remapped to the approved theme                      |
| `apps/web/public/brand/`                       | the approved asset                                              |

`apps/web/tests/brand-replacement.test.ts` proves the claim by performing the swap and
asserting that **no component or route file changes**, then restoring the provisional
values. Hard-coded brand colours outside the token layer: **0**. Hard-coded logo
references outside `BrandMark`: **0**. Hard-coded product-name references: **0**.

P1-25 is **not** formally closed while this task is pending, and P1-26 remains blocked.

---

## Findings register

| ID            | Severity | Disposition                                                                           |
| ------------- | -------- | ------------------------------------------------------------------------------------- |
| `P1-25-F-014` | High     | Fixed — Stylelint RTL guard had an invalid option shape and was silently skipped      |
| `P1-25-F-015` | High     | Fixed — hosted CI invoked zero web commands                                           |
| `P1-25-F-016` | Medium   | Fixed — Dockerfile omitted `apps/api/package.json`, so `npm ci` would have failed     |
| `P1-25-F-017` | Low      | Fixed — RLS matrix could not classify two Supabase platform schemas                   |
| `P1-25-F-018` | Medium   | Fixed — gallery route was prerendered, freezing its runtime access flag at build time |
| `P1-25-F-019` | Low      | Fixed — gallery flag was `NEXT_PUBLIC_`-prefixed and therefore build-time inlined     |
| `P1-25-F-020` | Medium   | Fixed — API client could not distinguish a cancellation from a timeout                |
| `P1-25-F-021` | Low      | Fixed — reason-confirmation reset ran in an effect, briefly showing stale text        |
| `P1-25-F-022` | High     | Fixed — CSP without a nonce blocked Next's own bootstrap; every page rendered blank   |
| `P1-25-F-023` | Medium   | Fixed — six database-backed validators were run as static checks in a job with no DB  |
| `P1-25-F-024` | Low      | Fixed — vitest reporter flags were dropped across two `npm run` layers; no report     |
| `P1-25-F-025` | Low      | Fixed — a Playwright run report was tracked, so the clean room diffed its own output  |

Earlier findings `P1-25-F-001` … `P1-25-F-013` are recorded in
[execution-checkpoint.md](execution-checkpoint.md) and all remain resolved.

**No Critical finding was raised. No High or Medium finding remains open.**

Six of the last eight could not have been found by reading the code or by running the
suite locally. `F-018` and `F-019` needed a running server with the flag set;
`F-022` needed a real browser; `F-023` needed a machine _without_ a database;
`F-024` and `F-025` needed the hosted runner. The browser review and the clean room
are gates for that reason, not as ceremony.
