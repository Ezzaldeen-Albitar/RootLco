# ADR-007: Docker-Based Local Development

## Status

Accepted by owner instruction.

The decision applies to the local development environment only. Container hosting for Development, Staging and Production remains Open, because no cloud provider, region or deployment platform has been approved. This ADR must not be read as an implicit approval of any deployment target.

## Context

RootLco (Root Link Company) is building [PRODUCT NAME — Pending Final Approval], a Commercial Multi-Tenant Automotive CRM and ERP Platform. The approved technical direction requires Docker from the beginning, alongside Next.js 16.2.10, React 19.2.4, TypeScript 5 (strict), Supabase, PostgreSQL with Row-Level Security, a modular monolith structure and a database-first implementation approach.

Phase 1-1, "Source-of-Truth Validation and Development Readiness", includes P1-01-DO-002 (verify environment readiness). The measured host environment is:

| Item                         | Measured value                                                              |
| ---------------------------- | --------------------------------------------------------------------------- |
| Docker Engine                | 29.5.3                                                                      |
| Docker Compose               | v5.1.4                                                                      |
| Docker Desktop backend       | linux engine                                                                |
| Host CPUs                    | 12                                                                          |
| Host memory                  | approximately 16.5 GB                                                       |
| Node.js                      | v24.16.0                                                                    |
| npm                          | 11.13.0                                                                     |
| Alternative package managers | none installed (no pnpm, no yarn)                                           |
| Supabase CLI                 | pinned project devDependency (`supabase` `^2.34.3`); not installed globally |

The platform depends on PostgreSQL with Row-Level Security policies that are central to tenant isolation. Correct behaviour cannot be established by reading code alone; it requires a running database whose extensions, roles, search paths and policy evaluation match what will eventually run in a managed environment. Installing PostgreSQL, the Supabase service set and their dependencies natively on each developer machine would make that database state a property of the individual workstation rather than a property of the repository.

The development team is currently very small. Eng. Ezzaldeen Al-Bitar is the technical and IT owner and presently executes the technical tests; independent QA ownership is not assigned. This is recorded openly as a conditional-gate item rather than treated as resolved. A small team reduces the coordination cost of divergent local setups today, but it also means there is no second engineer available to reconstruct a broken environment from memory. Reproducibility therefore matters more, not less.

Benzene Vehicle Services (بنزين لخدمات المركبات) is the first customer, first subscribed tenant and first pilot. It is onboarded through configuration and seed data only. The local environment must be able to load and reset that seed data repeatedly without any tenant-specific code path, so that the no-hard-coding rule is demonstrable rather than asserted. Zoom Vehicle Inspection and Evaluation Services is outside Phase 1; no local service, image, volume or seed data is provisioned for it.

## Decision

Local development runs in Docker, using Docker Compose for orchestration, from Phase 1-1 onward. The following specific choices form part of this decision.

**Application image structure.** A single multi-stage `Dockerfile` defines four stages:

| Stage    | Purpose                                                                                                                                         |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `deps`   | Installs dependencies from `package.json` and `package-lock.json` only, so that the dependency layer is cached independently of source changes. |
| `dev`    | Extends `deps` for interactive development; runs the Next.js development server with file watching.                                             |
| `build`  | Produces the compiled Next.js output.                                                                                                           |
| `runner` | Minimal image containing only the build output and the runtime dependencies required to serve it.                                               |

**Non-root runtime.** The `runner` stage creates and switches to an unprivileged user. The container does not run as `root`.

**Named volumes for build and dependency directories.** `node_modules` and `.next` are mounted as named Docker volumes rather than being served from the Windows host through the bind mount. Application source is bind-mounted so that edits on the host are visible in the container.

**Health checks.** The project's Compose file defines a single service, `web`, and that service declares one health check, which curls `/api/health` with a `start_period` long enough to survive the first slow development compile. No database service is defined in that file, so it declares no database health check and no `condition: service_healthy` dependency anywhere. The Supabase CLI manages the health and readiness of its own containers; the project's Compose file neither defines nor sequences them. Because the two stacks are started independently — `npm run dev:up` runs Compose, then the CLI — the `web` container can start before Supabase is ready. That is handled at the application layer rather than by Compose sequencing: while Supabase configuration has not resolved, the health endpoint reports `degraded` with HTTP 503 rather than reporting itself healthy. Cross-stack start-up ordering is recorded as a known limitation to revisit, not as a solved problem.

