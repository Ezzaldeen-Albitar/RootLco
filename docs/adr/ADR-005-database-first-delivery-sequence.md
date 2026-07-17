# ADR-005: Database-First Delivery Sequence

## Status

Accepted by owner instruction.

The database-first implementation approach forms part of the approved technical direction accepted by owner instruction, alongside the Modular Monolith structure, Supabase and PostgreSQL with Row-Level Security, Docker from the beginning, and multi-tenant, multi-company, multi-branch configuration-driven behaviour.

The downstream stages of the sequence that depend on an environment beyond Local — specifically Deployment, Go-Live and Hypercare — are recorded as **Proposed** in respect of their target platform, because no hosting provider, production region, or deployment platform has been approved. The sequence itself is accepted; the destination of its later stages is not yet decided.

## Context

RootLco — Root Link Company is building [PRODUCT NAME — Pending Final Approval], a Commercial Multi-Tenant Automotive CRM and ERP Platform. The platform is intended to serve multiple tenants, companies and branches from a single schema governed by Row-Level Security, with tenant behaviour expressed through configuration and seed data rather than code. Benzene Vehicle Services (بنزين لخدمات المركبات) is the first customer, the first subscribed tenant and the first pilot; it is onboarded through configuration and seed data only and is never hard-coded. Zoom Vehicle Inspection and Evaluation Services is outside Phase 1 entirely and contributes no Phase 1 code, tables, modules, APIs, migrations or workflows.

The platform's correctness properties are almost entirely properties of the data layer. Tenant isolation is enforced by Row-Level Security policies attached to tables, not by application middleware. Multi-company and multi-branch scoping is a matter of key structure and policy predicates. Configuration-driven behaviour means that the difference between one tenant and another is rows, not branches in code. In such a system, the schema is not an implementation detail beneath the application; it is the security boundary, the tenancy model, and the specification of what the application is permitted to observe.

This creates an ordering constraint that is not merely a matter of preference. Application code written against a schema that has not yet settled its tenancy keys, its policy predicates, or its referential structure encodes assumptions that later prove false. Where those assumptions concern isolation, the resulting defects are not cosmetic — they are cross-tenant data exposure. Correcting them after backend, frontend and integration code exist requires touching every layer that inherited the assumption, and requires re-verifying isolation across all of them.

Phase 1-1 is "Source-of-Truth Validation and Development Readiness" and comprises 35 tasks (5 SEC, 10 QA, 4 DO, 16 DOC). It is not passed, and Phase 1-2 has not started. This record therefore fixes the delivery sequence before implementation begins, so that the ordering is a documented decision rather than an accident of whichever component was built first.

A further constraint shapes this decision. Independent QA ownership is not assigned; technical tests are currently executed by Eng. Ezzaldeen Al-Bitar, who is also the technical and IT owner and the author of the implementation. This gap is recorded openly under P1-01-SEC-003 and P1-EC-016. A sequence that concentrates the highest-risk correctness properties into a single early, narrow, heavily inspected artefact is more defensible under a self-review regime than one that distributes those properties thinly across many parallel work items.

Only the Local environment is being implemented. Development, Staging and Production are planned and not provisioned.

## Decision

Phase 1 delivery follows a single fixed sequence:

**Database → Backend → Frontend → Integration → QA → Security → Migration → Deployment → Training → Pilot → Go-Live → Hypercare → Acceptance.**

Each stage is defined as follows. The final column records the status of the **stage**, not of an environment: no stage in this table has started, because Phase 1-1 is not passed and Phase 1-2 has not started. The environment fact is stated once here and applies to the table as a whole — only the Local environment is being implemented; Development, Staging and Production are planned and not provisioned.

| #   | Stage       | Definition                                                                                      | Stage status                                           |
| --- | ----------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 1   | Database    | Schema, keys, constraints, Row-Level Security policies, migrations, seed and configuration data | Not started                                            |
| 2   | Backend     | Modular Monolith server logic written against the settled schema                                | Not started                                            |
| 3   | Frontend    | Next.js 16.2.10 / React 19.2.4 interface consuming the backend contract                         | Not started                                            |
| 4   | Integration | Wiring of modules and external interfaces across the assembled stack                            | Not started                                            |
| 5   | QA          | Functional verification of the integrated system                                                | Not started; ownership not assigned — see Consequences |
| 6   | Security    | Isolation, access control and policy verification against the running system                    | Planned                                                |
| 7   | Migration   | Movement of data into the platform's structures                                                 | Planned                                                |
| 8   | Deployment  | Placement onto a target platform                                                                | Proposed — no platform approved                        |
| 9   | Training    | Preparation of tenant users                                                                     | Planned                                                |
| 10  | Pilot       | First subscribed tenant operation — Benzene Vehicle Services                                    | Planned                                                |
| 11  | Go-Live     | Transition to live operation                                                                    | Proposed — no platform approved                        |
| 12  | Hypercare   | Elevated support following Go-Live                                                              | Proposed — no platform approved                        |
| 13  | Acceptance  | Formal business sign-off                                                                        | Planned                                                |

