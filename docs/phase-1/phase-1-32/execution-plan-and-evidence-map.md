# P1-32 — compact execution plan and evidence-reuse map

Companion to [`canonical-plan.md`](./canonical-plan.md). That file extracts the chapter; this one
maps the chapter's 27 tasks onto the frontend modules delivered by Phases 1-25 through 1-31, onto
the evidence that already exists for them, and onto the obligations that genuinely have no evidence
at all.

---

## A. Status banner

**This document is preparatory. Nothing in it was executed and nothing in it passed.**

**The dependency rule, as the chapter states it.** P1-32 names its dependency by phase, never by
gate identifier; the string `P1-G31` does not occur anywhere in ¶19882–20363. Field 8 (¶19918),
whole field, verbatim:

> Phases 1-25…1-31 and backend gate Phase 1-24

Field 7's first bullet (¶19913), verbatim:

> The dependencies in Field 8 have passed their recorded exit gates: Phases 1-25…1-31 and backend
> gate Phase 1-24.

The operative rule is those two sentences read against Phase 1-31's own exit gate. P1-31 Field 33,
¶19875, verbatim:

> Gate P1-G31: RootLco may authorize dependent work only when the Definition of Done is evidenced,
> the QA lead certifies the test/evidence index, the Security reviewer clears applicable blockers,
> and the approval owner records Pass / Conditional Pass / Fail / Deferred with conditions. Until
> then, status remains Planned.

P1-32's precondition requires that Phase 1-31 has passed its recorded exit gate. P1-G31 is that
gate, and its four conditions are conjunctive. The construction is two-document and is stated here
so a reader can check it rather than take it.

**Gate P1-G31 is not satisfied at `develop` `7a1e1eef`.** Conditions 2 and 3 await nine human
determinations; the certification and clearance fields are empty. Recorded at
[`../phase-1-31/owner-decision-packet-2026-09-16.md`](../phase-1-31/owner-decision-packet-2026-09-16.md)
lines 673–678:

> **P1-31 is not promoted.** `main` is `1262de74` and is unchanged by this phase.
> [`closure-record.md`](./closure-record.md) § 6 records that the phase is **not eligible** for
> promotion, and gate P1-G31's four conditions are conjunctive.

The relative link inside that quotation is the source file's own and resolves in the P1-31
directory; it is reproduced rather than rewritten because the quotation is byte-exact.

And, at the same file, the Product Owner's instruction of 2026-09-15, quoted whole at lines 55–57:

> Do not promote or start P1-32 until the applicable gate conditions and actual approvals are
> satisfied. Once they are satisfied, complete the already-authorized promotion and protected
> verification without asking again for routine push/merge permission.

**Consequence.** No P1-32 task is started, and none may be. Every task's status is the chapter's
own `Planned`. This document performs the preparation and evidence mapping the dependency rules
permit and labels it as such. Every validation step named below is marked **NOT RUN**, and none was
run in producing this document — no test, journey, browser, coverage, build, stack, database or
hosted job of any kind.

**Out of scope here.** Phase 1-33, end-to-end integration, deployment and any production release.
Gate P1-G32 (¶20357) gates those, not this preparation, and it is not addressed by this document.

---

## B. The compact execution plan

### The order the chapter imposes

The chapter's dependency cells give **five independent linear chains that never join**
([`canonical-plan.md`](./canonical-plan.md), "The dependency graph"). Within the Frontend chain the
order is strict and total: FE-001 → FE-002 → … → FE-014, each task naming only its immediate
predecessor. The SEC, QA, DO and DOC chains are each strict and total within themselves, and each
head depends on the dependency phases rather than on any Frontend task — so **the chapter does not
serialise them behind the Frontend chain**. They are presented after the Frontend steps below
because that is the reading order, not because the chapter orders them that way.

Every step below is a description of what the task will need when it is authorised to start. None
is an instruction to start it.

### Frontend chain

| Step   | Task                                         | What the step will need                                                                                                                                                    | Module groups it covers        |
| ------ | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| FE-001 | UI-prototype fidelity review                 | A resolved fidelity basis per module (§ D), because the artefact the acceptance sentence names does not exist; then a per-screen conformance instrument against that basis | all seven                      |
| FE-002 | functional review                            | A committed, re-executable browser suite per module; five of the seven groups have one, two do not                                                                         | all seven                      |
| FE-003 | Arabic/English review                        | Screen-level Arabic rendering evidence, plus resolution of the composed message keys that no static checker can read                                                       | all seven                      |
| FE-004 | RTL/LTR review                               | A right-to-left render for the six component suites that have none, and right-to-left browser coverage for the modules with no browser suite at all                        | P1-29, part of P1-30           |
| FE-005 | desktop/tablet testing                       | Tablet-viewport selection of the specs that exist, and a tablet run in Arabic, which no project currently combines                                                         | all seven                      |
| FE-006 | accessibility testing                        | A route-level scan list extended past the administration, customer and vehicle routes; the scan's own account precondition recorded, not edited                            | P1-28 … P1-31 mainly           |
| FE-007 | keyboard testing                             | A per-screen interactive-element inventory for the modules whose keyboard evidence is inherited from primitives rather than measured                                       | P1-29, P1-30, wizards          |
| FE-008 | print-layout testing                         | Browser print emulation against the four business print documents, and disposition of the one open print defect                                                            | P1-28, P1-30, P1-31            |
| FE-009 | loading/empty/error/permission-state testing | A four-state matrix per screen, and static resolution of the composed state keys                                                                                           | all seven                      |
| FE-010 | slow-network testing                         | A throttling harness design and a per-screen expectation of what must appear inside the delay window; there is no existing evidence to reuse                               | all seven                      |
| FE-011 | file-upload testing                          | The five upload surfaces tabulated against the contract's declared limits, and the limits with no screen-level case named                                                  | P1-27, P1-28, P1-31            |
| FE-012 | browser compatibility                        | A second and third rendering engine, with the case subset each would run and the install cost stated                                                                       | all seven                      |
| FE-013 | frontend automated tests                     | A statement of which feature roots are inside the coverage gate and which are outside, and which figures are hosted rather than local                                      | all seven                      |
| FE-014 | E2E preparation                              | A fixture-world specification: the entity chain each uncovered module's specs need and which harness step already creates each link                                        | all seven, P1-29/P1-30 acutely |

