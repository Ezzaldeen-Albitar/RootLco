# Database Test-Fixture Standard

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Controlled · **Task:** P1-02-DB-020 · **Date:** 2026-07-16 ·
**Owner:** Eng. Ezzaldeen Al-Bitar ·
**Reference implementation:** [`tests/db/helpers.ts`](../../tests/db/helpers.ts) and the
five suites under `tests/db/` (62 tests passing on 2026-07-16 via `npm run test:db`)

---

## 1. Disposable databases only

Database tests run **only** against throwaway databases:

| Environment | Database                                              | Reset mechanism                                                        |
| ----------- | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| Local       | Supabase local stack (PostgreSQL 17.6, port 54322)    | `npm run supabase:reset` — clean recreate, all migrations, seed        |
| CI          | `postgres:17-alpine` service container, fresh per run | `scripts/db/apply-migrations.mjs` — **refuses** any non-empty database |

A shared, long-lived, or production database is never a test target. **No production
data and no production secrets, ever.** Harness credentials are the public Supabase
local-dev defaults, overridable via `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` /
`DB_PASSWORD`; connection settings are built as config objects — never URL-form strings —
so credential-pattern scanners have nothing to match and nothing real exists to leak.

## 2. Deterministic fixture identity

Fixture UUIDs are constants, not `gen_random_uuid()`, so failures reproduce exactly:

| Constant     | Value                                  | Meaning                   |
| ------------ | -------------------------------------- | ------------------------- |
| `TENANT_A`   | `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa` | Generic tenant A          |
| `TENANT_B`   | `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb` | Generic tenant B          |
| `USER_A`     | `a0000000-0000-4000-8000-000000000001` | Actor in tenant A         |
| `USER_B`     | `b0000000-0000-4000-8000-000000000001` | Actor in tenant B         |
| `COMPANY_A1` | `a1000000-0000-4000-8000-000000000001` | Company scope in tenant A |
| `BRANCH_A1`  | `a1100000-0000-4000-8000-000000000001` | Branch scope in tenant A  |

**Generic tenants only.** Isolation is always proven between `tenant_a` and `tenant_b`.
**Benzene Vehicle Services is never a test fixture** — no Benzene identifier, name, or
operational data may appear in fixtures, factories, or seeds (ADR-009: Benzene is a
configured customer, not a platform constant).

## 3. The two-connection discipline (non-negotiable)

| Connection                       | Purpose                                 | Evidentiary value                                                                                      |
| -------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Admin (`postgres`)               | Provision fixtures, clean up            | **None for RLS.** In the local stack `postgres` carries BYPASSRLS (measured); in CI it is a superuser. |
| Runtime (`rootlco_test_runtime`) | Every isolation and privilege assertion | This login's only power is membership in `app_runtime` — its results are the evidence.                 |

Supporting logins `rootlco_test_readonly` (member of `app_readonly`) and
`rootlco_test_owner` (plain owner for the FORCE-RLS demonstration) follow the same rule:
created idempotently by the harness (`ensureTestLogins`), **never by a migration**, with
a deliberately fake local-only password. A test that asserts isolation from an admin
connection is a defective test and must be rejected in review.

## 4. Isolated scopes and cleanup

- **Fixture schema:** disposable objects (constraint templates, pattern fixtures,
  FORCE-RLS demo) live in `p1_02_test`, created by the suite that needs it and dropped
  with `DROP SCHEMA … CASCADE` in cleanup. Platform schemas never receive test objects.
- **Fixture rows in platform tables:** rows inserted into `shared.number_sequences` use
  the fixture tenants and are deleted by tenant id in `afterAll` (`cleanFixtures`).
- **Idempotent setup, best-effort teardown:** every suite's setup begins from
  `cleanFixtures` so a crashed previous run never poisons the next; suites are
  re-runnable back-to-back (`fileParallelism: false` keeps suites sequential so cleanup
  cannot race provisioning).

## 5. Transaction-rollback technique

`withRolledBackTx(pool, ctx, fn)` wraps an assertion in
`BEGIN → set_config(..., true) context → fn → ROLLBACK`. This both leaves zero state
behind and **is itself evidence** that the session-context contract is transaction-local
(the RLS suite asserts context evaporates at ROLLBACK). Durable fixtures use
`withCommittedTx` and are cleaned in `afterAll`.

## 6. Migration-reset behaviour

- Locally, `supabase db reset` recreates the database, applies every migration in
  filename order, and runs `supabase/seed.sql` (which contains no rows by design).
- In CI, the runner applies migrations to the fresh service container and **fails** if
  any module schema already exists — a test can never silently run against leftovers.
- The foundation suite verifies the migration files themselves (naming rule, ordered
  unique versions, declared rollback classification) and that the applied database
  contains **only** the Phase 1-2 allow-list (`shared.number_sequences`) — the
  business-table scope guard.

## 7. Fixture ownership

Each suite owns the fixtures it creates: it provisions them, asserts against them, and
cleans them. `tests/db/helpers.ts` is the only shared surface (connections, context,
constants, cleanup). A later phase adding tables extends the harness by:

1. adding deterministic constants here and in `helpers.ts`;
2. provisioning through the admin pool, asserting through the runtime login;
3. registering any new fixture location in `cleanFixtures`;
4. keeping every new tenant-owned table inside the foundation suite's allow-list
   update — consciously, in the same pull request as the migration.

## 8. Prohibitions (restated from the phase rules)

- No production data; no personal data; no real vehicle identifiers.
- No production or hosted-environment credentials — local/CI throwaways only.
- No Benzene operational data and no Benzene security fixtures.
- No Zoom objects of any kind.
- No test object outside `p1_02_test` (or a successor `*_test` schema registered here).
- No RLS evidence from BYPASSRLS/superuser connections.