The sequence is a dependency order, not a schedule. A stage may not begin until the artefacts it depends upon exist in a form stable enough to build against. It does not follow that stages are separated by idle time, nor that a stage is closed permanently once passed; defects found downstream return to the stage that owns them.

### Why the schema precedes application code

Four properties of this platform place the schema ahead of everything built on it.

**The schema carries the security boundary.** Row-Level Security means tenant isolation lives in policy predicates on tables. Backend code does not implement isolation; it operates within isolation the database enforces. Writing backend code first would mean writing code whose most important guarantee has not yet been defined. Any isolation assumption the backend made would be provisional until the policies existed, and provisional isolation assumptions are how cross-tenant leaks are written.

**The schema is the tenancy model.** Multi-tenant, multi-company, multi-branch scoping is expressed through key structure. That structure determines what every query above it can express and what every policy below it can constrain. It cannot be discovered by writing application code and generalising later; retrofitting a tenancy key into an existing query surface touches every query.

**Configuration-driven behaviour requires the configuration tables to exist first.** The commitment that no tenant is hard-coded — Benzene included — only holds if the configuration structures that carry tenant variation exist before anyone is tempted to express that variation in code. Building the frontend before the configuration schema exists invites the first tenant's rules to be written as conditionals rather than as rows. Once written that way, they are difficult to remove, because a subsequent tenant's rules are then written the same way to match. The database-first order removes the temptation by making the correct mechanism available before the incorrect one is needed.

**The schema is the widest-blast-radius artefact.** A defect in the frontend affects a screen. A defect in the backend affects an endpoint. A defect in the tenancy keys or policies affects everything, and is discovered last because it manifests as data appearing where it should not — a condition that functional testing of a single tenant does not detect. Sequencing the widest-blast-radius artefact first places the most consequential work where it receives the most scrutiny per line and where correction is cheapest, which matters more than usual given that QA ownership is not independent.

### Ties to the Phase 1-2 to 1-12 database phases

As defined in the canonical Phase 1 Development Plan, Phases 1-2 to 1-12 constitute the database work of the sequence's first stage. Phase 1-2 has not started, and it cannot start until Phase 1-1 establishes that the source of truth is validated and the development environment is ready — that is the entire purpose of Phase 1-1's 22 entry criteria, recorded under P1-01-DOC-012 and verified under P1-01-QA-009.

The consequence of the database-first order is that Phases 1-2 to 1-12 are a serial prerequisite for the backend stage rather than a track running beside it. The schema, its policies, its migrations and its seed data must reach a stable state across those phases before backend implementation begins against them. This is the source of the sequence's principal cost, addressed in Consequences below: the application layers cannot begin until a substantial run of database phases has completed, and the first demonstrable end-to-end behaviour is correspondingly late.

As defined in the canonical Phase 1 Development Plan, the phases beyond 1-12 and up to 1-39 continue the sequence through the later stages. Their status follows the table above: those that depend on a target platform remain Proposed, because no hosting provider, production region, or deployment platform has been approved.

## Alternatives Considered

### Alternative 1 — Vertical slices (feature-by-feature, full-stack)

Each feature would be delivered complete through database, backend and frontend before the next feature begins, growing the schema incrementally as features demand.

**Rejected.** Vertical slicing distributes schema authorship across the whole of implementation. Each slice adds tables and policies under the pressure of delivering that slice's screen, which is precisely the pressure under which tenancy keys are chosen for local convenience rather than global correctness. Three specific failures make this unacceptable here:

- **Isolation cannot be verified per slice.** Row-Level Security correctness is a property of the whole policy set. A slice can be individually correct and still open a cross-tenant path in combination with a later slice — for example, where a join reachable through the second slice's tables bypasses a predicate the first slice relied upon. Slice-level verification would give a false signal of safety, and the composite check would arrive only at the end, at which point the schema is fully committed and every slice is built on it. The order of discovery is exactly inverted from what a security-critical property requires.
- **It defeats the no-hard-coding commitment.** Benzene Vehicle Services is the first tenant and the only tenant during the pilot. Under vertical slicing, every slice is specified, built and demonstrated against Benzene's requirements, with no second tenant present to force the distinction between platform behaviour and tenant configuration. The likely outcome is a platform that works for Benzene and encodes Benzene, which contradicts the accepted direction that Benzene is onboarded through configuration and seed data only and is never hard-coded. Designing the configuration schema up front, before any tenant's screen exists, is what keeps that commitment enforceable rather than aspirational.
- **Schema churn compounds against the layers above it.** Each slice's schema revision invalidates assumptions in previously completed slices' backend and frontend code. Because those layers already exist, every revision is a multi-layer edit plus a re-verification of isolation across all completed slices. The cost of a schema change grows with the number of slices already delivered, so the approach is most expensive exactly when the schema is most likely still to be wrong.

The honest counterweight, recorded here rather than omitted: vertical slicing would produce demonstrable working software far earlier, which has real value for a commercial product with a waiting first customer. That advantage is genuine and is forfeited by this decision. It was judged not to outweigh the isolation and hard-coding risks above, in a platform where a cross-tenant leak is a commercial and legal event rather than a bug report.

### Alternative 2 — Parallel layer development against an agreed interface contract

Database, backend and frontend teams would work simultaneously against a contract agreed in advance, with the frontend built against mocks until the real backend arrives.

**Rejected**, for two independent reasons.

- **There is no team to parallelise across.** The technical and IT owner is Eng. Ezzaldeen Al-Bitar; team readiness is recorded under P1-01-DO-004; independent QA ownership is not assigned. Parallel layer development requires concurrent workers to be worth its coordination cost. With a single implementer, "parallel" degrades to context-switching between layers whose contract has not yet been proven, which is slower than sequential work and produces a less coherent schema. The approach solves a scheduling problem the project does not have while adding a correctness problem it cannot afford.
- **The contract would be fiction at the moment it was needed.** Parallel development is only sound where the interface contract is genuinely stable in advance. Here the contract's most important clauses are exactly the ones still being decided: which keys scope a tenant, what a policy permits a caller to observe, and which behaviours are configuration rather than code. Agreeing that contract before the schema work has tested it would mean agreeing a guess, and mocks built from a guess validate nothing — the frontend would pass against mocks and fail against the database, with the failure surfacing after both layers were written.

### Alternative 3 — Frontend-first prototyping to establish requirements

Interface prototypes would be built first with the first customer, and the schema derived from what the screens turned out to need.

**Rejected.** This inverts the dependency that matters. Screens derived with a single tenant present produce a schema shaped to that tenant, which is the hard-coding failure described above arriving by a different route. It also derives the security boundary from the interface, meaning isolation would be whatever the screens happened to imply rather than what the tenancy model requires. The legitimate need this alternative addresses — validating requirements with Benzene before committing to structure — is met instead through the Pilot stage and through requirements work that does not entail building the application in the wrong order.

## Consequences

### Negative consequences and trade-offs

These are stated first because they are the substance of the decision. A sequence chosen only for its benefits would not need recording.

