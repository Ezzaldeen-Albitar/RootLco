# P1-32 — the 27 canonical task rows reconciled against the merged work, 2026-09-18

Companion to [`canonical-plan.md`](./canonical-plan.md) (the chapter extraction),
[`execution-plan-and-evidence-map.md`](./execution-plan-and-evidence-map.md) (the evidence-reuse map)
and [`fe-001-fidelity-basis.md`](./fe-001-fidelity-basis.md) (the FE-001 basis confirmation).

- **Measured at.** Protected `develop` `3b50f26c02bf658d3b83f09b766cfa364bb0425e` — the merge of pull
  request #417 — read in the worktree that carries it. Where a citation names a different head it
  says so.
- **Date.** 2026-09-18.
- **What this is.** One reconciliation row per canonical task row: the requirement the chapter
  states, what the merged work provides at this head with a citation, and the honest state. Plus the
  OIR-06 contradiction stated and routed (§ 4), and the acceptance-run obligation list (§ 5).

Bare `.md` filenames are relative to `docs/phase-1/phase-1-32/`; every other path is written from the
repository root.

---

## 1. PREPARATORY ONLY — P1-32 is not started and its gate is not met

**No P1-32 task is started by this document, and none may be.** Every one of the 27 rows keeps the
chapter's own status, `Planned` ([`canonical-plan.md`](./canonical-plan.md) lines 21–22 and 252).

**The dependency rule in Field 7 still governs.** [`canonical-plan.md`](./canonical-plan.md) lines
144–145, the chapter's own words:

> The dependencies in Field 8 have passed their recorded exit gates: Phases 1-25…1-31 and backend
> gate Phase 1-24.

**Gate P1-G31 is unsatisfied at this head.** Its four conditions are conjunctive; conditions 2 and 3
await the nine human determinations `QA-C1`…`QA-C5` and `SEC-C1`…`SEC-C4`, whose decision fields at
§ 7 of [`../phase-1-31/certification-and-clearance-packet.md`](../phase-1-31/certification-and-clearance-packet.md)
are empty. The packet routed for those determinations states the three facts kept separate at
[`../phase-1-31/reviewer-packet-2026-09-18.md`](../phase-1-31/reviewer-packet-2026-09-18.md) § 1,
lines 40–51, and records that **promotion stays NOT eligible**.

**So a row that reads `implementation present, verification owed` below is not a started P1-32
task.** It is a statement about the repository, not about the phase: the subject matter of the
canonical row exists in the merged application or its suites, and the P1-32 review and its evidence
artefact do not exist and were not run.

**Nothing was executed to produce this document.** No test tier, coverage run, build, browser tier,
database, stack, migration or hosted job. Every count, route, line number and file name below is a
static read at `3b50f26c` on a machine with `PGPORT=1` and `DB_PORT=1` exported, so nothing could
reach a database.

### 1.1 The commit prefix is not a phase start

183 commits reachable from this head carry the subject prefix `P1-32-PRE-NNN`. **That prefix is a
preparation-task id convention used by the Owner-directive work of 2026-09-16, not a canonical
P1-32 task id.** No commit in the repository carries a `P1-32-FE-`, `P1-32-SEC-`, `P1-32-QA-`,
`P1-32-DO-` or `P1-32-DOC-` id, which are the 27 identifiers the chapter declares
([`canonical-plan.md`](./canonical-plan.md) lines 198–205). The directive work is recorded on its
own terms at [`../../product/owner-directive-2026-09-16/README.md`](../../product/owner-directive-2026-09-16/README.md)
and measured at [`../../product/owner-directive-2026-09-16/capability-status.md`](../../product/owner-directive-2026-09-16/capability-status.md),
whose own header states that its evidence column is **a code reading, not a demonstration that the
workflow runs**, and that **70 of its 95 capability rows carry an owed-proof marker**.

### 1.2 The four states, defined before they are used

| State                                         | What it asserts                                                                        | What it does not assert                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **not started**                               | No artefact and no reusable evidence exists for the row's literal subject at this head | —                                                                                       |
| **prepared**                                  | A P1-32 preparatory document scopes the row; nothing in it was executed                | That any review was performed or any verdict reached                                    |
| **implementation present, verification owed** | The row's subject matter exists in the merged application or its suites, cited below   | That a P1-32 review was run, that any evidence artefact exists, or that any gate passed |
| **verified**                                  | A P1-32 evidence artefact exists and its verification was executed and recorded        | —                                                                                       |

**No row below reads `verified`.** Nothing in P1-32 has been executed.

### 1.3 The state distribution

| State                                     | Rows   | Which                                                                                     |
| ----------------------------------------- | ------ | ----------------------------------------------------------------------------------------- |
| not started                               | 4      | FE-010, FE-012, QA-005, DOC-002                                                           |
| prepared                                  | 2      | FE-001, DOC-001                                                                           |
| implementation present, verification owed | 21     | FE-002…FE-009, FE-011, FE-013, FE-014, SEC-001…SEC-004, QA-001…QA-004, DO-001, DO-002     |
| verified                                  | 0      | —                                                                                         |
| **total**                                 | **27** | matches the chapter's declared count ([`canonical-plan.md`](./canonical-plan.md) line 18) |

---

## 2. The repository facts every row below rests on

Measured once here so no row repeats them, and so each is checkable on its own.

