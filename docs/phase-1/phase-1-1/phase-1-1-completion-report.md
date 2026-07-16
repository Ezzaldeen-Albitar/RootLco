# Phase 1-1 Completion Report

**Phase:** 1-1 — Source-of-Truth Validation and Development Readiness ·
**Date:** 2026-07-16 · **Author:** Documentation and engineering workstream on behalf of the
RootLco founders · **Branch:** `chore/p1-01-development-readiness`

## Executive summary

The Phase 1-1 technical readiness work is complete, subject to the conditional and blocked
items listed below. Every completion claim in this report is backed by a row in the
[evidence register](./evidence-register.md) and by the
[readiness checklist](./readiness-checklist.md) (33 Complete, 3 Conditional, 2 Blocked,
1 disclosed as not executed).

**The Phase 1-1 gate is not approved.** Approval belongs exclusively to the owners on
[`phase-1-1-owner-gate.md`](./phase-1-1-owner-gate.md), whose decision fields are empty.
**Phase 1-2 has not started**: the repository contains no business modules, no business
tables, no migrations, and no Benzene- or Zoom-specific objects.

## What was built

1. **Repository and branches.** Bootstrap root commit `a6e0af4` on `main` (authorised
   initialization exception: README, LICENSE, .gitignore only); `develop` from `main`; all
   Phase 1-1 work on `chore/p1-01-development-readiness`. Push resilience via
   `scripts/git-push-retry.sh` (SSH to GitHub is intermittent in this environment).
2. **Next.js foundation.** Next.js 16.2.10 / React 19.2.4 / TypeScript 5 strict; modular-
   monolith skeleton with machine-enforced import boundaries; validated environment layer
   (`src/config/env.ts`) that fails safely and never echoes a value; `/api/health` endpoint
   returning safe fields only; structured logger with nested secret redaction.
3. **Docker.** Multi-stage Dockerfile (deps/dev/build/runner), non-root in both runnable
   stages (verified uid 1000 dev / 1001 runner), compose file for the single `web` service
   with named volumes, health check, resource limits, and documented two-hostname Supabase
   networking. Images: `rootlco/web:dev` 2.11 GB, `rootlco/web:prod` 287 MB.
4. **Supabase local platform.** Official CLI (pinned devDependency, resolves 2.109.1) stack:
   PostgreSQL 17.6, Auth, REST, Realtime, Storage, Studio, all core services verified by
   request or query — not by container status alone. `supabase/migrations/` empty by design;
   `seed.sql` a deliberate no-op carrying the binding no-hard-coding rules.
5. **Sass/SCSS foundation (new owner decision).** sass 1.101.0, layered architecture under
   `src/styles/` (abstracts/base/themes/utilities), token maps generating `:root` custom
   properties, RTL/LTR via logical properties with Stylelint machine-enforcement, SCSS
   Modules, and a minimal verification page. Stylelint 17 wired into `verify` and CI.
6. **Quality gate and CI.** lint, typecheck, format, style, 22 unit tests, production build —
   all passing; three-job CI definition (quality incl. SCSS check, Docker builds with a
   non-root assertion, secret scans). CI has never run remotely — the first PR does not
   exist yet.
7. **Governance and evidence.** 13 ADRs plus the living register; README, CONTRIBUTING,
   SECURITY, CODEOWNERS, templates; the canonical-documents reference record and read-only
   integrity validator; this twelve-file evidence corpus.

## Validation summary

