# Phase 1-27 — task register

**Classification:** Confidential — Commercial Product and Pilot Planning

Every completed task, with the contract it consumes and the evidence that it
does. **No task is complete without immutable evidence.** A task listed here
without a SHA is in progress, not delivered.

Canonical total **42**: Frontend 29 · Security 4 · QA 5 · DevOps 2 ·
Documentation 2.

---

## Foundation — `P1-27-INT-003`

Landed before any mutation screen, because every screen that writes depends on
it.

| field          | value                                                                                                                                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Finding**    | `P1-27-INT-003`                                                                                                                                                                                                                                                           |
| **SHA**        | `df6e45288c267d19509307b405bf835d1bc772a4`                                                                                                                                                                                                                                |
| **Defect**     | The Web client chose to send `Idempotency-Key` from the HTTP method. The backend reads `operation.idempotent` off the registration. Nine operations disagreed — six PUT and three PATCH — and each answered `400 ERR-INT-002` **before authorization**, on every attempt. |
| **Correction** | `scripts/ci/generate-idempotent-operations.mjs` derives the table from `docs/api/openapi.v1.json`; `operation-contract.ts` resolves a path to its operation; `validate:idempotent-operations` fails the build on drift.                                                   |
| **Evidence**   | 27 tests in `apps/web/tests/operation-contract.test.ts` naming all nine operations individually, 6 in `tests/ci/idempotent-operations-manifest.test.ts`, 5 corrected in `api-client.test.ts`.                                                                             |
| **Mutation**   | Restoring `return method === 'POST'` fails 16 tests naming each affected operation.                                                                                                                                                                                       |
| **Limitation** | An unknown path errs toward sending. Deliberate — see the module note.                                                                                                                                                                                                    |

---

## `P1-27-FE-001` — CRM customer search · `P1-27-FE-002` — CRM search results

| field                 | value                                                                                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task IDs**          | `P1-27-FE-001`, `P1-27-FE-002`                                                                                                                                               |
| **Test IDs**          | `TC-P1-27-CRM-001`, `TC-P1-27-CRM-002`                                                                                                                                       |
| **Requirement**       | FR-CRM-001, NFR-PRV-001                                                                                                                                                      |
| **Backend operation** | `crm.customer-search` — `GET /api/v1/customers`                                                                                                                              |
| **Permission**        | `crm.customer.read`                                                                                                                                                          |
| **Scope**             | `tenant`, resolved server-side. The client sends no tenant, company or branch.                                                                                               |
| **Request schema**    | `.strict()`: `name` (prefix, ≤80), `customerNumber` (exact, ≤64), `partyType`, `lifecycleStatus`, `cursor`, `limit` (1–100)                                                  |
| **Response schema**   | `Page<CustomerSearchHit>` — `{ items, nextCursor, hasMore }`, **no total**                                                                                                   |
| **Error paths**       | 401 → session expired · 403 → denied, rendered instead of an empty list · 422 → validation · 429 → unavailable, "try again shortly" · 5xx / timeout → unavailable, retryable |
| **Pagination**        | Cursor, `(created_at DESC, id DESC)`, contract key `crm.business_partners:created_at_desc`. Previous/Next only.                                                              |
| **Audit**             | `auditClass: 'none'` — a search writes no audit record.                                                                                                                      |
| **Idempotency**       | Not applicable; a GET carries no key, asserted in `operation-contract.test.ts`.                                                                                              |
| **Concurrency**       | Not applicable to a read.                                                                                                                                                    |
| **SHA**               | _see the Wave 2 commit below_                                                                                                                                                |
| **Evidence**          | `apps/web/tests/crm-customer-search.test.ts` (38) · `apps/web/tests/crm-customer-search.dom.test.tsx` (13)                                                                   |

### Decisions

**Searches on intent, never on a keystroke.** `expensive-read` is 30 requests per
60 seconds keyed by operation, tenant and user. Search-as-you-type spends that in
under three seconds. The results are a **separate component mounted only after a
submission**, so "no request before intent" is structural rather than guarded by
the adapter — the first draft held the hook at the top and issued a request on
mount, and the DOM test caught it.

**No debounce.** A debounce is still a request per pause, and there is no
client-side suggestion source to debounce against. Building one would mean
holding customer names in the browser, which is what `NFR-PRV-001` is preventing.

**No sortable column.** The operation publishes no `sort` parameter and its
schema is `.strict()`, so a sort control would send a 422 rather than a
differently-ordered page.

**No total, no "showing X of Y".** The backend publishes `hasMore` and nothing
else. Inventing a count produces a pager correct on page one and wrong from page
two, invisibly.

**`retries: 0`.** The shared client retries a read once by default. Against a
30-per-minute budget that spends an operator's allowance twice per search without
telling them.

### Limitations — stated, not silently dropped

**No phone or email search.** The execution prompt lists them among fields to
offer "**and other approved fields only**". They are _not_ approved: the domain
file states raw contact values "are never a search input and are never projected
by this contract" (`NFR-PRV-001`). A phone box here would be a control that
cannot work, and a disabled one would advertise a capability the product
deliberately does not have. Widening the allow-list is a reviewed backend change.

**No primary-contact, alert-indicator or last-activity column.** `CustomerSearchHit`
publishes six fields and none of them is any of these. A column that renders
blank for every row is worse than an absent one.

**Name matching is a prefix.** Stated in the field hint, because an operator
expecting substring matching concludes the data is missing rather than that the
query was narrower than they thought.

---

## Shared foundations promoted in this wave

Two generic helpers moved out of `features/administration/shared`, because
P1-27 needed them and the alternatives were a cross-feature import (CRM does not
depend on Administration) or a copy (the duplicate authority the ownership gate
exists to prevent). Both old paths re-export, so **no P1-26 screen changed** and
the 386-test web suite passed unaltered across the move.

| from                                                 | to                                          |
| ---------------------------------------------------- | ------------------------------------------- |
| `features/administration/shared/api.ts`              | `lib/api/read-operation.ts`                 |
| `features/administration/shared/use-server-table.ts` | `components/data-table/use-server-table.ts` |

---

## Remaining

Frontend 2 / 29 · Security 0 / 4 · QA 0 / 5 · DevOps 0 / 2 · Documentation 0 / 2.

`P1-27` closes only on an explicit `OWNER ACCEPTANCE: PASS`.
