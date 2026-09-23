# Environment configuration

**Status:** descriptive. Every row below was read out of the code it cites.

**Measured at:** `develop` `5b2c7840da1821f973438d5429665ef4448132f2`, on 2026-09-18.

**Re-checked for this head, and unchanged.** None of the five merges that followed the one which
introduced this document touched any of the three configuration schemas. The API schema still holds
**49** names (counted from `schema.shape` in `apps/api/src/server/config/backend-config.ts`), the
older Supabase subset still holds 6, and the web schema still holds 4. No name was added, removed or
re-bounded. One script surface did change, and section 12 records it: a second platform script now
sits beside the genesis one and reads its own `GRANT_*` family.

**The three things this document is most often opened for**

1. **`CORS_ALLOWED_ORIGINS` and `CACHE_DEFAULT_TTL_SECONDS` are validated and read by nothing.**
   Setting either has no effect whatever, and neither may appear in the production-required set. The
   reason for each, and the test that holds the rule, are in section 3. `DATABASE_REPLICA_URL` is
   the third name in that state.
2. **The production-required set** — the names `productionConfigurationProblems()` returns when
   `NEXT_PUBLIC_APP_ENV` is `staging` or `production` — is section 14, item 4, together with the
   reason that check cannot catch a deployment which declares nothing.
3. **The values only the Owner or a provider can supply** are section 15. Nothing in that list exists
   today, and none of it can be invented in this repository.

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

The two `NEXT_PUBLIC_APP_ENV` vocabularies **differ and are not interchangeable**. Section 2 is the
one place that difference, and every other name that is not shared between the tiers, is written
down.

### Column legend for the inventory

- **local / staging / production** — three tokens. `set` a value is written down; `default` the
  schema default is correct; `required` a deployment must supply it; `unset` deliberately absent;
  `n/a` the name does not apply to that environment.
- **Requirement** — the same words, plus `reserved`: the name is accepted and read by nothing, so
  setting it has no effect. Section 3 is the complete list and the only place a name earns that
  word.
- **Local value available?** — **NOT MEASURED, and deliberately not measurable here.** Every
  `.env.local` is untracked, so a checkout of this branch contains none: `.env*` in this tree
  resolves to the five tracked `*.example` templates and nothing else. Reading a file in another
  developer's checkout would not be evidence about this one either. So the column states where a
  working local setup GETS each name — a template you copy, the launcher, or the Owner-account
  helper, each of them tracked code cited in section 1 — and never that any file was observed.
  Read it as a requirement, not as an observation. No value was read, and none can be.

---

## 2. API and web names: what differs, what pairs, and what is aliased

**Nothing here is a rename.** Every name below keeps working exactly as it does today; this section
records the differences so a deployment can be configured without guessing, and it is the only place
they are written down.

### 2.1 The mapping table

| Web name (`apps/web`)                 | API name (`apps/api`)                                                                      | Relationship                                             | Meaning                                                                                                                                     | Allowed values                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_ENV`                 | `NEXT_PUBLIC_APP_ENV`                                                                      | **One name, two vocabularies.** Nothing compares them.   | Web: whether the session cookie carries `Secure`. API: the storage-key segment, and the switch that turns the production-required check on. | Web: `local \| preview \| production`, default `production`. API: `local \| development \| staging \| production`, default `local`. |
| `NEXT_PUBLIC_API_BASE_URL`            | — (no equivalent)                                                                          | Web-only.                                                | The origin the BROWSER calls, and the origin `src/proxy.ts` puts in the CSP `connect-src`.                                                  | Any absolute URL. Inlined at build time.                                                                                            |
| `NEXT_PUBLIC_CLIENT_MONITORING_URL`   | — (no equivalent)                                                                          | Web-only.                                                | Where client diagnostics are delivered, if a collector is ever operated.                                                                    | Absolute URL, or unset.                                                                                                             |
| `NEXT_PUBLIC_CLIENT_MONITORING_LEVEL` | — (no equivalent)                                                                          | Web-only.                                                | Severity threshold for what leaves the browser.                                                                                             | `debug \| info \| warn \| error`, or unset (means `error`).                                                                         |
| `ROOTLCO_ENABLE_GALLERY`              | — (no equivalent)                                                                          | Web-only, server-side.                                   | Opens the internal component gallery.                                                                                                       | Any value opens it; unset is off.                                                                                                   |
| — (never on the web tier)             | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`                                | API-only, despite the browser-safe prefix.               | Identity-provider URL and public project key, handed to the iam adapter.                                                                    | URL and opaque key.                                                                                                                 |
| — (never on the web tier)             | `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `PLATFORM_DATABASE_URL`, every `STORAGE_S3_*` | API-only, and **by design unavailable to the web tier**. | Server credentials. The web tier reaches the API over HTTP and holds no credential at all.                                                  | See sections 6–11.                                                                                                                  |
| — (no web equivalent)                 | `AUTH_REDIRECT_ALLOWLIST`                                                                  | API-only, but its VALUE is web URLs.                     | The exact absolute reset and invitation destinations on the public web origin.                                                              | Comma-separated absolute URLs.                                                                                                      |

The last row is the pattern to watch for: several API values are _about_ the web tier without being
_set on_ it. The public web origin is one Owner decision that lands in the API tier's configuration,
not the web tier's.

### 2.2 Which `NEXT_PUBLIC_APP_ENV` pairs are valid together

The two tiers validate independently and **no code compares them**, so "valid" below means "both
processes boot and neither is lying about what it is".

| Web value    | API value     | Verdict                                                                                                                                                                 |
| ------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `local`      | `local`       | Valid. The developer default, and what the launcher sets on both tiers.                                                                                                 |
| `local`      | `development` | Valid. `development` is the API's name for a shared non-local development deployment; the web tier has no separate token and `local` is its nearest.                    |
| `production` | `staging`     | Valid, and the only sound spelling of staging: the web tier has no `staging`, and `production` is the value that keeps `Secure` on the cookie.                          |
| `production` | `production`  | Valid.                                                                                                                                                                  |
| `preview`    | _anything_    | **No equivalent.** `preview` is a web-only token; the API refuses it (see below).                                                                                       |
| `local`      | `production`  | Both boot, and the pair is wrong: the cookie loses `Secure` while the API mints production storage keys and enforces the production-required check. Nothing detects it. |

### 2.3 What happens at runtime for a value with no equivalent

- **A value the tier itself does not accept stops that tier.** `apps/web/src/lib/env.ts` parses at
  module load, so `development` or `staging` on the web tier throws naming the field and the process
  does not boot. `backendConfig()` likewise refuses `preview` on the API tier with
  `BackendConfigError`, which names the variable and never the value.
- **A value each tier accepts separately is never cross-checked.** There is no comparison between
  the tiers at build, boot or request time, so the mismatched pair in the last row above runs. That
  is a known gap, recorded in section 16, not a behaviour to rely on.
- **Storage keys are the irreversible consequence.** `NEXT_PUBLIC_APP_ENV` is the first segment of
  every `storage_key` the API writes, and a key is immutable once written — a key minted under the
  wrong token can only be superseded, never corrected.

### 2.4 Aliases and renames the code actually supports

Three, and no others. Nothing translates one tier's `NEXT_PUBLIC_APP_ENV` vocabulary into the
other's.

| Mechanism                              | What it does                                                                                                                                                                                                                                                         | Scope                |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `scripts/dev/storage-env.mjs:52-55`    | Renames the Supabase CLI's `STORAGE_S3_URL`, `S3_PROTOCOL_ACCESS_KEY_ID`, `S3_PROTOCOL_ACCESS_KEY_SECRET` and `S3_PROTOCOL_REGION` into the application's `STORAGE_S3_ENDPOINT`, `STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY` and `STORAGE_S3_REGION`. | Local launcher only. |
| `scripts/dev/start-local.mjs:727,735`  | Defaults `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_APP_ENV` with `??=`, so an existing value is never overridden.                                                                                                                                                  | Local launcher only. |
| `WORKER_DATABASE_URL` → `DATABASE_URL` | The one fallback inside the application: `workerDbPool()` uses the primary DSN when the worker has none. `PLATFORM_DATABASE_URL` deliberately has no such fallback.                                                                                                  | Runtime, API tier.   |

## 3. Settings that are accepted and read by nothing

**A setting is not operational because a validator accepts it.** Validation proves a value is
well-formed; it never proves anything reads it. Every name accepted by the API config schema
(`ACCEPTED_SETTING_NAMES`, derived from the schema itself), by `apps/api/src/config/env.ts`, by the
production-required rule and by the web schema was checked against the API and web source for a
consumer. **Three names have none.**

| Name                        | Accepted by             | Why nothing reads it                                                                                                                                 | Effect of setting it                                      | Required in production?                                                                                          |
| --------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `CORS_ALLOWED_ORIGINS`      | `backend-config.ts:185` | There is no CORS layer and no response-header layer on this tier. `server/http/route-handler.ts` is the only edge and writes no cross-origin header. | None. No `Access-Control-Allow-Origin` header is emitted. | **No.** It was required until this change; requiring a value that governs nothing refused readiness for nothing. |
| `CACHE_DEFAULT_TTL_SECONDS` | `backend-config.ts:108` | `Cache.set()` requires an explicit `ttlSeconds` from its caller and no path falls back to a default, so there is nothing to govern.                  | None.                                                     | No.                                                                                                              |
| `DATABASE_REPLICA_URL`      | `backend-config.ts:45`  | Read-replica routing is not implemented: `poolFor('replica')` returns the primary pool, and no replica is provisioned (ADR-012).                     | None.                                                     | No.                                                                                                              |

**What "reserved" commits to.** Each name stays in the schema, so a deployment that already sets it
starts exactly as before; none is in `REQUIRED_WHEN_DEPLOYED`; none can fail readiness; and each is
carried in the templates **commented out**, with the same note.

**The guard.** `tests/foundation/reserved-settings.test.ts` derives the accepted names from
`schema.shape` — not from this document and not from any list maintained beside the schema — and
fails when an accepted name is neither consumed in `apps/api/src` nor listed in `RESERVED_SETTINGS`,
when a reserved name gains a consumer, or when a reserved name appears in the production-required
set. A name mentioned only in a comment does not count as consumed: whole-line comments are blanked
before the scan (line numbering intact, so the citation stays true), and the rule is asserted from
both sides — `pool.ts:8` discusses `DATABASE_REPLICA_URL` at length and must not read as a use, and
a comment that QUOTES a read must not either. The same suite applies the same rule to the other two
schemas, `apps/api/src/config/env.ts` and `apps/web/src/lib/env.ts`, each searched in its own tier's
tree, so a name validated-but-unread is caught in all three places rather than only the largest.

**Every other accepted name has a consumer**, cited by `path:line` in the inventories that follow.

## 4. Inventory — web tier, browser-safe

Every `NEXT_PUBLIC_*` value is inlined by Next during `next build`. It is a **build-time** input:
changing one on a running deployment changes nothing until the next build.

| Name                                  | Consumer (path:line)          | Purpose                                                                         | local / staging / production | Requirement       | Secret?      | Valid source and how to set it                                  | Local value available?              |
| ------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------- | ---------------------------- | ----------------- | ------------ | --------------------------------------------------------------- | ----------------------------------- |
| `NEXT_PUBLIC_APP_ENV`                 | `apps/web/src/lib/env.ts:49`  | Decides whether the session cookie carries `Secure`. Defaults to `production`.  | `set` / n/a / `required`     | required          | browser-safe | `apps/web/.env.local`; the launcher sets `local` when unset     | you write it in apps/web/.env.local |
| `NEXT_PUBLIC_API_BASE_URL`            | `apps/web/src/lib/env.ts:64`  | The origin the BROWSER calls; `src/proxy.ts` derives CSP `connect-src` from it. | `set` / n/a / `required`     | required          | browser-safe | Owner decision in production; locally `http://localhost:3000`   | you write it in apps/web/.env.local |
| `NEXT_PUBLIC_CLIENT_MONITORING_URL`   | `apps/web/src/lib/env.ts:94`  | Where client diagnostics are delivered, if a deployment operates a sink.        | `unset` / `unset` / `unset`  | feature-dependent | browser-safe | Owner, only if a collector is ever operated. None exists.       | not needed locally                  |
| `NEXT_PUBLIC_CLIENT_MONITORING_LEVEL` | `apps/web/src/lib/env.ts:128` | Severity threshold for what leaves the browser. Unset means `error`.            | `unset` / `unset` / `unset`  | feature-dependent | browser-safe | Set only alongside the sink URL; invalid values refuse to boot. | not needed locally                  |

