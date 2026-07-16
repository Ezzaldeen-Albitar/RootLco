# ADR-003: Supabase and PostgreSQL Data Platform

## Status

Accepted by owner instruction — for the data platform technology selection (PostgreSQL as the database, Supabase as the surrounding platform, Row-Level Security as the tenant isolation mechanism, and the official Supabase CLI Docker-based local stack as the Local development environment).

Open — for the hosted Supabase project, its cloud region, and its commercial plan. No hosting provider, production region, or deployment platform has been approved by the owners. This ADR does not approve one and must not be cited as approval.

## Context

RootLco (Root Link Company) is building the Commercial Multi-Tenant Automotive CRM and ERP Platform, whose software product name is recorded as [PRODUCT NAME — Pending Final Approval] until final business approval. The approved technical direction, accepted by owner instruction, names Supabase, PostgreSQL, Row-Level Security, a modular monolith, Docker from the beginning, and a database-first implementation approach. This ADR records the reasoning behind the data platform element of that direction and, more importantly, fixes how the platform is to be obtained and operated locally during Phase 1.

Several forces shape the decision:

1. **Database-first implementation.** The agreed approach places the database schema, constraints, and policies ahead of application code. This requires a database engine with mature declarative constraints, transactional DDL, and a migration story that can be version-controlled and replayed deterministically.
2. **Multi-tenant, multi-company, multi-branch isolation.** Tenant isolation is to be enforced in the database rather than solely in application code. PostgreSQL Row-Level Security provides that enforcement point. Benzene Vehicle Services (بنزين لخدمات المركبات) is the first customer and first subscribed tenant; it is onboarded through configuration and seed data only and is never hard-coded, never a platform owner, and never a schema-level special case.
3. **Configuration-driven behaviour.** No tenant-specific hard-coding is permitted. This pushes tenant identity, branch structure, and behavioural switches into data, which in turn raises the importance of the database as the authoritative source of behaviour.
4. **Local-only environment reality.** Only the Local environment is being implemented. Development, Staging, and Production are Planned — not provisioned. The data platform decision must therefore be reversible with respect to hosting: nothing in Phase 1 may assume a hosted Supabase project exists.
5. **Measured environment capacity.** The verified local environment is Docker Engine 29.5.3, Docker Compose v5.1.4, Docker Desktop on the linux engine, 12 CPUs and approximately 16.5 GB RAM, with Node v24.16.0 and npm 11.13.0. The Supabase CLI is not installed globally; it is a pinned project devDependency (`supabase` `^2.34.3`, locked by `package-lock.json`) invoked from `node_modules/.bin`. A multi-container Supabase stack is within this machine's capacity, but not without cost — see Consequences.

Zoom Vehicle Inspection and Evaluation Services is outside Phase 1. No Phase 1 schema, migration, policy, table, or seed record may be created for it.

## Decision

The following is decided:

1. **PostgreSQL is the database of record** for the platform. All persistent business state lives in PostgreSQL.
2. **Supabase is the platform layer** around PostgreSQL, providing authentication, the generated data API, storage, and the migration tooling used by the project.
3. **Tenant isolation is enforced by PostgreSQL Row-Level Security**, with tenant, company, and branch scoping expressed as database policies rather than as application-layer filters alone. Application-layer checks are defence in depth, not the primary control.
4. **The Local environment is to be provisioned exclusively through the official Supabase CLI**, invoked from the project-pinned devDependency in `node_modules/.bin` (no global installation is assumed), which manages its own Docker Compose stack. This states the rule for how provisioning is to be done; it is not a claim that the stack has been provisioned. The project does not author, fork, or maintain a hand-rolled `docker-compose.yml` describing Supabase services.
5. **Schema changes are made only through CLI-managed migration files** committed to the repository. Changes applied by hand to a running local database and not captured as a migration are treated as defects.
6. **Benzene Vehicle Services is introduced as seed and configuration data only.** There is to be no `benzene` table, column, enum value, migration, or conditional branch anywhere in the schema.
7. **The hosted Supabase project, region, and plan remain an open decision** and are explicitly excluded from this ADR's accepted scope.

