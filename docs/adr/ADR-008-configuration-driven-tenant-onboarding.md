# ADR-008: Configuration-Driven Tenant Onboarding

## Status

Accepted by owner instruction.

The scope of this record is limited to the technical onboarding mechanism for tenants, companies and branches. It does not decide the hosting provider, production region or deployment platform, all of which remain Open and are outside this record.

## Context

RootLco (Root Link Company) is developing [PRODUCT NAME — Pending Final Approval], a Commercial Multi-Tenant Automotive CRM and ERP Platform. The commercial premise of the platform is that a single codebase serves many paying tenants, each with its own companies and branches, and that adding a further tenant is a business and configuration activity rather than a software change.

Benzene Vehicle Services (بنزين لخدمات المركبات) is the first customer, the first subscribed tenant and the first pilot. It is a consumer of the platform, not its owner, and it is not architecturally privileged in any way. The risk this record addresses is a common and well-understood failure mode in first-customer pilots: the first tenant's requirements become indistinguishable from the product's requirements, its name and identifiers leak into schema, conditionals and application logic, and the platform quietly becomes a bespoke system for one customer. Once that happens, the second sale requires either a fork or an expensive extraction exercise, and the multi-tenant claim becomes false.

The approved technical direction — Next.js 16.2.10, React 19.2.4, TypeScript 5 (strict), Supabase, PostgreSQL with Row-Level Security, a Modular Monolith, Docker from the beginning, database-first implementation, multi-tenant, multi-company and multi-branch structure, configuration-driven behaviour and no tenant-specific hard-coding — already commits the project to this position at the level of principle. This record makes the principle operational: it states what onboarding actually consists of, what is forbidden, and how the prohibition is enforced during review.

Zoom Vehicle Inspection and Evaluation Services is outside Phase 1 and is future work only. No Phase 1 code, tables, modules, APIs, migrations or workflows are produced for Zoom. Nothing in this record creates a Zoom-specific onboarding path; if Zoom is onboarded in a future phase, it is onboarded by the same generic mechanism described here.

## Decision

Tenants, companies and branches are onboarded exclusively through configuration records and seed data held in the database. Onboarding a tenant is a data operation, not a code operation.

The decision has the following binding elements.

**Tenant identity lives in data, not in code.** A tenant is represented by a row in a tenant table with a system-generated identifier. Companies and branches are represented as rows related to that tenant. No tenant, company or branch is represented by a constant, an enum member, a type literal, a table name, a column name, a schema name, a migration, a module, a route segment or an environment variable in application source.

**No tenant name may appear in a conditional.** Application code, database functions and Row-Level Security policies must not branch on the identity of a specific tenant. This prohibition covers the literal name in any language or transliteration, any abbreviation of it, and any hard-coded identifier that stands in for it. Where behaviour must differ between tenants, the difference is expressed as a named capability, feature flag, parameter or lookup value that any tenant may hold, and the code branches on that value rather than on who the tenant is.

**Variation is modelled as named settings.** When the first pilot requires behaviour that the product does not yet have, the required change is to introduce a general setting with a documented default, not to introduce a special case. The setting is named for what it does, not for who asked for it.

**Seed data is separated by purpose.** Structural reference data required by every tenant is distinguished from tenant-specific onboarding data. The former ships with the schema; the latter is applied per tenant at onboarding time and is replaceable without touching the schema.

**Row-Level Security enforces isolation generically.** Isolation policies are written against the tenant identifier carried in the session context. They are not written per tenant, and they do not enumerate tenants.

**Code review enforces the rule explicitly.** Any change that introduces a tenant name, a tenant-specific identifier or a tenant-specific branch into source, schema or policy is rejected at review. The reviewer is required to check for this, and the rule is not waived on grounds of pilot urgency.

The business and commercial framing of this decision — that the platform is to be sold to further tenants, and that the first pilot must not consume that possibility — is owned jointly by Eng. Ezzaldeen Al-Bitar and Eng. Bilal Jradat. The technical mechanism described above is owned by Eng. Ezzaldeen Al-Bitar.

## Alternatives Considered

