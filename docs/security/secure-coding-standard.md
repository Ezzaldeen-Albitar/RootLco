# Secure Coding Standard

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Adopted by owner instruction (2026-07-17); merges with the Phase 1-2 pull request — the Phase 1-2 exit gate is not decided ·
**Owner:** Eng. Ezzaldeen Al-Bitar ·
**Review:** [Solo Developer Review Policy](../governance/solo-developer-review-policy.md)

---

## 1. Scope

Binding from 2026-07-17 for all code in this repository: TypeScript/Next.js application
code, SQL migrations, database functions, and CI/build scripts. Rules whose surface does
not exist yet (APIs, frontend screens) are binding **on the phase that creates that
surface** — they are listed now so no later phase can claim surprise.

## 2. The rules

Each rule carries its honest status today and its primary ASVS 5.0.0 anchor
([matrix](./owasp-asvs-5-matrix.md)).

| #   | Rule                                                                                                                                                                                                                                                                                                | ASVS anchor        | Status today                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------- |
| R1  | **Parameterized SQL only.** Every database access uses driver placeholders (`$1`-style with the pg driver) or an equivalently safe mechanism. String-concatenated SQL with untrusted input is forbidden — in application code, in stored procedures, and in tests.                                  | V1.2 (1.2.4)       | Practiced by the entire DB test harness and migrations; application query surface arrives with backend phases |
| R2  | **Validate at every boundary with zod.** Every external input (request bodies, query params, webhook payloads, file metadata) is parsed through a zod schema before use; unvalidated input never crosses into business logic.                                                                       | V2.2               | `Planned` — zod is already a dependency; boundaries arrive with backend phases                                |
| R3  | **Authorization is server-resolved context — never client-supplied scope.** Tenant, company, branch, and user identity come from the server-resolved session context; a client-supplied scope value is routing input at most, never authorization ([rls-standard.md](../database/rls-standard.md)). | V8.2/V8.3          | Database layer **verified** (RL-SEC-DB-005/006); API layer binding on backend phases                          |
| R4  | **Deny by default.** Absence of a grant, policy, or permission means no. RLS policies grant access; nothing is reachable by omission.                                                                                                                                                               | V8                 | Database layer verified (default-deny policies, RL-SEC-DB-001)                                                |
| R5  | **Never floating-point money.** Monetary values are `numeric` in the database and integer-minor-units or decimal types in code — never `float`/`double` ([database-architecture.md](../database/database-architecture.md)).                                                                         | V2/V11 (integrity) | Binding database rule since Phase 1-2                                                                         |
| R6  | **No secrets in code — ever.** No secret in source, config committed to Git, Dockerfiles, or build args ([SECURITY.md §4](../../SECURITY.md)). The browser-exposed-secrets scan and the CI secret scan enforce this.                                                                                | V13.3              | Scans exist and ran clean locally (RL-SEC-DB-012)                                                             |
| R7  | **TypeScript strict + lint gates.** `tsc --noEmit` (strict) and ESLint pass before merge; `npm run verify` is the local equivalent of the CI quality job.                                                                                                                                           | V15.3              | Enforced today (verify exit 0 recorded)                                                                       |
| R8  | **Errors fail closed and leak nothing.** Unexpected errors return generic messages; stack traces, SQL, and secret values never reach a client. Checks that cannot run **fail the operation** — precedent: the Phase 1-2 fail-open CI defect was classified a defect and fixed.                      | V16.5              | `Planned` for API surfaces; the fail-closed principle is already applied to CI controls                       |
| R9  | **Output encoding, XSS defense, CSP.** Frontend output is context-encoded; a Content-Security-Policy is defined; dangerous sinks (`dangerouslySetInnerHTML`) require review.                                                                                                                        | V1.2/V3.4          | `Planned` — Phase 1-25 onward (frontend)                                                                      |
| R10 | **Dependencies follow the supply-chain standard.** New dependencies need justification, licence check, and owner review; installs use `npm ci` against the committed lockfile ([dependency-and-supply-chain-standard.md](./dependency-and-supply-chain-standard.md)).                               | V15.1/V15.2        | Lockfile + `npm ci` binding today; SCA gate `Planned`                                                         |
| R11 | **Safe concurrency.** Shared mutable state is serialized (database: `FOR UPDATE` per [transaction-and-concurrency-standard.md](../database/transaction-and-concurrency-standard.md)); check-then-act sequences are made atomic.                                                                     | V15.4              | Database pattern verified by the 50-worker tests; application scope with backend phases                       |
| R12 | **No dynamic code execution on untrusted input.** No `eval`, `new Function`, or template execution built from user data.                                                                                                                                                                            | V1.3/V15           | Binding; trivially satisfied today, checked in review                                                         |

## 3. Review enforcement

Every pull request is checked against this table under the
[Solo Developer Review Policy](../governance/solo-developer-review-policy.md). A rule
violation is a finding with a severity from
[security-baseline.md §7](./security-baseline.md); R1/R3/R4/R6 violations are `High` at
minimum, `Critical` when tenant data is reachable.

## 4. NIST SSDF alignment

In paraphrase of SSDF v1.1: secure-by-default coding practices and code review (PW.5,
PW.7), verification tooling in the pipeline (PW.8, RV.1), and protected code integrity
via the PR + CI gates (PS.1). The mapping is directional, not a compliance claim.

## 5. Relationship to other documents

- [security-baseline.md](./security-baseline.md) — vocabulary, severities, gate.
- [security-testing-standard.md](./security-testing-standard.md) — how rules become
  tests.
- [rls-standard.md](../database/rls-standard.md) and
  [database-architecture.md](../database/database-architecture.md) — the database rules
  R3/R4/R5/R11 bind to.
- [CONTRIBUTING.md](../../CONTRIBUTING.md) — the workflow these rules ride on.

## 6. Honest limits

- Rules R2, R8, R9 have **no enforcement surface yet** — they bind future phases and
  cannot honestly be called implemented today.
- No SAST tool enforces these rules automatically; enforcement is review plus the
  existing lint/type/test/scan gates. SAST adoption is tracked in the
  [security-testing-standard.md](./security-testing-standard.md).
- This standard is reviewed by its own author under the Solo Developer Review Policy.