### The other four chains

| Step    | Task                                                | What the step will need                                                                                                     | Module groups it covers |
| ------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| SEC-001 | Permission and resolved-scope enforcement           | Disposition of the carried permission-bundle finding that leaves a first administrator unable to reach one work-order write | all seven               |
| SEC-002 | Sensitive-data, export, and file-access controls    | The two open download and disclosure-audit limitations restated as inputs with their citations                              | P1-28, P1-31            |
| SEC-003 | Abuse-case and privilege-escalation controls        | The existing permission and isolation suites read as a starting inventory                                                   | all seven               |
| SEC-004 | Security audit-event coverage                       | The existing audit surface read as a starting inventory                                                                     | all seven               |
| QA-001  | Unit and component test coverage                    | Which coverage figures are hosted and which are local, per feature root                                                     | all seven               |
| QA-002  | API/contract and error-path coverage                | The contract suites already present, read as an inventory                                                                   | all seven               |
| QA-003  | Tenant/company/branch isolation coverage            | The existing isolation suites, read as an inventory                                                                         | all seven               |
| QA-004  | Concurrency and idempotency coverage                | The existing conflict and replay suites, read as an inventory                                                               | all seven               |
| QA-005  | Regression and evidence packaging                   | The pending-hosted mechanism, and the rule that a collection is not an execution                                            | all seven               |
| DO-001  | Continuous-integration quality gate                 | The standing constraint that any new npm script must be registered in the command-coverage gate in the same change          | all seven               |
| DO-002  | Structured logging, monitoring, and alert routing   | The existing hosted job summary behaviour, including the open limitation on which register it renders                       | all seven               |
| DOC-001 | Contract, catalog, and traceability synchronization | The Field 34 synchronization set, which every task row names and which lists documents rather than per-task artefacts       | all seven               |
| DOC-002 | Operator/developer guidance and change-log update   | The same set, plus the carried documentation limb that is the Owner's                                                       | all seven               |

### The seven module groups

| Group | Phase | Modules                                                                                                                         |
| ----- | ----- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1     | P1-25 | design-system foundation, application shell, gallery, print primitives, language and direction layer, brand and token authority |
| 2     | P1-26 | authentication and administration                                                                                               |
| 3     | P1-27 | customer records and vehicles                                                                                                   |
| 4     | P1-28 | appointments, vehicle reception, attachments and evidence capture                                                               |
| 5     | P1-29 | work orders, diagnostics, technicians, quality and closure                                                                      |
| 6     | P1-30 | service catalogue, pricing, quotations, inventory, billing, payments                                                            |
| 7     | P1-31 | vehicle delivery, warranty, reporting                                                                                           |

---

## C. The evidence-reuse map

One row per task-and-module pairing. Heads: `develop 7a1e1eef` unless a row names another. Every
citation below is one the source survey cites; nothing is added. Where no evidence exists the cell
reads NONE. Row notes carrying the detail that does not fit a cell follow the table.