**No secrets baked into images.** No credential, key, token or connection string is written into any image layer, `Dockerfile` instruction, or build argument. Configuration is supplied at runtime through environment variables sourced from an uncommitted local `.env` file; a committed `.env.example` documents the required variable names with placeholder values only. This is consistent with P1-01-SEC-005.

**Supabase local services.** PostgreSQL, GoTrue, PostgREST, Realtime, Storage and Studio are not defined by hand in the project's Compose file. They are started and managed by the Supabase CLI, which runs its own Docker stack. The CLI is a pinned project devDependency invoked from `node_modules/.bin`; it is not installed globally. The two stacks do not share a Docker network: the Supabase CLI publishes its services on the host (127.0.0.1:54321 and related ports), and the application container reaches them through `host.docker.internal`, made resolvable on all platforms by the `extra_hosts: host-gateway` entry in the project Compose file. This keeps the local service versions aligned with what the Supabase CLI pins, rather than with a hand-maintained and silently drifting copy.

**Docker Desktop resource allocation.** The recommendations below are starting points derived from the measured host of 12 CPUs and approximately 16.5 GB of RAM. They are not benchmark results and have not been validated under sustained load, because no such measurement has been performed.

| Resource        | Suggested starting allocation | Reasoning                                                                                                                                                                                           |
| --------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CPUs            | 6 of 12                       | Leaves headroom for the host operating system, editor and browser, which are not trivial consumers on Windows.                                                                                      |
| Memory          | 8 GB of approximately 16.5 GB | The Supabase stack runs several containers concurrently alongside the Next.js development server. Allocating more than half of host memory to the Docker virtual machine risks host-level pressure. |
| Swap            | 1–2 GB                        | Absorbs transient spikes during builds without masking a genuine memory shortfall.                                                                                                                  |
| Disk image size | 60 GB or more                 | Image layers, named volumes and the Supabase stack accumulate; running out of disk in Docker Desktop produces failures that are difficult to diagnose.                                              |

These figures should be revised on the basis of observed behaviour. If a developer's host differs materially from the measured machine, the allocation must be reconsidered rather than copied.

## Alternatives Considered

**Alternative 1 — Native local installation of Node.js, PostgreSQL and the Supabase services.**

Rejected. This approach makes correctness dependent on each workstation's installed PostgreSQL major version, extension availability, locale and collation settings, and role configuration. Row-Level Security is the primary tenant-isolation mechanism for this platform; a policy that behaves correctly against one locally installed PostgreSQL build and differently against another is a defect class that would be discovered late and attributed to the wrong cause. The approach also produces environment state that cannot be version-controlled, reviewed or reset, which conflicts directly with the database-first implementation approach. It is fair to acknowledge that a native installation would avoid the filesystem overhead discussed under Consequences, and would generally be faster on this Windows host. That performance advantage was judged insufficient to offset the loss of reproducible database state.

**Alternative 2 — Cloud-hosted Supabase project used as the shared development database, with the application run natively.**

Rejected for Phase 1. It would introduce a hosted dependency before the owner has approved any cloud provider or region, which would contradict the position that hosting decisions remain Open. It would also place real project credentials on developer workstations from the first day of Phase 1-1, expanding the secret-handling surface at precisely the point where P1-01-SEC-005 requires that no secrets be present. Operationally, a shared remote database makes destructive migration testing and repeated seed resets hazardous, because one developer's reset affects everyone. Offline and intermittent-connectivity work would also become impossible. A hosted Supabase project may well be appropriate for a future Development or Staging environment; that question is deliberately left Open and is not settled here.

**Alternative 3 — Dev Containers or a full WSL2-native workflow without Docker Compose orchestration.**

Rejected as the primary mechanism, though not rejected in principle. A WSL2-native workflow would materially reduce the filesystem overhead described below. However, it moves the definition of the environment out of the repository and into each developer's WSL distribution, which reintroduces the divergence problem that Alternative 1 was rejected for. Dev Containers layer an editor-specific configuration on top of Docker; they may be added later as a convenience over the Compose definition established here, but they are not a substitute for it and would create an editor dependency that the project does not currently have.

## Consequences

**Positive.**