**Tenant-specific code paths guarded by conditionals.** The first pilot's requirements would be implemented directly, guarded by checks on the tenant's identity, with the intention of generalising the code later once a second tenant exists. Rejected. This is the failure mode the record exists to prevent, and the intention to generalise later is not reliable: the generalisation work is unfunded, is deferred under delivery pressure, and grows in cost with every additional conditional. It also makes the tenant identifier a semantic value rather than an opaque key, which means every future tenant must be added to every existing conditional — the cost of the second sale rises rather than falls. Finally, it produces a codebase in which the platform's behaviour cannot be described without naming a customer, which contradicts the stated commercial position and the approved technical direction.

**Per-tenant deployment of a forked or branched codebase.** Each tenant would receive its own instance built from its own branch, with customisation applied in that branch. Rejected. This removes multi-tenancy as an architectural property and replaces the platform with a set of bespoke systems that diverge from the first bug fix onward. It multiplies the maintenance surface by the number of customers, makes a security patch an N-way merge exercise, and is inconsistent with the approved Modular Monolith and multi-tenant direction. It would also make Row-Level Security largely redundant while removing none of the obligation to isolate data correctly, and it converts a data operation into a release operation.

**Per-tenant database schemas with tenant-named schema objects.** Each tenant would receive its own PostgreSQL schema, named after the tenant, with onboarding performed by cloning and renaming schema objects. Rejected. The tenant name would then be embedded in the database structure itself, so every migration would have to be applied N times and would fail differently per tenant as the schemas drift. It defeats the database-first approach by making the schema a per-customer artefact rather than a single source of truth, complicates cross-tenant platform administration and reporting, and reintroduces tenant identity into code wherever a schema name must be selected. Row-Level Security within a shared schema achieves the isolation requirement without embedding identity in structure.

## Consequences

The intended benefit is direct: onboarding a further tenant becomes a configuration and seed-data exercise that requires no code change, no migration and no release. This is precisely what makes the platform sellable beyond the first customer, and it is the property that a first-customer pilot most easily destroys.

The negative consequences and trade-offs are real and are recorded here rather than minimised.

| Consequence                            | Type     | Effect                                                                                                                                                                                                       |
| -------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Higher initial cost per feature        | Negative | Every requirement arriving from the pilot must be generalised before implementation. A setting, a default and its documentation cost more than a conditional. Early delivery is slower than a bespoke build. |
| Configuration surface grows            | Negative | Each generalised behaviour adds a setting. The number of settings accumulates, and the combinations become a testing and support burden that must be managed deliberately rather than allowed to sprawl.     |
| Indirection reduces readability        | Negative | Behaviour is no longer readable from the code alone; it depends on data. Understanding what a tenant actually does requires reading both the code and that tenant's configuration.                           |
| Defects can be configuration-dependent | Negative | A fault may be reproducible only under a particular settings combination, making diagnosis harder than for a hard-coded path. This raises the value of the environment isolation that is not yet in place.   |
| Review discipline becomes load-bearing | Negative | The rule is only as strong as its enforcement. It is currently enforced by human review by the same person who writes most of the code, which is a weak control (see Security Impact).                       |
| Pressure to make exceptions            | Negative | Pilot deadlines will produce requests to hard-code "just this once". Each such exception, if granted, removes the property this record exists to protect.                                                    |
| Uniform maintenance                    | Positive | A defect is fixed once for all tenants; a security fix does not require N merges.                                                                                                                            |
| Schema stability                       | Positive | The schema describes the product, not any customer, so migrations remain single-source and reviewable.                                                                                                       |
| Honest commercial claim                | Positive | The multi-tenant claim made to prospective customers remains factually true rather than aspirational.                                                                                                        |

No claim is made here that the rule is currently verified in practice. Phase 1-1 is not passed and Phase 1-2 has not started; the verification of these constraints is Phase 1-1 work that is in progress.

## Security Impact

Tenant isolation is a security property, not merely a commercial one, and this decision is the structural precondition for it. Because isolation is enforced by Row-Level Security policies written against a session-carried tenant identifier, and because no policy enumerates tenants, the isolation logic has a single implementation that can be reviewed once and applied everywhere. A per-tenant conditional in a policy would create exactly the kind of one-off path in which a cross-tenant data leak hides.

The prohibition on tenant names in source also reduces the sensitivity of the repository itself. The repository is classified "Confidential — Commercial Product and Pilot Planning". Keeping customer identity in seed data rather than in code means that the code does not itself disclose the customer list, and that a customer's identity is not distributed to every party who reads a module.

