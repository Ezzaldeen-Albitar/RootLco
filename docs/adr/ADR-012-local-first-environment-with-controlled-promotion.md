# ADR-012: Local-First Environment with Controlled Promotion

## Status

Accepted by owner instruction — for the local-first scope of Phase 1-1 only.

The Local environment is the only environment being implemented, and Docker-based local development is accepted by owner instruction. Every element of promotion beyond Local remains undecided: the hosting provider, the production region, and the deployment platform are **Proposed / Open** and are recorded as such in this record. This ADR does not approve any hosted environment.

## Context

Phase 1-1 ("Source-of-Truth Validation and Development Readiness") is a validation and readiness phase, not a delivery phase. It contains 35 tasks (5 SEC, 10 QA, 4 DO, 16 DOC) whose purpose is to establish that the source-of-truth documentation, the repository, and the development environment are coherent before implementation work begins in Phase 1-2 and beyond.

The platform is a Commercial Multi-Tenant Automotive CRM and ERP Platform owned by RootLco (Root Link Company). The software product name is [PRODUCT NAME — Pending Final Approval] and has not been finalised. The approved technical direction is Next.js 16.2.10, React 19.2.4, TypeScript 5 (strict), Supabase, PostgreSQL with Row-Level Security, a modular monolith, Docker from the beginning, database-first implementation, and multi-tenant, multi-company, multi-branch, configuration-driven behaviour with no tenant-specific hard-coding.

Four facts shape this decision:

1. **No hosting decision exists.** The product owners have not selected a cloud provider, a production region, or a deployment platform. Any environment topology that presumes one would be a fabrication.
2. **The local environment is measurable today.** Verified environment facts exist: Docker Engine 29.5.3, Docker Compose v5.1.4, Docker Desktop on the linux engine, 12 CPUs, approximately 16.5 GB RAM, Node v24.16.0, npm 11.13.0. No pnpm or yarn is installed, and the Supabase CLI is not installed globally — it is a pinned project devDependency invoked from `node_modules/.bin`. These are the only environment facts the phase can honestly assert.
3. **Automation capability is constrained.** The GitHub CLI is not installed and no GitHub token is available. Branch protection and Pull Request creation are consequently **Blocked**, not applied. Any promotion pipeline that assumed protected branches or automated release gates could not be implemented or verified in this phase.
4. **A hosted environment carries commercial and legal weight.** Selecting a provider and a region determines data residency, subscription cost, and the contractual position under which the first subscribed tenant, Benzene Vehicle Services (بنزين لخدمات المركبات), would eventually be served. That is a business decision belonging to the product owners jointly, not a technical convenience.

Provisioning a Development, Staging, or Production environment in Phase 1-1 would therefore either require an unauthorised commercial commitment or produce an environment that documentation could not honestly describe. Neither outcome is acceptable.

## Decision

Phase 1-1 implements the **Local environment only**. Development, Staging, and Production are recorded as **Planned — not provisioned**.

The decision has the following binding parts:

| Element                             | Position                                                 |
| ----------------------------------- | -------------------------------------------------------- |
| Local environment                   | Implemented, Docker-based, accepted by owner instruction |
| Development environment             | Planned — not provisioned                                |
| Staging environment                 | Planned — not provisioned                                |
| Production environment              | Planned — not provisioned                                |
| Cloud provider                      | Proposed / Open — no owner decision                      |
| Production region                   | Proposed / Open — no owner decision                      |
| Deployment platform                 | Proposed / Open — no owner decision                      |
| Continuous deployment workflow      | Not created; not required in Phase 1-1                   |
| Branch protection and Pull Requests | Blocked — no GitHub CLI, no token                        |

**Controlled promotion** means that the progression Local → Development → Staging → Production is a sequence of separately authorised steps, not an automatic consequence of code being written. Each promotion to a hosted environment requires:

1. An explicit owner decision recorded in this repository, superseding the relevant Open items above;
2. Its own gate with defined entry and exit criteria, distinct from the Phase 1-1 development-readiness gate; and
3. A superseding ADR that records the provider, region, and platform actually chosen, together with the data-residency and tenancy-isolation reasoning that justified them.