| Fact                                          | Measurement at `3b50f26c`                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Screen routes                                 | **87** `page.tsx` files under `apps/web/src/app`. By group: inventory 15, administration 15, work-orders 7, platform console 6, crm 5, warranty 4, vehicles 4, receptions 4, reports 3, appointments 3, services 2, quotations 2, pricing 2, delivery 2, and one each for technicians, walk-in reception, profile, payments, invoices, attention, the dashboard root, the gallery, the root redirect, and the four authentication screens |
| Backend operations                            | **492** literal operation ids across **383** route files under `apps/api/src/app`                                                                                                                                                                                                                                                                                                                                                         |
| Web test files                                | **194** files under `apps/web/tests/`, of which **90** are `*.dom.test.tsx` component suites                                                                                                                                                                                                                                                                                                                                              |
| Committed browser specs                       | **16** `*.spec.ts` under `apps/web/tests/e2e/` — three anonymous (`foundation`, `shared-ux-anonymous`, `platform-console`) and thirteen under `e2e/authenticated/`                                                                                                                                                                                                                                                                        |
| Browser projects                              | **9** in `apps/web/playwright.config.ts`: `desktop-en`, `desktop-ar`, `laptop-en`, `tablet-ar`, `reduced-motion`, and, behind the opt-in at `:63`, `auth-setup`, `authenticated-en`, `authenticated-ar`, `authenticated-tablet`                                                                                                                                                                                                           |
| Rendering engines                             | **one**. Every project spreads `devices['Desktop Chrome']` (`:150`, `:159`, `:168`, `:177`, `:186`, `:200`, `:207`, `:218`, `:292`); the only variability, `:141`, selects a **channel** of the same engine                                                                                                                                                                                                                               |
| Message catalogues                            | `apps/web/src/i18n/messages/en.json` and `ar.json`, **5,398** leaf keys in the English catalogue                                                                                                                                                                                                                                                                                                                                          |
| Composed state keys                           | **18 sites across 11 files** build a message key as `` `state.${…}.title` `` at runtime — delivery `use-paged-list.ts` 1, diagnostics 4, quality 6, technicians 3, warranty 1, work-orders 3. Unchanged from the re-measure in [`execution-plan-and-evidence-map.md`](./execution-plan-and-evidence-map.md) row note 4                                                                                                                    |
| Direction helpers                             | Of the 90 component suites, **87** import a direction helper from `apps/web/tests/render.tsx`; **74** import `renderRtl` or `BOTH_DIRECTIONS`; **13** import `renderLtr` only; **3** import none                                                                                                                                                                                                                                          |
| Print authority                               | `apps/web/src/components/print/PrintDocument.tsx` with **five business consumers plus the gallery sample**: `receptions/components/AcknowledgementDocument.tsx`, `billing/components/InvoiceDocument.tsx`, `payments/components/ReceiptDocument.tsx`, `delivery/components/DeliveryDocument.tsx`, `inventory/components/LabelsScreen.tsx`, `components/gallery/GalleryClient.tsx`                                                         |
| Route prefixes with no committed browser spec | **eleven**: `/work-orders`, `/technicians`, `/quality`, `/diagnostics`, `/services`, `/pricing`, `/quotations`, `/inventory`, `/invoices`, `/payments`, `/attention`                                                                                                                                                                                                                                                                      |
| Coverage include roots                        | `apps/web/vitest.config.ts:52-62` — crm, vehicles, delivery, warranty, reports, platform, the `(dashboard)` and `(platform)` route roots, and `src/lib`                                                                                                                                                                                                                                                                                   |
| Coverage gate reachability                    | `scripts/ci/coverage-gate.mjs` is referenced by **no npm script** in any of the three manifests; it is invoked only from `.github/workflows/_reusable-node-quality.yml` and `_reusable-integration-tests.yml`                                                                                                                                                                                                                             |
| Field 34 synchronization set                  | **Not tracked in this repository.** `git ls-files` returns no path under `documentation/` and none under `phase-1/`; the set named at [`canonical-plan.md`](./canonical-plan.md) lines 423–430 is held in the sibling workspace                                                                                                                                                                                                           |

### 2.1 Three statements in the merged preparation are stale at this head

Recorded, not corrected: those documents are merged and this one does not amend them.

1. **The tablet project now selects the P1-31 specs.** [`execution-plan-and-evidence-map.md`](./execution-plan-and-evidence-map.md)
   row FE-005 says "the tablet project selects none of them". At this head
   `apps/web/playwright.config.ts:254-256` matches eight spec names —
   `administration`, `appointments-and-receptions`, `audit-log-p1-31`, `delivery-p1-31`,
   `delivery-writes-p1-31`, `overview-p1-31`, `reports-p1-31`, `warranty-p1-31`. **The other half of
   that row still holds:** the project is fixed at one locale (`:294`, `en-GB`), so no authenticated
   screen has tablet-and-Arabic evidence.
2. **The print authority has five business consumers, not four.**
   [`execution-plan-and-evidence-map.md`](./execution-plan-and-evidence-map.md) row note 8 lists
   four; `inventory/components/LabelsScreen.tsx` is the fifth at this head.
3. **The web tier grew.** That document measured 168 files and 73 component suites; this head holds
   194 and 90. `.github/ci-baselines/test-count-baseline.json` lines 26–34 record the web floor at
   4,459 against a **LOCAL** measurement of 4,559 across 162 test files, and its own
   `measurementProvenance` field says so in those words.

---

## 3. The 27 rows

Chapter requirement wording is the shared Frontend / Security / QA / DevOps / Documentation
description pattern plus the row's own task name, as
[`canonical-plan.md`](./canonical-plan.md) records them at lines 282–292, 318–320, 333–336, 350–353
and 364–367.

### 3.1 Frontend — fourteen rows

Every Frontend row carries the same six implementation obligations: the approved UI prototype and
approved backend contract; Arabic/English; RTL/LTR; desktop/tablet; accessibility; and the
loading/empty/error/permission states ([`canonical-plan.md`](./canonical-plan.md) lines 284–289).

#### P1-32-FE-001 — UI-prototype fidelity review

- **Canonical requirement.** Implement the fidelity review against the approved UI prototype and
  approved backend contract ([`canonical-plan.md`](./canonical-plan.md) line 296).
- **What exists now.** [`fe-001-fidelity-basis.md`](./fe-001-fidelity-basis.md) confirms the basis
  per module against OIR-06 and P1-EC-006 and records **MISSING** for P1-27 through P1-31
  (that file, § 2.8 at lines 281–287). The only human fidelity review in the repository is P1-25's,
  at `../phase-1-25/gate-record.md:123-133`, taken at gate head `ac7c089c`. Mechanised conformance
  exists — `validate:web-theme`, `validate:web-brand`, `validate:web-tokens`, `style:check:web`,
  `apps/web/tests/stylelint-policy.test.ts`, `apps/web/tests/brand-replacement.test.ts` — and none of
  it compares a screen to a layout. **87 routes have no per-screen fidelity instrument.**
- **State: prepared.** Six items are open and unanswered — `O-A` through `O-F` at
  [`fe-001-fidelity-basis.md`](./fe-001-fidelity-basis.md) lines 295–326. `O-A` is the contradiction
  stated at § 4 below.

#### P1-32-FE-002 — functional review

