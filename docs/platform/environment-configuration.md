# Environment configuration

**Status:** descriptive. Every row below was read out of the code it cites.

**Deployment status, stated plainly: RootLco runs locally and only locally.** No staging
environment and no production environment exists (ADR-012). `.github/workflows/deploy-staging.yml`
and `.github/workflows/deploy-production.yml` are inert and reference no secrets. Nothing in this
repository has ever been deployed. The `staging` and `production` columns below describe what a
deployment **would** require, not a place that exists.

---

## 1. How configuration reaches a process

Four mechanisms, and they do not overlap as much as people assume.

**The two application tiers each read their own `.env.local`.** Next.js loads `.env.local` from the
application directory it is given, and `scripts/dev/start-local.mjs` starts them as
`next dev apps/api` and `next dev apps/web` (`tierArgs()`). So `apps/api/.env.local` configures the
API process and `apps/web/.env.local` configures the web process. Neither reads the repository-root
file.

**The repository-root `.env.local` has exactly one consumer:** the `env_file:` entry in
`docker-compose.yml` (marked `required: false`, so a fresh clone without one still builds). It
configures the container, nothing else.

**Repository scripts load no dotenv file at all.** Everything under `scripts/**` reads
`process.env` directly and falls back to a hard-coded local default — `scripts/db/apply-migrations.mjs`
is the pattern: `process.env.DB_HOST ?? '127.0.0.1'`, port `54322`, database/user/password
`postgres`. A value set in any `.env.local` reaches a script only if your shell already exported it.

**Some values are derived at launch rather than written down.** `scripts/dev/storage-env.mjs` reads
the running stack with `supabase status -o env` and renames four of its keys into the
`STORAGE_S3_*` shape; `scripts/dev/start-local.mjs` passes that fragment to the API tier only, so
the web tier holds no storage credential. `scripts/dev/owner-acceptance/create-owner-account.mjs`
writes `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_JWT_SECRET` and `AUTH_JWT_ISSUER` into
`apps/api/.env.local` for you.

### Two schemas on the backend, one on the frontend

| Schema                                         | Names | Read when                         | Notes                                                                   |
| ---------------------------------------------- | ----- | --------------------------------- | ----------------------------------------------------------------------- |
| `apps/api/src/server/config/backend-config.ts` | 49    | first `backendConfig()` call      | The real contract. Every entry optional or defaulted.                   |
| `apps/api/src/config/env.ts`                   | 6     | first `clientEnv()`/`serverEnv()` | The older Supabase/`NODE_ENV` subset. Still live: iam composes from it. |
| `apps/web/src/lib/env.ts`                      | 4     | module load                       | Parsed at import, so a bad value stops the boot, not the first request. |

The two `NEXT_PUBLIC_APP_ENV` vocabularies **differ and are not interchangeable**: the API accepts
`local | development | staging | production`; the web tier accepts `local | preview | production`
and defaults to `production` so a deployment that forgets it still sets `Secure` on the session
cookie.

### Column legend for the inventory

- **local / staging / production** — three tokens. `set` a value is written down; `default` the
  schema default is correct; `required` a deployment must supply it; `unset` deliberately absent;
  `n/a` the name does not apply to that environment.
- **Local value available?** — determined by listing variable NAMES in the working
  `.env.local` files. No value was read.

---

## 2. Inventory — web tier, browser-safe

Every `NEXT_PUBLIC_*` value is inlined by Next during `next build`. It is a **build-time** input:
changing one on a running deployment changes nothing until the next build.

| Name                                  | Consumer (path:line)          | Purpose                                                                         | local / staging / production | Requirement       | Secret?      | Valid source and how to set it                                  | Local value available?                       |
| ------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------- | ---------------------------- | ----------------- | ------------ | --------------------------------------------------------------- | -------------------------------------------- |
| `NEXT_PUBLIC_APP_ENV`                 | `apps/web/src/lib/env.ts:49`  | Decides whether the session cookie carries `Secure`. Defaults to `production`.  | `set` / n/a / `required`     | required          | browser-safe | `apps/web/.env.local`; the launcher sets `local` when unset     | yes (present by name in apps/web/.env.local) |
| `NEXT_PUBLIC_API_BASE_URL`            | `apps/web/src/lib/env.ts:64`  | The origin the BROWSER calls; `src/proxy.ts` derives CSP `connect-src` from it. | `set` / n/a / `required`     | required          | browser-safe | Owner decision in production; locally `http://localhost:3000`   | yes (present by name in apps/web/.env.local) |
| `NEXT_PUBLIC_CLIENT_MONITORING_URL`   | `apps/web/src/lib/env.ts:94`  | Where client diagnostics are delivered, if a deployment operates a sink.        | `unset` / `unset` / `unset`  | feature-dependent | browser-safe | Owner, only if a collector is ever operated. None exists.       | not needed locally                           |
| `NEXT_PUBLIC_CLIENT_MONITORING_LEVEL` | `apps/web/src/lib/env.ts:128` | Severity threshold for what leaves the browser. Unset means `error`.            | `unset` / `unset` / `unset`  | feature-dependent | browser-safe | Set only alongside the sink URL; invalid values refuse to boot. | not needed locally                           |