| Task                             | Module                     | Existing evidence (file:line, head, local/hosted, executed/skipped)                                                                                                                                                                                                                                                                                                                                                                                                | Genuine uncovered obligation                                                                                                                                                                                                                                                                                                                                       | Next action (validation NOT RUN)                                                                                                                                                                                                                                           |
| -------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FE-001 prototype fidelity        | all seven                  | Mechanised conformance only, local+hosted, executed: `package.json:149`, `:150`, `:151`, `:59`; `apps/web/tests/stylelint-policy.test.ts`; `brand-replacement.test.ts`; `gallery-and-print.dom.test.tsx` (19 cases). One human review: `../phase-1-25/gate-record.md:123-133`, head `ac7c089c`                                                                                                                                                                     | No per-screen fidelity review for any business screen of P1-26…P1-31; a token checker cannot prove a screen looks like an approved layout, and no such artefact exists (§ D)                                                                                                                                                                                       | Draft a per-screen fidelity instrument with an empty verdict field. NOT RUN: the theme, brand and token validators, the style check, the web unit tier                                                                                                                     |
| FE-002 functional review         | P1-25, P1-26, P1-27        | `apps/web/tests/e2e/foundation.spec.ts:28-300`; `e2e/authenticated/administration.spec.ts`, `crm-and-vehicles.spec.ts`, `shared-ux.spec.ts`, `drawer-and-restore.spec.ts`; `e2e/shared-ux-anonymous.spec.ts`; by hand: `../phase-1-26/owner-acceptance-runtime-evidence.md`, `../phase-1-27/owner-acceptance-checklist.md`. Anonymous hosted+executed; authenticated hosted, executed only under the opt-in flag (note 1)                                          | None new beyond re-execution at the P1-32 head                                                                                                                                                                                                                                                                                                                     | Pin the spec inventory from a static collection, recorded as a collection. NOT RUN: both browser tiers                                                                                                                                                                     |
| FE-002 functional review         | P1-28                      | `e2e/authenticated/appointments-and-receptions.spec.ts` (hosted, executed under the opt-in flag); eleven reception, appointment and media component suites (note 2); `../phase-1-28/closure-record.md:5`. Local+hosted, executed                                                                                                                                                                                                                                   | None new for functional review                                                                                                                                                                                                                                                                                                                                     | None beyond the inventory. NOT RUN: the web unit tier, the authenticated browser tier                                                                                                                                                                                      |
| FE-002 functional review         | P1-29                      | Component suites only: `diagnostics.dom.test.tsx`, `quality.dom.test.tsx`, `technician-workspace.dom.test.tsx`, `work-order-delivery-mount.dom.test.tsx` and five matching contract suites; browser proof is a hand walk, not committed: `../phase-1-29/w9-acceptance-record.md:85-109`, head `c3c62398`. Local, executed                                                                                                                                          | Zero committed browser coverage for every P1-29 route; the only browser proof is an unrepeatable hand walk in prose, while Gate P1-G32 requires green automated suites for every module                                                                                                                                                                            | Draft specs for the P1-29 routes, modelled on the P1-31 delivery spec, and state each fixture. NOT RUN: the authenticated browser tier                                                                                                                                     |
| FE-002 functional review         | P1-30                      | Component suites only, thirteen of them, plus matching contract suites (note 3); browser: `../phase-1-30/closure-record.md:87-90`, nine cases on a production build of `3d752119`, cited to `../phase-1-29/w9-acceptance-record.md` § 7.2. Local executed; the browser run not re-executable                                                                                                                                                                       | Those nine cases are not in the repository at this head; six P1-30 modules have no re-executable browser coverage                                                                                                                                                                                                                                                  | Recover the nine subjects from the acceptance record and specify committed replacements, one per module. NOT RUN: the authenticated browser tier                                                                                                                           |
| FE-002 functional review         | P1-31                      | Committed and hosted: `e2e/authenticated/delivery-p1-31.spec.ts`, `delivery-writes-p1-31.spec.ts`, `warranty-p1-31.spec.ts`, `reports-p1-31.spec.ts`, `overview-p1-31.spec.ts`, `audit-log-p1-31.spec.ts`; closing run at `../phase-1-31/change-control-2026-09-08.md:8679`, head `849a8e9a`; earlier runs at `../phase-1-31/acceptance-record.md:28` and `:1326`. Local harness, executed                                                                         | The phase is not gated, so none of it is an accepted baseline; this is the evidence that must not be generalised to other modules                                                                                                                                                                                                                                  | Record the delivery, warranty and reporting spec set as the template for modules that lack one, not as coverage of them. NOT RUN: the acceptance harness, the authenticated browser tier                                                                                   |
| FE-003 Arabic/English            | all — catalogues           | `apps/web/tests/i18n.test.ts` (11 cases); `package.json:137`; `apps/web/tests/field-error-translation.test.ts`; `shell-viewport.dom.test.tsx:7-8`. Local+hosted, executed                                                                                                                                                                                                                                                                                          | Catalogue parity is proven; screen-level Arabic rendering is not, for the modules with no Arabic component render and no Arabic browser run. A live composed-key defect is open (note 4)                                                                                                                                                                           | Enumerate the 18 composed-key sites and resolve each key statically against both catalogues. NOT RUN: the plain-language validator, the web unit tier                                                                                                                      |
| FE-004 RTL/LTR                   | P1-25…P1-28, P1-30p, P1-31 | `apps/web/tests/render.tsx` helpers, used by 57 of 73 component suites; browser projects at `apps/web/playwright.config.ts:156-163`, `:174-181`, `:214-223`; `foundation.spec.ts:29`, `:131`. Local+hosted, executed                                                                                                                                                                                                                                               | Six suites render left-to-right only (note 5); combined with no browser suite for P1-29 and most of P1-30, four modules have no right-to-left evidence of any kind                                                                                                                                                                                                 | List per uncovered screen the components needing a right-to-left case and any logical-property violation found statically. NOT RUN: the web unit tier, the style check, the authenticated browser tier                                                                     |
| FE-005 desktop/tablet            | all seven                  | `apps/web/tests/shell-viewport.dom.test.tsx` (13 cases); browser projects at `playwright.config.ts:147-163`, `:165-172`, `:174-181`, `:183-187`, `:203-223`, `:254-294`; `foundation.spec.ts:147`, `:166`. Hosted, executed                                                                                                                                                                                                                                        | `playwright.config.ts:264` records that the P1-31 specs ran at one desktop size only, so the tablet project selects none of them; the tablet project is one locale only (`:294`), so no screen has tablet plus Arabic evidence                                                                                                                                     | Read `playwright.config.ts:226-294` and write down which spec files the tablet project selects today. NOT RUN: the authenticated browser tier                                                                                                                              |
| FE-006 accessibility             | P1-25, P1-26, P1-27        | Route-level: `e2e/authenticated/accessibility.spec.ts`, routes at `:138-163`; rulesets and injection recorded at `../phase-1-26/authenticated-accessibility-evidence.md:13-15` and `:19-30`; pre-assertion `:183-185`; canary `:290-296`. Component-level in four suites only (note 6). Hosted, executed — but see the skip                                                                                                                                        | The spec skips itself unless the signed-in account is the acceptance fixture (`:27-34`, marker at `:29`), so a handoff-driven local run executes zero cases and reports green; and the route list reaches no P1-28…P1-31 route                                                                                                                                     | Extend the route list on paper from the dashboard route pages, noting which need a record identifier and therefore a fixture; record the skip as a precondition, not a defect to edit. NOT RUN: the authenticated browser tier, the web unit tier                          |
| FE-006 accessibility             | P1-28, P1-29, P1-30, P1-31 | NONE at route level. NONE at component level. Nearest artefact is prose: `../phase-1-26/accessibility-evidence.md:16-28`, an inheritance argument                                                                                                                                                                                                                                                                                                                  | Complete. No executed accessibility measurement of any kind for any module in these four groups                                                                                                                                                                                                                                                                    | Per module, list the screens and whether each composes only shared primitives, from a static import scan, so the inheritance argument can be checked. NOT RUN: everything                                                                                                  |
| FE-007 keyboard                  | P1-25…P1-28, P1-31p        | `e2e/foundation.spec.ts:71`, `:120`, `:233`, `:251` and 16 focus references; `drawer-and-restore.spec.ts`, `shared-ux.spec.ts`, `shared-ux-anonymous.spec.ts`, `crm-and-vehicles.spec.ts`; component level in `overlays.dom.test.tsx`, `p1-27-owner-acceptance.dom.test.tsx`, `delivery.dom.test.tsx`, `reception-condition-evidence.dom.test.tsx`, `lib-coverage.dom.test.tsx`. Local+hosted, executed                                                            | Evidence is concentrated in the P1-25 primitives and the sign-in page; no keyboard case for any P1-29 or P1-30 screen, nor for the multi-step wizards or the signature and receiver widgets outside one suite. A sibling worktree named for this task exists and was not read (note 7)                                                                             | Derive the per-screen interactive-element inventory statically for the uncovered modules and name the widgets that are not shared primitives; ask the coordinator about the sibling worktree. NOT RUN: everything                                                          |
| FE-008 print layout              | P1-25, P1-28, P1-30, P1-31 | Authority `apps/web/src/components/print/PrintDocument.tsx` with exactly four consumers (note 8); suites `gallery-and-print.dom.test.tsx`, `delivery-document.dom.test.tsx`, `reception-acknowledgement.dom.test.tsx`, `invoices.dom.test.tsx`, `payments.dom.test.tsx`, all both directions; `playwright.config.ts:12`; `../phase-1-31/closure-record.md` FE-007 row. Local+hosted, executed                                                                      | Bounded and largely covered, with two gaps: no browser print emulation against the four business documents, only against the gallery sample; and one open print defect at `../phase-1-31/change-control-2026-09-08.md:1956`, where the printed sheet carries a reference where a person's name belongs                                                             | Record the four documents, their component coverage and that open defect; specify a browser print-emulation case per document. NOT RUN: the web unit tier, the authenticated browser tier                                                                                  |
| FE-009 four states               | all seven                  | `loading-boundary.dom.test.tsx` (4 cases), `search-empty-states.dom.test.tsx` (11), `write-permission-gating.dom.test.tsx` (11), `route-permission-binding.test.ts`, `p1-27-permission-route-binding.dom.test.tsx`, `p1-28-permission-route-binding.test.ts`, `read-completeness.test.ts`. Local, executed                                                                                                                                                         | The state machinery is proven on the customer and vehicle screens and on the shared boundary components, not per screen; and the composed-key defect makes the state strings themselves unverifiable at 18 sites across 11 files (note 4)                                                                                                                          | Resolve each composed key statically and diff against both catalogues; produce a four-state matrix per screen. NOT RUN: the web unit tier, the plain-language validator                                                                                                    |
| FE-010 slow network              | all seven                  | NONE that measures a slow network. The nearest are abort paths at `api-client.test.ts:381-384` and `observability.test.ts:351`, a throttled-failure mapping at `authentication.test.ts:192`, comments at `crm-customer-search.dom.test.tsx:13`, `crm-customer-create.dom.test.tsx:253`, `crm-customer-status.dom.test.tsx:8-17`, and a motion-duration scale at `e2e/foundation.spec.ts:344`. Local, executed — none is a slow-network test                        | Complete and total. No throttling, no delay fixture, no network-condition emulation, no offline case, no screen-level timeout assertion. Zero evidence for all seven groups; the largest single hole in the phase                                                                                                                                                  | Specify a throttling harness design and a per-screen expectation of what must appear inside the delay window; enumerate the screens whose first paint depends on a network read. Write no code. NOT RUN: everything                                                        |
| FE-011 file upload               | P1-27, P1-28, P1-31        | Surfaces from a static scan (note 9); suites `attachments-contract.test.ts` (9 cases), `p1-28-reception-media.dom.test.tsx` and `.test.ts`, `reception-evidence.test.ts`, `vehicle-documents.dom.test.tsx` and `.test.ts`, `delivery-signature-refusal.dom.test.tsx`; security negative at `474d89ef`, recorded in the P1-31 closure record FE-006 row. Local, executed                                                                                            | No browser-level upload of a real file on any surface — every case mocks the transport; no oversized-file, rejected-type, scan-failed or interrupted-upload case. One adjacent open limitation on download authorization at `../phase-1-31/change-control-2026-09-08.md:8321`                                                                                      | Tabulate the five upload surfaces against the contract's declared limits and name which limit has no screen-level case. NOT RUN: the web unit tier                                                                                                                         |
| FE-012 browser compatibility     | all seven                  | Every browser project, anonymous and authenticated, uses one desktop engine: `playwright.config.ts:150`, `:159`, `:168`, `:177`, `:186`, `:200`, `:207`, `:218`, `:291-292`; the only variability at `:141` selects a channel of the same engine. Manual records `../phase-1-25/remediation/chrome-review-evidence.md`, `../phase-1-27/installed-chrome-review.md`. Local+hosted, executed, one engine only                                                        | No second and no third rendering engine anywhere in the repository. The literal subject of this task has never been tested for any module. A direction-specific layout defect confined to one engine would have been invisible in every run to date                                                                                                                | Specify the project additions with the case subset each would run and the install cost; record that the browser-install command has no root wrapper. NOT RUN, and NOT INSTALLED: any browser install, either browser tier                                                  |
| FE-013 automated tests           | all seven                  | 168 files under `apps/web/tests/`, 73 of them component suites; baseline `.github/ci-baselines/coverage-baseline.web.json`; `../phase-1-31/coverage-record.md`, status OPEN at `:3`, quoting two hosted runs with their artefact identities and digests. Hosted, executed                                                                                                                                                                                          | The record's later figures are local measurements for which no hosted run has been read — its own note at `:10-19`, which is the carried item CC-64 (b); and the record measures the P1-31 roots, not the P1-29 or P1-30 roots. A standing warning that the coverage gate script is in no npm script is UNVERIFIED here and was not re-checked                     | Read the coverage baseline and the web unit-test config include list and state which feature roots are inside the gate; confirm statically whether the coverage-gate script is referenced by any npm script. NOT RUN: any coverage run, any hosted dispatch                |
| FE-014 E2E preparation           | all seven                  | `apps/web/playwright.config.ts` (nine projects, one worker at `:124`, opt-in at `:63`); `e2e/origin.ts`; `e2e/authenticated/auth.setup.ts`; `account-manifest.ts` and `.json`; `p1-31-handoff.ts`; the acceptance harness named at `../phase-1-31/change-control-2026-09-08.md:7331`; the governed hosted job `.github/workflows/_reusable-authenticated-browser.yml`; `../phase-1-31/acceptance-plan.md`. Hosted, executed                                        | CC-62 (b) is open at `../phase-1-31/change-control-2026-09-08.md:7856`: no hosted run and no execution of the declared fixture command is recorded at that head. CC-62 (c) at `:7857` is open on the hosted summary rendering one register or the other. The fixture problem generalises: no current setup builds a world that reaches the P1-29 and P1-30 screens | Write the fixture-world specification — the entity chain each uncovered module needs and which harness step already creates each link. Stand nothing up. NOT RUN: the database stack, the acceptance harness, the authenticated browser tier, any hosted dispatch          |
| SEC-001 permission and scope     | all seven                  | `route-permission-binding.test.ts`, `p1-27-permission-route-binding.dom.test.tsx`, `p1-28-permission-route-binding.test.ts`, `write-permission-gating.dom.test.tsx`, `navigation.test.ts`, `security.test.ts`, `p1-27-security.test.ts`, `p1-28-security.test.ts`, `e2e/isolation.spec.ts`, the authorization-coverage and permission-catalog validators; backend side `../phase-1-31/least-privilege-grant-map.md`, `isolation-matrix.md`. Local+hosted, executed | One finding is carried unrepaired from P1-31 (`../phase-1-31/closure-record.md` § 5.2): a work-order service-line management permission is absent from the tenant-administrator bundle, so a fresh organisation's first administrator is refused and cannot record a service line or a required-part demand at all. Backend owns the change; it is a packet item   | Name the P1-29 screens whose actions depend on that permission and state what a first administrator sees today. NOT RUN: the authorization-coverage validator, the security aggregate                                                                                      |
| SEC-002 sensitive data and files | P1-28, P1-31               | `p1-28-sensitive-narratives.dom.test.tsx`; the refused-download negative at `474d89ef`; `../phase-1-31/report-export-seam.md:79-82`; `report-export.dom.test.tsx`. Local, executed; the P1-31 half also in the acceptance harness                                                                                                                                                                                                                                  | Two open limitations bear directly: the disclosure audit cannot identify the exact bytes downloaded (`../phase-1-31/change-control-2026-09-08.md:7613`), and the download authorization does not refuse a caller whose file-access grant is scoped to another branch (`:8321`). Both are recorded limitations, not closures                                        | Restate both as inputs with their citations. NOT RUN: everything                                                                                                                                                                                                           |
| QA-001 and QA-005 coverage       | all seven                  | `../phase-1-31/coverage-record.md` (status OPEN); `../phase-1-31/security-and-qa-evidence.md` § 5; `../phase-1-31/task-matrix.md`; the pending-hosted mechanism. Hosted, executed for the two named runs                                                                                                                                                                                                                                                           | CC-64 (b) is open at `../phase-1-31/change-control-2026-09-08.md:8905`: the coverage figures stay local although the hosted job ran. So the coverage evidence P1-32 would inherit is partly unhosted at this head                                                                                                                                                  | State which coverage figures are hosted and which are local, per feature root, from the two named artefacts. NOT RUN: no hosted dispatch, no coverage run                                                                                                                  |
| DO-001 CI quality gate           | all seven                  | `.github/workflows/_reusable-node-quality.yml`; `.github/workflows/_reusable-authenticated-browser.yml`, in the needs list of both gates per `playwright.config.ts:56-57`; `scripts/ci/check-command-coverage.mjs`; the policy aggregate at `package.json:160`. Hosted, executed                                                                                                                                                                                   | CC-62 (c) at `../phase-1-31/change-control-2026-09-08.md:7857` is open: the hosted summary renders one register or the other, never both. CC-64 (a) at `:8904` is open on this task's own state                                                                                                                                                                    | Record as a standing constraint that any npm script P1-32 adds must be registered in the command-coverage gate in the same change, with owner, tier and reason. NOT RUN: everything                                                                                        |
| DOC-001 and DOC-002              | all seven                  | The Field 34 synchronization set, named by every task row and enumerated at ¶20359–20361; all of those files are present in the workspace                                                                                                                                                                                                                                                                                                                          | CC-65 (a) is open and is the Owner's (`../phase-1-31/change-control-2026-09-08.md:9205`). Its documentation limb is a P1-31 item, not a P1-32 one, but it blocks the documentation lane's clean handover                                                                                                                                                           | This pair of documents is the first artefact, built by the extraction rule the canonical plan states. No P1-32 register, task matrix or acceptance record is created yet. NOT RUN: the encoding validator is run as a documentation gate on this change only; nothing else |

