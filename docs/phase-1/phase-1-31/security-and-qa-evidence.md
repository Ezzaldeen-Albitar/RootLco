# P1-31 — security, QA, DevOps and documentation evidence (SEC-001 … SEC-004, QA-001 … QA-005, DO-001, DO-002, DOC-001, DOC-002)

**Status:** OPEN, third version · **Measured at:** protected `develop`
`81b3bce804626353a1a7b9f4ba52f1306c8f8b6e` (PR #380 merge) · **Companion records:**
[`task-matrix.md`](./task-matrix.md) (state per task), [`a0-preflight.md`](./a0-preflight.md)
(readiness), [`acceptance-record.md`](./acceptance-record.md) (the fresh-organisation acceptance),
[`change-control-2026-09-08.md`](./change-control-2026-09-08.md) (dispositions),
[`canonical-plan.md`](./canonical-plan.md) (the chapter's own task tables)

**Measured at an ancestor of `develop`, deliberately, and here is the difference.** This version was
measured at `81b3bce8` and is integrated onto `develop` `d517a5fc`, which is `81b3bce8` plus
**#381** — the pull request that added [`closure-record.md`](./closure-record.md) and took the change
register's **section 55 and CC-45**. This file is **not** re-derived at `d517a5fc`: every figure
below names the head it was read on, and **rule 5** below is that a figure is re-measured or
corrected in place, never silently re-based onto a head nobody counted it at. Two of them move at
the newer head and are named here so that no reader has to find them, and the passages that carry
them are left standing as measured, exactly as § 14 leaves its own superseded allocation standing.
**The directory count.** `docs/phase-1/phase-1-31/` holds **32** files at `d517a5fc` rather than the
**31** counted in § 9 and § 12, the one addition being `closure-record.md`; § 12's breakdown becomes
**20 per-slice records and 12 phase-level ones**, `closure-record.md` being the twelfth beside the
preflight, the canonical plan, the change register, the task matrix, this file, the acceptance plan
and record, the three Owner-decision records and `d4-report-definitions.md`. § 9's other figure is
unchanged: `closure-record.md` does not carry "acceptance" in its name, so **two** files still do.
**The register.** Its highest pair at `d517a5fc` is **section 55 with CC-45** rather than the **54
with CC-44** counted in § 13 — which is why § 15 takes section 56 and CC-46, and why that allocation
is unaffected. Nothing else here is touched by #381: it moves no state, adds no test, publishes no
operation and changes no gate. The next version re-measures the whole file at whatever head it is
written on.

The second version was measured at `develop` `9b109f63` (PR #377 merge) and **two pull requests have
merged since, both of which this file was factually wrong about**: **#378** at `6005cfa4`, which put
the acceptance harness outside this repository and committed the four browser specs, and **#380** at
`81b3bce8`, which committed [`acceptance-record.md`](./acceptance-record.md). The second version's
§ 9 stated that no P1-31 acceptance record exists and that no P1-31 acceptance run had
happened; one exists and two passes of the journey have run. **This version
re-measures the whole file at `81b3bce8`** and every figure below was re-derived on that tree, by
running the named checker or by parsing the named file — with two classes of exception, both stated
where they appear: the figures § 11 quotes from the **external** operator artefact, which is not in
this repository and cannot be re-derived here, and the run results quoted from
[`acceptance-record.md`](./acceptance-record.md), which are that record’s measurement and are cited
by line rather than re-taken. Nothing is carried forward from the second
version without re-measurement, and where a figure did not reproduce it is corrected in place rather
than restated (§ 5).

## Why this record transposes its definitions

The P1-31 chapter names these thirteen tasks and defines none of them. Each of the four chains
carries one boilerplate description repeated across every row of its table, with no per-task
obligation and no per-task test id that resolves:

> **Security, all four** (`canonical-plan.md:254-256`): "Complete and evidence `<task name>` under
> the Phase 1 engineering and governance standards."

> **QA, all five** (`canonical-plan.md:269-272`): "Design and automate `<task name>` with positive,
> negative, isolation, failure, and recovery coverage appropriate to the affected workflow."

> **DevOps, both** (`canonical-plan.md:286-289`): "Prepare and automate `<task name>` with
> environment segregation, least privilege, observable execution, rollback criteria, and a recorded
> operator runbook."

> **Documentation, both** (`canonical-plan.md:305-308`): "Produce the controlled record for
> `<task name>`, link all supporting evidence, identify unresolved limitations, and route the result
> to the named approval owner."

Every one of the thirteen rows additionally cites `TC-WTY-001`, `TC-RPT-001` or `TC-QMS-001`.
**None of those three exists in this repository** — the A0 preflight measured all five cited test
ids returning zero files and filed the mismatch as **D-16** (`a0-preflight.md:405-411`), whose
recorded wording is that "all five return zero files from the repository, and the testing-plan
document Field 9 names does not exist here", with the related convention question being that
Field 27 and Field 34 require an `_acceptance/` directory "which does not exist, while this
repository's convention is `docs/phase-1/phase-1-NN/*acceptance*.md`". So no row here can be closed
by satisfying its own Test reference.

This record therefore does what P1-30 W8 did
([`../phase-1-30/w8-security-and-qa-evidence.md`](../phase-1-30/w8-security-and-qa-evidence.md)):
it **transposes the operational definitions from P1-28**
(`docs/phase-1/phase-1-28/canonical-plan.md:172-212`), the only in-repository precedent that states
what each id means, onto P1-31's surface — and says so rather than presenting the transposition as
the chapter's own words. Where the P1-31 chapter's task NAME diverges from the P1-28 definition, the
section below states both and measures both.

## Five rules this record obeys

1. **`task-matrix.md` owns the state.** This file adds the proving artefact; it does not move a
   state. Where a measurement here would support a different state than the matrix carries, that is
   written as an engineering assessment and the matrix row is left alone.
2. **Nothing here reaches `end-to-end verified`, and the reason has changed.** An acceptance record
   now exists — [`acceptance-record.md`](./acceptance-record.md), § 9 — so the first half of the
   matrix's rule is satisfied. The second half is not: `task-matrix.md` rule 2 admits that state only
   for a task the record itself establishes against a running environment, and **documentary evidence
   alone never earns it**. The record moved twelve rows, all of them Frontend (`FE-*`), and its § 6
   and § 7.1 name every one. **It moves no row in this file**, because nothing it did was a
   phase-level review of a security or QA task. The state vocabulary used below is the matrix's own
   (`task-matrix.md:26-37`).
3. **Every non-Owner statement is labelled.** **Measured fact** means read off this tree with the
   path given; **engineering assessment** means a judgement by this record's author, binding on
   nobody. No Owner decision is quoted beyond the ones named with their file and line.
4. **No tier was run for this record, and no run is claimed as its own.** Test case counts are `it(`
   / `test(` call sites **counted statically** in the named file. Where a file uses `it.each`, the
   static count is a **floor**, not the executed total, and the section says so. The static checkers
   named below were executed on this head and their report lines are quoted as they printed. Every
   run result — every step, case and refusal — is **quoted from
   [`acceptance-record.md`](./acceptance-record.md) with the section it is stated in**, is that
   record's measurement and not this one's, and is never restated as though this file had observed
   it. **No hosted run is claimed anywhere in this file.**
5. **A figure is re-measured or corrected in place, never re-based.** This record states the head it
   was measured at, and every figure below names the head it was read on. When `develop` moves past
   that head, no figure is silently re-attributed to the newer one. Only two answers are open: the
   whole file is re-measured at the newer head and says so, or the measurement head is left standing
   and every figure that moves is named explicitly, with what it becomes and why. The header does
   the second for `d517a5fc`; the second version's own supersession (§ 9, § 12, § 14) is the
   precedent for both.

## Index

| item    | transposed definition (P1-28, onto P1-31)                                                 | section | state at `81b3bce8`        |
| ------- | ----------------------------------------------------------------------------------------- | ------- | -------------------------- |
| SEC-001 | least-privilege permission and resolved-scope enforcement on every P1-31 read and write   | § 1     | phase-level incomplete     |
| SEC-002 | the sensitive splits, the export posture and file access                                  | § 2     | phase-level incomplete     |
| SEC-003 | scope hygiene and abuse cases: no client-asserted scope, cross-tenant, privilege widening | § 3     | phase-level incomplete     |
| SEC-004 | the write-shape gate, and the audit-event coverage the chapter's name asks for            | § 4     | not started (matrix)       |
| QA-001  | contract-mirror unit and component coverage                                               | § 5     | phase-level incomplete     |
| QA-002  | API contract, error-path and replay-shape coverage                                        | § 6     | phase-level incomplete     |
| QA-003  | tenant / company / branch isolation                                                       | § 7     | phase-level incomplete     |
| QA-004  | concurrency, idempotency and record-version sourcing                                      | § 8     | not started (matrix)       |
| QA-005  | regression and immutable evidence packaging                                               | § 9     | phase-level incomplete     |
| DO-001  | continuous-integration quality gate and gate-metadata co-maintenance                      | § 10    | merged (read-only/partial) |
| DO-002  | structured logging, monitoring and pipeline wiring                                        | § 11    | not started (matrix)       |
| DOC-001 | contract, catalog and traceability synchronisation                                        | § 12    | not started (matrix)       |
| DOC-002 | operator / developer guidance and the change record                                       | § 13    | not started (matrix)       |

## The surface every section below measures

**Measured fact.** The phase's own route surface is **45 operations across 33 `route.ts` files in
eight namespaces** — `deliveries` (9 files, 13 operations), `delivery-checklist-templates` (5, 8),
`delivery-readiness` (1, 1), `report-configurations` (5, 7), `reports` (3, 3), `warranties` (2, 2),
`warranty-policies` (5, 7) and `org/employees` (3, 4), all under `apps/api/src/app/api/v1/`. Of the
45: **24 writes and 21 reads; 24 `auditClass: 'privileged'` and 21 `auditClass: 'none'`; 11
`versionGuarded: true`; 16 `idempotent: true`; 12 distinct permission codes** —
`org.employee.manage`, `org.employee.read`, `rpt.report.configure`, `rpt.report.read`,
`sal.delivery.complete`, `sal.delivery.manage`, `sal.delivery.view`, `sal.finance.view`,
`wo.work_order.read`, `wty.policy.manage`, `wty.warranty.issue`, `wty.warranty.read`. Every
derivation below is the gate's or the file's own; these totals are a static parse of the
`defineOperation` literals and are restated nowhere else. **All of them were re-derived at
`81b3bce8`** and every one reproduced; which code gates which operation, and which catalogue row each
code resolves to, is § 1.1.

## 1. SEC-001 — least privilege and resolved scope

**Transposed definition.** P1-28 SEC-001 is "least-privilege permission and resolved-scope
enforcement" — a role-to-code grant mapping, an account that holds it, a read-only negative control,
a cross-tenant negative control, and an explicit disposition for any code the mapping overloads.
The P1-31 chapter's name, "Permission and resolved-scope enforcement", is the same obligation
without the word "least-privilege"; this record keeps the P1-28 reading.

**Starting state (A0, `a0-preflight.md:71`).** "**Unscopable from the chapter** — it names no
permission code — and gated on two decisions: which codes gate the new reads (D-9) and whether the
provisioning bundle is widened (D-2). The scope mechanism itself exists and is documented as the one
the P1-31 read seams inherit."

**Evidence on develop at `81b3bce8`.**

- **Measured fact.** `npm run validate:p1-31-access` (`scripts/ci/check-p1-31-access.mjs`), run on
  this tree: **16 route pages examined across 9 owned segments** — `deliveries`, `delivery`,
  `delivery-readiness`, `org`, `reports`, `warranties`, `warranty`, `warranty-policies`,
  `work-orders` — **0 violations**. The gate's registered property
  (`scripts/ci/check-command-coverage.mjs:442-456`) is that every P1-31 route page denies and
  returns on a permission before its first awaited read.
- **Measured fact.** `scripts/ci/check-permission-parity.mjs`, run on this tree: **121 catalogue
  codes; 319 route files, 411 operations, 468 references over 114 distinct codes (40 from
  navigation); 1 declared dynamic site**, and the catalogue cross-check matches the pinned
  `permissionCount`. Its REPORT section — which is not a failure — names **7 catalogue codes no
  executable reference uses**, three of them recorded as enforced in the database instead. None of
  the seven is a P1-31 code, and none is claimed closed here.
- **Measured fact.** The grant mapping is `apps/api/src/modules/iam/domain/bootstrap-roles.ts`:
  `TENANT_ADMINISTRATOR_ROLE.permissionCodes` declares **78 codes**, counted statically, including
  all twelve on this surface except `sal.delivery.complete`'s companions already present and
  excluding `rpt.export` by decision (§ 2). Its shipped proofs are
  `tests/backend/p1-31-provisioning-bundle.test.ts` (**8 cases**) and
  `tests/backend/p1-31-tenant-administrator-bundle-backfill.test.ts` (**12 cases**), both counted
  statically; the first asserts the delta is exactly the declared additions and that nothing else
  moved.
- **Measured fact.** The per-seam permission proofs are the fifteen `tests/backend/p1-31-*.test.ts`
  suites on this tree — **350 cases counted statically**, one `it.each` table in the whole set
  (`p1-31-report-engine-work-orders.test.ts`), so 350 is a floor:

  | file (`tests/backend/`)                              | cases |
  | ---------------------------------------------------- | ----- |
  | `p1-31-delivery-read-seam.test.ts`                   | 26    |
  | `p1-31-delivery-list-seam.test.ts`                   | 17    |
  | `p1-31-delivery-readiness-seam.test.ts`              | 25    |
  | `p1-31-delivery-checklist-template-seam.test.ts`     | 28    |
  | `p1-31-warranty-read-seam.test.ts`                   | 23    |
  | `p1-31-warranty-policy-seam.test.ts`                 | 31    |
  | `p1-31-report-configuration-seam.test.ts`            | 29    |
  | `p1-31-report-engine-work-orders.test.ts`            | 28    |
  | `p1-31-report-engine-technician-labor.test.ts`       | 25    |
  | `p1-31-report-engine-inventory-movements.test.ts`    | 25    |
  | `p1-31-report-engine-invoice-payment.test.ts`        | 31    |
  | `p1-31-delivering-employee-seam.test.ts`             | 31    |
  | `p1-31-delivering-employee-backfill.test.ts`         | 11    |
  | `p1-31-provisioning-bundle.test.ts`                  | 8     |
  | `p1-31-tenant-administrator-bundle-backfill.test.ts` | 12    |

- **Measured fact.** Resolved scope is declared on the route rather than asserted by a caller. The
  three-code declarations are `delivery-readiness/route.ts` (`sal.delivery.view`,
  `wo.work_order.read`, `sal.finance.view`) and `deliveries/[deliveryId]/completion/route.ts`
  (`sal.delivery.complete`, `sal.delivery.view`, `sal.finance.view`); `eligibility/route.ts`
  declares two. Each sits above a docblock stating why the finance code is required rather than
  optional. The readiness seam's proof shape is recorded in
  `change-control-2026-09-08.md` § 39 row **D3-5**: the three declared permissions proved necessary
  and sufficient from four sides, with `sal.finance.view` refused at the operation rather than
  answered with a softened fact.
- **Measured fact.** `org.employee.read` and `org.employee.manage` were minted by P-17 (#370) and
  gate the four `org/employees` operations two apiece; both are declared in
  `supabase/seeds/04_iam_permission_catalog.sql` and both are in the 78-code bundle.

### 1.1 The phase-level reconciliation: code x operation x catalogue row

The second version's first open item was that **"no single record reconciles the twelve codes against
the catalogue as a phase-level statement"**. This subsection is that statement.

**How it was derived, so it can be re-derived.** `scripts/ci/check-permission-parity.mjs` exports
`declaredPermissions(sourceFile)`, which reads the `permissions` array of a **parsed**
`defineOperation` object literal and nothing else (`check-permission-parity.mjs:350-397`), and
`catalogueCodes(sql)`, which reads the first string literal of every top-level tuple of the
`INSERT INTO iam.permissions` statement in `supabase/seeds/04_iam_permission_catalog.sql`
(`check-permission-parity.mjs:233-299`). Both were applied on this head to the 33 `route.ts` files in
the eight owned namespaces. The gate itself asserts input FLOORS — that every executable reference
resolves to a catalogue row or to its open-debt register — which proves **no P1-31 code is
fictitious**; it publishes no per-phase breakdown, which is why this table exists rather than being
quoted from the gate's output.

**Measured fact.** 33 `route.ts` files, **45 `defineOperation` sites carrying 45 distinct operation
ids**, **52 permission references over 12 distinct codes**, and **every one of the 12 resolves to
exactly one row of the 121-code catalogue**. Every operation declares at least one code; none
declares a code the catalogue does not carry; none is `public: true`.

| permission code         | ops | the operations that require it                                                                                                                                                                                                                                                               | catalogue row                       | in the 78-code bundle |
| ----------------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | --------------------- |
| `org.employee.manage`   | 2   | `org.employee-create`, `org.employee-status-set`                                                                                                                                                                                                                                             | `04_iam_permission_catalog.sql:39`  | yes                   |
| `org.employee.read`     | 2   | `org.employee-detail`, `org.employee-list`                                                                                                                                                                                                                                                   | `04_iam_permission_catalog.sql:38`  | yes                   |
| `rpt.report.configure`  | 7   | `rpt.report-configuration-create`, `-list`, `-read`, `-status-set`, `-update`, `-version-create`, `-version-publish`                                                                                                                                                                         | `04_iam_permission_catalog.sql:114` | yes                   |
| `rpt.report.read`       | 3   | `rpt.report-catalogue`, `rpt.report-read`, `rpt.report-run`                                                                                                                                                                                                                                  | `04_iam_permission_catalog.sql:338` | yes                   |
| `sal.delivery.complete` | 1   | `sal.delivery-complete`                                                                                                                                                                                                                                                                      | `04_iam_permission_catalog.sql:87`  | yes                   |
| `sal.delivery.manage`   | 10  | `sal.delivery-create`, `-receiver-verify`, `-signature-attach`, `-checklist-record`, `sal.delivery-checklist-template-create`, `-item-create`, `-item-remove`, `-item-update`, `-rename`, `-status-set`                                                                                      | `04_iam_permission_catalog.sql:86`  | yes                   |
| `sal.delivery.view`     | 13  | `sal.delivery-read`, `-list`, `-readiness-list`, `-eligibility-read`, `-status-history`, `-receiver-read`, `-receiver-verify`, `-signature-attach`, `-signature-list`, `-checklist-result-list`, `-complete`, `sal.delivery-checklist-template-list`, `sal.delivery-checklist-template-read` | `04_iam_permission_catalog.sql:88`  | yes                   |
| `sal.finance.view`      | 3   | `sal.delivery-readiness-list`, `sal.delivery-eligibility-read`, `sal.delivery-complete`                                                                                                                                                                                                      | `04_iam_permission_catalog.sql:84`  | yes                   |
| `wo.work_order.read`    | 1   | `sal.delivery-readiness-list`                                                                                                                                                                                                                                                                | `04_iam_permission_catalog.sql:237` | yes                   |
| `wty.policy.manage`     | 5   | `wty.warranty-policy-create`, `-rename`, `-status-set`, `wty.warranty-coverage-create`, `wty.warranty-coverage-status-set`                                                                                                                                                                   | `04_iam_permission_catalog.sql:90`  | yes                   |
| `wty.warranty.issue`    | 1   | `wty.warranty-generate`                                                                                                                                                                                                                                                                      | `04_iam_permission_catalog.sql:91`  | yes                   |
| `wty.warranty.read`     | 4   | `wty.warranty-detail`, `wty.warranty-list`, `wty.warranty-policy-list`, `wty.warranty-policy-read`                                                                                                                                                                                           | `04_iam_permission_catalog.sql:112` | yes                   |

**What the rightmost column is, and what it is not.** It is a static read of
`TENANT_ADMINISTRATOR_ROLE.permissionCodes` in `bootstrap-roles.ts` — **78 codes, all twelve of the
above among them, and `rpt.export` deliberately not** (§ 2). It says a freshly provisioned
organisation's first administrator is granted the code; it says nothing about any other role, and
nothing about whether the grant was ever exercised. Only two sources of that kind exist and both are
named rather than assumed: the acceptance record's steps 15–16, where a first administrator's session
answered **78** permissions (`acceptance-record.md:104-105`), and the same record's steps 174–176,
where a person holding `sal.delivery.view`, `wo.work_order.read` and `rpt.report.read` but **not**
`sal.finance.view` was refused the readiness queue and the invoice-and-payment report and served the
work-order report (`acceptance-record.md:263-265`).

**What this reconciliation does NOT establish.** That the twelve are the RIGHT twelve. It is a
mapping, not a review: no artefact on this tree argues that `sal.delivery.view` should gate thirteen
operations rather than some other number, or that the three-code readiness declaration is minimal.
The one seam where that argument was made and recorded is the readiness queue (register § 39,
**D3-5**), and it covers one operation of forty-five.

**State.** `phase-level incomplete` — the matrix's value, unchanged. **Engineering assessment:** the
proofs above are per-seam and per-operation; § 1.1 now reconciles the codes as a set, but a
reconciliation is a mapping and not the least-privilege review the transposed definition asks for,
and no artefact on this tree measures enforcement across all 45 operations as a set. Rule 2 forbids
any higher state regardless.

**Open items.**

- **D-9** (which codes gate the new reads) is answered per seam by the merged slices, and § 1.1
  states the answer as a phase-level mapping. What is still owed is the JUDGEMENT — that each of the
  twelve is the least code that would do — which § 1.1 explicitly does not make.
- The permission-parity REPORT's seven unreferenced catalogue codes are outside this phase and are
  neither closed nor re-filed here.

## 2. SEC-002 — the sensitive splits, export and file access

**Transposed definition.** P1-28 SEC-002 is the sensitive-narrative control: a restricted field
renders only under its own code, and a dual-permission refusal surfaces as a permissions message
rather than a crash. P1-31's chapter name adds two halves the P1-28 row did not have — export and
file access.

**Starting state (A0, `a0-preflight.md:72`).** "**Half measurable.** The file-access half is
measurable today (attachment acceptance is image-only; downloads are gated on acceptance). The
export half has no contract at all: the export resource registry admits no P1-31 resource and the
authorization operation produces no file."

**Evidence on develop at `81b3bce8`.**

- **Measured fact — the money split.** `sal.finance.view` is declared by three operations on this
  surface and by no other: `sal.delivery-readiness-list`, `sal.delivery-eligibility-read` and
  `sal.delivery-complete`. On the invoice surface the split is finer and unchanged:
  `invoices/[invoiceId]/outstanding/route.ts` declares `sal.finance.view` alone, above a docblock
  stating that the invoice header is readable without it and the balance is not.
- **Measured fact — money is never recomputed on the way to a screen.**
  `npm run validate:exact-money` (`scripts/ci/check-exact-money.mjs`) audits **61 files across 13
  declared trees** under rules MONEY-01 … MONEY-06 and reports no forbidden numeric construct.
  `apps/api/src/modules/reporting` is now one of those declared trees — added by the fourth report
  dataset slice with the comment that the report engine publishes invoice, receipt, allocation and
  outstanding amounts, so the module that assembles them is on the surface this gate defends. Nine
  TypeScript files live under that tree. **Measured fact:** the gate is registered
  `tier: 'required'` at `scripts/ci/check-command-coverage.mjs:127` and is a member of
  `verify:contracts`, **not** of `verify:policies`.
- **Measured fact — export.** `apps/api/src/modules/shared-services/domain/export-policy.ts`
  registers exactly **three** exportable resources — `documents`, `outbound_messages`, `branches` —
  and `EXPORT_PERMISSION` is `rpt.export`. **No P1-31 delivery, warranty or reporting resource is
  registered**, so A0's reading holds unchanged on this head.
- **Owner decision, quoted.** **D-6** (`owner-decisions-2026-09-09.md:89-100`) settles the posture:
  the shipped Audit Log screen is reused for FE-015, and separately P-12's approved report-export
  contract is completed "with explicit authorization and explicit auditability". The decision
  records three things the reuse does NOT authorise — adding an export capability to the audit
  route, granting export to every administrator, and any implicit scope; "any scope in which audit
  data may be exported stays **explicit** — named, granted deliberately, and recorded."
- **Measured fact — the withholding.** `rpt.export` is deliberately excluded from the provisioning
  bundle, recorded as **CC-04** in `change-control-2026-09-08.md` § 2: it qualifies on the carry
  rule and is withheld anyway by Owner decision. The exclusion is restated in
  `bootstrap-roles.ts` and holds at 78 codes.
- **Measured fact — file access.**
  `apps/api/src/modules/shared-services/application/attachment-service.ts` holds
  `DECODABLE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp']`, and a download of a
  version that is not `accepted` is refused with `ERR-DOC-001`. The delivery signature panel
  (`apps/web/src/features/delivery/components/SignaturesPanel.tsx`) consumes that contract and does
  not read a document back.
- **Measured fact — the printable half of D-7 shipped without a stored file.** FE-007 merged as
  #368: `apps/web/src/features/delivery/components/DeliveryDocument.tsx` and
  `DeliveryDocumentPanel.tsx` render a permission-checked print view on the delivery screen, and
  `apps/web/tests/delivery-document.dom.test.tsx` carries **14 cases, counted statically**. No
  document version is created by it, so the stored-file half of SEC-002 still has no P1-31 producer.

### 2.1 The export half is CLOSED BY DISPOSITION; the file-access half is not

**The export half: closed by disposition, and the disposition is named.** Two records settle it
together, and neither is this record's judgement:

- **D-6** (`owner-decisions-2026-09-09.md:89-100`) — the Audit Log screen is reused for FE-015 and
  the reuse "does not authorize adding an export capability to the audit route", "does not authorize
  granting export to every administrator", and holds any scope in which audit data may be exported
  **explicit**. P-12's export contract is approved to be completed separately, with explicit
  authorization and explicit auditability.
- **CC-04** (`change-control-2026-09-08.md:45-59`) — `rpt.export` **qualifies** on the carry rule and
  is **withheld from the phase anyway**, on least-privilege grounds. The withholding holds on this
  head as a measured fact: `bootstrap-roles.ts` carries 78 codes and `rpt.export` is not one of them
  (§ 1.1), while the export resource registry admits no P1-31 resource at all.

So SEC-002's export half is **not an open question**: the phase exports nothing, the code that would
permit it is deliberately not granted, and both facts are decided rather than accidental. **What is
closed is the POSTURE, not an implementation** — P-12 has not started, and nothing here claims it has
or should be counted as done. The acceptance record found the same posture from the other side:
`rpt.export` "gates nothing an operator can see on any of these screens, because no export operation
for a report or for an audit record is published at all", and its browser cases therefore assert the
screens' own standing statement that no download is offered rather than a withheld-code negative
(`acceptance-record.md:624-629`).

**The file-access half: NOT closed here, and owed to a separate pull request.** The obligation is one
negative — a signature-document download **refused** from a P1-31 screen, proving that the
`ERR-DOC-001` refusal above is what a P1-31 operator actually meets rather than what the service
would answer if asked. Nothing on this tree exercises it: the signature panel consumes the contract
and reads no document back, and the printable sheet stores none. That negative belongs to the lane
that owns the delivery screens; it is **not written by this record, not claimed by it, and not
closed**.

**State.** `phase-level incomplete` — the matrix's value, unchanged. **Engineering assessment:** one
of the two halves the P1-31 chapter name adds is settled by disposition and the other has no
artefact, so the row cannot move on either count.

**Open items.**

- **P-12 has not started.** No export route exists for any P1-31 resource and no entry for one
  exists in the resource registry. The posture is decided (§ 2.1); the implementation D-6 approved
  is not begun, and an approved withholding is a decided posture, not a delivered contract.
- **The refused-download negative is owed to a separate pull request** and is the whole of what the
  file-access half still needs.

## 3. SEC-003 — scope hygiene and abuse cases

**Transposed definition.** P1-28 SEC-003 is "no client-asserted scope" — any scope selector a read
surface needs enters as a NAMED exemption with a pinning test, never as a workaround — extended by
P1-30 to cover cross-tenant refusal and replay.

**Starting state (A0, `a0-preflight.md:73`).** "**Measurable today.** Permission delegation is
held-only in both the application and RLS, and the eligibility override is a single blocker
requiring a named permission."

**Evidence on develop at `81b3bce8`.**

- **Measured fact — no client-asserted scope.** The access gate examines 16 route pages across 9
  owned segments and reports 0 violations (§ 1). Its allow-list is of OPERATIONS rather than a
  namespace pattern, and it names `org.employee-list` and `org.branch-list` among them.
- **Measured fact — a typed scope identifier was removed rather than tolerated.**
  `change-control-2026-09-08.md` § 51 records **CC-39(a)**: the Start form carried a text field an
  operator typed a branch identifier into; the branch is now chosen from `org.branch-list`, narrowed
  to the work order's company, defaulted to the work order's own branch and gated on
  `org.branch.read`, **no typed input remains on the form, and a test asserts that**. The earlier
  disposition that justified the typed field is retracted in place rather than rewritten.
- **Measured fact — database-layer isolation on the P1-31 tables.** Five database suites address
  them (counted statically): `tests/db/sal-delivery.test.ts` 11, `tests/db/wty-warranty.test.ts` 6,
  `tests/db/rpt-reporting.test.ts` 3, `tests/db/org-provisioning.test.ts` 13,
  `tests/db/org-employees.test.ts` 24 — **57 cases across 5 files**. `org-employees` is new with
  P-17.
- **Measured fact — the newest tables land with RLS forced.**
  `supabase/migrations/20260910090000_org_employees.sql` enables **and forces** row-level security
  on `org.employees` with three policies — a tenant-wide `SELECT` and scope-restricted `INSERT` and
  `UPDATE` — and grants `DELETE` to no application role.
  `20260910091000_sal_delivery_delivering_employee_identity.sql` creates
  `sal.delivery_legacy_identity_review` with RLS enabled, a tenant `SELECT` policy and an `INSERT`
  policy whose check refuses, so the refusal is declared rather than inferred from an absence.
- **Measured fact — application-layer refusals.** The fifteen `tests/backend/p1-31-*` suites
  (§ 1, 350 cases) carry the cross-tenant and permission negatives per seam; the older surface
  suites over the same tables are `tests/backend/p1-22-delivery.test.ts`,
  `p1-22-warranty.test.ts` and `p1-23-reporting.test.ts`, not re-counted here.
- **Measured fact — privilege widening is held-only.** `change-control-2026-09-08.md` records the
  mechanism at **CC-16** and **CC-20**: `ins_role_permissions_delegable` admits a mapping only when
  the acting administrator already holds the code, which is why a widening obliges an operator act
  rather than taking effect retroactively (§ 11).
- **Quoted from the acceptance record — the abuse cases that were actually driven.** § 4 of
  [`acceptance-record.md`](./acceptance-record.md) (`acceptance-record.md:378-403`) tables **fifteen
  failure, concurrency and isolation cases, every one of which answered as the plan said it should,
  with none recorded as a finding**. Counted on this head by their rows: **four concurrency and
  replay cases** (the batch approval replayed under the same key, step 47; the same delivery-create
  body under the same `Idempotency-Key`, step 103; a second key for a work order that already has a
  live delivery, step 105; a stale `If-Match` on completion, step 116), **four cross-tenant isolation
  probes** (steps 157, 158, 159 and 161), **six refusals** (steps 36, 42, 147, 156, 174 and 175) and
  **one positive control** (step 176, the same restricted person running the report whose code they
  do hold). The two probes that answered 403 rather than an empty 200 are recorded there as the shape
  P1-30's **CC-14** predicted, and the record states the standard plainly: "What is never acceptable
  is a row, and no probe returned one."

### 3.1 The revision this record makes, and the one part it cannot cover

The second version left this row at `not started` and said in terms that "a later matrix revision has
grounds to move this row to `phase-level incomplete`". **This is that revision**, and the parts it
rests on are named individually so that nothing is counted twice:

| part of the transposed definition | what covers it on this head                                                                                                                                                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **client-asserted scope**         | `validate:p1-31-access` — 16 route pages across 9 owned segments, 0 violations — and **CC-39(a)**'s pinning test, which asserts that no typed scope identifier remains on the Start form                                                  |
| **cross-tenant**                  | the `tests/db/*` suites for delivery, warranty, reporting, provisioning and employees (57 cases across 5 files, counted statically), and acceptance steps **157**, **158**, **159** and **161**                                           |
| **permission refusal**            | acceptance steps **174**, **175** and **176** — a person holding three of the four codes refused the readiness queue and the invoice-and-payment report, and served the report whose code they hold                                       |
| **privilege WIDENING as a set**   | **nothing.** The mechanism is recorded (CC-16, CC-20: `ins_role_permissions_delegable` admits a mapping only when the acting administrator already holds the code) and every proof of it is scoped to one seam or to the mechanism itself |

**Engineering assessment.** Three of the four parts have artefacts that exist on this head and were
re-measured here; the fourth has none. That is what `phase-level incomplete` means in this matrix's
own vocabulary — verified slices exist, the cross-cutting coverage does not — so the row moves from
`not started` to `phase-level incomplete` in [`task-matrix.md`](./task-matrix.md), citing this
section. It moves no further: rule 2 forbids it, and the missing part is a real one.

**State.** `phase-level incomplete` — this record **supports the move recorded in**
[`task-matrix.md`](./task-matrix.md) (`not started` → `phase-level incomplete`), on § 3.1. Rule 1
holds: the matrix owns the state, and this section is the artefact it cites.

**Open items.**

- **CC-10** is unchanged and was re-measured: `wty.warranty_record_status_history` has **no reader
  anywhere in `apps/api/src`**, so the warranty status ledger cannot be exercised by an abuse case
  that does not exist. **CC-31** names the missing reader as prerequisite P-18.
- **CC-16** is unchanged as a property, and its operator act has now been performed once on one
  local environment — see § 11, which states exactly where and what that does and does not prove.
- **Privilege widening across the phase as a set is the one uncovered part**, and it is **owed to a
  separate pull request**: a new `tests/backend/p1-31-privilege-escalation.test.ts`, which does not
  exist on this head and is not written by this record. Until it lands, every escalation proof this
  phase has is scoped to its own seam, and no artefact asks whether holding one P1-31 code lets a
  caller reach an operation gated on another.

## 4. SEC-004 — the write-shape gate and audit-event coverage

**Transposed definition.** P1-28 SEC-004 is the write-reachability gate — the
declared-but-never-wired class must not recur, and "the count is derived from the P1-24 register at
check time, never written down". The P1-31 chapter names this row "Security audit-event coverage",
so this section measures both: the write-shape gate the P1-28 definition asks for, and the audit
declarations the chapter's own name asks for.

**Starting state (A0, `a0-preflight.md:74`).** "**Measurable today.** Audit classes are declared on
all fourteen operations. Field 26 additionally requires that exports and privileged reads be
themselves audited."

**Evidence on develop at `81b3bce8`.**

- **Measured fact — the write-shape gate.** `scripts/ci/check-p1-30-payload-parity.mjs`, run on this
  tree: **88 operations in scope `[svc, quo, inv, sal]`, 47 writes, 43 with a body, 4 declared
  bodyless, 9 pending a later wave, 37 mirror interfaces, 0 problems.**
- **Measured fact — the five delivery mirrors are wired.**
  `apps/web/src/lib/contracts/delivery-contract.ts` declares `DeliveryCreateBody`,
  `DeliveryReceiverVerifyBody`, `DeliveryChecklistRecordBody`, `DeliverySignatureAttachBody` and
  `DeliveryCompleteBody`, and the gate's own comment records that these five stood as PENDING
  entries and no longer do, because the delivery-execution screen sends every one of them.
- **Measured fact — what is still PENDING, and who owes it.** Five of the nine pending entries are
  `sal.delivery-checklist-template-*` writes, each carrying the reason "P1-31 FE-004 owes the
  mirror, on the frontend lane"; `sal.delivery-checklist-template-item-remove` is declared bodyless
  with its reason. So the template administration surface is the one P1-31 write family with no
  screen, and the gate says so rather than being silent.
- **Measured fact — `wty` and `rpt` writes are outside this gate's scope.** `P1_30_DOMAINS` is
  `['svc', 'quo', 'inv', 'sal']` and the mirror allow-list names seven files under
  `apps/web/src/lib/contracts/`. The warranty and report mirrors live in their feature trees
  instead — `apps/web/src/features/warranty/warranty-contract.ts` carries
  `WarrantyCoverageCreateBody`, `WarrantyPolicyCreateBody`, `WarrantyPolicyRenameBody` and
  `WarrantyStatusSetBody`; `apps/web/src/features/reports/reports-contract.ts` carries no request
  body, the report surface being read-only. **Engineering assessment:** the eleven `wty.`/`rpt.`
  writes on this surface are therefore held to no mirror gate at all. That is a real gap in the
  transposed definition, not a violation of a rule that exists.
- **Measured fact — a declared write family with no consumer.** The seven
  `rpt.report-configuration-*` operations are referenced in `apps/web` only by the generated
  `apps/web/src/lib/api/idempotent-operations.ts` manifest; no screen and no adapter calls them.
  **Engineering assessment:** that is the declared-but-never-wired shape this task exists to catch,
  and P1-31 ships it knowingly — the report screens consume the catalogue and the run, never the
  configuration writer.
- **Measured fact — audit declarations.** Across the eight namespaces all **45 operations declare
  an `auditClass`: 24 `'privileged'` and 21 `'none'`**. No operation on this surface omits one, and
  each `'privileged'` declaration carries an `auditAction`. The count is a static parse, not a
  review.
- **Measured fact — the gate can go red.** `tests/ci/p1-31-access-gate.test.ts` — **14 cases,
  counted statically** — is the mutation proof the command register names, and it pins the gate's
  own report line: `PINNED_PAGES = 16` and `PINNED_OWNED_SEGMENTS = 9`, re-based from the gate's own
  output on this head under **CC-39(c)**.

**State.** `not started` — the matrix's value, unchanged. **Engineering assessment:** the audit
classes are declared and countable and the write-shape gate is green, but the matrix's stated
dependency is that nobody has reviewed the phase's audit declarations **as a set**; a count is not a
review, and this record does not perform one.

**Open items.**

- The **21 `auditClass: 'none'` declarations** on this surface are not individually justified in any
  record on this tree. **Engineering assessment:** that justification is the first item SEC-004
  owes.
- Field 26's requirement that exports be themselves audited cannot be discharged, because no P1-31
  export operation exists (§ 2).
- The eleven `wty.`/`rpt.` writes are covered by no payload-parity gate.

## 5. QA-001 — contract-mirror unit and component coverage

**Transposed definition.** P1-28 QA-001 is contract-mirror unit and component coverage: one
hand-transcribed mirror per request shape, and one DOM suite per screen rendering the route page
behind a mocked session, in both text directions.

**Starting state (A0, `a0-preflight.md:80`).** "**Greenfield.** No web test exists for delivery,
warranty or reporting. Audit has coverage through the administration e2e spec and the navigation
test."

**Evidence on develop at `81b3bce8`.** A0's "greenfield" no longer holds for any of the three.

- **Measured fact.** Eleven web suites address this surface — **396 cases counted statically**, of
  which seven files use `it.each`, so 396 is a floor rather than the executed total:

  | file (`apps/web/tests/`)         | cases | `it.each` tables |
  | -------------------------------- | ----- | ---------------- |
  | `delivery.dom.test.tsx`          | 80    | 3                |
  | `delivery-api.test.ts`           | 48    | 4                |
  | `delivery-start.dom.test.tsx`    | 20    | 0                |
  | `delivery-document.dom.test.tsx` | 14    | 0                |
  | `warranty.dom.test.tsx`          | 42    | 0                |
  | `warranty-policies.dom.test.tsx` | 27    | 0                |
  | `warranty-api.test.ts`           | 45    | 0                |
  | `reports.dom.test.tsx`           | 46    | 2                |
  | `reports-overview.dom.test.tsx`  | 28    | 1                |
  | `reports-api.test.ts`            | 26    | 3                |
  | `audit-log.dom.test.tsx`         | 20    | 1                |

- **Measured fact — three feature trees now exist, re-counted and CORRECTED.**
  `apps/web/src/features/delivery` holds **24** TypeScript files, including four contract mirrors
  (`delivery-contract.ts`, `readiness-contract.ts`, `employee-contract.ts`, `branch-contract.ts`);
  `apps/web/src/features/warranty` holds **8**; `apps/web/src/features/reports` holds **10**,
  including `reports-contract.ts` and `overview-contract.ts`. The second version recorded fifteen,
  six and six for the same three trees. **That did not reproduce at this head and no slice between
  the two heads touched these trees**, so the earlier figures counted something narrower than a
  recursive file count and are corrected here rather than restated — which is rule 4's discipline
  applied to this record's own predecessor. Nine dashboard pages sit on the surface: `delivery` and
  `delivery/[deliveryId]`, `reports`, `reports/[reportCode]` and `reports/overview`, `warranty` and
  `warranty/[warrantyId]`, `warranty/policies` and `warranty/policies/[policyId]`.
- **Measured fact — the report screens are one parameterised screen, not four.**
  `apps/web/src/features/reports/components/ReportScreen.tsx` is parameterised by report code and
  serves FE-011 … FE-014; `ReportOverviewScreen.tsx` serves FE-010 and FE-016 from one screen with
  the branch fixed by the address. `report-screens.md` and `operational-overview.md` are the slice
  records.

**State.** `phase-level incomplete` — the matrix's value, unchanged. No web tier was run for this
record and no tier total is claimed.

**Open items.**

- **No phase-level coverage record exists.** **Engineering assessment:** the eleven suites above
  are what QA-001 has; the cross-screen artefact the task names does not exist.
- The checklist-template administration surface (FE-004's remaining half) has no screen and
  therefore no component coverage — the same five PENDING mirrors § 4 names.
- **#378 has merged** and is no longer an open pull request; the second version listed it as one.
  What it added under `apps/web/tests` is the four `*-p1-31.spec.ts` Playwright specs and their
  `p1-31-handoff.ts` helper, which are the **e2e** tier and are not counted in the vitest table
  above — so the table's 396 is unchanged by it (§ 9). **#372** (QA-006/QA-007, delivery DOM test
  races) was open at the second version's head and is not counted above; this record did not
  re-check its state and does not claim one.

## 6. QA-002 — API contract, error paths and replay shapes

**Transposed definition.** P1-28 QA-002 is the 428/409/422/403 branches per operation plus the
replay shapes, proved on real rows.

**Starting state (A0, `a0-preflight.md:81`).** "**Partly unscopable.** Three of the chapter's four
APIs have no contract to test, and the OpenAPI response schemas for all fourteen operations on this
surface are bare objects — which Field 23's closing bullet makes a chapter-level shortfall rather
than a P1-31 defect."

**Evidence on develop at `81b3bce8`.** All three of A0's missing APIs now have contracts.

- **Measured fact.** The fifteen `tests/backend/p1-31-*` suites (§ 1, **350 cases counted
  statically**) are the error-path proofs for the delivery read, delivery list, readiness,
  checklist-template, warranty read, warranty policy, report configuration, the four report
  datasets, the delivering-employee seam, and the two bundle/backfill paths.
- **Measured fact.** The adapter-side proofs are `apps/web/tests/delivery-api.test.ts` (48 cases, 4
  `it.each` tables), `warranty-api.test.ts` (45) and `reports-api.test.ts` (26, 3 tables), all
  counted statically.
- **Measured fact.** `scripts/ci/check-permission-parity.mjs` resolves all 468 executable permission
  references on this tree against the catalogue or the open-debt register (§ 1), which is the 403
  half of the contract stated as a gate rather than as a test.
- **Measured fact — the report engine's own refusal is mutation-proved.**
  `scripts/p1-23-mutation-matrix.mjs` carries two mutations **re-targeted by P-11 rather than
  dropped**. **M7b** moved from the by-code SQL to `assertReportConfiguration`
  (`from: "if (row.status !== 'published' || row.version_number === null) {"`), because the engine
  must SEE an unpublished configuration in order to refuse it; its property is "a non-published
  configuration is never applied to a run". **M8** moved to the catalogue service
  (`from: "executable: isReportDatasetCode(row.report_code),"`), whose property is "the catalogue
  marks a report executable only when its code is registered". Each docblock states why the mutant
  compiles and how it dies.
- **Measured fact — the dataset registry is code, not data.**
  `apps/api/src/modules/reporting/domain/report-datasets.ts` registers exactly four codes —
  `work_orders_by_status`, `technician_labor_time`, `inventory_movements`,
  `invoice_payment_summary` — with `isReportDatasetCode` as the only membership test.

- **Quoted from the acceptance record — the error paths that were driven against a running system.**
  Its § 4 (`acceptance-record.md:378-403`) tables fifteen failure, concurrency and isolation cases
  with zero findings (§ 3), and the four of them that are error-SHAPE assertions on this phase's own
  operations answered with the declared code rather than with a generic failure: `ERR-RES-002` on a
  second delivery for one work order (step 105), `ERR-CON-001` on a stale `If-Match` (step 116),
  `ERR-VAL-001` with the rule `inactive_employee` on a retired delivering employee (step 147), and
  `ERR-TRN-001` on a completion with mandatory checklist items unanswered (step 156). That is one
  traversal of four branches, on one pair of organisations — **not** the per-operation 428/409/422/403
  matrix the transposed definition asks for.

**State.** `phase-level incomplete` — the matrix's value, unchanged.

**What remains, stated explicitly.** Two things, and neither is closed by the acceptance record:

1. **P-12's export contract does not exist.** No export route is published for any P1-31 resource and
   no entry for one sits in the export resource registry (§ 2), so the operation's error paths cannot
   be written, let alone proved. D-6 approved the contract; nothing has implemented it. **The
   acceptance record does not close this** — it could not drive an operation that is not published,
   and its § 6 makes no claim about one.
2. **The OpenAPI shortfall, re-measured here rather than carried forward.** The second version
   declined to re-measure it and cited register § 41 for `sal.delivery-*`. Measured on this head
   against `docs/api/openapi.v1.json`: **all 45 P1-31 operations publish a success response schema of
   exactly `{ "type": "object" }`** — not the 21 `sal.delivery-*` ones alone, but those plus the 10
   `wty.*`, the 10 `rpt.*` and the 4 `org.employee-*`: 45 of 45.
   So a consumer reading the published contract learns the status code and nothing about the body.
   **The acceptance record does not close this either**: it asserts what the running server answered,
   which is evidence about the server and not about the document. A0 classified the shortfall as
   chapter-level and it remains so; this record measures its true extent and closes none of it. The
   generated file is regenerated and diffed by its own gate and was **not** edited here.

## 7. QA-003 — tenant / company / branch isolation

**Transposed definition.** P1-28 QA-003 is isolation held in two layers that are never collapsed:
the database layer hides the parent, the application layer refuses the widening grant.

**Starting state (A0, `a0-preflight.md:82`).** "**Buildable.** Backend precedent exists in the P1-22
isolation suite; the scope-target mechanism is the thing under test."

**Evidence on develop at `81b3bce8`.**

- **Measured fact — database layer.** The five suites and 57 statically counted cases in § 3, plus
  the RLS posture of the two P-17 migrations recorded there. The general isolation suites
  (`tests/db/p1-09-isolation.test.ts`, `p1-10-`, `p1-11-`, `crm-isolation`, `veh-isolation`) exist
  on this tree and are outside the P1-31 surface, so they are not counted.
- **Measured fact — application layer.** Each of the fifteen `tests/backend/p1-31-*` suites carries
  scope negatives beside its permission negatives. `change-control-2026-09-08.md` § 39 records the
  readiness seam's proof construction in full, including row **D3-1**: "every fixture arranged
  THROUGH shipped routes … Nothing planted by UPDATE."
- **Measured fact — RLS posture on the older P1-31 tables, re-read.**
  `change-control-2026-09-08.md` § 1 records that no RLS predicate names a `wty.` or `rpt.`
  permission code: the warranty and reporting policies are tenant- and company-scope predicates
  only, citing `supabase/migrations/20260724095000_wty_warranty.sql` and
  `…096000_rpt_reporting.sql`. Both files are on this tree and the statement is unchanged.
- **Measured fact — the new foreign key is tenant-scoped by design.**
  `fk_delivery_records_delivering_employee` names `(tenant_id, id)`, and
  `change-control-2026-09-08.md` § 41 **CC-29a** records that a branch rule shipped in the first
  draft, was wrong under the Owner clarification of 2026-09-10, and was removed at all three layers
  — key, trigger and service — with the database obligation inverted to assert acceptance for
  another branch and a refusal for another tenant.

- **Quoted from the acceptance record — isolation driven between two real organisations.** Its § 4
  (`acceptance-record.md:378-403`) carries **four cross-tenant probes** out of its fifteen cases, all
  of them recorded as answering correctly and none as a finding: organisation B reading organisation
  A's delivery (step 157, `404 ERR-RES-001`) and warranty (step 158, `404 ERR-RES-001`), and
  organisation B naming organisation A's branch on the readiness queue (step 159) and on a report run
  (step 161), both `403` with no row. The record states the acceptance standard the probes were
  judged against — "What is never acceptable is a row, and no probe returned one" — and records that
  the two `403`s are the shape P1-30's **CC-14** predicted, the application scope check refusing a
  foreign company/branch pair before RLS is reached. Both organisations were provisioned through
  `platform.organization-provision` in the same run (`acceptance-record.md:94-95`).

**State.** `phase-level incomplete` — the matrix's value, unchanged. No database or backend tier was
run for this record, so no pass figure is claimed from any file above.

**What remains, stated explicitly.** Isolation on this phase is proved **per seam**: each of the
fifteen `tests/backend/p1-31-*` suites carries its own scope negatives, each of the five `tests/db/*`
suites carries its own table's, and the acceptance record drove four probes over four operations.
**No artefact measures isolation across the 45 operations as a set.** Four of forty-five is four of
forty-five; the record itself claims nothing wider, and the coverage the transposed definition asks
for — both layers held, on every operation the phase publishes — has no artefact on this head. Per
seam is not per phase, and per-slice proof is not phase acceptance.

**Open items.**

- No artefact measures isolation across the 45 operations as a set (above).
- Per-slice proof is not phase acceptance; rule 2 applies.

## 8. QA-004 — concurrency, idempotency and record-version sourcing

**Transposed definition.** P1-28 QA-004 is version sourcing as a discipline: every version-guarded
write sources its `recordVersion` from a read or a command response, and every idempotent send
carries its transport key.

**Starting state (A0, `a0-preflight.md:83`).** "**Buildable.** `sal.delivery-complete` is the only
version-guarded operation on this surface (If-Match mandatory, ERR-CON-002 when absent); the other
five commands are idempotent by body key."

**Evidence on develop at `81b3bce8`.** The surface has grown far past A0's measurement.

- **Measured fact.** Of the 45 operations, **11 declare `versionGuarded: true`** — one under
  `deliveries` (`sal.delivery-complete`, so A0's statement still holds for the delivery record
  writes), three under `delivery-checklist-templates`, three under `report-configurations`, three
  under `warranty-policies`, and one under `org/employees` (`org.employee-status-set`) — and **16
  declare `idempotent: true`**.
- **Measured fact — the version-sourcing gate is green and does not cover this phase.**
  `scripts/ci/check-p1-28-version-sourcing.mjs`, run on this tree: **22 guarded operations, 15
  deliberately absent, 7 this application must reach, 30 adapters, 31 guarded call sites**, and
  every version-guarded command sources its `If-Match` from a read or a command response. Its scope
  is P1-28's. **Engineering assessment:** whether P1-31 owes a sibling gate over its own eleven
  guarded operations is a decision this record does not take.
- **Measured fact — the one deliberate divergence, re-read.**
  `change-control-2026-09-08.md` **CC-17** records that `wty.warranty-coverage-status-set` is
  version-guarded and **not** idempotent, alone among the warranty writes, because an idempotency
  reservation replays a STORED result and a second submission would be handed a success computed
  before the replacement row existed. The declaration on this head matches: that operation carries
  `versionGuarded: true` and no `idempotent` flag.
- **Measured fact.** `apps/web/src/lib/contracts/delivery-contract.ts` records that
  `sal.delivery-complete` declares `versionGuarded: true` and what the handler does with it — the
  mirror carries the guard, not just the body.
- **Quoted from the acceptance record — four concurrency cases, driven once each.** Of the fifteen
  cases its § 4 tables (`acceptance-record.md:378-403`), **four** are this section's subject and all
  four answered as designed with no finding: an approval replayed under the same key was not a second
  approval (step 47); the same `sal.delivery-create` body under the **same** `Idempotency-Key`
  answered the **same delivery id** rather than a second row (steps 103–104); a **second** key for a
  work order that already has a live delivery was refused `409 ERR-RES-002` (step 105); and a
  **stale** `If-Match` on `sal.delivery-complete` was refused `409 ERR-CON-001` (step 116). The
  version that succeeded was read from the operation that publishes it — the eligibility read at step
  115 — which is the sourcing discipline the transposed definition names, observed once.
  **Engineering assessment:** four cases over two of the eleven version-guarded operations and one of
  the sixteen idempotent ones. It is a traversal, not a matrix, and the record claims nothing more.

**State.** `not started` — the matrix's value, unchanged. **This record does not move it**, and the
row is outside this revision's allocation in any case. **Engineering assessment:** the declarations
are countable, CC-17 is a closed disposition, the matrix's stated dependency — the write paths
reaching screens — is now satisfied for delivery and warranty and unsatisfied for the checklist
templates and the report configuration writer, and the acceptance record adds the first concurrency
evidence this phase has from a running system. No artefact on this tree exercises concurrency across
the phase as a set, and nine of the eleven version-guarded operations were never sent a stale guard
by anything.

**Open items.**

- **CC-17** stands as an open property: one write on this surface is version-guarded and not
  replayable, and any screen that sends it must not retry blindly.
- No P1-31 version-sourcing gate exists (above).

## 9. QA-005 — regression and immutable evidence packaging

**Transposed definition.** P1-28 QA-005 is regression plus immutable evidence packaging: tiers
recorded from their runs into the ledger, digest-checked, and the phase closing on an explicit
recorded acceptance.

**Starting state (A0, `a0-preflight.md:84`).** "**Blocked on convention.** The only target the
chapter names is the directory `_acceptance/`, which does not exist in this repository; acceptance
evidence here lives as `docs/phase-1/phase-1-NN/*acceptance*.md`. That mismatch is a decision, not a
defect (D-16)."

**Evidence on develop at `81b3bce8`.**

- **Measured fact — the precedent.**
  [`../phase-1-30/w9-acceptance-record.md`](../phase-1-30/w9-acceptance-record.md) exists on this
  tree and is the shape a P1-31 acceptance record would take: a fresh-organisation session recorded
  step by step, with the API's own correlation reference carried on every recorded step.
- **Measured fact — the gap the second version recorded is CLOSED, and this is the correction.** That
  version stated, at this point in this section, that `docs/phase-1/phase-1-31/` held 28 files and
  **no file whose name contains "acceptance"**, and concluded that "no P1-31 acceptance record exists,
  and no P1-31 acceptance run has happened". **Both statements are now false.** Measured on this head:
  the directory holds **31 files**, and **two** of them carry "acceptance" in their name —
  [`acceptance-plan.md`](./acceptance-plan.md), merged by **#378** at `6005cfa4`, and
  [`acceptance-record.md`](./acceptance-record.md), merged by **#380** at `81b3bce8`.
- **Quoted from the acceptance record — the run, and its own verdict.** Its § 1 verdict is
  **PARTIAL** (`acceptance-record.md:27`), and this record does not upgrade it. What it records:
  - **The HTTP journey passed — 176 steps, 0 findings** (`acceptance-record.md:29`, `:70`), against a
    production build (`next build` + `next start`) of `develop` `6005cfa4`, driven entirely through
    published operations on organisations created in the run itself: **two fresh organisations per
    pass**, `p31_journey_a_*` and `p31_journey_b_*`, each provisioned through
    `platform.organization-provision` (`acceptance-record.md:94-95`), with every credential
    established through the product's own reset or invitation route and the link read out of the
    local mailbox.
  - **The same 176 steps answered 0 findings a second time**, on a **second** fresh pair, in the
    correction pass of § 7.1, run `mtz5ppq8` (`acceptance-record.md:560-563`). Two independent passes of
    the same chain, on two different pairs of organisations.
  - **The browser matrix did not pass.** Thirty-four committed cases — seventeen per locale project,
    executed in both `authenticated-en` and `authenticated-ar` with none skipped — answered **9 pass
    / 25 fail** on the recorded run and **32 pass / 2 fail** after the correction pass
    (`acceptance-record.md:574-580`). The record's own account of the twenty-five is that not one was
    an assertion about the product that the product failed; and its § 7.2 then records that the
    governed `authenticated-browser` job **refused** the correction pass, because two spec files
    contributed zero executed cases, and what was changed so that every one of the eleven committed
    authenticated spec files contributes at least one.
  - **No Owner verdict has been given** (`acceptance-record.md:55-57`). The plan admits a PASS only
    on the conjunction of zero HTTP findings, every browser case passing, and an Owner verdict; the
    first holds twice, the second does not, the third has not happened.
- **Measured fact — the harness is NOT in this repository, and where it is.** The HTTP driver lives
  **outside this repository** at `orchestration/acceptance/p1-31-journey.mjs`, beside the phase
  evidence and outside any git working tree; the screenshot companion `p1-31-screens.mjs` is held in
  the same place (`acceptance-record.md:405-423`). It was put there by **#378**, and the disposition
  is register § 52.6 (`change-control-2026-09-08.md:3274-3318`): an evidence writer is by construction
  a path from API responses to the filesystem, which is what **`js/http-to-file-access`** reports;
  five of the seven alerts the harness raised were closed by real fixes, and **the last two ARE the
  network-to-file edge**, which does not close while the evidence exists. **The two were resolved by
  RELOCATION, not by dismissal**, and both halves of that claim were verified on this head:
  `.github/ci-baselines/codeql-baseline.json` carries `maximumOpenFindings: 0` with an **empty**
  `dismissals` array, and the file is **byte-identical across #378** — `git diff 329b19ab 6005cfa4 --
.github/ci-baselines/codeql-baseline.json` is empty. What the relocation costs is recorded there
  rather than glossed: a file outside the repository is not reviewed by CODEOWNERS, not covered by
  the repository gates, and not versioned with the code it drives. **Wherever this file cites the
  harness, that is the file it means.** What #378 did commit is the four
  `apps/web/tests/e2e/authenticated/*-p1-31.spec.ts` specs and their `p1-31-handoff.ts` helper, which
  are on this tree and execute in the governed job.
- **Measured fact — the regression artefacts that do exist per slice** are recorded in
  `task-matrix.md` and in the register sections named there. This record does not restate those
  figures, because it did not run the tiers that produced them and a re-quoted number is the
  stale-count defect `scripts/ci/check-p1-27-doc-counts.mjs` exists to refuse.
- **Owner policy, quoted.** The standing verification policy of 2026-09-09
  (`owner-decisions-2026-09-09.md:116-122`): "Targeted local checks plus the required hosted gates
  are the standing expectation. The local `verify:workspaces` aggregate is **not** a per-commit
  prerequisite." That is the policy under which the slice proofs above were taken.

**State.** `phase-level incomplete` — the matrix's value, unchanged, and **still the ceiling rule 2
sets**. The acceptance record satisfies the EXISTENCE condition and not the task: its own verdict is
PARTIAL, two browser cases still fail, no Owner Pass has been given, and the immutable-evidence half
of the transposed definition is unmet — the run's `summary.json`, `steps.json`, `steps.md`,
`screens.json` and images are all held outside this repository
(`acceptance-record.md:424-428`), so nothing of the run is digest-checked into a committed ledger.
What the record moved is twelve **Frontend** rows; it moved no row in this file and claims none.

**Open items.**

- **The phase acceptance record now exists, and the phase acceptance has not been given.** The
  distinction is the whole of what QA-005 still owes: a recorded run is not a recorded verdict.
- **Two browser cases still fail**, on what the record's § 7.1 calls a fourth defect of the
  instrument — a figure the harness recorded mid-journey compared against a dataset the engine
  publishes as `live`. The repair belongs to the harness, which is outside this repository.
- **The evidence packaging half is unmet.** Nothing of the run is committed except the record itself.
- **D-16's convention half is still unresolved in the chapter's own terms:** the chapter requires
  `_acceptance/`, this repository uses `docs/phase-1/phase-1-NN/*acceptance*.md`, and no record
  reconciles the two. #378 and #380 have now instantiated the repository's convention twice —
  `acceptance-plan.md` and `acceptance-record.md` — without reconciling it with the chapter's.

## 10. DO-001 — continuous-integration quality gate and gate-metadata co-maintenance

**Transposed definition.** P1-28 DO-001 binds gate metadata to the change that needs it:
"`MODULE_DISPOSITION` entries, re-derived doc-count markers, and SCAN_ROOTS decisions land in the
SAME pull request as the first file that changes them" (`phase-1-28/canonical-plan.md:211-216`).

**Starting state (A0, `a0-preflight.md:90`).** "**Blocked before the first pull request** — and
closed by this record. No `p1-31` ownership rule and no `p1-31` profile existed, while the map's
unmapped policy is FAIL, so the first pull request of any P1-31 lane was refused before any other
blocker could be reached. This preflight adds the rules and profiles (P-15). Separately, the
gate-before-read check owns the plural `deliveries`/`warranties` segments but not the singular
`/delivery` href already in navigation, nor `/reports` (P-16)."

**Evidence on develop at `81b3bce8`.**

- **Measured fact — the gate exists, is registered and is reachable.**
  `scripts/ci/check-p1-31-access.mjs` is invoked by `validate:p1-31-access`, which is a member of
  `verify:policies` in `package.json`. It is declared in
  `scripts/ci/check-command-coverage.mjs:442` with `owner: ROOT` and `tier: 'required'`, and the
  register records the design decision — an explicit allow-list of operations rather than a
  namespace pattern, because P1-30 already owns the whole `sal.`/`wty.` namespaces, and that unlike
  its siblings this gate ships beside a screen, so a run examining zero pages is a red rather than
  a notice.
- **Measured fact — gate metadata travelled with the change that needed it.** Both pins in
  `tests/ci/p1-31-access-gate.test.ts` (`PINNED_PAGES = 16`, `PINNED_OWNED_SEGMENTS = 9`) were
  re-based from the gate's own report line in the slice that moved them, recorded as **CC-39(c)**;
  the same disposition records that withdrawing an operation and claiming another moved neither
  number, and why. The `modules/reporting` entry in `MONEY_TREES` (§ 2) landed with the dataset
  slice that put amounts in that module. The register's own § 48.1 rule — an identifier is a claim
  about the register at the moment it was raised, and is never renumbered to follow heading order —
  is the same discipline applied to section numbers.
- **Measured fact — it can go red.** `tests/ci/p1-31-access-gate.test.ts`, **14 cases counted
  statically**, is the mutation proof the register names.
- **Measured fact — the ownership lanes.** `scripts/ci/check-phase-ownership.mjs` declares
  `p1-31-frontend` (line 673) and `p1-31-backend` (line 704), each with an explicit `allowed` bucket
  list and a per-bucket reason for every refusal. `p1-31-frontend` allows `web`, `docs`, `tooling`,
  `tests`, `rootConfig` and forbids `apiSource`, `apiConfig`, `webGenerated`, `webContract`,
  `migrations`, `dbSeeds` and `supabase`, each with its own sentence. There is no broad
  `remediation/p1-31-` rule, so an unmapped branch is refused rather than judged loosely.

**State.** `merged (read-only/partial)` — the matrix's value, unchanged.

**Open items.**

- The gate judges an explicit allow-list, so every new P1-31 screen and every operation a screen
  consumes must be added to it. That is the matrix's stated next dependency and remains true.
- **Engineering assessment, carried forward and not closed:** P1-30 recorded as its **CC-25** that
  no hosted job names a P1-30 gate by name; `validate:p1-31-access` sits in exactly the same
  position, reached only through `verify:policies`. This record neither closes that observation nor
  re-files it under a P1-31 identifier.
- **Measured fact, stated because it is easy to assume otherwise:** `validate:exact-money` is in
  `verify:contracts` and **not** in `verify:policies`, so the money surface this phase widened is
  guarded by a different aggregate from the one the access gate rides.

## 11. DO-002 — structured logging, monitoring and pipeline wiring

**Transposed definition.** P1-28 DO-002 is the observability surface and the pipeline that carries
it: a correlation reference rendered wherever a screen fails, run ids recorded per slice, and a
pipeline that refuses what it cannot place.

**Starting state (A0, `a0-preflight.md:91`).** "**Buildable.** It is also the natural place to
record how a screen refreshes, given that Field 24's event-consumption requirement has no mechanism
in either tier (D-10)."

**Evidence on develop at `81b3bce8`.**

- **Measured fact — the correlation surface.** `correlationId` is referenced by **13 files under
  `apps/web/src/features/delivery`, 6 under `apps/web/src/features/warranty` and 5 under
  `apps/web/src/features/reports`** — 24 files across the three trees. Each feature's DOM suite
  asserts it per screen.
- **Measured fact — pipeline placement refuses what it cannot place.** The ownership resolver
  refuses a branch that maps to no profile rather than judging it against another phase's
  declaration (§ 10), which is that property stated as a mechanism rather than a claim. It is also
  why this record travels on a `feature/` branch.
- **The operator actions this phase owes after merge**, and their state:

  | owed act                                                                                                          | recorded as                        | state                                                                           |
  | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------- |
  | apply the P-9b migration `20260909090000_sal_complete_delivery_active_template_gate.sql`                          | register § 35 (P-9b, #363)         | owed on each environment; done on one, below                                    |
  | apply the two P-17 migrations `20260910090000_org_employees.sql` and `20260910091000_sal_delivery_…_identity.sql` | register § 41                      | owed on each environment; done on one, below                                    |
  | run `scripts/platform/backfill-delivering-employee-identity.mjs` so legacy handovers gain an identity             | register § 41 (**CC-29b**)         | done on one, below                                                              |
  | run `scripts/platform/backfill-tenant-administrator-bundle.mjs` so existing organisations gain the new codes      | **CC-16** § 29.2, **CC-20** § 34.2 | done on one, below — ONE run carries all newly approved codes, not one run each |

- **Measured fact — three P-17 operator steps were performed on 2026-09-12, and the evidence is
  OUTSIDE this repository.** The external artefact is the directory
  `orchestration/evidence/p1-31/p17-operator-20260912/` in the workspace that contains this
  repository — sixteen entries: `README.md`, ten numbered JSON captures, and a `logs/` directory of
  raw command output. It is **not** a tracked path here and nothing in this repository reads it, so
  it is cited as an external artefact and its contents are summarised, not restated as repository
  evidence. What it records: the migration ledger reconciled and brought to parity with the 141
  migration files in the tree (so `20260909090000` and both P-17 files are applied there); the
  delivering-employee backfill run dry then real, considering 25 organisations and minting nothing
  because the delivery table was empty; and the bundle backfill, which **refused on its first pass
  with exit 5** because the permission catalogue on that database lacked the two minted codes, then
  completed in a second pass after the declared seed `supabase/seeds/04_iam_permission_catalog.sql`
  was applied as it stands, widening 24 administrator roles from 76 to 78 codes.
  **What that does and does not prove:** it was performed by hand against **one shared local
  database in a Docker container**. Its own README states it is not a hosted result, not an
  acceptance result and not a claim that any gate, lane or approval passed, and that no test tier
  was run and no repository file was changed. This record makes no stronger claim. **Engineering
  assessment:** the refusal on the first pass is the most useful thing in the artefact — the
  backfill script's fail-closed guard works, and the act has a prerequisite (the catalogue seed)
  that no record named before it was met.
- **Measured fact — the standing policy that governs how a slice proves itself** is quoted in § 9.

**State.** `not started` — the matrix's value, unchanged.

**Open items.**

- **No runbook document exists.** The chapter's shared DevOps description requires "a recorded
  operator runbook", and no file in this repository carries one for the four acts tabled above. The
  only guidance that exists is the register sections themselves plus the external artefact's
  README, which is not in this repository. **Engineering assessment:** writing that runbook is
  DO-002's first item, and it is the same item DOC-002 owes — the two tasks meet here.
- **The prerequisite the operator artefact exposed is not recorded anywhere in this repository:**
  the bundle backfill cannot run until the permission-catalogue seed has been applied to the target
  database. **Engineering assessment:** a runbook that omits that ordering will reproduce the exit-5
  refusal.
- **D-10** (Field 24's event-consumption requirement having no mechanism in either tier) is
  unchanged and is recorded in A0, not here.
- **Monitoring and alert routing: nothing exists for this phase, and nothing is claimed.** The
  matrix's next dependency for this row — a decision about what this phase adds over the platform's
  existing logging — is unanswered.

## 12. DOC-001 — contract, catalog and traceability synchronisation

**Transposed definition.** P1-28 DOC-001 is contract archaeology plus plan and traceability
synchronisation: the generated registers regenerated at every head, and each stale statement
corrected against the tree rather than restated.

**Starting state (A0, `a0-preflight.md:97`).** "**Targets partly do not exist.** There is no
`documentation/` directory, and the numbered files Field 34 names do not exist at those paths. Four
real corrections are in scope regardless: the four stale delivery permission rows in the P1-22
operation inventory, the stale P1-22-L-04 docblock, the register overstatement of P1-27-INT-084, and
the wrong table name in OWR-2026-09-06-G-10."

**Evidence on develop at `81b3bce8`.**

- **Measured fact — `documentation/` still does not exist.** Checked on this head: there is no such
  path in this repository. A0's reading holds unchanged.
- **Measured fact — P-13 and P-14 merged as #354 (`0272390b`)**: the four stale delivery permission
  rows corrected in `docs/phase-1/phase-1-22/operation-inventory.md` and the stale signatures
  docblock corrected in `apps/api/src/app/api/v1/deliveries/[deliveryId]/signatures/route.ts`, with
  the delivery module's read service, service, repository, index and
  `apps/api/src/server/auth/audit-actions.ts` moving alongside.
- **Measured fact — a further stale statement was corrected in place at #377.** Register § 51
  records that both `apps/web/src/lib/contracts/delivery-contract.ts` and
  `apps/web/src/features/delivery/delivery-contract.ts` asserted that the delivering-employee
  reference had no foreign key anywhere in the platform; it has had one since P-17, and both
  docblocks were corrected in the same change that consumed the new contract. **CC-39(a)** and
  **CC-39(b)** are two more corrections of the same class, made by retraction rather than rewriting.
- **Measured fact — the generated registers move with each slice.** `apps/web/src/lib/api/
idempotent-operations.ts` is generated from the Backend register and is one of the buckets
  `p1-31-frontend` is forbidden to touch, precisely so the two cannot desynchronise. This record
  derives no count that a generated register owns and regenerates nothing.
- **Measured fact — this phase's contract documents, re-counted on this head.**
  `docs/phase-1/phase-1-31/` holds **31 files: 20 per-slice records and 11 phase-level ones** — the
  preflight, the canonical plan, the change register, the task matrix, this file, the acceptance plan
  and record, the three Owner-decision records, and `d4-report-definitions.md`, which is the
  reporting contract the four datasets were built against. The second version recorded "fifteen slice
  records beside the four governance records" over a directory it measured at 28 files. Exactly three
  files have been added between the two heads — `acceptance-plan.md`, `acceptance-record.md` and
  **this file**, which was itself unmerged when the second version was written — and the categories
  are restated here so that the two numbers add up to the directory, which the earlier pair did not.

**State.** `not started` — the matrix's value, unchanged. **Engineering assessment:** two of A0's
four named corrections have merged and two more of the same class landed since, but the canonical
task is synchronisation of the phase's contract and catalog **as a whole**, and the matrix's stated
dependency — the phase's operation set settling — is not met: 45 operations exist and P-12 has not
started.

**Open items.**

- **Two of A0's four named corrections could not be evidenced on this head** — the register
  overstatement of P1-27-INT-084 and the wrong table name in OWR-2026-09-06-G-10. This record
  **does not claim they are done and did not confirm their disposition.**
- Field 34's numbered documentation targets do not exist at the paths the chapter gives, and no
  record reconciles the chapter's document tree with this repository's.

## 13. DOC-002 — operator / developer guidance and the change record

**Transposed definition.** P1-28 DOC-002 is operator and developer guidance plus the change-log
update, routed to a named approval owner.

**Starting state (A0, `a0-preflight.md:98`).** "**Buildable.** `documentation/_registry/change-log.md`
does not exist either; the repository's equivalent is the per-phase change-control register."

**Evidence on develop at `81b3bce8`.**

- **Measured fact — the controlled record and exactly what it now holds, re-measured.**
  [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) is P1-31's change record. On this
  head it carries **numbered sections 1 … 54 with no gap, and identifiers CC-01 … CC-44 with no
  gap.** Its **highest section is 54** ("The fresh-organisation acceptance, run and recorded",
  QA-005, PR #380) and its **highest identifier is CC-44**. The second version measured sections
  1 … 48, 50, 51, 53 with 49 and 52 absent, and CC-01 … CC-41; **both holes have since been filled by
  the lanes that claimed them** — section 49 with **CC-37** by this record's own second version
  (#379), and section 52 by the acceptance-harness lane (#378), whose identifier settled as **CC-42**
  rather than the CC-40 it had provisionally claimed, because #376 merged first and took that number.
  That is § 48.1's rule working as designed: an identifier is a claim about the register at the
  moment it was raised, it is reconciled upward when another lane lands first, and it is never
  renumbered to follow heading order. Sections 53 and 54 and identifiers CC-40 … CC-44 are the
  operational-overview and acceptance lanes' own, and nothing of theirs is touched here.
- **Measured fact — operator guidance.** **No runbook file exists** for the four merge-time operator
  acts tabled in § 11. The guidance that exists in this repository is the register sections
  themselves, each naming its remedy. The one artefact that records the acts being performed is
  outside this repository (§ 11).
- **Measured fact — developer guidance.** The gate memory a P1-31 slice needs is in
  `scripts/ci/check-command-coverage.mjs` (what each gate asserts and which tier it runs in) and in
  `scripts/ci/check-phase-ownership.mjs` (which lane may touch which bucket, with a reason per
  refusal). Both were read for this record and neither was changed by it.

**State.** `not started` — the matrix's value, unchanged. **Engineering assessment:** this file is
one of DOC-002's artefacts, and one artefact is not the task; the runbook § 11 names is the other.

**Open items.**

- **No runbook exists** — the same gap § 11 records, stated once more because this is the task that
  owes the document.
- The chapter requires the controlled record to be "routed to the named approval owner". **This
  version has been routed to nobody and claims no approval.**

## 14. Change control for the second version — section 49, CC-37

Recorded in the phase register as its own section; repeated here so this file states its own
allocation. **This section is historical and is left exactly as it was written**: it records the
allocation the second version took, and § 48.1's rule is that an identifier is never renumbered.
The re-measurement's own allocation is § 15.

**Allocation, read on `develop` `9b109f63`.** The register holds sections 1 … 48, 50, 51, 53 and
identifiers CC-01 … CC-41. **Section 49 and CC-37 are the lowest free pair**, and § 51.1 records
them as claimed by "a lane not on `develop`" — that lane is the abandoned first version of this
record, superseded here. **This record takes section 49 and CC-37, and neither is PROVISIONAL**,
because no lower number is held by any unmerged branch: the only unmerged claim on the register is
**PR #378** (`feature/p1-31-acceptance-harness`, open), which holds **section 52 and CC-40** — both
ABOVE this pair, so nothing here is taken from it and nothing here is renumbered to follow it.
_(Both statements were true when written. #379 merged that allocation; #378 merged as section 52 and
its identifier reconciled to CC-42 — § 13.)_

| id           | finding                                                                                     | disposition                                                                                                                                                                                                                                                                                 | owner / slice         | state            |
| ------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------- |
| **CC-37**    | the thirteen non-Frontend canonical tasks have no definition in the P1-31 chapter           | **transposed from P1-28 and declared as a transposition**, not presented as the chapter's words (see the second heading of this file). The alternative — closing a row against its own cited Test reference — is impossible: all three cited ids return zero files, filed by A0 as **D-16** | this record           | closed, recorded |
| **CC-37(a)** | eleven `wty.`/`rpt.` writes on this surface are held to no payload-mirror gate              | **recorded, not worked around.** `P1_30_DOMAINS` is `['svc','quo','inv','sal']` and the mirror allow-list names seven files under `apps/web/src/lib/contracts/`; the warranty and report mirrors live in their feature trees. Widening another phase's gate is not this record's to do      | a later slice         | open, recorded   |
| **CC-37(b)** | the seven `rpt.report-configuration-*` writes have no consumer outside a generated manifest | **recorded as the declared-but-never-wired shape**, measured rather than inferred: `apps/web` references them only in `src/lib/api/idempotent-operations.ts`. No screen is invented here to justify them, and no operation is withdrawn — the decision belongs to whoever owns the writer   | Owner / a later slice | open, recorded   |
| **CC-37(c)** | the bundle backfill has an unrecorded prerequisite                                          | **recorded from the external operator artefact (§ 11):** the backfill refuses, fail-closed, until the permission-catalogue seed has been applied to the target database. No repository record named that ordering before it was met. The remedy is the runbook DO-002 and DO-001 both owe   | a later slice         | open, recorded   |

## 15. Change control for this re-measurement — section 56, CC-46

Recorded in the phase register as its own section; repeated here so this file states its own
allocation.

**Allocation, read on `develop` `81b3bce8`.** The register holds sections **1 … 54 with no gap** and
identifiers **CC-01 … CC-44 with no gap** (§ 13). The lowest free pair is therefore section 55 with
CC-45, and **this re-measurement does not take it**: section 55 and CC-45 are claimed by a sibling
lane not on `develop`, which is recording that the task matrix's header declared a stale measurement
commit. **This record takes section 56 and CC-46**, the next pair above that claim. Nothing below it
is taken, nothing is renumbered, and § 48.1's rule holds: an identifier is a claim about the register
at the moment it was raised. A textual conflict with a sibling lane at merge time is expected and is
resolved by whoever integrates, never by renumbering an identifier.

_(True when written, and the expected thing then happened. Section 55 and CC-45 merged as **#381** at
`develop` `d517a5fc`, recording the phase closure record, so the sibling lane is no longer unmerged
and both allocations now sit side by side in the register. This record's own allocation is unchanged
— § 48.1's rule is that an identifier is never renumbered, and section 56 with CC-46 stays where it
was raised.)_

| id           | finding                                                                                   | disposition                                                                                                                                                                                                                                                                                             | owner / slice | state            |
| ------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------- |
| **CC-46**    | this index was measured at `9b109f63` and asserted that no P1-31 acceptance record exists | **re-measured at `81b3bce8` and corrected in place.** #378 and #380 merged after the measurement, and § 9's central statement became false rather than merely old. The whole file is re-derived on the new head; every corrected figure names what it replaces                                          | this record   | closed, recorded |
| **CC-46(a)** | SEC-003 sat at `not started` after the evidence its own state depended on had merged      | **moved to `phase-level incomplete`**, on the revision the second version invited and on § 3.1's four-part breakdown. Three parts have artefacts; **privilege widening across the phase as a set has none**, and that part is owed to a separate pull request rather than absorbed into this one        | this record   | closed, recorded |
| **CC-46(b)** | the twelve P1-31 permission codes had no phase-level reconciliation against the catalogue | **§ 1.1 publishes it**, derived from the parsed `defineOperation` output of `check-permission-parity.mjs`. The gate proves no code is fictitious and publishes no per-phase breakdown; this subsection is that breakdown and is explicitly **not** the least-privilege JUDGEMENT the task still owes    | this record   | closed, recorded |
| **CC-46(c)** | the OpenAPI shortfall was recorded for `sal.delivery-*` and is wider than that            | **re-measured, not re-quoted: all 45 P1-31 operations publish a success schema of exactly `{ "type": "object" }`.** A0 classified the shortfall as chapter-level and it stays there; the extent is recorded so the next reader does not measure a subset again. The generated file was not edited       | a later slice | open, recorded   |
| **CC-46(d)** | two figures in the second version did not reproduce on this head                          | **corrected in place with what they replace named** (§ 5, the three feature trees at 24/8/10 files rather than 15/6/6; § 12, the phase's own document counts). No slice touched those trees between the two heads, so the earlier figures counted something narrower than a recursive count of the tree | this record   | closed, recorded |

## Status

**Third version, unmerged at the time of writing, on a `feature/` branch.** It is to be updated as
the remaining work lands. An acceptance record now exists and its verdict is **PARTIAL**; it moved
twelve Frontend rows and no row above, so nothing in this file rises past `phase-level incomplete`
(rule 2, § 9). **No test tier, build, database operation or deployment was run to produce this
version.** Every figure is a static read of the tree at `81b3bce8`, the reported output of a static
checker named beside it, or a result quoted from
[`acceptance-record.md`](./acceptance-record.md) with the line it is stated at — and that derivation,
not this prose, is the authority.