- **Canonical requirement.** [`canonical-plan.md`](./canonical-plan.md) line 297.
- **What exists now.** Sixteen committed browser specs (§ 2). Covered surfaces: authentication and
  administration (`e2e/foundation.spec.ts`, `e2e/authenticated/administration.spec.ts`,
  `drawer-and-restore.spec.ts`, `shared-ux.spec.ts`), customers and vehicles
  (`crm-and-vehicles.spec.ts`), appointments and receptions
  (`appointments-and-receptions.spec.ts`), delivery, warranty and reporting
  (`delivery-p1-31.spec.ts`, `delivery-writes-p1-31.spec.ts`, `warranty-p1-31.spec.ts`,
  `reports-p1-31.spec.ts`, `overview-p1-31.spec.ts`, `audit-log-p1-31.spec.ts`), and the platform
  console (`e2e/platform-console.spec.ts`, whose signed-in half runs only when two platform-operator
  credentials are supplied — its own header records that). **Eleven route prefixes have none**
  (§ 2). The authenticated tier executes only when `ROOTLCO_E2E_AUTH=1`
  (`apps/web/playwright.config.ts:63`).
- **State: implementation present, verification owed.** No spec was executed here, and the P1-29,
  P1-30 and inventory surfaces have no re-executable browser coverage to execute.

#### P1-32-FE-003 — Arabic/English review

- **Canonical requirement.** [`canonical-plan.md`](./canonical-plan.md) line 298.
- **What exists now.** Both catalogues, 5,398 English leaf keys (§ 2); `apps/web/tests/i18n.test.ts`
  (10 declared cases); `apps/web/tests/field-error-translation.test.ts`; the
  `validate:plain-language` gate. Screen-level Arabic rendering exists for the modules with an
  Arabic component render or the `authenticated-ar` project, and for no other.
- **State: implementation present, verification owed.** The **18 composed state-key sites across 11
  files** (§ 2) cannot be resolved by any static checker, which is the subject of **CC-59 (e)**
  (`../phase-1-31/change-control-2026-09-08.md:7354`), open.

#### P1-32-FE-004 — RTL/LTR review

- **Canonical requirement.** [`canonical-plan.md`](./canonical-plan.md) line 299.
- **What exists now.** `apps/web/tests/render.tsx:29-43` exports `renderLtr`, `renderRtl` and
  `BOTH_DIRECTIONS`; 74 of 90 component suites import a right-to-left render (§ 2). Browser
  right-to-left comes from `desktop-ar` (`playwright.config.ts:156-163`), `tablet-ar` (`:174-181`)
  and `authenticated-ar` (`:214-223`). The SCSS logical-property rule is enforced by
  `style:check:web`.
- **State: implementation present, verification owed.** Thirteen suites render left-to-right only
  and three use no helper (§ 2); combined with the eleven spec-less route prefixes, the work-order,
  diagnostics, quality, technician, pricing, quotation, inventory, invoice and payment screens have
  **no right-to-left evidence of any kind**.

#### P1-32-FE-005 — desktop/tablet testing

- **Canonical requirement.** [`canonical-plan.md`](./canonical-plan.md) line 300. **Mobile is never
  named in the chapter** (that file, lines 289–292).
- **What exists now.** `apps/web/tests/shell-viewport.dom.test.tsx`; the viewport projects at
  `playwright.config.ts:146-190`; the authenticated tablet project at `:254-256` and `:293-294`,
  1024×768, selecting eight spec names.
- **State: implementation present, verification owed.** The tablet project is **`en-GB` only**
  (`:294`), so no authenticated screen has tablet-and-Arabic evidence; and the eleven spec-less route
  prefixes are selected by no browser project at any width.

#### P1-32-FE-006 — accessibility testing

- **Canonical requirement.** [`canonical-plan.md`](./canonical-plan.md) line 301.
- **What exists now.** `apps/web/tests/e2e/authenticated/accessibility.spec.ts`, route list at
  `:144-170` — twenty-four entries: fourteen administration routes, two customer routes, the three
  creation-flow routes, three vehicle routes, the profile route and the dashboard root.
  Component-level assertions in four foundation suites only (`gallery-and-print`, `overlays`, `profile-accessibility`, `shell`).
- **State: implementation present, verification owed.** Two limits are structural, not incidental:
  the spec **self-skips unless the signed-in account kind is `owner-acceptance`** (`:30-32`), so a
  run under any other account executes zero cases while reporting green; and **no route of P1-28,
  P1-29, P1-30, P1-31, the inventory surface or the platform console appears in the list**.

#### P1-32-FE-007 — keyboard testing

- **Canonical requirement.** [`canonical-plan.md`](./canonical-plan.md) line 302.
- **What exists now.** Focus and keyboard assertions in `e2e/foundation.spec.ts`,
  `drawer-and-restore.spec.ts`, `shared-ux.spec.ts`, `shared-ux-anonymous.spec.ts`,
  `crm-and-vehicles.spec.ts`; component level in `overlays.dom.test.tsx`,
  `p1-27-owner-acceptance.dom.test.tsx`, `delivery.dom.test.tsx`,
  `reception-condition-evidence.dom.test.tsx`, `lib-coverage.dom.test.tsx`.
- **State: implementation present, verification owed.** Evidence is concentrated in the P1-25
  primitives and the sign-in screen. No keyboard case exists for any work-order, diagnostics,
  quality, technician, pricing, quotation, inventory, invoice, payment, attention or platform-console
  screen, nor for the multi-step wizards outside one suite.

#### P1-32-FE-008 — print-layout testing

- **Canonical requirement.** [`canonical-plan.md`](./canonical-plan.md) line 303.
- **What exists now.** One print authority with five business consumers and the gallery sample
  (§ 2); component suites `gallery-and-print.dom.test.tsx`, `delivery-document.dom.test.tsx`,
  `reception-acknowledgement.dom.test.tsx`, `invoices.dom.test.tsx`, `payments.dom.test.tsx`.
- **State: implementation present, verification owed.** Two gaps stand: **no browser print emulation
  against any business document** (only against the gallery sample), and **CC-32** is open
  (`../phase-1-31/change-control-2026-09-08.md:1976`) — the printed delivery sheet carries a
  reference where a person's name belongs. The label sheet added to the print authority since that
  document was written has no print-layout case at all.

#### P1-32-FE-009 — loading/empty/error/permission-state testing