### Row notes

1. The authenticated browser tier executes only when its opt-in variable is set, which the hosted
   workflow does; `apps/web/playwright.config.ts:63` and `:73-79` record that for the whole of P1-27
   no workflow set it and the tier sat unexecuted while reporting green.
2. `reception-checkin`, `reception-queue`, `reception-walkin`, `reception-summary`,
   `reception-acknowledgement`, `reception-readings-and-signoff`, `reception-condition-evidence`,
   `appointments-booking`, `appointments-calendar`, `appointment-detail`, `p1-28-reception-media` —
   all under `apps/web/tests/`.
3. `services-catalogue`, `services-detail`, `pricing`, `price-list-detail`, `quotations`,
   `quotation-detail`, `inventory`, `inventory-parts`, `inventory-movements`,
   `inventory-opening-stock`, `inventory-setup`, `invoices`, `payments` — all under
   `apps/web/tests/`.
4. The composed-key defect: 18 sites across 11 files compose a state key from a read-failure status
   at runtime, so no static checker can resolve the rendered text — four in the diagnostics feature,
   six in quality, three in the technician work panel, three in work orders, one in the delivery
   paged-list helper, one in the warranty shared component. The disposition that states the class is
   CC-59 (e) at `../phase-1-31/change-control-2026-09-08.md:7334`, which measured sixteen sites
   across nine files; the head now carries 18 across 11.
