# Environment-parity register, and the hosted security checklist

**A reusable classification that prevents one specific false assurance: "CI is green, therefore the
hosted environment is secure."**

This document does **not** attempt to fix `B1-PGNET-BLOCKER` and does **not** call `pg_net` closed.
It exists because that blocker exposed a structural property worth naming permanently.

## What CI actually runs against — measured, not assumed

| CI tier                                                                                    | database                                       |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| clean-room                                                                                 | `postgres:17-alpine`                           |
| database-assurance                                                                         | `postgres:17-alpine`                           |
| integration-tests                                                                          | `postgres:17-alpine`                           |
| authenticated-browser                                                                      | a real local Supabase stack (`supabase start`) |
| code-security, container, dependency-security, node-quality, release-artifact, secret-scan | no database                                    |
| **hosted Supabase**                                                                        | **no tier at all**                             |

Three of the four database-bearing tiers run **bare Postgres**. One runs local Supabase. **Nothing
in CI runs against the hosted provider environment.**

That single table is the whole reason this register exists. A bare Postgres image has no
`supabase_admin`, no provider-created roles, no provider-managed extensions and none of the PUBLIC
ACLs a provider installs — so every property of that kind is not _untested_ in CI, it is
**unobservable** there.

## The four-way classification

| class                       | meaning                                                                  |
| --------------------------- | ------------------------------------------------------------------------ |
| **REPOSITORY-PROVABLE**     | static analysis of tracked files; no database needed                     |
| **LOCAL-SUPABASE-PROVABLE** | needs a running local Supabase stack                                     |
| **HOSTED-SUPABASE-ONLY**    | needs the real provider environment; no local or CI run can establish it |
| **PROVIDER-OWNER-ONLY**     | needs provider-side authority nobody in this repository holds            |

A gate's class is a property of **what it can observe**, not of how thorough it is. A
REPOSITORY-PROVABLE gate can be excellent and still be structurally blind to a PUBLIC ACL created
by the provider.

## The word "hosted" is overloaded

`hosted-clean-room`, "hosted CI" and "GitHub-hosted runner" all mean a **GitHub runner**, which runs
bare Postgres. "Hosted Supabase" means the provider. Anything built on this register must say which
it means. Recorded as `AMB-73`.

## The pre-production checklist this register implies

Before any production or pre-production release, the HOSTED-SUPABASE-ONLY and PROVIDER-OWNER-ONLY
rows below must be verified **against the real environment**, by hand or by a runbook, because no
amount of green CI can substitute:

managed extensions and their versions · PUBLIC ACLs · extension owners · database-level grants ·
schema ownership · role memberships · default privileges · network-capable extensions ·
provider-managed triggers and functions · provider-managed roles.

---

## The register

### ENV-1 — the database CI actually runs against: bare `postgres:17-alpine`

**EXISTS AND LOAD-BEARING.**

`postgres:17-alpine` is the Docker Official Image, not `supabase/postgres`. It is a plain PostgreSQL 17 server with the contrib set available but nothing created. There is no Supabase image anywhere in `.github/workflows/**`. The engine major matches the local stack (both 17); nothing else does.

_Evidence:_ `.github/workflows/_reusable-database-assurance.yml:73-84`: `services: postgres: image: postgres:17-alpine env: POSTGRES_PASSWORD: postgres # pragma: allowlist secret -- ephemeral CI service container, not a credential ports: - 54322:5432` Same image at `.github/workflows/ci.yml:288`, `_reusable-integration-tests.yml:63`, `_reusable-clean-room.yml:70`, `nightly-assurance.yml:110,190,270`, `deploy-staging.yml:62`. Nightly compatibility matrix parameterises the major only: `nightly-assurance.yml:362` `image: postgres:${{ matrix.postgres }}-alpine` with `postgres: '17'` and `postgres: '18'` (`:348-358`).

### ENV-2 — CI connects as `postgres`, which is a SUPERUSER on that image

**EXISTS AND LOAD-BEARING.**

The harness compensates rather than pretends: `tests/db/helpers.ts:1-24` documents that the admin (`postgres`) connection is for provisioning and cleanup ONLY, and every isolation assertion runs as `rootlco_test_runtime` / `rootlco_test_worker`, created by the harness (`helpers.ts:97-118`) and granted the `app_*` archetypes. That compensation is sound for RLS behaviour and does nothing for the ten property classes in PROP-1..PROP-10.

_Evidence:_ `_reusable-database-assurance.yml:86-92`: `DB_HOST: 127.0.0.1`, `DB_PORT: '54322'`, `DB_NAME: postgres`, `DB_USER: postgres`, `DB_PASSWORD: postgres`. The consequence is stated in the repository's own words at `docs/database/migration-standard.md:372-373`: "In the **plain `postgres:17` CI container**, `postgres` **is** a superuser, and the Supabase-managed roles do not exist at all."

### ENV-3 — the LOCAL developer environment: Supabase CLI stack

**EXISTS AND LOAD-BEARING.**

Local is the Supabase CLI's own Docker orchestration — Postgres, Auth, Storage, Studio, Realtime — not anything this repository composes. `supabase/config.toml:40-42` explicitly says the major "has to be the same as your remote database's", which is the only place the repository even contemplates a remote.

_Evidence:_ `supabase/config.toml:1-5` (`project_id = "RootLco"`), `:33-42` — `[db]` `port = 54322`, `shadow_port = 54320`, `major_version = 17`; `[db.pooler] enabled = false` (`:44-47`); `[api] port = 54321`, `schemas = ["public", "graphql_public"]`, `extra_search_path = ["public", "extensions"]` (`:7-15`). CLI pinned as a devDependency: `package.json:184` `"supabase": "^2.110.0"`. Scripts: `package.json:62-65` `supabase:reset` = `supabase db reset`, `supabase:start` = `supabase start`.

### ENV-4 — `docker-compose.yml` defines NO database, deliberately

**EXISTS AND LOAD-BEARING.**

So there is no third environment. The complete set is: bare-Postgres CI, Supabase-CLI local, and one CI job that borrows the local stack (ENV-5). Nothing else exists.

_Evidence:_ `docker-compose.yml:1-14`: "SCOPE: this file runs the Next.js application container ONLY. Supabase (PostgreSQL, Auth, Storage, Studio) is NOT redefined here. It is run by the official Supabase CLI… Hand-rolling a Supabase stack in this file would drift from the official service versions and is explicitly rejected in ADR-003." The `services:` block holds exactly one entry, `web` (`:20-84`).

