# P1-31 — security, QA, DevOps and documentation evidence (SEC-001 … SEC-004, QA-001 … QA-005, DO-001, DO-002, DOC-001, DOC-002)

**Status:** OPEN, second version · **Measured at:** protected `develop`
`9b109f639348db424940b00b022cfb36e2160e2c` (PR #377 merge) · **Companion records:**
[`task-matrix.md`](./task-matrix.md) (state per task), [`a0-preflight.md`](./a0-preflight.md)
(readiness), [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) (dispositions),
[`canonical-plan.md`](./canonical-plan.md) (the chapter's own task tables)

This version replaces a first version written at `develop` `01c32937` on an abandoned local branch
that was never merged and never opened as a pull request. Everything still true was carried over and
**every figure was re-measured on this head**, because eleven further slices have merged since: the
readiness queue screen, the delivery execution write paths, the printable handover document, the
warranty record and plan screens, the four report datasets, the report screens, the operational
overview, the delivering-employee identity and the Start selector. Nothing in this file is quoted
from the earlier draft without re-measurement.

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

## Four rules this record obeys

1. **`task-matrix.md` owns the state.** This file adds the proving artefact; it does not move a
   state. Where a measurement here would support a different state than the matrix carries, that is
   written as an engineering assessment and the matrix row is left alone.
2. **Nothing here reaches `end-to-end verified`.** `task-matrix.md:20-24` binds it: no task reaches
   that state until a P1-31 acceptance record exists, and **none exists on this head** — see § 9.
   The state vocabulary used below is the matrix's own (`task-matrix.md:26-37`).
3. **Every non-Owner statement is labelled.** **Measured fact** means read off this tree with the
   path given; **engineering assessment** means a judgement by this record's author, binding on
   nobody. No Owner decision is quoted beyond the ones named with their file and line.
4. **No tier was run for this record.** Test case counts are `it(` / `test(` call sites **counted
   statically** in the named file. Where a file uses `it.each`, the static count is a **floor**, not
   the executed total, and the section says so. No pass figure, no hosted run and no acceptance
   result is claimed anywhere in this file.

## Index

| item    | transposed definition (P1-28, onto P1-31)                                                 | section | state at `9b109f63`        |
| ------- | ----------------------------------------------------------------------------------------- | ------- | -------------------------- |
| SEC-001 | least-privilege permission and resolved-scope enforcement on every P1-31 read and write   | § 1     | phase-level incomplete     |
| SEC-002 | the sensitive splits, the export posture and file access                                  | § 2     | phase-level incomplete     |
| SEC-003 | scope hygiene and abuse cases: no client-asserted scope, cross-tenant, privilege widening | § 3     | not started (matrix)       |
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
`defineOperation` literals and are restated nowhere else.

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

**Evidence on develop at `9b109f63`.**

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

**State.** `phase-level incomplete` — the matrix's value, unchanged. **Engineering assessment:** the
proofs above are per-seam and per-operation; no artefact on this tree measures the property across
all 45 operations as a set, and rule 2 forbids any higher state regardless.

**Open items.**

- **D-9** (which codes gate the new reads) is answered per seam by the merged slices; no single
  record reconciles the twelve codes against the catalogue as a phase-level statement.
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

**Evidence on develop at `9b109f63`.**

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

**State.** `phase-level incomplete` — the matrix's value, unchanged.

**Open items.**

- **P-12 has not started.** No export route exists for any P1-31 resource and no entry for one
  exists in the resource registry, so the export half has an approved posture and no
  implementation. An approved withholding is a decided posture, not an undecided one.
- The file-access half now has a consumer that reads documents (signatures) and one that writes
  none (the printable sheet). **Engineering assessment:** nothing on this tree exercises a refused
  download from a P1-31 screen; that negative is the first thing this half owes.

## 3. SEC-003 — scope hygiene and abuse cases

**Transposed definition.** P1-28 SEC-003 is "no client-asserted scope" — any scope selector a read
surface needs enters as a NAMED exemption with a pinning test, never as a workaround — extended by
P1-30 to cover cross-tenant refusal and replay.

**Starting state (A0, `a0-preflight.md:73`).** "**Measurable today.** Permission delegation is
held-only in both the application and RLS, and the eligibility override is a single blocker
requiring a named permission."

**Evidence on develop at `9b109f63`.**

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

**State.** `not started` — the matrix's value, unchanged (measured at `f8958e77`, before the write
paths merged). **Engineering assessment:** at this head the delivery, warranty and report-
configuration write paths have all merged and the artefacts above exist, so a later matrix revision
has grounds to move this row to `phase-level incomplete`. This record does not move it.

**Open items.**

- **CC-10** is unchanged and was re-measured: `wty.warranty_record_status_history` has **no reader
  anywhere in `apps/api/src`**, so the warranty status ledger cannot be exercised by an abuse case
  that does not exist. **CC-31** names the missing reader as prerequisite P-18.
- **CC-16** is unchanged as a property, and its operator act has now been performed once on one
  local environment — see § 11, which states exactly where and what that does and does not prove.
- No artefact on this tree exercises privilege escalation across the phase as a set; every proof is
  scoped to its own seam.

## 4. SEC-004 — the write-shape gate and audit-event coverage

**Transposed definition.** P1-28 SEC-004 is the write-reachability gate — the
declared-but-never-wired class must not recur, and "the count is derived from the P1-24 register at
check time, never written down". The P1-31 chapter names this row "Security audit-event coverage",
so this section measures both: the write-shape gate the P1-28 definition asks for, and the audit
declarations the chapter's own name asks for.

**Starting state (A0, `a0-preflight.md:74`).** "**Measurable today.** Audit classes are declared on
all fourteen operations. Field 26 additionally requires that exports and privileged reads be
themselves audited."

**Evidence on develop at `9b109f63`.**

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

**Evidence on develop at `9b109f63`.** A0's "greenfield" no longer holds for any of the three.

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

- **Measured fact — three feature trees now exist.** `apps/web/src/features/delivery` (fifteen
  files, including four contract mirrors: `delivery-contract.ts`, `readiness-contract.ts`,
  `employee-contract.ts`, `branch-contract.ts`), `apps/web/src/features/warranty` (six files) and
  `apps/web/src/features/reports` (six files, with `reports-contract.ts` and
  `overview-contract.ts`). Nine dashboard pages sit on the surface: `delivery` and
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
- Two open pull requests touch these files and neither is counted above: **#372** (QA-006/QA-007,
  delivery DOM test races) and **#378** (§ 9).