### Why the official CLI rather than a hand-rolled Supabase container stack

The alternative of assembling the Supabase services directly — Postgres, GoTrue, PostgREST, Realtime, Storage, Kong, the Studio image, the analytics and pooler components — into a project-owned Compose file was considered and rejected for the following concrete reasons:

- **Version coherence.** Supabase ships its services as a tested set. A hand-rolled Compose file makes each service version an independent decision, and the failure mode is a locally green stack that diverges from any hosted stack in ways that surface late, typically in authentication or in policy evaluation.
- **Migration and policy tooling.** `supabase migration new`, `supabase db diff`, `supabase db reset`, and `supabase db push` are the CLI's own contract. Reimplementing an equivalent flow around a bespoke stack means writing and then maintaining project-specific tooling that delivers no product value.
- **Auth wiring is the expensive part.** The JWT signing keys, the `anon` and `service_role` roles, the `auth.uid()` and `auth.jwt()` helpers, and the role grants that Row-Level Security policies depend upon are configured by the CLI. Since the tenant isolation model rests directly on those helpers, getting them subtly wrong by hand is a security defect, not an inconvenience.
- **Maintenance burden falls on a single engineer.** Technical and IT ownership rests with Eng. Ezzaldeen Al-Bitar alone. A bespoke stack is a standing maintenance liability against a single point of capacity.
- **Reversibility.** The CLI workflow keeps the local stack close to the shape of a hosted Supabase project, which preserves the option to adopt hosted Supabase later without a rewrite — while not requiring that decision now.

The trade-off accepted is a dependency on the CLI's release cadence and on its opinions about the local stack. This is recorded, not waved away.

## Alternatives Considered

| Alternative                                                                                                                                     | Why rejected                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hand-rolled Supabase container stack** (project-owned Compose file assembling GoTrue, PostgREST, Realtime, Storage, Kong and Studio directly) | Rejected. It transfers version-coherence, auth wiring, and migration tooling from an upstream-maintained contract to a single engineer with no independent QA cover. The failure modes cluster in exactly the area the tenant isolation model depends on — JWT claims and the `auth.*` helper functions consumed by Row-Level Security policies. The cost is paid continuously and yields no product capability the CLI does not already provide.                                     |
| **Plain PostgreSQL in Docker, with authentication and the data API built in the application**                                                   | Rejected. It is the leanest local stack and would run comfortably within the measured 12 CPU / ~16.5 GB environment, but it discards the accepted technical direction and requires the project to build and secure its own authentication, token issuance, and session handling. For a commercial multi-tenant product, hand-built authentication is a disproportionate risk to carry, particularly with technical tests currently executed by the same engineer who writes the code. |
| **A managed relational service from a general cloud provider** (for example a managed PostgreSQL instance behind a bespoke API layer)           | Rejected for Phase 1. It presupposes an approved cloud provider and region. No provider or region has been approved by the owners, so selecting one here would be a fabricated approval. It also provides the database without the authentication and API layer, leaving the same build-it-yourself gap as the plain-PostgreSQL option.                                                                                                                                               |
| **A document database** (for example MongoDB) with tenant scoping in application code                                                           | Rejected. Tenant isolation would move out of the database and into application code, contradicting the decision to enforce isolation at the data layer. The relational constraints, transactional DDL, and declarative policies that make a database-first approach tractable are not available in an equivalent form.                                                                                                                                                                |
| **Hosted Supabase project used directly for development, with no local stack**                                                                  | Rejected. It would make every developer action depend on a hosted project that has not been approved and does not exist, contradicts the Docker-from-the-beginning direction accepted by owner instruction, and creates a live shared database with no environment separation while Development, Staging, and Production remain Planned — not provisioned.                                                                                                                            |

## Consequences

### Positive

- Tenant isolation has a single authoritative enforcement point in the database, which is auditable independently of application code.
- The local stack is to become reproducible from the repository: once migrations are committed from Phase 1-2 onward, a clone plus the CLI will reconstruct the schema deterministically from those migrations. `supabase/migrations/` is currently empty, so this benefit is prospective and not yet realised.
- The schema, policies, and seed data become reviewable artefacts in Git, which supports the database-first approach in practice rather than only in principle.
- Configuration-driven tenant onboarding is directly expressible, so Benzene Vehicle Services can be introduced and, in due course, additional tenants, without schema change.
- The option to adopt hosted Supabase later is preserved without committing to it now.

