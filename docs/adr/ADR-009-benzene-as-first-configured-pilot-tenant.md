# ADR-009: Benzene as First Configured Pilot Tenant

## Status

Accepted by owner instruction.

The role of Benzene Vehicle Services (بنزين لخدمات المركبات) as the first customer, first subscribed tenant and first pilot has been decided by the product owners. The related exclusion of Zoom Vehicle Inspection and Evaluation Services from Phase 1 is likewise accepted by owner instruction. Nothing in this record implies that Phase 1-1 has been passed, that any environment beyond Local exists, or that any pilot has been provisioned.

## Context

RootLco — Root Link Company is the owner and vendor of the Commercial Multi-Tenant Automotive CRM and ERP Platform, whose product name remains [PRODUCT NAME — Pending Final Approval]. The platform is being built as a commercial, multi-tenant, multi-company, multi-branch product intended for sale to many customers, not as a bespoke system for a single organisation.

Benzene Vehicle Services (بنزين لخدمات المركبات) is the first customer of that product. It is the first subscribed tenant and the subject of the first pilot. This creates a well-known and frequently realised architectural risk: when a product has exactly one early customer, the first customer's requirements tend to leak into the product's structure. Tenant identity becomes an implicit constant, tenant-specific columns and tables appear "temporarily", seed data hard-codes a single organisation, and the product quietly becomes a single-tenant application wearing multi-tenant vocabulary. Reversing that drift later is expensive, because by then the assumption is distributed across schema, code, tests and operational procedures.

The approved technical direction is Next.js 16.2.10, React 19.2.4, TypeScript 5 (strict), Supabase, PostgreSQL, Row-Level Security, a modular monolith, Docker from the beginning, database-first implementation, and configuration-driven behaviour with no tenant-specific hard-coding. Row-Level Security and configuration-driven behaviour are only meaningful if the first tenant is genuinely treated as data rather than as structure. Benzene is therefore the first and most important test of whether the multi-tenant claim is real.

Phase 1-1, "Source-of-Truth Validation and Development Readiness", contains no application implementation. It is a validation and readiness phase. This ADR consequently constrains what Phase 1-1 may contain in relation to Benzene, and sets the rule that later implementation phases must inherit.

## Decision

Benzene Vehicle Services (بنزين لخدمات المركبات) is recorded as the first customer, first subscribed tenant and first pilot of the platform, and is to be onboarded exclusively through configuration and seed data, in the same manner as any other tenant.

The decision has the following binding parts.

1. **Role.** Benzene is a customer and a tenant. Benzene is not the software owner, not the platform owner, and holds no ownership or approval authority over the product. The owner is RootLco — Root Link Company. Product ownership and final business approval rest jointly with Eng. Ezzaldeen Al-Bitar and Eng. Bilal Jradat.

2. **Onboarding mechanism.** Benzene is created as a tenant record through the same configuration and seed-data path that any subsequent tenant will use. Tenant identity, company structure, branch structure and behavioural options are data values, resolved at runtime, not compile-time constants.

3. **No hard-coding.** No identifier, name, branch, business rule, threshold, workflow variant or feature toggle specific to Benzene may be embedded in application code, schema definitions, environment defaults or infrastructure. Where Benzene requires behaviour that differs from a default, that difference must be expressed as a generic configuration capability that any tenant could set, not as a conditional branch naming Benzene.

4. **Phase 1-1 scope constraint.** Phase 1-1 must contain no Benzene-specific tables, columns, seed files, migrations, modules, APIs, workflows or Git branches. Phase 1-1 produces validation and readiness documentation only. Any Benzene onboarding data is a later-phase artefact created through the generic tenant-configuration mechanism.

5. **Arabic name integrity.** The Arabic legal name بنزين لخدمات المركبات is part of tenant data and must round-trip without corruption. It must be stored as UTF-8 in PostgreSQL, transmitted and rendered as logical character order, and never reversed, re-ordered, transliterated or normalised in a way that alters the displayed name. Right-to-left rendering is the responsibility of the presentation layer through correct text direction handling, not of the storage layer through pre-reversed strings. Documentation, source files and test fixtures that carry the name must be UTF-8 encoded, and any tooling that mangles it is to be treated as a defect in the tooling.

6. **Zoom exclusion.** Zoom Vehicle Inspection and Evaluation Services is outside Phase 1. No Phase 1 code, tables, modules, APIs, migrations or workflows exist for Zoom. This ADR does not create any Zoom artefact and does not authorise one.

## Alternatives Considered

**Alternative 1 — Build a Benzene-specific system first, generalise into a product later.**
Rejected. This is the classic "first customer becomes the architecture" path. It offers a faster first pilot, because tenant resolution, configuration surfaces and Row-Level Security policies can be deferred and replaced with constants. The cost is that generalisation later requires re-deriving the tenant boundary across schema, queries, policies, application code and tests simultaneously, at which point the migration is a rewrite rather than a refactor. It also directly contradicts the accepted technical direction, which mandates multi-tenant, configuration-driven behaviour and no tenant-specific hard-coding, and it would make the Row-Level Security model unverifiable, because there would be no second tenant against which isolation could be demonstrated.

