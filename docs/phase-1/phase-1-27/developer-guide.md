# Phase 1-27 — developer guide: CRM and Vehicle Frontend

**Classification:** Confidential — Commercial Product and Pilot Planning

How this surface is built, and the traps that cost this phase real time. Read
`operator-guide.md` for what the screens do; this is why they are shaped that
way.

---

## Where things live

| what                                 | where                                                  |
| ------------------------------------ | ------------------------------------------------------ |
| Route segments                       | `apps/web/src/app/[locale]/(dashboard)/{crm,vehicles}` |
| Contracts (types, enums, validators) | `features/{crm/customers,vehicles}/*-contract.ts`      |
| Adapters (`'use server'`)            | `features/{crm/customers,vehicles}/*-api.ts`           |
| Screens (`'use client'`)             | `features/{crm/customers,vehicles}/components/`        |
| Shared table                         | `components/data-table/`                               |
| Shared read helpers                  | `lib/api/read-operation.ts`                            |

A contract file carries the operation table, the permission, the database
constraint it was read out of, and the reason for every refusal. When these
disagree with the code, the contract file is the thing to fix first — it is what
the next phase will read.

## The rules that are enforced, not merely written down

`npm run validate:p1-27-frontend` fails the build on:

- a merge caller of any shape while `P1-OD-017` is open,
- a duplicate-scan call from anywhere but the one allowed creation form,
- a client-asserted `tenantId` / `companyId` / `branchId`,
- a total computed from `rows.length`,
- any upload path while `P1-OD-025` is open,
- any `console.*` in either feature tree.

A test can be deleted around a decision. A gate has to be argued with in a diff.
Wave 6 shipped a working merge form past review, typecheck, lint and 669 green
tests, which is the reason this gate exists.

`query()` in `lib/api/read-operation.ts` **throws** on a scope key rather than
dropping it. Dropping silently would let a caller believe it had asserted a scope
that never left the process.

## Traps, in the order they cost time

**A layer that survives its own mutation is a layer nothing is testing.** The DOM
suites mock the adapters wholesale. Mutating an adapter left twenty DOM tests
green. Adapter behaviour needs `*-api.test.ts`, with only the HTTP client mocked.

**`TableStatus` has no `'ok'`.** A loaded, undenied read is `'idle'`. A guard
written as `table.status === 'ok'` is always false, renders nothing, and makes a
fail-closed test pass for entirely the wrong reason. Use `table.response`, which
is non-null exactly when the page came back ok.

**`STATUS_BY_KIND` maps a failure KIND to a view STATUS, and the names differ.**
`forbidden` → `denied`, `rate-limited` → `unavailable`, `unauthenticated` →
`expired`. Writing `failure('denied')` in a test asserts nothing about
`forbidden`.

**A source-text sweep cannot tell "calls it" from "explains why it never calls
it".** Every absence sweep in this phase failed first on the docblock documenting
the absence. Strip comments — and then prove the stripper still sees code, or
every sweep silently becomes a scan over empty strings.

**`numeric` and `bigint` arrive as strings and must stay strings.** A match score
decides whether two real records are combined. `parseFloat('0.145') * 100` is
`14.499999999999998`, and tests written with values both implementations agree on
prove nothing — choose the values by running the two against each other.

**`date` columns are read `::text` and compared lexicographically.** A single
`new Date()` renders the previous day for every operator west of Greenwich.

**Timestamps carry microseconds; a JS `Date` carries milliseconds.** A keyset
cursor built from a `Date` silently drops rows that share a millisecond — which
is every row a trigger wrote inside one transaction. Fixed backend-side in
`P1-27-INT-006`/`INT-008`; do not reintroduce a `Date`-based cursor.

**Route schemas are `.strict()`.** One unexpected key is a 422 for the whole
request, not a dropped field.

**Idempotency comes from the operation, not the HTTP verb.** `crm.preference-set`
is a PUT and _is_ idempotent. Deriving from the method made nine operations
answer `400` before authorization on every attempt (`P1-27-INT-003`).

**A screen with no route into it is not delivered.** Two finished duplicate
queues sat unreachable for six waves with every test green, because nothing can
fail on a page nobody navigates to. If you add a screen, add its sidebar entry in
the same commit — `navigation.test.ts` asserts the `available` and `planned` lists
exactly.

**Root `format:check` cannot see `apps/**`.** Each workspace owns its prettier
config and the root `.prettierignore` contains `apps/`. Run
`npm run format:check --workspace @rootlco/web` or the root check will report
clean over files it never opened.

**`verify:contracts` does not include `verify:inventories`.** Phase inventory
documents embed a global registry count; adding a backend operation changes
documents in phases you are not working on.

**`&#8594;` is four hex digits behind a `#`.** The design-token gate reads it as a
raw colour. Use the literal character.

## What a new screen owes

Arabic · English · RTL · LTR · desktop · tablet · keyboard · accessibility ·
loading · empty · error · retry · permission-denied · conflict where applicable ·
correlation ID · server-resolved scope · real API integration · evidence.

Both a contract/adapter test **and** a `.dom` test. The vehicle domain went five
waves with only the first kind, and the missing half is what eventually found a
defect affecting every table in the product.

Mocks are test fixtures. **Mocks are not production-integration evidence.**