## 3. Inventory — web tier, server-only

Read on the server at request or build time. The web tier holds **no** database URL, service-role
key or storage credential, by design.

| Name                     | Consumer (path:line)                    | Purpose                                                                 | local / staging / production      | Requirement       | Secret?     | Valid source and how to set it                            | Local value available?                       |
| ------------------------ | --------------------------------------- | ----------------------------------------------------------------------- | --------------------------------- | ----------------- | ----------- | --------------------------------------------------------- | -------------------------------------------- |
| `ROOTLCO_ENABLE_GALLERY` | `apps/web/src/lib/gallery-access.ts:22` | Opens the internal component gallery at `/<locale>/gallery`.            | `set` / `unset` / `unset`         | feature-dependent | server-only | `apps/web/.env.local`; the launcher defaults it to `true` | yes (present by name in apps/web/.env.local) |
| `ROOTLCO_DIST_DIR`       | `apps/web/next.config.ts:31`            | Build output directory. Defaults to `.next`.                            | `set` / `unset` / `unset`         | optional          | server-only | SET BY THE LAUNCHER only, and only for the dev server     | yes (derived by the launcher)                |
| `NODE_ENV`               | `apps/web/src/lib/gallery-access.ts`    | Runtime mode. Provided by Node and Next; never written into a template. | `default` / `default` / `default` | provided          | server-only | The toolchain sets it                                     | not needed locally                           |

## 4. Inventory — API tier, browser-safe

| Name                            | Consumer (path:line)                        | Purpose                                                                                                                               | local / staging / production    | Requirement | Secret?      | Valid source and how to set it                                      | Local value available?                       |
| ------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ----------- | ------------ | ------------------------------------------------------------------- | -------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | `apps/api/src/config/env.ts:72`             | Identity provider API URL, handed to the adapter by `modules/iam/index.ts:147`.                                                       | `set` / `required` / `required` | required    | browser-safe | `npm run supabase:status` locally; the hosted project in production | yes (present by name in apps/api/.env.local) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `apps/api/src/config/env.ts:73`             | Public project key. Safe only because RLS is enabled and forced on every tenant table.                                                | `set` / `required` / `required` | required    | browser-safe | `npm run supabase:status` locally; the hosted project in production | yes (present by name in apps/api/.env.local) |
| `NEXT_PUBLIC_APP_ENV`           | `backend-config.ts:182`, `config/env.ts:74` | First segment of every storage key (immutable once written); selects bucket auto-creation; switches the production-required check on. | `set` / `required` / `required` | required    | browser-safe | Written in `apps/api/.env.local`                                    | yes (present by name in apps/api/.env.local) |
| `NEXT_PUBLIC_APP_VERSION`       | `apps/api/src/shared/constants/app.ts:30`   | Build identity surfaced by `/api/health`. Defaults to `0.1.0`.                                                                        | `unset` / optional / optional   | optional    | browser-safe | Injected at image build by CI                                       | not needed locally                           |
| `NEXT_PUBLIC_COMMIT_SHA`        | `apps/api/src/shared/constants/app.ts:31`   | Build identity. Defaults to `unknown`.                                                                                                | `unset` / optional / optional   | optional    | browser-safe | Injected at image build by CI                                       | not needed locally                           |

## 5. Inventory — API tier, database

Every value here is a PostgreSQL connection string and therefore a credential. **Two distinct login
roles are mandatory**: PostgreSQL resolves membership at the login role, so one role holding both
`app_runtime` and `app_platform` would carry both authorities on one connection and the containment
would buy nothing.