### ENV-5 — the ONE CI job that runs a real Supabase stack, and what it does not run

**EXISTS BUT NOT USED.**

"EXISTS BUT NOT USED" for this lane's purpose: a genuine Supabase stack is stood up on every same-repository pull request, and not one catalog-derived security gate is pointed at it. `scripts/ci/rls-matrix.mjs` and `npm run test:db` run only inside `_reusable-database-assurance.yml`, whose service container is bare Postgres (`:75`, `:319-332`, `:295-298`). The Supabase-stack lane therefore proves browser-level tenant isolation and route accessibility, and proves nothing about extension owners, PUBLIC ACLs, default privileges, or provider role attributes.

_Evidence:_ `.github/workflows/_reusable-authenticated-browser.yml:179-183` (`npx --no-install supabase start`), `:185-193` (`npm run supabase:reset`), `:201` (`supabase status -o json`). The commands it goes on to run are `npm run test:e2e:install` (`:236`), `acceptance:create-owner` (`:295`), `build:api`/`build:web` (`:300-301`), `acceptance:provision-fixtures` (`:408`), `npm run test:web-e2e-authenticated` (`:422`). Grep for `test:db` or `rls-matrix` in that file returns nothing.

### ENV-6 — no hosted / provider environment exists at all

**MISSING.**

Consequence for the classification: HOSTED-SUPABASE-ONLY is a real and necessary category, and it currently contains zero implemented gates — not because everything is covered elsewhere, but because there is no environment to point one at. Every PROP-* item below is, today, unprovable in every environment the repository owns except by hand on a developer's local stack.

_Evidence:_ `docs/adr/ADR-012-local-first-environment-with-controlled-promotion.md:7` — "This ADR does not approve any hosted environment"; `:26` "Phase 1-1 implements the **Local environment only**"; `:33-35` Development / Staging / Production each "Planned — not provisioned". `deploy-staging.yml:1-22` — "THIS WORKFLOW DOES NOT DEPLOY. It cannot: no hosting provider has been chosen, no staging environment is provisioned". `deploy-production.yml:1-20` — same, plus "the deployment steps are inert". A repository-wide grep for `supabase.co`, `project_ref`, `SUPABASE_ACCESS_TOKEN` or `supabase link` over `docs`, `.github`, `supabase`, `scripts`, `package.json` returns zero hosted-project references (only `supabase db push` named in prose at `docs/adr/ADR-003-supabase-and-postgresql-data-platform.md:40`).

### ENV-7 — the CI database image is NOT digest-pinned, while every action is

**EXISTS AND LOAD-BEARING.**

The exact PostgreSQL patch level a given run measured is therefore not recoverable from the tree, and a silent upstream `17.x` bump changes the substrate under `structuralTotals` and the schema hash without any diff. The same floats on the local side: `"supabase": "^2.110.0"` (`package.json:184`) is a caret range, so the Supabase image set the CLI pulls can move too.

_Evidence:_ `image: postgres:17-alpine` at all eight call sites carries no `@sha256:` digest. By contrast `scripts/ci/check-workflow-security.mjs:11-12` enforces `WFS-001 every third-party \`uses:\` is pinned to a full 40-hex commit SHA`and`WFS-002`requires a version comment; e.g.`actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`. The rule set covers `uses:`, not `services.*.image`.

### ENV-8 — the parity gap is DOCUMENTED, with measured numbers, not merely implied

**EXISTS AND LOAD-BEARING.**

The standard also states the binding consequence at `migration-standard.md:382-385`: "any future behaviour that _does_ depend on Supabase-managed roles (e.g. policies targeting `authenticated`, PostgREST exposure) cannot be considered CI-verified by this job and must carry its own evidence from the local Supabase stack until CI grows a Supabase lane." CI has not grown that lane for the database tier (ENV-5).

_Evidence:_ `docs/database/migration-standard.md:358` — heading "## 15. Honest gap — CI validates plain PostgreSQL, not the full Supabase stack", and `:362-385` gives the measured role landscape both sides. `docs/database/role-and-grant-standard.md:178-191` — the measured `pg_roles` table for the local stack (CLI 2.109.1, PostgreSQL 17.6, 2026-07-16). `docs/database/migration-standard.md:294-298` — the promotion table with exactly two rows: Local (Supabase stack) and CI (`postgres:17-alpine`). `docs/database/postgresql-extension-register.md:223-229` repeats it.

### PROP-1 — managed extensions (pg_graphql, pgsodium, supabase_vault, pgjwt, pg_stat_statements, uuid-ossp)

**MISSING.**

Reason: the objects do not exist in the CI image, so every assertion about them evaluates over an empty set and passes. `foundation.test.ts:561-570` asserts the four APPROVED extensions are present and in schema `extensions`; nothing asserts anything about the eight environment ones beyond "do not fail the run".

_Evidence:_ `tests/db/foundation.test.ts:272-287`: "Extensions the ENVIRONMENT itself ships: plpgsql is a PostgreSQL default; the rest are pre-installed by the Supabase local image (absent in the plain postgres:17 CI container)", listing `plpgsql, pg_net, pg_stat_statements, supabase_vault, uuid-ossp, pg_graphql, pgjwt, pgsodium`. The gate that consumes it, `:631-639`, filters them out unconditionally.

### PROP-2 — PUBLIC ACLs created by a provider

**MISSING.**

Reason: a PUBLIC grant made by the provider is attached to a provider object in a provider schema, and CI's database contains neither. The repository does assert PUBLIC EXECUTE revocation on its OWN functions (`tests/db/rls.test.ts:175-176`, `shared-document-evidence-lifecycle.test.ts:529-543`, `veh-security.test.ts:119`, `p1-10-security.test.ts:70`) — which is exactly the coverage that makes the provider-side absence easy to mistake for coverage.