| Check                         | Result           | Notes                                                                                                                        |
| ----------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                | PASS             | 0 problems                                                                                                                   |
| `npm run typecheck`           | PASS             | strict + `noUncheckedIndexedAccess`                                                                                          |
| `npm run format:check`        | PASS             | Prettier clean                                                                                                               |
| `npm run style:check`         | PASS             | Stylelint, `--max-warnings 0`                                                                                                |
| `npm test`                    | PASS             | 22/22 (3 files); coverage 51.55% lines / 95.65% branches, scoped — see [qa-readiness.md](./qa-readiness.md)                  |
| `npm run build`               | PASS             | SCSS compiled; routes `/`, `/_not-found`, `/api/health`                                                                      |
| `docker compose config`       | PASS             |                                                                                                                              |
| Docker dev image + container  | PASS             | healthy; hot reload ~6 s round-trip confirmed                                                                                |
| Docker prod image + container | PASS             | healthy in 12 s; uid 1001; health 200; compiled CSS served; no sass in runtime                                               |
| Supabase stack                | PASS             | PostgreSQL 17.6 query; REST 200; Auth 200; Studio 307; `vector` disclosed nonblocking                                        |
| Clean-start test              | PASS             | full stop → `npm run dev:up` → all healthy → clean shutdown, 0 containers left                                               |
| Clean-clone test              | **NOT EXECUTED** | disclosed; runbook documents the equivalent procedure                                                                        |
| Secret scan                   | CLEAN            | tracked + untracked, CI-equivalent patterns                                                                                  |
| `npm audit`                   | 2 moderate       | via the `next` chain (postcss `</style>` advisory); only offered fix is a downgrade to next@9.3.3 — accepted risk, monitored |
| Canonical-documents validator | PASS             | exit 0, both documents match recorded hashes                                                                                 |

## Faults found and fixed during validation (disclosed)

1. **Named-volume ownership (EACCES).** `/app/.next` did not exist in the dev image, so the
   named volume initialized root-owned and the non-root server crash-looped. Fixed by
   creating and chowning the directory in the image.
2. **Compose environment overriding `.env.local`.** Empty `${VAR:-}` substitutions in
   `environment:` silently blanked env-file values → health reported degraded. Fixed by
   removing those keys from `environment:`.
3. **Hot reload dead under Turbopack.** File events do not cross a Windows bind mount and
   Turbopack has no polling fallback. The container dev server now runs webpack with
   `WATCHPACK_POLLING=true` (`npm run dev:container`); reload confirmed ~6 s. Host-native
   `npm run dev` keeps Turbopack.
4. **`next.config.ts` type error.** Next 16 removed the `eslint` key; removed, linting is
   enforced by scripts/CI.
5. **`dev:reset` sequencing bug.** The script ran `supabase db reset` after stopping
   Supabase; fixed to restart the stack first.
6. **Transient environment failures.** One Alpine `apk` fetch, one GitHub SSH push, one
   Supabase image pull (`public.ecr.aws` unreachable) and one host `next build`
   (`spawn UNKNOWN`) failed transiently and succeeded on retry; one `supabase start`
   invocation was OOM-killed when a retry loop ran concurrent starts (operator error).
   None reproduced after retry.

## Known limitations

- `supabase_vector_RootLco` crash-loops (log shipper cannot reach the Docker socket on this
  Docker Desktop/Windows setup). Studio's log UI may be empty. Core services unaffected —
  nonblocking, documented in the [runbook](./docker-runbook.md).
- `imgproxy` and `pooler` containers are stopped — optional services, not needed in Phase 1-1.
- CI is a validated definition, never executed remotely (no PR exists).
- The clean-clone reproducibility test was not executed in this run.
- Docker image hardening beyond current state (digest-pinned base, SHA-pinned actions,
  distroless runner) is recorded as open hardening work, not done.

## Blocked items (access, not defects)

| Item                                  | Reason                                                                    | Unblock                                                                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Branch protection (`main`, `develop`) | No GitHub CLI, no token; owner forbade installing/authenticating this run | Repository administrator applies the manual settings listed in [security-readiness.md](./security-readiness.md)                                                                                                    |
| Pull request creation                 | Same access constraint                                                    | Open manually: `https://github.com/Ezzaldeen-Albitar/RootLco/compare/develop...chore/p1-01-development-readiness?expand=1` — title `[P1-01] Complete development readiness, Docker, Supabase, and Sass foundation` |

## Conditional items (owner decisions)

1. Independent QA ownership is not assigned; all technical tests were executed by the
   technical owner.
2. An independent security reviewer / exception authority / incident contact is not
   evidenced (P1-01-SEC-003; P1-EC-016 candidate blocker).
3. Eng. Bilal Jradat's GitHub username is required for CODEOWNERS and review enforcement.

## Recommendation

Submit this package to the owner gate. The workstream's recommendation (a recommendation,
not a decision) is recorded in [`phase-1-1-owner-gate.md`](./phase-1-1-owner-gate.md).

Phase 1-1 technical readiness work is complete and submitted for owner gate review.
Phase 1-2 has not started and remains blocked until the RootLco owners record a Go or
Conditional Go decision.
