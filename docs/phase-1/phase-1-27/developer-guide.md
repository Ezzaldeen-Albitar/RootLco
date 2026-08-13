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
| Contracts (types, enums, validators) | `features/{crm/customers,vehicles}/*contract.ts`       |
| Adapters (`'use server'`)            | `features/{crm/customers,vehicles}/*api.ts`            |
| CRM write actions (`'use server'`)   | `features/crm/customers/*actions.ts`                   |
| Screens (`'use client'`)             | `features/{crm/customers,vehicles}/components/`        |
| Shared table                         | `components/data-table/`                               |
| Shared read helpers                  | `lib/api/read-operation.ts`                            |

A contract file carries the operation table, the permission, the database
constraint it was read out of, and the reason for every refusal. When these
disagree with the code, the contract file is the thing to fix first — it is what
the next phase will read.

**The two feature trees do not agree, and the third row of the table above is
not an oversight.** (Two feature trees, three gate roots — the ownership gate
also scans the route tree in the first row; see below.) CRM
segregates its writes into `*actions.ts` and keeps `*api.ts` read-only; the
vehicle tree has no `*actions.ts` at all and puts its six write actions in the
`*api.ts` file that owns the same resource — `createVehicleAction` in `api.ts`,
`updateVehicleAction` in `profile-api.ts`, `transferOwnershipAction` and
`recordOdometerAction` in `history-api.ts`, `setEvProfileAction` and
`retirePartyAction` in `relations-api.ts`. Look for a vehicle write in an
`actions` file and you will conclude it was never built.

Those patterns are **checked**, as a partition: every file that opens with
`'use server'` must match one of them, and a check fails naming any that does
not. The row read `*-api.ts` until the first check was written, which silently
missed five of the thirteen; the first correction then over-claimed a vehicle
`*actions.ts` that has never existed, and the check caught that too, within a
minute.

**Two checks, and the difference between them is the point** (`D-02`).
`p1-27-guidance-reconciliation.test.ts` walks `features/crm/customers` and
`features/vehicles`. The ownership gate owns **three** roots — `features/crm`,
`features/vehicles` and `app/[locale]/(dashboard)` — one level up on the CRM
side, and one whole tree wider. So a `'use server'` file at `features/crm/*.ts`
sat outside a partition this page calls exhaustive, and the claim was true only
because `permissions.ts` is the sole file there and declares no server function.
True by luck is not checked.

`validate:p1-27-doc-counts` now runs the same partition over
`check-p1-27-frontend.mjs`'s own `SCAN_ROOTS`, which is **exported** for exactly
this reason: a page describing the gate's reach imports the list rather than
restating it, so no sentence here can drift from the gate. Adding the third tree
proved the arrangement — the gate went from 43 files across two trees to
`69 file(s) across 3 tree(s)`, and the wider check followed in the same commit,
with no edit to this page's roots. Add a `'use server'` file called anything
else, anywhere in any of the five trees, and it fails naming the file. All
thirteen `'use server'` files are still in the two feature trees; the route tree
contributes none.

## The rules that are enforced, not merely written down

`npm run validate:p1-27-frontend` fails the build on:

- a merge caller of any shape while `P1-OD-017` is open,
- a duplicate-scan call from anywhere in any of the five trees — there is no
  exemption; the creation-time warning arrives on the create RESPONSE,
- a client-asserted `tenantId` / `companyId` / `branchId` — **asserted**, not
  merely displayed: the profile screen renders the tenant the server resolved
  and passes, because the rule is positional. This rule alone carries `roots`
  and reads the three PLAN trees only: `rec.*` publishes `companyId` and
  `branchId` as a required resource selector (`P1-18-A-01`), so its premise is
  false in the adopted `features/receptions` tree, which is swept for
  `tenantId` instead — a selector on nothing, anywhere,
- a total computed from `rows.length`,
- any upload path while `P1-OD-025` is open — seven constructs, not three:
  `new FormData(` with or without an argument, `multipart/form-data`, a file
  input in any of its spellings, `FileReader`, an `input.files` list, an
  `onDrop=` / `onDragOver=` target and a `DataTransfer`,
- any export surface: `shared.export-authorize`, `shared.export-catalogue`, an
  `/exports` path, an `exportSomething` caller, a download authorization, a
  `download=` attribute, `createObjectURL`, a `new Blob(`, `text/csv`,
  `application/pdf` or a `Content-Disposition` header. P1-27 publishes no export
  surface — `canonical-plan.md` §6 names the operation behind all 29 Frontend
  tasks and none of them is one,
- any invented media limit while `P1-OD-025` is open — a `MAX_FILE_SIZE_`-style
  constant, byte arithmetic such as `10 * 1024`, an accepted-MIME list, an
  extension allow-list or an `accept=` attribute. §14 says keep upload
  acceptance blocked **and** do not invent limits; a "sensible default" of 10 MB
  and JPEG/PNG pre-empts the Owner's decision while looking like diligence,
- any `console.*` in any of the five trees.

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

<!-- `DOC-002`, the guidance half. Two sentences on this page are load-bearing
     for someone deciding what they can get away with, and both are proved
     against the code rather than asserted here.

     `p1-27-guidance-reconciliation.test.ts` proves the rest under
     `verify:web`. These two are proved by `validate:p1-27-doc-counts` instead,
     because each needs something outside the web workspace: the ownership
     gate's real scan roots, and its rule list. An unknown claim name below is a
     build failure, not a silent pass. -->

<!-- checked: developer-guide/enforced-rules -->
<!-- checked: developer-guide/use-server-partition -->