Two gaps must be stated openly rather than resolved by assertion.

First, independent QA ownership is not assigned. Technical tests are currently executed by Eng. Ezzaldeen Al-Bitar, who is also the principal author of the code under test. A rule enforced by self-review is a weaker control than a rule enforced by an independent reviewer, and this is a conditional-gate item and a standing risk, not a solved problem. This is the same gap tracked as P1-EC-016 in respect of security ownership.

Second, no secret, credential, connection string or tenant-identifying value is to be committed as part of any seed data. Seed files that carry tenant configuration must be checked for this specifically, in line with P1-01-SEC-005. No compliance certification is claimed by this record and none has been achieved.

## Operational Impact

Only the Local environment is being implemented. Development, Staging and Production are Planned — not provisioned, and no cloud provider, production region or deployment platform has been approved by the owner. Docker-based local development is accepted by owner instruction, and onboarding is exercised locally against a Dockerised PostgreSQL and Supabase stack on the measured environment (Docker Engine 29.5.3, Docker Compose v5.1.4, Docker Desktop linux engine, 12 CPUs, approximately 16.5 GB RAM, Node v24.16.0, npm 11.13.0).

Operationally, this decision means that tenant onboarding must be treated as a controlled data procedure with its own runbook, its own review step and its own reversal path, in the same way that a migration is. That runbook does not yet exist and is not claimed to exist. Until the tooling for it exists, onboarding is performed by applying seed data by hand against the local stack, which is acceptable for a single pilot tenant and is not acceptable at scale.

Branch protection and Pull Request creation are Blocked: the GitHub CLI is not installed and no GitHub token is available. This matters here because the code review step described in the Decision is the primary enforcement mechanism for the no-hard-coding rule, and it currently has no mechanical gate behind it. The enforcement is therefore procedural only, and must be recorded as such.

The canonical Word documents (RootLco_Phase_1_Development_Plan_recovered_v01.docx and RootLco_Master_Project_Documentation.docx) reside outside this repository in the parent folder by owner decision and are deliberately not committed. This record, like all Git documentation in this repository, is a working technical record and is not a replacement canonical copy.

## Related Phase 1 Task and Requirement IDs

| ID            | Relationship                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-01-DOC-014 | This record is a constituent entry of the Architecture Decision Register.                                                                                     |
| P1-01-DOC-012 | The no-hard-coding constraint is reflected in the development-readiness checklist for the 22 entry criteria.                                                  |
| P1-01-QA-009  | Verification of that checklist covers the review obligation stated in the Decision.                                                                           |
| P1-01-SEC-004 | Repository access control and the "Confidential — Commercial Product and Pilot Planning" classification relate to the disclosure argument in Security Impact. |
| P1-01-SEC-005 | Applies to seed data: no secrets and no fabricated compliance claims.                                                                                         |
| P1-01-SEC-003 | Security ownership; where unassigned, P1-EC-016 is recorded as blocking.                                                                                      |
| P1-EC-016     | Entry criterion recorded as blocking in respect of security ownership.                                                                                        |
| P1-01-DO-001  | Repository readiness, including the branch structure on which the review gate depends.                                                                        |
| P1-01-DO-002  | Environment readiness for the local Dockerised stack against which onboarding is exercised.                                                                   |
| P1-01-DO-004  | Team readiness, including the unassigned independent QA ownership noted in Security Impact.                                                                   |
| P1-OOS-026    | Out-of-scope record covering work excluded from Phase 1.                                                                                                      |
| OIR-01        | Open issue register entry relating to undecided items referenced in Status.                                                                                   |
| ASM-01        | Assumption register entry relating to the assumptions underlying this record.                                                                                 |

## Decision Owner

Eng. Ezzaldeen Al-Bitar (technical and IT owner) for the technical mechanism: schema shape, Row-Level Security policy structure, seed-data separation and the code review rule.

Eng. Ezzaldeen Al-Bitar and Eng. Bilal Jradat (jointly) for the business, scope and commercial element: the requirement that the platform remain sellable to further tenants, the position of Benzene Vehicle Services as first customer and first subscribed tenant rather than as owner, and the exclusion of Zoom Vehicle Inspection and Evaluation Services from Phase 1.

## Date

2026-07-16
