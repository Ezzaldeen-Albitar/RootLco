# Docker Operational Runbook — Local Development

**Company:** RootLco — Root Link Company
**Product:** [PRODUCT NAME — Pending Final Approval]
**Classification:** Confidential — Commercial Product and Pilot Planning
**Task:** P1-01-DO-002 (Phase 1-1 — Source-of-Truth Validation and Development Readiness)
**Technical owner:** Eng. Ezzaldeen Al-Bitar
**Date:** 2026-07-16

This runbook describes how to start, verify, observe, stop, and reset the local Docker development environment, and how to build and run the production-compatible image. Every command, port, timing, and failure mode recorded here was executed and measured on 2026-07-16 on the reference host described below. Nothing in this document is aspirational.

---

## 1. Prerequisites

1. **Docker Desktop running** (Linux engine). Measured versions on the reference host: Docker Engine 29.5.3, Docker Compose v5.1.4, on Windows 11.
2. **Host resources.** The reference host has 12 CPUs and approximately 16.5 GB of RAM. The compose service is bounded at 4 CPUs / 4 GB (see Section 11), and the Supabase CLI stack runs a further 13 containers, so ensure Docker Desktop is allocated enough memory to accommodate both. On a host materially smaller than the reference machine, reduce expectations accordingly.
3. **Node.js and npm on the host.** Measured: Node v24.16.0, npm 11.13.0. npm is the package manager of record (`packageManager: npm@11.13.0`); `package-lock.json` is committed.
4. **Install dependencies:**

   ```bash
   npm ci
   ```

5. **Create the local environment file:**

   ```bash
   cp .env.example .env.local
   ```

   `.env.local` is gitignored (verified with `git check-ignore`) and must never be committed. To fill in the Supabase anon key, start the Supabase stack (Section 2 does this for you, or run `npm run supabase:start` directly) and then run:

   ```bash
   npm run supabase:status
   ```

   Copy the reported API URL and anon key into `.env.local`. These local development values are not production secrets, but the no-secrets-in-git rule applies to this file regardless.

---

## 2. Start

```bash
npm run dev:up
```

What this single command does, in order:

1. `docker compose up -d --build` — builds (if needed) and starts the `web` service from the `dev` stage of the multi-stage Dockerfile (`deps → dev → build → runner`), publishing port 3000. The container runs as the non-root `node` user (uid 1000) on Node 22-alpine.
2. `npm run supabase:start` — starts the official Supabase CLI local stack (invoked from `node_modules/.bin`, not npx and not a global install; CLI resolves to 2.109.1). Supabase is deliberately **not** defined in `docker-compose.yml` (ADR-003/ADR-007): the CLI orchestrates its own containers.

**Expected end state:**

- Container `rootlco-web` running and eventually **healthy** (the healthcheck has a 40-second `start_period` because the first development compile is slow — do not judge health before that window has elapsed).
- Supabase stack up: API on 54321, PostgreSQL on 54322, Studio on 54323. Thirteen containers in total; db, auth, rest, realtime, storage, kong, studio, pg_meta, inbucket, and analytics healthy. `imgproxy` and `pooler` stopped is normal (optional components, not needed in Phase 1-1). See Section 8 for the two known non-blocking container issues (vector, edge_runtime).

**First start — image pulls.** The first `dev:up` pulls the Node 22-alpine base image and the full set of Supabase service images. This is the slowest invocation by a wide margin. During the 2026-07-16 session, some registry pulls **failed transiently and succeeded on retry**. If a pull fails with a network or registry error, simply re-run `npm run dev:up`; Docker resumes from the layers it already has. Do not treat a single failed pull as an environment defect.

**Do not run concurrent starts.** One `supabase start` invocation during this session ran out of memory when a retry loop launched concurrent starts (operator error, disclosed for completeness). Run one start at a time; the stack itself came up healthy.

---

## 3. Verify

Run all four checks; each was executed and passed on 2026-07-16.

1. **Compose state:**

   ```bash
   docker compose ps
   ```

   Expect the `web` service `Up` with status `(healthy)` after the start period.

2. **Health status directly from Docker:**

   ```bash
   docker inspect --format "{{json .State.Health.Status}}" rootlco-web
   ```

   Expect `"healthy"`.

3. **Application health endpoint:**

   ```bash
   curl -fsS http://localhost:3000/api/health
   ```

   Expect HTTP 200 with a JSON body of the shape:

   ```json
   { "status": "ok", "configured": true }
   ```

   `configured: true` means the Supabase environment variables were read successfully. If you see `configured: false` or a 503, see fault 2 in Section 8.