## 6. QA-002 — API contract, error paths and replay shapes

**Transposed definition.** P1-28 QA-002 is the 428/409/422/403 branches per operation plus the
replay shapes, proved on real rows.

**Starting state (A0, `a0-preflight.md:81`).** "**Partly unscopable.** Three of the chapter's four
APIs have no contract to test, and the OpenAPI response schemas for all fourteen operations on this
surface are bare objects — which Field 23's closing bullet makes a chapter-level shortfall rather
than a P1-31 defect."

**Evidence on develop at `9b109f63`.** All three of A0's missing APIs now have contracts.

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

**State.** `phase-level incomplete` — the matrix's value, unchanged.

**Open items.**

- The report export operation (P-12) has no contract, so its error paths cannot be written.
- A0's OpenAPI observation is **not** re-measured here. `change-control-2026-09-08.md` § 41 records
  that `docs/api/openapi.v1.json` publishes `{ "type": "object" }` for every `sal.delivery-*`
  success response, which is the same shortfall A0 classified as chapter-level. It is not this
  record's to close.

## 7. QA-003 — tenant / company / branch isolation

**Transposed definition.** P1-28 QA-003 is isolation held in two layers that are never collapsed:
the database layer hides the parent, the application layer refuses the widening grant.

**Starting state (A0, `a0-preflight.md:82`).** "**Buildable.** Backend precedent exists in the P1-22
isolation suite; the scope-target mechanism is the thing under test."

**Evidence on develop at `9b109f63`.**

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

**State.** `phase-level incomplete` — the matrix's value, unchanged. No database or backend tier was
run for this record, so no pass figure is claimed from any file above.

**Open items.**

