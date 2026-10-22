# P1-32 — FE-001: the fidelity basis per module, confirmed against OIR-06

Companion to [`execution-plan-and-evidence-map.md`](./execution-plan-and-evidence-map.md) § D and to
[`canonical-plan.md`](./canonical-plan.md). That section records what the prototype records say; this
document performs the next executable FE-001 act named there — **confirming the fidelity basis per
module against OIR-06** — and it performs it as a documentation act and nothing else.

- **Head.** `beebc6c28c873f498fe0503161eb53caa107a9e3` (protected `develop`). Every repository
  citation below was read with `git show origin/develop:<path>`, never from a working tree.
- **Date.** 2026-09-16.
- **Task.** `P1-32-FE-001` — UI-prototype fidelity review. Status at this head: `Planned`.

---

## PREPARATORY ONLY

**This document is preparatory. Nothing in it was executed, nothing in it passed, no prototype is
approved and no fidelity is asserted.**

**The dependency rule, as the chapter states it.** P1-32 Field 7, first bullet (¶19913), verbatim:

> The dependencies in Field 8 have passed their recorded exit gates: Phases 1-25…1-31 and backend
> gate Phase 1-24.

Read against Phase 1-31's own exit gate. P1-31 Field 33, ¶19875, verbatim:

> Gate P1-G31: RootLco may authorize dependent work only when the Definition of Done is evidenced,
> the QA lead certifies the test/evidence index, the Security reviewer clears applicable blockers,
> and the approval owner records Pass / Conditional Pass / Fail / Deferred with conditions. Until
> then, status remains Planned.

**Gate P1-G31 is not satisfied at this head.** Conditions 2 and 3 are unsatisfied: the nine human
determinations — `QA-C1`…`QA-C5` and `SEC-C1`…`SEC-C4` — are absent, their decision fields at § 7 of
[`../phase-1-31/certification-and-clearance-packet.md`](../phase-1-31/certification-and-clearance-packet.md)
empty at this head. That file's own § 7 header states the rule, verbatim (lines 243–244):

> **Only the person holding the role may fill a row.** A blank row is not a refusal and is not a
> pending approval; it is an act that has not been performed.

The Owner's conditional phase decision of 2026-09-16 does not satisfy either condition, and its own
terms forbid reading it that way. **No P1-32 task is started here, and none may be.** FE-001's
status remains the chapter's own `Planned`.

---

## 1. The rule, verbatim

### 1.1 OIR-06 as first recorded

