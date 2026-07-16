# Styling and Sass Standard

| Field          | Value                                                |
| -------------- | ---------------------------------------------------- |
| Document       | Styling and Sass Standard                            |
| Product        | [PRODUCT NAME — Pending Final Approval]              |
| Company        | RootLco — Root Link Company                          |
| Owner          | Eng. Ezzaldeen Al-Bitar (Technical and IT owner)     |
| Classification | Confidential — Commercial Product and Pilot Planning |
| Date           | 2026-07-16                                           |
| Status         | Binding for all styling work in this repository      |

---

## 1. Purpose

This standard defines how styling is written, organised, named, and verified in this repository. It records the binding owner decision on the division of responsibility between styling technologies, the Sass architecture under `src/styles/`, the RTL/LTR rules, the accessibility styling recipes, and the machine-enforced prohibitions. Every rule in this document that is described as machine-enforced is enforced by stylelint and fails `npm run style:check` (and therefore `npm run verify` and the CI quality job) when violated. Rules that cannot yet be machine-enforced are enforced at code review.

All colours currently in the codebase are neutral defaults pending brand approval. No visual identity has been approved (OIR-06, UI prototypes, remains open). This caveat applies everywhere colours are discussed in this document.

## 2. The stack today

Installed and in use (verified versions):

- `sass` 1.101.0 (devDependency), SCSS syntax, `@use`/`@forward` only. `@import` is banned via the stylelint `at-rule-disallowed-list` rule.
- `stylelint` 17.14.0 with `stylelint-config-standard-scss` 17.0.0.
- SCSS Modules for component styling (Next.js built-in support; `next` 16.2.10).
- CSS custom properties generated from Sass token maps (see Section 4 and Section 15).

Not installed:

- Tailwind CSS and shadcn/ui are **not installed** in this repository. The project was scaffolded with `--no-tailwind`, and ADR-002 records the styling-framework selection as **Open**. Nothing was removed; they were never present. Do not assume utility classes or shadcn components exist.
- The division of responsibility in Section 3 is a binding owner decision **if and when** Tailwind and/or a component library is adopted. Their adoption remains an open decision; this document does not pre-empt ADR-002.

The Sass compiler is a build-time tool only. It is verified absent from the production runtime image (`node_modules/sass` is not present in `rootlco/web:prod`).

## 3. Division of responsibility (binding if the optional layers are adopted)

| Layer                                 | Status                                 | Responsibility                                                                                                                                       |
| ------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tailwind CSS                          | Not installed; adoption Open (ADR-002) | Fast layout, spacing, and responsive utilities in markup — **if adopted**                                                                            |
| UI component library (e.g. shadcn/ui) | Not installed; adoption Open (ADR-002) | Accessible interactive primitives (dialogs, menus, form controls) — **if adopted**                                                                   |
| Sass / SCSS                           | Installed, binding                     | Design tokens, variables, mixins, functions, themes, RTL/LTR helpers, and complex component styling via SCSS Modules                                 |
| CSS custom properties                 | Installed, binding                     | Runtime theming and dynamic values — anything that may change after the CSS is compiled (theme switching, user preference, per-tenant configuration) |
| SCSS variables and maps               | Installed, binding                     | Compile-time configuration — breakpoints, token source maps, values that never change at runtime                                                     |

The dividing principle: if a value must be able to change in the browser without recompiling, it is a CSS custom property; if it is fixed at build time, it is an SCSS variable or map entry. Tokens live in Sass maps and are emitted as custom properties so both worlds share one source (Section 15 explains how drift is prevented).

## 4. Architecture map of `src/styles/`

```
src/styles/
├── abstracts/
│   ├── _tokens.scss       Sass maps that are the single source of all design tokens
│   ├── _variables.scss    Compile-time SCSS variables derived from or alongside the token maps
│   ├── _breakpoints.scss  Breakpoints map and the up()/media mixin machinery
│   ├── _functions.scss    Pure Sass functions (token lookup, unit helpers)
│   ├── _mixins.scss       Shared mixins (focus ring, visually-hidden, and other recipes)
│   ├── _direction.scss    RTL/LTR escape-hatch mixins: rtl, ltr, mirror-in-rtl
│   └── _index.scss        @forward hub for the abstracts folder
├── base/
│   ├── _reset.scss        Element reset/normalisation
│   ├── _typography.scss   Base type rules driven by typography tokens
│   ├── _accessibility.scss Reduced-motion global override and related a11y styles
│   └── _index.scss        @forward hub for the base folder
├── themes/
│   ├── _default.scss      @each loops that emit the token maps as :root custom properties
│   └── _index.scss        @forward hub for the themes folder
├── utilities/
│   ├── _layout.scss       u-* layout utility classes
│   ├── _visibility.scss   u-* visibility utility classes (including visually-hidden)
│   └── _index.scss        @forward hub for the utilities folder
└── globals.scss           The only global entry point; composes the folders above
```

