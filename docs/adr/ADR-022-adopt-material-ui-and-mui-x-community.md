# ADR-022: Adopt Material UI and MUI X (Community, MIT) — supersedes ADR-020

## Status

Accepted by owner instruction — for adopting Material UI and the MIT-licensed (Community) editions
of MUI X as the web application's component layer, by the Owner directive of 2026-09-25, which
directs the product to standardise its implemented screens on Material UI and MUI X (data grid,
date and time pickers, charts, and the tree view where the data is genuinely hierarchical) under one
product design system, on the official Next.js App Router integration, with right-to-left Arabic
supported at the document, the theme and the style cache.

Proposed — for the implementation particulars recorded below (the cascade-layer order, the theme
mapping, the locale and date approach, the gate changes and the migration order). They are
introduced by the pull request that adds this record and carry no authority beyond that review.

Open — for MUI X Scheduler, deferred while it is a beta release; and for any commercial (Pro or
Premium) MUI X feature, none of which is licensed or approved.

**Supersedes [ADR-020](./ADR-020-frontend-styling-framework-and-component-primitives.md).**
ADR-020 rejected Material UI because its visual identity would compete with the token layer while
the brand (OIR-06) was unknown. OIR-06 has since been resolved (green `#1F6B52`, navy `#0F2742`),
and the Owner directive of 2026-09-25 reverses the component-library decision. ADR-020's other
binding rules are carried forward below, restated rather than inherited, so this record alone
states the styling architecture. ADR-013's Sass architecture and ADR-021's scroll and notification
contracts are unchanged.

## Context

At develop `6c8c877e` the web application (`apps/web`, Next.js 16.3.3, React 19.2.8, TypeScript 5.9)
styles itself with Sass tokens emitted as CSS custom properties (ADR-013), Tailwind CSS 3.4.19
holding only `var(--…)` references (ADR-020), and vendored primitives. It has no component library,
no date library and no chart library: about 5,189 `className=` uses in 202 files, a hand-written
data table (`components/data-table`), 52 native date and time inputs, and three hand-drawn SVG
charts.

The Owner directive of 2026-09-25 asks for one component system across the implemented routes. The
constraints this record must satisfy are the repository's own:

| Constraint                          | Where it is enforced                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| One source for every design value   | `validate:web-tokens`, `validate:web-theme`, `validate:web-topology`                        |
| Right-to-left Arabic, logical props | Stylelint (`.scss` only, ADR-013)                                                           |
| Latin digits in Arabic              | `lib/format.ts` (`ar-JO-u-nu-latn`)                                                         |
| No invented total on a list         | P1-26-F-001; the list contract is `{ items, nextCursor, hasMore }`                          |
| No unauthorized export surface      | P1-27 frontend gate rule 7                                                                  |
| One notification authority          | ADR-021, `validate:notification-authority`                                                  |
| Nonce content security policy       | `src/lib/security/csp.ts`: `script-src` carries a nonce, `style-src 'self' 'unsafe-inline'` |
| Dependencies audit clean            | the web dependency audit blocks on any severity, in the production and the full tree        |

## Decision

### 1. Packages, pinned exactly

| Package                                                    | Version                     | Licence (npm) | Role                                     |
| ---------------------------------------------------------- | --------------------------- | ------------- | ---------------------------------------- |
| `@mui/material`, `@mui/system`                             | 9.4.0                       | MIT           | Components and styling engine            |
| `@mui/material-nextjs`                                     | 9.4.0                       | MIT           | App Router cache (`v16-appRouter`)       |
| `@emotion/react` / `@emotion/styled` / `@emotion/cache`    | 11.14.0 / 11.14.1 / 11.14.0 | MIT           | Style engine                             |
| `stylis` (pinned to the version `@emotion/cache` resolves) | 4.2.0                       | MIT           | Vendor prefixing plugin                  |
| `@mui/stylis-plugin-rtl`                                   | 9.4.0                       | MIT           | Right-to-left flipping of Material's CSS |
| `@mui/x-data-grid`                                         | 9.14.0                      | MIT           | Data grid                                |
| `@mui/x-date-pickers`                                      | 9.14.0                      | MIT           | Date and time pickers                    |
| `@mui/x-charts`                                            | 9.14.0                      | MIT           | Charts                                   |
| `@mui/x-tree-view`                                         | 9.14.0                      | MIT           | Tree view                                |
| `dayjs`                                                    | 1.11.23                     | MIT           | Date adapter                             |
| `@types/stylis` (development only)                         | 4.2.7                       | MIT           | Types for the `stylis` import            |

