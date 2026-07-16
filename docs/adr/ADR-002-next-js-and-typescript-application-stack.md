# ADR-002: Next.js and TypeScript Application Stack

## Status

Accepted by owner instruction — for the application framework, runtime library, language, strict type checking, source layout, and import alias.

Open — for the styling framework, which was deliberately not selected in Phase 1-1.

## Context

RootLco (Root Link Company) is building [PRODUCT NAME — Pending Final Approval], a Commercial Multi-Tenant Automotive CRM and ERP Platform. Phase 1-1, "Source-of-Truth Validation and Development Readiness", establishes the technical baseline against which later phases are planned and executed. It does not permit business logic or user interface implementation, so any decision recorded here must be defensible as a foundation choice rather than as a product feature choice.

The approved technical direction, accepted by owner instruction, fixes the following properties of the application layer:

| Property              | Value                                                |
| --------------------- | ---------------------------------------------------- |
| Application framework | Next.js 16.2.10                                      |
| Runtime library       | React 19.2.4                                         |
| Language              | TypeScript 5, strict mode                            |
| Architecture style    | Modular monolith                                     |
| Data platform         | Supabase / PostgreSQL with Row-Level Security        |
| Implementation order  | Database-first                                       |
| Tenancy model         | Multi-tenant, multi-company, multi-branch            |
| Behaviour model       | Configuration-driven, no tenant-specific hard-coding |
| Local development     | Docker from the beginning                            |

The platform must serve multiple subscribed tenants from a single deployed codebase. Benzene Vehicle Services (بنزين لخدمات المركبات) is the first customer, the first subscribed tenant, and the first pilot; it is onboarded through configuration and seed data only and is never represented in the application stack as a hard-coded concern. Zoom Vehicle Inspection and Evaluation Services is outside Phase 1 and contributes no requirement to this decision.

The tenancy model shapes the framework requirement directly. Tenant resolution, session context, and authorisation context must be established on the server before any tenant-scoped data is rendered, because the security boundary is enforced in PostgreSQL through Row-Level Security and must not be re-implemented, weakened, or bypassed in the client. A framework whose default rendering unit executes on the client would push tenant resolution towards the browser and would make it easy to leak cross-tenant data through an unguarded client fetch.

No hosting provider, production region, or deployment platform has been approved by the owner. Only the Local environment is being implemented; Development, Staging, and Production are Planned — not provisioned. This ADR therefore records an application stack, not a deployment target.

## Decision

The application layer is built on Next.js 16.2.10 using the App Router, React 19.2.4, and TypeScript 5 with strict mode enabled. Application source resides under a `src/` directory, and the TypeScript path alias `@/*` resolves to `src/*`.

**Next.js 16.2.10 with the App Router.** The App Router is selected over the Pages Router because its default execution model matches the platform's security model. React Server Components render on the server by default, which places tenant resolution, session context, and data access on the server side of the boundary without requiring a per-page opt-in. Client interactivity becomes an explicit, reviewable declaration (`"use client"`) rather than the implicit default, so a reviewer can enumerate the client surface by searching for that directive. Nested layouts allow tenant, company, and branch context to be resolved once at a layout boundary and inherited by the segments beneath it, which suits a multi-tenant, multi-company, multi-branch hierarchy. Route Handlers and Server Actions provide server-side entry points that co-locate with the modules they serve, which is consistent with the modular monolith architecture. The App Router is also the router that receives new capability in Next.js; the Pages Router is maintained but is not where the framework's development is directed, so choosing it would mean building a new product on the trailing edge of its own framework.

**React 19.2.4.** Required by, and aligned with, Next.js 16.2.10. It is the version the framework's Server Components and Server Actions implementations are built against, and it is fixed by the approved technical direction.

