# `P1-27-INT-113` — six shipped operations answered 500 to every request

**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Severity:** **Critical** · **Owning phases:** P1-15 (the mechanism), P1-23 (four
of the six operations) · **Recorded:** 2026-08-08

---

## The defect

Six registered operations declared `rateLimitPolicy: 'standard-read'`. That name
was **never registered**. `policyFor()` throws on an unknown policy name, and the
call sat at `route-handler.ts:202` while the `try` block did not open until
`:219` — so the throw escaped `handleOperation` entirely and became an unhandled
500 rather than an RFC 9457 problem document.

It runs **before authentication**, so the failure did not depend on a token, a
permission, a tenant or a row existing. Every request to these six operations
failed, always, for everyone:

| operation                           | route                                            |
| ----------------------------------- | ------------------------------------------------ |
| `shared.document-read`              | `GET /attachments/documents/{documentId}`        |
| `shared.notification-list`          | `GET /notifications`                             |
| `shared.notification-read`          | `GET /notifications/{notificationId}`            |
| `shared.notification-delivery-list` | `GET /notifications/{notificationId}/deliveries` |
| `rpt.report-catalogue`              | `GET /reports`                                   |
| `rpt.report-read`                   | `GET /reports/{reportCode}`                      |

P1-23 minted four permission codes — `shared.notification.read`,
`shared.notification.delivery.read`, `shared.document.archive` and
`rpt.report.read` — for operations that had never once worked.

## Measured, not inferred

Unauthenticated probe against the running API. A healthy authenticated route
answers 401; the controls declare a policy that **is** registered, so the only
difference between the two groups is the policy name.

```
--- routes declaring the unregistered policy ---
  500  /api/v1/reports
  500  /api/v1/reports/any-code
  500  /api/v1/notifications
  500  /api/v1/notifications/{id}
  500  /api/v1/notifications/{id}/deliveries
  500  /api/v1/attachments/documents/{id}

--- controls declaring a registered policy ---
  401  /api/v1/customers?query=x                 ERR-IAM-002
  401  /api/v1/vehicles/{id}                     ERR-IAM-002
  401  /api/v1/quotations/{id}                   ERR-IAM-002
```

After the fix, all six answer **401 `ERR-IAM-002`** — identical to the controls.

## Why every tier was green

`RATE_LIMIT_POLICIES` was annotated `Readonly<Record<string, RateLimitPolicy>>`,
which **erased its keys**, and `OperationDeclaration.rateLimitPolicy` was typed
`string`. A typo was therefore invisible to the compiler by construction.

No test caught it either, and the reason is worth recording: the suites that walk
the registry populate it by **hand-written lists of route imports**. The six
operations were registered somewhere, and no such list happened to include them.
`tests/openapi-contract.test.ts` says this about itself in a committed comment —
_"THIS LIST IS HAND-MAINTAINED, AND THAT IS ITS TRAP"_ — and records that all
twelve Phase 1-18 operations were once absent from the published contract for
exactly this reason.

Two of the eight sites that mention the name are comments in
`quotations/[quotationId]/route.ts` and `warranties/[warrantyId]/route.ts` saying
_"there is no 'standard-read' in RATE_LIMIT_POLICIES"_. **Someone already knew.**
The knowledge reached two routes and stopped.

This is the third time this phase has met the same shape: a declaration the
platform accepts and cannot honour. `P1-22`'s `versionGuarded` operation whose
version had no published source; `P1-26-F-015`'s ten `idempotent` operations no
call site could satisfy, at 100% failure; and now six operations naming a
throttle that does not exist.

## The fix

**Structural, so the typo becomes uncompilable.** `RATE_LIMIT_POLICIES` is
declared as a literal and the keys are exported as `RateLimitPolicyName`;
`OperationDeclaration.rateLimitPolicy` is typed by that union. The exported
constant widens the **values** back to `RateLimitPolicy`: only the keys were the
problem, and leaving the values narrowed would infer `keyBy` as each policy's own
literal tuple, so `policy.keyBy.includes('tenant')` — the test every caller
performs — would stop compiling for the policies that happen not to contain it.

**The throw moved inside the try.** The type should make it unreachable; it is
kept and relocated because "should" is not a guarantee, and a defect in the
throttle must not be the one failure the error contract cannot render.

**The six routes now name `expensive-read`.** For reports, that policy's own
rationale names reports. For notifications and document metadata it is chosen
over `low-risk-metadata` because the latter keys on operation+tenant only, so one
operator polling an inbox could exhaust the whole tenant's budget; `expensive-read`
keys on operation+tenant+user. 30/min is a starting point for measurement, as
every value in that catalogue is declared to be.

## Evidence

`tests/foundation/rate-limit-policy-registration.test.ts` — 7 tests.

**The route modules are discovered from the filesystem, not listed.** A
hand-written list is precisely how this survived. The suite also asserts it
loaded >150 route modules and >150 policy-declaring operations, so a broken walk
fails loudly instead of passing vacuously.

**A text scan would have been the wrong instrument, and this change proves it:**
the comments added by the fix contain the literal `'standard-read'` in prose, so
a scanner would flag the repair as the defect. Only loading the registry answers
the question. That is the seventh time in this project a scanner would have read
prose as code.

The gate was **proved to fail**: `'standard-read'` was forced back onto one route
through a cast, and three tests failed — including the behavioural one that runs
`policyFor` and the one naming the six operations. Reverted.

One test asserts `standard-read` is **not** registered. That is not a tautology:
if someone closes this finding by minting the missing policy rather than
correcting the routes, six choices of budget and key would have been made by
accident. Adding it is a decision, not a repair.

A hook timeout was found and fixed in the same file. The suite passed alone and
timed out inside the full tier at the 10 s default — and a hook timeout **skips**
tests rather than failing them, so the tier would have reported "7 skipped" and
stayed green while measuring nothing.

| tier                                                    | result                           |
| ------------------------------------------------------- | -------------------------------- |
| `tests/foundation`                                      | 933 passed, 0 skipped (38 files) |
| `npm run test:unit`                                     | 1687 passed (78 files)           |
| `npm run test:backend`                                  | 1834 passed (80 files)           |
| `typecheck`, `lint`, `format:check`, `verify:contracts` | clean                            |

`docs/api/openapi.v1.json` and the P1-24 operation register are generated and
were regenerated (`UPDATE_OPENAPI=1`, `scripts/p1-24-operation-register.mjs`);
`standard-read` now appears **zero** times in either. The register still reports
243 operations, 243 covered.

## What this does not touch

No permission code, no database object, no route path, no response shape. The six
operations now reach authentication; whether their handlers then behave correctly
is a separate question this change does not answer, because until now nothing
could ask it.
