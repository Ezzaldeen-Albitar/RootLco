# RootLco

Repository of **RootLco — Root Link Company**.

**Confidential and proprietary.** Commercial product source and documentation. Not for public distribution.

|                             |                                                         |
| --------------------------- | ------------------------------------------------------- |
| Company / software owner    | RootLco — Root Link Company                             |
| Technical and IT owner      | Eng. Ezzaldeen Al-Bitar                                 |
| Product owners              | Eng. Ezzaldeen Al-Bitar; Eng. Bilal Jradat              |
| Software product name       | `[PRODUCT NAME — Pending Final Approval]`               |
| Temporary descriptive title | Commercial Multi-Tenant Automotive CRM and ERP Platform |
| Classification              | Confidential — Commercial Product and Pilot Planning    |

RootLco is the company, vendor, and platform owner. RootLco is **not** the software product name.

## Phase status

**Phase 1-1 (development readiness): technical work complete, submitted for owner gate review.**
The gate decision has not been recorded. **Phase 1-2 has not started** and remains blocked
until the owners record Go or Conditional Go on
[docs/phase-1/phase-1-1/phase-1-1-owner-gate.md](docs/phase-1/phase-1-1/phase-1-1-owner-gate.md).
The full evidence corpus lives in [docs/phase-1/phase-1-1/](docs/phase-1/phase-1-1/).

No business functionality exists yet: no CRM, vehicle, work-order, inventory, billing, or
pilot code, and no business database tables. Row-Level Security is a mandatory Phase 1-2
gate ([ADR-004](docs/adr/ADR-004-mandatory-row-level-security-direction.md)) — no tenant
tables exist, so no RLS test has run.

## Approved technology stack (verified versions)

| Layer             | Choice                                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Application       | Next.js 16.2.10 (App Router), React 19.2.4, TypeScript 5 (strict)                                                                 |
| Styling           | Sass 1.101.0 (SCSS, `@use`/`@forward` only) — see [ADR-013](docs/adr/ADR-013-sass-and-scss-styling-architecture.md); Stylelint 17 |
| Data platform     | Supabase (official CLI local stack), PostgreSQL 17.6, mandatory RLS direction                                                     |
| Architecture      | Modular monolith, multi-tenant / multi-company / multi-branch, configuration-driven (no tenant hard-coding)                       |
| Local environment | Docker (multi-stage, non-root) from Phase 1-1                                                                                     |
| Quality           | ESLint 9, Prettier 3, Vitest 3, Stylelint 17, GitHub Actions CI (definition)                                                      |

Not adopted (open decisions — [register](docs/adr/README.md)): a utility framework or
component library (e.g. Tailwind CSS, shadcn/ui), the hosted Supabase project/region/plan,
any deployment platform or cloud provider, the product name, and brand colours (all colour
tokens are neutral defaults pending design approval).

## Repository structure

```
src/
  app/            Next.js App Router (health endpoint, foundation page)
  modules/        domain modules — intentionally empty until Phase 1-2
  shared/         cross-cutting components/types/validation/errors/constants
  lib/            supabase clients, logging (with secret redaction)
  config/         validated environment access (never echoes values)
  styles/         SCSS foundation: abstracts / base / themes / utilities
supabase/         config.toml, migrations/ (empty by design), seed.sql (no-op), tests/
docs/
  adr/            Architecture Decision Register (ADR-001..013)
  standards/      styling-and-sass.md
  governance/     canonical-documents.md (external source-of-truth record)
  phase-1/        Phase 1-1 evidence corpus and owner gate
scripts/          validate-canonical-documents.mjs, git-push-retry.sh
.github/          CI workflow, PR/issue templates
```

## Prerequisites

- **Docker Desktop** (running) — the local platform is Docker-based by owner instruction.
- **Node.js 22+** and **npm 10+** on the host (container runtime is pinned to Node 22).
- Windows is the primary development platform; the setup avoids machine-specific absolute
  paths and works on macOS/Linux (`extra_hosts: host-gateway` covers Linux).

## Quick start

```bash
git clone git@github.com:Ezzaldeen-Albitar/RootLco.git && cd RootLco
npm ci
cp .env.example .env.local
npm run supabase:start      # first run pulls images
npm run supabase:status     # copy ANON_KEY into .env.local (NEXT_PUBLIC_SUPABASE_ANON_KEY)
npm run dev:up              # builds and starts the web container
# verify:
curl http://localhost:3000/api/health   # {"status":"ok",...}
```