| Name                       | Consumer (path:line)                           | Purpose                                                                            | local / staging / production      | Requirement | Secret? | Valid source and how to set it                                   | Local value available?                       |
| -------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------- | ----------- | ------- | ---------------------------------------------------------------- | -------------------------------------------- |
| `DATABASE_URL`             | `apps/api/src/server/db/pool.ts:70`            | Request-path pool. Login role: `app_runtime` member, no BYPASSRLS.                 | `set` / `required` / `required`   | required    | secret  | Composed from `supabase status`; from the provider in production | yes (present by name in apps/api/.env.local) |
| `PLATFORM_DATABASE_URL`    | `apps/api/src/server/db/pool.ts:130`           | Control plane. NO fallback to `DATABASE_URL` — the platform path fails closed.     | `set` / `required` / `required`   | required    | secret  | Composed from `supabase status`; from the provider in production | yes (present by name in apps/api/.env.local) |
| `WORKER_DATABASE_URL`      | `apps/api/src/server/worker/worker-db.ts:55`   | Outbox worker pool. Falls back to `DATABASE_URL` when unset.                       | `unset` / optional / optional     | optional    | secret  | Its own `app_worker` login role                                  | not needed locally                           |
| `DATABASE_REPLICA_URL`     | `backend-config.ts:32` (validated, never read) | Accepted so topology can be expressed. **Deliberately inert** — no replica exists. | `unset` / `unset` / `unset`       | optional    | secret  | Nothing to set; no replica is provisioned                        | not needed locally                           |
| `DB_POOL_MAX`              | `apps/api/src/server/db/pool.ts:33`            | Pool size. Default 10, bounded 1..50.                                              | `default` / `default` / `default` | optional    | n/a     | Override only with a measured reason                             | not needed locally                           |
| `DB_POOL_IDLE_TIMEOUT_MS`  | `apps/api/src/server/db/pool.ts:34`            | Idle connection reaping. Default 30000, bounded 1000..300000.                      | `default` / `default` / `default` | optional    | n/a     | Override only with a measured reason                             | not needed locally                           |
| `DB_CONNECTION_TIMEOUT_MS` | `apps/api/src/server/db/pool.ts:35`            | Connect timeout. Default 5000, bounded 500..60000.                                 | `default` / `default` / `default` | optional    | n/a     | Override only with a measured reason                             | not needed locally                           |
| `DB_STATEMENT_TIMEOUT_MS`  | `apps/api/src/server/db/pool.ts:38`            | Server-side statement timeout. Default 15000, bounded 100..120000.                 | `default` / `default` / `default` | optional    | n/a     | Override only with a measured reason                             | not needed locally                           |

## 6. Inventory — API tier, outbox worker

| Name                       | Consumer (path:line)                                                         | Purpose                                                                                  | local / staging / production      | Requirement | Secret? | Valid source and how to set it                 | Local value available? |
| -------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------- | ----------- | ------- | ---------------------------------------------- | ---------------------- |
| `OUTBOX_BATCH_SIZE`        | `apps/api/src/server/worker/outbox-worker.ts:205`                            | Rows claimed per cycle. Default 25, bounded 1..500.                                      | `default` / `default` / `default` | optional    | n/a     | Override only with a measured reason           | not needed locally     |
| `OUTBOX_MAX_CONCURRENCY`   | `apps/api/src/server/worker/outbox-worker.ts:206`                            | In-flight deliveries. Default 4, bounded 1..32.                                          | `default` / `default` / `default` | optional    | n/a     | Override only with a measured reason           | not needed locally     |
| `OUTBOX_LEASE_SECONDS`     | `apps/api/src/server/worker/outbox-worker.ts:208`                            | Claim lease. Default 300, bounded 5..3600.                                               | `default` / `default` / `default` | optional    | n/a     | Override only with a measured reason           | not needed locally     |
| `OUTBOX_MAX_ATTEMPTS`      | `apps/api/src/modules/shared-services/application/message-dispatcher.ts:224` | Attempts before dead-lettering. Default 8, bounded 1..50.                                | `default` / `default` / `default` | optional    | n/a     | Override only with a measured reason           | not needed locally     |
| `OUTBOX_BASE_BACKOFF_MS`   | `apps/api/src/server/worker/outbox-worker.ts:252`                            | Retry backoff base. Default 1000, bounded 10..600000.                                    | `default` / `default` / `default` | optional    | n/a     | Override only with a measured reason           | not needed locally     |
| `OUTBOX_MAX_BACKOFF_MS`    | `apps/api/src/server/worker/outbox-worker.ts:253`                            | Retry backoff ceiling. Default 300000, bounded 1000..3600000.                            | `default` / `default` / `default` | optional    | n/a     | Override only with a measured reason           | not needed locally     |
| `OUTBOX_POLL_INTERVAL_MS`  | `apps/api/src/server/worker/outbox-worker.ts:305`                            | Idle poll interval. Default 2000, bounded 50..600000.                                    | `default` / `default` / `default` | optional    | n/a     | Override only with a measured reason           | not needed locally     |
| `OUTBOX_SHUTDOWN_GRACE_MS` | `apps/api/src/server/worker/outbox-worker.ts:329`                            | Drain window on shutdown. Default 15000, bounded 0..120000.                              | `default` / `default` / `default` | optional    | n/a     | Override only with a measured reason           | not needed locally     |
| `WORKER_ID`                | `apps/api/src/server/worker/outbox-worker.ts:204`                            | Queue claimant identity. Default `outbox_worker`; must match `^[a-z][a-z0-9_.-]{1,62}$`. | `default` / optional / optional   | optional    | n/a     | Set per process when more than one worker runs | not needed locally     |

## 7. Inventory — API tier, HTTP edge and authentication