- **Canonical requirement.** [`canonical-plan.md`](./canonical-plan.md) line 304.
- **What exists now.** `loading-boundary.dom.test.tsx`, `search-empty-states.dom.test.tsx`,
  `write-permission-gating.dom.test.tsx`, `route-permission-binding.test.ts`,
  `p1-27-permission-route-binding.dom.test.tsx`, `p1-28-permission-route-binding.test.ts`,
  `read-completeness.test.ts`.
- **State: implementation present, verification owed.** The machinery is proven on the shared
  boundary components and the customer and vehicle screens, **not per screen**; and the 18 composed
  state-key sites mean the rendered state text itself is unverifiable statically at exactly the
  screens with the least coverage.

#### P1-32-FE-010 — slow-network testing

- **Canonical requirement.** [`canonical-plan.md`](./canonical-plan.md) line 305.
- **What exists now.** **Nothing that measures a slow network.** A repository-wide read finds no
  throttling helper, no delay fixture, no network-condition emulation, no offline case and no
  screen-level timeout assertion. The only matches for the word are a rate-limit vocabulary entry
  (`apps/web/tests/p1-28-qa.test.ts:1070`) and a comment about a rate-limited write
  (`apps/web/tests/vehicle-screens.dom.test.tsx:577`); neither is a network test.
- **State: not started.** Zero existing evidence for all seven module groups and for the two
  surfaces added since. This is the largest single hole in the phase.

#### P1-32-FE-011 — file-upload testing

- **Canonical requirement.** [`canonical-plan.md`](./canonical-plan.md) line 306.
- **What exists now.** The browser-side upload surfaces are
  `apps/web/src/features/receptions/components/CaptureFileField.tsx`,
  `receptions/components/steps/MediaStep.tsx` and `components/gallery/GalleryClient.tsx`; the
  transport is the single presigned PUT in `apps/web/src/features/attachments/api.ts`. Suites:
  `attachments-contract.test.ts`, `p1-28-reception-media.dom.test.tsx` and `.test.ts`,
  `reception-evidence.test.ts`, `vehicle-documents.dom.test.tsx` and `.test.ts`,
  `delivery-signature-refusal.dom.test.tsx`.
- **State: implementation present, verification owed.** **Every case mocks the transport.** No
  browser-level upload of a real file exists on any surface, and no oversized, rejected-type,
  scan-failed or interrupted-upload case exists. **No object storage is provisioned**, which
  `docs/platform/environment-configuration.md:389-430` records as an external input that "nothing
  below exists today".

#### P1-32-FE-012 — browser compatibility

- **Canonical requirement.** [`canonical-plan.md`](./canonical-plan.md) line 307.
- **What exists now.** **One rendering engine in every project** (§ 2). The machine's Playwright
  browser cache holds `chromium` and `chromium_headless_shell` only; the two system browsers
  installed are Chrome and Edge, which are the same engine family.
- **State: not started.** The literal subject of this row — a second and a third engine — has never
  been tested for any module. A direction-specific or layout defect confined to Gecko or WebKit would
  have been invisible in every run to date.

#### P1-32-FE-013 — frontend automated tests

- **Canonical requirement.** [`canonical-plan.md`](./canonical-plan.md) line 308.
- **What exists now.** 194 files / 90 component suites (§ 2). `.github/ci-baselines/coverage-baseline.web.json`
  records `establishmentProvenance: HOSTED` against run id 34321869051, job `Web quality /
web-quality`, over 131 instrumented files, with global floors of 82.48 / 81 / 85 / 77.37.
  `.github/ci-baselines/test-count-baseline.json:26-34` records the count floor at 4,459 with its
  provenance field reading **LOCAL**.
- **State: implementation present, verification owed.** Three limits: the coverage include list
  (`apps/web/vitest.config.ts:52-62`) reaches crm, vehicles, delivery, warranty, reports, platform,
  the two route roots and `src/lib` — so **the P1-29, P1-30 and inventory feature roots are outside
  the gate**; the count floor's provenance is local; and `scripts/ci/coverage-gate.mjs` is reachable
  from no npm script (§ 2), so no local aggregate enforces the floors. **CC-64 (b)** stays open
  (`../phase-1-31/change-control-2026-09-08.md:8835`).

#### P1-32-FE-014 — E2E preparation

- **Canonical requirement.** [`canonical-plan.md`](./canonical-plan.md) line 309.
- **What exists now.** `apps/web/playwright.config.ts` (nine projects, one worker at `:129`, zero
  retries at `:130`, opt-in at `:63`); `apps/web/tests/e2e/origin.ts`;
  `e2e/authenticated/auth.setup.ts`; the account manifest; `e2e/authenticated/p1-31-handoff.ts`;
  the governed hosted job `.github/workflows/_reusable-authenticated-browser.yml`;
  `../phase-1-31/acceptance-plan.md`.
- **State: implementation present, verification owed.** **CC-62 (b)** is open
  (`../phase-1-31/change-control-2026-09-08.md:7889`): no hosted run and no execution of the declared
  fixture command is recorded at the head it was written against. The fixture problem generalises —
  no setup builds a world that reaches the eleven spec-less route prefixes, and the platform-console
  spec needs two credentials the governed job does not hold (its own header says so).

### 3.2 Security — four rows

Description pattern: complete and evidence the named task under the Phase 1 engineering and
governance standards ([`canonical-plan.md`](./canonical-plan.md) lines 318–320).

#### P1-32-SEC-001 — Permission and resolved-scope enforcement

- **What exists now.** `apps/web/tests/route-permission-binding.test.ts`,
  `p1-27-permission-route-binding.dom.test.tsx`, `p1-28-permission-route-binding.test.ts`,
  `write-permission-gating.dom.test.tsx`, `navigation.test.ts`, `security.test.ts`,
  `e2e/authenticated/isolation.spec.ts`; the registered gates `validate:authorization-coverage`,
  `validate:permission-catalog`, `validate:permission-parity`; backend side
  `../phase-1-31/least-privilege-grant-map.md` and `../phase-1-31/isolation-matrix.md`;
  492 literal operation ids across 383 route files (§ 2).