_Evidence:_ No gate reads a provider-created ACL: `grep -rn "pg_default_acl|datacl|nspacl|relacl|proacl|has_database_privilege|pg_auth_members"` over `scripts/ci/rls-matrix.mjs` and `scripts/db/*.mjs` returns nothing; repository-wide over `*.mjs|*.ts|*.js|*.sql` it matches only `tests/db/p1-14-runtime-administration-capabilities.test.ts:981` and `tests/db/shared-hardening.test.ts:250`, both `has_schema_privilege` and both scoped to the three `app_*` roles. The repository knows such ACLs exist — `tests/db/shared-hardening.test.ts:246-248`: "USAGE on `extensions` would also expose extensions.pg_stat_statements, which pgcrypto grants to PUBLIC" — but the object named is absent from CI.

### PROP-3 — extension owners

**MISSING.**

Reason: in CI every extension is created by the migration runner connecting as the superuser `postgres`, so the owner is a constant and an assertion over it would be a tautology. On a Supabase database the approved four are still ours but the eight environment extensions are owned by `supabase_admin` or `postgres`, and that ownership decides who can `ALTER EXTENSION`/`DROP EXTENSION` — a question CI is structurally unable to pose.

_Evidence:_ The only `pg_extension` reads in the tree are `tests/db/foundation.test.ts:563-566` (`extname`, `extnamespace`) and `:631` (`SELECT extname FROM pg_extension`). Neither selects `extowner`; `grep -rn "extowner"` over the repository returns zero hits.

### PROP-4 — database-level grants (CONNECT, CREATE, TEMP on the database)

**MISSING.**

Reason: CI creates a database whose only principal is a superuser, so `datacl` is the image default and carries no information. In a provider database the default `CONNECT` grant to `PUBLIC`, and any provider-added database grant, decide which of the provider's own roles can reach the schema at all — and no gate asks.

_Evidence:_ `has_database_privilege` appears nowhere in the repository (grep over `--include=*.mjs --include=*.ts --include=*.js --include=*.sql`). The one database-level statement any migration makes is `0001_extensions.sql:58-68`, `ALTER DATABASE %I SET search_path TO "$user", public, extensions` — a setting, not a grant.

### PROP-5 — schema ownership

**MISSING.**

Reason: in CI the owner is always `postgres`-as-superuser because the runner is the only writer (`scripts/db/apply-migrations.mjs:76-99`). On the Supabase stack `postgres` is not a superuser but carries `BYPASSRLS` (`docs/database/role-and-grant-standard.md:186`), so "who owns the schema" becomes a live authorization question — and the shipped assertion answers only "not one of our three runtime roles", which is true in both environments for reasons that have nothing to do with the provider.

_Evidence:_ The only ownership query is negative and role-restricted: `tests/db/foundation.test.ts:588-594`, `SELECT nspname FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner WHERE r.rolname IN ('app_runtime','app_readonly','app_worker')`, expected empty; the sibling table check is `:595-599`. No query asserts who DOES own each of the 17 module schemas.

### PROP-6 — role memberships (the `pg_auth_members` graph)

**MISSING.**

Reason: the CI cluster contains only the three archetypes plus the harness login roles the harness itself creates and grants (`tests/db/helpers.ts:116-118`). The provider membership graph — notably `authenticator` being able to `SET ROLE` into `anon` / `authenticated` / `service_role` (`docs/database/role-and-grant-standard.md:191`) — has no representation in CI, so no gate can detect a membership that grants an unintended reach.

_Evidence:_ `grep -rn "pg_auth_members"` over the repository: zero hits. CORRECTED: `pg_has_role` returns exactly **one** code hit, not zero — `20260727090000_iam_grant_delegation_scope_backstop.sql:114`, `IF NOT pg_has_role(current_user, 'app_runtime', 'MEMBER')`, a guard clause inside the delegation backstop. That is a shipped **runtime** membership check, not a gate: no test or CI script asserts anything about it. The conclusion survives — the provider membership graph is observed by no gate — but the evidence as originally stated was false. Every role query in the tree filters to the three archetypes — `tests/db/foundation.test.ts:573-576`, `p1-13-runtime-capabilities.test.ts:131`, `p1-15-shared-services-runtime-capabilities.test.ts:427`, `crm-structural-contract.test.ts:126`, `org-security.test.ts:174`, and `scripts/ci/rls-matrix.mjs:298-303` (`WHERE rolname = ANY($1)` over `RUNTIME_ROLES`).

### PROP-7 — default privileges (`ALTER DEFAULT PRIVILEGES`)

**MISSING.**

Reason: a default-privilege entry only has an effect when some role creates an object later; CI applies 124 migrations as one superuser and then stops, so a wrong default ACL would produce no observable difference. This is the archetype of a property that is silent in CI and load-bearing in production — a provider default privilege granting `SELECT` to `anon` on future `public` objects would never make a single gate go red.

_Evidence:_ `pg_default_acl` appears nowhere in the repository. The only mention of the mechanism in SQL is a prohibition in a comment: `supabase/migrations/0002_base_schemas.sql:82` — "* no ALTER DEFAULT PRIVILEGES blanket grants;". `supabase/config.toml:17-23` documents the provider-side analogue for the Data API roles (`auto_expose_new_tables`, "Controls whether new tables, views, sequences and functions created in the `public` schema by `postgres` are reachable through the Data API roles (`anon`, `authenticated`, `service_role`) without explicit GRANTs") and leaves it commented out.

### PROP-8 — network-capable extensions (`pg_net` and its `net` schema)

**MISSING.**

Reason: the extension, its schema, its functions, its queue tables and every ACL on them are created by the provider image and simply do not exist in `postgres:17-alpine`, so all three of the gates that would otherwise notice (extension inventory, RLS matrix, structural totals) skip it by construction. Recorded here purely as a classification: a network-capable extension is the class of property that is invisible to a bare image AND consequential in a hosted one. This item makes no assessment of B1-PGNET-BLOCKER and does not treat it as closed.

_Evidence:_ `pg_net` is on the environment allow-list at `tests/db/foundation.test.ts:279` and is therefore excluded from the "no unregistered extension" gate at `:631-639`. Its schema is exempted from the RLS matrix at `scripts/ci/rls-matrix.mjs:63`: `net: 'Supabase-managed, absent from a bare postgres container.'`. It has ZERO entries in the register that is supposed to hold exactly this: `grep -c "pg_net" docs/database/postgresql-extension-register.md` returns `0`. The frozen P1-29 set names the concrete instance as external: `p1-29-prep/docs/phase-1/phase-1-29/blocker-register.md:245` — "`B1-PGNET-BLOCKER` — An external, provider-owned `net` schema ACL on the PRE-P1-29 B1 branch."