| Name                               | Consumer (path:line)                                                 | Purpose                                                                                          | local / staging / production      | Requirement                           | Secret? | Valid source and how to set it                                               | Local value available?                       |
| ---------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------- | ------------------------------------- | ------- | ---------------------------------------------------------------------------- | -------------------------------------------- |
| `TRUSTED_PROXY_IPS`                | `apps/api/src/server/http/trusted-proxy.ts`                          | Exact remote addresses whose `X-Forwarded-For` may be believed. Empty ignores the header.        | `unset` / `required` / `required` | required when deployed behind a proxy | n/a     | The hosting topology, once one exists                                        | not needed locally                           |
| `CORS_ALLOWED_ORIGINS`             | **none — validated and inert** (`backend-config.ts:157`)             | Intended allow-list of cross-origin callers. **No CORS layer reads it today.**                   | `unset` / `required` / `required` | required (recorded intent)            | n/a     | The public web origin (Owner decision)                                       | not needed locally                           |
| `RATE_LIMIT_ENABLED`               | `apps/api/src/server/http/route-handler.ts:312`                      | Master switch for the limiter. Default `true`. `false` is refused in a deployed environment.     | `default` / `true` / `true`       | required                              | n/a     | Leave at the default                                                         | not needed locally                           |
| `CACHE_DEFAULT_TTL_SECONDS`        | **none — validated and inert** (`backend-config.ts:89`)              | Intended default cache TTL. No caller reads it.                                                  | `default` / `default` / `default` | optional                              | n/a     | Nothing to set                                                               | not needed locally                           |
| `CACHE_MAX_ENTRIES`                | `apps/api/src/server/cache/cache.ts:172`                             | In-process cache ceiling. Default 5000, bounded 16..100000.                                      | `default` / `default` / `default` | optional                              | n/a     | Override only with a measured reason                                         | not needed locally                           |
| `SUPABASE_SERVICE_ROLE_KEY`        | `apps/api/src/config/env.ts:102`, `modules/iam/index.ts:137`         | Privileged provider key. **Bypasses RLS entirely.** iam refuses to compose without it.           | `set` / `required` / `required`   | required                              | secret  | `supabase status` locally; the hosted project in production                  | yes (present by name in apps/api/.env.local) |
| `AUTH_IDENTITY_PROVIDER`           | `apps/api/src/modules/iam/index.ts:156`                              | Written to and matched against `iam.user_accounts.identity_provider`. Default `supabase`.        | `default` / `default` / `default` | optional                              | n/a     | Leave at the default unless a second provider exists                         | not needed locally                           |
| `AUTH_JWT_ISSUER`                  | `apps/api/src/modules/iam/index.ts:139`                              | Expected `iss`. A token from any other issuer is rejected.                                       | `set` / `required` / `required`   | required                              | n/a     | The project URL with `/auth/v1`; written locally by the Owner-account helper | yes (present by name in apps/api/.env.local) |
| `AUTH_JWT_SECRET`                  | `apps/api/src/modules/iam/index.ts:138`                              | HS\* verification secret. Absent means nobody can authenticate.                                  | `set` / `required` / `required`   | required                              | secret  | The project's JWT secret; written locally by the Owner-account helper        | yes (present by name in apps/api/.env.local) |
| `AUTH_JWT_AUDIENCE`                | `apps/api/src/modules/iam/index.ts:153`                              | Expected `aud`. Default `authenticated`, which is what GoTrue issues.                            | `default` / `default` / `default` | optional                              | n/a     | Leave at the default                                                         | not needed locally                           |
| `AUTH_JWT_ALGORITHMS`              | `apps/api/src/modules/iam/index.ts:154`                              | Algorithm ALLOW-LIST. Default `HS256`. This is what stops `alg: none` and RS256→HS256 confusion. | `default` / `default` / `default` | optional                              | n/a     | Widen only deliberately                                                      | not needed locally                           |
| `AUTH_CLOCK_SKEW_SECONDS`          | `apps/api/src/modules/iam/index.ts:155`                              | Tolerated drift. Default 60, bounded 0..300.                                                     | `default` / `default` / `default` | optional                              | n/a     | Override only with a measured reason                                         | not needed locally                           |
| `SESSION_IDLE_TIMEOUT_MINUTES`     | `apps/api/src/server/context/resolve-context.ts:286`                 | Server-enforced idle timeout. Default 30, bounded 1..1440.                                       | `default` / `default` / `default` | optional                              | n/a     | A policy decision, once one is made                                          | not needed locally                           |
| `SESSION_ACTIVITY_REFRESH_SECONDS` | `apps/api/src/server/context/resolve-context.ts:213`                 | Throttle on `last_seen_at` writes. Default 60, bounded 5..3600.                                  | `default` / `default` / `default` | optional                              | n/a     | Override only with a measured reason                                         | not needed locally                           |
| `AUTH_REDIRECT_ALLOWLIST`          | `apps/api/src/app/api/v1/auth/password-reset/route.ts:9`             | Exact absolute redirect destinations for reset and invitation links. Empty rejects every one.    | `set` / `required` / `required`   | required                              | n/a     | The public web origin's own URLs (Owner decision)                            | yes (present by name in apps/api/.env.local) |
| `LOGIN_MAX_FAILED_ATTEMPTS`        | `apps/api/src/modules/iam/application/authentication-service.ts:413` | Consecutive failures before lockout. Default 5, bounded 1..100.                                  | `default` / `default` / `default` | optional                              | n/a     | A policy decision, once one is made                                          | not needed locally                           |
| `LOGIN_FAILURE_WINDOW_MINUTES`     | `apps/api/src/modules/iam/application/authentication-service.ts:409` | Window over which failures are counted. Default 15, bounded 1..1440.                             | `default` / `default` / `default` | optional                              | n/a     | A policy decision, once one is made                                          | not needed locally                           |