5. `diagnostics.dom.test.tsx:13`, `quality.dom.test.tsx:15`, `technician-workspace.dom.test.tsx:5`,
   `work-order-delivery-mount.dom.test.tsx:4`, `price-list-detail.dom.test.tsx:5`,
   `quotation-detail.dom.test.tsx:5`.
6. `gallery-and-print.dom.test.tsx:5`, `overlays.dom.test.tsx:5`,
   `profile-accessibility.dom.test.tsx`, `shell.dom.test.tsx`.
7. A sibling worktree in the workspace is named for this task. It was not read — it is outside the
   checkout this preparation used — so whether it holds relevant unmerged work is UNVERIFIED.
8. `features/receptions/components/AcknowledgementDocument.tsx`,
   `features/billing/components/InvoiceDocument.tsx`,
   `features/payments/components/ReceiptDocument.tsx`,
   `features/delivery/components/DeliveryDocument.tsx`.
9. `features/attachments/api.ts` and `attachments-contract.ts`;
   `features/receptions/components/CaptureFileField.tsx`, `components/steps/MediaStep.tsx`,
   `evidence-capture.ts`, `signature-capture.ts`; `features/delivery/components/ReceiverPanel.tsx`,
   `receiver-capture.ts`, `signature-capture.ts`;
   `features/vehicles/components/VehicleDocumentsSection.tsx` and `documents-contract.ts`.