### Negative and trade-offs

- **The project inherits the Supabase CLI's opinions and cadence.** Local stack composition, service versions, and the migration workflow are upstream decisions. A breaking upstream change is absorbed, not avoided.
- **Row-Level Security is easy to get wrong and expensive to get wrong.** A missing or over-permissive policy is a cross-tenant data exposure. This risk is amplified because independent QA ownership is not assigned and technical tests are currently executed by Eng. Ezzaldeen Al-Bitar, the same person writing the policies. This is recorded as a conditional-gate item, not mitigated by this ADR.
- **Row-Level Security carries a query-planning cost.** Policies are applied per row and interact with indexing in ways that require deliberate index design. This has not been measured; no performance claim is made here.
- **The local stack is resource-hungry.** The Supabase CLI stack runs a substantial number of containers. The measured 12 CPU / ~16.5 GB environment is expected to accommodate it alongside the application, but this has not been benchmarked and no claim is made that it has been.
- **The CLI is pinned and local, but not global, and its installation needs the network.** The Supabase CLI is a project devDependency (`"supabase": "^2.34.3"`), the exact version is locked by `package-lock.json`, and the scripts invoke the bare binary resolved from `node_modules/.bin` rather than through `npx`. Version pinning is therefore a completed control, not a follow-up item. Two residual points remain: the CLI is still not installed globally, so a network fetch is required on first install (and on any cold `node_modules`); and the caret range permits minor or patch drift on a fresh install where the lockfile is not respected — `npm ci` always respects it, so the drift window is confined to installs that do not use it.
- **Coupling to Supabase-specific constructs.** Use of `auth.uid()`, `auth.jwt()`, the `anon` and `service_role` roles, and the generated data API creates real switching cost away from Supabase, even though PostgreSQL itself remains portable. This coupling is accepted knowingly.
- **The open hosting decision leaves a planning gap.** Backup, retention, disaster recovery, data residency, and cost cannot be settled while the hosted project, region, and plan are undecided. Any Phase 1 document asserting these is asserting something that has not been decided.

## Security Impact

- **Tenant isolation is a security control, not a feature.** Row-Level Security policies are the primary boundary between tenants. Every table holding tenant-scoped data requires Row-Level Security enabled and an explicit policy; a table with Row-Level Security enabled and no policy denies by default, whereas a table with Row-Level Security not enabled silently exposes every row. The default-open failure mode of the second case is the principal hazard of this decision.
- **Service-role credentials bypass Row-Level Security by design.** Any use of the `service_role` key defeats the isolation model for the duration of that connection. Its use must be confined to narrowly justified server-side paths and must never reach client code.
- **No secrets in the repository.** The CLI's local stack generates development keys. These are local development values and must not be presented as production credentials, and no key, token, connection string, or password may be committed. This is subject to verification under P1-01-SEC-005, which also covers the prohibition on fabricated compliance claims. No compliance certification of any kind is claimed for the data platform.
- **Repository classification.** The repository is private and classified "Confidential — Commercial Product and Pilot Planning". Schema, policy, and seed material carry that classification, addressed under P1-01-SEC-004.
- **Security ownership is not confirmed.** Security ownership for Phase 1 is subject to P1-01-SEC-003; where it cannot be confirmed, P1-EC-016 is to be recorded as blocking. This ADR does not resolve that and must not be read as resolving it.
- **Independent review of policies is absent.** There is currently no independent reviewer of Row-Level Security policies. This is a stated gap, carried openly as a risk.

## Operational Impact