## 8. Inventory — API tier, object storage

| Name                               | Consumer (path:line)                                                         | Purpose                                                                              | local / staging / production      | Requirement       | Secret? | Valid source and how to set it                            | Local value available?        |
| ---------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------- | ----------------- | ------- | --------------------------------------------------------- | ----------------------------- |
| `STORAGE_PROVIDER`                 | `apps/api/src/modules/shared-services/index.ts:231`                          | Adapter selection: `unconfigured` (default, refuses), `local_fake`, `s3_compatible`. | `set` / `required` / `required`   | required          | n/a     | Derived locally by `scripts/dev/storage-env.mjs`          | yes (derived by the launcher) |
| `STORAGE_S3_ENDPOINT`              | `apps/api/src/modules/shared-services/index.ts:246`                          | S3-compatible endpoint. Local Supabase serves it at `/storage/v1/s3`.                | `set` / `required` / `required`   | feature-dependent | n/a     | Derived locally from `supabase status -o env`             | yes (derived by the launcher) |
| `STORAGE_S3_REGION`                | `apps/api/src/modules/shared-services/index.ts:247`                          | S3 region. Default `local`.                                                          | `set` / `required` / `required`   | feature-dependent | n/a     | Derived locally; from the provider in production          | yes (derived by the launcher) |
| `STORAGE_S3_ACCESS_KEY_ID`         | `apps/api/src/modules/shared-services/index.ts:248`                          | S3 credential.                                                                       | `set` / `required` / `required`   | feature-dependent | secret  | Derived locally; from the provider in production          | yes (derived by the launcher) |
| `STORAGE_S3_SECRET_ACCESS_KEY`     | `apps/api/src/modules/shared-services/index.ts:249`                          | S3 credential.                                                                       | `set` / `required` / `required`   | feature-dependent | secret  | Derived locally; from the provider in production          | yes (derived by the launcher) |
| `STORAGE_S3_FORCE_PATH_STYLE`      | `apps/api/src/modules/shared-services/index.ts:251`                          | Addressing style. Default `true`.                                                    | `set` / `required` / `required`   | feature-dependent | n/a     | Whatever the endpoint requires                            | yes (derived by the launcher) |
| `STORAGE_BUCKET`                   | `apps/api/src/modules/shared-services/index.ts:232`                          | Bucket name. Default `rootlco-attachments`. Never a path, never caller-supplied.     | `set` / `required` / `required`   | feature-dependent | n/a     | Provisioned out of band with its own policy and lifecycle | yes (derived by the launcher) |
| `STORAGE_UPLOAD_URL_TTL_SECONDS`   | `apps/api/src/modules/shared-services/application/attachment-service.ts:358` | Signed upload lifetime. Default 600, bounded 30..900.                                | `default` / `default` / `default` | optional          | n/a     | Override only with a measured reason                      | not needed locally            |
| `STORAGE_DOWNLOAD_URL_TTL_SECONDS` | `apps/api/src/modules/shared-services/application/attachment-service.ts:730` | Signed download lifetime. Default 120, bounded 15..600.                              | `default` / `default` / `default` | optional          | n/a     | Override only with a measured reason                      | not needed locally            |
| `STORAGE_MAX_UPLOAD_BYTES`         | `apps/api/src/modules/shared-services/application/attachment-service.ts:323` | Platform CEILING per object, 25 MiB default. The per-category limit still applies.   | `default` / `default` / `default` | optional          | n/a     | Override only with a measured reason                      | not needed locally            |

## 9. Inventory — API tier, message delivery and budgets