**Alternative 2 — Give Benzene a dedicated database, schema or deployment as a "clean" special case.**
Rejected. A per-customer database is a legitimate architecture in general, but it is not the accepted one here, and adopting it for the first customer alone would fork the product on its first day. It would mean two onboarding paths, two migration paths and two operational procedures from the outset, and it would remove the pressure that forces the shared-schema Row-Level Security model to be correct. It would also mean the pilot proves nothing about the product that is actually to be sold, since the pilot would exercise a deployment topology no subsequent customer is intended to use. The accepted direction is a shared multi-tenant PostgreSQL schema protected by Row-Level Security within a modular monolith; the first tenant must exercise exactly that.

**Alternative 3 — Treat Benzene as a co-owner or joint stakeholder of the product, with influence over product decisions recorded as authority.**
Rejected. Benzene is a paying customer and a pilot participant; its feedback is valuable input to the backlog, but it holds no ownership. Recording a customer as an owner would confuse the commercial position of RootLco — Root Link Company, would blur the joint business-approval authority of Eng. Ezzaldeen Al-Bitar and Eng. Bilal Jradat, and would in practice legitimise customer-specific requirements entering the product core as though they were product requirements. Customer influence is handled through prioritisation, not through ownership or through structural privilege in the codebase.

**Alternative 4 — Defer the decision and record Benzene's role once implementation begins.**
Rejected. The drift this ADR prevents happens at the moment the first schema and the first seed file are written, which is immediately after Phase 1-1. A rule introduced after the first tenant assumptions have been made is a remediation, not a constraint. Recording it during the readiness phase costs nothing and is the only point at which it is free.

## Consequences

**Benefits.**

- The multi-tenant claim becomes testable rather than aspirational, because the first tenant is created by the same mechanism as the second, and tenant isolation under Row-Level Security can be exercised with real data as soon as a second tenant record exists.
- Onboarding the second customer is a configuration exercise rather than an engineering project, which is the commercial premise of the product.
- The commercial boundary between RootLco as vendor and Benzene as customer is unambiguous in the documentation, the repository and the schema.
- Phase 1-1 remains a genuine validation phase, uncontaminated by implementation artefacts created under pilot pressure.

**Negative consequences and trade-offs.**

- **The first pilot is slower.** Building a configuration surface, tenant resolution and Row-Level Security policies before the first customer can be onboarded is materially more work than inserting constants. The first demonstrable pilot will arrive later than it would under Alternative 1, and this cost is accepted deliberately.
- **Generality is being designed against a single known example.** With exactly one customer, there is a real risk of building configuration options that are over-general in places where Benzene's need was in fact universal, and under-general in places where Benzene happens to be typical. Some configuration surface will be wrong and will need reshaping when the second tenant arrives; this ADR reduces structural coupling but does not eliminate design guesswork.
- **Pressure to break the rule will be recurrent and will feel reasonable.** Every urgent pilot request will present hard-coding as the pragmatic option, and each individual exception will look small. The rule only holds if exceptions are refused consistently, and refusing them will occasionally delay the pilot customer.
- **Configuration-driven behaviour is harder to reason about and to debug.** Behaviour that is expressed in data rather than in code is less visible in the source, less amenable to static analysis, and more dependent on the correctness of seed and configuration data. Defects will more often be data defects, which are harder to attribute.
- **The Arabic-name integrity requirement imposes an ongoing verification burden.** UTF-8 correctness and non-reversal must be checked at every boundary — database, API, rendering, export, and any document-generation tooling. This is a recurring cost and a plausible source of defects, particularly in tooling not authored by the team.
- **Verification depth is currently constrained.** Independent QA ownership is not assigned; technical tests are executed by Eng. Ezzaldeen Al-Bitar, who is also the technical owner. Assertions that no tenant-specific hard-coding exists are therefore self-reviewed at present. This is recorded openly as a risk and as a conditional-gate item, not as a solved problem.
- **This ADR states a constraint, not an achievement.** No tenant record exists, no pilot has been provisioned, and no isolation test has been executed. The decision governs future work.

## Security Impact

Treating Benzene as an ordinary tenant places the first customer's data inside the same Row-Level Security boundary that must protect every subsequent customer. This is the intended security posture: the isolation mechanism is exercised by real data from the first day rather than being introduced later, when a working single-tenant system would create incentive to weaken or bypass it.

The corresponding risk is that a single-tenant pilot makes isolation failures invisible. With one tenant, a missing or permissive Row-Level Security policy produces no observable symptom, because every row legitimately belongs to the only tenant present. Isolation must therefore be verified against at least two tenant records, including a negative test demonstrating that a session bound to one tenant cannot read, write or enumerate another tenant's rows. No such test has been executed, and none is claimed.