Until those conditions are met, no hosted environment exists and no documentation may describe one as existing, approved, or pending provisioning.

No continuous deployment workflow is created in Phase 1-1. There is no target to deploy to, so a CD workflow would be untestable configuration whose correctness could not be demonstrated. Local development is driven by Docker Compose, and the database-first approach means schema and Row-Level Security policies are exercised against a local PostgreSQL instance under Supabase, not against a hosted project.

The Local environment must remain configuration-driven and free of tenant-specific hard-coding. Benzene Vehicle Services is the first customer and first subscribed tenant; it is onboarded through configuration and seed data only, and never through code paths that name it. Zoom Vehicle Inspection and Evaluation Services is outside Phase 1 entirely, and no Phase 1 environment — local or otherwise — carries code, tables, modules, APIs, migrations, or workflows for it.

## Alternatives Considered

### Alternative 1 — Provision a hosted Development environment immediately alongside Local

Stand up a hosted Supabase project and a hosted application environment now, so that the team develops against infrastructure resembling the eventual production topology and discovers hosting-specific problems early.

**Rejected.** Provisioning requires choosing a provider and a region, and the owners have not made that choice. Making it implicitly through an engineering convenience would convert an unmade commercial decision into a fait accompli — the first environment provisioned tends to become the default, and migrating a multi-tenant PostgreSQL database with Row-Level Security across providers later is substantially more expensive than deciding correctly once. It would also create a real cost and a real data-residency position for a product whose first pilot tenant has not yet been contractually served. The claimed benefit is additionally weak in Phase 1-1: this phase validates documentation and readiness and writes no application code, so there is nothing whose hosting behaviour could be observed.

### Alternative 2 — Define the full four-environment topology on paper now and provision later

Do not provision anything, but write the complete Development, Staging, and Production specification — provider, region, sizing, network boundaries, promotion pipeline, CD workflow — as documentation in Phase 1-1, so implementation later is mechanical.

**Rejected.** Every substantive field in such a specification would be invented. Region, provider, and platform are Open, so the document could only be a plausible-looking fiction, and fictional specifications are read later as decisions. This directly conflicts with P1-01-SEC-005, which verifies that no secrets and no fabricated compliance claims exist in the plan set. A promotion pipeline written against an unknown target also cannot be verified by P1-01-QA-009 or any other QA task, so it would enter the repository as permanently unverified content. The lightweight, honest form of this alternative — recording that the environments are Planned and the hosting questions Open — is exactly what this ADR does, without the fabricated detail.

### Alternative 3 — Create the CD workflow now and leave it disabled

Author the deployment workflow, commit it in a disabled state, and enable it once a hosting target is chosen.

**Rejected.** A disabled workflow is untested configuration that accumulates drift against the toolchain and the eventual target while giving a false impression of readiness. It cannot be exercised, so it cannot be verified, and a reader of the repository would reasonably infer that deployment is a solved problem awaiting a switch. Branch protection and Pull Requests are in any case Blocked in this phase because the GitHub CLI is not installed and no token is available, so the review controls that would make an automated deployment path safe do not currently exist.

## Consequences

### Positive

- The repository contains no environment claim that cannot be verified against a measured fact. The only environment asserted to exist is the one running on the recorded local hardware and toolchain.
- The provider, region, and platform decisions stay with the product owners and stay reversible. No engineering action forecloses them.
- No subscription cost or data-residency exposure is incurred before there is a product to host or a tenant to serve.
- Docker from the beginning means the local environment already encodes the runtime shape, so the eventual hosted target inherits a container definition rather than an ad hoc developer machine setup.
- Fabricated-compliance risk is reduced, supporting P1-01-SEC-005 and the integrity of the Phase 1-1 gate.

### Negative and trade-offs