| Name                               | Consumer (path:line)                                                           | Purpose                                                                                    | local / staging / production      | Requirement       | Secret? | Valid source and how to set it                      | Local value available? |
| ---------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | --------------------------------- | ----------------- | ------- | --------------------------------------------------- | ---------------------- |
| `NOTIFICATION_PROVIDER`            | `apps/api/src/modules/shared-services/application/message-dispatcher.ts:138`   | Delivery adapter. Default `unconfigured`, which refuses. **No adapter is implemented.**    | `default` / `default` / `default` | feature-dependent | n/a     | Nothing to select until an adapter exists           | not needed locally     |
| `NOTIFICATION_PROVIDER_TIMEOUT_MS` | `apps/api/src/modules/shared-services/application/message-dispatcher.ts:138`   | Per-attempt timeout. Default 5000, bounded 100..60000.                                     | `default` / `default` / `default` | optional          | n/a     | Override only with a measured reason                | not needed locally     |
| `NOTIFICATION_MAX_RENDERED_CHARS`  | `apps/api/src/modules/shared-services/application/notification-service.ts:173` | Rendered message ceiling. Default 20000, bounded 256..262144.                              | `default` / `default` / `default` | optional          | n/a     | Override only with a measured reason                | not needed locally     |
| `READINESS_TIMEOUT_MS`             | `apps/api/src/modules/shared-services/application/health-service.ts:65`        | Budget for the whole readiness probe. Default 2000, bounded 50..10000.                     | `default` / `default` / `default` | optional          | n/a     | Match it to the balancer's own probe timeout        | not needed locally     |
| `EXPORT_MAX_ROWS`                  | `apps/api/src/modules/reporting/application/report-export-service.ts:94`       | Largest row estimate a synchronous export is authorised for. Default 50000.                | `default` / `default` / `default` | optional          | n/a     | Override only with a measured reason                | not needed locally     |
| `LOG_LEVEL`                        | `apps/api/src/server/observability/logger.ts:55`                               | Server verbosity. Unset or unrecognised falls back to `warn` under test, `info` otherwise. | `unset` / optional / optional     | optional          | n/a     | Set explicitly if a deployment wants something else | not needed locally     |
| `NODE_ENV`                         | `apps/api/src/config/env.ts:104`, `server/cache/keys.ts`, `logger.ts`          | Runtime mode. Provided by the toolchain; never written into a template.                    | `default` / `default` / `default` | provided          | n/a     | The toolchain sets it                               | not needed locally     |

## 10. Inventory — scripts, CI and the database harness

None of these is read by application code, and none is loaded from a dotenv file. They are shell
inputs to a command you run by hand or that CI runs for you.

