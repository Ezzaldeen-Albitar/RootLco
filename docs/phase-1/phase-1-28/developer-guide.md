# Phase 1-28 — developer guide: appointments and vehicle reception

**Classification:** Confidential — Commercial Product and Pilot Planning

How this surface is built, which gates will refuse your change, and the traps
that cost this phase real time. Read `operator-guide.md` for what the screens do;
this is why they are shaped that way.

Every rule listed below is **enforced**, not merely written down, and the lists
are checked against the gates themselves by
`apps/web/tests/p1-28-guidance-reconciliation.test.ts` and
`npm run validate:p1-28-traceability`. A gate that grows a rule this page does
not describe fails a named case. A test can be deleted in the same commit as the
code it guards; a gate has to be argued with in a diff, and a guide held to the
gate is the only kind worth reading.

---

## Where things live

| what                                   | where                                                                            |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| Route segments                         | `apps/web/src/app/[locale]/(dashboard)/{appointments,receptions}`                |
| Contracts (types, enums, permissions)  | `features/{appointments,receptions}/*contract.ts`                                |
| Adapters (`'use server'`)              | `features/{appointments,receptions}/**/api.ts`                                   |
| Screens (`'use client'`)               | `features/{appointments,receptions}/components/`                                 |
| The wizard registry                    | `features/receptions/check-in/{wizard,steps,evidence,closure}.ts`                |
| Walk-in → check-in handoff             | `features/receptions/intake/intake-handoff.ts`                                   |
| Shared table, print frame, read helper | `components/data-table/`, the shared print document, `lib/api/read-operation.ts` |

P1-28 **composes** P1-27's public modules (`@/components/party`, `@/lib/customers`)
and never imports `features/crm` internals. It composes P1-25/P1-26 design
components and must not create a competing design system.

**The route is the single place `holds(...)` is called.** That sentence used to
be a comment in `check-in/wizard.ts` and nothing enforced it, which meant two of
the access-gate rules were complete only for as long as it stayed true by habit.
It is a rule now — see `route-owns-the-gate` below.

## The four gates, and every rule they enforce

<!-- derived: gates access-rules = 7 --> **7** rules in the access gate,
<!-- derived: gates reachability-classifications = 3 --> **3** write

classifications, one version-sourcing discipline and
<!-- derived: gates marker-kinds = 7 --> **7** derived-marker kinds. Those

numbers come from the gates, not from this sentence.

### `npm run validate:p1-28-access` — least privilege and scope hygiene

Seven rules, and the seventh is the one to notice: the gate's own docblock is
headed "The six rules" and enumerates six. `composed-permission` is enforced and
described nowhere in it, which is why this list is derived from the executable
source rather than copied out of that heading.

- `gate-before-read` — every route page DENIES AND RETURNS on a permission
  before its first awaited read. A capability computed for a control
  (`canManage={holds(…)}`) is not a gate; the gate is a negated `holds` whose
  branch returns.
- `code-published` — every permission code these trees consult is a code some
  published operation registers, read from the P1-24 register. A typo, an
  invented code and a plausible-but-wrong constant all fail here, and all three
  fail toward showing MORE than intended.
- `contract-covers-domain` — the other direction: every permission a published
  `apt.*`/`rec.*` operation registers appears in this phase's contract
  permission maps. A backend code the interface never learned about is a screen
  that will deny for a reason nobody wrote down.
- `least-privilege` — per route, the codes it consults are a SUBSET of the codes
  required by the operations reachable from it, following its own import closure
  plus ONE link level.
- `no-scope-in-a-url` — no scope name may be built into a URL or a query-string
  literal anywhere in these trees, and `tenantId` — a selector on no operation
  anywhere — may not appear at all. This is the half of P1-27's
  `no-client-asserted-scope` whose premise survives here: `rec.*` takes
  `companyId`/`branchId` as a REQUIRED resource selector, so the flat rule is
  false in this domain and the pair travels through one named door,
  `branchTargetQuery`.
- `route-owns-the-gate` — no file inside the P1-28 feature trees calls
  `holds(…)`. A permission consulted below the route is one no route-rooted rule
  can see.
- `composed-permission` — every row of `composed-permissions.json` is verified
  against the migration and the policy statement it cites, and the statement must
  still contain `iam.has_permission('<permission>')`. This is what stops that
  file becoming a place to park a permission a screen wanted for another reason.

### `npm run validate:p1-28-write-reachability` — SEC-004, and INT-113

The canonical write list is **derived from the P1-24 register at check time**,
never written down: it was 14 when the gate landed and is
<!-- derived: reachability total = 43 --> **43** today, and that it moved

without anybody editing a list is the derivation working. Every write is one of
exactly three things:

- `REACHABLE` — a real production mutation call site that something outside its
  own module CONSUMES. **An adapter nobody consumes is not reachability.** The
  whole reception adapter surface landed before its screens, so a write can have
  a call site and still be invocable by nobody.
- `NOT_YET_WIRED` — the frozen day-one allow-list. It only SHRINKS, and an
  allow-listed operation that IS called fails the gate, so the wave that lands a
  screen flips the entry in the same change.