## 5. Inventory — web tier, server-only

Read on the server at request or build time. The web tier holds **no** database URL, service-role
key or storage credential, by design.

| Name                     | Consumer (path:line)                    | Purpose                                                                 | local / staging / production      | Requirement       | Secret?     | Valid source and how to set it                            | Local value available?              |
| ------------------------ | --------------------------------------- | ----------------------------------------------------------------------- | --------------------------------- | ----------------- | ----------- | --------------------------------------------------------- | ----------------------------------- |
| `ROOTLCO_ENABLE_GALLERY` | `apps/web/src/lib/gallery-access.ts:22` | Opens the internal component gallery at `/<locale>/gallery`.            | `set` / `unset` / `unset`         | feature-dependent | server-only | `apps/web/.env.local`; the launcher defaults it to `true` | you write it in apps/web/.env.local |
| `ROOTLCO_DIST_DIR`       | `apps/web/next.config.ts:31`            | Build output directory. Defaults to `.next`.                            | `set` / `unset` / `unset`         | optional          | server-only | SET BY THE LAUNCHER only, and only for the dev server     | derived by the launcher             |
| `NODE_ENV`               | `apps/web/src/lib/gallery-access.ts`    | Runtime mode. Provided by Node and Next; never written into a template. | `default` / `default` / `default` | provided          | server-only | The toolchain sets it                                     | not needed locally                  |

## 6. Inventory — API tier, browser-safe

| Name                            | Consumer (path:line)                        | Purpose                                                                                                                                                                                                                                                 | local / staging / production    | Requirement | Secret?      | Valid source and how to set it                                      | Local value available?              |
| ------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ----------- | ------------ | ------------------------------------------------------------------- | ----------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | `apps/api/src/config/env.ts:72`             | Identity provider API URL, handed to the adapter by `modules/iam/index.ts:147`.                                                                                                                                                                         | `set` / `required` / `required` | required    | browser-safe | `npm run supabase:status` locally; the hosted project in production | you write it in apps/api/.env.local |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `apps/api/src/config/env.ts:73`             | Public project key. Safe only because RLS is enabled and forced on every tenant table.                                                                                                                                                                  | `set` / `required` / `required` | required    | browser-safe | `npm run supabase:status` locally; the hosted project in production | you write it in apps/api/.env.local |
| `NEXT_PUBLIC_APP_ENV`           | `backend-config.ts:210`, `config/env.ts:74` | First segment of every storage key (immutable once written); selects bucket auto-creation; switches the production-required check on. **Absent, it defaults to `local` and that check does not run at all** — nothing refuses its absence (section 16). | `set` / `required` / `required` | required    | browser-safe | Written in `apps/api/.env.local`                                    | you write it in apps/api/.env.local |
| `NEXT_PUBLIC_APP_VERSION`       | `apps/api/src/shared/constants/app.ts:30`   | Build identity surfaced by `/api/health`. Defaults to `0.1.0`.                                                                                                                                                                                          | `unset` / optional / optional   | optional    | browser-safe | Injected at image build by CI                                       | not needed locally                  |
| `NEXT_PUBLIC_COMMIT_SHA`        | `apps/api/src/shared/constants/app.ts:31`   | Build identity. Defaults to `unknown`.                                                                                                                                                                                                                  | `unset` / optional / optional   | optional    | browser-safe | Injected at image build by CI                                       | not needed locally                  |

## 7. Inventory — API tier, database

Every value here is a PostgreSQL connection string and therefore a credential. **Two distinct login
roles are mandatory**: PostgreSQL resolves membership at the login role, so one role holding both
`app_runtime` and `app_platform` would carry both authorities on one connection and the containment
would buy nothing.

