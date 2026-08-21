# ADR-013: Sass and SCSS Styling Architecture

## Status

Accepted by owner instruction.

Sass adoption is decided and implemented. This ADR also records the owner's division of styling responsibility — Tailwind for fast layout, spacing and responsive utilities; a UI component library for accessible primitives; Sass for tokens, mixins, themes, RTL/LTR helpers and complex module styling; CSS custom properties for runtime theming; SCSS variables for compile-time configuration. That division is binding **if and when** Tailwind or a component library is adopted; their adoption itself remains an Open decision recorded in ADR-002 (styling-framework selection). Tailwind and shadcn/ui are not installed in this repository — the application was scaffolded with `--no-tailwind` and nothing was removed. This ADR must not be read as adopting or rejecting Tailwind.

All colour values in the styling system are neutral defaults pending brand approval. No visual identity has been approved (OIR-06, UI prototypes, remains open).

> **Amendment (2026-08-02, pre-P1-26 API file-boundary remediation).** The Sass
> architecture this document describes now lives in **`apps/web/src/styles/`**
> only. `apps/api` held a copy from the Phase 1-1 scaffold; it styled one
> verification page, nothing imported it after P1-25 built the real Frontend, and
> a Backend workspace that renders no HTML has nothing to style. It was removed,
> so the repository now has exactly one stylesheet authority instead of two.
>
> The command names are unchanged and still gating: `npm run style:check`,
> `style:lint` and `style:fix` now resolve to the web workspace. What changed is
> which workspace holds stylesheets, not the rules or how they are enforced.
> `scripts/ci/check-api-backend-only.mjs` fails the build if a stylesheet
> reappears under `apps/api`.

## Context

RootLco (Root Link Company) is building [PRODUCT NAME — Pending Final Approval], a multi-tenant platform that must serve both right-to-left (Arabic) and left-to-right interfaces from a single stylesheet base. Benzene Vehicle Services (بنزين لخدمات المركبات), the first configured pilot tenant, operates in Arabic; nothing tenant-specific may be hard-coded, including styling.

The application stack (ADR-002) is Next.js 16.2.10, React 19.2.4 and TypeScript 5 strict. The scaffold deliberately excluded Tailwind, and the styling-framework selection was recorded as Open. Until this decision, the project had no systematic way to define design tokens, enforce directional (RTL/LTR) correctness, or share mixins and functions across stylesheets. The needs that drove this decision were:

- **Central tokens.** Typography, spacing, radii, shadows, durations, z-layers, content widths, control heights, focus-ring values and semantic colours must be defined once and consumed everywhere, with no possibility of the definition and the consumption drifting apart.
- **Mixins and functions.** Directional helpers, breakpoint helpers and accessor functions need a mechanism for reuse that plain CSS does not provide.
- **Themes.** Runtime theming requires CSS custom properties on `:root`; those properties must be generated from the token source, not maintained by hand in parallel.
- **RTL/LTR helpers.** Logical properties must be the default, with narrow, auditable escape hatches for genuinely directional cases.
- **Compile-time checks.** Token access should fail the build when a non-existent token is requested. Sass accessor functions that call `@error` on an unknown key turn a silent typo into a hard compile failure.

The chosen versions, all installed as devDependencies and committed in `package-lock.json`, are sass 1.101.0, stylelint 17.14.0 and stylelint-config-standard-scss 17.0.0.

## Decision

The project adopts Sass (SCSS syntax, dart-sass 1.101.0) as its stylesheet preprocessor, with the following binding structure and rules. All of the verification results cited below were measured on 2026-07-16.

**Architecture.** Stylesheets live under `src/styles/`:

| Layer          | Contents                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `abstracts/`   | `_tokens.scss`, `_variables.scss`, `_breakpoints.scss`, `_functions.scss`, `_mixins.scss`, `_direction.scss`, `_index.scss`. No CSS output. |
| `base/`        | `_reset.scss`, `_typography.scss`, `_accessibility.scss`, `_index.scss`.                                                                    |
| `themes/`      | `_default.scss`, `_index.scss` — generated `:root` custom properties.                                                                       |
| `utilities/`   | `_layout.scss`, `_visibility.scss`, `_index.scss`.                                                                                          |
| `globals.scss` | Composition root, imported exactly once from `src/app/layout.tsx`.                                                                          |

**Token-to-custom-property generation.** Design tokens are Sass maps in `abstracts/_tokens.scss` covering typography, spacing (a 4 px scale), radius, shadows, durations, z-layers, content widths, control heights, the focus ring, and semantic colours (background, surface, border, text, interactive, success, warning, danger, info). `themes/_default.scss` iterates those maps with `@each` loops to emit `:root` CSS custom properties. Because the custom properties are generated from the maps, the two representations cannot drift. Compile-time consumers use accessor functions that `@error` on unknown keys; runtime theming consumes the custom properties. All colour values are neutral defaults pending brand approval.

**Module system.** `@use` and `@forward` only. `@import` is banned mechanically by stylelint's `at-rule-disallowed-list`, not by convention.

**Relative-path rule.** SCSS files reference each other with relative `@use` paths. The TypeScript `@/` alias is not reliable inside Sass under Turbopack: the alias resolves the first import, but relative `@forward` statements inside the aliased target then fail to resolve. This failure was hit and fixed during implementation, and the relative-path rule exists to prevent its recurrence.

**Component styling.** SCSS Modules provide scoped component styles. The demonstration `page.module.scss` produces the scoped class `page-module-scss-module__*__card`, verified present in both the served HTML and the served CSS. Nesting is limited to a maximum depth of 2, enforced by stylelint.

**Logical properties, machine-enforced.** RTL/LTR correctness rests on logical properties first: `margin-inline`, `padding-inline`, `inset-inline`, `border-inline`, and `text-align: start`/`end`. Stylelint's `property-disallowed-list` bans `margin-left`/`right`, `padding-left`/`right`, `border-left`/`right`, `left` and `right`; its `declaration-property-value-disallowed-list` bans `left`/`right` values on `text-align`, `float` and `clear`. Two escape hatches exist: `@mixin rtl` / `@mixin ltr` (implemented with `:dir()` plus an `html[dir]` fallback) and `@mixin mirror-in-rtl` (`scaleX(-1)`), the latter reserved for directional glyphs only.

**`!important` policy.** Any use of `!important` requires a documented `stylelint-disable`. The only current uses are the reduced-motion accessibility overrides, and they are documented.

**Scripts and gating.** `style:lint`, `style:check` (with `--max-warnings 0`) and `style:fix` are npm scripts; `style:check` is wired into `npm run verify` and into the CI quality job.

**Build and runtime.** SCSS is compiled during `next build`. The sass compiler is a devDependency and is absent from the production runtime image — verified directly: `node_modules/sass` is not present in the running production container.

**Verification chain (all measured, none asserted).** stylelint passes with zero warnings; a standalone `sass` compile of `globals.scss` succeeds (3,577 bytes of CSS, 26 custom-property lines under `:root`); `next build` passes with SCSS in place; the Docker production image serves compiled CSS chunks containing `--color-background:#fff`, `--space-4:1rem`, `padding-inline-start`, `border-inline-start` and `scaleX(-1)`; and the sass compiler is absent from that image.

## Alternatives Considered

**Alternative 1 — CSS-only custom properties without a preprocessor.**

Rejected. Plain CSS custom properties provide runtime theming but nothing else on the requirements list: no mixins, no functions, no `@each` generation from a single token source, and no compile-time failure when a non-existent token is referenced — a mistyped `var(--color-sruface)` silently resolves to nothing at runtime. The token maps and the `:root` properties would have to be maintained by hand in parallel, which is exactly the drift this decision eliminates. The RTL escape-hatch mixins would have to be copied as raw selector blocks wherever needed.

**Alternative 2 — CSS-in-JS (styled-components, Emotion or similar).**