- **State: implementation present, verification owed.** One finding is carried unrepaired from P1-31
  — `../phase-1-31/closure-record.md` § 5.2, observation **O-1**: `wo.work_order.line.manage` is not
  in the tenant-administrator bundle, so `wo.service-line-record` answered `403 ERR-IAM-001` to a
  fresh organisation's first administrator, who "cannot record a service line or a required-part
  demand at all". Backend `iam` owns the change and the grant decision is packet item **F-7**;
  **SEC-C1 is one of the nine absent determinations**.

#### P1-32-SEC-002 — Sensitive-data, export, and file-access controls

- **What exists now.** `apps/web/tests/p1-28-sensitive-narratives.dom.test.tsx`;
  `report-export.dom.test.tsx`; `../phase-1-31/report-export-seam.md`; the server-side
  refused-download negative in `tests/backend/p1-31-signature-download-refusal.test.ts`.
- **State: implementation present, verification owed.** **CC-63 (a)** is open
  (`../phase-1-31/change-control-2026-09-08.md:8003`) — the download authorization does not refuse a
  caller whose file-access grant is scoped to another branch — and the reviewer packet records at its
  § 3.7 that **engineering deliberately makes no proposal on SEC-C2**, because that row is marked NOT
  COVERED BY O-3. **No real object store is exercised by any committed evidence.**

#### P1-32-SEC-003 — Abuse-case and privilege-escalation controls

- **What exists now.** `tests/backend/p1-31-privilege-escalation.test.ts` (SE-0 … SE-7) and
  `tests/backend/p1-31-concurrency-and-versioning.test.ts`; the web permission suites listed under
  SEC-001.
- **State: implementation present, verification owed.** **CC-56 (b)** is open
  (`../phase-1-31/change-control-2026-09-08.md:6194`) — six sites outside the P1-31 operation set
  still answer a refusal that discloses whether the target exists — and the reviewer packet § 3.8
  again makes **no proposal**, for the same reason. The probes run against a disposable database
  only.

#### P1-32-SEC-004 — Security audit-event coverage

- **What exists now.** `apps/api/src/server/auth/audit-actions.ts`;
  `../phase-1-31/audit-class-review.md`; `tests/backend/p1-31-audit-emission.test.ts`;
  `apps/web/tests/e2e/authenticated/audit-log-p1-31.spec.ts`; the administration audit-log screen and
  the platform console's own audit screen (`(platform)/platform/audit`).
- **State: implementation present, verification owed.** The reviewer packet § 3.9 proposes
  Cleared-with-conditions on **L-13** — the export audit records selection and counts, not a byte
  length or content digest. **SEC-C4 is absent.** The platform-console audit surface merged since is
  covered by no browser case.

### 3.3 QA — five rows

Description pattern: design and automate the named task with positive, negative, isolation, failure
and recovery coverage ([`canonical-plan.md`](./canonical-plan.md) lines 333–336).

#### P1-32-QA-001 — Unit and component test coverage

- **What exists now.** The web tier at 194 files / 90 component suites; the hosted web coverage
  baseline and the local count floor (FE-013); `../phase-1-31/coverage-record.md`, status OPEN.
- **State: implementation present, verification owed.** The coverage evidence P1-32 would inherit is
  partly unhosted; the include list excludes the P1-29, P1-30 and inventory roots; **QA-C1 is
  absent**, and the reviewer packet § 3.1 proposes Certified-with-conditions over four conditions
  including that **the instrument moved after the figures were taken**.

#### P1-32-QA-002 — API/contract and error-path coverage

- **What exists now.** `tests/ci/p1-31-error-path-matrix.test.ts`; the wire-shape and OpenAPI gates
  (`validate:named-wire-shapes`, `validate:openapi`, `validate:openapi-success-status`); the web
  contract suites beside each feature suite.
- **State: implementation present, verification owed.** The reviewer packet § 3.2 proposes
  Certified-with-conditions on a bare-object success body (**L-3**, an instance of **CC-46 (c)**) and
  on **CC-58 (c)**. **QA-C2 is absent.** No contract suite covers the operations added by the
  directive waves under a P1-32 heading.

#### P1-32-QA-003 — Tenant/company/branch isolation coverage

- **What exists now.** `tests/db/p1-11-isolation.test.ts`, `tests/db/shared-hardening.test.ts`,
  `tests/backend/p1-31-privilege-escalation.test.ts` (SE-6, SE-7),
  `apps/web/tests/e2e/authenticated/isolation.spec.ts`; `../phase-1-31/isolation-matrix.md`.
- **State: implementation present, verification owed.** Both layers are exercised; **QA-C3 is
  absent** and the reviewer packet § 3.3 proposes Certified-with-conditions on **CC-58 (b)**. Every
  database-layer suite needs a live PostgreSQL and none was run here.

#### P1-32-QA-004 — Concurrency and idempotency coverage

- **What exists now.** `tests/backend/p1-31-concurrency-and-versioning.test.ts`;
  `tests/ci/p1-31-version-sourcing.test.ts` and the registered gate
  `scripts/ci/check-p1-31-version-sourcing.mjs`; `validate:idempotent-operations`.
- **State: implementation present, verification owed.** **CC-57 (a)** is open
  (`../phase-1-31/change-control-2026-09-08.md:6780`) — its register cell says seven pending
  operations while the gate declares six at this head, a staleness the reviewer packet states in full
  at its § 3.4 — and **CC-57 (b)** (`:6781`) is open: the gate judges the send, not the screen state
  behind it, which is why it bears on a Frontend row as well. **QA-C4 is absent.**

#### P1-32-QA-005 — Regression and evidence packaging

- **What exists now.** For P1-31: `../phase-1-31/acceptance-record.md` and the certification
  packet's digest table. **For P1-32: nothing.** No P1-32 register, task matrix, acceptance record or
  evidence index exists, and no `_acceptance` path is tracked in this repository (§ 2).
- **State: not started.** The reviewer packet § 3.5 records that even P1-31's packaging half is
  **UNMET**, and that placing an artefact in the evidence index is the certifier's and the Owner's
  act, not engineering's.

### 3.4 DevOps — two rows

Description pattern: prepare and automate the named task with environment segregation, least
privilege, observable execution, rollback criteria and a recorded operator runbook
([`canonical-plan.md`](./canonical-plan.md) lines 350–353).

#### P1-32-DO-001 — Continuous-integration quality gate