| Name                       | Consumer (path:line)                         | Purpose                                                                        | local / staging / production      | Requirement | Secret? | Valid source and how to set it                                   | Local value available?              |
| -------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------- | ----------- | ------- | ---------------------------------------------------------------- | ----------------------------------- |
| `DATABASE_URL`             | `apps/api/src/server/db/pool.ts:70`          | Request-path pool. Login role: `app_runtime` member, no BYPASSRLS.             | `set` / `required` / `required`   | required    | secret  | Composed from `supabase status`; from the provider in production | you write it in apps/api/.env.local |
| `PLATFORM_DATABASE_URL`    | `apps/api/src/server/db/pool.ts:130`         | Control plane. NO fallback to `DATABASE_URL` — the platform path fails closed. | `set` / `required` / `required`   | required    | secret  | Composed from `supabase status`; from the provider in production | you write it in apps/api/.env.local |
| `WORKER_DATABASE_URL`      | `apps/api/src/server/worker/worker-db.ts:55` | Outbox worker pool. Falls back to `DATABASE_URL` when unset.                   | `unset` / optional / optional     | optional    | secret  | Its own `app_worker` login role                                  | not needed locally                  |
| `DATABASE_REPLICA_URL`     | **none — RESERVED** (`backend-config.ts:45`) | Accepted so topology can be expressed. Setting it has NO effect (section 3).   | `unset` / `unset` / `unset`       | reserved    | secret  | Nothing to set; no replica is provisioned                        | not needed locally                  |
| `DB_POOL_MAX`              | `apps/api/src/server/db/pool.ts:33`          | Pool size. Default 10, bounded 1..50.                                          | `default` / `default` / `default` | optional    | n/a     | Override only with a measured reason                             | not needed locally                  |
| `DB_POOL_IDLE_TIMEOUT_MS`  | `apps/api/src/server/db/pool.ts:34`          | Idle connection reaping. Default 30000, bounded 1000..300000.                  | `default` / `default` / `default` | optional    | n/a     | Override only with a measured reason                             | not needed locally                  |
| `DB_CONNECTION_TIMEOUT_MS` | `apps/api/src/server/db/pool.ts:35`          | Connect timeout. Default 5000, bounded 500..60000.                             | `default` / `default` / `default` | optional    | n/a     | Override only with a measured reason                             | not needed locally                  |
| `DB_STATEMENT_TIMEOUT_MS`  | `apps/api/src/server/db/pool.ts:38`          | Server-side statement timeout. Default 15000, bounded 100..120000.             | `default` / `default` / `default` | optional    | n/a     | Override only with a measured reason                             | not needed locally                  |

## 8. Inventory — API tier, outbox worker

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

## 9. Inventory — API tier, HTTP edge and authentication

| Name                               | Consumer (path:line)                                                 | Purpose                                                                                          | local / staging / production      | Requirement                           | Secret? | Valid source and how to set it                                               | Local value available?              |
| ---------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------- | ------------------------------------- | ------- | ---------------------------------------------------------------------------- | ----------------------------------- |
| `TRUSTED_PROXY_IPS`                | `apps/api/src/server/http/trusted-proxy.ts`                          | Exact remote addresses whose `X-Forwarded-For` may be believed. Empty ignores the header.        | `unset` / `required` / `required` | required when deployed behind a proxy | n/a     | The hosting topology, once one exists                                        | not needed locally                  |
| `CORS_ALLOWED_ORIGINS`             | **none — RESERVED** (`backend-config.ts:185`)                        | Intended allow-list of cross-origin callers. Setting it has NO effect (section 3).               | `unset` / `unset` / `unset`       | reserved                              | n/a     | Nothing to set until a CORS layer exists                                     | not needed locally                  |
| `RATE_LIMIT_ENABLED`               | `apps/api/src/server/http/route-handler.ts:312`                      | Master switch for the limiter. Default `true`. `false` is refused in a deployed environment.     | `default` / `true` / `true`       | required                              | n/a     | Leave at the default                                                         | not needed locally                  |
| `CACHE_DEFAULT_TTL_SECONDS`        | **none — RESERVED** (`backend-config.ts:108`)                        | Intended default cache TTL. Setting it has NO effect (section 3).                                | `default` / `default` / `default` | reserved                              | n/a     | Nothing to set; every caller passes its own TTL                              | not needed locally                  |
| `CACHE_MAX_ENTRIES`                | `apps/api/src/server/cache/cache.ts:172`                             | In-process cache ceiling. Default 5000, bounded 16..100000.                                      | `default` / `default` / `default` | optional                              | n/a     | Override only with a measured reason                                         | not needed locally                  |
| `SUPABASE_SERVICE_ROLE_KEY`        | `apps/api/src/config/env.ts:102`, `modules/iam/index.ts:137`         | Privileged provider key. **Bypasses RLS entirely.** iam refuses to compose without it.           | `set` / `required` / `required`   | required                              | secret  | `supabase status` locally; the hosted project in production                  | you write it in apps/api/.env.local |
| `AUTH_IDENTITY_PROVIDER`           | `apps/api/src/modules/iam/index.ts:156`                              | Written to and matched against `iam.user_accounts.identity_provider`. Default `supabase`.        | `default` / `default` / `default` | optional                              | n/a     | Leave at the default unless a second provider exists                         | not needed locally                  |
| `AUTH_JWT_ISSUER`                  | `apps/api/src/modules/iam/index.ts:139`                              | Expected `iss`. A token from any other issuer is rejected.                                       | `set` / `required` / `required`   | required                              | n/a     | The project URL with `/auth/v1`; written locally by the Owner-account helper | you write it in apps/api/.env.local |
| `AUTH_JWT_SECRET`                  | `apps/api/src/modules/iam/index.ts:138`                              | HS\* verification secret. Absent means nobody can authenticate.                                  | `set` / `required` / `required`   | required                              | secret  | The project's JWT secret; written locally by the Owner-account helper        | you write it in apps/api/.env.local |
| `AUTH_JWT_AUDIENCE`                | `apps/api/src/modules/iam/index.ts:153`                              | Expected `aud`. Default `authenticated`, which is what GoTrue issues.                            | `default` / `default` / `default` | optional                              | n/a     | Leave at the default                                                         | not needed locally                  |
| `AUTH_JWT_ALGORITHMS`              | `apps/api/src/modules/iam/index.ts:154`                              | Algorithm ALLOW-LIST. Default `HS256`. This is what stops `alg: none` and RS256→HS256 confusion. | `default` / `default` / `default` | optional                              | n/a     | Widen only deliberately                                                      | not needed locally                  |
| `AUTH_CLOCK_SKEW_SECONDS`          | `apps/api/src/modules/iam/index.ts:155`                              | Tolerated drift. Default 60, bounded 0..300.                                                     | `default` / `default` / `default` | optional                              | n/a     | Override only with a measured reason                                         | not needed locally                  |
| `SESSION_IDLE_TIMEOUT_MINUTES`     | `apps/api/src/server/context/resolve-context.ts:286`                 | Server-enforced idle timeout. Default 30, bounded 1..1440.                                       | `default` / `default` / `default` | optional                              | n/a     | A policy decision, once one is made                                          | not needed locally                  |
| `SESSION_ACTIVITY_REFRESH_SECONDS` | `apps/api/src/server/context/resolve-context.ts:287`                 | Throttle on `last_seen_at` writes. Default 60, bounded 5..3600.                                  | `default` / `default` / `default` | optional                              | n/a     | Override only with a measured reason                                         | not needed locally                  |
| `AUTH_REDIRECT_ALLOWLIST`          | `apps/api/src/app/api/v1/auth/password-reset/route.ts:9`             | Exact absolute redirect destinations for reset and invitation links. Empty rejects every one.    | `set` / `required` / `required`   | required                              | n/a     | The public web origin's own URLs (Owner decision)                            | you write it in apps/api/.env.local |
| `LOGIN_MAX_FAILED_ATTEMPTS`        | `apps/api/src/modules/iam/application/authentication-service.ts:413` | Consecutive failures before lockout. Default 5, bounded 1..100.                                  | `default` / `default` / `default` | optional                              | n/a     | A policy decision, once one is made                                          | not needed locally                  |
| `LOGIN_FAILURE_WINDOW_MINUTES`     | `apps/api/src/modules/iam/application/authentication-service.ts:409` | Window over which failures are counted. Default 15, bounded 1..1440.                             | `default` / `default` / `default` | optional                              | n/a     | A policy decision, once one is made                                          | not needed locally                  |

## 10. Inventory — API tier, object storage