---

## D. FE-001 first — the fidelity basis per module

FE-001 is the head of the Frontend chain, and its description (¶19947) requires a review **against
the approved UI prototype**. Field 6 (¶19909) forbids new visual design work in the same chapter:

> New visual design work: frontend phases implement only owner-approved prototypes (OIR-06).

### The two governing rules, byte-exact

`OIR-06` as the P1-25 record states it, at
[`../phase-1-25/owner-input-required.md`](../phase-1-25/owner-input-required.md) line 19:

> | **OIR-06** — visual identity / UI prototypes | **Open.** Explicitly "blocks frontend build-out phases (Phase 1-25 onwards)" |

`P1-EC-006` as the same record states it, at line 21:

> | **P1-EC-006** | Requires approved prototype links/files **and** a fidelity checklist |

And the rule that resolved OIR-06, at
[`../phase-1-27/canonical-plan.md`](../phase-1-27/canonical-plan.md) lines 65–75:

> **OIR-06 is resolved.** Any wording implying visual prototypes are still blocked
> is withdrawn.
>
> The rule that replaces it:
>
> - The **P1-25 / P1-26 design foundations are binding**.
> - P1-27 **composes approved components**.
> - P1-27 **must not create a competing design system**.
> - New **feature-specific composition is allowed** — a customer profile layout is
>   composition, not a new design system.
> - **Brand changes require controlled change**, not a P1-27 commit.

### Per module

