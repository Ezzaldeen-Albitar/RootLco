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

| tasks                                                                                                               | wave  | SHA                  | operations consumed                                                                                              | evidence (file names read from `apps/web/tests`, counts measured)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------- | ----- | -------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FE-001`, `FE-002`                                                                                                  | 2     | `f6b5579`            | `crm.customer-search`                                                                                            | `crm-customer-search.test.ts` (38) · `crm-customer-search.dom.test.tsx` (13)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `FE-003`, `FE-004`, `FE-005`                                                                                        | 3     | `a912681`            | `crm.duplicate-scan`, `crm.individual-create`, `crm.company-create`                                              | `crm-customer-create.dom.test.tsx` (19)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `FE-006`, `FE-007`, `FE-008`                                                                                        | 4     | `c8d755d`            | `crm.customer-read`, `crm.contact-*`, `crm.address-*`                                                            | `crm-customer-profile.dom.test.tsx` (21)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `FE-009` preferences · `FE-010` consents · `FE-011` notes · `FE-012` alerts · `FE-013` tags · `FE-014` restrictions | 5, 5b | `ff923f1`, `c390abb` | six component list reads + six writes, behind **six different** permissions                                      | `crm-profile-api.test.ts` (10) · `crm-governance-writes.test.ts` (27) · `crm-customer-components.dom.test.tsx` (23)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `FE-015`, `FE-016`                                                                                                  | 6     | `bf7a011`            | `crm.customer-timeline`, `crm.duplicate-list`, `crm.duplicate-review`                                            | `crm-duplicate-review.test.ts` (24)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `FE-017`, `FE-018`                                                                                                  | 7     | `ff9c8d6`            | `veh.vehicle-search`, `veh.vehicle-create`, five catalogue reads                                                 | `vehicle-api.test.ts` (23) · `vehicle-contract.test.ts` (22)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `FE-019`, `FE-020`                                                                                                  | 8     | `4c16f8b`            | `veh.vehicle-read`, `veh.vehicle-update`, `veh.vehicle-status-change`                                            | `vehicle-profile.test.ts` (24)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `FE-021`, `FE-022`, `FE-023`                                                                                        | 9     | `1ccbf92`            | ownership, plate and odometer history + their three writes                                                       | `vehicle-history.test.ts` (20)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `FE-024`, `FE-025`                                                                                                  | 10    | `984af0e`            | `veh.vehicle-ev-profile-*`, `veh.vehicle-relationship-*`, `crm.vehicle-link`                                     | `vehicle-relations.test.ts` (18)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `FE-026`, `FE-027`, `FE-028`, `FE-029`                                                                              | 11–12 | `7ecd97d`            | `veh.vehicle-document-list`, `veh.vehicle-duplicate-*`, `veh.vehicle-history`                                    | `vehicle-duplicates.test.ts` (20)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `SEC-001` permission and resolved-scope enforcement                                                                 | 13    | `c9cb04d`            | the phase's own surface, asserted against the source that shipped                                                | `p1-27-security.test.ts` (18)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `SEC-002` sensitive-data, export, document, media and file-access controls                                          | 13    | `c9cb04d`            | `FORBIDDEN_URL_KEYS` vs `query()` — two policies, not one list                                                   | `p1-27-security.test.ts` (18)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `SEC-003` abuse-case and privilege-escalation controls                                                              | 13    | `c9cb04d`            | no client-asserted scope on any adapter                                                                          | `p1-27-security.test.ts` (18)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `SEC-004` security audit-event coverage                                                                             | 13    | `c9cb04d`            | the audited writes the phase calls                                                                               | `p1-27-security.test.ts` (18)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `QA-001` unit and component coverage                                                                                | 14    | `360736f`            | every screen the phase built                                                                                     | `p1-27-qa.test.ts` (18) · `vehicle-screens.dom.test.tsx` (21)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `QA-002` API contract and error-path coverage                                                                       | 14    | `360736f`            | every list adapter × every transport failure kind                                                                | `p1-27-qa.test.ts` (18)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `QA-003` tenant / company / branch isolation                                                                        | 14    | `360736f`            | the scope the client never asserts                                                                               | `p1-27-security.test.ts` (18)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `QA-004` concurrency and idempotency                                                                                | 14    | `360736f`            | `operation-contract.ts` and the generated idempotency table                                                      | `operation-contract.test.ts` (27) · `api-client.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `QA-005` regression and immutable evidence packaging                                                                | 14    | `360736f`, `ed7b942` | SHA-256 over the bytes of all 29 phase evidence documents; the recorded head and counts re-derived from the tree | `p1-27-qa.test.ts` (18), `tests/ci/p1-27-evidence-manifest.test.ts` (18)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `DO-001` continuous-integration quality gate                                                                        | 15    | `2688635`            | none — a gate over the phase's own source                                                                        | `scripts/ci/check-p1-27-frontend.mjs`, six rules with a `selfTest()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `DO-002` structured logging, monitoring and alert routing                                                           | 15    | `2688635`            | the correlation reference every failure surface carries                                                          | `observability.test.ts` — **inherited from P1-26 (`3e1f9e3`), not written here**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `DOC-001` contract, catalogue and traceability synchronization                                                      | 17b   | `e14984e`            | the server vocabularies, read from the migrations                                                                | `server-vocabularies.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `DOC-002` operator / developer guidance and change-log update                                                       | 15    | `2688635`            | the guides' own claims, each read from the thing it describes                                                    | `p1-27-doc-reconciliation.test.ts` (change-log half) · `p1-27-guidance-reconciliation.test.ts` (guidance half, 10). Until the latter was written this cell read **"No automated proof"** and that was accurate: nothing outside `docs/**` named either guide. An existence check was rejected as the wrong proof — it would pass against a guide describing a product nobody built, which is this phase's dominant defect class. Each case instead pins a guide sentence to its executable source: the `expensive-read` limit **read from `apps/api`**, `STATUS_BY_KIND`, `query()`, `normalizeVinForDisplay`, the gate's rule ids, the `TableStatus` union, the root `.prettierignore`, and every path in the where-things-live table. Writing it found two real defects in the guide — see below. |