Rejected. Runtime CSS-in-JS libraries have documented friction with React Server Components, which are the default in the App Router this project uses; supporting them requires registry workarounds and client-component boundaries that this nearly empty application has no reason to take on. They also move styling into the JavaScript bundle and the render path, adding runtime cost where Sass has none, and they make the stylelint-based machine enforcement of logical properties substantially harder because styles live in template literals rather than in stylesheets.

**Alternative 3 — Tailwind-only.**

Rejected as the sole mechanism, without prejudice to later adoption. Tailwind utilities are strong for layout, spacing and responsive work — which is precisely the role the owner's division of responsibility assigns them if adopted — but a utility-only approach leaves no natural home for generated token-to-custom-property theming, `@error`-checked accessors, or the RTL mixin escape hatches. The styling-framework selection also remains an Open decision under ADR-002; adopting Tailwind as the only styling system would have pre-empted a decision the owners have deliberately kept open. Sass provides the foundation either way.

**Alternative 4 — PostCSS with a plugin set (nesting, mixins, custom-media and similar).**

Rejected. A plugin assembly can approximate individual Sass features, but each capability is a separately versioned plugin with its own maintenance and compatibility surface, and the combination lacks Sass's module system (`@use`/`@forward` with namespacing) and its `@error`-bearing functions. The project already depends on PostCSS transitively through Next.js; building the design-token layer on a hand-assembled plugin chain would trade one well-maintained compiler for several loosely coordinated ones.

## Consequences

**Positive.**

- Tokens are defined once, in Sass maps, and the `:root` custom properties are generated from them; drift between definition and theme output is structurally impossible.
- Unknown token access fails the compile via `@error` accessors instead of silently producing broken styles.
- RTL/LTR correctness is enforced by machine (stylelint) rather than by review vigilance, which matters for an Arabic-first pilot tenant.
- SCSS Modules give components scoped classes with no runtime cost, verified in served output.
- The production image carries no compiler and no styling toolchain; runtime cost of the decision is zero.

**Negative and trade-offs. These are real costs, accepted with open eyes.**

- SCSS is a second styling dialect that contributors must learn alongside CSS itself, including the module system and the map/accessor conventions specific to this repository.
- A compile step now sits between editing a stylesheet and seeing the result. Inside the dev container this is served by the webpack-based dev server with polling, with a measured hot-reload round trip of roughly six seconds; it works, but it is not free.
- If Tailwind is later adopted, there is a genuine risk of the same rule being expressed twice — once as a utility class and once in SCSS. The mitigation is already in place: the documented division of responsibility in this ADR is binding on adoption, and stylelint continues to police the SCSS side. The risk is reduced, not eliminated.
- The stylelint rule set (banned properties, banned at-rules, nesting depth, `!important` policy) is itself configuration that must be maintained and reviewed as the codebase grows.
- The relative-path rule is a workaround for a Turbopack alias limitation; it must be kept under review against future Next.js releases, and until then it imposes longer import paths in deeply nested files.

**RTL/LTR impact.** This decision makes bidirectional support a default property of every stylesheet rather than a retrofit: physical directional properties cannot pass lint, logical properties are the only unrestricted path, and the two escape hatches are explicit, named and greppable. The compiled output verified in the production image already contains `padding-inline-start`, `border-inline-start` and the `scaleX(-1)` mirror transform.

## Security Impact