`globals.scss` is imported exactly once, from `src/app/layout.tsx`. No other file may import a global stylesheet. Component styles live next to their components as `*.module.scss` files and `@use` the abstracts they need via relative paths (Section 15).

Emitting nothing is the rule for `abstracts/`: those partials contain only maps, variables, functions, and mixins, so any file may `@use` them without duplicating CSS output. `base/`, `themes/`, and `utilities/` emit CSS and are composed only by `globals.scss`.

## 5. Decision guide: when to use what

| Need                                                                          | Use                                                                                      |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Quick layout/spacing/responsive tweak in markup                               | Tailwind utility — **only if adopted**; today, use an SCSS Module rule built from tokens |
| Component-specific styling of any complexity                                  | SCSS Module (`ComponentName.module.scss`) using tokens and mixins                        |
| Element defaults, resets, typography, utilities shared app-wide               | Global SCSS under `src/styles/` (via `globals.scss`)                                     |
| A value that must change at runtime (theme, preference, tenant configuration) | CSS custom property, defined in a theme partial                                          |

Worked examples:

1. **A card with padding, radius, and elevation.** This is component styling: create `Card.module.scss`, use `padding-inline: var(--space-4)`, `border-radius: var(--radius-*)`, and `box-shadow: var(--shadow-*)`. Do not add global classes and do not hard-code pixel values.
2. **Making a two-column section stack on small screens.** Today: in the component's SCSS Module, write the mobile-first single-column rule and add the two-column rule inside `@include up(md)` (Section 11). If Tailwind is adopted, this is exactly the kind of fast responsive layout the utility layer takes over.
3. **A surface colour that must respond to a future dark theme.** Never write `background: #fff` in a component. Write `background: var(--color-surface)`; the value is assigned in `themes/_default.scss` and a future sibling theme partial reassigns it at runtime (Section 14). The component needs no change when the theme lands.

## 6. Token naming

Tokens are named by category first, kebab-case, as CSS custom properties emitted under `:root`:

| Family               | Pattern        | Example                                                                                          |
| -------------------- | -------------- | ------------------------------------------------------------------------------------------------ |
| Semantic colours     | `--color-*`    | `--color-background`, `--color-surface`, `--color-text`, `--color-interactive`, `--color-danger` |
| Spacing (4 px scale) | `--space-N`    | `--space-4` (equals `1rem`)                                                                      |
| Corner radius        | `--radius-*`   | `--radius-sm`                                                                                    |
| Shadows / elevation  | `--shadow-*`   | `--shadow-md`                                                                                    |
| Motion durations     | `--duration-*` | `--duration-fast`                                                                                |
| Content widths       | `--content-*`  | `--content-narrow`                                                                               |
| Control heights      | `--control-*`  | `--control-md`                                                                                   |

Typography, z-layer, and focus-ring tokens follow the same category-first kebab-case convention from the same source maps. Semantic colour tokens cover background, surface, border, text, interactive, success, warning, danger, and info roles. All colour values are neutral defaults pending brand approval (OIR-06); do not treat any current colour as final and do not invent brand colours.

New tokens are added to the maps in `abstracts/_tokens.scss` only. Never hand-write a custom property in `themes/_default.scss`; the `@each` loops generate them (Section 15 of the architecture rationale: maps and emitted properties cannot drift because one generates the other).

## 7. File naming

- Sass partials: leading underscore, kebab-case — `_tokens.scss`, `_breakpoints.scss`.
- Every styles folder exposes exactly one `_index.scss` containing only `@forward` statements; consumers `@use` the folder, not individual partials, unless they need a single abstract.
- Component styles: `ComponentName.module.scss`, colocated with `ComponentName.tsx`.
- The single global entry point is `globals.scss` (no underscore; it is compiled, not forwarded).

## 8. Selector naming

- **SCSS Modules:** class names are camelCase (`.cardHeader`, `.primaryAction`), so they map cleanly to `styles.cardHeader` in TypeScript without bracket access. Enforced by a stylelint `selector-class-pattern` regex scoped to module files.
- **Global utilities:** `u-` prefix, kebab-case (`.u-visually-hidden`, `.u-stack`). Enforced by regex in the utilities layer.
- No other global class conventions exist; anything that is not a utility or a base element style belongs in a module.

## 9. Nesting limit

Maximum nesting depth is **2**, machine-enforced by stylelint (`max-nesting-depth`). Deep nesting produces high-specificity selectors that are hard to override, couples styles to DOM structure, and makes RTL and theme overrides brittle. Two levels are enough for a state or a direct child; anything deeper indicates the rule should be a separate class.

## 10. RTL/LTR rules

The product must work in both right-to-left and left-to-right layouts. The rules, in order:

1. **Logical properties first.** Use `margin-inline`/`margin-inline-start`/`-end`, `padding-inline`, `inset-inline`, `border-inline`, and `text-align: start`/`end`. The following physical properties are **banned** and machine-enforced by the stylelint `property-disallowed-list`: `margin-left`, `margin-right`, `padding-left`, `padding-right`, `border-left`, `border-right`, `left`, `right`. The values `left` and `right` for `text-align`, `float`, and `clear` are banned by `declaration-property-value-disallowed-list`.
2. **Escape hatch for genuinely asymmetric cases:** the `@mixin rtl` and `@mixin ltr` mixins in `abstracts/_direction.scss`, which emit `:dir()` selectors with an `html[dir]` attribute fallback. Use them only when a logical property cannot express the requirement, and comment why.
3. **Directional glyphs only:** `@mixin mirror-in-rtl` applies `transform: scaleX(-1)` to icons whose meaning is directional (arrows, chevrons, "back" glyphs). It is for glyphs exclusively.
4. **Never mirror** text, logos, numerals, clocks, media-player timelines, or anything whose meaning does not flip with reading direction.

## 11. Responsive conventions

- **Mobile-first.** Base rules target the smallest viewport; enhancements are added at larger widths.
- Breakpoints live in a single Sass map in `abstracts/_breakpoints.scss`. No raw `@media (min-width: …)` values in components.
- Use the mixin: `@include up(md) { … }` wraps the content in the corresponding min-width media query. Down/between variants, if ever needed, are added to `_breakpoints.scss`, never inlined.

## 12. Accessibility styling

- **One focus-ring recipe.** A single mixin in `abstracts/_mixins.scss` applies the focus ring using the focus-ring tokens. Components include the mixin; they never craft their own `outline`/`box-shadow` focus styles. This keeps focus indication consistent and centrally tunable.
- **Visually hidden.** The visually-hidden mixin (also exposed as the `u-visually-hidden` utility) hides content visually while keeping it available to assistive technology. Use it for screen-reader-only labels; never use `display: none` for content that must remain accessible.
- **Reduced motion.** `base/_accessibility.scss` contains a global `prefers-reduced-motion: reduce` override that collapses animations and transitions. This override is the **only sanctioned use of `!important`** in the codebase, and it carries the documented `stylelint-disable` comment required by Section 15's `!important` rule.

## 13. Theming and dark-mode readiness

- `themes/_default.scss` is the only place token values are bound to custom properties today. A future theme (for example a dark theme) is added as a **sibling partial** in `themes/` that reassigns the same custom properties under its own selector; no component changes are required.
- Components **never hard-code colours**. Every colour reference is `var(--color-…)`. This is what makes runtime theming possible and is also why the neutral-defaults caveat is low-risk: when brand colours are approved (OIR-06), they are changed in one token map.
- Compile-time SCSS variables must not carry colour semantics that a theme would need to change; anything themable goes through custom properties.

## 14. Prohibited practices

The following are prohibited. Items marked (M) are machine-enforced by stylelint today; the rest are enforced at review.

1. (M) Sass `@import` — use `@use`/`@forward` (`at-rule-disallowed-list`).
2. (M) Physical direction properties and values listed in Section 10 (`property-disallowed-list`, `declaration-property-value-disallowed-list`).
3. (M) `!important` without a documented `stylelint-disable` comment explaining why. The only sanctioned instance is the reduced-motion override (Section 12).
4. Hard-coding repeated spacing, colour, radius, or timing values instead of using tokens.
5. (M) Nesting deeper than 2 levels (`max-nesting-depth`).
6. Global styles for components — component styling belongs in SCSS Modules.
7. Business-module or feature-specific styles placed in the shared `src/styles/` tree.
8. Inventing brand colours or visual identity. No visual identity is approved; all colours are neutral defaults pending brand approval (OIR-06).

## 15. Relative `@use` path rule (Turbopack)

SCSS files must use **relative** `@use`/`@forward` paths (for example `@use "../../styles/abstracts" as *;`). The TypeScript `"@/"` alias is **not reliable inside Sass under Turbopack**: the alias resolves the first import, but relative `@forward` statements inside the target partial then fail to resolve. This failure mode was hit and fixed during the Sass foundation work in this repository; the relative-path rule is the fix. Do not reintroduce alias paths in SCSS even if a single-file test appears to work.

Related build note: the container dev server runs webpack (`npm run dev:container`) with polling because Turbopack receives no file events across a Windows bind mount; host-native `npm run dev` keeps Turbopack. This does not change the path rule, which applies under both bundlers.

## 16. Verification

| Command               | Purpose                                            |
| --------------------- | -------------------------------------------------- |
| `npm run style:lint`  | Run stylelint across the SCSS sources              |
| `npm run style:check` | stylelint with `--max-warnings 0`; the gating form |
| `npm run style:fix`   | Apply stylelint autofixes                          |

`style:check` is wired into `npm run verify` and into the CI quality job, so a styling violation fails the same gate as lint, typecheck, format, and tests. Current status (measured 2026-07-16): `style:check` passes with zero problems; a standalone `sass` compile of `globals.scss` passes; `next build` passes with SCSS; and the production Docker image serves compiled CSS containing the generated custom properties and logical properties, with the Sass compiler absent from the runtime image.