- **What exists now.** Seventeen workflow files under `.github/workflows/`, including
  `_reusable-node-quality.yml`, `_reusable-authenticated-browser.yml`,
  `_reusable-integration-tests.yml`, `_reusable-database-assurance.yml`,
  `_reusable-dependency-security.yml`, `_reusable-code-security.yml` and `_reusable-secret-scan.yml`;
  `scripts/ci/check-command-coverage.mjs` and its `validate:command-coverage` gate; **77** gate
  suites under `tests/ci/`.
- **State: implementation present, verification owed.** **CC-62 (c)** is open — the hosted summary
  renders one register or the other, never both — and no P1-32 CI obligation has been stated, let
  alone met. The standing constraint that any npm script P1-32 adds must be registered in the
  command-coverage gate **in the same change** is carried unchanged.

#### P1-32-DO-002 — Structured logging, monitoring, and alert routing

- **What exists now.** `apps/api/src/server/observability/` — `logger.ts`, `correlation.ts`,
  `metrics.ts`, `monitoring.ts`, `redaction.ts`; `../phase-1-31/monitoring-runbook.md` (89 lines);
  the job-summary rendering gate `tests/ci/job-summary-rendering.test.ts`.
- **State: implementation present, verification owed.** `docs/platform/environment-configuration.md`
  records that **`NEXT_PUBLIC_CLIENT_MONITORING_URL` is set only if a diagnostics collector is ever
  operated. None is**, and that leaving it unset is a supported, tested state. So the frontend limb
  of alert routing has no operated destination to route to.

### 3.5 Documentation — two rows

Description pattern: produce the controlled record, link all supporting evidence, identify
unresolved limitations and route the result to the named approval owner
([`canonical-plan.md`](./canonical-plan.md) lines 364–367).

#### P1-32-DOC-001 — Contract, catalog, and traceability synchronization

- **What exists now.** Four P1-32 documents: [`canonical-plan.md`](./canonical-plan.md),
  [`execution-plan-and-evidence-map.md`](./execution-plan-and-evidence-map.md),
  [`fe-001-fidelity-basis.md`](./fe-001-fidelity-basis.md) and this file. The generated contract
  artefacts `docs/api/openapi.v1.json` and the P1-19/20/21 inventories are regenerated and diffed by
  their own gates.
- **State: prepared.** The Field 34 synchronization set every task row names
  ([`canonical-plan.md`](./canonical-plan.md) lines 423–430) is **not tracked in this repository**
  (§ 2), so this row's synchronisation target lies outside the checkout. Nothing has been
  synchronised for P1-32.

#### P1-32-DOC-002 — Operator/developer guidance and change-log update

- **What exists now.** P1-31's `developer-guidance.md` and `operator-runbook.md`; the user manual
  under `docs/user-manual/`. **No P1-32 change-log entry, operator guidance or developer guidance
  exists.**
- **State: not started.** Its predecessor DOC-001 is only prepared, and the chapter's chain makes
  DOC-002 depend on it ([`canonical-plan.md`](./canonical-plan.md) line 372).

---

## 4. The OIR-06 contradiction — stated, not resolved

**UNRESOLVED. This section decides nothing and proposes no answer.** It states a contradiction
precisely, lists the resolutions that are available and who owns each, and routes it.

### 4.1 The contradiction, in four cited sentences

1. **The chapter forbids new visual design work and binds every Frontend task to an approved
   prototype.** P1-32 Field 6, ¶19909, quoted at [`canonical-plan.md`](./canonical-plan.md) line 134:

   > New visual design work: frontend phases implement only owner-approved prototypes (OIR-06).

   And the Frontend description pattern at that file's lines 284–285 binds all fourteen rows to "the
   approved UI prototype and approved backend contract".

2. **No per-module approved UI prototype exists for P1-26 through P1-31.**
   [`fe-001-fidelity-basis.md`](./fe-001-fidelity-basis.md) § 2.8, lines 281–287: "No approved UI
   prototype, design file, mock-up, wireframe or design-tool reference exists anywhere in the
   repository or the sibling delivery folders at this head, for any module. **Recorded as MISSING,
   per module, and not inferred away.**" Re-checked at `3b50f26c`: no `prototypes/`, `designs/` or
   `mockups/` directory exists in the repository.

