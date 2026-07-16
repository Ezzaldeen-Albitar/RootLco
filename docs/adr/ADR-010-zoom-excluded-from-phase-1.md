# ADR-010: Zoom Excluded from Phase 1

## Status

Accepted by owner instruction

## Context

Zoom Vehicle Inspection and Evaluation Services is a distinct commercial party with its own vehicle inspection and evaluation activity. During Phase 1 planning it was raised as a possible additional participant in the platform, alongside Benzene Vehicle Services (بنزين لخدمات المركبات), which is the first customer, first subscribed tenant and first pilot.

The platform under construction is the Commercial Multi-Tenant Automotive CRM and ERP Platform — the temporary descriptive title for [PRODUCT NAME — Pending Final Approval] — owned by RootLco (Root Link Company). Its approved technical direction is multi-tenant, multi-company and multi-branch, with configuration-driven behaviour and no tenant-specific hard-coding.

Two facts shaped this decision. First, no separate contract exists with Zoom, so there is no commercial basis for building against its requirements. Second, Zoom's inspection and evaluation domain is not required by the Benzene pilot, and admitting it into Phase 1 would widen the scope of a phase whose own entry criteria are not yet satisfied. Phase 1-1 (Source-of-Truth Validation and Development Readiness) has not passed and Phase 1-2 has not started.

Zoom is recorded in the out-of-scope register as item P1-OOS-026.

## Decision

Zoom Vehicle Inspection and Evaluation Services is excluded from Phase 1 in its entirety.

The exclusion is concrete and testable:

| Artefact type                | Phase 1 position                                 |
| ---------------------------- | ------------------------------------------------ |
| Application code and modules | No Zoom-named or Zoom-specific code or module    |
| Database tables and columns  | No Zoom-specific tables, columns or enumerations |
| Database migrations          | No migration whose purpose is Zoom               |
| APIs and endpoints           | No Zoom-specific API surface                     |
| Workflows and business rules | No Zoom inspection or evaluation workflow        |
| Seed and configuration data  | No Zoom tenant seeded in Phase 1                 |

Any future Zoom engagement is future work only, and only if separately contracted. It will be assessed on its own merits at that time and, if approved, delivered through the platform's generic tenant, company and branch extensibility together with configuration-driven behaviour — the same mechanisms by which Benzene is onboarded. No Zoom-shaped objects are to be created in Phase 1 in anticipation of that work.

## Alternatives Considered

**Alternative 1 — Include Zoom as a second Phase 1 tenant alongside Benzene.**
This was rejected on commercial and delivery grounds. No contract with Zoom exists, so the work would have no commercial basis and no authoritative requirements source; the team would be building against assumptions rather than an agreed specification. It would also add a second pilot to a phase that has not yet cleared its own readiness gate, and would dilute the Benzene pilot, which is the only engagement with a defined customer. Two concurrent first pilots would additionally increase the volume of technical testing at a point where independent QA ownership is not assigned.

**Alternative 2 — Build Zoom-specific tables, enumerations and workflow scaffolding now, and activate them later.**
This was rejected as unrequired inventory that contradicts the approved technical direction. Zoom-named database objects and modules are tenant-specific hard-coding by definition, and the direction explicitly forbids tenant-specific hard-coding. Scaffolding built without a contract encodes guessed requirements into the schema, and schema guesses are expensive to reverse once Row-Level Security policies, migrations and application code depend on them. It would also create a permanent honesty hazard, since dormant Zoom objects in the repository invite the false inference that a Zoom engagement is agreed.

**Alternative 3 — Add a general "inspection and evaluation" domain in Phase 1, unnamed but shaped around Zoom's needs.**
This was rejected because it is Alternative 2 with the name removed. It carries the same unverified requirements and the same reversal cost, while being harder to audit precisely because the intent is not visible in the naming. It also fails the scope test on its own terms: no Phase 1 requirement, and no Benzene pilot requirement, calls for an inspection and evaluation domain.

## Consequences

Positive consequences:

- Phase 1 scope stays bounded to one pilot tenant, which reduces the delivery surface and the technical testing burden at a time when independent QA ownership is not assigned.
- The schema, migrations and Row-Level Security policies remain free of speculative objects, which lowers reversal cost if Zoom requirements later prove different from any guess made today.
- The exclusion gives reviewers an unambiguous acceptance test: a search of Phase 1 code, tables, migrations, APIs and workflows for Zoom-specific artefacts must return nothing.
- Building Benzene onboarding purely through configuration and seed data exercises the generic multi-tenant extensibility that any future tenant, including Zoom, would rely on.

Negative consequences and trade-offs:

- The generic extensibility path is asserted rather than demonstrated for the inspection and evaluation domain. Phase 1 will produce no evidence that the platform can accommodate that domain without schema change, and the assertion may prove optimistic when tested against real Zoom requirements.
- Deferring all Zoom design work risks later rework. If a future Zoom engagement reveals requirements that the Phase 1 data model cannot express through configuration alone, the change will land as migrations against a schema already carrying pilot data.
- Excluding Zoom removes a second, differently shaped tenant from Phase 1. Designing multi-tenancy against a single tenant carries a genuine risk that Benzene-shaped assumptions are absorbed into the model without anyone noticing, precisely because there is no second tenant to contradict them. This risk is accepted, and the mitigation is discipline in code review against the no-hard-coding rule rather than a second pilot.
- If a Zoom engagement is contracted at short notice, there is no partial groundwork to draw on, so lead time will be longer than it would have been under Alternative 2.
- The exclusion must be actively defended. Requirements framed as generic inspection features could reintroduce Zoom's domain into Phase 1 indirectly, and reviewers must test each such request against the Benzene pilot need rather than against plausibility.

## Security Impact

The impact is modest and favourable. Excluding Zoom keeps Phase 1 to a single subscribed tenant, so the Row-Level Security policy set is written and reviewed against one real tenant boundary rather than two, and the volume of policy surface requiring review is correspondingly smaller.

No Zoom data enters any environment in Phase 1. Only the Local environment is being implemented; Development, Staging and Production are Planned — not provisioned. There is therefore no Zoom data handling, no Zoom data residency question and no third-party data-sharing arrangement to assess in Phase 1.

This ADR makes no compliance claim of any kind. Excluding a party from scope is a scope decision, not a security control and not evidence of any certification.

Two caveats are recorded openly. First, deferring the domain also defers its threat modelling; if Zoom is contracted later, inspection and evaluation data must be assessed for sensitivity on its own terms, and this ADR must not be cited as prior assurance. Second, security ownership for Phase 1 is subject to P1-01-SEC-003, which records P1-EC-016 as blocking where ownership cannot be verified; that gap is independent of this decision and is not resolved by it.

## Operational Impact

There is no operational footprint in Phase 1. No Zoom tenant is provisioned, no Zoom seed data is loaded, and no Zoom-specific service, job or configuration is deployed to the Docker-based local development environment.

Tenant onboarding remains a configuration and seed-data activity. Benzene is onboarded by that route, and a future Zoom onboarding would use the same route. No Zoom-specific operational runbook is produced in Phase 1.

The ongoing operational obligation is enforcement rather than provisioning. Reviewers must confirm at each Phase 1 gate that no Zoom artefact has been introduced, and the out-of-scope register entry P1-OOS-026 must remain current. If a Zoom engagement is separately contracted, this ADR is to be superseded by a new record rather than amended in place, so that the exclusion period remains legible in the decision history.

## Related Phase 1 Task and Requirement IDs

| ID            | Relationship to this decision                                                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-OOS-026    | Out-of-scope register item recording the Zoom exclusion; this ADR is its architectural rationale.                                                           |
| P1-01-DOC-014 | Architecture Decision Register, which carries this ADR.                                                                                                     |
| P1-01-SEC-004 | Classification of Phase 1 plan set sensitivity and repository access control; the scope boundary recorded here informs what the classified plan set covers. |
| P1-01-SEC-005 | Verification that no secrets or fabricated compliance claims exist; the Security Impact section above is written to assert no compliance status.            |
| P1-01-SEC-003 | Security ownership verification, recording P1-EC-016 as blocking where ownership cannot be verified; noted as an open gap independent of this decision.     |
| P1-EC-016     | Entry criterion referenced by P1-01-SEC-003; unresolved and not addressed by this ADR.                                                                      |
| P1-01-DOC-012 | Development-readiness checklist for the 22 entry criteria; the Phase 1 scope boundary is a precondition for assessing readiness against a defined scope.    |
| P1-01-QA-009  | Verification of the development-readiness checklist.                                                                                                        |
| P1-01-DO-001  | Verification of repository readiness; supports the check that no Zoom artefacts exist in the repository.                                                    |
| Phase 1-2     | Not started; the exclusion recorded here applies to it and to all subsequent Phase 1 sub-phases through Phase 1-39.                                         |

## Decision Owner

Eng. Ezzaldeen Al-Bitar and Eng. Bilal Jradat (jointly).

The exclusion of Zoom Vehicle Inspection and Evaluation Services from Phase 1 is a business, scope and commercial decision, and therefore rests with the joint product owners as the final business approval authority. Eng. Ezzaldeen Al-Bitar, as technical and IT owner, is responsible for the technical enforcement of the exclusion across the repository, schema, migrations, APIs and workflows.

## Date

2026-07-16
