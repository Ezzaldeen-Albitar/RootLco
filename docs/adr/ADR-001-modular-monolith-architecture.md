# ADR-001: Modular Monolith Architecture

## Status

Accepted by owner instruction.

The modular monolith is part of the approved technical direction accepted by owner instruction for
[PRODUCT NAME — Pending Final Approval], the Commercial Multi-Tenant Automotive CRM and ERP Platform
owned by RootLco — Root Link Company. The decision covers the internal application structure only.
Hosting provider, production region, and deployment platform remain Open and are explicitly out of
scope for this record.

## Context

RootLco is building a commercial multi-tenant, multi-company, multi-branch automotive CRM and ERP
platform. Benzene Vehicle Services (بنزين لخدمات المركبات) is the first customer, the first subscribed
tenant, and the first pilot; it is not the owner of the platform and must be onboarded through
configuration and seed data rather than through tenant-specific code. Zoom Vehicle Inspection and
Evaluation Services sits outside Phase 1 entirely, and no Phase 1 code, tables, modules, APIs,
migrations, or workflows may be created for it.

Phase 1-1, "Source-of-Truth Validation and Development Readiness", is currently in progress and has not
been passed. Phase 1-2 has not started. The architecture must therefore be recorded now so that
subsequent phases inherit a stable structural decision rather than discovering one during
implementation.

Several factors constrain the choice of architecture at this point in the project:

| Factor                   | Current position                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| Team size                | One technical and IT owner, Eng. Ezzaldeen Al-Bitar, executing implementation and technical tests |
| Independent QA ownership | Not assigned; recorded as an open risk and conditional-gate item                                  |
| Environments implemented | Local only; Development, Staging and Production are Planned — not provisioned                     |
| Local runtime            | Docker Engine 29.5.3, Docker Compose v5.1.4, 12 CPUs, approximately 16.5 GB RAM                   |
| Domain boundaries        | Not yet validated against the canonical Word documents held outside this repository               |
| Deployment target        | No cloud provider, region, or deployment platform approved by the owner                           |

The domain model is also not yet stable. Automotive CRM and ERP boundaries — customers, vehicles,
workshop operations, inventory, invoicing, and tenant administration — are expected to move as the
Benzene pilot exposes real operational requirements. Committing to distributed service boundaries
before those boundaries have been proven in a running system would fix the most expensive decision in
the architecture at the point of least information.

A single-developer team with no provisioned Development, Staging, or Production environments and no
approved deployment platform cannot operate a distributed system responsibly. Distributed tracing,
per-service pipelines, service discovery, contract testing, and independent release management all
presuppose operational capacity that does not exist and has not been budgeted or approved.

At the same time, the platform is commercial and multi-tenant, and RootLco expects it to grow. An
architecture that produces an unstructured codebase would make future extraction of any component
impractical. The requirement is therefore structural discipline now, without distributed-systems cost
now.

## Decision

The platform shall be built as a modular monolith with strict domain boundaries, is to be deployed as a
single application process, and is to be backed by a single PostgreSQL database on Supabase with
Row-Level Security.

**Module ownership.** Each domain module owns its own domain code under `src/modules/<module-name>`.
A module contains its domain logic, its data access, its validation, its types, and its module-facing
API. No module reaches into another module's internals.

**Boundary rules.** The following rules are binding for Phase 1:

1. A module may be imported only through its declared public entry point. Deep imports into another
   module's internal files are prohibited.
2. Modules communicate through explicit, typed interfaces. Shared behaviour that does not belong to a
   single domain lives in a shared layer, not in whichever module happened to need it first.
3. Cross-module database access is prohibited. A module owns its tables; other modules obtain that data
   through the owning module's interface, not by querying its tables directly.
4. Circular dependencies between modules are prohibited.
5. Tenant, company, and branch scoping is enforced at the database layer through Row-Level Security and
   is not re-implemented per module. No module may bypass tenant scoping.