[`../phase-1-25/owner-input-required.md`](../phase-1-25/owner-input-required.md) line 19, byte-exact
(the table cell is reproduced with the file's own padding):

> | **OIR-06** — visual identity / UI prototypes | **Open.** Explicitly "blocks frontend build-out phases (Phase 1-25 onwards)" |

The exhaustive search behind that row, same file lines 23–30, records that no `prototypes/`,
`designs/`, `mockups/` or design-source file existed in the repository or the sibling delivery
folders. The package that would have closed it is § 2.4 of the same file, line 95
("### 2.4 Approved prototype package — closes OIR-06"), line 97:

> Required by P1-EC-006. For P1-25 the prototypes must cover the surfaces that exist today:

followed at lines 99–103 by the surface list (shell, header, sidebar expanded and collapsed, tablet
drawer, breadcrumbs, page header and actions, form controls, data table, dialog, drawer, tabs, toast,
the four states, print sample — each in Arabic (RTL) and English (LTR), at desktop and tablet), and
at lines 105–106 by:

> A separate P1-26 package will be needed for the eighteen authentication and
> administration screens; supplying both together avoids a second blocking round.

Neither package was delivered. Non-delivery is confirmed independently at
[`../phase-1-26/preflight/dependency-readiness.md`](../phase-1-26/preflight/dependency-readiness.md)
lines 62–63:

> **No approved prototypes exist in the repository.** There is no `prototypes/`,
> `designs/`, or `mockups/` directory and no design artefact anywhere under `docs/`.

### 1.2 Where OIR-06 was resolved, and the text of the resolution

[`../phase-1-27/canonical-plan.md`](../phase-1-27/canonical-plan.md) line 64 opens the section
("## 3. Visual decision — correction C"). The resolution text, lines 66–76, byte-exact:

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

(§ D of the companion document cites this quotation as lines 65–75; measured at this head the
resolution sentence begins at line 66 and the last bullet is line 76. The one-line offset is recorded
here rather than corrected in that file, which is merged.)

### 1.3 P1-EC-006, and the answer already given against it

The three table rows quoted in this section are byte-exact in their cell text. The repository
formatter collapses the inter-cell padding of a table row quoted inside a block quotation, and that
collapse is the only difference from the source line.

[`../phase-1-25/owner-input-required.md`](../phase-1-25/owner-input-required.md) line 21, byte-exact:

> | **P1-EC-006** | Requires approved prototype links/files **and** a fidelity checklist |

The answer recorded against that requirement, at
[`../phase-1-25/gate-record.md`](../phase-1-25/gate-record.md) line 44, byte-exact:

> | Prototype basis | the approved P1-25 design system itself; no separate package required | P1-EC-006 |

The identical row is repeated for P1-26 at
[`../phase-1-26/gate-record.md`](../phase-1-26/gate-record.md) line 273, byte-exact:

> | Prototype basis | the approved P1-25 design system itself; no separate package required | P1-EC-006 |

### 1.4 What the rule makes the fidelity basis, stated plainly

Reading 1.1 through 1.3 together, and adding nothing:

1. **No approved prototype artefact exists for any module**, and for P1-25 and P1-26 the records
   state that none is required, because the Prototype basis designated against `P1-EC-006` is **the
   approved P1-25 design system itself**.
2. **OIR-06 is resolved, not satisfied by delivery.** It was closed by designating the built design
   system as the basis; the withdrawn wording is the "blocked" wording, not the prototype
   requirement's subject matter.
3. **The replacement rule is a composition rule.** The P1-25 / P1-26 design foundations are binding;
   a module composes approved components; a module must not create a competing design system;
   feature-specific composition is allowed.
4. **Therefore, when no per-module prototype exists, the fidelity basis under the rule is the
   binding P1-25 / P1-26 design foundations** — the token, theme, brand, primitive, state, direction
   and print authorities of `apps/web` — **and the question FE-001 can honestly ask of a screen is a
   composition-conformance question**: does this screen compose the approved components, and does it
   introduce anything that amounts to a competing design system?
5. **FE-001's acceptance sentence has a second limb** — "and approved backend contract" (¶19947,
   identical to the P1-31 wording at
   [`../phase-1-31/canonical-plan.md`](../phase-1-31/canonical-plan.md) lines 220–221). Which
   artefact the records designate as the _approved backend contract_ at this head is **NOT
   ESTABLISHED by this document**; it is not decided here and is carried to § 3.

**What the rule does not do.** It does not manufacture an approved layout, it does not extend the
P1-25/P1-26 designation to any later phase by its own words, and it does not authorise a fidelity
verdict. Points 1–4 are a reading of records that already exist. Nothing below approves anything.

---

## 2. Per module group

Seven groups, as the structured map enumerates them. For each: the recorded prototype reference, the
implementation-review evidence that exists, **the fidelity basis this document confirms** — a
confirmation of what the records already establish, not a new approval — and what FE-001 will compare
against when it executes. **Every comparison named in a "when it executes" row is NOT RUN.**

### 2.1 P1-25 — design-system foundation, shell, gallery, print primitives, i18n/direction layer, brand and token authority

- **Prototype reference — PRESENT.** "the approved P1-25 design system itself; no separate package
  required", recorded against `P1-EC-006` at `../phase-1-25/gate-record.md:44`.
