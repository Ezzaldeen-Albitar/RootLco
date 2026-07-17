# ADR-004: Mandatory Row-Level Security Direction

## Status

Accepted by owner instruction.

Row-Level Security is part of the approved technical direction recorded for the platform (Supabase, PostgreSQL, Row-Level Security, multi-tenant, multi-company, multi-branch, configuration-driven behaviour, no tenant-specific hard-coding). The decision recorded here is the direction only. Its implementation and verification have not occurred and are not claimed by this record.

## Context

RootLco — Root Link Company is building a Commercial Multi-Tenant Automotive CRM and ERP Platform, currently identified by the placeholder product name [PRODUCT NAME — Pending Final Approval]. Benzene Vehicle Services (بنزين لخدمات المركبات) is the first customer, the first subscribed tenant and the first pilot. Benzene is onboarded through configuration and seed data only; it is never the software owner, never the platform owner, and never hard-coded into the schema or application logic.

Because a single PostgreSQL database will hold data belonging to multiple tenants, multiple companies and multiple branches, tenant isolation is the platform's primary correctness and confidentiality property. A cross-tenant read or write is not a defect of degree; it is a breach. The platform is commercial and will hold customer commercial data, which raises the consequence of any isolation failure beyond the level acceptable for application-layer filtering alone.

Two facts constrain what this record may state:

1. No tenant-owned tables exist yet. Phase 1-1 is "Source-of-Truth Validation and Development Readiness" and is not passed. Phase 1-2 has not started. There is therefore no schema on which any Row-Level Security policy could be defined.
2. Consequently **no Row-Level Security test has passed, and none can be claimed**. There are no policies, no fixtures, no negative-path tests and no results. Any statement to the contrary would be fabricated.

Only the Local environment is being implemented. Development, Staging and Production remain "Planned — not provisioned". No cloud provider, production region or deployment platform has been approved by the owner; those remain Proposed/Open and are outside the scope of this record.

## Decision

Row-Level Security shall be mandatory on every tenant-owned table, from the foundational business schemas onward, under the following non-negotiable rules:

| Rule                      | Statement                                                                                                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enablement                | `ALTER TABLE … ENABLE ROW LEVEL SECURITY` on every tenant-owned table, without exception.                                                                                                                               |
| Force                     | `ALTER TABLE … FORCE ROW LEVEL SECURITY` on every tenant-owned table, so that the table owner role is also subject to policy evaluation and cannot silently bypass isolation.                                           |
| Default-deny              | A table with Row-Level Security enabled and no matching permissive policy returns no rows and accepts no writes. Access is granted only by an explicit policy; it is never inherited from the absence of a restriction. |
| Explicit command coverage | Policies are written per command (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) with explicit `USING` and `WITH CHECK` clauses. A policy without `WITH CHECK` on write paths is treated as incomplete.                        |
| Tenant scope source       | The tenant, company and branch scope used by policies is derived from verified session context, never from a client-supplied request parameter or request body value.                                                   |
| No tenant-specific policy | Policies are written generically against the tenant discriminator. No policy, predicate or condition may name Benzene Vehicle Services or any other tenant. Tenant onboarding is configuration and seed data only.      |
| Database-first            | Isolation is defined in the database as the authoritative boundary. Application-layer scoping in the modular monolith is a convenience and a defence-in-depth layer, never the boundary itself.                         |
| No opt-out                | An exemption for a tenant-owned table requires a superseding ADR. It cannot be granted in a migration, a code review comment or a task note.                                                                            |

Reference tables that are genuinely global and tenant-neutral (for example, lookup and code lists owned by the platform rather than by a tenant) are not tenant-owned and are therefore out of scope for this rule. The classification of each table as tenant-owned or platform-global shall be recorded explicitly in the schema design work, so that "not tenant-owned" is a deliberate and reviewable statement rather than an omission.

