# Security Testing Standard

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Adopted by owner instruction (2026-07-17); merges with the Phase 1-2 pull request — the Phase 1-2 exit gate is not decided ·
**Owner:** Eng. Ezzaldeen Al-Bitar ·
**Review:** [Solo Developer Review Policy](../governance/solo-developer-review-policy.md)

---

## 1. The test-evidence rule

> **A requirement must never be marked `Verified` without test evidence.**

This document defines what counts as test evidence:

1. a **test ID** in the convention `<test file path> :: "<test name>"`
   (example: `tests/db/rls.test.ts :: "Tenant A sees only Tenant A rows"`), or a named
   executable script with a recorded exit code; **and**
2. an **evidence path** — the phase evidence register (or equivalent controlled record)
   that records the actual run: date, environment, result.

A claim without both is an opinion, not a verification. Screenshots, memory, and "it
worked when I tried it" are not evidence.

## 2. Current real coverage (2026-07-16, all runs recorded)

The **68-test database security suite** (`npm run test:db`, 5 suites) — every isolation
assertion executed as a **non-owner runtime login** (`rootlco_test_runtime`), never as
`postgres`, which carries BYPASSRLS in the local stack (measured):

| Suite                               | Tests | What it proves                                                                                                                                                                             |
| ----------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/db/foundation.test.ts`       |    14 | Schemas, extension allow-lists, role attributes, nothing-more object inventory, RLS enabled **and forced** everywhere, migration naming rules                                              |
| `tests/db/rls.test.ts`              |    18 | Default deny, transaction-local context, tenant A↔B isolation, WITH CHECK, no INSERT/DELETE/ALTER/bypass for runtime roles, readonly-role limits, FORCE-RLS-vs-owner behavior              |
| `tests/db/constraints.test.ts`      |    12 | Composite-FK cross-tenant rejection, ON DELETE RESTRICT, partial-unique with soft delete, tenant-scoped EXCLUDE, constraint/index naming                                                   |
| `tests/db/patterns.test.ts`         |    11 | Append-only history (UPDATE/DELETE denied), idempotency-key semantics (replay, conflict, per-tenant independence)                                                                          |
| `tests/db/number-sequences.test.ts` |    13 | Tenant-scoped allocation, denial without context, **50 parallel workers** with zero duplicates/loss (the approved baseline, not reduced), rollback consistency, regression-guard hardening |

Plus: 28 unit tests and the full `npm run verify` gate (exit 0); both secret scans clean;
and the **defective-migration rehearsal** — a deliberately broken migration failed the
pipeline (`RUNNER_EXIT=1`) and the clean-database guard refused a populated database
(`GUARD_EXIT=1`), recorded in
[rehearsal-defective-migration.md](../phase-1/phase-1-2/rehearsal-defective-migration.md).
The broken file was never committed.

Run records live in the
[Phase 1-2 evidence register](../phase-1/phase-1-2/phase-1-2-evidence-register.md).

## 3. Binding rules going forward

1. **Every security control ships with at least one negative test.** Proving the door
   opens is not security testing; proving it stays shut is.
2. **Isolation tests run as a non-owner role.** Table-owner or superuser results are
   never RLS evidence ([rls-standard.md](../database/rls-standard.md)); PostgreSQL
   applies policies differently to owners, so owner-run "proof" is structurally invalid.
3. **Checks fail closed.** A verification step that cannot run must fail the pipeline —
   precedent: the Phase 1-2 CI immutability step was found swallowing git errors
   (`|| true`) and printing OK; it was classified a defect and made fail-closed
   (evidence register §4).
4. **Evidence is recorded where it happened.** Each phase's evidence register records
   real runs with dates and environments; counts and claims must match the committed
   tree they describe (the Phase 1-2 "evidence drift" defect and its disclosure set the
   precedent).
5. **CI is the enforcement point.** The four CI jobs (`Lint, types, tests, build` ·
   `Docker build validation` · `Database migrations and RLS tests` ·
   `Secret and sensitive-file scan`) are required checks per
   [github-required-checks.md](../phase-1/phase-1-1/github-required-checks.md).
   **Honesty point: no GitHub Actions run exists for the Phase 1-2 branch yet** — local
   equivalents of every step passed; the PR run is the outstanding proof.

## 4. Test types and their owners

| Test type                                                            | Status                                     | Owner                                                                                                  |
| -------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Database security suite (RLS, constraints, patterns, concurrency)    | **Exists — 68 tests, all passing locally** | Phase 1-2 onward; every later schema phase extends it                                                  |
| Unit tests                                                           | Exists (28)                                | Continuous                                                                                             |
| Migration validation (clean-DB replay, immutability, rehearsal)      | Exists; locally verified                   | CI `database` job                                                                                      |
| Secret scanning                                                      | Exists; locally verified                   | CI `secrets` job + `npm run security:browser-secrets`                                                  |
| SAST (static analysis beyond ESLint)                                 | `Planned`                                  | Tool selection is an owner decision; target: before the first backend phase (Phases 1-13..1-24)        |
| Dependency scanning (SCA)                                            | `Planned`                                  | [dependency-and-supply-chain-standard.md](./dependency-and-supply-chain-standard.md)                   |
| API security tests (authz, rate limits, negative cases per endpoint) | `Planned`                                  | Backend phases (1-13..1-24)                                                                            |
| Frontend security tests (XSS, CSP, cookie behavior)                  | `Planned`                                  | Phase 1-25 onward                                                                                      |
| DAST (dynamic scanning against a running instance)                   | `Planned`                                  | Requires a hosted environment; ops phases                                                              |
| Penetration test                                                     | **None performed — ever**                  | Pre-production requirement; blocked on P1-EC-016 (independent security reviewer) and an owner decision |

## 5. Relationship to other documents

- [security-baseline.md](./security-baseline.md) — the statuses this evidence feeds.
- [database-test-fixtures.md](../testing/database-test-fixtures.md) — the fixture
  discipline (tenant_a/tenant_b; never a real tenant) the suite is built on.
- [vulnerability-management-standard.md](./vulnerability-management-standard.md) — where
  failing security tests become findings.
- [secure-coding-standard.md](./secure-coding-standard.md) — the rules the tests pin.

## 6. Honest limits

- All test results to date are local runs, executed and recorded by the owner under the
  Solo Developer Review Policy; no independent party has reproduced them.
- The CI database job runs plain PostgreSQL 17, not the full Supabase stack; the
  role-attribute differences are documented in
  [role-and-grant-standard.md](../database/role-and-grant-standard.md) and accepted.
- No security testing exists for application layers, because those layers do not exist.
  The absence is recorded per row in the [ASVS matrix](./owasp-asvs-5-matrix.md), not
  hidden.