- **Hosting-specific defects are deferred, not avoided.** Connection pooling behaviour, cold-start characteristics, managed-Postgres extension availability, egress and latency, and provider-specific Row-Level Security or authentication quirks will all surface later than they would under Alternative 1, and will surface at a point where more code depends on assumptions formed locally.
- **There is no shared environment.** With only Local implemented, there is no common surface on which the product owners can review working software, and no integration point where two developers' work meets outside a merge. This constrains demonstration and review to whatever runs on an individual machine.
- **The pilot path is not yet demonstrable.** Benzene Vehicle Services cannot be onboarded to anything reachable. Any pilot timeline that assumes a hosted tenant depends on a promotion gate that has not been scheduled because the decision preceding it has not been made.
- **Local environment drift is a real risk.** With no shared environment enforcing consistency, correctness on one machine does not imply correctness elsewhere. Docker mitigates but does not eliminate this, and the mitigation depends on discipline in keeping the container definition authoritative rather than convenient.
- **The promotion gate is unscheduled work with unbounded start date.** Because it depends on an owner decision that has no committed date, environment work carries schedule risk that this ADR does not resolve — it records it.
- **Verification independence is absent.** Independent QA ownership is not assigned; technical tests, including any verification of the local environment, are currently executed by Eng. Ezzaldeen Al-Bitar, who also owns the technical decisions. This is a self-review gap and is recorded openly as a risk and conditional-gate item rather than treated as satisfied.
- **The absence of a CD workflow will eventually become a bottleneck.** It is correct now and will not remain correct. The point at which it becomes wrong is the first promotion decision, and this ADR must be superseded then rather than stretched.

## Security Impact

Confining Phase 1-1 to a Local environment narrows the attack surface to a single developer machine. No hosted endpoint exists, no production data exists, and no tenant data — including any belonging to Benzene Vehicle Services — is present in any environment. There is nothing externally reachable to compromise.

The security consequences that follow require explicit statement:

- **Local secrets discipline is a precondition, not a benefit.** Docker Compose environments and Supabase local configuration accumulate keys and connection strings by default. P1-01-SEC-005 verifies that no secrets are committed to the repository, and the local-first posture increases rather than decreases the need for that verification, because local convenience is the most common origin of committed credentials.
- **The repository classification remains binding regardless of environment.** The repository (github.com/Ezzaldeen-Albitar/RootLco, private) is classified "Confidential — Commercial Product and Pilot Planning" under P1-01-SEC-004. Access control applies to the plan set itself, not to any runtime, and is unaffected by the absence of hosted environments.
- **Security ownership is unresolved.** P1-01-SEC-003 requires that security ownership be verified or that P1-EC-016 be recorded as blocking. Local-first does not satisfy this task and does not reduce its urgency. Row-Level Security is a core element of the approved technical direction, and a multi-tenant isolation model designed without an assigned security owner will carry that gap into the first hosted environment, where it becomes consequential rather than theoretical.
- **No compliance position is claimed.** No certification, attestation, or regulatory alignment is asserted for any environment. No environment has been assessed. Data residency is undetermined precisely because no region has been chosen, and this ADR does not imply that residency requirements have been analysed.
- **Branch protection is Blocked, not applied.** Because the GitHub CLI is not installed and no token is available, no enforced review control exists on `main` or `develop`. The security of the codebase currently depends on individual discipline rather than on a mechanism. This must be resolved before any promotion gate, since an unprotected branch feeding an automated deployment would be a material weakness.

## Operational Impact

Day-to-day operation in Phase 1-1 is confined to a single machine running Docker Desktop on the linux engine with 12 CPUs and approximately 16.5 GB RAM. That capacity is adequate for a modular monolith with a local PostgreSQL instance under Supabase, and it is the resource envelope against which local performance observations must be interpreted — no observation made there may be presented as evidence about hosted behaviour.

Operational specifics and their consequences:

- The Supabase CLI is not installed globally, but its version is pinned with the project rather than resolved at invocation time: `package.json` declares `supabase` at `^2.34.3` under `devDependencies`, `package-lock.json` locks the exact resolved version, and the npm scripts (for example `supabase:start`) call the bare binary, which resolves from `node_modules/.bin`. The effective CLI version is therefore determined by the committed lockfile and is reproducible across machines. The remaining toolchain readiness item under P1-01-DO-003 is the documentation pipeline tooling, not Supabase CLI version pinning.
- Only npm is available; no pnpm or yarn is installed. Local scripting and documentation must assume npm 11.13.0 on Node v24.16.0.
- There is no runtime to monitor, no uptime to measure, no incident to respond to, and no backup regime to operate, because no hosted system exists. Any operational readiness claim beyond the local developer loop would be false.
- No release process exists. There is no artefact registry, no versioned deployment, and no rollback path, because there is no target. Environment readiness under P1-01-DO-002 is limited to what the local toolchain demonstrably supports.
- The branch structure — `main` (bootstrap root commit a6e0af4, pushed), `develop` (pushed), and `chore/p1-01-development-readiness` as the Phase 1-1 working branch — is the whole of the promotion mechanism at present. Movement between branches is manual and unprotected.
- When a promotion gate is eventually opened, the operational work it implies is substantial and is not yet scoped: provisioning, secrets management, migration execution against a hosted database, backup and restore, observability, and an on-call position. None of it is estimated, and this ADR should not be read as implying that it is small.
- The canonical Word documents (`RootLco_Phase_1_Development_Plan_recovered_v01.docx` and `RootLco_Master_Project_Documentation.docx`) live outside this repository in the parent folder by owner decision and are deliberately not committed. Git documentation, including this ADR, is not a replacement canonical copy, and any environment statement here must remain consistent with those documents rather than override them.

## Related Phase 1 Task and Requirement IDs

| ID                      | Relationship to this ADR                                                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| P1-01-DO-002            | Verify environment readiness — the measured local facts on which this ADR rests                                                        |
| P1-01-DO-001            | Verify repository readiness — branch structure, the only promotion mechanism currently present                                         |
| P1-01-DO-003            | Documentation pipeline tooling readiness — constrained by the npm-only local toolchain with the Supabase CLI pinned as a devDependency |
| P1-01-DO-004            | Record team readiness — bears on the absence of independent QA and security ownership                                                  |
| P1-01-DOC-014           | Architecture Decision Register — the register in which this ADR is entered                                                             |
| P1-01-DOC-012           | Development-readiness checklist for the 22 entry criteria — where "Planned — not provisioned" must be stated                           |
| P1-01-QA-009            | Verify the development-readiness checklist — verification is limited to the Local environment                                          |
| P1-01-SEC-003           | Verify security ownership or record P1-EC-016 as blocking                                                                              |
| P1-01-SEC-004           | Classify Phase 1 plan set sensitivity and repository access control                                                                    |
| P1-01-SEC-005           | Verify no secrets or fabricated compliance claims — directly supported by refusing to describe unprovisioned environments              |
| P1-EC-016               | Entry criterion at risk of being recorded as blocking pending security ownership                                                       |
| P1-OOS-026              | Out-of-scope reference relevant to environment scope in Phase 1-1                                                                      |
| OIR-01                  | Open issue register entry covering the undecided hosting provider, region, and deployment platform                                     |
| ASM-01                  | Assumption register entry covering local-only development in advance of a hosting decision                                             |
| Phase 1-2               | First phase that could consume this decision; has not started                                                                          |
| Phase 1-2 .. Phase 1-39 | Downstream phases in which a promotion gate may be scheduled once an owner decision exists                                             |

## Decision Owner

**Technical scope** — local-first environment implementation, Docker-based local development, and the absence of a CD workflow in Phase 1-1: Eng. Ezzaldeen Al-Bitar (technical and IT owner, GitHub username `Ezzaldeen-Albitar`).

**Business, scope, and commercial scope** — selection of a cloud provider, a production region, and a deployment platform; authorisation of any promotion to a hosted environment; and the commercial and data-residency position implied by that selection: Eng. Ezzaldeen Al-Bitar and Eng. Bilal Jradat (jointly), as product owners and final business approval authority.

No approval has been granted for any hosted environment. Phase 1-1 is not passed.

## Date

2026-07-16
