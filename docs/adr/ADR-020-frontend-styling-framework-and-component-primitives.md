# ADR-020: Frontend Styling Framework and Component Primitives

## Status

**Accepted** — 2026-08-01, by Product Owner instruction at the start of Phase 1-25.

This ADR is the **companion ADR that ADR-002 required**. ADR-002 recorded the
styling-framework selection as **Open** and stated its own resolution condition:

> The risk is that the deferral is forgotten; the mitigation is that it is recorded here as
> Open and **must be resolved by a superseding or companion ADR before frontend
> implementation begins**.

ADR-002 deferred the decision specifically to "the frontend phases (Phase 1-25 onward),
where the first real interface requirements — multi-tenant theming, right-to-left support
for Arabic, per-tenant branding driven by configuration rather than by code — will exist
and can be used as evaluation criteria."

This is Phase 1-25. Those requirements now exist. This ADR discharges that obligation and
supersedes the Open status of the styling-framework decision in ADR-002. It does **not**
supersede any other part of ADR-002.

It also discharges the conditional clause in **ADR-013**, which recorded the owner's
division of styling responsibility and stated that the division is "binding **if and when**
Tailwind or a component library is adopted; their adoption itself remains an Open decision
recorded in ADR-002." Adoption is decided here; ADR-013's division therefore becomes
binding, unchanged.

## Context

The repository at the P1-25 baseline (`cef7fdf2`) carries:

- A single root-level Next.js 16.2.12 application, React 19.2.8, TypeScript 5 strict.
- An existing Sass token architecture at `src/styles/` — `abstracts/_tokens.scss`,
  `abstracts/_direction.scss`, `abstracts/_breakpoints.scss`, `themes/_default.scss`,
  `base/_accessibility.scss` — implemented under ADR-013.
- **No Tailwind. No PostCSS config. No component library.** The application was scaffolded
  with `--no-tailwind` and nothing was removed.
- All colour tokens neutral, pending brand approval (OIR-06).

P1-25 must deliver a reusable frontend foundation that P1-26…P1-31 compose from: a
dashboard shell, a modular sidebar, an operational data table, form controls, overlays,
shared states, Arabic/English with RTL, accessibility and print foundations.

### The evaluation criteria ADR-002 named

| Criterion                  | What it demands of the styling approach                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Multi-tenant theming**   | Theme values must be swappable at runtime, from one source, without recompiling or editing components                         |
| **RTL support for Arabic** | Logical properties must be the default; direction must not be encoded per component                                           |
| **Config-driven branding** | The final logo and palette are unknown today (OIR-06). Replacing them must not touch buttons, tables, dialogs, forms or pages |

A fourth criterion is imposed by this repository rather than by ADR-002: **the decision
must not create a second source of truth for design values.** This codebase has repeatedly
been bitten by two artefacts that are supposed to agree and silently drift.

## Decision

**Adopt Tailwind CSS for layout and utility composition, and shadcn/ui-style copied-in
primitives for accessible component behaviour, with Sass remaining the canonical source of
design tokens.**

Concretely:

1. **Sass is the token authority.** Every colour, spacing step, radius, shadow, duration,
   z-layer, breakpoint, control height and typography step is defined once in
   `web/src/styles/tokens/**` and nowhere else.
2. **Sass emits CSS custom properties.** The token layer generates `:root` custom
   properties. That is the single runtime surface.
3. **Tailwind consumes those custom properties.** The Tailwind theme is configured to read
   `var(--…)` rather than to define its own palette or scale. Tailwind therefore adds no
   design values — it adds a composition syntax over values Sass owns.
4. **shadcn/ui primitives are copied in, not installed as a dependency.** They are
   vendored source under `web/src/components/primitives/`, styled through the same custom
   properties, and owned by this repository.
5. **SCSS Modules** are used for component-local styling that exceeds what utilities
   express clearly.

### Why this satisfies the criteria

- **One source of truth.** Tailwind cannot drift from Sass because Tailwind holds no
  values — it holds references. A palette change in `_colors.scss` propagates to utility
  classes, primitives and SCSS Modules simultaneously, because all three resolve the same
  custom property.
- **Runtime theming.** Custom properties are swappable on a `[data-theme]` wrapper without
  a rebuild, which a Sass-variable-only approach cannot do and a Tailwind-native palette
  makes awkward.
- **RTL.** Logical properties are enforced by lint rather than by convention, and Tailwind's
  logical utilities (`ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`) are direction-aware
  by construction.
- **Brand replacement.** The final logo and palette land in token files and a brand
  configuration module. No component holds a brand value.

### Why shadcn/ui rather than an installed component library

shadcn/ui is not a dependency — it is a set of source files a project copies and owns. That
matters here for three reasons: the primitives must be restyled onto this repository's
token system rather than shipping their own theme; they must be auditable under the
repository's existing CodeQL, lint and accessibility gates like any other source; and a
vendored primitive cannot be silently changed by a dependency upgrade. The accessible
behaviour underneath (Radix) is a dependency, and is treated as one.

## Alternatives Considered

**Sass only, no Tailwind.** Rejected, but it was the closest alternative and the existing
`src/styles/` architecture already proves it works. Rejected because P1-25 must produce a
large surface of layout-heavy composition — shell, sidebar, table, gallery — and expressing
every layout in SCSS Modules produces a class-per-element vocabulary that is slower to
review and drifts from the token names it wraps. Tailwind over token-backed custom
properties gives composition without introducing values.

**Tailwind only, no Sass.** Rejected. Tailwind's own theme would become the token
authority, which conflicts with ADR-013 and with runtime multi-tenant theming: a Tailwind
palette compiles to static classes, so per-tenant theming would require either a rebuild or
a parallel custom-property layer — the second source of truth this decision exists to
avoid.

**Material UI / Ant Design / Mantine.** Rejected. Each ships an opinionated visual identity
and a theming system that would compete with the Sass token layer, and OIR-06 means the
real identity is not yet known — adopting a library's identity now would have to be undone.
They also bring large runtime CSS-in-JS or bundled theme layers that this phase would then
have to work around for RTL and print.

**Deferring the decision again.** Rejected. ADR-002 made the deferral conditional on
resolving it before frontend implementation begins, and implementation begins now.

## Consequences

- **Tailwind, PostCSS, Radix primitives and their tooling enter the dependency tree.** They
  are new supply-chain surface, subject to the existing dependency-security gate with zero
  waivers.
- **A lint rule must enforce the no-raw-values rule**, or the "Tailwind holds no values"
  property degrades quietly the first time somebody writes `bg-[#0f172a]`. P1-25 adds that
  check; without it this ADR is aspiration rather than architecture.
- **ADR-013's division of responsibility is now binding** exactly as written.
- **The existing root `src/styles/`** is unchanged by this ADR. It belongs to the backend
  application's minimal placeholder page. The frontend token system is new, lives under
  `web/`, and is not a migration of it.
- **OIR-06 remains open.** This ADR decides the mechanism, not the values. Every colour
  remains provisional until the Product Owner supplies the final palette.

## Scope

This ADR decides the styling framework and component-primitive approach only. It does not
decide the product name (OIR-01/ASM-01), the visual identity (OIR-06), the hosting or
deployment platform, or any state-management library beyond recording that global client
state is expected to be rare and justified case by case.
