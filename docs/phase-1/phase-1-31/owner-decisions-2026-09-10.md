# P1-31 — the Owner's decisions of 2026-09-10

**Status:** RECORDED · **Authority:** the Owner, 2026-09-10 · **Scope:** the open decisions
**D-7**, **D-11** and **D-12** of [`a0-preflight.md`](./a0-preflight.md), together with two
decisions taken alongside them and recorded here as **D-17** (report timezone) and **D-18**
(identity evidence).

These are NEW decisions taken on 2026-09-10. They are not a restatement of an earlier approval, and
they do not reopen anything recorded in
[`owner-decisions-2026-09-09.md`](./owner-decisions-2026-09-09.md) or in
[`change-control-2026-09-08.md`](./change-control-2026-09-08.md). Each section records what the
Owner decided, the consequences the Owner attached to it, and what it forbids — a decision recorded
only as a permission is the shape that later gets read as a licence.

Nothing here asserts that any gate ran, that any environment exists, or that any of the work below
has been built. It is a record of decisions.

## 1. The delivering employee — D-12 answered, OWR-2026-09-06-G-10 closed

The delivering employee is a **tenant-owned employee identity**, distinct from a login account,
distinct from the authenticated actor who sends the request, and distinct from the authorized
receiver who collects the vehicle. The three are separate roles and no one of them may stand in for
another.

Consequences the Owner attached to that answer:

- An existing suitable personnel entity is **reused** if one can carry the identity; a **minimal new
  schema slice** is defined only if none can. The choice is measured, not assumed.
- The reference and its **organisational assignment are validated on the server**. The browser does
  not decide who is a valid delivering employee, and no caller supplies an unvalidated identifier.
- **Historical attribution is preserved.** What a completed handover recorded stays readable after a
  later rename, transfer, deactivation or soft delete.
- This is **not an HR implementation**. No payroll, no employment lifecycle, no department
  hierarchy, no second source of truth for people.

The measured facts this decision was taken against:

- **No employee master table exists** anywhere in the schema.
- `sal.delivery_records.delivering_employee_id` is `uuid NOT NULL` with **no foreign key**
  (`supabase/migrations/20260724094000_sal_delivery.sql:113`) and **no application validation** —
  the create service passes the supplied identifier through unchecked
  (`apps/api/src/modules/delivery/application/delivery-service.ts:393`). Any uuid at all is
  currently a legal delivering employee.
- The only roster-shaped entity, `tech.technician_profiles`, is anchored to `iam.user_accounts`
  through `fk_technician_profiles_user`, so it **cannot represent a person who has no login**.

What follows from it:

- A **backend prerequisite slice** defines the entity and the validation before the Start control is
  re-enabled. It is not a Frontend edit and it is not improvised by a screen. Lane placement follows
  the P-2..P-11 precedent (`remediation/p1-31-backend-`) unless **D-1** is decided otherwise; D-1 is
  still open ([`a0-preflight.md`](./a0-preflight.md):318) and nothing here settles it.
- The **Start control withheld in PR #362 stays withheld** until that contract exists. Re-enabling it
  before then would put an unvalidated identifier back on the wire, which is the defect the
  withholding exists to prevent (register **CC-25**).

## 2. D-7 — the delivery document is a printable operational view

The delivery document is a **permission-checked printable operational view**, composed on the client
through the print approach the repository already uses: `apps/web/src/components/print/PrintDocument.tsx`,
the print stylesheet `apps/web/src/styles/print/_index.scss`, and the `window.print()` pattern the
invoice screen already follows. No backend print route and no new document operation is authorized
by this answer.

- **Stored immutable document versions remain deferred.** If they are ever wanted they arrive
  through their own contract, deliberately, and not as a side effect of a print view.
- The printable view is **never described as an immutable archive** — not in the interface, not in
  the documentation, not in a commit message. It renders what the server published at the moment it
  was printed, and that is the whole of its claim.
- The view is **permission-checked**: it shows a caller only what the reads they already hold
  publish.

## 3. D-11 — the audit window is settled as it stands

The **seven-day default window** in the web screen and the **92-day maximum** are ratified exactly
as they are implemented, with the current server validation:
`apps/api/src/modules/iam/application/audit-view-service.ts`, `MAX_RANGE_DAYS = 92`, refusing a
wider range with `ERR-VAL-001`.

- The default is **not** widened, and the cap is **not** raised, to make a screen more convenient.
- The **server keeps the authority**: the cap is enforced where it is enforced today, not moved into
  the browser or duplicated there.
- P1-26-OD-007 is settled by this answer and is not carried forward as an open decision into another
  phase.

## 4. D-17 — the reporting period is a half-open period in the branch's timezone

Every report period is **half-open**, `[from, to)`, expressed in the **selected branch's timezone**
(`org.branches.timezone_name`) and converted consistently before it reaches a server query. A report
that says a day includes every instant of that local day and no instant of the next.

- The **timezone and the filter context are displayed and preserved** wherever the result is shown,
  printed or recorded, so a number can never be read without the period that produced it.
- **Cross-branch reporting uses one explicit reporting timezone**, stated on the result. Local
  periods from branches in different timezones are **never silently mixed** into one total.
- A boundary row belongs to exactly one period. No inclusive `to` and no double counting.

Recorded as a named prerequisite for the report engine: **no helper converts a local period to UTC or
computes half-open periods in `apps/api/src` today**. The timezone handling that does exist there is
limited to storing and validating `timezone_name` for branch settings (for example
`apps/api/src/modules/iam/application/organization-administration-service.ts`) and to rendering wire
timestamps in UTC (for example `apps/api/src/server/db/pagination.ts`, which formats an instant).
Neither converts a local calendar period into a query range. That helper has to be written before a
report can honour this decision.

## 5. D-18 — identity evidence uses the approved optional document category

**The decision.** The receiver's identity evidence is supported as an **approved optional
identity-evidence document category**, filed under the **existing scoped file-access rules**.

- Collection is **optional by default**. It becomes **mandatory only under an explicit applicable
  business policy** — stated, scoped and recorded, never inferred from the fact that the field
  exists.
- **No unrelated category may be used to bypass the missing contract.** The seeded reception
  categories are reception categories; filing a person's proof of identity under one of them because
  it happens to be accepted would be a classification defect, and it is forbidden.
- The evidence inherits the **existing scoped access rules** — the same restricted visibility and
  retention posture the category system already enforces. This decision widens nobody's access.

**Measured facts (not part of the decision).** These describe the schema as it stands; the Owner
approved the category and its access posture, not any of the mechanisms below.

- Document categories are seed rows in `shared.document_categories`
  (`supabase/migrations/20260718100000_shared_document_categories_and_documents.sql`).
- The `business_link_purpose` vocabulary lives in
  `supabase/migrations/20260815090000_shared_reception_evidence_foundation.sql:33-36`.
- The only existing row carrying the identity-document purpose is `reception_vin`
  (`supabase/seeds/05_shared_reference.sql:43`), and it is **not** the approved category.
- The receiver identity-evidence category therefore **does not yet exist**, which is consistent with
  **CC-26**.
- The concrete category code, the `business_link_purpose` value it takes, and the seed file it lands
  in are **engineering choices for the implementing slice**, not decisions recorded here.

This is the contract behind **CC-26** in
[`change-control-2026-09-08.md`](./change-control-2026-09-08.md) §38.3: the delivery execution slice
omitted the evidence field precisely because the category did not yet exist, and recorded the gap
rather than filing the document somewhere convenient.