6. No module may contain tenant-specific hard-coded behaviour. Behaviour that varies by tenant is
   configuration-driven. This applies to Benzene Vehicle Services as the first tenant exactly as it
   applies to every subsequent tenant.
7. No Phase 1 module may be created for Zoom Vehicle Inspection and Evaluation Services.

**Implementation approach.** Implementation is database-first: schema, constraints, and Row-Level
Security policies are defined before the module code that consumes them, so that tenant isolation is a
property of the data layer rather than of application discipline. Docker is used from the beginning for
local development.

**Premature microservices are explicitly rejected for Phase 1.** No service extraction, no separate
deployable units, no inter-service network calls, and no per-service datastores are to be introduced in
Phase 1. Any proposal to extract a service during Phase 1 requires a superseding ADR.

**Future service-extraction path.** The module boundaries defined above are the intended future service
boundaries. If and when extraction becomes justified, the sequence is: (1) demonstrate a concrete,
measured driver — an independent scaling profile, an independent release cadence, or a genuine
isolation requirement, not a general preference for microservices; (2) confirm the module's public
interface has been stable across several phases; (3) confirm that operational capacity exists, meaning
provisioned environments, an approved deployment platform, and assigned independent QA ownership;
(4) separate the module's data ownership, which is the expensive step and the reason data-access
boundaries are enforced from the start; (5) replace in-process interface calls with a network
transport behind the same interface; (6) record the extraction in a new ADR that supersedes this one for
the affected module. Extraction is a per-module decision, not a platform-wide migration. No timetable
for extraction is proposed, and none is approved.

## Alternatives Considered

**Alternative 1 — Microservices architecture from the outset.**
Rejected. The decisive objection is information, not fashion: microservices require correct service
boundaries, and the domain boundaries for this platform have not yet been validated against the
canonical documentation or tested against the Benzene pilot. A wrong boundary in a monolith is a
refactor; a wrong boundary across a network is a data migration, a contract change, and a coordinated
release. The supporting objections are operational and equally binding. The team is one engineer.
Independent QA ownership is not assigned. Only the Local environment is being implemented, and
Development, Staging, and Production are Planned — not provisioned. No cloud provider, region, or
deployment platform has been approved by the owner, so there is no target on which a distributed
topology could be operated. Multi-tenant isolation via Row-Level Security is also materially harder to
guarantee across several independently owned datastores than within one PostgreSQL instance where the
policy is enforced in one place and auditable in one place. Microservices would add distributed
transactions, eventual consistency, network partition handling, and per-service pipelines in exchange
for scaling and independent-deployment benefits that no measured requirement currently calls for.

**Alternative 2 — Unstructured or layered monolith without enforced module boundaries.**
Rejected. A conventional layered monolith organised by technical concern — controllers, services,
repositories — carries the same single-process deployment cost as a modular monolith but delivers none
of its structural benefit. Domain logic disperses across technical layers, cross-domain coupling
accumulates without any point at which it is visible or refused, and no future extraction path exists
because there is no boundary to extract along. For a multi-tenant commercial platform this is
additionally a tenant-isolation risk: without enforced data-ownership boundaries, ad hoc cross-domain
queries are the precise mechanism by which tenant scoping is bypassed by accident. Since the cost
difference against a modular monolith is discipline rather than infrastructure, there is no reason to
accept it.

**Alternative 3 — Serverless functions per domain capability.**
Rejected. Serverless decomposition presupposes an approved cloud provider, region, and deployment
platform. None has been approved by the owner, and all three are Open. It would also make the accepted
Docker-based local development materially harder to reproduce faithfully, would fragment Row-Level
Security enforcement and connection management across many execution contexts, and would introduce
cold-start and per-invocation cost characteristics that cannot be evaluated without a pilot workload
that does not yet exist.

## Consequences

**Positive.**

- A single deployable unit can be built, run, and debugged locally under Docker by one engineer, which
  matches the actual team and the only environment currently implemented.