**Gate.** Row-Level Security implementation and its tests are a mandatory Phase 1-2 gate. Phase 1-2 shall not be treated as complete while any tenant-owned table lacks enabled and forced Row-Level Security, or while the negative-path isolation tests described under Consequences have not been written and executed with recorded results. This gate is stated here as an obligation on future work; it has not been satisfied and is not being reported as satisfied.

Zoom Vehicle Inspection and Evaluation Services is outside Phase 1. No Row-Level Security policy, table, migration or workflow shall be created for Zoom in Phase 1.

## Alternatives Considered

**Alternative 1 — Application-layer tenant filtering only (no Row-Level Security).**
Every query would carry a `WHERE tenant_id = …` predicate applied by the application or an ORM/query-builder middleware, with the database left permissive.

Rejected. The isolation guarantee would then be exactly as strong as the discipline of the developer writing each query, on every path, forever. A single omitted predicate in a report, an export, a background job, an admin screen or an ad-hoc migration script silently returns another tenant's data with no error and no signal. The failure mode is silent, unbounded and indistinguishable from correct behaviour in normal testing. It also leaves any direct database access — psql, a Supabase console session, a data-fix script, a future analytics consumer — entirely unprotected, because those paths do not pass through the application at all. For a commercial multi-tenant platform holding customer data this places an unacceptable ceiling on assurance, and it makes the isolation property impossible to demonstrate to a prospective customer as anything other than an assertion of care.

**Alternative 2 — Database-per-tenant (physical isolation instead of Row-Level Security).**
Each tenant would receive a separate PostgreSQL database or a separate schema, with isolation enforced by connection routing.

Rejected. It contradicts the approved technical direction of a multi-tenant, multi-company, multi-branch platform on Supabase and PostgreSQL, and it does not fit the modular monolith and configuration-driven onboarding model that the owner has accepted. Operationally it converts every migration into an N-times fan-out that must succeed or be reconciled per tenant, and it makes tenant onboarding an infrastructure provisioning event rather than a configuration and seed-data action — directly at odds with the requirement that Benzene, as the first subscribed tenant, be onboarded via configuration only. It also does not address the multi-company and multi-branch dimensions inside a single tenant, which would still require row-scoped rules; the model therefore does not remove the need for Row-Level Security, it merely adds a provisioning burden on top of it. Physical isolation remains a legitimate future option for an individual customer with a contractual requirement for it, but it is not the platform's isolation mechanism.

**Alternative 3 — Row-Level Security enabled but not forced, and introduced later in the schema lifecycle.**
Policies would be added once the business schemas had stabilised, and `FORCE` would be omitted so that the owning role retains a working bypass for migrations and data fixes.

Rejected on both counts. Without `FORCE`, the table owner role bypasses every policy, which means the exact role used by migrations, seed scripts, background jobs and any pooled connection running as owner is the role for which isolation does not exist — the protection would be absent precisely where the most powerful queries run. Deferring policies to a later phase is equally unsound: retrofitting isolation onto a populated schema requires auditing every existing query and every existing row for scope correctness, and any table that is missed simply never receives a policy and is never noticed, because a permissive table produces no error. Applying the rule from the foundational business schemas onward makes each new table's policy a condition of its own creation, which is cheap, whereas retrofitting is expensive and unverifiable.

## Consequences

Positive:

- Tenant isolation is enforced at the last line of defence rather than the first. A missing application-layer predicate degrades to returning no rows, which is a visible and diagnosable failure, instead of returning another tenant's rows, which is a silent breach.
- The isolation property becomes testable as a database property, independent of the application, and can therefore be demonstrated rather than asserted.
- Direct database access paths — migrations, data fixes, future analytics consumers, console sessions — inherit the same boundary as the application.
- Because no policy may name a tenant, the rule structurally reinforces the requirement that Benzene Vehicle Services is onboarded via configuration and seed data only and is never hard-coded.

Negative consequences and trade-offs, stated plainly:

- **Performance cost.** Every policy predicate is evaluated on every row access. Poorly indexed tenant discriminators, or policies containing subqueries or function calls, will degrade query plans, and the degradation may not appear until data volume grows. Indexing strategy for the tenant discriminator becomes a hard requirement, not an optimisation.
- **Development friction.** Default-deny means that a newly created table returns nothing until its policies exist. Developers will encounter empty result sets that look like data bugs but are correct policy behaviour. This will cost time, particularly early, and requires that the failure be documented and recognised rather than "fixed" by disabling Row-Level Security.
- **Real risk of a bypass workaround.** The predictable reaction to policy friction is to route work through a role or a client that bypasses policies, for example a service-role key used for convenience. Such a bypass would silently void the entire decision while leaving the policies visibly in place, giving a false impression of protection. Constraining and auditing privileged-role usage is therefore an obligation created by this decision, not an incidental detail.
- **Testing burden.** The tests that matter are negative-path tests: tenant A must not see tenant B's rows, must not update them, must not delete them, and must not insert rows scoped to tenant B. These are more numerous and more tedious than positive-path tests, and they must cover each command and each tenant-owned table. This burden is real and is not yet discharged.
- **Migration discipline.** Every future migration that creates a tenant-owned table must also enable, force and define policies for it in the same migration. A migration that creates a table without policies produces a table that is default-deny and appears broken, or — worse, if Row-Level Security is forgotten entirely — a table that is permissive and appears to work. The second case is the dangerous one and must be caught by an automated check rather than by reviewer attention.
- **Not yet verified.** No tenant-owned table exists, therefore no policy exists, therefore no Row-Level Security test has been written, executed or passed. Every benefit above is prospective. This record establishes a direction and an obligation; it establishes no evidence.

Constraint on reporting:

- Phase 1-1 is not passed and Phase 1-2 has not started. No statement in this record may be cited as evidence that isolation is implemented, tested or effective. The Phase 1-2 gate defined under Decision is the point at which evidence may first exist.

## Security Impact

Row-Level Security with default-deny and `FORCE` is intended to be the platform's authoritative tenant isolation boundary, protecting the confidentiality and integrity of each tenant's commercial data — beginning with Benzene Vehicle Services as the first subscribed tenant.

The following limitations are recorded openly:

- **No assurance exists today.** There are no policies and no tests. This record confers no security assurance whatsoever, and it must not be cited in any security claim, questionnaire response or customer-facing statement as though isolation were in place.
- **No compliance claim.** No compliance certification is claimed, held or in progress. This decision is an engineering control, not a certification, and it shall not be represented as satisfying any named standard.
- **Independent QA ownership is not assigned.** Technical tests are currently executed by Eng. Ezzaldeen Al-Bitar, who is also the technical and IT owner. This means the Row-Level Security tests that will constitute the Phase 1-2 gate are, at present, designed and executed by the same person who designs and implements the policies. That is a genuine assurance gap for a control of this importance and is recorded as a risk and conditional-gate item (see P1-01-SEC-003 and P1-EC-016). It is not hidden and it is not resolved.
- **Residual risks after implementation.** Row-Level Security does not protect against a compromised privileged role, an incorrect policy predicate that is nonetheless syntactically valid, an incorrect derivation of tenant scope from session context, or a bypass through a service role. Policy correctness must itself be treated as a reviewable security artefact.
- **No secrets.** No credentials, keys or connection strings appear in this record, consistent with P1-01-SEC-005.

## Operational Impact