- **Working software arrives late.** No end-to-end behaviour is demonstrable until database, backend and frontend stages have each completed. Phases 1-2 to 1-12 must reach a stable schema before backend work begins. For a commercial product with a first subscribed tenant already identified, a long period without a visible artefact is a real cost — to stakeholder confidence, and to the ability to detect a wrong direction by seeing it.
- **Feedback on the schema is deferred until it is expensive to act on.** The application layers are the strongest test of whether a schema is usable. Sequencing them last means the schema's usability defects surface after the schema is largely committed. Database-first mitigates the risk of a wrong schema being built upon; it does not mitigate, and partly aggravates, the risk of the schema being wrong in ways only its consumers reveal.
- **Requirements risk concentrates in the earliest stage.** Schema decisions taken before any screen exists rest on a documented understanding of requirements rather than a demonstrated one. If that understanding is wrong, the error is discovered downstream and its correction propagates through every layer built above it — the same propagation cost the decision was chosen to avoid, merely relocated.
- **The sequence is not a licence to over-build the schema.** Knowing that later change is costly creates pressure to anticipate every future requirement in the initial schema, producing structures that serve no present tenant. This is a real and predictable failure mode of database-first work and is called out here so that it can be resisted deliberately rather than rationalised as prudence.
- **Serial stages leave no slack.** Delay in a database phase propagates in full to every subsequent stage. There is no parallel track to absorb it.
- **Independent QA is not available at the stage where it matters most.** The QA stage's ownership is not assigned, and technical tests are currently executed by Eng. Ezzaldeen Al-Bitar — the same person who authors the schema and the implementation. Database-first improves inspectability by concentrating the critical work in one early artefact, but it does not supply an independent inspector. Self-review of one's own isolation policies is a weaker control than independent review, and this sequence does not remedy that. The gap is recorded under P1-01-SEC-003 and P1-EC-016 as a risk and conditional-gate item, and must remain openly recorded rather than treated as closed by the presence of this decision.
- **Later stages rest on undecided ground.** Deployment, Go-Live and Hypercare are stages in an accepted sequence whose target platform is not approved. The sequence can be followed to the boundary of the Local environment and no further. Planning that assumes a destination for those stages would be planning against a decision that has not been taken.

### Positive consequences

- Tenant isolation, tenancy keys and policy predicates are settled before any code depends on them, so isolation assumptions in the application layers are grounded rather than provisional.
- The configuration structures that carry tenant variation exist before the first tenant's requirements are implemented, which makes the no-hard-coding commitment for Benzene Vehicle Services enforceable in practice rather than dependent on discipline under delivery pressure.
- The widest-blast-radius artefact receives the most concentrated review, which partially compensates for the absence of independent QA ownership.
- Migrations form a coherent, ordered set authored as a body of work rather than accreted per feature, which matters for a database-first implementation where migrations are the schema's history.
- Zoom Vehicle Inspection and Evaluation Services remains cleanly excluded: with the schema authored as a deliberate whole, its exclusion from Phase 1 tables, migrations and workflows is verifiable by inspecting one artefact rather than by auditing scattered slice-level additions.

## Security Impact

The security consequence of this sequence is that Row-Level Security policies are authored as a set, at a known point, before consumers exist. This is what makes the policy set reviewable as a whole. Isolation is a composite property: it is not established by checking policies individually but by establishing that no reachable path across the schema returns rows outside the caller's tenant, company or branch scope. That check is meaningful only against a schema that is stable and complete enough to enumerate its paths. Under the rejected vertical-slice alternative, no such moment exists — the policy set changes with every slice, and each composite check is invalidated by the next.

The Security stage sits at position 6, after QA. It is not the first point at which security is considered; the security-critical work is stage 1. Stage 6 verifies against a running, integrated system what stage 1 designed — the two are not substitutes, and passing stage 6 does not retrospectively validate a schema that was not reviewed when authored.

The sequence does not resolve the ownership gap. Security ownership verification is P1-01-SEC-003, with P1-EC-016 recorded as blocking where ownership is not established. Because the same individual authors the isolation policies and executes the technical tests against them, the control is self-review at the point of highest consequence. This is the most significant known weakness in the current arrangement and is recorded as a conditional-gate item, not as an accepted residual.

Repository sensitivity and access control are classified under P1-01-SEC-004; the repository is private and classified "Confidential — Commercial Product and Pilot Planning". This ADR contains no secrets and asserts no compliance certification, consistent with P1-01-SEC-005. No test is claimed to have passed, no environment beyond Local is claimed to exist, and no approval is claimed beyond those genuinely given.

## Operational Impact

**Local environment only.** The sequence is executable through the Integration stage on Local. Development, Staging and Production are planned and not provisioned. Docker-based local development is accepted by owner instruction, and the measured environment supports the database-first stages: Docker Engine 29.5.3, Docker Compose v5.1.4, Docker Desktop linux engine, 12 CPUs, approximately 16.5 GB RAM, Node v24.16.0, npm 11.13.0. No pnpm or yarn is present; the Supabase CLI is not installed globally and is a pinned project devDependency invoked from `node_modules/.bin`. Environment readiness is recorded under P1-01-DO-002.

**Stages 8, 11 and 12 cannot be planned to a destination.** Deployment, Go-Live and Hypercare presuppose a target platform. None is approved. Their sequence position is settled; their target is Proposed and remains an open decision for the product owners.