4. **Supabase stack:**

   ```bash
   npm run supabase:status
   ```

   Expect the API (54321), DB (54322), and Studio (54323) URLs plus keys. Measured verification on 2026-07-16: PostgreSQL 17.6 answered a real query via `docker exec` psql (version string and 16 schemas), REST `/rest/v1/` returned 200, Auth `/auth/v1/health` returned 200, and Studio returned a 307 redirect (responding normally).

---

## 4. Logs

```bash
npm run dev:logs
```

This follows the `web` container logs (`docker compose logs -f web`). For Supabase service logs, use `docker logs <container>` against the individual CLI-managed containers. Note that the Studio **logs UI** may be empty because of the known vector issue described in Section 8; that does not mean services are not logging.

---

## 5. Stop

```bash
npm run dev:down
```

This stops the Supabase stack (`supabase stop --no-backup`) and then runs `docker compose down`. The compose file sets `stop_grace_period: 10s`, which gives the Next.js dev server ten seconds to shut down cleanly before Docker sends SIGKILL; `init: true` ensures child processes are actually reaped. A stop that appears to take a few seconds is therefore normal, not a hang.

---

## 6. Reset

```bash
npm run dev:reset
```

Use this when the environment is wedged (corrupt build cache, poisoned `node_modules` volume, database in an unknown state). It performs, in order: `supabase stop --no-backup`, `docker compose down -v`, `docker compose up -d --build`, then `supabase db reset`.

**Destroyed:**

- The `web` container.
- Both named volumes: `rootlco_web_node_modules` and `rootlco_web_next_cache` (the `-v` flag). They are repopulated from the image on the next start.
- The local Supabase database contents (`supabase db reset`). Note that `supabase/migrations/` is empty by design in Phase 1-1 and `supabase/seed.sql` is a deliberate no-op (`RAISE NOTICE` only), so a reset currently restores an empty database — that is the intended Phase 1-1 state.

**Survives:**

- All source code and the working tree.
- Git history and branches.
- Built Docker images (`rootlco/web:dev`, `rootlco/web:prod`) — `down -v` removes volumes, not images, so the subsequent `--build` reuses cached layers and is much faster than the first build.

---

## 7. Hot reload

Hot reload in the container is **confirmed working at roughly a 6-second round trip** (file save on the host to updated response from the container), measured 2026-07-16.

**Why the container uses webpack with polling, not Turbopack.** Turbopack receives no file-change events across a Windows bind mount and has no polling fallback, so inside the container it silently stops reloading. The container therefore runs `npm run dev:container` (`next dev --webpack --hostname 0.0.0.0 --port 3000`) with `WATCHPACK_POLLING=true` set in the compose file; webpack's watcher polls the mounted source instead of waiting for events that never arrive.

**Host-native development keeps Turbopack.** Running `npm run dev` directly on the host uses Turbopack as normal; the limitation applies only to the bind-mounted container path.

---

## 8. Troubleshooting

Three faults were diagnosed and fixed during the 2026-07-16 session. They are recorded here because each one produces a confusing symptom whose root cause is not where the error appears.

| Symptom                                                                              | Root cause                                                                                                                                                                                                                                                                                                                                                 | Fix (already applied in this repository)                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Dev server crashes with `EACCES` on `mkdir` under `/app/.next`                       | The named volume mounted at `/app/.next` was initialised **root-owned**, because the directory did not exist in the image at volume-creation time. Docker initialises a fresh named volume by copying the image directory's contents **and ownership** — no directory in the image means a root-owned volume, which the non-root `node` user cannot write. | The `dev` stage of the Dockerfile now runs `mkdir -p /app/.next && chown -R node:node /app` before `USER node`, so the volume inherits `node` ownership. If you hit this after hand-editing the Dockerfile, run `npm run dev:reset` to recreate the volume from the corrected image. |
| `/api/health` returns `configured: false` or 503 even though `.env.local` is correct | `environment:` entries in `docker-compose.yml` **always override** `env_file` values. Entries of the form `${VAR:-}` with no host-side value substitute to an empty string and silently blank the values the developer put in `.env.local`.                                                                                                                | The Supabase URL/key/app-env entries were removed from `environment:`; those values now come exclusively from `.env.local` via `env_file`. Never re-add an `environment:` entry for a variable that `.env.local` is expected to supply.                                              |
| Hot reload silently does nothing in the container (no errors, no rebuilds)           | Turbopack receives no file events across a Windows bind mount and has no polling fallback.                                                                                                                                                                                                                                                                 | The container dev command is now `next dev --webpack` with `WATCHPACK_POLLING=true` (see Section 7). Host-native `npm run dev` is unaffected and keeps Turbopack.                                                                                                                    |

