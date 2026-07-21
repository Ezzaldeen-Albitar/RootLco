# P1-12 Evidence — Tenant / Company / Branch Isolation Report

**Phase:** P1-12 — Release 2 Database Gate · **Wave 4.2 (Security stream).**
**Base:** protected `origin/develop` = `5cd16da` (P1-11 gate merge #45).
**Schema hash (sha256):** `d3b1e7e40a141152f8aff04cf582c02cffa43f8709adad936450c8019d3e4cdb`.

> **Governance / self-review note.** Owner-authorized technical, QA, security, and
> adversarial **self-review** by Eng. Ezzaldeen Al-Bitar under the Solo Developer Review
> Policy and the Standing Technical Authorization Policy. This is **not** an independent
> third-party audit. Every figure below traces to actual execution; the user performs all
> merges.

## Objective

Prove that no session can read or write rows outside its authorized tenant / company /
branch scope, across both the integrated end-to-end chain and every per-phase isolation
and security suite.

## Part A — Integrated end-to-end isolation matrix

Source: `tests/db/p1-12-integrated-scenario.test.ts` (Wave 3, 8/8 PASS). The matrix is
evaluated against the same committed cross-domain transaction (svc → inv → veh → rec → wo →
quo → sal → receipt → allocation → delivery → wty) that reconciles fully.

| Isolation assertion                                            | Observed   |
| -------------------------------------------------------------- | ---------- |
| Foreign tenant (tenant B) rows visible across 10 domain tables | **0**      |
| No-context session rows visible across 10 domain tables        | **0**      |
| Branch-A2-scoped tenant-A session rows from branch A1          | **0**      |
| Cross-tenant write (tenant B writing a tenant-A invoice)       | **DENIED** |

## Part B — Per-phase isolation & security suites

Source: the full `test:db` run on the empty rebuild — **118 files / 1141 tests, all green
(≈201 s)**. Isolation and security are covered by the crm, veh, P1-09, P1-10, and P1-11
isolation + security suites. The role matrix exercises the **runtime / readonly / worker**
roles across **2 tenants × 2 branches**, confirming that each role sees and writes only its
authorized scope and that cross-scope reads/writes return zero rows or are denied.

Supporting inventory facts: **242/242** tables ENABLE + FORCE RLS, **0** `SECURITY DEFINER`
functions, runtime role owns **0** tables (see `rls-review-report.md`).

## Status

**PASS.** The integrated E2E isolation matrix shows zero cross-scope visibility and denied
cross-tenant writes; the per-phase isolation/security suites within the 1141-test run are
all green. No unauthorized cross-scope access observed. No remediation required.