- **Environments.** Only the Local environment is being implemented; Development, Staging and Production are Planned — not provisioned. No cloud provider, production region or deployment platform is approved; those remain Proposed/Open. Row-Level Security behaviour has therefore been reasoned about, not observed, and cannot be reported as verified in any environment.
- **Local development.** Docker-based local development is accepted by owner instruction. Supabase and PostgreSQL run locally under Docker; the Supabase CLI is not installed globally; it is a pinned project devDependency invoked from `node_modules/.bin`. Row-Level Security policies will be exercised locally first, once tenant-owned tables exist.
- **Migrations.** Under database-first implementation, policies are migration artefacts and are versioned with the schema. Enabling, forcing and defining policies for a tenant-owned table belongs in the same migration that creates the table.
- **Automated verification required.** Reviewer attention is not a sufficient control for a table shipped without Row-Level Security, because such a table produces no error. An automated check that fails when any tenant-owned table lacks enabled and forced Row-Level Security should be treated as part of the Phase 1-2 gate. This check does not exist yet.
- **Review path constraint.** GitHub CLI is not installed and no GitHub token is available. Branch protection and Pull Request creation are therefore **Blocked**, not applied. Consequently there is currently no enforced review gate on the branch into which any future policy migration would land. This is a real weakness in the operational path for a security-critical control and is recorded as such rather than assumed away.
- **Documentation.** The two canonical Word documents (RootLco_Phase_1_Development_Plan_recovered_v01.docx and RootLco_Master_Project_Documentation.docx) live outside this repository in the parent folder by owner decision and are deliberately not committed. This ADR is a Git documentation artefact and is not a replacement canonical copy.
- **Repository classification.** github.com/Ezzaldeen-Albitar/RootLco is private and classified "Confidential — Commercial Product and Pilot Planning" (see P1-01-SEC-004).

## Related Phase 1 Task and Requirement IDs

| ID            | Relationship to this decision                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-01-DOC-014 | Produce the Architecture Decision Register — this ADR is a member of that register.                                                               |
| P1-01-SEC-004 | Classify Phase 1 plan set sensitivity and repository access control — governs the classification under which this record is held.                 |
| P1-01-SEC-005 | Verify no secrets or fabricated compliance claims — this record contains no secrets and makes no compliance claim.                                |
| P1-01-SEC-003 | Verify security ownership or record P1-EC-016 as blocking — bears directly on who owns and independently verifies the Row-Level Security control. |
| P1-EC-016     | Recorded as the security-ownership entry-criterion item; unresolved and treated as blocking/conditional.                                          |
| P1-01-DOC-012 | Development-readiness checklist for the 22 entry criteria — the readiness context in which this record sits.                                      |
| P1-01-QA-009  | Verify the development-readiness checklist — verification path for that checklist.                                                                |
| P1-01-DO-001  | Verify repository readiness.                                                                                                                      |
| P1-01-DO-002  | Verify environment readiness.                                                                                                                     |
| P1-01-DO-004  | Record team readiness — relevant to the unassigned independent QA ownership noted under Security Impact.                                          |
| P1-OOS-026    | Out-of-scope marker consistent with the exclusion of Zoom Vehicle Inspection and Evaluation Services from Phase 1.                                |
| OIR-01        | Open item recorded in relation to unresolved ownership and approval matters bearing on this decision.                                             |
| ASM-01        | Recorded assumption relied upon by this decision.                                                                                                 |
| Phase 1-2     | Row-Level Security implementation and its tests are a mandatory Phase 1-2 gate. Phase 1-2 has not started.                                        |

The identifiers cited above are defined in the canonical Word documents recorded in `docs/governance/canonical-documents.md`. They have not been independently re-verified as part of this ADR, and no identifier-validation check has been executed against this record.

## Decision Owner

Eng. Ezzaldeen Al-Bitar (technical and IT owner) — for the technical decision to make Row-Level Security mandatory, default-deny and forced on every tenant-owned table, and for the Phase 1-2 implementation and testing gate.

Eng. Ezzaldeen Al-Bitar and Eng. Bilal Jradat (jointly) — for the business and commercial aspects: acceptance of the tenant isolation posture as a product commitment to subscribed tenants, the treatment of Benzene Vehicle Services as the first subscribed tenant onboarded via configuration only, the exclusion of Zoom Vehicle Inspection and Evaluation Services from Phase 1, and any future exemption from the mandatory rule.

## Date

2026-07-16