- `DELIBERATELY_ABSENT` — requires a `decisionRef` that RESOLVES against a
  decision heading in `canonical-plan.md` §7. Non-emptiness is not enough: a
  refuter walked `decisionRef: 'FAKE-DECISION-999'` straight through the earlier
  version, and a fabricated reference reads exactly like an approved one.

### `npm run validate:p1-28-version-sourcing` — QA-004

A version-guarded command sends `If-Match` from **a `.recordVersion` the server
stated** (a detail read, or the command response) or **a parameter handed in
from outside**. Everything else fails closed: arithmetic or a numeric literal is
`COMPUTED`, a bare `useState` value is `CACHED`, anything untraceable is
`UNTRACEABLE`.

`sent + 1` is not a conservative guess, it is **wrong half the time**:
`rec.reception-approve` applies ONE edge from `inspecting` and TWO from `opened`
in a single transaction, so only the response or a re-read is right in both
cases. And a component that sends a guarded command must, after it, call one of
its own parameters or something in the refresh family — writing the answer into
local state is what caching the version looks like.

### `npm run validate:p1-28-matrix` and `validate:p1-28-traceability` — DOC-001

The 35-task universe is READ from `canonical-plan.md` §5, not maintained beside
it, and the committed matrix must be byte-identical to a fresh build. Every
number a P1-28 document states about the platform is a `derived:`
marker the traceability gate substitutes the
tree's answer for; an unknown kind, a malformed marker and a name the gate cannot
derive are all failures rather than silent passes. That gate also refuses the
handful of sentences this phase has already had to withdraw once, and requires
every canonical `TC-P1-28-*` id to resolve to quoted cases in comment-stripped
source.

It also RESOLVES the implementation surface of every task. Each path in a
`tasks.*.surface` sentence of `evidence/traceability.json` is repository-relative
(`apps/web/src/...`, not `features/...`), must name a file that exists, and — if
it cites `:LINE` — must name a line that file has and that is not blank. Rename a
component and the record fails in the same commit. That clause used to test the
field for non-emptiness, and seven citations were found naming files that had
been renamed or had never been written; the failure mode of a record is a
citation nobody resolves, not a field nobody fills.

## Traps, in the order they cost time

**A seam is not covered by the suites on either side of it.** The walk-in intake
built `/reception/check-in` — singular — while the wizard is mounted at
`/receptions/check-in`. Both waves were green, both were internally consistent,
and no operator could have reached the second screen. Round-trip the address
itself, in the running application.

**`toFixed(2)` beside `step="0.01"` is a silent wrong write.** A damage-mark
coordinate the operator typed as `0.125` was submitted as `0.13`. The browser
would also have refused it, which is the tell: a formatter in the submit path is
not a display concern.

**Root scripts do not cover `apps/web`.** Run `typecheck` AND `typecheck:web`,
`lint` AND `lint:web`. Root `format:check` structurally cannot see `apps/**` —
each workspace owns its prettier config and the root `.prettierignore` contains
`apps/`.

**`verify:contracts` does not include `verify:inventories`.** Phase inventory
documents embed a global registry count; adding a Backend operation changes
documents in phases you are not working on.

**A source-text sweep cannot tell "calls it" from "explains why it never calls
it".** Every absence sweep in this phase and the last failed first on the
docblock documenting the absence. Strip comments — and then prove the stripper
still sees code, or the sweep silently becomes a scan over empty strings. This
repository has shipped that defect seven times, including once in the
no-fake-data gate during this phase.

**`next dev` compiles a route bundle on first request, and the API's
authenticator is installed as a side effect of composing the IAM module.** So a
development stack answers 401 on an arbitrary subset of authenticated routes and
manufactures product defects that do not exist. **Acceptance runs on
`npm run acceptance:serve`** — a production `next build` plus `next start` —
never on `dev:all`. The launcher refuses to adopt a stack in the other mode
rather than reporting the acceptance environment as up.

**An empty catalogue is not an error and not a bug.** Seven intake catalogues
ship no rows and no screen in this product can add one — that is
`P1-28-OD-001`, an open Owner decision about who administers them, not a defect
to work around. Do not seed a row to make a path green: the no-fake-data policy
forbids it in the product, and inventing rows would answer a different question
from the one that is open.

**`iam.user-list` is not an employee register.** `receiving_employee_id` is NOT
NULL with no foreign key and no defined referent (G-EMP). The screen stores an
identifier and says so; it never shows a raw UUID in place of a name.

## What a new screen owes

Arabic · English · RTL · LTR · desktop · tablet · keyboard · accessibility ·
loading · empty · error · retry · permission-denied · conflict where applicable ·
correlation ID · server-resolved scope · **real API integration** · evidence.

Both a contract/adapter test **and** a `.dom` test, and — for anything an
operator reaches — a case in the authenticated browser tier. Every other tier
mocks the transport.

**Mocks are test fixtures. Mocks are not production-integration evidence.**