- Tenant isolation is enforced in one place — Row-Level Security in PostgreSQL — making it auditable
  rather than distributed across service implementations.
- Refactoring across module boundaries remains cheap while the domain model is still moving, which is
  precisely the property required while boundaries are unvalidated.
- Transactional integrity across domains is available without distributed transactions or compensating
  workflows.
- Module boundaries preserve a credible future extraction path at low present cost.

**Negative and trade-offs — these are real and are accepted knowingly.**

- Boundary enforcement depends on discipline and tooling, not on the physical impossibility of a network
  call. In a microservices system a boundary violation fails to compile or fails to route; here it may
  simply work. This is the central weakness of the decision. Mitigation requires lint rules, dependency
  checks, and review, and with a single engineer and no assigned independent QA ownership the review leg
  of that mitigation is currently weak. This gap is recorded openly rather than treated as solved.
- Boundary erosion is the principal long-term failure mode. If the rules are relaxed under delivery
  pressure, the result is Alternative 2 — the unstructured monolith rejected above — reached by drift
  rather than by decision, and the extraction path is lost with it.
- Modules cannot be scaled independently. The entire application scales as one unit, so a single hot
  domain forces the whole process to scale.
- The whole application is released as one unit. A defect in one module can block the release of
  unrelated modules, and blast radius for a process-level failure is the whole platform.
- A single shared database is a single point of failure and a shared performance domain. One module's
  expensive query degrades every other module.
- The codebase and its build will grow over time; build and test duration will increase for all work
  regardless of which module changed.
- Technology choice is uniform. A module cannot adopt a different language or runtime because it is
  locally convenient.
- Future extraction, when justified, will still cost real work — separating data ownership in particular.
  This decision reduces that cost and sequences it; it does not remove it.
- Enforced boundaries impose ongoing friction. Some work that would be a direct query in an unstructured
  codebase requires an explicit interface here. This cost is accepted deliberately as the price of the
  benefits above.

## Security Impact

Row-Level Security in PostgreSQL is the primary tenant-isolation control, and the single-database
modular monolith concentrates that control in one enforceable, reviewable place. Every module inherits
tenant, company, and branch scoping from the data layer; no module is permitted to bypass it or to
re-implement it locally. The prohibition on cross-module database access is a security control as much
as an architectural one, because ad hoc cross-domain queries are the most likely route to an accidental
tenant-scoping bypass.

The prohibition on tenant-specific hard-coding is also a security-relevant boundary. Benzene Vehicle
Services is onboarded through configuration and seed data, which keeps tenant configuration inside the
data model where Row-Level Security governs it, rather than in code where it would not be subject to
those controls.

Residual risks recorded honestly:

- Because all modules run in one process against one database, a compromise at process level or a defect
  in a privileged code path has a blast radius covering all tenants. This is inherent to the decision.
- Verification of Row-Level Security behaviour is currently performed by the same engineer who
  implements it. No independent QA ownership is assigned. This is an open gap, not a mitigated one.
- No claim is made that Row-Level Security policies have been tested, that tenant isolation has been
  demonstrated, or that any security review has been completed. Phase 1-1 has not been passed. No
  compliance certification is claimed or implied by this record. Verification of security ownership is
  tracked under P1-01-SEC-003, with P1-EC-016 to be recorded as blocking if ownership is not confirmed.

## Operational Impact

Docker-based local development is accepted by owner instruction and is the only environment currently
being implemented. The measured local runtime — Docker Engine 29.5.3, Docker Compose v5.1.4, 12 CPUs,
approximately 16.5 GB RAM, Node v24.16.0, npm 11.13.0 — is adequate for a single-process modular
monolith with a local PostgreSQL instance. It would not comfortably host a distributed topology, which
reinforces the decision above.