Supabase Studio: <http://127.0.0.1:54323> · API: <http://127.0.0.1:54321> · App: <http://localhost:3000>

## Commands

| Command                                                | Purpose                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------ |
| `npm run dev`                                          | host-native dev server (Turbopack)                                 |
| `npm run dev:up` / `dev:down`                          | start / stop the Docker dev environment (app + Supabase)           |
| `npm run dev:logs`                                     | follow the web container logs                                      |
| `npm run dev:reset`                                    | destroy app container + volumes, rebuild, reset the local database |
| `npm run supabase:start` / `stop` / `status` / `reset` | manage the Supabase CLI stack                                      |
| `npm run lint` / `typecheck`                           | ESLint / strict TypeScript                                         |
| `npm run format` / `format:check`                      | Prettier                                                           |
| `npm run style:lint` / `style:check` / `style:fix`     | Stylelint over `src/**/*.scss`                                     |
| `npm test` / `test:watch` / `test:coverage`            | Vitest                                                             |
| `npm run build`                                        | production build (compiles SCSS)                                   |
| `npm run verify`                                       | lint + typecheck + format + style + tests + build                  |
| `npm run validate:canonical-docs`                      | integrity-check the external canonical Word documents              |

## Styling

Sass/SCSS is the approved styling foundation: central design tokens generate the `:root`
CSS custom properties, SCSS Modules scope component styles, and RTL/LTR safety is
machine-enforced through logical properties (Stylelint rejects physical `margin-left`-style
declarations). Read [docs/standards/styling-and-sass.md](docs/standards/styling-and-sass.md)
before writing any styles. SCSS uses **relative** `@use` paths — the TypeScript `@/` alias
is not reliable inside Sass under Turbopack.

## Troubleshooting

| Symptom                                                | Cause and fix                                                                                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web container crash-loops with `EACCES ... /app/.next` | Stale root-owned named volume from an older image. `docker compose down && docker volume rm rootlco_web_next_cache && npm run dev:up`                   |
| `/api/health` returns 503 `configured:false`           | `.env.local` missing or empty values; also never re-declare its keys under `environment:` in compose — empty substitutions override the env file        |
| Hot reload does nothing                                | The container dev server must run webpack (`npm run dev:container` — the default CMD); Turbopack gets no file events across a Windows bind mount        |
| Supabase image pulls or `git push` time out            | The network is intermittent; retry — pulls resume, and `scripts/git-push-retry.sh <branch>` confirms the remote ref instead of trusting exit codes      |
| `supabase_vector` restarting                           | Known nonblocking issue on Docker Desktop/Windows (log shipper cannot reach the Docker socket); Studio's log UI may be empty — core services unaffected |

More detail: [docs/phase-1/phase-1-1/docker-runbook.md](docs/phase-1/phase-1-1/docker-runbook.md).

## Git workflow

- Permanent branches: `main` and `develop`. **No direct work on `main`** — its only direct
  commit is the authorised bootstrap `a6e0af4`.
- Work happens on prefixed branches from `develop` (`feature/`, `fix/`, `chore/`, `docs/`,
  `test/`, `refactor/`, `security/`); PRs target `develop`.
- Commits reference Phase 1 tasks (e.g. `P1-01-DO-002: add Docker local environment`).
- Branch protection is decided ([ADR-006](docs/adr/ADR-006-git-branching-and-protected-main.md))
  but **Blocked — not yet applied**; the manual settings are listed in
  [docs/phase-1/phase-1-1/security-readiness.md](docs/phase-1/phase-1-1/security-readiness.md).
- See [CONTRIBUTING.md](CONTRIBUTING.md) for the full rules, and [SECURITY.md](SECURITY.md)
  for secret handling and vulnerability reporting.

## Canonical documents

The authoritative business and execution documents are two Word files that live **outside
this repository** by owner decision (this Git repository is never a replacement canonical
copy). Their identity, hashes, and handling rules are recorded in
[docs/governance/canonical-documents.md](docs/governance/canonical-documents.md);
`npm run validate:canonical-docs` verifies them read-only.

## License

Proprietary — see [LICENSE](LICENSE). Unauthorized use, copying, or disclosure is prohibited.