- The environment is defined in files that are reviewed, versioned and reproducible. A new machine reaches a working state by cloning the repository and running Compose, not by following a document.
- Local PostgreSQL matches the version, extensions and configuration that the Supabase CLI pins, which raises confidence that Row-Level Security policies observed locally reflect real evaluation semantics.
- Parity between local development and any future containerised deployment target is established at the outset rather than retrofitted, which is the usual point at which such work becomes expensive.
- Benzene Vehicle Services seed data can be loaded, reset and reloaded on demand, making it practical to demonstrate that no tenant-specific behaviour has been hard-coded.
- The `runner` stage's non-root user and minimal contents reduce the eventual runtime attack surface, and the discipline is established before there is production code to retrofit.

**Negative and trade-offs. These are real costs, accepted with open eyes.**

- **Docker does not make development faster, and on this host it will make parts of it slower.** Containerisation buys reproducibility and parity. It does not buy performance. On Windows, file operations crossing the host-to-container bind-mount boundary carry a translation cost that native filesystem access does not. Dependency installation, Next.js compilation and hot-module reload are all sensitive to this. Using named volumes for `node_modules` and `.next` is a direct mitigation — it keeps the highest-churn, highest-file-count directories inside the Docker filesystem — but it is a mitigation, not a cure. Source file changes still traverse the bind mount, and watch latency may remain noticeably worse than a native setup. No party should be told that Docker improved local performance, because on the evidence available it will not.
- The named-volume approach introduces a genuine failure mode: `node_modules` inside the volume can fall out of step with `package.json` on the host after a branch switch or a dependency change. The symptom is a confusing module-resolution error rather than an obvious one. Recovery requires removing and repopulating the volume, and developers must be told this explicitly.
- Memory consumption is substantial. The Supabase CLI stack runs several containers; together with the Next.js development server and Docker Desktop's own virtual machine overhead, an approximately 16.5 GB host is adequate but not generous. Running the stack alongside other memory-intensive applications is likely to degrade the whole machine.
- Debugger attachment, profiling and editor tooling require additional configuration to reach a process inside a container. This is a one-time cost, but it is not zero, and it falls on the same person who is currently also executing the technical tests.
- The project acquires a dependency on Docker Desktop's licensing terms and release cadence. This is not currently a constraint but is recorded as a dependency rather than left implicit.
- Multi-stage builds and Compose orchestration add configuration that must itself be maintained and reviewed. The environment definition becomes a component of the system, with its own defect surface.
- Container image freshness becomes an ongoing obligation. A base image pinned once and never revisited accumulates unpatched vulnerabilities silently. No scanning process is currently in place; see Security Impact.

## Security Impact

- **Secrets.** No secret is present in any image layer, build argument or committed file. Values are injected at runtime from an uncommitted `.env`; `.env.example` carries variable names and placeholders only. `.env` and `.env.*.local` are excluded via `.gitignore`. This supports P1-01-SEC-005, which requires verification that no secrets and no fabricated compliance claims are present. Nothing in this ADR should be read as evidence that such verification has been completed; the task is defined, not passed.
- **Non-root runtime.** The `runner` stage runs as an unprivileged user, limiting what a compromised process can do inside its container.
- **Repository classification.** The Compose and Dockerfile definitions reside in the private repository at github.com/Ezzaldeen-Albitar/RootLco, classified "Confidential — Commercial Product and Pilot Planning". P1-01-SEC-004 governs classification and repository access control.
- **No compliance claim is made.** Running services in containers is not a security control in itself and confers no certification, attestation or compliance status of any kind. No such status has been achieved.
- **Local exposure.** The Supabase CLI stack binds ports on the developer's machine, including a database port and Studio. On an untrusted network this constitutes local exposure. Bindings should be restricted to the loopback interface. This has not been independently reviewed.
- **Image vulnerability scanning.** No base-image scanning or update process is currently defined. This is an open gap, not a solved problem, and it is recorded here so that it is not overlooked when container hosting is eventually decided.
- **Security ownership.** P1-01-SEC-003 requires that security ownership be verified or that P1-EC-016 be recorded as blocking. This ADR does not resolve that question and does not assert any security sign-off.

## Operational Impact

