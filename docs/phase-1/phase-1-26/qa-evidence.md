# Phase 1-26 — QA evidence

**Classification:** Confidential — Commercial Product and Pilot Planning

`P1-26-QA-001` … `P1-26-QA-005`.

---

## 1. `P1-26-QA-001` — unit and component coverage

| Suite          | File                                    | Covers                                                                                                           |
| -------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Authentication | `apps/web/tests/authentication.test.ts` | schemas, recovery-token bounds, cookie attributes, resolved scope, action-result mapping, grapheme-safe initials |
| Administration | `apps/web/tests/administration.test.ts` | permission-catalogue drift, setting keys, value coercion, cursor pagination, source-tree rules                   |
| Observability  | `apps/web/tests/observability.test.ts`  | redaction by key and by value shape, route sanitising, adapter boundary                                          |
| Navigation     | `apps/web/tests/navigation.test.ts`     | available/planned status, catalogue-backed permissions, filtering                                                |
| Table state    | `apps/web/tests/table-state.test.ts`    | URL safety, transitions, page counting                                                                           |
| Gate mutations | `tests/ci/p1-26-frontend-gate.test.ts`  | every gate rule, planted violation by planted violation                                                          |

States covered across the suites and the browser matrix: **positive, negative,
loading, empty, error, retry, permission-denied, session-expired, conflict**,
in **Arabic and English**, **RTL and LTR**, at **desktop, laptop and tablet**
widths.

## 2. `P1-26-QA-002` — API contract and error-path coverage

`fromFailure` is the single mapping from a transport outcome to a rendered state,
and `authentication.test.ts` asserts every kind:

| Backend outcome             | Rendered as                                      | Retried?                    |
| --------------------------- | ------------------------------------------------ | --------------------------- |
| 401                         | session expired, cookie cleared, redirect        | no                          |
| 403                         | permission denied, in place of the content       | no                          |
| 404                         | not found                                        | no                          |
| 409                         | conflict — "someone else changed this"           | **never**                   |
| 422 / 400                   | field errors from `problem.errors` only          | no                          |
| 429                         | throttled, with its own sentence                 | no                          |
| 5xx / unreachable / timeout | service unavailable                              | reads once, mutations never |
| cancelled                   | silent — a user pressing Cancel is not a failure | no                          |

**A mutation is never retried.** The client's `send` has no retry path at all; a
retried POST that actually succeeded creates a second record, and the backend's
idempotency keys exist so that retrying is a deliberate act with a key attached.

**A read retries once, not in a loop.** A read that fails twice is reporting a
real condition, and retrying past that turns a brief outage into a thundering
herd against a service that is already struggling.

**Correlation IDs** are generated per request, echoed from the response when
present, and are the only diagnostic shown to a user.

## 3. `P1-26-QA-003` — tenant, company and branch isolation

The Frontend cannot violate isolation, and the reason is structural rather than
tested-into-place:

- The tenant is never sent. It comes from the **verified token** on every
  request. There is no field in any request body that could express one.
- Company and branch appear only as **path parameters** on the settings
  operations, and `assertScopeWithinAuthority` runs **before** `companyExists` —
  so an identifier outside the caller's authority is refused identically whether
  or not it names a real company. No enumeration oracle exists.
- `GET /api/v1/auth/session` is re-resolved on **every** protected render. There
  is no cached scope to go stale, and no client state that could be edited.
- Sign-out clears the cookie; the next render has no session and redirects. No
  cached protected data survives, because nothing protected is cached — every
  dashboard route is `force-dynamic` and reads server-side per request.

`isUnrestrictedScope` is asserted in `authentication.test.ts`, because reading an
empty scope as "no access" instead of "unrestricted" is the inversion that would
be expensive.

**What is not proven here:** cross-tenant behaviour end to end. That requires two
tenants and two live accounts, which the no-fake-data policy forbids seeding. The
backend proves it — `tests/db/*` and `tests/backend/context-spoofing.test.ts` are
the authority — and this phase does not claim to have re-proven it.

## 4. `P1-26-QA-004` — concurrency and idempotency

| Case                                | Handling                                | Where                      |
| ----------------------------------- | --------------------------------------- | -------------------------- |
| Concurrent tenant update            | `If-Match` → 409 → conflict shown       | `updateTenantAction`       |
| Concurrent role update              | `If-Match` → 409                        | `updateRoleAction`         |
| Concurrent permission-effect change | `If-Match` → 409                        | contract requires it       |
| Concurrent settings write           | version race → `ERR-CON-001` → conflict | append-only versions       |
| Ending an approval limit            | `If-Match` → 409                        | `endApprovalLimitAction`   |
| Duplicate invitation                | `ERR-RES-002` → its own sentence        | `inviteUserAction`         |
| Duplicate activation                | idempotent server-side                  | contract                   |
| Reused reset token                  | refused by the provider                 | one message, one next step |
| Double submit                       | blocked while pending                   | `useFormStatus`            |
| Stale page after a mutation         | the table re-reads                      | `refresh()`                |

**`If-Match` is never defaulted.** The version comes from the record the form was
rendered from. Sending `1`, or re-reading and using whatever came back, converts
a lost-update guard into a lost update.

**Read-only operations are not pretended to be concurrent.** The audit log, the
permission catalogue and every list have no version guard, and none is claimed.

## 5. `P1-26-QA-005` — regression and evidence packaging

Every result in this phase is recorded with the command that produced it, the
exact SHA it ran at, and the actual number — see `evidence/test-register.md` and
`evidence/index.md`.

Two properties this phase treated as non-negotiable:

**A test that cannot fail is not evidence.** `administration.test.ts` asserts the
permission catalogue contains every code this phase uses **and** that it does not
contain the broken one, so the assertion can fail. The gate's mutation suite
plants each violation individually. Every path scan asserts it inspected a
non-zero number of files.

**A scanner that reads comments accuses documentation of being code.** The first
version of the money rule failed on the file that explains why `parseFloat` is
never called. Both the gate and the test strip comments, and both prove the
stripper still detects a planted violation — otherwise the fix for a false
positive is a blindfold.