Every task id above is written out individually rather than as a range. A range
is not searchable: a reader looking for `FE-004` in a register that says
`FE-003`–`FE-005` finds nothing and concludes the task was never delivered.

**That sentence was false when it was written, immediately below a table whose
last two rows read `SEC-001`…`SEC-004` and `QA-001`…`QA-005` — and whose
`DO-001`, `DO-002`, `DOC-001` and `DOC-002` rows did not exist at all, while the
totals above tallied DevOps 2/2 and Documentation 2/2.** Nine of the forty-two
tasks were therefore counted and not named. It was found by a cross-document
reconciliation during the Owner-acceptance remediation, not by review, and the
titles above are read from `canonical-plan.md` §"Task list" rather than
reconstructed. A rule stated one line under its own violation is the most
comfortable kind of untruth to write.

**The SHAs in the four new rows were wrong on the first attempt, and were
corrected by `git log --diff-filter=A` rather than by re-reading the table.**
`DOC-001` and `DOC-002` were both attributed to `1719423` because that commit's
subject is "record 42/42 implementation"; the guides actually landed in
`2688635` and `server-vocabularies.test.ts` in `e14984e`, Wave 17b. The same
query exposed something the table would otherwise have implied: **`DO-002`'s
evidence, `observability.test.ts`, was written by P1-26 in `3e1f9e3` and is
inherited, not produced here.** A register that lists an inherited test beside a
task id reads as though the task wrote it.

**`DOC-002`'s check found two defects in the guide it was written to prove, and
one of them was introduced by the fix for the other.** The developer guide's
"where things live" table said adapters are `features/{...}/*-api.ts`. Thirteen
files in those trees open with `'use server'` and that pattern matched eight: it
missed `api.ts` in both trees and all three `*-actions.ts` files. The correction
then added a `vehicles/*actions.ts` row — and the path case failed on it inside a
minute, because no such file has ever existed. That is how the real divergence
surfaced, which the guide had never stated: **CRM segregates its writes into
`*actions.ts` while the vehicle tree has none at all**, keeping its six write
actions inside the `*api.ts` file owning the same resource. A developer looking
for a vehicle write in an `actions` file concludes it was never built. Both
errors are the class the check exists to catch, and the second one was written by
the same hand that wrote the check.

**Six of the ten evidence cells in the first version of this table named files
that do not exist** — `crm-customer-create.test.ts`, `crm-customer-profile.test.ts`,
`crm-timeline.test.ts`, `vehicle-search.test.ts`, `vehicle-create.dom.test.tsx`
and `vehicle-vin.test.ts`. They were written from memory of what the waves had
covered rather than from `apps/web/tests`, and every one of them was plausible.
A register that cites a file which is not there is worse than one that cites
nothing, because it looks like evidence. `p1-27-qa.test.ts` now reads the
directory and fails on any name that is not present.