Not installed: `@mui/icons-material` (the product has its own icon set), `@mui/lab`,
`@emotion/server`, any `-pro` or `-premium` package, `@mui/x-license`, `@mui/x-scheduler`,
`@mui/x-chat`. No licence key exists in the repository or its environment templates.

### 2. MIT scope — feature, licence, decision

| Feature                                                                                                  | Package                    | Licence    | Decision                                                 |
| -------------------------------------------------------------------------------------------------------- | -------------------------- | ---------- | -------------------------------------------------------- |
| Grid: columns, single sort and filter, server pagination with unknown count, density, editing, selection | `@mui/x-data-grid`         | MIT        | Use                                                      |
| Grid: CSV export, print, clipboard copy                                                                  | `@mui/x-data-grid`         | MIT        | Refused — an export surface nobody authorized            |
| Grid: pinning, reordering, tree data, detail panels, lazy loading, multi-sort                            | `@mui/x-data-grid-pro`     | Commercial | Not used                                                 |
| Grid: grouping, aggregation, pivoting, Excel export                                                      | `@mui/x-data-grid-premium` | Commercial | Not used                                                 |
| Date, time and date-time pickers, fields, calendars                                                      | `@mui/x-date-pickers`      | MIT        | Use                                                      |
| Date and time RANGE pickers                                                                              | `@mui/x-date-pickers-pro`  | Commercial | Not used — two MIT pickers with validation instead       |
| Bar, line, pie, scatter, sparkline, gauge, radar                                                         | `@mui/x-charts`            | MIT        | Use, always with a table alternative                     |
| Heatmap, funnel, Sankey, chart export                                                                    | `@mui/x-charts-pro`        | Commercial | Not used                                                 |
| Simple and rich tree view                                                                                | `@mui/x-tree-view`         | MIT        | Use only for genuine hierarchy                           |
| Tree drag-and-drop, lazy loading, virtualisation                                                         | `@mui/x-tree-view-pro`     | Commercial | Not used                                                 |
| Scheduler (9.0.0-beta)                                                                                   | `@mui/x-scheduler`         | MIT        | Deferred while beta; appointment windows use pickers     |
| Chat (9.0.0-alpha)                                                                                       | `@mui/x-chat`              | MIT        | Excluded — alpha, and the API has no conversation module |

### 3. Carried forward from ADR-020

1. **Sass is the token authority.** Every design value is defined once in
   `apps/web/src/styles/tokens/**` and emitted as a CSS custom property.
2. **Nothing else holds a value.** The Tailwind theme and the Material theme both hold
   `var(--…)` references. The few numbers Material needs as JavaScript (breakpoints, the radius
   base, z-index layers, transition timeouts, row heights, the chart height) are read from
   `src/styles/tokens/generated/tokens.ts`, GENERATED from the Sass maps by
   `apps/web/scripts/generate-design-tokens.mjs` and drift-checked by `validate:web-tokens`
   and `apps/web/tests/design-tokens-generated.test.ts`. It emits no colours: a colour read in
   JavaScript is a fixed value a `[data-theme]` remap cannot reach.
3. **Tailwind stays**, for layout and composition. It coexists with Material for the whole
   migration and afterwards; a colour utility must still be registered in `tailwind.config.ts`.
4. **The vendored primitives stay** until each screen is migrated; nothing is removed by this
   record.
5. **No other utility framework, installed component library or icon library** is introduced.

### 4. The provider

`apps/web/src/components/ui-foundation/UiFoundationProvider.tsx` is the one client component the
foundation adds. The locale layout (`src/app/[locale]/layout.tsx`) stays a Server Component and
passes it only the locale and the `mui.*` catalogue entries:

```
<html lang dir data-theme>            (unchanged: the one direction authority)
  <body>
    skip link
    UiFoundationProvider              ('use client')
      AppRouterCacheProvider          (v16-appRouter; key mui | muirtl; enableCssLayer)
        ThemeProvider                 (createRootTheme(locale): direction, palette, layers)
          LocalizationProvider        (AdapterDayjs; en-gb | ar-jo-latn)
            {children}
    NotificationHost                  (unchanged: the single notification authority, ADR-021)
```

No `CssBaseline` (the product has its own reset) and no Material Snackbar or Alert used as a toast.

### 5. Theme