**Known issue — vector crash-loop (non-blocking, disclosed).** The `supabase_vector_RootLco` container crash-loops on this Docker Desktop/Windows setup. Vector is the log shipper that feeds Logflare/analytics for Studio's logs UI; it cannot reach the Docker socket from inside its container ("Listing currently running containers failed... Network unreachable"). **Impact:** the Studio log UI may be empty. It does **not** affect the database, Auth, REST, Storage, or Studio's core functionality. This is documented rather than hidden; no fix is applied in Phase 1-1.

**Known event — edge_runtime restart.** The `edge_runtime` container exited once during the session and was restarted; it is now Up. No edge functions exist in Phase 1-1, so an edge_runtime exit has no functional impact at this stage.

---

## 9. Production image

The `runner` stage produces a production-compatible image from the Next.js standalone output. Measured size: **287 MB** (versus 2.11 GB for the dev image, which carries the full `node_modules` tree of roughly 1.6 GB plus the toolchain on top of the ~130 MB base — the prod image contains no `node_modules` tree, no sass compiler, and no dev dependencies; the absence of `node_modules/sass` in the runtime image was explicitly verified).

**Build:**

```bash
docker build --target runner -t rootlco/web:prod .
```

No secrets are baked into any stage. The only build arguments are `NEXT_PUBLIC_*` values, which are public by definition (Next.js inlines them); Supabase build-time values are non-secret placeholders satisfying env validation.

**Run with runtime configuration:**

```bash
docker run --rm -p 3000:3000 \
  -e NEXT_PUBLIC_SUPABASE_URL=<url> \
  -e NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key> \
  rootlco/web:prod
```

**Measured verification (2026-07-16, container `rootlco-prod-test`):** the container reported healthy in 12 seconds; `/api/health` returned 200 with `{"status":"ok","configured":true}` using runtime environment variables (placeholders — no secrets); the process runs as user `nextjs`, **uid 1001** (verified via `id` inside the container); and the served CSS chunks contained the compiled design tokens and logical properties (`--color-background:#fff`, `--space-4:1rem`, `padding-inline-start`, `border-inline-start`, `scaleX(-1)`). The image carries its own `HEALTHCHECK` (curl of `/api/health`, 30 s interval, 20 s start period, 3 retries).

The base image pins the major line (`node:22-alpine`); digest-pinning and further size reduction (for example distroless) are recorded as open hardening items — they are possible but have **not** been done.

---

## 10. Networking — two hostnames, one Supabase

The Supabase CLI publishes its API on the **host** at `127.0.0.1:54321`. Inside the `web` container, `127.0.0.1` refers to the container itself, so a single URL cannot serve both callers:

| Caller                                  | URL                                 |
| --------------------------------------- | ----------------------------------- |
| Browser (on the host)                   | `http://127.0.0.1:54321`            |
| Server-side code (inside the container) | `http://host.docker.internal:54321` |

The in-container address is provided as `SUPABASE_INTERNAL_URL` (default `http://host.docker.internal:54321` in the compose file). It is documented and wired but **unused in Phase 1-1**, since no server-side Supabase calls exist yet. The `extra_hosts: host.docker.internal:host-gateway` entry makes the name resolve on native Linux, where Docker does not provide it automatically (Docker Desktop on Windows/macOS does).

---

## 11. Resource recommendations

Honesty first: **Docker does not automatically improve performance.** Its purpose here is reproducibility — an identical Node 22-alpine Linux runtime for every developer regardless of host OS. On Windows, bind mounts are _slower_ than native file access; the two named volumes (`rootlco_web_node_modules`, `rootlco_web_next_cache`) exist precisely to keep container development acceptable, by masking the two highest-traffic paths (`/app/node_modules` and `/app/.next`) so they live on the Linux VM's filesystem instead of crossing the bind mount. `node_modules` additionally must come from the image, because host-installed (Windows) native binaries would be wrong for Alpine/Linux.

- The compose service is bounded at **4 CPUs / 4 GB** (`deploy.resources.limits`), so a runaway dev server cannot consume the whole host. These limits were chosen against the measured reference host (12 CPUs / ~16.5 GB); tune them in step with the Docker Desktop allocation if your host differs.
- Expect the Supabase CLI stack's 13 containers to account for a substantial share of Docker Desktop's memory allocation alongside the `web` service.
- One host-native `npm run build` during the session failed with a transient Windows `spawn UNKNOWN` error and succeeded on retry. Treat an isolated occurrence as environmental flakiness, not a broken build — retry once before investigating.
- If container development ever feels unacceptably slow, the supported alternative is host-native `npm run dev` (Turbopack) against the CLI-managed Supabase stack; the container path remains the reference environment.