**TypeScript 5 with strict mode.** Strict mode is enabled from the first commit rather than adopted later. In a multi-tenant system the values that matter most — tenant identifier, company identifier, branch identifier, user identifier — are the values whose absence is most dangerous. Without `strictNullChecks`, a missing tenant identifier is typed identically to a present one, and the compiler cannot distinguish "scoped to this tenant" from "scoped to nothing". Strict mode makes that distinction a compile-time error rather than a runtime data-exposure incident. Enabling strict mode at the outset also avoids the well-understood cost of retrofitting it: a codebase written under permissive settings accumulates implicit `any` and unguarded nullables that must later be corrected in a large, high-risk, low-value migration. Because Phase 1-1 forbids business and user interface implementation, the codebase is currently small, and this is the cheapest point at which the setting can be fixed.

**`src/` directory.** Application source is separated from repository-root configuration, tooling, container definitions, and documentation. This keeps the root readable as a project surface and gives lint, test, and coverage tooling an unambiguous root for application code.

**`@/*` import alias.** Absolute imports resolving to `src/*` avoid brittle relative traversal (`../../../`) across module boundaries. In a modular monolith, module boundaries are enforced by convention and review rather than by separate packages, and a stable absolute import specifier makes a cross-module import visible in review instead of disguising it as a relative path.

**Styling framework — Open.** Tailwind CSS was not installed during Phase 1-1, and no styling framework has been selected. Phase 1-1 forbids business and user interface implementation, so there is no rendered interface against which a styling approach could be evaluated, and selecting one now would be a preference recorded as a decision. The selection is deferred to the frontend phases (Phase 1-25 onward), where the first real interface requirements — multi-tenant theming, right-to-left support for Arabic, per-tenant branding driven by configuration rather than by code — will exist and can be used as evaluation criteria. This decision is Open. Any statement that a styling framework has been chosen is incorrect.

**Deployment.** No hosting provider, region, or deployment platform is decided by this ADR. Those remain Proposed/Open and are outside its scope.

## Alternatives Considered

**Next.js with the Pages Router.** Rejected. The Pages Router's default rendering unit is a client component, and server-side execution is opted into per page through `getServerSideProps`. For a system whose tenant isolation is enforced in the database and must be established before tenant-scoped rendering, this inverts the safe default: a page that omits the opt-in silently becomes a client-rendered page, and the omission is invisible unless a reviewer notices an absence rather than a presence. The Pages Router also has no nested layout primitive, so tenant, company, and branch context resolution would be repeated per page or hoisted into a custom `_app` wrapper with weaker segment-level control. It is additionally the router that Next.js maintains rather than advances, which is an unattractive foundation for a new commercial product with a multi-year horizon.

**Remix (React Router framework mode).** Rejected. Remix is a credible server-first React framework with a coherent loader and action model that would suit tenant-scoped data loading. It was rejected on two concrete grounds. First, the approved technical direction fixes Next.js 16.2.10, and this ADR records that direction rather than reopening it. Second, the Next.js and Supabase integration path — server-side auth helpers, cookie-based session handling across Server Components, Route Handlers, and middleware — is the most heavily documented and exercised combination for the chosen data platform. Selecting Remix would move the platform onto a less-travelled integration path for the component that carries the Row-Level Security boundary, which is the component where undocumented edges are least acceptable.

**Vite with React as a single-page application, plus a separate API service.** Rejected. This would give faster local iteration and a clean separation between client and API. It was rejected because it makes the client the default execution location for all rendering, which is the opposite of what tenant isolation requires, and because it splits the system into two deployable units at the moment the approved architecture calls for a modular monolith. It would also require building and maintaining routing, server-side rendering, data loading, and session handling that Next.js provides, with no offsetting benefit to a system whose primary complexity is data isolation rather than client interactivity.

**JavaScript, or TypeScript without strict mode.** Rejected. Both were rejected for the reason given under Decision: the identifiers that carry the tenancy boundary are precisely the identifiers whose nullability must be checked, and a non-strict configuration removes the compiler's ability to check them. Non-strict TypeScript was rejected specifically because it offers the appearance of type safety at the point where safety matters least (obvious types) and withdraws it at the point where it matters most (nullable tenant context).

## Consequences

Positive:

- Server-by-default rendering aligns the application's execution model with a database-enforced security boundary. Client-side data access becomes an explicit declaration that review can enumerate.
- Nested layouts give a natural place to resolve tenant, company, and branch context once per subtree, matching the tenancy hierarchy.
- Strict TypeScript surfaces missing tenant, company, and branch context at compile time rather than at runtime.
- A single framework covering routing, rendering, and server entry points keeps the modular monolith deployable as one unit, consistent with the approved architecture.
- Fixing strict mode and the `src/` and `@/*` conventions while the codebase contains no business logic means later phases inherit the settings rather than migrate to them.

Negative and trade-offs — recorded openly:

- **The App Router carries real conceptual cost.** The server/client component boundary, caching and revalidation semantics, and Server Actions are not obvious, and mistakes at the boundary are the mechanism by which tenant data would leak. This is a permanent onboarding and review burden, not a one-off learning cost. It is not mitigated by the framework; it must be mitigated by explicit conventions and by review discipline established in later phases.
- **Version pinning creates upgrade obligation.** Next.js 16.2.10 and React 19.2.4 are pinned. The App Router's surface has changed materially across recent major versions, and future upgrades will require deliberate, tested migration rather than routine dependency bumps.
- **Strict mode slows early implementation.** Correct typing of Supabase query results, nullable joins, and generated database types requires more work than permissive typing, and this cost is paid in the database-first phases where the type surface is largest. It is accepted as the price of the compile-time guarantee described above.
- **Framework coupling.** Choosing Next.js couples routing, rendering, and server entry points to one vendor's framework. Moving away later would mean rewriting the application layer, not swapping a library. This is accepted as the ordinary cost of choosing a framework at all.
- **The deferred styling decision has a cost.** Leaving the styling framework Open means the frontend phases begin with an unresolved decision, and the effort of that decision is carried into Phase 1-25 rather than discharged now. This is accepted because deciding now would produce a decision made without requirements, which is worse than a decision made late with them. The risk is that the deferral is forgotten; the mitigation is that it is recorded here as Open and must be resolved by a superseding or companion ADR before frontend implementation begins.
- **Server-rendered output is not automatically tenant-safe.** The App Router places code on the server by default; it does not verify that the code sets the correct tenant context before querying. Row-Level Security remains the enforcement mechanism. Nothing in this ADR reduces the need for that enforcement, and no claim is made that this stack provides tenant isolation on its own.

## Security Impact

The App Router's server-first default reduces the surface on which tenant-scoped data can be fetched from an unauthenticated or incorrectly scoped client context. This is a reduction in surface area, not an isolation guarantee. Tenant isolation is enforced by PostgreSQL Row-Level Security, and this ADR does not alter, substitute for, or weaken that mechanism.

Strict TypeScript contributes directly to the security posture by making a missing tenant, company, or branch identifier a compile-time error. A query built from an unchecked nullable scope value is the most plausible route to cross-tenant exposure in a system of this shape, and strict mode removes the class of defect in which such a value passes unnoticed.

Server-side execution means environment configuration and service credentials are read on the server and are not shipped to the client bundle. Correct handling of that configuration is a matter for the environment and secrets work under Phase 1-1, not for this ADR. No secret values are recorded here, consistent with P1-01-SEC-005.

No security testing has been performed against this stack. No penetration test, no vulnerability assessment, and no compliance certification is claimed, implied, or achieved. Security ownership for Phase 1 is not assigned; that gap is tracked as P1-EC-016 under P1-01-SEC-003 and is not resolved by this ADR.

The following are outstanding and are stated as gaps rather than as controls: conventions governing the server/client component boundary; a review rule requiring that every `"use client"` declaration be justified; and a verification approach confirming that tenant context is established before any tenant-scoped query. None of these exist yet. All are work for later phases.

## Operational Impact