Any hard-coded Benzene identifier would additionally constitute a security defect and not merely a design defect, since a tenant identifier embedded in code or in a default cannot be revoked, rotated or scoped by configuration, and tends to become a path that circumvents policy evaluation.

Benzene's status as a customer confers no access to the repository, to the Phase 1 plan set, or to any RootLco system. The repository at github.com/Ezzaldeen-Albitar/RootLco is private and classified "Confidential — Commercial Product and Pilot Planning". Real customer data, credentials, contact details or commercial terms belonging to Benzene must not be committed to the repository, and no such material is introduced by this record. The Arabic legal name is used here as a matter of public commercial identity only.

Security ownership for Phase 1 is not confirmed; that gap is tracked as P1-EC-016 and is recorded as blocking rather than resolved.

## Operational Impact

Only the Local environment is being implemented. Development, Staging and Production environments are Planned — not provisioned. No hosting provider, production region or deployment platform has been approved by the owner; those remain Proposed/Open, and no pilot onboarding date can therefore be committed. Docker-based local development is accepted by owner instruction, and local work runs on the measured environment: Docker Engine 29.5.3, Docker Compose v5.1.4, Docker Desktop Linux engine, 12 CPUs, approximately 16.5 GB RAM, Node v24.16.0 and npm 11.13.0, with the Supabase CLI installed as a pinned project devDependency.

Operationally, this decision means that onboarding Benzene will be a runbook exercise rather than a release: a tenant configuration record and seed data applied through the generic mechanism, with no code change and no Benzene-specific migration. That runbook does not yet exist and is later-phase work.

Within Phase 1-1, the practical consequence is a set of prohibitions. No Benzene-named branch may be created; the current branch structure is main (bootstrap root commit a6e0af4, pushed), develop (pushed) and chore/p1-01-development-readiness. No Benzene-specific file, seed, migration or fixture may be added. Reviews of Phase 1-1 output should treat the appearance of any such artefact as a defect.

Branch protection and Pull Request creation are Blocked: the GitHub CLI is not installed and no GitHub token is available. The enforcement of this ADR therefore rests on review discipline rather than on tooling, which is a weaker control and is recorded as such.

The two canonical Word documents, RootLco_Phase_1_Development_Plan_recovered_v01.docx and RootLco_Master_Project_Documentation.docx, reside outside this repository in the parent folder by owner decision and are deliberately not committed. This Markdown record is a supporting engineering artefact and is not a replacement canonical copy.

## Related Phase 1 Task and Requirement IDs

| Identifier              | Relationship to this decision                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-01-DOC-014           | Produce the Architecture Decision Register; this ADR is a constituent record of that register.                                                                                              |
| P1-01-SEC-004           | Classify Phase 1 plan set sensitivity and repository access control; governs the confidentiality of pilot and commercial material referenced here.                                          |
| P1-01-SEC-005           | Verify no secrets or fabricated compliance claims; applies to the prohibition on committing Benzene credentials or commercial data, and to the absence of compliance claims in this record. |
| P1-01-SEC-003           | Verify security ownership or record P1-EC-016 as blocking; relevant to the unverified state of tenant-isolation ownership.                                                                  |
| P1-EC-016               | Security ownership entry criterion; recorded as blocking, not satisfied.                                                                                                                    |
| P1-01-DOC-012           | Development-readiness checklist for the 22 entry criteria; this ADR is an input to the readiness evidence.                                                                                  |
| P1-01-QA-009            | Verify the development-readiness checklist; the verification path under which this record is reviewed, subject to the recorded independent-QA gap.                                          |
| P1-01-DO-001            | Verify repository readiness; relevant to the prohibition on Benzene-specific branches and artefacts in the repository.                                                                      |
| P1-OOS-026              | Out-of-scope register entry covering work excluded from Phase 1, including Zoom Vehicle Inspection and Evaluation Services.                                                                 |
| OIR-01                  | Open issue or risk register entry relating to unresolved ownership and verification gaps recorded in this ADR.                                                                              |
| ASM-01                  | Assumption register entry relating to assumptions carried by this decision.                                                                                                                 |
| Phase 1-2 to Phase 1-39 | Implementation phases that inherit this constraint; no phase in this range may introduce tenant-specific hard-coding for Benzene. Phase 1-2 has not started.                                |

## Decision Owner

Eng. Ezzaldeen Al-Bitar (technical and IT owner) for the technical elements of this decision: the configuration-driven onboarding mechanism, the prohibition on tenant-specific hard-coding, the Row-Level Security placement of tenant data, and the Arabic-name encoding and rendering integrity requirement.

Eng. Ezzaldeen Al-Bitar and Eng. Bilal Jradat (jointly) for the business, scope and commercial elements: the designation of Benzene Vehicle Services (بنزين لخدمات المركبات) as first customer, first subscribed tenant and first pilot; the confirmation that Benzene holds no ownership or approval authority over the product; and the exclusion of Zoom Vehicle Inspection and Evaluation Services from Phase 1.

## Date

2026-07-16