Development, Staging, and Production environments are Planned — not provisioned. No cloud provider,
production region, or deployment platform has been approved by the owner; all three are Open. This ADR
does not select any of them, and nothing here should be read as approving one.

The modular monolith keeps operational surface minimal at a point where operational capacity is minimal:
one application process, one database, one build, one deployment artefact, one log stream. Against this,
the constraints stated in Consequences apply — one release unit, one scaling unit, one shared database
performance domain, and one process-level failure domain.

Branch structure is in place: `main` (bootstrap root commit a6e0af4, pushed), `develop` (pushed), and
`chore/p1-01-development-readiness` as the Phase 1-1 working branch. Branch protection and Pull Request
creation are **Blocked**: GitHub CLI is not installed and no GitHub token is available. They must not be
described as applied. Consequently the boundary rules in this ADR cannot currently be enforced by a
required status check on a protected branch, and rest on local tooling and author discipline until that
block is lifted.

The two canonical Word documents — `RootLco_Phase_1_Development_Plan_recovered_v01.docx` and
`RootLco_Master_Project_Documentation.docx` — reside outside this repository in the parent folder by
owner decision and are deliberately not committed. This ADR is a Git-tracked technical record; it does
not replace the canonical copies, and Git documentation must never be treated as a replacement canonical
source.

## Related Phase 1 Task and Requirement IDs

| ID            | Relationship to this ADR                                                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-01-DOC-014 | Produce the Architecture Decision Register. This ADR is an entry in that register.                                                                        |
| P1-01-DOC-012 | Development-readiness checklist for the 22 entry criteria; the architectural direction recorded here is an input.                                         |
| P1-01-QA-009  | Verify the development-readiness checklist. Not performed; no verification is claimed.                                                                    |
| P1-01-DO-001  | Verify repository readiness; establishes the repository structure that will hold `src/modules`.                                                           |
| P1-01-DO-002  | Verify environment readiness; source of the measured local runtime facts cited above.                                                                     |
| P1-01-DO-003  | Documentation pipeline tooling readiness; governs how this ADR is produced and maintained.                                                                |
| P1-01-DO-004  | Record team readiness; relevant to the single-engineer constraint underpinning this decision.                                                             |
| P1-01-SEC-004 | Classify Phase 1 plan set sensitivity and repository access control; repository classification is "Confidential — Commercial Product and Pilot Planning". |
| P1-01-SEC-005 | Verify no secrets or fabricated compliance claims; this ADR asserts no compliance certification.                                                          |
| P1-01-SEC-003 | Verify security ownership or record P1-EC-016 as blocking; referenced under Security Impact.                                                              |
| P1-EC-016     | Entry criterion to be recorded as blocking if security ownership is not confirmed.                                                                        |
| P1-OOS-026    | Out-of-scope record covering Zoom Vehicle Inspection and Evaluation Services; no Phase 1 module exists for Zoom.                                          |
| OIR-01        | Open issue: hosting provider, production region, and deployment platform are not approved and remain Open.                                                |
| ASM-01        | Assumption: domain boundaries remain subject to validation against the canonical documentation and the Benzene pilot.                                     |
| Phase 1-2     | Not started. Module implementation under `src/modules` follows this decision in later phases.                                                             |

## Decision Owner

Eng. Ezzaldeen Al-Bitar (technical and IT owner; GitHub username `Ezzaldeen-Albitar`) — for the
technical decision recorded here: the modular monolith structure, module boundary rules, database-first
implementation, and the technical conditions governing future service extraction.

Eng. Ezzaldeen Al-Bitar and Eng. Bilal Jradat (jointly) — for the business, scope, and commercial
aspects referenced by this ADR: the position of Benzene Vehicle Services as first customer and first
subscribed tenant rather than platform owner, the exclusion of Zoom Vehicle Inspection and Evaluation
Services from Phase 1, and any future decision to extract a module into a separately deployed service,
which carries commercial and operational commitments beyond the technical decision.

## Date

2026-07-16