Local development runs under Docker, which is accepted by owner instruction. The measured local environment is Docker Engine 29.5.3 with Docker Compose v5.1.4 on the Docker Desktop linux engine, 12 CPUs and approximately 16.5 GB RAM, with Node v24.16.0 and npm 11.13.0. npm is the package manager; pnpm and yarn are not installed. The Supabase CLI is not installed globally; it is a pinned project devDependency (`supabase` `^2.34.3`, locked by `package-lock.json`) invoked from `node_modules/.bin`. These are measured facts about the local machine and are not a claim that any environment has been provisioned.

Only the Local environment is being implemented. Development, Staging, and Production are Planned — not provisioned. No hosting provider, production region, or deployment platform has been approved; those remain Proposed/Open and are outside the scope of this ADR. Nothing here should be read as endorsing a deployment target.

The pinned versions create a maintenance obligation. Next.js 16.2.10 and React 19.2.4 must be upgraded deliberately, with the App Router surface treated as a migration risk rather than as a stable API. The `src/` layout and the `@/*` alias must be configured consistently in `tsconfig.json` and in any lint, test, or build tooling; an alias configured in one place and not another produces resolution failures that are tedious to diagnose.

Build and type-check duration will grow as the codebase grows, and strict mode contributes to type-check time. This is expected and is not currently a constraint, because the codebase contains no business logic.

No build has been verified as passing. No test has been executed against this stack, and none is claimed to pass. Phase 1-1 is not passed and Phase 1-2 has not started.

Independent QA ownership is not assigned. Technical verification of this stack is currently executed by Eng. Ezzaldeen Al-Bitar, who is also the technical owner and the author of the decision. This is a genuine independence gap. It is recorded openly here as a risk and conditional-gate item under P1-01-QA-009, and it is not treated as satisfied.

## Related Phase 1 Task and Requirement IDs

| ID                | Relationship to this ADR                                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-01-DOC-014     | Produce the Architecture Decision Register — this ADR is an entry in that register.                                                          |
| P1-01-DO-002      | Verify environment readiness — supplies the measured Node, npm, and Docker facts cited under Operational Impact.                             |
| P1-01-DO-001      | Verify repository readiness — covers the repository into which the `src/` layout and `@/*` alias are configured.                             |
| P1-01-DOC-012     | Development-readiness checklist for the 22 entry criteria — the application stack contributes to those criteria.                             |
| P1-01-QA-009      | Verify the development-readiness checklist — the point at which the independent-QA gap recorded above is carried.                            |
| P1-01-SEC-003     | Verify security ownership or record P1-EC-016 as blocking — referenced under Security Impact.                                                |
| P1-EC-016         | Security ownership entry criterion — unresolved; not addressed by this ADR.                                                                  |
| P1-01-SEC-004     | Classify Phase 1 plan set sensitivity and repository access control — governs the classification of this document.                           |
| P1-01-SEC-005     | Verify no secrets or fabricated compliance claims — this ADR records no secret values and claims no certification.                           |
| P1-01-DO-003      | Documentation pipeline tooling readiness — covers the pipeline through which this ADR is produced.                                           |
| P1-01-DO-004      | Record team readiness — relates to the ownership and independence position recorded above.                                                   |
| Phase 1-25 onward | Frontend phases — the phases in which the Open styling framework decision must be resolved.                                                  |
| P1-OOS-026        | Out-of-scope register entry — the Zoom Vehicle Inspection and Evaluation Services exclusion, which contributes no requirement to this stack. |
| OIR-01            | Open issue register entry covering undecided items referenced here.                                                                          |
| ASM-01            | Assumption register entry covering assumptions referenced here.                                                                              |

## Decision Owner

Eng. Ezzaldeen Al-Bitar (technical and IT owner) — for the technical decisions recorded in this ADR: Next.js 16.2.10 with the App Router, React 19.2.4, TypeScript 5 strict mode, the `src/` directory layout, and the `@/*` import alias.

Eng. Ezzaldeen Al-Bitar and Eng. Bilal Jradat (jointly) — for the business, scope, and commercial dimensions touching this ADR, including the deferral of the styling framework decision to the frontend phases (Phase 1-25 onward), and any future selection of a hosting provider, production region, or deployment platform, none of which is approved.

## Date

2026-07-16