### What each wave refused to build, and why

A phase that only records what it built hides the decisions that mattered most.

**`FE-003` does not scan at all.** `crm.duplicate-scan` is a privileged audited
**write**, and no P1-27 surface calls it. The creation-time duplicate warning
arrives on the create RESPONSE as `possibleDuplicates`
(`creation-contract.ts`), which is why `crm-customer-create.dom.test.tsx`
asserts the absence deliberately.

This paragraph used to say "the creation form calls it once, on explicit
intent". That was never true, and it was the stated justification for an
allow-list entry in `check-p1-27-frontend.mjs` exempting `creation-actions.ts`
from the `no-duplicate-scan-on-a-queue` rule. `evaluate()` skips an allow-listed
file entirely, so the exemption was a live hole rather than merely a stale
sentence: a privileged audited write added to that one file would have passed
the gate that exists to stop it. `FE-003` (`52a230a`) deleted it, and every
`allow` in that gate is now `[]`.

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

Frontend **29 / 29** · Security **4 / 4** · QA **5 / 5** · DevOps **2 / 2** ·
Documentation **2 / 2**. Implementation total **42 / 42**.

**This is not closure.** Every task has a commit, a test that names it and
mutations the suite caught, and none of that is Owner acceptance. `P1-27` closes
only when the Owner runs the real application against the real backend and
returns an explicit `OWNER ACCEPTANCE: PASS` — and only then does the
documentation-only `P1-G27` gate record get written.

Silence is not Pass. P1-26 was closed once on unproven claims and had to be
reopened; that is why this sentence is here.

---

## Owner-acceptance remediation — `OA-01` … `OA-09`

The Owner tested the merged application on 2026-08-06 and returned
`OWNER ACCEPTANCE: FAIL` with eleven confirmed defects. **P1-27 is reopened.**
The result and the disposition of every defect are in
[`owner-acceptance-fail-remediation.md`](owner-acceptance-fail-remediation.md).

The implementation total above is unchanged and is now beside the point: 42 / 42
tasks were complete, every automated tier was green, and the product was still
rejected. The tasks below are what that rejection actually cost.

| id      | task                                                                   | defect                    | evidence                                                 |
| ------- | ---------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------- |
| `OA-01` | Password reveal control inside the field, product-wide                 | 1                         | `PasswordField`; `M-OA-01` … `M-OA-03`                   |
| `OA-02` | Subtle overlay scrollbar on the sidebar navigation                     | 2                         | `_scrollbars.scss`; `M-OA-07` … `M-OA-09`                |
| `OA-03` | Every sidebar parent a controlled disclosure, with animation           | 3, 4                      | `Sidebar.tsx`; `M-OA-04` … `M-OA-06`                     |
| `OA-04` | Add Individual / Add Company from the page header and the empty result | 5                         | `CustomerCreateActions`; `M-OA-10`, `M-OA-11`, `M-OA-15` |
| `OA-05` | Duplicate queues named, iconed and introduced in business language     | 7                         | navigation, catalogues                                   |
| `OA-06` | Match evidence rendered as sentences with a confidence band            | 8                         | `MatchExplanation`; `M-OA-12` … `M-OA-14`                |
| `OA-07` | Wording audit across both catalogues, plus `validate:plain-language`   | 9                         | 24 rules; `M-OA-16`, `M-OA-17`                           |
| `OA-08` | `validate:web-theme` — 51 colour utilities that emitted no CSS         | not reported by the Owner | `M-OA-18`                                                |
| `OA-09` | Workshop workflow and vehicle-catalogue documentation                  | 10, 11                    | `docs/product/` — **planning only, nothing implemented** |

### What `OA-09` is not

It is ten documents and an integration-findings register. It is not an
implementation of the workshop journey, and it does not authorise one. Every
document says so in its own header, and `docs/product/README.md` §5 states the
controlled sequence by which each finding becomes real work in a later phase.

### What is still not done, and is not claimed

- **Defect 6, in full.** Both customer creation paths are now reachable and
  clearly labelled. The fourteen progressive sections the Owner listed are not
  built: most name fields whose backend contract this phase has not audited, and
  this phase's own record contains four separate failures caused by guessing a
  contract. That work belongs in a Frontend wave with contract archaeology in
  front of it.
- **A candidate count on either duplicate queue.** The read publishes no total,
  so any count would be fabricated.
- **Vehicle document creation.** No create operation exists.