- Isolation is proved per seam. No artefact measures it across the 45 operations as a set.
- Per-slice proof is not phase acceptance; rule 2 applies.

## 8. QA-004 — concurrency, idempotency and record-version sourcing

**Transposed definition.** P1-28 QA-004 is version sourcing as a discipline: every version-guarded
write sources its `recordVersion` from a read or a command response, and every idempotent send
carries its transport key.

**Starting state (A0, `a0-preflight.md:83`).** "**Buildable.** `sal.delivery-complete` is the only
version-guarded operation on this surface (If-Match mandatory, ERR-CON-002 when absent); the other
five commands are idempotent by body key."

**Evidence on develop at `9b109f63`.** The surface has grown far past A0's measurement.

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

**State.** `not started` — the matrix's value, unchanged. **Engineering assessment:** the
declarations are countable, CC-17 is a closed disposition, and the matrix's stated dependency — the
write paths reaching screens — is now satisfied for delivery and warranty and unsatisfied for the
checklist templates and the report configuration writer. No artefact on this tree exercises
concurrency across the phase.

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

**Evidence on develop at `9b109f63`.**

- **Measured fact — the precedent.**
  [`../phase-1-30/w9-acceptance-record.md`](../phase-1-30/w9-acceptance-record.md) exists on this
  tree and is the shape a P1-31 acceptance record would take: a fresh-organisation session recorded
  step by step, with the API's own correlation reference carried on every recorded step.
- **Measured fact — the gap, re-read.** `docs/phase-1/phase-1-31/` holds **28 files at this head and
  no file whose name contains "acceptance"**. **No P1-31 acceptance record exists, and no P1-31
  acceptance run has happened.**
- **Measured fact — the harness is in an OPEN pull request and is NOT on develop.** **PR #378**,
  "P1-31 QA-005: fresh-organisation acceptance harness and browser specs", head
  `feature/p1-31-acceptance-harness` at `0a1bba2a`, state OPEN. It carries
  `scripts/dev/owner-acceptance/p1-31-journey.mjs`, four browser specs
  (`apps/web/tests/e2e/authenticated/{delivery,warranty,reports,audit-log}-p1-31.spec.ts`), the
  shared helper `p1-31-handoff.ts`, `docs/phase-1/phase-1-31/acceptance-plan.md`,
  `.github/ci-baselines/unrun-test-tiers.json`, and edits to this phase's task matrix and change
  register. **Each of those seven new paths was checked individually on this tree and is absent.**
  So: the harness is written, it is not merged, and **the run has not happened**. No result from it
  is claimed here, because there is none.
- **Measured fact — the regression artefacts that do exist per slice** are recorded in
  `task-matrix.md` and in the register sections named there. This record does not restate those
  figures, because it did not run the tiers that produced them and a re-quoted number is the
  stale-count defect `scripts/ci/check-p1-27-doc-counts.mjs` exists to refuse.
- **Owner policy, quoted.** The standing verification policy of 2026-09-09
  (`owner-decisions-2026-09-09.md:116-122`): "Targeted local checks plus the required hosted gates
  are the standing expectation. The local `verify:workspaces` aggregate is **not** a per-commit
  prerequisite." That is the policy under which the slice proofs above were taken.

**State.** `phase-level incomplete` — the matrix's value, unchanged, and the ceiling rule 2 sets.

**Open items.**

- **The phase acceptance record does not exist.** Until it does, no row in this file can reach
  `end-to-end verified`, by construction rather than by judgement.
- **D-16's convention half is unresolved in the chapter's own terms:** the chapter requires
  `_acceptance/`, this repository uses `docs/phase-1/phase-1-NN/*acceptance*.md`, and no record
  reconciles the two. PR #378 proposes `acceptance-plan.md` in the repository's convention.

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

**Evidence on develop at `9b109f63`.**

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

**Evidence on develop at `9b109f63`.**

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

**Evidence on develop at `9b109f63`.**

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
- **Measured fact — this phase's contract documents.** Fifteen slice records exist under
  `docs/phase-1/phase-1-31/` beside the four governance records; the `d4-report-definitions.md`
  mapping is the reporting contract the four datasets were built against.

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