| Name                               | Consumer (path:line)                                                         | Purpose                                                                              | local / staging / production      | Requirement       | Secret? | Valid source and how to set it                            | Local value available?  |
| ---------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------- | ----------------- | ------- | --------------------------------------------------------- | ----------------------- |
| `STORAGE_PROVIDER`                 | `apps/api/src/modules/shared-services/index.ts:231`                          | Adapter selection: `unconfigured` (default, refuses), `local_fake`, `s3_compatible`. | `set` / `required` / `required`   | required          | n/a     | Derived locally by `scripts/dev/storage-env.mjs`          | derived by the launcher |
| `STORAGE_S3_ENDPOINT`              | `apps/api/src/modules/shared-services/index.ts:246`                          | S3-compatible endpoint. Local Supabase serves it at `/storage/v1/s3`.                | `set` / `required` / `required`   | feature-dependent | n/a     | Derived locally from `supabase status -o env`             | derived by the launcher |
| `STORAGE_S3_REGION`                | `apps/api/src/modules/shared-services/index.ts:247`                          | S3 region. Default `local`.                                                          | `set` / `required` / `required`   | feature-dependent | n/a     | Derived locally; from the provider in production          | derived by the launcher |
| `STORAGE_S3_ACCESS_KEY_ID`         | `apps/api/src/modules/shared-services/index.ts:248`                          | S3 credential.                                                                       | `set` / `required` / `required`   | feature-dependent | secret  | Derived locally; from the provider in production          | derived by the launcher |
| `STORAGE_S3_SECRET_ACCESS_KEY`     | `apps/api/src/modules/shared-services/index.ts:249`                          | S3 credential.                                                                       | `set` / `required` / `required`   | feature-dependent | secret  | Derived locally; from the provider in production          | derived by the launcher |
| `STORAGE_S3_FORCE_PATH_STYLE`      | `apps/api/src/modules/shared-services/index.ts:251`                          | Addressing style. Default `true`.                                                    | `set` / `required` / `required`   | feature-dependent | n/a     | Whatever the endpoint requires                            | derived by the launcher |
| `STORAGE_BUCKET`                   | `apps/api/src/modules/shared-services/index.ts:232`                          | Bucket name. Default `rootlco-attachments`. Never a path, never caller-supplied.     | `set` / `required` / `required`   | feature-dependent | n/a     | Provisioned out of band with its own policy and lifecycle | derived by the launcher |
| `STORAGE_UPLOAD_URL_TTL_SECONDS`   | `apps/api/src/modules/shared-services/application/attachment-service.ts:358` | Signed upload lifetime. Default 600, bounded 30..900.                                | `default` / `default` / `default` | optional          | n/a     | Override only with a measured reason                      | not needed locally      |
| `STORAGE_DOWNLOAD_URL_TTL_SECONDS` | `apps/api/src/modules/shared-services/application/attachment-service.ts:730` | Signed download lifetime. Default 120, bounded 15..600.                              | `default` / `default` / `default` | optional          | n/a     | Override only with a measured reason                      | not needed locally      |
| `STORAGE_MAX_UPLOAD_BYTES`         | `apps/api/src/modules/shared-services/application/attachment-service.ts:323` | Platform CEILING per object, 25 MiB default. The per-category limit still applies.   | `default` / `default` / `default` | optional          | n/a     | Override only with a measured reason                      | not needed locally      |

## 11. Inventory — API tier, message delivery and budgets

| Name                               | Consumer (path:line)                                                           | Purpose                                                                                    | local / staging / production      | Requirement       | Secret? | Valid source and how to set it                      | Local value available? |
| ---------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | --------------------------------- | ----------------- | ------- | --------------------------------------------------- | ---------------------- |
| `NOTIFICATION_PROVIDER`            | `apps/api/src/modules/shared-services/application/message-dispatcher.ts:138`   | Delivery adapter. Default `unconfigured`, which refuses. **No adapter is implemented.**    | `default` / `default` / `default` | feature-dependent | n/a     | Nothing to select until an adapter exists           | not needed locally     |
| `NOTIFICATION_PROVIDER_TIMEOUT_MS` | `apps/api/src/modules/shared-services/application/message-dispatcher.ts:138`   | Per-attempt timeout. Default 5000, bounded 100..60000.                                     | `default` / `default` / `default` | optional          | n/a     | Override only with a measured reason                | not needed locally     |
| `NOTIFICATION_MAX_RENDERED_CHARS`  | `apps/api/src/modules/shared-services/application/notification-service.ts:173` | Rendered message ceiling. Default 20000, bounded 256..262144.                              | `default` / `default` / `default` | optional          | n/a     | Override only with a measured reason                | not needed locally     |
| `READINESS_TIMEOUT_MS`             | `apps/api/src/modules/shared-services/application/health-service.ts:72`        | Budget for the whole readiness probe. Default 2000, bounded 50..10000.                     | `default` / `default` / `default` | optional          | n/a     | Match it to the balancer's own probe timeout        | not needed locally     |
| `EXPORT_MAX_ROWS`                  | `apps/api/src/modules/reporting/application/report-export-service.ts:94`       | Largest row estimate a synchronous export is authorised for. Default 50000.                | `default` / `default` / `default` | optional          | n/a     | Override only with a measured reason                | not needed locally     |
| `LOG_LEVEL`                        | `apps/api/src/server/observability/logger.ts:55`                               | Server verbosity. Unset or unrecognised falls back to `warn` under test, `info` otherwise. | `unset` / optional / optional     | optional          | n/a     | Set explicitly if a deployment wants something else | not needed locally     |
| `NODE_ENV`                         | `apps/api/src/config/env.ts:104`, `server/cache/keys.ts`, `logger.ts`          | Runtime mode. Provided by the toolchain; never written into a template.                    | `default` / `default` / `default` | provided          | n/a     | The toolchain sets it                               | not needed locally     |

## 12. Inventory — scripts, CI and the database harness

None of these is read by application code, and none is loaded from a dotenv file. They are shell
inputs to a command you run by hand or that CI runs for you.

