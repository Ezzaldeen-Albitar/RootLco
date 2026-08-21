# Phase 1-27 — developer guide: CRM and Vehicle Frontend

**Classification:** Confidential — Commercial Product and Pilot Planning

How this surface is built, and the traps that cost this phase real time. Read
`operator-guide.md` for what the screens do; this is why they are shaped that
way.

---

## Where things live

| what                                    | where                                                  |
| --------------------------------------- | ------------------------------------------------------ |
| Route segments                          | `apps/web/src/app/[locale]/(dashboard)/{crm,vehicles}` |
| Contracts (types, enums, validators)    | `features/{crm/customers,vehicles}/*contract.ts`       |
| Adapters (`'use server'`)               | `features/{crm/customers,vehicles}/*api.ts`            |
| CRM write actions (`'use server'`)      | `features/crm/customers/*actions.ts`                   |
| Reception capture acts (`'use server'`) | `features/receptions/*-capture.ts`                     |
| Screens (`'use client'`)                | `features/{crm/customers,vehicles}/components/`        |
| Shared table                            | `components/data-table/`                               |
| Shared read helpers                     | `lib/api/read-operation.ts`                            |

A contract file carries the operation table, the permission, the database
constraint it was read out of, and the reason for every refusal. When these
disagree with the code, the contract file is the thing to fix first — it is what
the next phase will read.

**The two feature trees do not agree, and the `*actions.ts` row of the table
above is not an oversight.** (Two feature trees, three gate roots — the
ownership gate also scans the route tree in the first row; see below.) CRM
segregates its writes into `*actions.ts` and keeps `*api.ts` read-only; the
vehicle tree has no `*actions.ts` at all and puts its six write actions in the
`*api.ts` file that owns the same resource — `createVehicleAction` in `api.ts`,
`updateVehicleAction` in `profile-api.ts`, `transferOwnershipAction` and
`recordOdometerAction` in `history-api.ts`, `setEvProfileAction` and
`retirePartyAction` in `relations-api.ts`. Look for a vehicle write in an
`actions` file and you will conclude it was never built.

**The `*-capture.ts` row is a third pattern, and a capture file is not an
adapter.** `features/receptions/evidence-capture.ts` and
`features/receptions/signature-capture.ts` open with `'use server'` and call the
adapters rather than being ones: an evidence capture is five adapter calls in a
fixed order — read the document category, store and register the file, link it to
the visit, bind it to the requirement, and finalize it when the version came back
accepted. A signature capture is the same shape one call shorter. It records the
signature against the exact version instead of binding a requirement, and never
finalizes: a signature may stand as a draft while its version is pending, and
making it final is a separate attributable act rather than something a capture
slips in when the scanner happened to be quick. The order is the contract, so
driving it from a component would put the contract in the browser and hand the
operator four refusals to interpret instead of one outcome. The suffix is
admitted in the reception tree and nowhere else, so a `-capture.ts` file
appearing in another tree fails the same check a misnamed adapter does.

Those three patterns are **checked**, as a partition: every file that opens with
`'use server'` must match one of them, and a check fails naming any that does
not. The row read `*-api.ts` until the first check was written, which silently
missed five of the thirteen; the first correction then over-claimed a vehicle
`*actions.ts` that has never existed, and the check caught that too, within a
minute.

**Two checks, and the difference between them is the point** (`D-02`).
`p1-27-guidance-reconciliation.test.ts` walks `features/crm/customers` and
`features/vehicles`. The ownership gate's roots are wider on every side — the
three this phase's plan names (`features/crm` one level up on the CRM side,
`features/vehicles` and `app/[locale]/(dashboard)`) plus the two P1-28 trees
adopted since. So a `'use server'` file at `features/crm/*.ts` sat outside a
partition this page calls exhaustive, and the claim was true only because
`permissions.ts` is the sole file there and declares no server function. True by
luck is not checked.

`validate:p1-27-doc-counts` now runs the same partition over
`check-p1-27-frontend.mjs`'s own `SCAN_ROOTS`, which is **exported** for exactly
this reason: a page describing the gate's reach imports the list rather than
restating it, so no sentence here can drift from the gate. Adding the third tree
proved the arrangement — the gate went from 43 files across two trees to
`69 file(s) across 3 tree(s)`, and the wider check followed in the same commit,
with no edit to this page's roots. Add a `'use server'` file called anything
else, anywhere in any of the five trees, and it fails naming the file.

**The partition is over five trees, and this page said otherwise for a while.**
It read "all thirteen `'use server'` files are still in the two feature trees",
which was true of the thirteen P1-27 shipped and false about what the check
walks: the two adopted P1-28 trees carry their own, including both capture acts.
Nothing reads that sentence, so nothing caught it — the checks pin the patterns
and the files that must match them, never a sentence counting where they live.
Thirteen is still the P1-27 figure and the route tree still contributes none.

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
- any upload path, in any of the five trees and with no exemption for anyone —
  six constructs: `new FormData(` with or without an argument,
  `multipart/form-data`, `FileReader`, an `input.files` list, an `onDrop=` /
  `onDragOver=` target and a `DataTransfer`. The file input used to be the
  seventh and is now the rule below; it was moved rather than allow-listed here,
  because `allow` exempts a file from a WHOLE rule and naming the capture
  component on this one would have traded six prohibitions away to permit one
  construct. The sanctioned capture path is a `<form action={ServerAction}>`
  submission in which the browser hands the file over and never reads its bytes,
- a file input outside the one approved capture component — `type="file"` in
  every spelling, quoted or brace-wrapped. `P1-OD-025` is **resolved**, so
  reception capture ships and this construct had to become legal somewhere; it is
  legal in `features/receptions/components/CaptureFileField.tsx`, which is the
  whole of `FILE_INPUT_ALLOW`. Both capture steps render that component instead
  of an input of their own, so the next capture surface widens the allowance by
  nothing,
- any export surface: `shared.export-authorize`, `shared.export-catalogue`, an
  `/exports` path, an `exportSomething` caller, a download authorization, a
  `download=` attribute, `createObjectURL`, a `new Blob(`, `text/csv`,
  `application/pdf` or a `Content-Disposition` header. P1-27 publishes no export
  surface — `canonical-plan.md` §6 names the operation behind all 29 Frontend
  tasks and none of them is one,
- any invented media limit — a `MAX_FILE_SIZE_`-style constant, byte arithmetic
  such as `10 * 1024`, an accepted-MIME list, an extension allow-list or an
  `accept=` attribute. Resolving `P1-OD-025` relaxed nothing here. The ceiling
  and the accepted types belong to the category the server publishes — the upload
  authorization answers with `maxBytes`, and `captureDocument` refuses a file
  over it before the bytes cross a network — so a "sensible default" of 10 MB and
  JPEG/PNG written in this tier is still a policy nobody decided, shown to an
  operator as though somebody had. The capture component takes the server's type
  list as a prop and holds none of its own; neither capture step passes one,
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