`components/ui-foundation/theme.ts`: palette, typography, spacing and radii are `var(--…)`
references to the Sass tokens (`primary` is `var(--color-primary)`, the approved green; `secondary`
the navy ramp; error, warning, info and success the semantic tokens; text, background, divider and
action states their tokens). `cssVariables.nativeColor` makes Material derive hover, focus and
disabled shades with CSS `color-mix()` and relative colours rather than by parsing a colour in
JavaScript, which cannot read a custom property. Spacing is `var(--space-2)` (Material's 8px step);
typography variants map to the product's type roles with `textTransform: none` on buttons; the
focus ring (`Mui-focusVisible`) is drawn from the same tokens as `_focus.scss`; Material's z-index
layers map onto the product's single scale; the data grid defaults to the product's page sizes
(`PAGE_SIZES`) and the table row heights.

**Spike 1 — a custom-property palette with MUI X.** Result: supported. Material, the data grid,
the date picker, the bar chart and the tree view render on the `var(--…)` palette in both
directions without Material's "unsupported colour" error, and the palette reaches the emitted CSS
as references (`--mui-palette-primary-main: var(--color-primary)`).
`apps/web/tests/ui-foundation.dom.test.tsx` and `ui-foundation-ssr.test.ts` keep that proof. The
concrete-value fallback (reading colours from the generated module) was therefore not needed, and
the generated module no longer emits colours at all.
Limit of the evidence: jsdom and the server renderer prove that Material's JavaScript accepts the
palette; that browsers resolve `color-mix()` and `oklch(from var(--…) …)` is a real-browser check,
and relative colour syntax needs Chrome 119, Firefox 128 or Safari 18 and later.

### 6. CSS layers and Tailwind coexistence

Tailwind 3 emits unlayered CSS, and unlayered CSS beats every layer. The order is therefore:

1. `@layer rootlco-reset` — the element-level rules: the vendored Tailwind preflight
   (`styles/base/_preflight.scss`, Tailwind's own preflight is disabled with
   `corePlugins.preflight: false`), the `*`/`html`/`body` rules of `_reset.scss` and the global focus
   ring.
2. `@layer mui` — every Material rule (`enableCssLayer` on the cache; the theme's
   `modularCssLayers` splits it into `mui.global`, `mui.components`, `mui.theme`, `mui.custom`,
   `mui.sx`).
3. Unlayered — Tailwind components and utilities, SCSS modules, the print sheet. They win over
   Material, so a layout utility on a wrapper is never silently overridden.

`styles/_layers.scss` declares `@layer rootlco-reset, mui;` and is the first `@use` of
`globals.scss`, so it is the first statement of the compiled stylesheet (Sass allows nothing before
`@use`); the theme declares the same order, so whichever stylesheet the browser sees first, the
order is the same.

**Spike 2 — layer order in the server-rendered head, and no regression from removing preflight.**
Results:

- The server render (`react-dom/server` with Next's server-inserted-HTML hook) streams the order
  statement as the FIRST style block, then only layered Material rules, from the `mui` cache in
  English and the `muirtl` cache in Arabic (`apps/web/tests/ui-foundation-ssr.test.ts`).
- The application stylesheet was compiled through Sass, Tailwind and Autoprefixer before and after
  the change and compared declaration by declaration. Every preflight declaration is still present,
  now in `rootlco-reset`, in its original order relative to the reset. Four differences, all
  deliberate: the default border colour is `var(--color-border)` instead of Tailwind's gray-200 (a
  near-identical neutral; raw colours may not live outside the token layer); the default placeholder
  colour is `var(--color-text-muted)` instead of gray-400 (every text control already sets that
  colour itself); `appearance` is written unprefixed with Autoprefixer adding the prefixes, and
  `button` is spelled `auto` (CSS UI 4 defines `button` as a compatibility keyword behaving as
  `auto`); `-webkit-text-size-adjust` is set once, by `_reset.scss`. The document-scroll rules of
  `_reset.scss` stay unlayered because no Material rule competes with them and the print sheet's
  override of them must keep working.
- Not proven here: the computed appearance in a real browser. jsdom does not parse `@layer`
  (its report for Material's layered sheets is dropped by `tests/support/jsdom-layer-filter.ts`:
  a `css parsing` error, jsdom's exact message, and a sheet that begins `@layer mui`; every other
  report still reaches the console, which `tests/ui-foundation.dom.test.tsx` proves).
  Browser review of buttons and inputs on existing screens is owed before the first screen moves.

### 7. Right-to-left and locale

- `<html dir>` remains the single authority. The theme's `direction` follows the locale, and the
  Emotion cache differs by direction (`mui` / `muirtl`) with `@mui/stylis-plugin-rtl` flipping
  Material's physical properties. Portals mount on `<body>` and inherit `dir`.
- Style objects use logical properties only; `validate:web-tokens` now refuses physical ones in
  `sx`, `styled()` and theme objects (below). `stylis-plugin-rtl` would otherwise "fix" a physical
  property silently and hide the ADR-013 violation.
- Component texts come from the product catalogues (`mui.*` keys in
  `apps/web/src/i18n/messages/{en,ar}.json`), built by `muiLocaleText` on top of the upstream base
  (`arSD` or `enUS`). Measured: the grid's Arabic covers 126 of 226 texts, and the pickers and the
  charts ship no Arabic at all; every Community gap is filled from the catalogue, under the same
  parity and plain-language rules as every other string. Texts only a commercial feature renders
  are not provided.
- Dates: `AdapterDayjs` with the `utc` and `timezone` plugins, so a picker deciding a business day
  can be given the branch's time zone (as `lib/branch-time.ts` does). English uses dayjs `en-gb`,
  which is `en-GB`; Arabic uses a repository-owned `ar-jo-latn` locale whose month and weekday names
  are read from `Intl.DateTimeFormat('ar-JO-u-nu-latn')` — the product's date formatter — with no
  digit post-formatting, so Arabic dates keep Latin digits.
- Charts do not mirror themselves: a chart reverses its category axis and moves its value axis in
  right-to-left, and always carries a table alternative.

### 8. Content security policy

No change. `style-src 'self' 'unsafe-inline'` already admits Emotion's server `<style>` blocks, its
runtime insertion and Material's `style=""` attributes. A nonce is NOT added to `style-src`: under
CSP 3 a nonce makes the browser ignore `'unsafe-inline'`, which would break every inline `style`
attribute the grid and the popper positioning use. `InitColorSchemeScript` is not used while there
is one light scheme.

### 9. No derived total, no export surface

The grid is always server-paginated with an unknown count (`rowCount={-1}`, `hasNextPage` from the
cursor page). The theme's default pagination label never reads the derived `count` (nor the upper
bound `to`, which the grid passes as `(page + 1) × pageSize` when the count is unknown); a grid that
knows its page labels it "Page N". The default toolbar, which carries CSV export and print, is not
used. A component-level `localeText` REPLACES the theme's texts rather than merging, so a grid that
sets one spreads the theme's first (the gallery shows how).