**Branching and repository.** The branch structure exists: `main` (bootstrap root commit a6e0af4, pushed), `develop` (pushed), and `chore/p1-01-development-readiness` as the Phase 1-1 working branch. Repository readiness is recorded under P1-01-DO-001. GitHub CLI is not installed and no GitHub token is available; branch protection and Pull Request creation are therefore **Blocked**, not applied. A serial delivery sequence with a single implementer and no enforced branch protection means the process controls that would normally gate a schema change into `develop` are absent. This compounds the QA ownership gap rather than being independent of it, and both should be read together when assessing the strength of controls over the database stage.

**Canonical documentation.** The two canonical Word documents — `RootLco_Phase_1_Development_Plan_recovered_v01.docx` and `RootLco_Master_Project_Documentation.docx` — live outside this repository in the parent folder by owner decision and are deliberately not committed. This ADR, and Git documentation generally, is a derived record and must never be treated as a replacement canonical copy. Where this record and the canonical documents diverge, the canonical documents govern.

**Documentation tooling.** Documentation pipeline tooling readiness is recorded under P1-01-DO-003. The Architecture Decision Register (P1-01-DOC-014) indexes this record.

**Gate condition.** Phase 1-2 cannot begin until Phase 1-1's 22 entry criteria are satisfied (P1-01-DOC-012) and verified (P1-01-QA-009). Phase 1-1 is not passed. Nothing in this record advances that state.

> **Status update (2026-07-17).** Phase 1-1 subsequently closed with a recorded owner
> Go (2026-07-16). From 2026-07-17, the stage gates of this sequence are decided for
> routine technical phases under the
> [Standing Technical Authorization Policy](../governance/standing-technical-authorization-policy.md):
> green mandatory CI plus the pull-request merge into `develop` by the delegated
> technical authority constitutes the gate decision (**Go — Technical Gate Passed**),
> with escalation to the founders only for the reserved decisions listed there.

## Related Phase 1 Task and Requirement IDs

| ID                 | Relationship to this decision                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------- |
| P1-01-DO-001       | Repository readiness — branch structure supporting the sequence; branch protection Blocked    |
| P1-01-DO-002       | Environment readiness — Local Docker environment for the database and application stages      |
| P1-01-DO-003       | Documentation pipeline tooling readiness — publication of this record                         |
| P1-01-DO-004       | Team readiness — informs the rejection of parallel layer development                          |
| P1-01-DOC-012      | Development-readiness checklist for the 22 entry criteria gating Phase 1-2                    |
| P1-01-DOC-014      | Architecture Decision Register — indexes ADR-005                                              |
| P1-01-QA-009       | Verification of the development-readiness checklist                                           |
| P1-01-SEC-003      | Security ownership verification; P1-EC-016 recorded as blocking where unestablished           |
| P1-01-SEC-004      | Phase 1 plan set sensitivity classification and repository access control                     |
| P1-01-SEC-005      | Verification of no secrets and no fabricated compliance claims in this record                 |
| P1-EC-016          | Blocking entry criterion where security ownership is not established                          |
| P1-OOS-026         | Out-of-scope record — Zoom Vehicle Inspection and Evaluation Services excluded from Phase 1   |
| OIR-01             | Open issue register entry associated with this decision's undecided elements                  |
| ASM-01             | Assumption register entry associated with this decision                                       |
| Phase 1-2 to 1-12  | Database phases constituting stage 1; serial prerequisite for the backend stage. Not started. |
| Phase 1-13 to 1-39 | Subsequent stages of the sequence; those depending on a target platform remain Proposed       |

## Decision Owner

**Eng. Ezzaldeen Al-Bitar** (technical and IT owner, GitHub username `Ezzaldeen-Albitar`) — owner of the technical sequencing decision: the ordering of Database, Backend, Frontend, Integration, QA and Security stages, the rejection of vertical slices and of parallel layer development, and the tie to the Phase 1-2 to 1-12 database phases.

**Eng. Ezzaldeen Al-Bitar and Eng. Bilal Jradat (jointly)** — owners of the business, scope and commercial elements: the Migration, Deployment, Training, Pilot, Go-Live, Hypercare and Acceptance stages as they bear on the first subscribed tenant Benzene Vehicle Services; the acceptance of the delayed delivery of demonstrable software recorded under Consequences; the still-open selection of a hosting provider, production region and deployment platform; and the disposition of the QA ownership gap recorded under P1-01-SEC-003 and P1-EC-016.

## Date

2026-07-16
