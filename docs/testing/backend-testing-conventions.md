# Backend Testing Conventions

**Company:** RootLco — Root Link Company · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Status:** Binding engineering standard (Phase 1-13) · **Date:** 2026-07-21 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (owner-authorized technical self-review under the
[Solo Developer Review Policy](../governance/solo-developer-review-policy.md)) ·
**Task IDs:** P1-13-BE-022, P1-13-DOC-003 ·
**Related:** [Database test fixtures](./database-test-fixtures.md) ·
[Backend architecture](../standards/backend-architecture-and-shared-foundation.md) ·
[Security testing standard](../security/security-testing-standard.md)

---

## 1. Three tiers, three runners, one reason

| Tier                | Command                | Config                     | Needs a database? | What belongs here                                                                                                                                               |
| ------------------- | ---------------------- | -------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit                | `npm test`             | `vitest.config.ts`         | **No**            | Pure logic: error catalog, correlation, redaction, validation, pagination, cursors, cache keys, rate-limit keys, backoff, envelope building, registry rules     |
| Backend integration | `npm run test:backend` | `vitest.config.backend.ts` | Yes               | Anything that touches a scoped session: context resolution, RLS, authorization, the transaction wrapper, idempotency, the outbox worker, the reference endpoint |
| Database            | `npm run test:db`      | `vitest.config.db.ts`      | Yes               | Schema-level guarantees: constraints, policies, triggers, per-domain concurrency and rollback (Phases 1-2 … 1-12)                                               |

The split exists so `npm test` stays runnable with **no database at all**. That is what makes the
unit tier usable during ordinary development instead of something people skip. A test that needs a
database belongs in one of the other two tiers, never in the unit tier with a mocked driver: a
mocked `pg` proves the mock works, not that the SQL does.

## 2. Never assert isolation on a privileged connection

The single most important convention, inherited from
[`tests/db/helpers.ts`](../../tests/db/helpers.ts) and unchanged here:

- the **admin** connection (`postgres`) provisions fixtures and cleans up. It carries `BYPASSRLS`
  locally and is a superuser in CI, so **nothing executed on it is evidence that RLS works**;
- every isolation, authorization, and scope assertion runs on a **least-privilege login role**
  that is a member of `app_runtime` / `app_readonly` / `app_worker` and holds no attribute beyond
  `LOGIN`.

Owner behaviour must never be allowed to make a test pass.

## 3. Fixtures

- Deterministic UUIDs from `tests/db/helpers.ts` (`TENANT_A`, `TENANT_B`, `USER_A`, `COMPANY_A1`,
  `BRANCH_A1`). Two tenants exist so every read can be shown to be _scoped_, not merely _working_.
- Platform-scope fixtures use the `fx_` code prefix; global test permissions use `test.`. Cleanup
  keys off those prefixes, so a fixture can never be mistaken for structural reference data.
- Ephemeral only. `deleteTenantCascade` / `cleanFixtures` remove everything a suite created. After
  a clean migration the business tables are empty, and the
  [no-fake-data policy](../database/no-fake-data-standard.md) applies to tests exactly as it
  applies to seeds: **no fabricated business records survive a run.**
- Prefer `withRolledBackTx` over `withCommittedTx`. Rolling back keeps fixtures pristine _and_
  simultaneously demonstrates that the session context is transaction-local.

## 4. Test-only roles that rehearse a change request

`tests/backend/helpers.ts` creates a login role carrying the privilege set proposed by
[`DBCR-P1-13-001`](../database/change-requests/DBCR-P1-13-001-backend-runtime-write-grants.md), so
the transaction wrapper, idempotency service, and event publisher can be executed and proven
before the grant exists in the schema.

Three rules keep that honest:

1. the role and its policies are created and dropped **by the harness at runtime** — no migration
   file is added, edited, or removed;
2. the suite **also asserts the gap** against the real `app_runtime` archetype, so the change
   request's evidence comes from the same run;
3. results are reported as what they are: application behaviour verified against the _proposed_
   privilege set. It is never presented as evidence that the deployed schema permits the write.

## 5. What a backend test must prove

Foundation behaviour is only interesting at its edges. Every foundation suite covers the negative
case first:

- a repository call **without** context fails before touching the database;
- a request carrying a spoofed tenant, company, or branch is denied — not silently widened;
- a denied request leaves **zero** rows and zero side effects;
- a transaction that fails after its outbox write leaves nothing behind in any of the four tables;
- a replayed idempotency key does not re-execute; a mutated one is rejected;
- two workers never own the same claim; a redelivered event applies its effect once.

## 6. Determinism

- **Clocks are injected.** Rate-limit windows, cache TTLs, and backoff take a clock or random
  function so behaviour is asserted, not sampled. A test that sleeps to observe an expiry is a
  test that fails on a slow CI runner.
- **Concurrency is exercised inside the test**, not by the runner. `fileParallelism` is `false` in
  both database-backed configs so one suite's cleanup cannot race another's provisioning; races
  that matter are created deliberately with parallel connections.
- **No snapshot of a generated document as text.** The OpenAPI contract test compares _parsed
  JSON_, because whitespace belongs to Prettier and the contract belongs to the code.

## 7. Coverage

Coverage is reported for the pure-logic modules the unit tier actually exercises
(`vitest.config.ts`). Coverage from the two database-backed runners is **not merged** into that
number: merging runs would produce a single figure that overstates both, and a coverage figure
that cannot be trusted is worse than none. A threshold will be set when there is a body of
business code to measure — not against a foundation whose value is in its negative paths.

## 8. What CI runs, and what it blocks

The `Lint, types, tests, build` job blocks on lint, **module-boundary and layering violations**,
**authorization-coverage failures**, **OpenAPI validity**, type errors, formatting, unit tests,
and the production build. The `Database migrations and RLS tests` job additionally applies all
migrations to a clean database, validates seeds, runs the classification guards, the database
suite, and the **backend foundation suite**. The `Secret and sensitive-file scan` job covers the
whole tracked tree, backend packages included.

A merge is blocked by any of them. That is the point: the conventions in this document are only
worth writing down because a build fails when they are broken.