**Evidence on develop at `9b109f63`.**

- **Measured fact — the controlled record and exactly what it now holds.**
  [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) is P1-31's change record. On this
  head it carries **numbered sections 1 … 48, 50, 51 and 53 — 51 sections, with 49 and 52 absent —
  and identifiers CC-01 … CC-41.** Its **highest section is 53** ("The operational overview",
  FE-010/FE-016, PR #376) and its **highest identifier is CC-41**, allocated to the same slice. The
  two gaps are not errors: § 51.1 records that **section 49 with CC-37** is claimed by a lane not on
  `develop`, and **section 52 with CC-40** by the acceptance-harness lane, also not on `develop`.
  § 48.1's rule is that an identifier is a claim about the register at the moment it was raised and
  is never renumbered to follow heading order.
- **Measured fact — the two claims on the gaps, resolved.** Section 49 / **CC-37** was claimed by
  the abandoned first version of _this_ record, which was never merged and is superseded by this
  file; § 14 below therefore takes that pair rather than leaving a permanent hole. Section 52 /
  **CC-40** is claimed by **PR #378**, which is open (§ 9) and holds a HIGHER pair, so it takes
  nothing from this one.
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

## 14. Change control for this record — section 49, CC-37

Recorded in the phase register as its own section; repeated here so this file states its own
allocation.

**Allocation, read on `develop` `9b109f63`.** The register holds sections 1 … 48, 50, 51, 53 and
identifiers CC-01 … CC-41. **Section 49 and CC-37 are the lowest free pair**, and § 51.1 records
them as claimed by "a lane not on `develop`" — that lane is the abandoned first version of this
record, superseded here. **This record takes section 49 and CC-37, and neither is PROVISIONAL**,
because no lower number is held by any unmerged branch: the only unmerged claim on the register is
**PR #378** (`feature/p1-31-acceptance-harness`, open), which holds **section 52 and CC-40** — both
ABOVE this pair, so nothing here is taken from it and nothing here is renumbered to follow it.

| id           | finding                                                                                     | disposition                                                                                                                                                                                                                                                                                 | owner / slice         | state            |
| ------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------- |
| **CC-37**    | the thirteen non-Frontend canonical tasks have no definition in the P1-31 chapter           | **transposed from P1-28 and declared as a transposition**, not presented as the chapter's words (see the second heading of this file). The alternative — closing a row against its own cited Test reference — is impossible: all three cited ids return zero files, filed by A0 as **D-16** | this record           | closed, recorded |
| **CC-37(a)** | eleven `wty.`/`rpt.` writes on this surface are held to no payload-mirror gate              | **recorded, not worked around.** `P1_30_DOMAINS` is `['svc','quo','inv','sal']` and the mirror allow-list names seven files under `apps/web/src/lib/contracts/`; the warranty and report mirrors live in their feature trees. Widening another phase's gate is not this record's to do      | a later slice         | open, recorded   |
| **CC-37(b)** | the seven `rpt.report-configuration-*` writes have no consumer outside a generated manifest | **recorded as the declared-but-never-wired shape**, measured rather than inferred: `apps/web` references them only in `src/lib/api/idempotent-operations.ts`. No screen is invented here to justify them, and no operation is withdrawn — the decision belongs to whoever owns the writer   | Owner / a later slice | open, recorded   |
| **CC-37(c)** | the bundle backfill has an unrecorded prerequisite                                          | **recorded from the external operator artefact (§ 11):** the backfill refuses, fail-closed, until the permission-catalogue seed has been applied to the target database. No repository record named that ordering before it was met. The remedy is the runbook DO-002 and DO-001 both owe   | a later slice         | open, recorded   |

## Status

**Second version, unmerged at the time of writing, on a `feature/` branch.** It is to be updated as
the remaining work lands; the acceptance record does not exist and until it does no row above can
rise past `phase-level incomplete`. **No test tier, build, database operation or deployment was run
to produce it.** Every figure is a static read of the tree at `9b109f63` or the reported output of a
static checker named beside it, and that derivation — not this prose — is the authority.
