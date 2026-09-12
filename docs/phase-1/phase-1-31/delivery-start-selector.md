# P1-31 — starting a handover with a validated delivering employee (FE-002)

**Status:** implemented on `feature/p1-31-delivery-start-selector`, in an open pull request ·
**Task:** `P1-31-FE-002` · **Change control:** section 51, **CC-39** (PROVISIONAL — see § 6) ·
**Owner authority:** the Owner, 2026-09-10 ·
**Measured at:** protected `develop` `811e9891353b466b7788e7ca8a7bddee8496de72` (PR #370 merge),
which is this branch's base

This record closes the last withheld control of the delivery execution surface: the **Start** on a
work order that has no handover yet. It was withheld in PR #362 and stayed withheld through four
merges, because the field it had to send named nobody.

**There is no hosted result for this head, and no end-to-end acceptance is claimed.** Every figure
in § 7 was taken locally on this branch. Rule 2 of [`task-matrix.md`](./task-matrix.md) keeps
`end-to-end verified` unreachable until a P1-31 acceptance record exists, and none does.

## 1. The Owner's decision, in the Owner's own words

Quoted verbatim from [`owner-decisions-2026-09-10.md`](./owner-decisions-2026-09-10.md) § 1
("The delivering employee — D-12 answered; answers OWR-2026-09-06-G-10"):

> The delivering employee is a **tenant-owned employee identity**, distinct from a login account,
> distinct from the authenticated actor who sends the request, and distinct from the authorized
> receiver who collects the vehicle. The three are separate roles and no one of them may stand in for
> another.
>
> Consequences the Owner attached to that answer:
>
> - An existing suitable personnel entity is **reused** if one can carry the identity; a **minimal new
>   schema slice** is defined only if none can. The choice is measured, not assumed.
> - The reference and its **organisational assignment are validated on the server**. The browser does
>   not decide who is a valid delivering employee, and no caller supplies an unvalidated identifier.
> - **Historical attribution is preserved.** What a completed handover recorded stays readable after a
>   later rename, transfer, deactivation or soft delete.
> - This is **not an HR implementation**. No payroll, no employment lifecycle, no department
>   hierarchy, no second source of truth for people.

And the clarification the same document records, also verbatim:

> The Owner clarified the answer later on 2026-09-10, in the Owner's own words: an employee's home
> branch must not become a restriction against authorized work in other branches; legacy
> delivering-employee values are validated individually; unmatched identities are never replaced by
> the authenticated actor or a fabricated match; status, reference and branch-policy choices remain
> unresolved until the Owner approves a recommendation.

That decision also carried, in the same section, the sentence this slice answers:

> The **Start control withheld in PR #362 stays withheld** until that contract exists.

The contract exists. Prerequisite **P-17** merged with PR #370, and this slice is the Frontend half
that stands on it.

## 2. Measured facts (not part of the decision)

Read from `apps/api` on the base commit named above. Nothing in this section was decided here.

| fact                                                                                                                                                                                         | where it is                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `org.employee-list` — `GET /api/v1/org/employees`, permission `org.employee.read`, scope `branch`, `companyId` and `branchId` both REQUIRED and the authorization target                     | `apps/api/src/app/api/v1/org/employees/route.ts`                                            |
| its optional parameters are `status`, `cursor` and `limit`, the last bounded by the platform's shared limit rule at 100                                                                      | the same route, and `apps/api/src/server/http/validation.ts`                                |
| the published row carries the identifier, the company, the branch, the display name, an optional login-account reference, an optional employment reference, the state and the record version | `EmployeeView` in `apps/api/src/modules/iam/application/employee-administration-service.ts` |
| the state vocabulary is two values                                                                                                                                                           | `EMPLOYEE_STATUSES` in the same file                                                        |
| `org.employee-detail` — `GET /api/v1/org/employees/{employeeId}`, the SAME read permission; absent, soft-deleted, out of reach and another organisation's all answer alike                   | `apps/api/src/app/api/v1/org/employees/[employeeId]/route.ts`                               |
| reading the register and ADMINISTERING it are two codes, split so that choosing a delivering employee never requires the authority to alter a roster                                         | the list route's own docblock                                                               |
| `sal.delivery-create` — `POST /api/v1/deliveries`, permission `sal.delivery.manage`, strict body of exactly `workOrderId` and `deliveringEmployeeId`                                         | `apps/api/src/app/api/v1/deliveries/route.ts`                                               |
| it is registered idempotent, and the generated client table already marks it, so the transport attaches the retry header without a caller minting one                                        | `apps/web/src/lib/api/idempotent-operations.ts`                                             |
| the 201 view carries `deliveringEmployeeDisplayName`, which may be absent only on a handover recorded before P-17 whose reference resolved to nobody                                         | `DeliveryView` in `apps/api/src/modules/delivery/application/delivery-service.ts`           |
| the create service refuses an unresolvable employee with `ERR-VAL-001` rule `custom`, and a retired one with `ERR-VAL-001` rule `inactive_employee`                                          | `employeeViolation` and `createDelivery` in the same file                                   |
| a second live handover for one work order is `ERR-RES-002`                                                                                                                                   | the same method, mirroring `uq_delivery_records_work_order_active`                          |
| **there is NO branch-mismatch refusal.** The service reads no branch of the employee, the port no longer publishes one, and the foreign key names the organisation and nothing narrower      | the same method's own comment, citing the Owner clarification of 2026-09-10                 |
| the service's own sentence never crosses the wire; a refusal carries the catalogue code and the field-level violation and nothing else                                                       | `problemFor` in `apps/api/src/server/errors/problem.ts`                                     |

## 3. What a user can now do

On a work order with no handover, an operator holding `sal.delivery.manage` and `org.employee.read`
is shown who may hand the vehicle over, chooses one of them, and starts the handover. The screen then
names the person the SERVER recorded and links to the handover it created.

The delivery screen and the printable sheet now show that person's name where they printed a bare
reference before.

## 4. Engineering consequence (not an Owner decision)

Every choice below is this slice's, not the Owner's.

1. **The employee mirror lives in the delivery feature.** `employee-contract.ts` and
   `employee-api.ts` under `apps/web/src/features/delivery/` carry the two reads and nothing else.
   The register's two administration commands are not mirrored: no screen of this phase administers a
   roster, and a mirror row for an operation nothing calls is the dead declaration this phase has
   repeatedly shipped.
2. **Three authorities, three separate decisions.** `sal.delivery.view` decides whether the handover
   section is drawn and read at all; `sal.delivery.manage` decides whether the Start form is drawn;
   `org.employee.read` decides whether the register may be offered. The third is resolved on the
   route page and threaded down, so a caller without it issues NO register read — asking and being
   refused would put a denial in the backend's log for a decision the screen could make.
3. **Without the register read the form is not offered at all**, and no reference field is offered in
   its place. An identifier typed into a box is exactly the unvalidated input the withholding existed
   to prevent.
4. **The form is ABSENT, not disabled**, for a caller who may not open a handover.
5. **Only the assignable state is asked for.** The list is requested with that state rather than
   filtered after it arrives, because filtering a page on this side would silently shorten it and hide
   the rows beyond it.
6. **The branch default, and why it is a default and not a filter.** The register is read for the work
   order's own branch first — that is where the colleague usually stands — and the operator may name
   another branch of the same company and read that one instead. This follows the Owner's
   clarification literally: the server applies no branch rule, so a picker that could only ever show
   one branch would re-impose in a browser the restriction the Owner removed from the database. The
   selection is cleared when the branch changes, so a value left behind from the previous set cannot be
   submitted under a name no longer on screen.
7. **The other branch is named by REFERENCE, not picked from a list, and that is a limitation rather
   than a design.** This slice consumes no branch directory read and does not invent one: adding
   `org.branch-list` here would add a fourth authority to a form whose subject is the employee, and
   the Owner's decision names no branch picker. **Follow-up, not claimed as done:** offer the
   company's branches as a list, gated on `org.branch.read`, with the reference field as the fallback
   the inventory screens already use. Recorded as **CC-39(a)**.
8. **Both refusals of one code are worded apart, from the server's own violation.** `ERR-VAL-001`
   carries two causes here and the problem document's first violation is the only machine-readable
   discriminator. They lead an operator to different actions — name somebody else, or have the person
   brought back — so the write state carries the rule beside the code, exactly as the plan
   administration surface does for its own three-cause code (**CC-36**). No sentence is invented per
   code beyond the four the backend genuinely distinguishes; everything else keeps the product's
   shared wording.
9. **Nothing is retried silently.** A refused start is reported and the form does not re-send. No
   retry header is minted by the adapter: the operation is registered idempotent and the transport
   reads that from the published contract.
10. **The name shown after success is the server's stamp**, not the text the picker displayed. The
    two are the same today and the authority is not: a completed handover is attributed from the
    stored snapshot, which is what "historical attribution is preserved" means in practice.
11. **Two docblocks were corrected because they asserted a rule the repository no longer matches.**
    `apps/web/src/lib/contracts/delivery-contract.ts` and
    `apps/web/src/features/delivery/delivery-contract.ts` both stated that the delivering employee
    reference had no foreign key anywhere in the platform. That was true when written and stopped
    being true with P-17. The retraction is stated in place rather than quietly reverted, which is the
    treatment this repository already gives the same class of defect in `lib/api/client.ts`.
12. **`readEmployee` has no production consumer at this head.** It is published because the
    register's detail read is the pair of the list this feature consumes, and it is said out loud in
    its own docblock rather than left to be inferred from its test count. **Follow-up, not claimed as
    done:** resolve the person named on a handover recorded before the register existed — those rows
    carry a reference and no stored name, and the screens show the reference. Recorded as
    **CC-39(b)**.
13. **The access gate now owns one more segment.** Adding the two employee reads to
    `P1_31_OPERATION_IDS` derives a new resource root, `org`, which no dashboard area is named for
    today. The page count did not move, because the form lives on the work-order detail page the gate
    already examined. Both pins in `tests/ci/p1-31-access-gate.test.ts` were re-based from the gate's
    own report line on this head.

## 5. What this slice did NOT do

- **No backend file changed.** No operation, permission, migration, seed, audit action or generated
  register moved. The four operations P-17 published are unchanged, and the two it publishes for
  administering the register are not consumed.
- **No roster administration surface exists.** Nothing here adds, renames, retires or reinstates an
  employee, and no screen of this phase can.
- **No login account, employment record, department, contact detail or role is read.** The employment
  reference is displayed as the opaque reference it is and is never resolved.
- **No branch directory read was added**, and no branch list is offered — see § 4 item 7.
- **No legacy handover was repaired.** A row recorded before P-17 whose reference resolved to nobody
  still carries no name, and the screens show the reference rather than inventing a person. The
  review list P-17 created is the Owner's, and this slice ships no resolution command for it.
- **No figure, amount or arithmetic crosses this tier**, as with every other delivery surface.
- **No gate was weakened, no allow-list narrowed, no suppression added and no floor moved.** The one
  gate edit widens a rule's reach, and the committed test-count baseline is untouched.
- **No hosted run, no database tier, no browser acceptance and no end-to-end result is claimed.**

## 6. Identifier allocation — PROVISIONAL, read from the register on this base

Read from [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) as `develop`
`811e9891` holds it. The register runs to **section 50** and to **CC-38**, both settled by the report
screens slice (PR #371, merged at `46be4bb2`).

| identifier | slice                                           | state on this base                       |
| ---------- | ----------------------------------------------- | ---------------------------------------- |
| **CC-36**  | the warranty plan administration screens (#375) | merged, section 48                       |
| **CC-37**  | a lane not on this head                         | claims **section 49**                    |
| **CC-38**  | the report screens (#371)                       | merged, section 50                       |
| **CC-39**  | this slice                                      | **PROVISIONAL**, this branch, section 51 |

So this slice takes **section 51** and **CC-39**. Both are marked PROVISIONAL for one reason and one
only: **section 49 and CC-37 are a LOWER pair still held by a lane that has not merged**, named in
section 50.1 of the register as "a lane not on this head". If that lane lands under a different
number, or if section 51 or CC-39 is found taken at merge time, this slice's heading and identifier
move and the register's § 48.1 rule applies — an identifier is a claim about the register at the
moment it was raised and is never renumbered to follow heading order.

## 7. Proof — every figure local, taken on this branch

Commands were run from the repository root at `C:/Users/Ezzaldeen/wt-p9`. The web and root tiers were
recorded through the P1-27 recorder against the committed head of this branch.

| command                                                         | result                                                     |
| --------------------------------------------------------------- | ---------------------------------------------------------- |
| `npm run typecheck`                                             | exit 0                                                     |
| `npm run typecheck:web`                                         | exit 0                                                     |
| `npm run lint`                                                  | exit 0                                                     |
| `npm run lint:web`                                              | 0 errors; 12 pre-existing warnings, none in a touched file |
| `npm run format:check` and `npm run format:check:web`           | exit 0                                                     |
| `npm run style:check`                                           | exit 0                                                     |
| `npm run validate:p1-31-access`                                 | 15 route pages across 9 owned segments, 0 violations       |
| `npm run validate:p1-24-register`                               | register current and reconciled                            |
| `npm run validate:module-boundaries`                            | 11 rules, 0 violations                                     |
| `npm run validate:web-boundary`                                 | 372 files inspected, 0 violations                          |
| `npm run validate:web-topology`                                 | 18 expectations, 0 failures                                |
| `npm run validate:web-theme`                                    | 372 files, 54 colours registered, 0 unresolvable           |
| `npm run validate:web-tokens` · `validate:web-brand`            | 0 raw values · 0 violations                                |
| `npm run validate:notification-authority`                       | one authority, mounted once, 0 failures                    |
| `npm run validate:use-server-exports`                           | 51 server modules, 0 violations                            |
| `npm run validate:plain-language`                               | 2 catalogues, 24 rules, 0 findings                         |
| `npm run validate:command-coverage`                             | every required command reachable                           |
| `npm run validate:generated-artifacts` · `validate:encoding`    | 0 failures · clean UTF-8, no byte-order mark               |
| `npm run security:all`                                          | five guards, 0 findings                                    |
| focused web — the four delivery suites                          | 169/169 across 4 files                                     |
| root — `npx vitest run tests/ci tests/openapi-contract.test.ts` | see § 7.1                                                  |
| the web tier, through the P1-27 recorder                        | see § 7.1                                                  |
| `npm run test:unit`, through the P1-27 recorder                 | see § 7.1                                                  |
| `npm run verify:policies`                                       | see § 7.1                                                  |
| `npm run validate:phase-ownership`, both forms                  | see § 7.1                                                  |

### 7.1 The recorded tiers

The measured totals live in `docs/phase-1/phase-1-27/evidence/local-run-ledger.json`, written only by
`check-p1-27-closing-values.mjs --record`, carrying the commit each tier was taken at. They are not
restated here, because a hand-copied total beside a recorded one is the disagreement the P1-27
closing-value gate exists to catch. The derived sites that quote them —
`clean-room-evidence.md` and `deliverable-manifest.md` — were moved from the ledger in the same
change, and `npm run validate:p1-27-closing-values` is what proves the two agree.

Adding one web test file moved the tree's web test-file count by one, which cascaded to five derived
sites across two documents and the closing-value ledger. All five were moved by measurement, not by
arithmetic on the previous figure.

**There was no hosted gate, no run against any database, no browser tier and no merge.**

## 8. Where this leaves FE-002 and its neighbours

- **FE-002** is no longer partial in the way it was: the release control already used the server's
  eligibility, and the missing half was the Start. It is `in open PR` in the vocabulary of
  [`task-matrix.md`](./task-matrix.md), which is a claim about a branch and not about `develop`.
- **FE-001 … FE-006** were each recorded as `implemented/unmerged` against PR #362, and #362 merged at
  `78d34fbc`. Those rows were corrected by measurement in the same change as this record; the
  correction is a measurement of `develop`, not a new claim about this branch.
- **D-12** is answered and **OWR-2026-09-06-G-10** is answered with it. The register-row update the
  Owner document is owed remains owed: `docs/product/owner-workflow-requirements.md` still records
  G-10 as `Undecided`, and changing an Owner document is the Owner's, not this slice's.
- **P1-31 acceptance** is unaffected. Nothing here is end-to-end verified.