### 10. Gates

| Gate                    | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Negative tests                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `validate:web-tokens`   | Reads style objects (`sx`, `css`, `styled()`, `createTheme()`, `styleOverrides`, `GlobalStyles`) on the TypeScript syntax tree: raw lengths and durations in strings, raw pixel and millisecond numbers, and physical properties and values are refused; an unparseable file is a finding. A style object passed by reference (`sx={cardSx}`, `styles.card`, a spread) is followed to its same-file `const`; one it cannot follow is a finding outside the shared wrapper paths. Also runs the generated-token drift check | `apps/web/tests/design-token-style-objects.test.ts`              |
| `validate:web-theme`    | Parses the source: every string is scanned except inside a style object (the design-token gate's definition, plus `style`), so `boxSizing: 'border-box'` is a CSS value while `className="border-box"` is still a finding. No exclusion list was widened                                                                                                                                                                                                                                                                   | `tests/ci/tailwind-theme-gate.test.ts`, and the gate's self-test |
| `validate:web-boundary` | MIT editions only; no grid export or print name; no default toolbar; a grid's `rowCount` must be `-1`, a server-paginated grid must declare it, and `estimatedRowCount` is refused; outside `components/data/OperationalGrid*`, a grid rendered through a spread, `createElement`, an alias, a re-export or a dynamic import is refused                                                                                                                                                                                    | `apps/web/tests/api-boundary-gate.test.ts`                       |
| Generated tokens        | Committed, like `src/lib/api/idempotent-operations.ts`; drift between the Sass maps and `tokens/generated/tokens.ts` fails `validate:web-tokens` and the web test tier. The module carries no colours                                                                                                                                                                                                                                                                                                                      | `apps/web/tests/design-tokens-generated.test.ts`                 |

The P1-27 frontend gate's `MODULE_DISPOSITION` is unchanged: it records the modules a scanned
tree imports, and no scanned tree imports `components/ui-foundation` yet (an entry would fail as
stale). The pull request that first imports it from a scanned tree records its disposition.

### 11. Migration order

Each step is its own pull request, tests first, then Arabic and English browser review.

- **PR0 — foundation (this record):** dependencies, provider, theme, layers, generated tokens,
  locale texts, gates, and a Material section in the design gallery. No operational screen changes.
- **PR1 — shared wrappers:** an operational grid on the data grid (cursor pages, overlays mapped to
  the product's states, no export), an entity picker on Autocomplete, form fields driven by the
  existing field-error contract, the branch selector, dialogs and drawers, a filter toolbar with two
  MIT pickers for a period, state components, a chart panel with its table alternative, date and
  date-time fields.
- **PR2 — cancellable reads** for the hot list and search families (Server Actions run one at a
  time and cannot be aborted).
- **PR3 — reception; PR4 — work orders; PR5 — dashboard**, then the remaining routes; the tree view
  for organisation structure; the Scheduler only when it is stable.

## Alternatives Considered

**Keep ADR-020 (Tailwind with vendored primitives only).** Rejected by the Owner directive: it
leaves the grid, pickers and charts hand-built, which is where the operational defects have
concentrated.

**Material UI with Tailwind's `important` selector and `injectFirst`** (Material's own advice for
Tailwind 3). Rejected: `important` would outrank the SCSS modules as well, and injection order under
App Router streaming is not guaranteed. Cascade layers give a stated order instead.

**Migrate to Tailwind 4 first**, whose native layers match Material's recipe. Rejected for now: a
separate project, and `validate:web-theme` parses the Tailwind 3 configuration.

**Concrete palette values instead of `var(--…)`.** Not needed (spike 1). It remains the fallback if
a browser defect appears, read from the generated module rather than typed in.

**`date-fns` or Luxon.** `date-fns` does not support time zones in the pickers; Luxon would add a
second date vocabulary beside `Intl`. dayjs is small and has the time-zone plugin.

**Commercial MUI X editions.** Not licensed. Where a commercial feature would help (range pickers,
pinning) the Community composition is used instead.

## Consequences

- The web client bundle grows (Material, Emotion, the grid, pickers and charts). Next's default
  `optimizePackageImports` already covers `@mui/material`. The hosted build-size report measures the
  change; a re-baseline, if needed, comes from a hosted run, never from a local build.
- Eighty-two packages enter the dependency tree (81 with the runtime dependencies, one for the
  `stylis` types). The web dependency audit reported no advisory in the production or the full
  tree when they were added.
- Tests that query the product's own table, dialog and field markup will move to the grid's ARIA
  roles as screens migrate; the web test-count floor still holds.
- Reduced motion: Material's transition timeouts are JavaScript numbers from the generated tokens,
  so the Sass rule that collapses `--duration-*` to zero does not reach them. The PR1 wrappers owe
  that behaviour.
- CONTRIBUTING.md and `docs/standards/styling-and-sass.md` still describe ADR-020's position; they
  are brought in line by a documentation change.

## Security Impact

- No change to the content security policy (decision 8).
- No licence key, no commercial package, and no network call is added; the gate refuses a
  commercial or excluded MUI X import.
- The grid's CSV export and print — both able to move data out of the product without an audited
  export operation — are refused by `validate:web-boundary`.
- The new dependencies are covered by the existing web dependency audit, which blocks on any
  severity.

## Operational Impact

- No runtime configuration, environment variable, route, operation, permission or migration is
  added.
- `node scripts/generate-design-tokens.mjs` (from `apps/web`) regenerates the token module after a
  Sass token changes; the web test tier fails until it is run.
- The design gallery (development only, `galleryEnabled`) carries a Material section in both
  directions as the visual reference for the migration.

## Related Phase 1 Task and Requirement IDs

Owner directive of 2026-09-25 (Material UI and MUI X standardisation); P1-32 preparatory work;
ADR-002, ADR-013, ADR-020 (superseded), ADR-021; P1-26-F-001 (no invented total); P1-27 frontend
gate rule 7 (export surface); P1-25-F-022 (nonce policy and prerendering); OIR-06 (brand, resolved).

Identifiers prefixed `OIR-` and `P1-` are defined in the canonical Word documents, which live outside
this repository by owner decision — see
[../governance/canonical-documents.md](../governance/canonical-documents.md).

## Decision Owner

Eng. Ezzaldeen Al-Bitar (technical and IT owner) — the adoption, by the Owner directive of
2026-09-25. The implementation particulars are Proposed and are reviewed in the pull request that
adds this record, under the
[Solo Developer Review Policy](../governance/solo-developer-review-policy.md); that is owner-authorized
technical self-review and is never an independent third-party audit.

## Date

2026-09-25
