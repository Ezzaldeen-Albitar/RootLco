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

## `P1-27-FE-003` … `P1-27-FE-029` — delivered by wave

Every row below is delivered: it has a commit, a test file that names it, and at
least two mutations that the suite caught. The per-task contract detail lives in
the module docblocks — each contract file carries the operation table, the
permission, the constraint it was read out of and the reason for every refusal.
This register carries the evidence chain.

| tasks             | wave  | SHA                  | operations consumed                                                           | evidence                                                                             |
| ----------------- | ----- | -------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `FE-001`–`FE-002` | 2     | `f6b5579`            | `crm.customer-search`                                                         | `crm-customer-search.test.ts` (38) · `crm-customer-search.dom.test.tsx` (13)         |
| `FE-003`–`FE-005` | 3     | `a912681`            | `crm.duplicate-scan`, `crm.individual-create`, `crm.company-create`           | `crm-customer-create.test.ts` · `crm-customer-create.dom.test.tsx`                   |
| `FE-006`–`FE-008` | 4     | `c8d755d`            | `crm.customer-read`, `crm.contact-*`, `crm.address-*`                         | `crm-customer-profile.test.ts` · `crm-customer-profile.dom.test.tsx`                 |
| `FE-009`–`FE-014` | 5, 5b | `ff923f1`, `c390abb` | six component list reads + six writes                                         | `crm-profile-api.test.ts` · `crm-governance-writes.test.ts` · `crm-components.dom.*` |
| `FE-015`–`FE-016` | 6     | `bf7a011`            | `crm.customer-timeline`, `crm.duplicate-list`, `crm.duplicate-review`         | `crm-duplicate-review.test.ts` · `crm-timeline.test.ts`                              |
| `FE-017`–`FE-018` | 7     | `ff9c8d6`            | `veh.vehicle-search`, `veh.vehicle-create`, five catalogue reads              | `vehicle-search.test.ts` · `vehicle-create.dom.test.tsx`                             |
| `FE-019`–`FE-020` | 8     | `4c16f8b`            | `veh.vehicle-read`, `veh.vehicle-update`, `veh.vehicle-status-change`         | `vehicle-profile.test.ts` · `vehicle-vin.test.ts`                                    |
| `FE-021`–`FE-023` | 9     | `1ccbf92`            | ownership, plate and odometer history + their three writes                    | `vehicle-history.test.ts`                                                            |
| `FE-024`–`FE-025` | 10    | `984af0e`            | `veh.vehicle-ev-profile-*`, `veh.vehicle-relationship-*`, `crm.vehicle-link`  | `vehicle-relations.test.ts`                                                          |
| `FE-026`–`FE-029` | 11–12 | _this wave_          | `veh.vehicle-document-list`, `veh.vehicle-duplicate-*`, `veh.vehicle-history` | `vehicle-duplicates.test.ts` (20)                                                    |

### What each wave refused to build, and why

A phase that only records what it built hides the decisions that mattered most.

**`FE-003` does not scan on every keystroke.** `crm.duplicate-scan` is a
privileged audited **write**. The creation form calls it once, on explicit
intent, and never to decorate a field.

**`FE-016` and `FE-028` have no merge affordance.** `P1-OD-017` is an open Owner
decision and the plan requires the affordance to be _absent_, not disabled. Wave 6
shipped a working merge form in breach of this; it was removed and the defect is
recorded in `findings.md`. Both test files now assert no export matches
`/merge/i`.

**`FE-028` never calls `veh.vehicle-duplicate-scan`.** Same shape as `FE-003`:
an operation that reads like a query, creates rows, writes audit history and is
throttled at 30/min. There is no rescan button and none fires on mount.

**`FE-027` ships no upload path.** There is no vehicle media operation in the
platform at all. `P1-OD-025` must decide accepted types, size limits and storage
first. `MEDIA_STATUS` is `'blocked-on-p1-od-025'`, not a feature flag — a flag
implies something to switch on.

**`FE-029` is not a timeline.** `veh.vehicle-history` is an attribute-change
ledger over `veh.vehicle_attribute_history`. The vehicle schema has no equivalent
of `crm.timeline_events`, so the profile tab is `history` and the five component
histories stay in their own sections rather than being fused into an event stream
the platform cannot produce.

**No screen invents a total.** Every list is `Page<T>` = `{ items, nextCursor,
hasMore }`. Previous/Next only, never "page 4 of 37".

**No screen sends a tenant.** Scope is resolved server-side from the session on
every one of these operations.

---

## Remaining

Frontend **29 / 29** · Security 0 / 4 · QA 0 / 5 · DevOps 0 / 2 · Documentation 0 / 2.

`P1-27` closes only on an explicit `OWNER ACCEPTANCE: PASS`.