| Name                                                                                                                                           | Consumer                                                             | Purpose                                                                                                                                                                                                                                                                                                                           | Requirement               | Secret?                                    | Valid source                                       | Local value available? |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------ | -------------------------------------------------- | ---------------------- |
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASSWORD`                                                                                          | `scripts/db/*.mjs` (e.g. `apply-migrations.mjs:84`)                  | Direct connection for the migration and seed harness. Hard-coded local defaults.                                                                                                                                                                                                                                                  | optional                  | secret (`DB_PASSWORD`)                     | Your shell, only when overriding the local default | not needed locally     |
| `PGHOST` `PGPORT` `PGDATABASE` `PGUSER` `PGPASSWORD`                                                                                           | `scripts/**` via `pg`                                                | The `libpq` family, honoured when the explicit names above are absent.                                                                                                                                                                                                                                                            | optional                  | secret (`PGPASSWORD`)                      | Your shell                                         | not needed locally     |
| `ROOTLCO_ENV`                                                                                                                                  | `scripts/db/provision-organization.mjs:76`, `scripts/platform/*.mjs` | Fail-closed guard, and **the accepted values differ by script**: `local-pilot`/`production-pilot` for provisioning, `local-acceptance`/`production-genesis` for the three platform scripts. Nothing reconciles the two vocabularies.                                                                                              | required for that command | n/a                                        | Your shell, deliberately, per invocation           | not needed locally     |
| `ROOTLCO_ACCEPTANCE_CONFIRM`                                                                                                                   | `scripts/dev/owner-acceptance/*`                                     | Explicit confirmation before a destructive acceptance step runs.                                                                                                                                                                                                                                                                  | required for that command | n/a                                        | Your shell, deliberately                           | not needed locally     |
| `ROOTLCO_API_BASE_URL`                                                                                                                         | `scripts/**`, `apps/web/tests/**`                                    | Where an acceptance or browser run should send HTTP.                                                                                                                                                                                                                                                                              | optional                  | n/a                                        | Your shell; defaults to the local API origin       | not needed locally     |
| `ROOTLCO_E2E_AUTH` `ROOTLCO_E2E_EMAIL` `ROOTLCO_E2E_PASSWORD` `ROOTLCO_E2E_READER_EMAIL` `ROOTLCO_E2E_READER_PASSWORD` `ROOTLCO_E2E_TENANT_ID` | `apps/web/tests/**`                                                  | Credentials and tenant for the browser tier, created by the acceptance helper.                                                                                                                                                                                                                                                    | required for that tier    | secret (the two passwords)                 | Created locally by the acceptance helper           | not needed locally     |
| `ROOTLCO_CYCLE_SKIP_BROWSER` `ROOTLCO_CYCLE_SKIP_DB`                                                                                           | `scripts/**`                                                         | Narrow a record cycle to the tiers an environment can actually run.                                                                                                                                                                                                                                                               | optional                  | n/a                                        | Your shell                                         | not needed locally     |
| `GENESIS_*` (7 names)                                                                                                                          | `scripts/platform/genesis-platform-operator.mjs`                     | Inputs to the first-operator bootstrap: operator email, display name, provider subject, home tenant code, platform login role and password, evidence path.                                                                                                                                                                        | required for that command | secret (`GENESIS_PLATFORM_LOGIN_PASSWORD`) | Owner-supplied, per invocation                     | not needed locally     |
| `GRANT_OPERATOR_EMAIL` `GRANT_EVIDENCE_PATH`                                                                                                   | `scripts/platform/grant-platform-authority.mjs`                      | Completing an EXISTING platform operator's authority: whose authority, and where to write the evidence. The script cannot mint an operator.                                                                                                                                                                                       | required for that command | n/a                                        | Owner-supplied, per invocation                     | not needed locally     |
| `ADD_OPERATOR_*` (7 names)                                                                                                                     | `scripts/platform/add-platform-operator.mjs`                         | Adding ANOTHER platform operator: the new operator's address and display name, the grantor's address and their transient password, the identity provider, the home tenant code and the evidence path. The grantor's password is read from a no-echo prompt when the variable is absent, is never an argument and is never logged. | required for that command | secret (`ADD_OPERATOR_GRANTOR_PASSWORD`)   | Owner-supplied, per invocation                     | not needed locally     |
| `BACKFILL_OPERATOR_EMAIL` `BACKFILL_EVIDENCE_PATH`                                                                                             | `scripts/db/backfill-*.mjs`                                          | Attribution and evidence destination for a one-off backfill.                                                                                                                                                                                                                                                                      | required for that command | n/a                                        | Owner-supplied, per invocation                     | not needed locally     |
| `EXPORT_FIXTURE_OPERATOR_EMAIL`                                                                                                                | `scripts/**`                                                         | Attribution for an export fixture run.                                                                                                                                                                                                                                                                                            | required for that command | n/a                                        | Your shell                                         | not needed locally     |
| `UM_OUT_DIR`                                                                                                                                   | `docs/user-manual/tools/build-pdf.mjs:53`                            | Output directory for the user-manual PDF. Must be OUTSIDE the repository; refuses when unset.                                                                                                                                                                                                                                     | required for that command | n/a                                        | Your shell                                         | not needed locally     |
| `PLAYWRIGHT_PORT`                                                                                                                              | `apps/web/tests/**`                                                  | Port the browser tier serves on.                                                                                                                                                                                                                                                                                                  | optional                  | n/a                                        | Your shell                                         | not needed locally     |
| `PHASE_OWNERSHIP_PROFILE` `PHASE_OWNERSHIP_BASE` `OWNERSHIP_EVENT_NAME` `OWNERSHIP_REF_NAME`                                                   | `scripts/ci/check-phase-ownership.mjs`                               | Which ownership profile a branch is judged under, and against what base.                                                                                                                                                                                                                                                          | required in CI            | n/a                                        | CI, from the workflow                              | not needed locally     |
| `P1_29_*` `P1_30_*` `P1_31_*` `P1_23_BASE_REF` `*_CLASSIFICATION_REGISTRY` `UPDATE_OPENAPI`                                                    | `tests/**`, `scripts/**`                                             | Regeneration and pinning switches for phase inventories and registries.                                                                                                                                                                                                                                                           | optional                  | n/a                                        | Your shell, when regenerating an artefact          | not needed locally     |
| `GITHUB_*` `GH_TOKEN` `BASE_REF` `HEAD_REF` `HEAD_BRANCH` `CI`                                                                                 | `scripts/ci/**`                                                      | Provided by GitHub Actions. Never written into a template.                                                                                                                                                                                                                                                                        | provided in CI            | secret (`GH_TOKEN`, `GITHUB_TOKEN`)        | The Actions runner                                 | not needed locally     |

## 13. Inventory — values that are not the application's

| Name                                                                         | Where                          | Status                                                                                                         |
| ---------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_INTERNAL_URL`                                                      | `docker-compose.yml:53`        | **Dead.** Substituted into the container's environment; **no source file reads it**. Compose-level only.       |
| `OPENAI_API_KEY`                                                             | `supabase/config.toml:110`     | Supabase Studio's assistant feature. Not the application's, and the feature is not used.                       |
| `SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN`, `SUPABASE_AUTH_EXTERNAL_APPLE_SECRET` | `supabase/config.toml:427,459` | Supabase features that are **not enabled**. No code path reaches either of them.                               |
| `S3_HOST`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`                     | `supabase/config.toml:413-419` | The Supabase CLI's own storage settings, not the application's. The app's names are the `STORAGE_S3_*` family. |
| `SECRET_VALUE`                                                               | `supabase/config.toml:57,395`  | An illustrative `env()` reference in the CLI's own documentation comments.                                     |

---

## 14. What startup validation refuses today

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
   `AUTH_JWT_ISSUER`, `AUTH_REDIRECT_ALLOWLIST`, a `STORAGE_PROVIDER` that cannot serve, the S3
   credentials when `s3_compatible` is selected, and `RATE_LIMIT_ENABLED` when it has been switched
   off. Every one of those has a consumer that its absence would break. Outside those two
   environments it returns nothing, so local and test behaviour is unchanged.
   `apps/api/src/server/health/readiness.ts` reports it as `configuration.production-required` and
   the verdict becomes `unavailable` when it fails. The HTTP projection in `health-service.ts` drops
   every `detail`, so the names reach an operator's log and never the response body.
   **`CORS_ALLOWED_ORIGINS` is deliberately not in that list.** It was, and it should not have been:
   nothing reads it, so a deployment could have been held out of rotation for omitting a value that
   would have changed nothing. Section 3 has the reasoning and the guard.
   **And the switch itself is not enforced.** The check is opt-in on `NEXT_PUBLIC_APP_ENV`, which
   defaults to `local` in both API schemas (`backend-config.ts:210`, `config/env.ts:28`), so a
   deployment that simply never sets it is treated as local: the list above is not evaluated,
   `configuration.production-required` reports `ok`, and every value in it may be absent. Stated
   plainly, this control catches a deployment that DECLARES itself staging or production and is
   missing something; it cannot catch one that declares nothing. Section 16 carries it as a gap
   rather than this section carrying it as a guarantee.
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
9. **`tests/foundation/reserved-settings.test.ts`** refuses the failure mode this whole section is
   about: a name that is validated while nothing reads it, silently. It derives the accepted names
   from `schema.shape` and fails when one is neither consumed in `apps/api/src` nor declared in
   `RESERVED_SETTINGS`, when a reserved name gains a consumer, or when a reserved name appears in
   the production-required set. It covers `apps/api/src/config/env.ts` and `apps/web/src/lib/env.ts`
   under the same rule, reading their keys from the schema source with the extractor in item 8 and
   looking for a consumer in the tier that owns them.

## 15. What must come from the Owner or a provider

**This is the one list of genuinely external inputs — values only the Platform Owner or a provider
can supply.** Every other list in this document, in `apps/api/.env.production.example` and in
`apps/web/.env.production.example` refers here rather than repeating it, so there is exactly one
place to keep correct. Names only: no value, no shape, no example.

Nothing below exists today. Each line is a value or a decision that has to be supplied before any
deployment is possible; none of it can be invented in this repository. A name that is merely
_accepted_ by a schema is not an external input — if nothing reads it there is nothing to supply,
which is why the three names in section 3 do not appear here.

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
  (`GENESIS_OPERATOR_EMAIL`) and which becomes the first operator identity. The procedure that
  consumes it — what it creates, what it refuses, and why no screen can do it — is
  [`platform-owner-provisioning.md`](platform-owner-provisioning.md).
- **A password for the `app_platform` LOGIN role**, if genesis is asked to create that role
  (`GENESIS_PLATFORM_LOGIN_PASSWORD`). It is the credential behind `PLATFORM_DATABASE_URL`, which is
  the first row of this list seen from the other side.

## 16. Known gaps

- **Three settings are accepted and read by nothing.** No longer stated here one by one: section 3
  is the list, with the reason for each, and a test derives it from the schema. What remains a gap
  is the underlying capability rather than the variable — there is no CORS layer on the API tier and
  no read-replica routing — and neither is a thing a value in a template can supply.
- **The production-required check is opt-in, so omitting `NEXT_PUBLIC_APP_ENV` disables it.**
  `productionConfigurationProblems()` returns an empty list unless that name is `staging` or
  `production`, and it defaults to `local` in both API schemas. A deployment that never sets it
  therefore passes `configuration.production-required` with `DATABASE_URL`, `AUTH_JWT_SECRET` and
  the rest absent — the check is inert in exactly the failure mode it exists for. Closing it needs
  a decision this document cannot take: the two candidate rules (refuse an unset value at boot, or
  derive the environment from something other than a variable a deployment can forget) both change
  what a fresh clone and the whole test tier do today. Until that decision is taken, the honest
  statement is the one in section 14 item 4: the check catches a deployment that declares itself,
  not one that declares nothing.
- **`SUPABASE_INTERNAL_URL` is set by compose and read by nothing** (`docker-compose.yml:53`). It is
  not in section 3 because it is not in any application schema: compose substitutes it, and no code
  accepts it either.
- **The two `NEXT_PUBLIC_APP_ENV` vocabularies disagree, and nothing compares them.** The difference
  is now documented rather than merely noted — section 2 has the mapping, the valid pairs and what a
  value with no equivalent does at runtime. The gap that remains is the absence of a cross-tier
  check: a deployment can still set `local` on the web tier and `production` on the API tier, and
  both processes boot.
- **`scripts/ci/check-env-contract.mjs` is in no npm script.** It runs from
  `.github/workflows/_reusable-node-quality.yml` only, so a local `npm run verify:repository` does
  not exercise it. `tests/foundation/env-contract.test.ts` covers the extraction and the set comparison in
  the unit tier, which is what makes the check reachable locally at all.
- **The two `ROOTLCO_ENV` vocabularies disagree.** `scripts/db/provision-organization.mjs` accepts
  `local-pilot` and `production-pilot`; `scripts/platform/genesis-platform-operator.mjs`,
  `scripts/platform/add-platform-operator.mjs` and `scripts/platform/grant-platform-authority.mjs`
  accept `local-acceptance` and `production-genesis`. Each fails closed on a value it does not recognise, so nothing runs by
  accident — but an operator who exports one value and then runs the other script meets a refusal
  rather than a translation, and no document other than this line records that both spellings exist.
- **The schema-key extractor is a regex, not a parse.** It matches an indented SCREAMING_SNAKE key
  followed by `z.` or by the local `bounded(` helper. A future helper with a third spelling would be
  invisible to it, which is why its test asserts the extracted COUNT against an independently
  computed one rather than only asserting membership. The same extractor now supplies the accepted
  names of `apps/api/src/config/env.ts` and `apps/web/src/lib/env.ts` to the reserved-settings
  guard, where a shape it cannot see would shrink the set instead of failing; a floor on the number
  of names extracted from each is what refuses that silently.

---

## 17. Outbound mail for the local acceptance environment

**Mail is local-only, and this section does not change that.** Every message the auth service
produces — confirmation, recovery, invitation — is captured by the local mailbox on 54324
(`supabase/config.toml:120`, `[local_smtp]`) and nothing leaves the machine. That is the default, it
is what every acceptance run so far has measured, and it is still true after this section.

What is new is that the alternative is now written down rather than absent.
`supabase/config.toml:365` carries an `[auth.email.smtp]` block with `enabled = false`
(`supabase/config.toml:367`). Setting that one flag to `true` and restarting the stack is the whole
of activation; setting it back to `false` and restarting is the whole of the way back. Both steps
are spelled out below, because that restart has two consequences that are easy to forget: which of
the two stop commands is safe to use, and a signing-key finding that returns every time.

**The Owner has selected the relay** — the mail service on the `rootlco.com` hosting account,
recorded 2026-09-23 and written out in 17.3. That selection lives in prose and in the comments
beside the block; it does not live in a value. **The code stays provider-neutral**: no hostname, no
port default, no username convention and no provider name appears in `scripts/dev/check-smtp.mjs`,
and `supabase/config.toml` names the provider only in a comment. A provider that requires a
specially generated password and a provider that takes the mailbox's ordinary one are the same case
to every file here, so a later change of provider costs the repository one `.env` edit and no code.

The five string values are `env(...)` references, so the account and its password are not in this
repository and cannot be. The Supabase CLI expands them from an **untracked `.env`**, matched by the
`.env` rule in `.gitignore`. There is no template for this file and no example value: whoever
configures a machine writes it there and nowhere else. Two properties of that expansion are worth
knowing before the flag is flipped.

- **The env file is resolved from the directory the CLI is run in**, not from `--workdir`. Starting
  the stack from anywhere other than the root of the checkout leaves the references unexpanded.
- **An absent variable is not caught.** The unexpanded text is a non-empty string, so the file still
  parses and the relay simply becomes a hostname that does not resolve — the failure shows up as
  auth mail that never sends, not as a refusal to start. Nothing in the CLI, and nothing in this
  repository, compares the file against the names the block needs; the pre-activation mode of the
  relay check described below is the only thing that does. `port` is the exception, and it is why
  that one field is a literal rather than a reference: a string there fails the number field and the
  CLI refuses the whole file with `ProjectConfigParseError`, which would stop every machine and
  every CI job that has no `.env`, including the ones that send no mail at all.

### 17.1 The six names

| Name               | Config key                        | Read by                                                              | Secret |
| ------------------ | --------------------------------- | -------------------------------------------------------------------- | ------ |
| `SMTP_HOST`        | `auth.email.smtp.host:370`        | the auth service, and the relay check                                | no     |
| `SMTP_PORT`        | not referenced by the config      | the relay check ONLY — the config is a literal                       | no     |
| `SMTP_USER`        | `auth.email.smtp.user:380`        | the auth service, and the relay check                                | no     |
| `SMTP_PASS`        | `auth.email.smtp.pass:384`        | the auth service, and the relay check                                | YES    |
| `SMTP_ADMIN_EMAIL` | `auth.email.smtp.admin_email:388` | the auth service, and the relay check's send mode, which sends AS it | no     |
| `SMTP_SENDER_NAME` | `auth.email.smtp.sender_name:390` | the auth service, and the relay check's send mode                    | no     |

Six names, not five. **`SMTP_PASS` is the only secret**; the other five are ordinary settings and
may appear in a run log. Five of the six are read by the configuration; `SMTP_PORT` is read only by
the relay check, and the port the auth service uses is the literal on `supabase/config.toml:377`.
Keep the two equal, because nothing compares them.

**Where the values live, and what does not protect them.** The file is the untracked `.env` at the
root of the checkout the CLI is run from — on the machine this harness runs on,
`C:/Users/Ezzaldeen/wt-od-harness/.env`. It is git-ignored, and that is exactly why it is outside
the reach of `npm run security:all`: the tracked-secret scanner enumerates files through
`git ls-files`, so an ignored file is never read and never flagged. Its protection is the ignore
rule and the filesystem, and nothing else. Never copy a value out of it into a commit, a document, a
test fixture, an issue or a pasted terminal transcript.

### 17.2 What the auth service actually receives

Read from the pinned CLI itself (`supabase@2.110.0`, binary
`node_modules/@supabase/cli-windows-x64/bin/supabase.exe`) rather than from documentation about it.
The binary carries exactly these mailer variables, which is what `[auth.email.smtp]` becomes:

| Config key    | Container variable        |
| ------------- | ------------------------- |
| `host`        | `GOTRUE_SMTP_HOST`        |
| `port`        | `GOTRUE_SMTP_PORT`        |
| `user`        | `GOTRUE_SMTP_USER`        |
| `pass`        | `GOTRUE_SMTP_PASS`        |
| `admin_email` | `GOTRUE_SMTP_ADMIN_EMAIL` |
| `sender_name` | `GOTRUE_SMTP_SENDER_NAME` |

One more, `GOTRUE_SMTP_MAX_FREQUENCY`, comes from the rate-limit block rather than from this one.
**Sender identity is `admin_email` and `sender_name`, and nothing else** — there is no separate
from-address setting. The same CLI pins the auth image at `supabase/gotrue:v2.193.0`.

**Whether that image performs STARTTLS on port 587 is NOT ESTABLISHED.** The CLI hands it a host and
a port and no variable that names a transport, this repository contains no statement about the
mailer's TLS behaviour, and the CLI's own strings describe none. So the committed value stays at
`465`, implicit TLS, which is the one the relay check is proven against. Choosing 587 for the auth
service is possible — see the activation path — but it means editing the literal on
`supabase/config.toml:377`, and it would be a change whose outcome is observed rather than
predicted. Port 587 is offered as an option below on exactly that footing: the relay check speaks
it, and the auth container's support for it is unknown rather than denied.

**What was measured, and what it is not evidence for.** `node scripts/dev/check-smtp.mjs --probe`
reached the selected relay on both ports on 2026-09-23: on `465` it reported `implicit TLS,
encrypted: true`, and on `587` it reported `STARTTLS, encrypted: true`, advertising `PLAIN LOGIN` on
each. No credential was transmitted in either run. That is a measurement of **the relay**, made by
this script. It says nothing about the auth container, which is a different SMTP client whose TLS
behaviour on 587 remains unestablished, so the paragraph above is unchanged by it.

### 17.3 The selected relay

The Owner selected the mail service on the `rootlco.com` hosting account, recorded 2026-09-23. Its
settings take this shape:

| Setting     | Value                                                                                |
| ----------- | ------------------------------------------------------------------------------------ |
| host        | `smtp.hostinger.com`                                                                 |
| port        | `465` implicit TLS — or `587` STARTTLS if the mailbox product supports it (see 17.2) |
| username    | the **complete mailbox address**, not the local part                                 |
| password    | that mailbox's own password, typed locally by the Owner                              |
| admin_email | an address the mailbox is authorised to send as                                      |
| sender_name | `RootLco`                                                                            |

Four things about it, all of which matter more than the table.

- **The Owner must confirm the mailbox and the connection details before activation.** Hosting a
  domain does not establish that a mailbox exists on it, which email product the account carries, or
  what host and port that product publishes. The authority is the account's own email section, read
  by the Owner; the values above are what to expect there, not a substitute for looking.
- **The password is whatever the provider issued.** No file in this repository trims it, folds its
  case, measures its length or checks its shape, and none may be added that does. Spaces, symbols
  and unusual lengths are all transmitted byte for byte. In the `.env` file a value runs from the
  first `=` to the end of the line and is read exactly as written, leading and trailing spaces
  included; the single exception is that one pair of surrounding quotes is removed, which is how a
  value whose own edges are spaces is written down legibly. `tests/ci/owner-acceptance-password.test.ts`
  asserts both forms against a real file on disk, because the parser — not the caller — is where a
  well-meaning "tidy the input" line would otherwise live.
- **The login and the sender are two identities.** `SMTP_USER` logs in; `SMTP_ADMIN_EMAIL` is the
  address the auth service presents as the sender (17.2). A relay that accepts the login and refuses
  that sender address is a real failure mode, so `SMTP_ADMIN_EMAIL` must be an address the mailbox
  is authorised to send as — which, on most mail products, means the mailbox's own address unless an
  alias has been configured for it.
- **The Platform Owner login is unchanged.** It remains `owner@rootlco.com`. Nothing about the relay
  alters which account signs in.

### 17.4 Two email systems, and which one these settings affect

These are different questions with different owners, and conflating them is how a configured relay
gets read as a working notification capability.

| System                                 | What it sends                                                           | Configured by                                                       | State                                             |
| -------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------- |
| **(a) Authentication email**           | The identity service's account mail: confirmation, recovery, invitation | `[auth.email.smtp]` and the six `SMTP_*` names in this section      | Prepared, not in force. `enabled = false`         |
| **(b) Application notification email** | The product's own notifications                                         | `NOTIFICATION_PROVIDER` and the `MessageProvider` port (section 11) | No production adapter exists. The default refuses |

**Every setting in this section affects (a) and only (a).** Activating the relay gives (b) no
outbound path, and a green relay check is not evidence about (b).

System (b) is governed by the P1-15 owner gate, which states the position in terms this section must
not overstate: where no production provider is approved the phase "delivers a provider-neutral port
plus a deterministic fake and, where appropriate, a local/development adapter only — and claims no
production delivery" (`docs/phase-1/phase-1-15/phase-1-15-owner-gate.md:343-346`, repeated at
`:385-390`). In code that is exactly what exists:

- `MessageProvider` in `apps/api/src/modules/shared-services/provider/message-provider.ts` is the
  port. Its `DeliveryRequest` carries **no recipient address field** — an opaque `recipientRef`
  only — because the platform deliberately never holds a plaintext destination.
- `UnconfiguredMessageProvider` is the default and **refuses to deliver** rather than pretending,
  throwing an `outage` failure with the summary `provider_unconfigured`.
- `LocalMessageProvider` is the deterministic in-process fake. It reaches no network, and exists so
  the retry, timeout, outage and dead-letter paths are exercised by real code.
- `NOTIFICATION_PROVIDER` defaults to `unconfigured` in `apps/api/src/server/config/backend-config.ts`
  and selects an adapter in `buildMessageProvider()` in
  `apps/api/src/modules/shared-services/index.ts`, which today knows `local_fake` and nothing else.
- **Enqueue is not blocked.** A successful queue call durably writes one `shared.outbound_messages`
  row in `pending`; the provider is contacted only by the worker. So business modules integrate
  against notifications today, and what nobody can claim is that a message reached anyone.

Choosing a production provider for (b) is the open Owner decision **OD-02** in
`docs/phase-1/phase-1-15/open-decisions.md`, which names what has to be decided: the service per
channel, the sending identity and domain, how a recipient reference resolves to an address inside
the adapter, the commercial plan and its throughput ceiling, and the retention position for
provider-side logs. **Nothing in this change implements an adapter, and none may be written before
that decision is recorded.** For the reader who will do the work afterwards, what remains is: one
adapter class implementing `MessageProvider` with a `code` that satisfies
`ck_delivery_attempts_provider_format`, resolving `recipientRef` to an address inside itself against
its own configuration; a branch for it in `buildMessageProvider()` keyed on `NOTIFICATION_PROVIDER`;
its credential and endpoint settings added to the backend config schema and to both `.env.example`
contracts; and its own suite. The relay configured in this section is not that adapter and cannot
be used as one — an SMTP relay for the identity container is not reachable from API source, which
holds no SMTP client.

### 17.5 The four stages of proof

Outbound mail is proven in four stages. They are separate because a pass at one is no evidence at
all for the next, and reporting them as a single result is how "the relay accepted it" becomes "the
mail arrived".

| Stage | What it establishes                                                 | How it is measured                                                      |
| ----- | ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **1** | **SMTP authentication** — the relay accepts the credential          | `node scripts/dev/check-smtp.mjs --authenticate`                        |
| **2** | **Relay acceptance** — the relay accepts one message for delivery   | `node scripts/dev/check-smtp.mjs --send --to <address>`                 |
| **3** | **Inbox receipt** — that message is seen in the destination mailbox | A person looks in the mailbox. No command, and no IMAP client exists    |
| **4** | **Application flows** — recovery and invitation complete end to end | With `enabled = true` and the stack restarted, run both flows in the UI |

Stage 3 has no automated form on purpose: reading a mailbox is not needed in order to send mail, so
no IMAP capability is built here. Stage 4 is the only stage that involves the application at all;
stages 1 to 3 are statements about a relay and a mailbox and would hold identically with the flag
off.

Two modes of the relay check reach **no stage**. `--settings` opens no socket, so it is a statement
about this machine; `--probe` transmits no credential, so the mechanisms it lists are what the relay
offers rather than a verdict on the password. Both are preconditions, and neither may be recorded as
a stage result.

### 17.6 The relay check

`scripts/dev/check-smtp.mjs` speaks SMTP to the relay directly. It needs no container, no running
stack and no database, which is what makes it usable while an acceptance campaign is in progress —
the check itself touches nothing. **Activation is a different matter**: it restarts the stack, and
17.8 says what that costs and which stop command must not be used. It has four modes, graded by what
each risks, and exactly one must be named:

| Mode                    | Stage reached | Opens a socket | Sends the password | Sends mail |
| ----------------------- | ------------- | -------------- | ------------------ | ---------- |
| `--settings`            | none          | no             | no                 | no         |
| `--probe`               | none          | yes            | no                 | no         |
| `--authenticate`        | 1             | yes            | yes                | no         |
| `--send --to <address>` | 2             | yes            | yes                | yes        |

```
node scripts/dev/check-smtp.mjs --settings
node scripts/dev/check-smtp.mjs --probe
node scripts/dev/check-smtp.mjs --authenticate
node scripts/dev/check-smtp.mjs --send --to someone@example.com
```

- `--settings` is the **pre-activation check**, and it exists because the CLI does not catch an
  unset variable. It reports, as names and booleans only, whether each of the six is present and
  non-empty, whether `SMTP_USER` is a complete mailbox address, whether `SMTP_ADMIN_EMAIL` is set,
  and whether the port is one the transport rules recognise. It prints no value of any kind, secret
  or not, so its output is safe to paste anywhere. It opens no socket and reaches no stage.
- `--probe` negotiates the connection and prints the AUTH mechanisms the relay advertises, then
  quits. No credential is transmitted, so it is the safe first contact with a relay whose lockout
  policy is unknown — and, for the same reason, it reaches no stage.
- `--authenticate` is **stage 1**: it proves the password and quits without an envelope. AUTH is a
  session command and a session that ends after it is complete and legal, so this reaches a verdict
  on the credential without sending anything to anyone.
- `--send` is **stage 2**: it adds one real message to one real recipient. **There is no default
  recipient**: the address must be given on the command line, so the script never chooses whose
  mailbox to write to, and a `--to` value that begins with `--` is refused rather than treated as an
  address. It sends **as `SMTP_ADMIN_EMAIL`**, which is the identity the auth service presents
  (17.2), rather than as `SMTP_USER`, which only logs in. That distinction matters: a relay that
  accepts the login and refuses that sender address is a failure this mode meets and a
  login-addressed message would not.

Each mode prints the stage it reaches and names the stages it leaves unproven, so a transcript
cannot be read as more than it is.

The transport follows the port: `465` is implicit TLS, `587` is STARTTLS (EHLO, STARTTLS, upgrade,
EHLO again), and any other port is refused rather than guessed. In both cases the session **refuses
to authenticate over a connection that is not encrypted**, and there is no flag that relaxes it: a
relay on 587 that does not advertise STARTTLS ends the run before AUTH is reached. The password is
never printed, and neither is the AUTH exchange. Those properties are asserted by
`tests/ci/owner-acceptance-password.test.ts`, which drives every mode against a local server.

### 17.7 What the Owner types locally, and in what order

Open `C:/Users/Ezzaldeen/wt-od-harness/.env` in a plain-text editor and write these six lines, one
per line, each as `NAME=value` with no quotes needed and no spaces around the `=`: `SMTP_HOST`
takes the relay hostname from the hosting account's email section, expected to be
`smtp.hostinger.com`; `SMTP_PORT` takes `465`; `SMTP_USER` takes the **complete mailbox address**
including the `@` and the domain, not the part before it; `SMTP_PASS` takes that mailbox's own
password exactly as the account screen shows it, with no trimming and no quotes unless the value
itself begins or ends with a space, in which case wrap the whole value in one pair of double quotes;
`SMTP_ADMIN_EMAIL` takes an address the mailbox is authorised to send as, which is normally the same
address as `SMTP_USER`; and `SMTP_SENDER_NAME` takes `RootLco`. Save the file, do not commit it —
it is git-ignored and must stay that way — and never paste any of its lines into a document, an
issue or a terminal transcript. Then, from `C:/Users/Ezzaldeen/wt-od-harness`, run the four stages
in order and stop at the first refusal:

```
node scripts/dev/check-smtp.mjs --settings
node scripts/dev/check-smtp.mjs --probe
node scripts/dev/check-smtp.mjs --authenticate
node scripts/dev/check-smtp.mjs --send --to owner@rootlco.com
```

The first must print `true` on every line. The second must list at least one AUTH mechanism. The
third is **stage 1** and its refusal, if any, is the relay's own verdict on the credential, printed
in the relay's own words. The fourth is **stage 2**. **Stage 3** is then confirming that the message
arrived in the destination mailbox, which no command can do. Only after stage 3 holds is activation
worth attempting: set `enabled = true` on `supabase/config.toml:367`, then

```
npx supabase stop
npm run supabase:start
node scripts/dev/owner-acceptance/align-local-jwt.mjs
```

— **never `npm run supabase:stop`**, for the reason 17.8 gives — and then run a password recovery
and an invitation from the application and confirm both mails arrive and both links complete. That
last step is **stage 4**, and it is the only one that says anything about the product.

### 17.8 Activation, and the way back

Nothing below needs the network until step 2, and nothing sends mail until step 4.

1. Write the six names into the untracked `.env` and run `node scripts/dev/check-smtp.mjs
--settings`. Every line must read `true`. No stage is reached.
2. `node scripts/dev/check-smtp.mjs --probe`, then `--authenticate`. The probe reaches no stage; the
   second is **stage 1**, and a refusal here is the relay's verdict on the credential and is printed
   in the relay's own words.
3. `node scripts/dev/check-smtp.mjs --send --to <address>` is **stage 2**, and confirming that
   message in the destination mailbox is **stage 3**. Both are worth having before the flag moves,
   because a failure found here is a failure with no restart attached to it.
4. Set `enabled = true` on `supabase/config.toml:367`. If — and only if — the auth service is to use
   587, change the literal `port` on `supabase/config.toml:377` at the same time, with the caveat in
   17.2 in mind.
5. Restart the stack **from the root of the checkout**, so the `env(...)` references resolve. Use
   the CLI's own stop, not the repository's script:

   ```
   npx supabase stop
   npm run supabase:start
   ```

   **`npm run supabase:stop` must not be used here.** It is `supabase stop --no-backup`
   (`package.json`), and the pinned CLI's own description of that flag is "Deletes all data volumes
   after stopping." Those volumes are the local database on `127.0.0.1:54322` — the acceptance
   environment — so the script ends any campaign in progress and takes its data with it. Plain
   `supabase stop` keeps the CLI's `--backup` default, described by the same binary as "Backs up the
   current database before stopping", and leaves the volumes alone. The `npx` form runs the same
   pinned CLI the npm scripts run, from `node_modules/.bin`. Both commands must be run from the
   checkout root: the CLI resolves `.env` from the working directory, so starting from anywhere
   else silently leaves the block unexpanded.

   If the data volumes are destroyed anyway, rebuilding is `npm run supabase:start`,
   `npm run supabase:reset` to apply every migration and seed, `npm run acceptance:create-owner`,
   and `npm run acceptance:provision-fixtures`. Anything a campaign had produced and not yet
   recorded is gone, and a campaign that was mid-run restarts from the beginning.

6. **Re-apply `node scripts/dev/owner-acceptance/align-local-jwt.mjs`.** Finding `P1-26-F-045`
   returns after every restart: `supabase start` recreates the auth container with a freshly
   generated asymmetric signing key, the API verifies HMAC only, and sign-in then returns a token
   that the very next request rejects with `ERR-IAM-002`. The symptom is not "mail is broken" — it
   is that nobody can stay signed in — so it is easy to attribute to the wrong change.
7. Run a password recovery and an invitation from the application, confirm both mails arrive, and
   confirm both links complete. That is **stage 4**, and it is the only step that measures the
   product rather than the relay.

The way back is the same shape: set `enabled = false` (and restore `port = 465` if it was moved),
`npx supabase stop` and `npm run supabase:start` from the checkout root — the same non-destructive
pair, for the same reason — and re-apply `align-local-jwt.mjs`. Local-only mail resumes with no
other edit.

### 17.9 What this does not settle

**All four stages are unproven as this is written.** The configuration is committed with
`enabled = false` and no mailbox password exists on this machine, so stage 1 has never been
attempted, and stages 2, 3 and 4 depend on it. Nothing in this repository should be read as
evidence that mail leaves this machine.

The Platform Owner account keeps the address it already has — that is decided, and nothing in this
change alters it. What is **not** established is whether that address can receive mail.

Half of that question has an answer. The `rootlco.com` domain publishes mail-exchanger records
(`mx1.hostinger.com` priority 5, `mx2.hostinger.com` priority 10, resolved 2026-09-19) and an SPF
record naming the same provider, so mail addressed to the domain has somewhere to be delivered.
That is a fact about the domain, not about the mailbox: whether the specific Owner address exists on
that server is answered only by sending to it and watching for a delivery-failure notice. Until a
message is seen to arrive, recovery for that account should be treated as unverified — a relay
accepting a message is not a mailbox receiving one, and an account whose recovery mail silently
disappears is recoverable only by a database-level intervention.