- Docker Desktop with the linux engine is required on every development workstation. The measured host runs Docker Engine 29.5.3 and Docker Compose v5.1.4.
- Supabase local services are started through the Supabase CLI, installed with the project as a pinned devDependency. Developers therefore require network access on first install (`npm ci`) to fetch the CLI, and on first start to pull the Supabase images.
- npm is the package manager. pnpm and yarn are not installed and must not be introduced without a separate decision.
- The `web` service declares a health check against `/api/health`, but Compose does not sequence start-up against Supabase: the Supabase CLI stack is not defined in the project's Compose file, and the two stacks are started independently. The `web` container can therefore start before Supabase is ready; in that window the health endpoint reports `degraded` with HTTP 503 rather than healthy. Cross-stack start-up ordering remains a known limitation to revisit. First start is materially slower than subsequent starts because images must be pulled and volumes populated.
- Only the Local environment is being implemented. Development, Staging and Production are Planned — not provisioned. No environment beyond Local exists.
- No container registry, orchestration platform, cloud provider or region has been approved. Those remain Open. This ADR governs local development and confers no approval on any deployment target.
- Independent QA ownership is not assigned; technical tests are currently executed by Eng. Ezzaldeen Al-Bitar. The container environment does not mitigate this gap, and it is recorded openly as a risk and conditional-gate item.
- No test suite, pipeline or environment described here has been executed or verified to pass. Phase 1-1 is not passed and Phase 1-2 has not started.
- The two canonical Word documents (RootLco_Phase_1_Development_Plan_recovered_v01.docx and RootLco_Master_Project_Documentation.docx) reside outside this repository in the parent folder by owner decision and are deliberately not committed. This ADR is supporting Git documentation and is not a canonical replacement for them.

## Related Phase 1 Task and Requirement IDs

| ID            | Relationship to this ADR                                                                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-01-DO-002  | Verify environment readiness. The measured Docker, Node.js and npm facts cited here are the input to this task.                                                         |
| P1-01-DO-001  | Verify repository readiness. The Dockerfile, Compose file, `.env.example` and `.gitignore` entries described here are repository artefacts.                             |
| P1-01-DO-003  | Documentation pipeline tooling readiness. Any containerised documentation tooling would follow the pattern set here.                                                    |
| P1-01-DO-004  | Record team readiness. Docker Desktop resource allocation and the named-volume failure mode are matters the team must be briefed on.                                    |
| P1-01-DOC-014 | Produce the Architecture Decision Register. This ADR is a member of that register.                                                                                      |
| P1-01-DOC-012 | Development-readiness checklist for the 22 entry criteria. Local containerised development bears on the environment-related criteria.                                   |
| P1-01-QA-009  | Verify the development-readiness checklist. Not executed; no verification is claimed.                                                                                   |
| P1-01-SEC-005 | Verify no secrets or fabricated compliance claims. Directly relevant to the no-secrets-in-images decision.                                                              |
| P1-01-SEC-004 | Classify Phase 1 plan set sensitivity and repository access control. Governs the classification of the artefacts described here.                                        |
| P1-01-SEC-003 | Verify security ownership or record P1-EC-016 as blocking. Unresolved.                                                                                                  |
| P1-EC-016     | Security ownership entry criterion. Referenced by P1-01-SEC-003 and not resolved by this ADR.                                                                           |
| P1-OOS-026    | Out-of-scope item. Zoom Vehicle Inspection and Evaluation Services is outside Phase 1; no local container, volume or seed data is provisioned for it.                   |
| OIR-01        | Open issue register entry covering matters left Open, including container hosting, cloud provider, region and deployment platform.                                      |
| ASM-01        | Assumption register entry. The Docker Desktop resource figures above are a starting-point assumption based on the measured host and have not been validated under load. |
| Phase 1-2     | Not started. Any use of this environment in subsequent phases is contingent on Phase 1-1 being passed, which it has not been.                                           |

## Decision Owner

Eng. Ezzaldeen Al-Bitar (technical and IT owner) for the technical decision recorded in this ADR: Docker-based local development, the multi-stage image structure, non-root runtime, named-volume strategy, health checks, secret handling and the use of the Supabase CLI Docker stack.

Eng. Ezzaldeen Al-Bitar and Eng. Bilal Jradat (jointly) for any business, scope or commercial consequence arising from this decision, including tooling cost or licensing obligations, and for the still-Open questions of container hosting, cloud provider, region and deployment platform. Those questions are not decided here and remain Open pending joint approval.

## Date

2026-07-16
