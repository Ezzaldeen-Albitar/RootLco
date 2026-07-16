# Architecture Decisions Index — Phase 1-1 Evidence Snapshot

**Task:** P1-01-DOC-014 · **Date:** 2026-07-16 · **Owner:** Eng. Ezzaldeen Al-Bitar

The living Architecture Decision Register is [`docs/adr/README.md`](../../adr/README.md).
This file is the **Phase 1-1 evidence snapshot** of that register as of 2026-07-16: it
records what was decided at the point the Phase 1-1 gate package was assembled. If this
snapshot and the living register ever differ, the living register is current and this file
remains the historical record for the gate.

## Register snapshot (thirteen records, all dated 2026-07-16)

| ADR                                                                               | Title                                             | Status (faithful summary)                                                                                | Decision                                                                                                                                                    |
| --------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ADR-001](../../adr/ADR-001-modular-monolith-architecture.md)                     | Modular Monolith Architecture                     | Accepted by owner instruction; hosting/region/platform remain Open                                       | Single application process with strict domain-module boundaries; premature microservices rejected; service extraction remains a future path                 |
| [ADR-002](../../adr/ADR-002-next-js-and-typescript-application-stack.md)          | Next.js and TypeScript Application Stack          | Accepted by owner instruction for framework/language/layout; **Open** for the styling-framework adoption | Next.js 16.2.10 App Router, React 19.2.4, TypeScript 5 strict, `src/` layout, `@/*` alias                                                                   |
| [ADR-003](../../adr/ADR-003-supabase-and-postgresql-data-platform.md)             | Supabase and PostgreSQL Data Platform             | Accepted by owner instruction for the technology selection; **Open** for hosted project/region/plan      | PostgreSQL via the official Supabase CLI Docker stack locally; no hand-rolled Supabase compose                                                              |
| [ADR-004](../../adr/ADR-004-mandatory-row-level-security-direction.md)            | Mandatory Row-Level Security Direction            | Accepted by owner instruction — direction only; nothing implemented or tested                            | RLS mandatory on every tenant-owned table from the foundational schemas onward; a mandatory Phase 1-2 gate; no RLS test exists or is claimed                |
| [ADR-005](../../adr/ADR-005-database-first-delivery-sequence.md)                  | Database-First Delivery Sequence                  | Accepted by owner instruction; **Proposed** for the platform of the deployment-facing stages             | Database → Backend → Frontend → Integration → QA → Security → Migration → Deployment → Training → Pilot → Go-Live → Hypercare → Acceptance                  |
| [ADR-006](../../adr/ADR-006-git-branching-and-protected-main.md)                  | Git Branching and Protected Main                  | Accepted by owner instruction; branch protection **Blocked** (not applied — no CLI/token)                | main/develop permanent; prefixed branches from develop; PRs into develop; single authorised bootstrap commit a6e0af4                                        |
| [ADR-007](../../adr/ADR-007-docker-based-local-development.md)                    | Docker-Based Local Development                    | Accepted by owner instruction; container hosting beyond Local remains Open                               | Multi-stage Dockerfile (deps/dev/build/runner), non-root, named volumes, health checks; Supabase runs in the CLI's own stack                                |
| [ADR-008](../../adr/ADR-008-configuration-driven-tenant-onboarding.md)            | Configuration-Driven Tenant Onboarding            | Accepted by owner instruction                                                                            | Tenants/companies/branches onboard through configuration and seed data; no tenant name in code, ever                                                        |
| [ADR-009](../../adr/ADR-009-benzene-as-first-configured-pilot-tenant.md)          | Benzene as First Configured Pilot Tenant          | Accepted by owner instruction                                                                            | Benzene Vehicle Services (بنزين لخدمات المركبات) is first customer/tenant/pilot, configured like any tenant; never the owner; never hard-coded              |
| [ADR-010](../../adr/ADR-010-zoom-excluded-from-phase-1.md)                        | Zoom Excluded from Phase 1                        | Accepted by owner instruction                                                                            | Zoom Vehicle Inspection and Evaluation Services has no Phase 1 code, tables, modules, APIs, migrations, or workflows (P1-OOS-026)                           |
| [ADR-011](../../adr/ADR-011-product-name-remains-pending-final-approval.md)       | Product Name Remains Pending Final Approval       | Accepted by owner instruction                                                                            | The controlled placeholder `[PRODUCT NAME — Pending Final Approval]` is used everywhere a product name would appear; RootLco is never the product name      |
| [ADR-012](../../adr/ADR-012-local-first-environment-with-controlled-promotion.md) | Local-First Environment with Controlled Promotion | Accepted by owner instruction for Local-first scope; promotion elements **Proposed / Open**              | Only Local is implemented; Development/Staging/Production are Planned — not provisioned; promotion needs an owner decision and its own gate                 |
| [ADR-013](../../adr/ADR-013-sass-and-scss-styling-architecture.md)                | Sass and SCSS Styling Architecture                | Accepted by owner instruction; framework/component-library adoption remains Open                         | Sass 1.101.0 with SCSS syntax, `@use`/`@forward` only, token-generated CSS custom properties, SCSS Modules, machine-enforced logical properties for RTL/LTR |

## Still open at the gate date

No owner approval exists for any of the following, and nothing in the register may be
cited as approving them:

- The hosted Supabase project, its cloud region, and its commercial plan (ADR-003).
- The deployment platform and any cloud provider (ADR-001, ADR-005, ADR-007, ADR-008, ADR-012).
- Adoption of a utility framework or component library — Tailwind CSS, shadcn/ui, or another
  (ADR-002; division of responsibility pre-agreed in ADR-013 if adopted).
- The final product name (ADR-011; OIR-01 / ASM-01).
- Brand colours and visual identity — every colour token is a neutral default pending
  UI/design approval (ADR-013; OIR-06).