3. **What is recorded as the basis instead is the P1-25 design system.**
   `../phase-1-25/gate-record.md:44` and `../phase-1-26/gate-record.md:273` carry the identical
   Prototype-basis row — "the approved P1-25 design system itself; no separate package required" —
   against `P1-EC-006` (`../phase-1-25/owner-input-required.md:21`, which "Requires approved
   prototype links/files **and** a fidelity checklist"). For P1-27 the rule is
   `../phase-1-27/canonical-plan.md:66`, "**OIR-06 is resolved.**" **For P1-28 through P1-31 there is
   no such row at all**; those four groups rest on the P1-27 rule by inheritance, and
   [`fe-001-fidelity-basis.md`](./fe-001-fidelity-basis.md) lines 304–308 (`O-B`) records that no
   document extends it.

4. **Two Accepted ADRs state the opposite at this same head.**
   `docs/adr/ADR-013-sass-and-scss-styling-architecture.md:9`: "No visual identity has been approved
   (OIR-06, UI prototypes, remains open)." And
   `docs/adr/ADR-020-frontend-styling-framework-and-component-primitives.md:139`: "**OIR-06 remains
   open.** This ADR decides the mechanism, not the values." Both line anchors were re-read at
   `3b50f26c`.

**The contradiction.** Rule OIR-06, as P1-32 Field 6 restates it, requires an owner-approved
prototype for every Frontend task. Three classes of record answer that requirement differently at one
head: P1-25 and P1-26 each record a designated basis and no prototype; P1-27 records the rule as
resolved; P1-28 through P1-31 record nothing and inherit; and two Accepted ADRs record OIR-06 as
open. **FE-001 therefore cannot be satisfied as literally written for any of the seven module
groups**, and the honest reading of the rule — composition conformance against the binding design
foundations — is an engineering reading that **no record states**.

**What this document explicitly does not do.** It does not declare the current implementation an
approved prototype. It does not designate a basis for any module. It does not adopt the
mechanism/values reconciliation that would make the ADRs and the P1-27 rule consistent. It reaches no
fidelity verdict for any module other than the P1-25 one already recorded at
`../phase-1-25/gate-record.md:123-133`.

### 4.2 The resolutions available, and who owns each

Listed so the decision-maker can choose; **none is recommended and none is ranked.**

| #       | Resolution                                                                                                                                                                                                | Owner                                                                                                                                       | What it would settle                                |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **R-1** | Supply the two prototype packages that were formally requested and never delivered — `../phase-1-25/owner-input-required.md:95-106` for the foundation surfaces and the companion P1-26 package           | **Owner.** The requests were never withdrawn (`O-D`)                                                                                        | The requirement as literally written                |
| **R-2** | Record an explicit determination extending the designated basis — "the approved P1-25 design system itself" — to P1-27 through P1-32, in the same form as the two Prototype-basis rows that already exist | **Owner**, as the approval owner of P1-32 Field 35; the reviewer may draft the wording                                                      | `O-B`, and the four groups that inherit silently    |
| **R-3** | Pin which version of the design system is the basis: as it stood at gate head `ac7c089c`, or as it stands at the head under review                                                                        | **Owner or reviewer**, jointly — it is a records question with a review consequence                                                         | `O-C`                                               |
| **R-4** | Record the mechanism/values reconciliation in the ADRs and the P1-27 rule, so one status is stated at one head                                                                                            | **Reviewer**, through controlled change to `ADR-013`, `ADR-020` and the P1-27 record; documentation only                                    | `O-A`, the status contradiction itself              |
| **R-5** | Re-scope FE-001 to a composition-conformance review against the binding foundations, with a stated verdict vocabulary and a named reviewer                                                                | **Owner**, because it changes what Gate P1-G32 measures; the vocabulary at `../phase-1-25/owner-input-required.md:108-111` is the candidate | `O-E`, and FE-001's executability                   |
| **R-6** | Defer FE-001 for the affected module groups and carry the deferral as a stated limitation into Gate P1-G32                                                                                                | **Owner.** Field 33 gives the approval owner Pass / Conditional Pass / Fail / **Deferred with conditions**                                  | Nothing — it records the gap rather than closing it |

**A seventh option exists and is named only to be refused here: declaring the current implementation
the approved prototype.** That is not available to engineering; it would convert the thing being
reviewed into the thing it is reviewed against, and it is the one act
[`fe-001-fidelity-basis.md`](./fe-001-fidelity-basis.md) lines 142–144 forbids.

### 4.3 Where it is routed

Into [`../phase-1-31/reviewer-packet-2026-09-18.md`](../phase-1-31/reviewer-packet-2026-09-18.md)
§ 7, as an **Owner-or-reviewer decision, labelled UNRESOLVED**. It is routed **alongside** the nine
determinations and **is not a tenth**: it fills no field in
`../phase-1-31/certification-and-clearance-packet.md` § 7, it changes no question in that packet's
nine rows, and it moves no register state cell.

---

## 5. The acceptance-run obligation list

Per canonical task row: what the coming acceptance run **can** discharge in this environment, and
what it **cannot**, with the reason named. This is meant to be used as a checklist, so every line is
a single checkable act.

### 5.1 Environment facts the list is derived from

| Fact                                                                                                                                | Consequence                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| The Playwright browser cache holds `chromium` and `chromium_headless_shell` only; no Gecko and no WebKit build is present           | A second and third engine cannot be exercised without installing them                           |
| The two system browsers installed are Chrome and Edge — one engine family                                                           | Chrome-channel runs add a channel, not an engine                                                |
| No camera device and no hand scanner are attached                                                                                   | The scan surface's camera path and duplicate-frame protection cannot be driven by real hardware |
| No printer is attached                                                                                                              | Physical print output cannot be produced; browser print emulation can                           |
| No S3-compatible object storage is provisioned (`docs/platform/environment-configuration.md:389-430`, "Nothing below exists today") | A real byte-transfer upload cannot be completed                                                 |
| No message-delivery provider is implemented — the same section says so in those words                                               | Invitation and reset delivery cannot be proved end to end                                       |
| No hosted Supabase project is configured                                                                                            | Any hosted-identity path is out of reach                                                        |
| The accessibility spec self-skips unless the account kind is `owner-acceptance` (`accessibility.spec.ts:30-32`)                     | A run under any other account executes zero cases and still reports green                       |
| The authenticated tier is opt-in (`playwright.config.ts:63`)                                                                        | Without the variable the tier collects and executes nothing                                     |
| `scripts/ci/coverage-gate.mjs` is in no npm script (§ 2)                                                                            | A local run cannot enforce the coverage floors; only the hosted job does                        |
| No assistive technology is installed                                                                                                | Automated rule scanning is available; screen-reader verification is not                         |

### 5.2 Frontend rows

| Row        | The run CAN discharge                                                                                                                                                            | The run CANNOT discharge, and why                                                                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FE-001** | A per-screen **composition-conformance** pass over all 87 routes, recording which primitives each screen composes and what it authors locally, with the verdict field left empty | A **fidelity** verdict against an approved prototype — no such artefact exists for any module (§ 4), and the basis question is unresolved                                           |
| **FE-002** | Re-execution of the sixteen committed specs in `authenticated-en`, `authenticated-ar` and `authenticated-tablet`; a by-hand functional walk of the eleven spec-less prefixes     | A **re-executable** functional proof for those eleven prefixes — no spec exists to run, and writing one is frontend work, not an acceptance run                                     |
| **FE-003** | Arabic and English rendering of every screen the run opens, at the two locale projects; catalogue parity via `validate:plain-language` and `i18n.test.ts`                        | Static resolution of the **18 composed state keys** — the key is built from a runtime status, so only a live failure of each kind renders it (CC-59 (e))                            |
| **FE-004** | A right-to-left render of every screen the run opens, via `desktop-ar`, `tablet-ar` and `authenticated-ar`; logical-property conformance via `style:check:web`                   | Right-to-left evidence for the eleven spec-less prefixes beyond the by-hand walk; a right-to-left **component** case for the thirteen left-to-right-only suites — that is test work |
| **FE-005** | Desktop 1440×900, laptop 1280×800 and tablet 1024×768 for the eight specs the tablet project selects, plus any screen walked by hand at a resized window                         | **Tablet in Arabic** on any authenticated screen — the tablet project is `en-GB` only (`playwright.config.ts:294`), and changing it is a config change, not a run                   |
| **FE-006** | An automated rule scan of the 24 routes in `accessibility.spec.ts:144-170`, **if and only if** the run signs in as the `owner-acceptance` account                                | Any accessibility measurement for P1-28, P1-29, P1-30, P1-31, inventory or the console — those routes are not in the list; and **screen-reader verification**, no AT installed      |
| **FE-007** | Keyboard reachability and focus order on every screen the run opens, by hand, plus the committed focus cases                                                                     | A per-screen interactive-element inventory for the uncovered modules — that is authoring, not running                                                                               |
| **FE-008** | Browser **print emulation** against the five business documents and the label sheet, in both directions                                                                          | **Physical printed output** — no printer. And **CC-32** is a defect to observe, not a thing the run can close                                                                       |
| **FE-009** | The loading, empty and permission-denied states on every screen the run opens; the error state wherever the run can force a refusal                                              | The **rendered text** of the composed-key states at the 18 sites, unless the run can force each underlying read failure                                                             |
| **FE-010** | Nothing today. With Chromium's network-condition emulation the run **could** throttle a session — but no harness, no fixture and no per-screen expectation exists to run         | Any slow-network assertion at all until the harness and the expectations are written; and real-world mobile conditions, which emulation approximates and does not reproduce         |
| **FE-011** | Selecting a file on each of the three upload surfaces and observing the client-side validation and the request the screen sends                                                  | A completed **byte transfer to a store** — none is provisioned; and oversized, rejected-type, scan-failed and interrupted-upload cases, which need a store that answers them        |
| **FE-012** | A Chromium pass and a Chrome-channel pass — the same engine twice                                                                                                                | **A second and a third engine.** No Gecko and no WebKit build is installed; installing them is a setup act the run may not perform silently                                         |
| **FE-013** | The web unit tier locally, with coverage, against the include list at `apps/web/vitest.config.ts:52-62`                                                                          | A **hosted** figure, and enforcement of the floors — `coverage-gate.mjs` is in no npm script; and any figure for the P1-29, P1-30 or inventory roots, which are outside the list    |
| **FE-014** | An inventory of what the existing fixtures create, and a written statement of the entity chain each uncovered screen needs                                                       | A fixture world that reaches the eleven spec-less prefixes; and the platform-console signed-in journey, which needs two credentials the governed job does not hold                  |

### 5.3 Security, QA, DevOps and Documentation rows

| Row         | The run CAN discharge                                                                                                    | The run CANNOT discharge, and why                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| **SEC-001** | Re-execution of the permission and route-binding suites and `isolation.spec.ts`; the three registered permission gates   | The carried permission-bundle finding — a backend change, not a run; and **SEC-C1**, which only the security reviewer may write |
| **SEC-002** | Re-execution of the refused-download negatives and the sensitive-narrative suites                                        | **CC-63 (a)** — the branch-scoped refusal does not exist to be observed; and any evidence involving a real object store         |
| **SEC-003** | Re-execution of the escalation and concurrency suites against a disposable database                                      | **CC-56 (b)** — six sites outside the phase's operation set, owned by other lanes; and any hosted-environment abuse case        |
| **SEC-004** | Re-execution of the audit-emission suite and the audit-log browser spec; observation of the console audit screen by hand | **L-13** — the export audit records selection and counts, so no run can make it identify the exact bytes disclosed              |
| **QA-001**  | A local coverage run over the include roots                                                                              | A hosted figure; enforcement of the floors; coverage of the three excluded feature roots                                        |
| **QA-002**  | Re-execution of the error-path matrix, the wire-shape gates and the OpenAPI gates                                        | Contract coverage for operations that have no contract suite; and **QA-C2**, a human act                                        |
| **QA-003**  | Re-execution of the database isolation suites against a disposable container and of the application-layer probes         | Isolation evidence on any environment other than a disposable one                                                               |
| **QA-004**  | Re-execution of the concurrency, versioning and version-sourcing suites and their gate                                   | **CC-57 (b)** — the gate judges the send, not the screen state, so no run of it yields a runtime property                       |
| **QA-005**  | Collection of every artefact the run produces, with its digest, into one index                                           | **Packaging into the evidence index** — that is the certifier's and the Owner's act; and a collection is not an execution       |
| **DO-001**  | The hosted quality gates on a pull request, which is the only hosted truth available                                     | Any local claim of a hosted result; and the registration of a new npm script, which is a change, not a run                      |
| **DO-002**  | Observation that structured logs and correlation identifiers appear for each journey the run drives                      | Alert **routing** — no diagnostics collector is operated and none is configured                                                 |
| **DOC-001** | Nothing by running. It is discharged by writing the synchronisation record                                               | Synchronisation of the Field 34 set, which is not tracked in this repository                                                    |
| **DOC-002** | Nothing by running                                                                                                       | Its predecessor is only prepared, and the chapter's chain makes this row depend on it                                           |

### 5.4 Three whole-run preconditions the checklist depends on

1. **Sign in as the `owner-acceptance` account, or FE-006 measures nothing** while reporting green
   (`accessibility.spec.ts:30-32`).
2. **Set the authenticated opt-in**, or the entire authenticated tier collects and executes nothing
   (`playwright.config.ts:63`).
3. **Record the head, the database target and the locale/viewport project for every observation.** A
   run that does not name them produces evidence no later reader can place.

---

## 6. What this document does not claim

- **No P1-32 task is started**, none is complete, and every one of the 27 rows keeps the chapter's
  own status, `Planned`.
- **No gate is satisfied.** Gate P1-G31 is unsatisfied — conditions 2 and 3 await the nine absent
  determinations. Gate P1-G32 is not addressed. Promotion stays NOT eligible.
- **Nothing was executed.** No test tier, coverage run, build, browser tier, database, stack,
  migration or hosted job. Every figure above is a static read at `3b50f26c`.
- **No prototype is approved**, no fidelity basis is designated, and no fidelity verdict is reached.
  § 4 states a contradiction and routes it; it resolves nothing.
- **No determination is issued**, no decision field is filled, no name, date or signature is written
  for anybody, and no register state cell is moved.
- **No certification, clearance, environment, approval or Owner verdict is asserted or implied**, and
  no review anywhere is described as independent.
- **No P1-31 record is amended** by this file. The three staleness findings in § 2.1 are recorded
  here, not corrected there.
- **No P1-32 register, task matrix or acceptance record is created**, and nothing is written into any
  evidence index.