- **Implementation-review evidence.** `../phase-1-25/gate-record.md:123` ("## 7. Owner
  visual-fidelity decision") through `:134`, recorded as "**Decision: Pass**, against the approved
  direction recorded in §2" and verified "in the running application" rather than asserted. Gate
  head `ac7c089c` (`:9`); gate verdict at `:8`. This is **the only human fidelity review in the
  repository**.
- **Fidelity basis confirmed.** The design system itself, as the P1-25 gate record already
  designates it, together with the five Owner values recorded at `../phase-1-25/gate-record.md:39-43`.
  Confirmed as already established; nothing is approved here.
- **When FE-001 executes (NOT RUN).** The foundation surfaces enumerated at
  `../phase-1-25/owner-input-required.md:99-103`, compared against the design system as built at the
  head under review, in Arabic and English, at desktop and tablet. The P1-25 decision was taken at
  `ac7c089c`; whether it carries to `beebc6c2` unchanged is § 3, O-C.

### 2.2 P1-26 — authentication and administration

- **Prototype reference — MISSING.** A dedicated package was formally requested
  (`../phase-1-25/owner-input-required.md:105-106`) and never supplied
  (`../phase-1-26/preflight/dependency-readiness.md:62-63`, and the unblocking-input row at `:99`).
  The _basis_ row, however, is present and identical to P1-25's:
  `../phase-1-26/gate-record.md:273`.
- **Implementation-review evidence.** No per-screen fidelity review exists. The substitute is the
  inherited-primitive argument at `../phase-1-26/accessibility-evidence.md:12-28`, plus the
  mechanised checkers (`validate:web-theme`, `validate:web-brand`, `validate:web-tokens`,
  `style:check`) and `apps/web/tests/brand-replacement.test.ts`. Phase acceptance at
  `../phase-1-26/closure-record.md:5` is a functional acceptance of the running application, not a
  fidelity review.
- **Fidelity basis confirmed.** The approved P1-25 design system, as `../phase-1-26/gate-record.md:273`
  already records for this phase in its own words. The absent package does not leave P1-26 without a
  basis; it leaves it without a per-screen review.
- **When FE-001 executes (NOT RUN).** The sixteen-to-eighteen authentication and administration
  screens, each against the P1-25 primitive inventory: which primitives the screen composes, and
  which layout it authors locally. No approved layout is available to compare against and none is
  invented.

### 2.3 P1-27 — CRM (customers) and vehicles

- **Prototype reference — MISSING as a per-module artefact.** The governing rule replaces it:
  `../phase-1-27/canonical-plan.md:64-76`, quoted byte-exact in § 1.2. Corroborated at
  `../phase-1-27/preflight/final-readiness.md:63` ("OIR-06 resolved | **PASS**").
- **Implementation-review evidence.** `../phase-1-27/installed-chrome-review.md`, a by-hand review of
  the merged application, and the phase acceptance at `../phase-1-27/closure-record.md:5`. Neither
  compares a screen to an approved layout, because none exists. The composition rule is enforced only
  indirectly, by the theme, token and style checkers and `apps/web/tests/stylelint-policy.test.ts`.
- **Fidelity basis confirmed.** The binding P1-25 / P1-26 design foundations, under the replacement
  rule written for this phase in its own words. P1-27 is the one later phase whose basis is stated
  _for itself_ rather than inherited.
- **When FE-001 executes (NOT RUN).** The eight CRM and vehicle routes, each against the composition
  rule's four limbs: composes approved components; creates no competing data-table, notification,
  i18n, form, dialog, API-client, brand or scroll-ownership system; feature-specific composition
  identified as such; no brand change outside controlled change.

### 2.4 P1-28 — appointments, vehicle reception, attachments and evidence capture

- **Prototype reference — MISSING.** No prototype reference exists anywhere in
  `docs/phase-1/phase-1-28/**`. The basis is inherited from the P1-27 rule, not stated for this
  phase.
- **Implementation-review evidence.** `../phase-1-28/media-capture-decision-record.md` is the nearest
  design-decision record and it decides a capture mechanism, not a layout. Phase acceptance at
  `../phase-1-28/closure-record.md:5`, bounded by the phase's own damage record: four frontend
  defects were found by hand while every automated tier was green.
- **Fidelity basis confirmed.** The binding P1-25 / P1-26 design foundations, **by inheritance from
  the P1-27 rule**. Whether that inheritance is valid, or whether each phase owes its own
  designation, is § 3, O-B — this document records the inheritance as the records leave it and does
  not ratify it.
- **When FE-001 executes (NOT RUN).** The eight appointment, reception and walk-in routes, plus the
  capture surfaces, against the same composition-conformance question. The four hand-found defects
  are the recorded reason a mechanised tier is not accepted here as a substitute.

### 2.5 P1-29 — work orders, diagnostics, technicians, quality and closure

- **Prototype reference — MISSING.** No prototype reference in `docs/phase-1/phase-1-29/**` (four
  files, none naming one). Inherited basis: the P1-27 rule.
- **Implementation-review evidence.** `../phase-1-29/w9-acceptance-record.md:85-109` — the W1–W8
  journey walked by hand in the browser on a production build. A functional walk, not a fidelity
  review: no accessibility scan, no right-to-left render, no committed browser spec.
- **Fidelity basis confirmed.** The binding P1-25 / P1-26 design foundations, by inheritance (§ 3,
  O-B).
- **When FE-001 executes (NOT RUN).** The six work-order, technician and quality routes. The
  diagnostic- and checklist-template administration screens are recorded in the module map for
  completeness of the P1-29 surface only and are **not** inserted into P1-32 scope here; their
  allocation is an open item, not this document's to decide.

### 2.6 P1-30 — services, pricing, quotations, inventory, billing/invoices, payments

- **Prototype reference — MISSING as an artefact, obligation carried verbatim.** The canonical plan
  folds each scope item into one task "against the approved UI prototype and the approved backend
  contract" (`../phase-1-30/canonical-plan.md:30`), with the out-of-scope restatement at `:75`
  ("**Visual design.** Frontend phases implement owner-approved prototypes only (OIR-06)."). No
  prototype artefact is named anywhere in `docs/phase-1/phase-1-30/**`.
- **Implementation-review evidence.** `../phase-1-30/closure-record.md:87-90` records authenticated
  browser evidence on a production build of `3d752119`, in both languages, cited to the P1-29
  acceptance record § 7.2. **Those specs are not committed at this head.** The Owner's own verdict is
  recorded as still outstanding at `:112-115`.
- **Fidelity basis confirmed.** The binding P1-25 / P1-26 design foundations, by inheritance (§ 3,
  O-B). The phase's acceptance sentence names an artefact that does not exist; the rule supplies what
  it names in its place, and nothing more.
- **When FE-001 executes (NOT RUN).** The thirteen catalogue, pricing, quotation, inventory, invoice
  and payment routes, against the composition rule and against the money-presentation authorities.
  There is no re-executable browser evidence for this group to inherit.

### 2.7 P1-31 — vehicle delivery, warranty, reporting

- **Prototype reference — MISSING as an artefact.** The obligation is quoted in the phase's own
  extraction at `../phase-1-31/canonical-plan.md:220-226`; Field 9 at `:99` says "approved UI
  prototypes where applicable". The closure record re-quotes the obligation at `:116-120` and its
  sixteen-row frontend table records "missing" per task **without ever naming a prototype for any of
  them**.
- **Implementation-review evidence.** The richest evidence in the repository, and none of it is
  fidelity: `../phase-1-31/acceptance-record.md` § 7.1, the closing run recorded at
  `../phase-1-31/change-control-2026-09-08.md:8679`, and six committed browser specs. The open print
  defect at `../phase-1-31/change-control-2026-09-08.md:1956` is the closest thing to a fidelity
  finding anywhere in the repository, and it was found by reading the code, not by comparing to a
  design.
- **Fidelity basis confirmed.** The binding P1-25 / P1-26 design foundations, by inheritance (§ 3,
  O-B). **Subject to the gate.** P1-31 has not passed P1-G31; its records are readable as records,
  and confirming what they say about a basis neither closes nor anticipates that gate.
- **When FE-001 executes (NOT RUN).** The nine delivery, warranty and report routes plus the extended
  audit-log surface, against the composition rule. The one open print defect is a carried input to
  that review, not a finding this document makes.

### 2.8 The finding that binds all seven

No approved UI prototype, design file, mock-up, wireframe or design-tool reference exists anywhere in
the repository or the sibling delivery folders at this head, for any module. **Recorded as MISSING,
per module, and not inferred away.** The consequence the companion document already states — that
FE-001 cannot be satisfied as literally written for any of the seven groups — is unchanged by this
confirmation. What this document adds is the other half: under OIR-06 as resolved, the basis FE-001
does have is the binding P1-25 / P1-26 design foundations, and the review it can honestly perform is
composition conformance, per screen, with the verdict field left for the person who holds the role.

---

## 3. What remains an Owner or design decision after applying the rule

Open. Stated as questions, decided by nobody here.

- **O-A — which record governs OIR-06's status.** `../phase-1-27/canonical-plan.md:66` states "**OIR-06
  is resolved.**" Two accepted ADRs state the opposite at this same head:
  `docs/adr/ADR-013-sass-and-scss-styling-architecture.md:9` — "No visual identity has been approved
  (OIR-06, UI prototypes, remains open)." — and
  `docs/adr/ADR-020-frontend-styling-framework-and-component-primitives.md:139` — "**OIR-06 remains
  open.** This ADR decides the mechanism, not the values." A reading that reconciles them is
  available (the _mechanism_ is resolved, the _values_ remain provisional), but no record states that
  reconciliation, and this document does not supply it. **Whose determination, and against which
  record, is open.**
- **O-B — whether the P1-27 rule is inheritable.** The replacement rule is written in P1-27's own
  name ("P1-27 composes approved components"). Five module groups — P1-28, P1-29, P1-30, P1-31, and
  prospectively P1-32's own review — rest on it by inheritance, with no record extending it. Whether
  the designation carries forward, or whether each phase owes its own Prototype-basis row of the kind
  P1-25 and P1-26 each carry, is **open**.
- **O-C — whether the basis is the design system as designated or as it stands.** The P1-25 fidelity
  decision was taken at gate head `ac7c089c`. The styling and primitive mechanism has since been
  decided by `ADR-020`. Whether "the approved P1-25 design system itself" means the system as it
  stood at `ac7c089c` or as it stands at `beebc6c2` determines what a later screen is measured
  against. **Open, and not decided here.**
- **O-D — whether the never-delivered prototype packages are still owed.** The P1-25 § 2.4 request
  and the P1-26 request at `../phase-1-25/owner-input-required.md:105-106` were never withdrawn, and
  the P1-27 resolution withdrew "wording implying visual prototypes are still blocked" — which is not
  the same act as cancelling the requests. **Open.**
- **O-E — the verdict vocabulary and the reviewer for a per-module fidelity determination.**
  `../phase-1-25/owner-input-required.md:108-111` fixes, for P1-25, "**Pass · Conditional Pass · Fail
  · Deferred**" with "Silence cannot be read as Pass". Whether that vocabulary and that reviewer bind
  a per-module FE-001 determination in P1-32, and who holds the role, is **open**. No determination
  field is created by this document.
- **O-F — the second limb of FE-001's acceptance sentence.** Which artefact is the _approved backend
  contract_ against which each module is to be reviewed is **NOT ESTABLISHED** at this head by this
  document. It is named as an obligation in every Frontend task's description and is not designated
  anywhere this document read. **Open.**

None of O-A through O-F is answered here, and none is a blocker this document is entitled to clear.

---

## 4. What this document does not claim

- **No review was executed.** No screen was opened, no browser was started, no journey was walked, no
  application was running. Every per-module "when FE-001 executes" row is **NOT RUN**.
- **No fidelity is asserted.** For no module does this document state that an implementation matches
  a basis. It states what the records establish the basis to be, and no more.
- **No prototype is approved**, none is designated, and none is invented. Every MISSING is recorded as
  MISSING.
- **No gate is satisfied.** Gate P1-G31 is not satisfied — conditions 2 and 3 are unsatisfied, the
  nine human determinations absent. Gate P1-G32 is not addressed. No certification, clearance,
  environment, approval or Owner verdict is asserted or implied.
- **No P1-32 task is started.** FE-001's status is the chapter's own `Planned`, unchanged.
- **Nothing was run and nothing was written to the repository.** No test, lint, typecheck, validator,
  build, stack, database, coverage or hosted job was executed in producing this document; every line
  number and quotation above is a static read at `beebc6c2`. No file under `docs/`, `apps/`,
  `supabase/` or `scripts/` was created, edited, staged, committed or pushed.
- **No open item is decided.** § 3 raises six; it answers none.
- **No existing record is amended**, including the one-line citation offset noted in § 1.2, which is
  recorded rather than corrected.

<!--
SOURCES (all read with `git show origin/develop:<path>` at beebc6c28c873f498fe0503161eb53caa107a9e3,
from the checkout C:/Users/Ezzaldeen/wt-p11; nothing was executed and no file was modified)

  docs/phase-1/phase-1-32/execution-plan-and-evidence-map.md   § A banner; § D "FE-001 first — the fidelity basis per module"; § G
  docs/phase-1/phase-1-32/canonical-plan.md                    chapter extent, task count, Planned baseline
  docs/phase-1/phase-1-25/owner-input-required.md              :19 OIR-06; :21 P1-EC-006; :23-30 exhaustive search; :95, :97, :99-103, :105-106; :108, :111
  docs/phase-1/phase-1-25/gate-record.md                       :8 verdict; :9 gate head ac7c089c; :39-43 Owner values; :44 Prototype basis; :123, :134
  docs/phase-1/phase-1-26/gate-record.md                       :273 Prototype basis row, repeated
  docs/phase-1/phase-1-26/preflight/dependency-readiness.md    :62-63 no approved prototypes; :99 unblocking input
  docs/phase-1/phase-1-26/accessibility-evidence.md            :12-28 inherited-primitive argument
  docs/phase-1/phase-1-26/closure-record.md                    :5 phase acceptance
  docs/phase-1/phase-1-27/canonical-plan.md                    :64 section head; :66-76 the resolution, byte-exact
  docs/phase-1/phase-1-27/preflight/final-readiness.md         :63 "OIR-06 resolved | PASS"
  docs/phase-1/phase-1-27/installed-chrome-review.md           by-hand review of the merged application
  docs/phase-1/phase-1-27/closure-record.md                    :5 phase acceptance
  docs/phase-1/phase-1-28/media-capture-decision-record.md     nearest design-decision record
  docs/phase-1/phase-1-28/closure-record.md                    :5 phase acceptance
  docs/phase-1/phase-1-29/w9-acceptance-record.md              :85-109 hand-walked journey
  docs/phase-1/phase-1-30/canonical-plan.md                    :30 acceptance sentence; :75 out-of-scope restatement
  docs/phase-1/phase-1-30/closure-record.md                    :87-90 browser evidence; :112-115 Owner verdict outstanding
  docs/phase-1/phase-1-31/canonical-plan.md                    :99 Field 9; :220-226 the five implementation obligations
  docs/phase-1/phase-1-31/closure-record.md                    :116-120 obligation re-quoted; sixteen-row frontend table
  docs/phase-1/phase-1-31/acceptance-record.md                 § 7.1
  docs/phase-1/phase-1-31/change-control-2026-09-08.md         :1956 open print defect; :8679 closing run
  docs/phase-1/phase-1-31/certification-and-clearance-packet.md § 7 at :241-271, the nine empty rows; :243-244 the rule
  docs/adr/ADR-013-sass-and-scss-styling-architecture.md       :9 "OIR-06 ... remains open"
  docs/adr/ADR-020-frontend-styling-framework-and-component-primitives.md  :139 "OIR-06 remains open"
  RootLco_Phase_1_Development_Plan_recovered_v01.docx          ¶19875 (P1-G31); ¶19913, ¶19918, ¶19947 (P1-32 Fields 7, 8, 14) — quoted at second hand from the merged P1-32 extraction, not re-opened here

SCRATCHPAD INPUTS (session, not repository)
  scratchpad/p1-32-evidence-map.json        fields fe001_prototypes, frontend_modules, not_found
  scratchpad/handover-map-A.json            field p1_32_next_task_inputs; determination_rows
-->
