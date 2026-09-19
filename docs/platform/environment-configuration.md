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

| Name                                                                                                                                           | Consumer                                                             | Purpose                                                                                                                                                                                                                            | Requirement               | Secret?                                    | Valid source                                       | Local value available? |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------ | -------------------------------------------------- | ---------------------- |
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASSWORD`                                                                                          | `scripts/db/*.mjs` (e.g. `apply-migrations.mjs:84`)                  | Direct connection for the migration and seed harness. Hard-coded local defaults.                                                                                                                                                   | optional                  | secret (`DB_PASSWORD`)                     | Your shell, only when overriding the local default | not needed locally     |
| `PGHOST` `PGPORT` `PGDATABASE` `PGUSER` `PGPASSWORD`                                                                                           | `scripts/**` via `pg`                                                | The `libpq` family, honoured when the explicit names above are absent.                                                                                                                                                             | optional                  | secret (`PGPASSWORD`)                      | Your shell                                         | not needed locally     |
| `ROOTLCO_ENV`                                                                                                                                  | `scripts/db/provision-organization.mjs:76`, `scripts/platform/*.mjs` | Fail-closed guard, and **the accepted values differ by script**: `local-pilot`/`production-pilot` for provisioning, `local-acceptance`/`production-genesis` for the two platform scripts. Nothing reconciles the two vocabularies. | required for that command | n/a                                        | Your shell, deliberately, per invocation           | not needed locally     |
| `ROOTLCO_ACCEPTANCE_CONFIRM`                                                                                                                   | `scripts/dev/owner-acceptance/*`                                     | Explicit confirmation before a destructive acceptance step runs.                                                                                                                                                                   | required for that command | n/a                                        | Your shell, deliberately                           | not needed locally     |
| `ROOTLCO_API_BASE_URL`                                                                                                                         | `scripts/**`, `apps/web/tests/**`                                    | Where an acceptance or browser run should send HTTP.                                                                                                                                                                               | optional                  | n/a                                        | Your shell; defaults to the local API origin       | not needed locally     |
| `ROOTLCO_E2E_AUTH` `ROOTLCO_E2E_EMAIL` `ROOTLCO_E2E_PASSWORD` `ROOTLCO_E2E_READER_EMAIL` `ROOTLCO_E2E_READER_PASSWORD` `ROOTLCO_E2E_TENANT_ID` | `apps/web/tests/**`                                                  | Credentials and tenant for the browser tier, created by the acceptance helper.                                                                                                                                                     | required for that tier    | secret (the two passwords)                 | Created locally by the acceptance helper           | not needed locally     |
| `ROOTLCO_CYCLE_SKIP_BROWSER` `ROOTLCO_CYCLE_SKIP_DB`                                                                                           | `scripts/**`                                                         | Narrow a record cycle to the tiers an environment can actually run.                                                                                                                                                                | optional                  | n/a                                        | Your shell                                         | not needed locally     |
| `GENESIS_*` (7 names)                                                                                                                          | `scripts/platform/genesis-platform-operator.mjs`                     | Inputs to the first-operator bootstrap: operator email, display name, provider subject, home tenant code, platform login role and password, evidence path.                                                                         | required for that command | secret (`GENESIS_PLATFORM_LOGIN_PASSWORD`) | Owner-supplied, per invocation                     | not needed locally     |
| `GRANT_OPERATOR_EMAIL` `GRANT_EVIDENCE_PATH`                                                                                                   | `scripts/platform/grant-platform-authority.mjs`                      | Completing an EXISTING platform operator's authority: whose authority, and where to write the evidence. The script cannot mint an operator.                                                                                        | required for that command | n/a                                        | Owner-supplied, per invocation                     | not needed locally     |
| `BACKFILL_OPERATOR_EMAIL` `BACKFILL_EVIDENCE_PATH`                                                                                             | `scripts/db/backfill-*.mjs`                                          | Attribution and evidence destination for a one-off backfill.                                                                                                                                                                       | required for that command | n/a                                        | Owner-supplied, per invocation                     | not needed locally     |
| `EXPORT_FIXTURE_OPERATOR_EMAIL`                                                                                                                | `scripts/**`                                                         | Attribution for an export fixture run.                                                                                                                                                                                             | required for that command | n/a                                        | Your shell                                         | not needed locally     |
| `UM_OUT_DIR`                                                                                                                                   | `docs/user-manual/tools/build-pdf.mjs:53`                            | Output directory for the user-manual PDF. Must be OUTSIDE the repository; refuses when unset.                                                                                                                                      | required for that command | n/a                                        | Your shell                                         | not needed locally     |
| `PLAYWRIGHT_PORT`                                                                                                                              | `apps/web/tests/**`                                                  | Port the browser tier serves on.                                                                                                                                                                                                   | optional                  | n/a                                        | Your shell                                         | not needed locally     |
| `PHASE_OWNERSHIP_PROFILE` `PHASE_OWNERSHIP_BASE` `OWNERSHIP_EVENT_NAME` `OWNERSHIP_REF_NAME`                                                   | `scripts/ci/check-phase-ownership.mjs`                               | Which ownership profile a branch is judged under, and against what base.                                                                                                                                                           | required in CI            | n/a                                        | CI, from the workflow                              | not needed locally     |
| `P1_29_*` `P1_30_*` `P1_31_*` `P1_23_BASE_REF` `*_CLASSIFICATION_REGISTRY` `UPDATE_OPENAPI`                                                    | `tests/**`, `scripts/**`                                             | Regeneration and pinning switches for phase inventories and registries.                                                                                                                                                            | optional                  | n/a                                        | Your shell, when regenerating an artefact          | not needed locally     |
| `GITHUB_*` `GH_TOKEN` `BASE_REF` `HEAD_REF` `HEAD_BRANCH` `CI`                                                                                 | `scripts/ci/**`                                                      | Provided by GitHub Actions. Never written into a template.                                                                                                                                                                         | provided in CI            | secret (`GH_TOKEN`, `GITHUB_TOKEN`)        | The Actions runner                                 | not needed locally     |

## 13. Inventory — values that are not the application's

| Name                                                                         | Where                          | Status                                                                                                         |
| ---------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_INTERNAL_URL`                                                      | `docker-compose.yml:53`        | **Dead.** Substituted into the container's environment; **no source file reads it**. Compose-level only.       |
| `OPENAI_API_KEY`                                                             | `supabase/config.toml:110`     | Supabase Studio's assistant feature. Not the application's, and the feature is not used.                       |
| `SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN`, `SUPABASE_AUTH_EXTERNAL_APPLE_SECRET` | `supabase/config.toml:417,449` | Supabase features that are **not enabled**. No code path reaches either of them.                               |
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
  `local-pilot` and `production-pilot`; `scripts/platform/genesis-platform-operator.mjs` and
  `scripts/platform/grant-platform-authority.mjs` accept `local-acceptance` and
  `production-genesis`. Each fails closed on a value it does not recognise, so nothing runs by
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

**Until `[auth.email.smtp]` is enabled, mail is local-only.** Every message the auth service
produces — confirmation, recovery, invitation — is captured by the local mailbox on 54324
(`supabase/config.toml:119`, `[local_smtp]`) and nothing leaves the machine. That is the default and
it is what every acceptance run so far has measured. `supabase/config.toml:314` now carries an
`[auth.email.smtp]` block that changes this, and the moment the stack is restarted with it enabled,
those messages are handed to an outside relay and arrive in real inboxes.

The block is written entirely as `env(...)` references, so the account and its password are not in
this repository and cannot be. The Supabase CLI expands them from an **untracked `.env` at the
repository root**, which is matched by the `.env` rule in `.gitignore`. There is no template for
this file and no example value: whoever configures a machine writes it there and nowhere else. If a
name is missing the CLI does not fall back — the unexpanded text fails the `port` field and the file
is refused with `ProjectConfigParseError`, so a half-configured machine cannot start.

| Name               | Config key                        | Purpose                                                                                 |
| ------------------ | --------------------------------- | --------------------------------------------------------------------------------------- |
| `SMTP_HOST`        | `auth.email.smtp.host:318`        | Hostname of the relay the auth service hands mail to.                                   |
| `SMTP_PORT`        | `auth.email.smtp.port:321`        | Relay port. Read as a number, so the value must be digits only; 465 means implicit TLS. |
| `SMTP_USER`        | `auth.email.smtp.user:323`        | The account that authenticates to the relay.                                            |
| `SMTP_PASS`        | `auth.email.smtp.pass:325`        | That account's password. Secret. The only one of the six that is.                       |
| `SMTP_ADMIN_EMAIL` | `auth.email.smtp.admin_email:329` | The From address on every message the auth service sends.                               |
| `SMTP_SENDER_NAME` | `auth.email.smtp.sender_name:331` | The display name shown beside that From address.                                        |

Six names, not five: `SMTP_PASS` is the secret and the other five are ordinary settings.
`scripts/dev/check-smtp.mjs` reads five of them — everything except `SMTP_ADMIN_EMAIL`, because it
builds its own envelope — and speaks SMTP to the relay directly. It needs no container and no
running stack, which is what makes it usable for proving a relay while an acceptance campaign is in
progress. It sends one real message each time it is run.

### Gmail specifics, if the relay is a Gmail account

- **The sender is rewritten.** Gmail delivers as the authenticated account regardless of what
  `admin_email` says. Setting that name to anything other than the account is not an error the CLI
  will catch; it simply has no effect on what recipients see. Keep the two equal so the
  configuration and the delivered mail agree.
- **An ordinary account password will not work.** Gmail requires an application-specific password
  generated for the account, and the account must have two-step verification enabled before one can
  be created. A rejected password is reported by the server at the AUTH step and nowhere else.
- **Sending is rate-limited by the provider, not by this repository.** A free Gmail account carries a
  daily recipient ceiling, and a burst of recovery mail from a test run counts against it. The
  per-hour allowance in `[auth.rate_limit] email_sent` limits what the auth service will attempt; it
  does not raise what the provider will accept.

### The open question this does not settle

The Platform Owner account keeps the address it already has — that is decided, and nothing in this
change alters it. What is **not** established is whether that address can receive mail at all.
Recovery for that account is only as real as its mailbox: if the domain has no mail exchanger, a
relay can accept the message and it will still never arrive, and the account would be recoverable
only by a database-level intervention. Establishing this needs a DNS answer and a delivered test
message, not a decision — and until both exist, the honest statement is that outbound mail is proven
and inbound delivery to the Owner's address is not.