| Name                                                                                                                                           | Consumer                                            | Purpose                                                                                                                                                    | Requirement               | Secret?                                    | Valid source                                       | Local value available? |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------ | -------------------------------------------------- | ---------------------- |
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASSWORD`                                                                                          | `scripts/db/*.mjs` (e.g. `apply-migrations.mjs:84`) | Direct connection for the migration and seed harness. Hard-coded local defaults.                                                                           | optional                  | secret (`DB_PASSWORD`)                     | Your shell, only when overriding the local default | not needed locally     |
| `PGHOST` `PGPORT` `PGDATABASE` `PGUSER` `PGPASSWORD`                                                                                           | `scripts/**` via `pg`                               | The `libpq` family, honoured when the explicit names above are absent.                                                                                     | optional                  | secret (`PGPASSWORD`)                      | Your shell                                         | not needed locally     |
| `ROOTLCO_ENV`                                                                                                                                  | `scripts/db/provision-organization.mjs:76`          | Fail-closed guard: must be exactly `local-pilot` or `production-pilot` to provision.                                                                       | required for that command | n/a                                        | Your shell, deliberately, per invocation           | not needed locally     |
| `ROOTLCO_ACCEPTANCE_CONFIRM`                                                                                                                   | `scripts/dev/owner-acceptance/*`                    | Explicit confirmation before a destructive acceptance step runs.                                                                                           | required for that command | n/a                                        | Your shell, deliberately                           | not needed locally     |
| `ROOTLCO_API_BASE_URL`                                                                                                                         | `scripts/**`, `apps/web/tests/**`                   | Where an acceptance or browser run should send HTTP.                                                                                                       | optional                  | n/a                                        | Your shell; defaults to the local API origin       | not needed locally     |
| `ROOTLCO_E2E_AUTH` `ROOTLCO_E2E_EMAIL` `ROOTLCO_E2E_PASSWORD` `ROOTLCO_E2E_READER_EMAIL` `ROOTLCO_E2E_READER_PASSWORD` `ROOTLCO_E2E_TENANT_ID` | `apps/web/tests/**`                                 | Credentials and tenant for the browser tier, created by the acceptance helper.                                                                             | required for that tier    | secret (the two passwords)                 | Created locally by the acceptance helper           | not needed locally     |
| `ROOTLCO_CYCLE_SKIP_BROWSER` `ROOTLCO_CYCLE_SKIP_DB`                                                                                           | `scripts/**`                                        | Narrow a record cycle to the tiers an environment can actually run.                                                                                        | optional                  | n/a                                        | Your shell                                         | not needed locally     |
| `GENESIS_*` (7 names)                                                                                                                          | `scripts/db/*genesis*`                              | Inputs to the first-operator bootstrap: operator email, display name, provider subject, home tenant code, platform login role and password, evidence path. | required for that command | secret (`GENESIS_PLATFORM_LOGIN_PASSWORD`) | Owner-supplied, per invocation                     | not needed locally     |
| `BACKFILL_OPERATOR_EMAIL` `BACKFILL_EVIDENCE_PATH`                                                                                             | `scripts/db/backfill-*.mjs`                         | Attribution and evidence destination for a one-off backfill.                                                                                               | required for that command | n/a                                        | Owner-supplied, per invocation                     | not needed locally     |
| `EXPORT_FIXTURE_OPERATOR_EMAIL`                                                                                                                | `scripts/**`                                        | Attribution for an export fixture run.                                                                                                                     | required for that command | n/a                                        | Your shell                                         | not needed locally     |
| `UM_OUT_DIR`                                                                                                                                   | `docs/user-manual/tools/build-pdf.mjs:53`           | Output directory for the user-manual PDF. Must be OUTSIDE the repository; refuses when unset.                                                              | required for that command | n/a                                        | Your shell                                         | not needed locally     |
| `PLAYWRIGHT_PORT`                                                                                                                              | `apps/web/tests/**`                                 | Port the browser tier serves on.                                                                                                                           | optional                  | n/a                                        | Your shell                                         | not needed locally     |
| `PHASE_OWNERSHIP_PROFILE` `PHASE_OWNERSHIP_BASE` `OWNERSHIP_EVENT_NAME` `OWNERSHIP_REF_NAME`                                                   | `scripts/ci/check-phase-ownership.mjs`              | Which ownership profile a branch is judged under, and against what base.                                                                                   | required in CI            | n/a                                        | CI, from the workflow                              | not needed locally     |
| `P1_29_*` `P1_30_*` `P1_31_*` `P1_23_BASE_REF` `*_CLASSIFICATION_REGISTRY` `UPDATE_OPENAPI`                                                    | `tests/**`, `scripts/**`                            | Regeneration and pinning switches for phase inventories and registries.                                                                                    | optional                  | n/a                                        | Your shell, when regenerating an artefact          | not needed locally     |
| `GITHUB_*` `GH_TOKEN` `BASE_REF` `HEAD_REF` `HEAD_BRANCH` `CI`                                                                                 | `scripts/ci/**`                                     | Provided by GitHub Actions. Never written into a template.                                                                                                 | provided in CI            | secret (`GH_TOKEN`, `GITHUB_TOKEN`)        | The Actions runner                                 | not needed locally     |

## 11. Inventory — values that are not the application's

| Name                                                                                             | Where                              | Status                                                                                                         |
| ------------------------------------------------------------------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_INTERNAL_URL`                                                                          | `docker-compose.yml:53`            | **Dead.** Substituted into the container's environment; **no source file reads it**. Compose-level only.       |
| `OPENAI_API_KEY`                                                                                 | `supabase/config.toml:110`         | Supabase Studio's assistant feature. Not the application's, and the feature is not used.                       |
| `SENDGRID_API_KEY`, `SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN`, `SUPABASE_AUTH_EXTERNAL_APPLE_SECRET` | `supabase/config.toml:251,303,335` | Supabase features that are **not enabled**. No code path reaches any of them.                                  |
| `S3_HOST`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`                                         | `supabase/config.toml:413-419`     | The Supabase CLI's own storage settings, not the application's. The app's names are the `STORAGE_S3_*` family. |
| `SECRET_VALUE`                                                                                   | `supabase/config.toml:57,395`      | An illustrative `env()` reference in the CLI's own documentation comments.                                     |

---

## 12. What startup validation refuses today

1. **`apps/web/src/lib/env.ts:150`** parses at MODULE LOAD, so a bad public value stops the boot
   rather than the first request. It refuses an `NEXT_PUBLIC_APP_ENV` outside
   `local | preview | production`, a non-URL `NEXT_PUBLIC_API_BASE_URL` or monitoring URL, and a
   `NEXT_PUBLIC_CLIENT_MONITORING_LEVEL` outside the four log levels. The error names the FIELDS
   and never a value.
2. **`apps/api/src/config/env.ts`** refuses a missing or non-URL `NEXT_PUBLIC_SUPABASE_URL` and a
   missing `NEXT_PUBLIC_SUPABASE_ANON_KEY`. `serverEnv()` additionally throws outright if it is
   called in a browser. Issues are reported by path, never by value.
3. **`apps/api/src/server/config/backend-config.ts`** validates all 49 names on the first
   `backendConfig()` call and refuses anything outside a declared bound or format —
   `WORKER_ID`, `AUTH_IDENTITY_PROVIDER`, `STORAGE_PROVIDER` and `NOTIFICATION_PROVIDER` each carry
   a regex; every numeric setting carries a minimum and a maximum. `BackendConfigError` states
   "Variable names only are shown; values are never echoed."
4. **`productionConfigurationProblems()`** (same file) is the new part. When `NEXT_PUBLIC_APP_ENV`
   is `staging` or `production` it returns the NAMES of the values a deployment is missing:
   `DATABASE_URL`, `PLATFORM_DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_JWT_SECRET`,
   `AUTH_JWT_ISSUER`, `AUTH_REDIRECT_ALLOWLIST`, `CORS_ALLOWED_ORIGINS`, a `STORAGE_PROVIDER` that
   cannot serve, the S3 credentials when `s3_compatible` is selected, and `RATE_LIMIT_ENABLED` when
   it has been switched off. Outside those two environments it returns nothing, so local and test
   behaviour is unchanged. `apps/api/src/server/health/readiness.ts` reports it as
   `configuration.production-required` and the verdict becomes `unavailable` when it fails. The
   HTTP projection in `health-service.ts` drops every `detail`, so the names reach an operator's
   log and never the response body.
5. **Readiness refuses a BYPASSRLS pool role.** `readiness.ts` reports
   `database.role.no-bypassrls` from `preflightPrivileges()`, and a failure there is blocking. A
   connection that can see every tenant's rows is not a working deployment, it is a breach waiting
   to be noticed.
6. **`apps/api/src/modules/iam/index.ts:137-139` refuses to compose** the identity provider unless
   `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_JWT_SECRET` and `AUTH_JWT_ISSUER` are all present. It throws
   with the missing NAMES rather than degrading, because a partly configured provider fails at the
   first login with an opaque error instead of at boot with a precise one.
7. **`apps/api/src/server/db/pool.ts:131` fails closed** on an absent `PLATFORM_DATABASE_URL` rather
   than falling back to `DATABASE_URL`, which would silently put platform authority on the request
   path's role.
8. **`scripts/ci/check-env-contract.mjs`** compares the names the code reads against the two tracked
   templates and fails the build on an undocumented one. It now reads BOTH sources of truth:
   `process.env.NAME` literals and the zod schema's keys.

## 13. What must come from the Owner or a provider

Nothing below exists today. Each line is a value or a decision that has to be supplied before any
deployment is possible; none of it can be invented in this repository.

- **Two production PostgreSQL login roles, as two connection strings.** `DATABASE_URL` for a role
  that is a member of `app_runtime` and holds no BYPASSRLS, and `PLATFORM_DATABASE_URL` for a role
  that is a member of `app_platform` **and of no other application archetype**. One role for both is
  not a shortcut, it is the failure the separation exists to prevent.
- **A hosted Supabase project**, and from it: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.
- **From that same project**, the token settings that must agree with it: `AUTH_JWT_SECRET`,
  `AUTH_JWT_ISSUER`, and `AUTH_JWT_AUDIENCE` if it is not `authenticated`.
- **`AUTH_REDIRECT_ALLOWLIST`** — the exact, absolute password-reset and invitation URLs on the
  public web origin. Empty means every reset and every invitation fails.
- **`CORS_ALLOWED_ORIGINS`** — the public web origin. Note the gap in section 14: no code reads this
  yet, so supplying it records the intent rather than emitting a header.
- **`TRUSTED_PROXY_IPS`** — the exact remote addresses of whatever reverse proxies sit in front of
  the API. This cannot be guessed, and guessing it hands every caller its own rate-limit identity.
- **Object storage**: an S3-compatible endpoint and region, an access key id and secret access key,
  and the bucket name — provisioned out of band with its own policy, lifecycle and encryption.
- **Message delivery credentials** — and the honest caveat: **no delivery provider is implemented**.
  There is no adapter to configure yet, so an account can be obtained but nothing in the code will
  use it until one is built.
- **`NEXT_PUBLIC_API_BASE_URL`** — the public API origin, over TLS. It is inlined at build time and
  it drives the CSP `connect-src`, so it must be decided before the build, not at deploy.
- **`NEXT_PUBLIC_CLIENT_MONITORING_URL`** — only if a diagnostics collector is ever operated. None
  is, and leaving it unset is a supported, tested state.
- **The hosting target itself**, and with it the domain and the TLS certificate. Every origin value
  above is downstream of this one decision.
- **The Platform Owner's email address**, which the genesis bootstrap requires
  (`GENESIS_OPERATOR_EMAIL`) and which becomes the first operator identity.

## 14. Known gaps

- **`CORS_ALLOWED_ORIGINS` is validated and read by nothing.** `backend-config.ts:157` parses it
  into a list and no consumer exists. A deployment that sets it correctly gets no CORS header.
- **`CACHE_DEFAULT_TTL_SECONDS` is validated and read by nothing** (`backend-config.ts:89`). Every
  cache caller passes its own TTL.
- **`DATABASE_REPLICA_URL` is accepted and deliberately inert** — this one is documented as such in
  the schema and is not a defect, but it is easy to misread as a working feature.
- **`SUPABASE_INTERNAL_URL` is set by compose and read by nothing** (`docker-compose.yml:53`).
- **The two `NEXT_PUBLIC_APP_ENV` vocabularies disagree.** `staging` and `development` are valid on
  the API tier and invalid on the web tier; `preview` is valid on the web tier and invalid on the
  API tier. Nothing compares them, so a deployment can set a value one tier accepts and the other
  refuses to boot on.
- **`scripts/ci/check-env-contract.mjs` is in no npm script.** It runs from
  `.github/workflows/_reusable-node-quality.yml` only, so a local `npm run verify:repository` does
  not exercise it. `tests/foundation/env-contract.test.ts` covers the extraction and the set comparison in
  the unit tier, which is what makes the check reachable locally at all.
- **The schema-key extractor is a regex, not a parse.** It matches an indented SCREAMING_SNAKE key
  followed by `z.` or by the local `bounded(` helper. A future helper with a third spelling would be
  invisible to it, which is why its test asserts the extracted COUNT against an independently
  computed one rather than only asserting membership.