| Module group | Approved prototype reference, as the records name it                                                                                                                                                                                                                                                                                                          | Existing implementation-review evidence                                                                                                                                                                                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-25        | "the approved P1-25 design system itself; no separate package required", recorded as the Prototype basis against `P1-EC-006` — [`../phase-1-25/gate-record.md`](../phase-1-25/gate-record.md) line 44                                                                                                                                                         | The only human fidelity review in the repository: `../phase-1-25/gate-record.md:123-133`, verified in the running application rather than asserted, and recorded as "**Decision: Pass**, against the approved direction recorded in §2". Gate head `ac7c089c`                                                                                              |
| P1-26        | **MISSING.** A dedicated package was formally requested and never supplied: `../phase-1-25/owner-input-required.md:105-107`. Non-delivery confirmed at `../phase-1-26/preflight/dependency-readiness.md:62-63` and `:99`                                                                                                                                      | No per-screen fidelity review. The substitute is the inherited-primitive argument at `../phase-1-26/accessibility-evidence.md:12-28` plus the mechanised checkers and `brand-replacement.test.ts`. The phase acceptance at `../phase-1-26/closure-record.md:5` is a functional acceptance of the running application, not a fidelity review                |
| P1-27        | **MISSING** as a per-module artefact. The governing rule quoted above replaces it with the design foundations: `../phase-1-27/canonical-plan.md:64-75`; corroborated at `../phase-1-27/preflight/final-readiness.md:63`                                                                                                                                       | `../phase-1-27/installed-chrome-review.md`, a by-hand review of the merged application, and the phase acceptance at `../phase-1-27/closure-record.md:5`. Neither compares a screen to an approved layout, because none exists. The composition rule is enforced only indirectly, by the theme, token and style checkers and `stylelint-policy.test.ts`     |
| P1-28        | **MISSING.** No prototype reference exists in `../phase-1-28/**`. The inherited basis is the P1-27 rule                                                                                                                                                                                                                                                       | `../phase-1-28/media-capture-decision-record.md` is the nearest design-decision record and it decides a capture mechanism, not a layout. Phase acceptance at `../phase-1-28/closure-record.md:5`; the phase's own damage record shows the limit of that acceptance — four frontend defects were found by hand while every automated tier was green         |
| P1-29        | **MISSING.** No prototype reference in `../phase-1-29/**` (four files, none naming one). Inherited basis: the P1-27 rule                                                                                                                                                                                                                                      | `../phase-1-29/w9-acceptance-record.md:85-109`, the journey walked by hand in the browser on a production build. A functional walk, not a fidelity review. No accessibility scan, no right-to-left render, no committed browser spec                                                                                                                       |
| P1-30        | **MISSING** as an artefact, though the acceptance sentence carries the obligation: the canonical plan folds each scope item into one task "against the approved UI prototype and the approved backend contract" — `../phase-1-30/canonical-plan.md:30`, with the out-of-scope restatement at `:75`                                                            | `../phase-1-30/closure-record.md:87-90` records browser evidence on a production build of `3d752119`, in both languages, cited to the P1-29 acceptance record § 7.2. Those specs are not committed at this head. The Owner's own verdict is recorded as still outstanding at `:112-115`                                                                    |
| P1-31        | **MISSING** as an artefact; the obligation is quoted in the phase's own extraction at `../phase-1-31/canonical-plan.md:220-226`, and Field 9 at `:99` says "approved UI prototypes where applicable". The closure record re-quotes the obligation at `:116-120` and its sixteen-row frontend table records "missing" per task without ever naming a prototype | The richest evidence in the repository, and none of it is fidelity: `../phase-1-31/acceptance-record.md` § 7.1, the closing run recorded at `../phase-1-31/change-control-2026-09-08.md:8679`, and six committed browser specs. The open print defect at `:1956` is the closest thing to a fidelity finding anywhere, and it was found by reading the code |

### The workspace-wide finding

No approved UI prototype, design file, mock-up, wireframe or design-tool reference exists anywhere
in the repository or the sibling delivery folders. A whole-tree filename filter at this head returns
exactly one path and it is unrelated; the public asset directory holds four files, of which two are
brand marks and one declares itself provisional. The original exhaustive search is recorded at
`../phase-1-25/owner-input-required.md:24-31`, and the request that would have closed OIR-06 —
naming the shell, header, sidebar states, tablet drawer, breadcrumbs, page header, form controls,
data table, dialog, drawer, tabs, toast, the four states and a print sample, each in Arabic and
English at desktop and tablet — is at `:95-104`. It was never delivered. OIR-06 was closed by
designating the built design system as the basis, not by supplying prototypes.

### The honest consequence

FE-001 cannot be satisfied as literally written for any of the seven module groups, because the
artefact its acceptance sentence names does not exist. For P1-25 the design system **is** the
recorded prototype basis and a human fidelity decision exists against it. For P1-26 a package was
formally requested and never supplied. For P1-27 through P1-31 no per-module prototype artefact
exists anywhere in the repository or the sibling folders.

**The next executable FE-001 task is therefore to confirm the fidelity basis per module against
OIR-06** — a recorded determination of what each module is to be reviewed against. It is not to
invent an approved design, and it is not to run a review. Nothing here approves a prototype,
designates a basis, or claims a fidelity verdict for any module other than the P1-25 one already
recorded.

---

## E. P1-31 carry into P1-32

Scope rule applied: only frontend validation belongs inside P1-32 (Owner decision O-4). The open
dispositions of P1-31 were filtered by subject against that rule. Four are carried; the rest are
not, and the ones a reader would most expect to see are named below so their exclusion is deliberate
rather than an oversight.

### Carried

| Item      | Register citation                                             | Obligation it puts on P1-32                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CC-59 (e) | `../phase-1-31/change-control-2026-09-08.md:7334`             | "the same composed-key defect remains at sixteen sites across nine files outside this phase". Its subject is the rendered text of the loading, empty, error and permission states themselves — FE-009 verbatim — and, because the key is resolved at runtime, it is an FE-003 obligation too. Re-measured at this head: 18 sites across 11 files, every one inside a module group P1-32 covers                                    |
| CC-62 (b) | `../phase-1-31/change-control-2026-09-08.md:7856`             | "no hosted run, and no execution of the declared fixture command, is recorded at this head". Its subject is the executability of the frontend browser suite and its fixture — FE-014 and FE-013. A collection is not an execution, which is the distinction this phase's Definition of Done turns on                                                                                                                              |
| CC-64 (b) | `../phase-1-31/change-control-2026-09-08.md:8762` and `:8905` | "the coverage figures stay local although the hosted `web-quality` job ran". Its subject is the frontend coverage evidence FE-013 and QA-001 would inherit and re-certify; a locally measured floor is not the hosted evidence QA-005 packages                                                                                                                                                                                    |
| CC-57 (b) | `../phase-1-31/change-control-2026-09-08.md:6761`             | "the sourcing gate judges the SEND, not the screen state behind it". Its subject is a frontend behaviour no automated gate can see — what the operator was looking at when the request went out — which is FE-002 and bears on FE-009's conflict state. **Carried as a candidate, not a certainty:** it can also be read as a gate-design limitation rather than a validation obligation, and that reading is put to the reviewer |