### PROP-9 — provider-managed triggers and functions

**MISSING.**

Reason: doubly invisible — the objects are absent from CI, and the queries are scoped so they would be skipped even if present. The one gate that is NOT schema-scoped is `migration-replay-checks.mjs:207-224`, and that is exactly why it cannot be run against a Supabase database at all (see PROP-9's companion, GATE-3).

_Evidence:_ Every inventory is scoped to the 17 module schemas: `tests/db/foundation.test.ts:641-648` (routines, `WHERE n.nspname IN ('apt','org','iam',…)`), `:651-658` (triggers, same list plus `NOT t.tgisinternal`). The RLS matrix's SECURITY DEFINER sweep is likewise `WHERE … n.nspname = ANY($1)` over the level's schema list (`scripts/ci/rls-matrix.mjs:277-283`). Provider schemas are pre-exempted at `rls-matrix.mjs:56-77` (`graphql`, `realtime`, `storage`, `vault`, `auth`, `net`, `pgbouncer`, `cron`, `supabase_functions`, `_realtime`), each with the reason "Supabase-managed, absent from a bare postgres container."

### PROP-10 — provider-managed roles (`supabase_admin`, `authenticator`, `anon`, `authenticated`, `service_role`)

**MISSING.**

Reason: the roles are not in the cluster, so `pg_roles` cannot be queried for them and any policy naming `TO authenticated` would fail to apply — which is itself why no migration writes one. `docs/database/role-and-grant-standard.md:169-174`: "Supabase-managed roles … are **not modified** by any RootLco migration." The measurement is a snapshot of one CLI version taken thirteen months of CLI releases ago; nothing re-checks it.

_Evidence:_ `docs/database/migration-standard.md:365-373` states both sides: local Supabase — "`postgres` is **not** a superuser but holds `BYPASSRLS`, `CREATEROLE`, and `CREATEDB`; `supabase_admin` is the superuser; `service_role` carries `BYPASSRLS`… `anon`/`authenticated` have no bypass"; plain CI — "`postgres` **is** a superuser, and the Supabase-managed roles do not exist at all." The measured attribute table is `docs/database/role-and-grant-standard.md:184-191`, explicitly labelled "Inspected in `pg_roles` on the local Supabase stack (CLI 2.109.1, PostgreSQL 17.6) on 2026-07-16" and, at `:543`, "§4's table is a local-stack measurement only."

### GATE-1 — `scripts/ci/rls-matrix.mjs` (role × table × action matrix)

**EXISTS AND LOAD-BEARING.**

CLASSIFICATION: LOCAL-SUPABASE-PROVABLE in the sense that it needs a running, fully migrated database — but as wired it runs ONLY against bare Postgres. Reason it cannot be a repository-static gate: it is catalog-derived by design (`:16-19`, "it cannot be satisfied by a passing test, only by the database actually being configured that way"). Three structural ties to the bare image: (a) `RUNTIME_ROLES` is a hard-coded three at `:81-85`, so a fourth role is checked by nothing; (b) `NON_APPLICATION_SCHEMAS` at `:53-77` pre-excuses eleven provider schemas as "absent from a bare postgres container", and `reconcileSchemas` (`:111-153`) raises a phantom failure only for `CRITICAL_SCHEMAS`+`ADDITIONAL_SCHEMAS`, never for that list — so those schemas being absent is silently fine and their being present would also be silently fine; (c) `if (!granted) { verdict = 'denied-by-grant' }` at `:236-237` returns before any policy check, so the matrix detects over-granting and is blind to under-granting.

_Evidence:_ Invoked at `_reusable-database-assurance.yml:322-333`, `node scripts/ci/rls-matrix.mjs --level "${RLS_LEVEL}"`, only when `inputs.task == 'security-matrix'`, against the bare `postgres:17-alpine` service at `:75`. PR level `critical` (`pr-ci.yml:305`), nightly level `full` (`nightly-assurance.yml:56`).

### GATE-2 — the `db` test tier (`npm run test:db`, 147 files under `tests/db/`)

**EXISTS AND LOAD-BEARING.**

CLASSIFICATION: LOCAL-SUPABASE-PROVABLE (needs a live migrated database), and it is the only tier that runs in BOTH environments — but every assertion in it is scoped so that both give the same answer. Extension coverage tolerates the eight provider extensions (`foundation.test.ts:277-287`); routine/trigger/policy inventories are limited to the 17 module schemas (`:641-658`); role assertions are limited to the three archetypes (`:573-576`). That scoping is what makes it environment-portable, and it is exactly the reason it cannot see PROP-1..PROP-10.

_Evidence:_ `package.json:69` `"test:db": "vitest run --config vitest.config.db.ts"`; `vitest.config.db.ts:3-8` — "Requires a running PostgreSQL with migrations applied: local: `npm run supabase:start && npm run supabase:reset`; CI: the postgres service container + scripts/db/apply-migrations.mjs". Run in CI at `_reusable-database-assurance.yml:295-298` and `ci.yml:389`. `ls tests/db | wc -l` = 147.

### GATE-3 — `scripts/ci/migration-replay-checks.mjs --phase post` (structural totals, `security_definer === 0`)

**EXISTS AND LOAD-BEARING.**

CLASSIFICATION: this gate is provable in CI's bare-Postgres environment ONLY — it is not merely calibrated there, it is unrunnable elsewhere. The baseline says so with measurements: `schema-baseline.json:24` — "these totals cannot be reproduced locally: they count every non-system schema, and a developer's Supabase stack carries auth/storage/realtime objects the CI plain-postgres container does not. **Measured on the local stack the same queries return tables 292, functions 591, triggers 548 and security_definer 6** — none of which is comparable with the figures above." Two edits, both required — fixing only the first leaves the register asserting the same unobserved claim eight paragraphs later.

CORRECTED, and the correction matters because the original overreached. The flagship SECURITY
assertion of the replay job — zero SECURITY DEFINER functions — is arithmetically false **on the
local Supabase stack**, where the same queries return 6, and green on every CI run, and the
difference is provider code rather than ours. **It is NOT established for a hosted project.**
Nothing in this repository measures one, and ENV-6 of this same register proves no such
environment is reachable from here. The load-bearing derivation survives — 6 against 0 over the
same population implies provider-created functions — but the population measured was local, and
writing "every Supabase database" would be precisely the unprovable hosted claim this register
exists to forbid.

### GATE-4 — `scripts/db/schema-inventory.mjs --hash-only` (frozen schema hash)

**EXISTS AND LOAD-BEARING.**

CLASSIFICATION: LOCAL-SUPABASE-PROVABLE — and it is the ONE database figure in the repository that is reproducible in both environments, precisely because it is schema-scoped. The contrast with GATE-3 is the cleanest statement of this lane's thesis: scope the query to your own schemas and you get a portable claim; scope it to the whole cluster and you get a claim that only one image can satisfy. Known limit, stated in the same file: the hash covers function IDENTITY, not BODY (`schema-baseline.json:9`), so a guard whose rule changed is invisible to it.

_Evidence:_ `_reusable-database-assurance.yml:257-283`, compared against `schema-baseline.json:13` `"schemaHash": "9f536a46…"`. The note at `:13` states the scope: "over the 17 RootLco business schemas only — which is why it reproduces on a developer's Supabase stack even though the structural totals below do not."

### GATE-5 — `npm run validate:seed-state` (seed idempotency, business-state cleanliness)

**EXISTS AND LOAD-BEARING.**

CLASSIFICATION: LOCAL-SUPABASE-PROVABLE (needs the migrated database). Environment-portable: it touches only RootLco seeds and RootLco tables. No parity exposure.

_Evidence:_ `package.json:126` → `scripts/db/validate-seed-state.mjs`; run at `_reusable-database-assurance.yml:199-202` ("Apply declared seeds twice and prove idempotency") and `ci.yml:341`. It parses `supabase/config.toml` for the `[db.seed]` block (`validate-seed-state.mjs:100`).

### GATE-6 — `scripts/db/structural-review.mjs`

**EXISTS AND LOAD-BEARING.**

CLASSIFICATION: LOCAL-SUPABASE-PROVABLE. Runs only in the migration-replay task, i.e. only against bare Postgres as wired.

_Evidence:_ `package.json:127`; run at `_reusable-database-assurance.yml:240-244` under `if: inputs.task == 'migration-replay'`.

### GATE-7 — `npm run validate:authorization-coverage`

**EXISTS AND LOAD-BEARING.**

CLASSIFICATION: REPOSITORY-PROVABLE — pure static analysis of tracked files, no database, no network. Its blind spot is not environmental: it proves an operation DECLARES permission codes and cannot prove those codes EXIST in `iam.permissions`. The frozen P1-29 set records that absence as `INS-11` and proposes `BE-5` to close it (`p1-29-prep/docs/phase-1/phase-1-29/blocker-register.md:213`, `security-threat-model.md:89`, `test-and-acceptance-plan.md:46`).

_Evidence:_ `package.json:82` → `scripts/check-authorization-coverage.mjs`; run at `ci.yml:126` and inside `gate:p1-13` (`package.json:44`). Its own header (`:1-24`): reconciles "every `route.ts` under `apps/api/src/app/api/v1/**`" against "every `defineOperation({...})` literal in the source tree"; "The parse is deliberately literal-only".

### GATE-8 — the no-fake-data gate, in two halves

**EXISTS AND LOAD-BEARING.**

CLASSIFICATION: the static half is REPOSITORY-PROVABLE (tracked-file scan, dependency-free); the database half is LOCAL-SUPABASE-PROVABLE (needs the replayed database). Both are environment-portable — they examine RootLco tables only. Recorded limit in the baseline itself (`schema-baseline.json:36`): the populated-table check "flags UNEXPECTED populated tables, not missing ones", so a seed that silently stops running still passes it.

_Evidence:_ Static half: `package.json:92` `validate:no-fake-data` → `scripts/check-no-fake-data.mjs`, in `security:all` (`package.json:52`) and at `ci.yml:491`. Its header (`:1-18`): "This static guard scans tracked files… The companion DB check (tests/db/no-fake-data.test.ts) proves the migration layer creates zero business rows." Database half: `tests/db/no-fake-data.test.ts:66-89` discovers every org/iam/shared/crm/veh base table and asserts zero rows, plus the dual-scope catalogue cases at `:92-119`. Reinforced by `migration-replay-checks.mjs:270-290` against `schema-baseline.json` `seededStructuralTables`.

### GATE-9 — `npm run security:tracked-secrets`

**EXISTS AND LOAD-BEARING.**

CLASSIFICATION: REPOSITORY-PROVABLE. No environment dependency of any kind. Note the deliberate consequence for this lane: it can prove a service-role key is not IN THE REPOSITORY; it cannot prove one is not configured in a provider project, because there is no provider project (ENV-6) and it would have no way to look if there were.

_Evidence:_ `package.json:53` → `scripts/check-tracked-secrets.mjs`; `ci.yml:465`; also `_reusable-secret-scan.yml`. Header `:1-24`: "THE single source of truth… scans every tracked text file for real credential SHAPES… Dependency-free (node: builtins only)".

### GATE-10 — `npm run security:browser-secrets`

**EXISTS AND LOAD-BEARING.**

CLASSIFICATION: REPOSITORY-PROVABLE. This is the one gate whose subject is a provider role (`service_role`), and it reaches that role only through a NAME in a tracked file — never through the database. It therefore cannot observe that `service_role` actually carries `BYPASSRLS`; that fact lives only in the prose table at `docs/database/role-and-grant-standard.md:188`.

_Evidence:_ `package.json:54` → `scripts/check-browser-exposed-secrets.mjs`; `ci.yml:483`. Header `:5-13`: fails if any tracked file names a Supabase service-role key with the `NEXT_PUBLIC_` prefix, because "Next.js inlines every NEXT_PUBLIC_-prefixed variable into the browser bundle. The service-role key bypasses Row-Level Security entirely."

### GATE-11 — `npm run security:scope-exclusions`

**EXISTS AND LOAD-BEARING.**

CLASSIFICATION: REPOSITORY-PROVABLE. Static tracked-file scan; no environment coupling.

_Evidence:_ `package.json:55` → `scripts/check-scope-exclusions.mjs`; `ci.yml:451`. Header `:1-21`: two rules over every tracked file, with EXACT-path allow-lists, "Fails closed: an unreadable tracked file fails the run."

### GATE-12 — CodeQL (`_reusable-code-security.yml`)

**EXISTS AND LOAD-BEARING.**

CLASSIFICATION: REPOSITORY-PROVABLE — static analysis of tracked source (TypeScript/JavaScript and workflow YAML). It has NO SQL/PostgreSQL language pack configured, so no policy, grant, ACL or migration in `supabase/migrations/**` is analysed by it at all. Recorded caveat already in the project's memory of this tool and reflected in `docs`: a CodeQL run on a pull request is diff-informed, so it cannot establish a repository ceiling.

_Evidence:_ `_reusable-code-security.yml:41-44` matrix `language: [javascript-typescript, actions]`; `:66-72` `codeql-action/init` with `queries: security-and-quality`; `:75-77` `analyze`; `:96-101` `scripts/ci/codeql-policy.mjs` against `.github/ci-baselines/codeql-baseline.json`. Job is conditional: `pr-ci.yml:318-320`, `if: needs.change-detection.outputs.run-code-security == 'true'`.

### GATE-13 — `npm audit` + `scripts/ci/dependency-policy.mjs`

**EXISTS AND LOAD-BEARING.**

CLASSIFICATION: REPOSITORY-PROVABLE (over the lockfile and licence inventory), with one honest qualification: `npm audit` resolves advisories from the npm registry, so the gate reads tracked files but needs the network. It cannot see anything about a database or a provider. Explicitly out of its reach: a vulnerable PROVIDER-managed extension (PROP-1/PROP-8) is not an npm dependency and appears in no lockfile.

_Evidence:_ `_reusable-dependency-security.yml:68-69` (`npm audit --omit=dev --json`, `npm audit --json`), `:95-96` (same for the `@rootlco/web` workspace), `:129` `licence-inventory.mjs`, `:161-166` `dependency-policy.mjs --json dependency-policy.json`. `:309` records that GitHub dependency review may not run because "the Dependency graph is not enabled on this repository" (tracked as `P1-21-A-01`), with the offline deny-list still enforced.

### GATE-14 — `scripts/ci/check-workflow-security.mjs`

**EXISTS AND LOAD-BEARING.**

CLASSIFICATION: REPOSITORY-PROVABLE. Relevant to this lane for what it does NOT cover: the rule set governs `uses:` pins and never `services.*.image`, which is why the database image can float untagged by digest (ENV-7) while every action is pinned to 40 hex.

_Evidence:_ Run at `_reusable-node-quality.yml:202`, `_reusable-secret-scan.yml:115`, `_reusable-clean-room.yml:261`. Rules `WFS-001`..`WFS-008` at `check-workflow-security.mjs:9-18`: SHA-pinned `uses:`, version comment, top-level `permissions:`, read-only permissions, no `pull_request_target`, no interpolation of `github.event.*` into `run:`, `set -euo pipefail`, no `|| true`.

### GATE-15 — frontend authorization gates (`validate:p1-28-access`, `validate:p1-2x-*-reachability`, `validate:use-server-exports`)

**EXISTS AND LOAD-BEARING.**

CLASSIFICATION: REPOSITORY-PROVABLE — AST/static analysis of `apps/web` and `apps/api` sources. They enforce P-4 (frontend visibility is not authorization) at the source level and have no database or environment coupling. Operational caution recorded in project memory and visible in the gate headers: `verify:policies` reads COMMITTED state, so running it pre-commit proves nothing.

_Evidence:_ `package.json:112-119` and `:147`, all chained into `verify:policies` (`package.json:142`). `scripts/ci/check-p1-28-access.mjs:3-20` — "does the screen require exactly the permission its operations require, and no more", and "`WRITE_PERMISSIONS` once had exactly one reference — its own declaration — while ten P1-27 write forms rendered for any reader". `scripts/ci/check-use-server-exports.mjs:1-14`.

### GATE-16 — `authenticated-browser` end-to-end tier

**EXISTS AND LOAD-BEARING.**

CLASSIFICATION: LOCAL-SUPABASE-PROVABLE, and it is the only gate in the repository that actually exercises one. CORRECTED: it proves behaviour through the real **Auth (GoTrue)** surface only. **It does not exercise PostgREST at all.** The workflow’s liveness probe is `/auth/v1/health`; `apps/api/src/lib/supabase/server.ts` and `client.ts` have **zero importers** repository-wide; the only application consumer of `@supabase/supabase-js` is the IAM provider and every one of its calls is `auth.*`; and every read and write goes through the API’s own `pg` pool. No `.from(`, `.rpc(` or `/rest/v1` call exists in `apps/**` or `scripts/**`. It does not inspect the catalog: no ACL, no owner, no role attribute, no extension inventory is read anywhere in that workflow. So the presence of a Supabase stack in CI must not be read as coverage of PROP-1..PROP-10.

_Evidence:_ `pr-ci.yml:260-277`; the workflow stands the Supabase CLI stack (`_reusable-authenticated-browser.yml:179-193`), builds production API and web (`:300-301`), and runs `npm run test:web-e2e-authenticated` (`:422`). `pr-ci.yml:239-258` records that this is "the repository's ONLY end-to-end tenant-isolation proof and its ONLY route-level accessibility proof", and that a fork PR is excluded by the `if:` at `:264-266` as a security boundary.

### GATE-17 — `npm run validate:openapi`

**EXISTS AND LOAD-BEARING.**

CLASSIFICATION: REPOSITORY-PROVABLE. Included because `verify:policies` treats `openapi.v1.json` as executable and because the frozen P1-29 set records that the document "declares zero request bodies and zero typed success schemas" (`p1-29-prep/docs/phase-1/phase-1-29/execution-decision.md:140`) — a contract gap, not an environment gap.

_Evidence:_ `package.json:94` → `scripts/check-openapi.mjs`; `ci.yml:191`; in `verify:contracts` (`package.json:140`).

### GATE-18 — PROVIDER-OWNER-ONLY: the category exists and holds zero gates

**MISSING.**

Properties that would fall here if an environment existed: who may `ALTER EXTENSION`; who owns `supabase_admin`; project-level API key rotation; whether the Data API exposes a schema (`supabase/config.toml:12` `schemas = ["public", "graphql_public"]` is a LOCAL declaration and binds no provider); network restrictions and connection pooling posture. Every one is decided by provider-side authority that nobody in this repository holds, and none is asserted anywhere.

_Evidence:_ Nothing in `scripts/`, `tests/` or `.github/workflows/**` authenticates to, queries, or asserts anything about a provider control plane. `deploy-staging.yml:44-45` and `deploy-production.yml:49-50` grant only `contents: read`; `deploy-production.yml:17-19` — "NO STANDING CREDENTIAL… when this becomes executable it will use OIDC and short-lived credentials. No long-lived cloud secret is introduced by this initiative."

### RISK-1 — the RLS matrix can be GREEN while a provider PUBLIC ACL exposes a schema

**EXISTS AND LOAD-BEARING.**

CANNOT SEE: any privilege granted to `PUBLIC`, `anon`, `authenticated` or `service_role` on any object in `auth`, `storage`, `net`, `vault`, `cron`, `graphql`, `realtime`, `pgbouncer`, `supabase_functions`, `_realtime` or `extensions`. The matrix asks `has_table_privilege($role, …)` for exactly three named roles over application schemas only (`:81-85`, `:219-224`).

_Evidence:_ `scripts/ci/rls-matrix.mjs:53-77` pre-classifies eleven provider schemas as non-application with the reason "Supabase-managed, absent from a bare postgres container"; `reconcileSchemas` (`:111-153`) raises `unclassified` only for a schema in NO list and `phantom` only for a declared APPLICATION schema, so a provider schema being present raises nothing. No ACL column is ever read (PROP-2).

### RISK-2 — the RLS matrix is GREEN on an UNDER-grant and on any fourth role

**EXISTS AND LOAD-BEARING.**

CANNOT SEE: (a) a required privilege that was never granted — all five under-grants in that design review were of this shape; (b) any privilege held by a role not in the hard-coded three; (c) any FUNCTION privilege, in any environment. This is not an environment gap — it is a scope gap that is present in bare Postgres and would remain present against a Supabase image.

_Evidence:_ `scripts/ci/rls-matrix.mjs:236-237`, `if (!granted) { verdict = 'denied-by-grant' }`, returns before any policy evaluation. `RUNTIME_ROLES` at `:81-85` is three entries. `:87` `ACTIONS = ['SELECT','INSERT','UPDATE','DELETE']` — TABLE privileges only. The design set states the consequence independently: `docs/phase-1/pre-p1-29-multi-tenant-admin-rbac-workflow/wave-b-control-plane-design-v2.md:786-812` — "A fourth role is invisible to it… the gate detects **over**-granting and is structurally blind to **under**-granting", and "the function grants of §7.2 fall outside it entirely".

### RISK-3 — `security_definer === 0` is provable ONLY on bare Postgres, and is false on the local Supabase stack

**EXISTS AND LOAD-BEARING.**

CANNOT SEE / CANNOT RUN: the strongest privilege-escalation assertion the replay job makes is defined over a population (all non-system schemas) that only the bare image can satisfy. Against the local Supabase stack the gate does not report a finding — it reports a failure, so it cannot be pointed there at all. A SECURITY DEFINER function added by the provider, or added by us inside a provider schema, is outside its reach in both directions.

_Evidence:_ `scripts/ci/migration-replay-checks.mjs:221-224` hard-codes the failure. `.github/ci-baselines/schema-baseline.json:24`: "Measured on the local stack the same queries return tables 292, functions 591, triggers 548 and **security_definer 6**".

### RISK-4 — the extension inventory allow-lists eight provider extensions with no register entry

**EXISTS AND LOAD-BEARING.**

CANNOT SEE: whether any of the eight is actually installed, at what version, owned by whom, or with what ACLs. The gate is green in CI because they are absent and green on a Supabase stack because they are allow-listed — the same verdict for two opposite facts.

_Evidence:_ `tests/db/foundation.test.ts:277-287` allow-lists `plpgsql, pg_net, pg_stat_statements, supabase_vault, uuid-ossp, pg_graphql, pgjwt, pgsodium`; the gate at `:631-639` subtracts them unconditionally. `grep -c "pg_net" docs/database/postgresql-extension-register.md` = 0. The register's own procedure says the opposite should happen — `docs/database/postgresql-extension-register.md:215`: "If the extension does not exist in the plain container, the CI/Supabase divergence must be recorded here as an accepted gap **before** merge — silent divergence is prohibited."

### RISK-5 — a PR touching only `scripts/ci/**` SKIPS the RLS matrix entirely

**EXISTS AND LOAD-BEARING.**

CANNOT SEE: a change to `scripts/ci/rls-matrix.mjs` itself. Editing the matrix — narrowing `CRITICAL_SCHEMAS`, adding a `FORCE_RLS_EXEMPT` entry, downgrading `granted-no-policy` to advisory — classifies as `ciScripts`, so the only job that executes the matrix is skipped, and `ci-gate` accepts the skip as a recorded decision (`classify-changes.mjs:14-16`). The migration-replay job still runs, but it never invokes the matrix (`_reusable-database-assurance.yml:322` is under `if: inputs.task == 'security-matrix'`).

_Evidence:_ `scripts/ci/classify-changes.mjs:59` classifies `scripts/ci/**` as `ciScripts` BEFORE the generic `scripts` rule at `:60` (first match wins, `:30-32`); confirmed by `tests/ci/change-detection-and-coverage.test.ts:28`. `CONDITIONAL_JOBS['database-security']` at `:119-127` lists `database, appSource, backend, tests, dependencies, workflows, scripts` — and NOT `ciScripts`. `database-migration-replay` at `:118` DOES list `ciScripts`. The job is gated on that output at `pr-ci.yml:300`.

### RISK-6 — on a pull request the matrix covers 7 of 17 application schemas

**EXISTS AND LOAD-BEARING.**

CANNOT SEE on a PR: RLS enablement/forcing, grant-to-policy coherence and read-only-role violations for the ten `ADDITIONAL_SCHEMAS`, including `rec`, `shared` and `veh` — the schemas the last two phases changed most. A defect there is caught by the nightly run at the earliest, i.e. after merge.

_Evidence:_ `scripts/ci/rls-matrix.mjs:34` `CRITICAL_SCHEMAS = ['iam','org','inv','wo','crm','sal','quo']`; `:35-47` `ADDITIONAL_SCHEMAS = ['veh','apt','rec','tech','dia','qms','svc','wty','rpt','shared']`. `pr-ci.yml:305` `rls-level: critical`; `nightly-assurance.yml:56` `rls-level: full`.

### RISK-7 — no gate anywhere could observe a hosted environment being insecure

**MISSING.**

CANNOT SEE, stated plainly: a hosted database could grant `SELECT` to `anon` on a RootLco table, carry a default privilege exposing every future object, hold a provider role with `BYPASSRLS` that reaches a tenant table, or run a network-capable extension with a PUBLIC ACL — and every gate in this repository would still report green, because every one of them examines either a tracked file or a bare-Postgres catalog. This is the register's central conclusion, and it is a statement about coverage, not an allegation about any specific environment: no such environment exists to be insecure yet, which is exactly why the classification is worth fixing before one does.

_Evidence:_ Composite of ENV-6 (no provider environment), GATE-18 (no provider-side gate), PROP-2/4/7/10 (no ACL, database-grant, default-privilege or provider-role introspection anywhere in the tree), and `_reusable-authenticated-browser.yml` (the one Supabase-stack job reads no catalog).

---

## Unknowns — what could not be settled, and what would settle it

- The exact PostgreSQL patch level any given CI run measured. `postgres:17-alpine` is tag-pinned, not digest-pinned (ENV-7), and the only in-run record is `psql … -tAc 'SELECT version();'` printed to the log at `_reusable-database-assurance.yml:222`, which is not captured into any evidence artefact. WOULD SETTLE IT: pinning `image: postgres:17-alpine@sha256:…`, or writing `SELECT version()` into `migration-replay.json`.
- Which Supabase service images the pinned CLI range `^2.110.0` (`package.json:184`) actually pulls, and therefore which provider extensions and roles a developer's stack has TODAY. The measured tables at `docs/database/role-and-grant-standard.md:184-191` and `docs/database/postgresql-extension-register.md:34-35` are both dated 2026-07-16 against CLI 2.109.1. WOULD SETTLE IT: re-running `SELECT extname, extversion, extowner::regrole FROM pg_extension` and `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles` on a stack started by the currently resolved CLI, and recording the CLI version beside the result.
- Whether `pg_net` is in fact installed on the local stack the pinned CLI produces. `tests/db/foundation.test.ts:279` is an ALLOW-list entry, which proves only that its presence would be tolerated — not that it is present. WOULD SETTLE IT: `SELECT extname FROM pg_extension` on a freshly started local stack. (Asked only to know what the local environment contains; this lane makes no assessment of B1-PGNET-BLOCKER.)
- Whether a hosted Supabase project would present the same role set, the same schema set and the same default privileges as the CLI local stack. Every parity statement in the repository compares bare-Postgres CI against LOCAL Supabase; nothing compares local Supabase against a provider. WOULD SETTLE IT: a provider environment plus a read-only catalog snapshot — and neither exists (ENV-6).
- Whether the `database-security`/`ciScripts` asymmetry (RISK-5) is deliberate. `classify-changes.mjs:118` includes `ciScripts` for the replay job and `:119-127` omits it for the security job, with no comment either way, and `tests/ci/change-detection-and-coverage.test.ts` asserts the path classification but not the job-trigger mapping. WOULD SETTLE IT: the pull request that introduced the two lists, or a test that pins the trigger set for `database-security`.
- Whether the schema-scoped design of the portable gates (GATE-2, GATE-4) is an explicit parity STRATEGY or an accident that happens to work. `schema-baseline.json:13` and `:24` describe the effect precisely but frame it as a property of two particular figures, not as a rule. WOULD SETTLE IT: an ADR or a line in `docs/database/migration-standard.md` §15 stating that a portable database assertion must be scoped to the 17 RootLco schemas, and that a cluster-wide assertion is CI-only by construction.

---

## Ambiguities recorded from this lane

Recorded, not resolved. The full set is in [ambiguity-register.md](ambiguity-register.md).

- `.github/ci-baselines/schema-baseline.json:39` (`securityDefinerPolicyNote`) states as an OPEN DECISION that migration `20260815090000` "adds TWO" SECURITY DEFINER functions (`shared.begin_document_scan`, `shared.complete_document_scan`) and that somebody must choose whether to raise the approved count to 2. The shipped migration contradicts it: `supabase/migrations/20260815090000_shared_reception_evidence_foundation.sql:198` and `:225` both declare `SECURITY INVOKER`, and `:108-115` explains that a first draft made them DEFINER and was changed. `schema-baseline.json:23` (`structuralTotalsDelt
- `docs/phase-1/pre-p1-29-multi-tenant-admin-rbac-workflow/wave-b-control-plane-refutation-register.md:179` says "A pull-request run does not see the business schemas at all." As written that is broader than the code: `scripts/ci/rls-matrix.mjs:34` puts `crm`, `inv`, `wo`, `sal` and `quo` in `CRITICAL_SCHEMAS`, which IS the PR level. The defensible reading is the ten `ADDITIONAL_SCHEMAS` (RISK-6). Recorded rather than reconciled, because the sentence is load-bearing in a refutation entry marked CONFIRMED.
- `tests/db/shared-hardening.test.ts:246-248` reads "USAGE on `extensions` would also expose extensions.pg_stat_statements, which pgcrypto grants to PUBLIC." The attribution is odd — `pg_stat_statements` is its own extension and its PUBLIC grants are not made by `pgcrypto`. The rule the test enforces (no application role holds USAGE on `extensions`) is unaffected; the stated reason may be wrong. Unverifiable in CI, where `pg_stat_statements` does not exist.
- "Hosted" is overloaded across this repository and must be disambiguated in anything built on this register. `hosted-clean-room` (`pr-ci.yml:225`), "hosted CI" and "GitHub-hosted ubuntu-latest" (`schema-baseline.json:5`) all mean a GitHub-hosted RUNNER — which runs bare Postgres. "Hosted Supabase" would mean the provider, which does not exist here. A gate labelled "hosted" proves nothing about a provider environment.
- `docs/database/migration-standard.md:255-259` and `docs/database/role-and-grant-standard.md:520-524` and `docs/database/postgresql-extension-register.md:224` all describe the database tier as "the 68-test database suite". `ls tests/db | wc -l` returns 147 files today. The parity statements those paragraphs make are still accurate; the figure beside them is stale.