- **`!important` discipline.** stylelint forbids `!important` unless accompanied by a documented `stylelint-disable`; the only current uses are the reduced-motion accessibility overrides. This keeps specificity overrides auditable rather than scattered.
- **No third-party CSS at runtime.** All styles are compiled from repository sources at build time. The application fetches no external stylesheet, font CSS or CDN asset at runtime, so there is no third-party styling origin to compromise.
- **Supply chain.** sass, stylelint and stylelint-config-standard-scss are devDependencies pinned through the committed `package-lock.json` and are absent from the production runtime image (verified). Their compromise surface is therefore the build environment, not production.
- **Known advisory, accepted risk.** `npm audit` reports two moderate findings in the Next.js dependency chain, one of which is postcss < 8.5.10 ("XSS via unescaped `</style>`") reached through next. The only offered remediation is a semver-major downgrade to next@9.3.3, which is not viable. This is recorded as an accepted risk, monitored for an upstream Next 16 patch. It is a property of the Next.js chain, not of the Sass toolchain added by this decision, but it is disclosed here because PostCSS sits in the CSS processing path.
- **No compliance claim is made.** Nothing in this ADR asserts any security certification, review sign-off or compliance status. A named independent security reviewer is not yet evidenced (P1-01-SEC-003 / P1-EC-016); Eng. Ezzaldeen Al-Bitar is the security implementation owner, which is not the same role.

## Operational Impact

- **Local development.** Host-native `npm run dev` uses Turbopack. Inside the dev container, `npm run dev:container` runs the webpack dev server with `WATCHPACK_POLLING=true` because Turbopack receives no file events across a Windows bind mount; SCSS hot reload in the container round-trips in roughly six seconds.
- **Docker.** The `deps`, `dev` and `build` stages carry sass because `npm ci` installs devDependencies there; the `runner` stage contains only the Next.js standalone output and has no sass, verified by inspecting the running production container. Image sizes are 2.11 GB (dev) and 287 MB (prod).
- **CI and verification.** `style:check` runs with `--max-warnings 0` in `npm run verify` and in the CI quality job; a stylelint warning is a failure, not a note. The full measured quality gate on 2026-07-16 — lint, typecheck, format check, style check, 22 tests, build — passes.
- **Contributor rules.** Use relative `@use` paths in SCSS (never the `@/` alias); never use `@import`; never use physical directional properties; keep nesting at depth 2 or less; add new tokens to the maps in `abstracts/_tokens.scss`, never directly to `themes/_default.scss`.
- **Open items.** Brand colours are placeholders until a visual identity is approved (OIR-06). The styling-framework selection (Tailwind or otherwise) remains Open under ADR-002. Coverage thresholds are deferred to Phase 1-2 and are unrelated to this decision.
- The two canonical Word documents reside outside this repository by owner decision (recorded in `docs/governance/canonical-documents.md`); this ADR is supporting Git documentation and is not a canonical replacement for them.

## Related Phase 1 Task and Requirement IDs

| ID            | Relationship to this ADR                                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| P1-01-DO-001  | Verify repository readiness. The `src/styles/` tree, stylelint configuration and npm scripts described here are repository artefacts.   |
| P1-01-DO-002  | Verify environment readiness. The Docker dev/prod image behaviour and container hot-reload measurements cited here were taken under it. |
| P1-01-DOC-014 | Produce the Architecture Decision Register. This ADR is a member of that register.                                                      |
| P1-01-SEC-003 | Verify security ownership or record P1-EC-016 as blocking. Unresolved; this ADR asserts no security sign-off.                           |
| P1-EC-016     | Security ownership entry criterion. Referenced above and not resolved by this ADR.                                                      |
| OIR-06        | UI prototypes open item. All colours in the token system are neutral defaults pending brand approval under this item.                   |
| ADR-002       | Application stack ADR in which styling-framework selection is recorded as Open. This ADR does not close that question.                  |
| ADR-007       | Docker-based local development. The dev/build/runner stage split that carries sass in build stages only is defined there.               |

## Decision Owner

Eng. Ezzaldeen Al-Bitar (technical and IT owner) for the technical decision recorded in this ADR: Sass adoption, the styles architecture, the token-generation pattern, the module and path rules, the stylelint enforcement set, and the build and image behaviour.

The division of styling responsibility with Tailwind and a component library is an owner instruction that binds those tools if adopted; their adoption is a separate, still-Open decision (ADR-002) subject to the joint business approval of Eng. Ezzaldeen Al-Bitar and Eng. Bilal Jradat.

## Date

2026-07-16