### Excluded, named

| Item                                         | Why it is excluded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CC-57 (a) — `:6760`                          | Its subject is frontend, but on two independent grounds it is not frontend **validation**. First, six of the seven operations it names are the checklist-template and report-configuration administration surfaces, and the Owner's binding instruction is that the checklist-template administration screen must not be inserted into P1-32 (O-20). Second, its subject is a screen that does not exist — that is frontend delivery, owned by the phase that allocates it. The allocation itself is an open Owner item |
| CC-65 (a) — `:9205`                          | Open, and the Owner's, routed as O-20 and O-21. Its two limbs are a P1-31 scope allocation and a documentation acknowledgement; its subject is adjudication, not frontend validation. The P1-31 task it names is that phase's own, not this phase's similarly numbered one                                                                                                                                                                                                                                              |
| The checklist-template administration screen | Excluded by the Owner's binding instruction (O-20). It is recorded in the module survey for completeness of the P1-29 surface only, and no P1-32 task, evidence row or execution step above covers it                                                                                                                                                                                                                                                                                                                   |

Also excluded, for the record and without restating them: the two download and disclosure-audit
limitations, which land on SEC-002 rather than on the frontend validation set; a list of backend,
database, workflow and register-bookkeeping dispositions with no frontend-validation content; and
one historical item that is the closest match to this phase's subject matter but is excluded from
the open set by name in the register's own reconciliation, recorded here only so a reader does not
re-raise it.

---

## F. Not found

Stated as found, at `develop 7a1e1eef`, without inference.

1. **No `docs/phase-1/phase-1-32/` directory** and no P1-32 planning, register, canonical-plan,
   preflight or acceptance file anywhere in the repository before this change. The only references
   to the phase in `docs/` were the boundary citation in the P1-31 canonical plan and three lines of
   the P1-31 Owner decision packet. So this extraction is the first reading of the chapter and there
   is no prior artefact to reconcile against.
2. **No approved UI prototype, design file, mock-up, wireframe or design-tool reference for any
   module**, anywhere in the repository or the sibling delivery folders. This is the FE-001 answer
   for every module and it is recorded as MISSING, not inferred away.
3. **No second-engine browser project.** All nine browser projects use one desktop engine
   (`playwright.config.ts:150`, `:159`, `:168`, `:177`, `:186`, `:200`, `:207`, `:218`, `:291`); the
   channel variable at `:141` selects a channel of the same engine.
4. **No slow-network test of any kind.** No throttling helper, no delay fixture, no
   network-condition emulation, no offline case, no screen-level timeout assertion. FE-010 has zero
   existing evidence.
5. **No committed browser spec for any P1-29 or P1-30 module.** Ten route prefixes return nothing
   from the browser test directory. The nine cases the P1-30 closure record cites at
   `../phase-1-30/closure-record.md:87-90` are not in the repository — they were executed and
   discarded.
6. **No route-level accessibility scan for P1-28, P1-29, P1-30 or P1-31.** The route list at
   `accessibility.spec.ts:138-163` covers administration, customer, vehicle and profile routes and
   the dashboard only; and the file self-skips unless the signed-in account kind is the acceptance
   fixture (`:27-34`, marker at `:29`), so a handoff-driven local run executes zero cases while
   reporting green.
7. **No component-level accessibility assertion outside four foundation suites** — only
   `gallery-and-print.dom.test.tsx`, `overlays.dom.test.tsx`, `profile-accessibility.dom.test.tsx`
   and `shell.dom.test.tsx` use the component accessibility matcher. No business-module suite does.
8. **No right-to-left render for six suites' screens** — the six listed in row note 5 import the
   left-to-right helper only; the other 57 suites that use the helper import the right-to-left one
   or both.
9. **No tablet-and-Arabic combination in the authenticated browser tier.**
   `playwright.config.ts:291-294` fixes the tablet project at one size in one locale, and `:264`
   records that the P1-31 specs ran at one desktop size only, in the two locale projects — so the
   tablet project does not even select them.
10. **The chapter names no gate identifier for its dependency.** Fields 7 and 8 and every first-row
    Dependencies cell say only "Phases 1-25…1-31 and backend gate Phase 1-24". The binding rule had
    to be assembled from two documents, which § A states so the reader can check it.
11. **Field 34 is self-referential in every task row.** Each of the 27 tasks gives its
    Documentation reference as "Phase 1-32 Field 34 synchronization set", and Field 34
    (¶20359–20361) lists documents rather than per-task artefacts. No task names a document of its
    own.

---

## G. What this document does not claim

- **No P1-32 task has been started.** Every one is `Planned`, which is the chapter's baseline text.
- **Nothing has been validated.** No test, journey, browser, coverage, build, stack, database or
  hosted job was run in producing this document. Every count, line number and paragraph index above
  is a static read.
- **No test case has passed.** Every validation step named above is marked NOT RUN, and a step that
  was not executed is reported as not executed, never as passing.
- **No prototype is approved** and no fidelity basis is designated here. § D records what the
  existing records say and names the determination that is still owed.
- **No gate is satisfied.** Gate P1-G31 is not satisfied; Gate P1-G32 is not addressed. Nothing here
  asserts a certification, a clearance, an environment, an approval or an Owner verdict.
- **No P1-31 record is amended by this change**, and no P1-32 register, task matrix or acceptance
  record is created.