- **Local environment only.** The Supabase CLI stack is the Local environment. Development, Staging, and Production remain Planned — not provisioned. No environment other than Local exists at the time of writing.
- **Prerequisites.** Docker Desktop must be running before the local stack starts. The verified toolchain is Docker Engine 29.5.3, Docker Compose v5.1.4, Node v24.16.0, npm 11.13.0, with the Supabase CLI installed as a pinned project devDependency. Environment readiness is verified under P1-01-DO-002; repository readiness under P1-01-DO-001.
- **First-run cost.** The initial start pulls the full set of Supabase service images. This is a substantial download and is a documented expectation for onboarding, not a defect.
- **Migration discipline.** All schema change flows through committed migration files. A local database reset must reconstruct the full schema and seed data from the repository with no manual steps. Any drift between a running local database and the committed migrations is a defect.
- **Seed data carries the pilot tenant.** Benzene Vehicle Services exists in seed and configuration data. Onboarding a further tenant must require no migration and no code change; if it does, the configuration-driven requirement has been violated.
- **Backup and recovery are undefined.** Local data is disposable. Backup, retention, and recovery for any non-local environment cannot be specified while the hosting decision is open, and nothing in this ADR should be read as a backup or recovery commitment.
- **Branch protection and Pull Request enforcement are Blocked.** The GitHub CLI is not installed and no GitHub token is available, so migration changes cannot currently be gated by an enforced review workflow. This is Blocked, not applied, and it directly weakens the review protection that would otherwise sit in front of schema and policy changes.
- **No test has passed.** No claim is made that the local stack has been started successfully, that any migration has been applied, or that any policy has been verified. Phase 1-1 is not passed and Phase 1-2 has not started.

## Related Phase 1 Task and Requirement IDs

| ID            | Relationship to this ADR                                                                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-01-DOC-014 | This ADR is an entry in the Architecture Decision Register produced under this task.                                                                                    |
| P1-01-DO-001  | Repository readiness — migrations, seed data, and local stack configuration must be present and readable in the repository.                                             |
| P1-01-DO-002  | Environment readiness — Docker, Node, npm, and the project-pinned Supabase CLI devDependency underpin the local stack decided here.                                     |
| P1-01-DO-003  | Documentation pipeline tooling readiness — this ADR is a product of that pipeline.                                                                                      |
| P1-01-DO-004  | Team readiness — records that technical ownership and test execution rest with a single engineer, which is a stated risk factor for the Row-Level Security policy work. |
| P1-01-DOC-012 | Development-readiness checklist for the 22 entry criteria — the data platform prerequisites feed this checklist.                                                        |
| P1-01-QA-009  | Verification of the development-readiness checklist, including the data platform entries.                                                                               |
| P1-01-SEC-003 | Security ownership verification, or recording of P1-EC-016 as blocking.                                                                                                 |
| P1-01-SEC-004 | Classification of the Phase 1 plan set and repository access control, covering schema and policy material.                                                              |
| P1-01-SEC-005 | Verification that no secrets and no fabricated compliance claims are present, including local Supabase development keys.                                                |
| P1-EC-016     | Entry criterion recorded as blocking where security ownership is not confirmed; relevant because the isolation model decided here is a security control.                |
| P1-OOS-026    | Out-of-scope record covering Zoom Vehicle Inspection and Evaluation Services — no Phase 1 schema, migration, table, policy, or seed record is created for it.           |
| OIR-01        | Open item: the hosted Supabase project, cloud region, and commercial plan remain undecided; no provider, region, or deployment platform is approved.                    |
| ASM-01        | Assumption: the measured local environment (12 CPUs, approximately 16.5 GB RAM) is sufficient to run the Supabase CLI stack alongside the application. Not benchmarked. |
| Phase 1-2     | Downstream phase that will consume the schema and policy foundation decided here. Not started.                                                                          |

## Decision Owner

Eng. Ezzaldeen Al-Bitar (technical and IT owner) — for the technical decisions recorded here: PostgreSQL as the database, Supabase as the platform layer, Row-Level Security as the isolation mechanism, and the official Supabase CLI Docker-based local stack as the Local environment.

Eng. Ezzaldeen Al-Bitar and Eng. Bilal Jradat (jointly) — for the open commercial and scope matters touched by this ADR: the hosted Supabase project, its cloud region, and its commercial plan; and the confirmation that the tenant model treats Benzene Vehicle Services solely as the first subscribed tenant, never as a platform owner.

## Date

2026-07-16
