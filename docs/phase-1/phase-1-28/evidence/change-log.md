# P1-28 — change log

**Classification:** Confidential — Commercial Product and Pilot Planning

**CURRENT PHASE STATUS: OPEN.** `OWNER ACCEPTANCE` has not been asked for and
has not been returned. The permanent Frontend rule from P1-26 onward is that no
Frontend phase closes without the Product Owner testing the running application
in real installed Chrome and returning `OWNER ACCEPTANCE: PASS` verbatim, and
that silence is never Pass. Automated CI is necessary and is not sufficient.
Nothing in this file is a closure record; the phase remains open and `main` is
untouched.

`phase-1-19`, `phase-1-20`, `phase-1-21` and `phase-1-27` each carry
`evidence/change-log.md`, and P1-27's own change log opens by recording that the
phase shipped nothing at that path for a while and that **no document recorded a
decision to drop it** — half a named canonical deliverable, covered by a task
cell citing an automated proof that did not exist. This file exists so P1-28
does not repeat that, and
`apps/web/tests/p1-28-guidance-reconciliation.test.ts` fails if it disappears,
if the sibling convention disappears, or if it stops naming any canonical task
category.

Entries are grouped by the wave that produced them. Each names the **defect or
the decision**, not the feature — a list of features is a release note, and what
a later reader needs is why the product is shaped this way.

---

## Before the first screen — the day-one authority

P1-27 spent five adversarial rounds paying for a task register that did not exist
when its first screen was built: 33 adjudicated items were counted as 42
canonical tasks and nine tasks appeared in no status table anywhere.

P1-28 started the other way round. `docs/phase-1/phase-1-28/canonical-plan.md`,
`contract-archaeology.md`, the derived 35-task matrix and the gate that refuses
drift (`validate:p1-28-matrix`) all landed **before the first component**. The
universe is derived from the plan rather than maintained beside it, so the state
"a task nothing lists" cannot come to exist.

The archaeology found the phase's governing fact: at the P1-27 closure head the
entire appointment and reception public surface was **12 POST commands and zero
reads**. Every wave below is sequenced by that fact.

## Backend remediation, before any of it could be consumed (`P1-28-DOC-001`)

Five of the eight remediations the archaeology registered were executed on
Backend-owned branches and merged to `develop` before the Frontend consumed
them — never inside this Frontend branch, per the standing ownership rule.

- **R1 (#220)** — the reception read surface: six GETs and the
  `rec.reception.read` seed. The single highest-leverage change in the phase. It
  is what lifted the Owner-named readiness blocker: before it, approve and
  convert worked only inside one unbroken browser session, and closing the
  browser left a vehicle in custody with no path forward.
- **R2 (#220)** — the appointment read surface and its seed.
- **R3 (#220)** — seven catalogue reads. The registered ids took the
  `apt.catalogue-*` / `rec.catalogue-*` form rather than the form the register
  proposed, and the register was corrected to the tree rather than the other way
  round.
- **R4 (#221)** — `crm.customer-vehicle-list`. The customer-to-vehicle
  relationship had been write-only platform-wide.
- **R5 (#220)** — `close-without-work` and `refuse`. Both terminal visit states
  had been unreachable by any operation, so an abandoned visit blocked its
  vehicle permanently. That is the INT-013 defect shape, and this was its
  sibling.

`R6` (the receiving-employee referent), `R7` (customer search by telephone) and
`R8` (per-reception documents) are still open, and each is stated on the screen
that meets it rather than papered over.

## Wave A — the contract layer and the reachability gate (`P1-28-SEC-004`)

The typed apt/rec/customer-vehicle contract modules were written from route
source, and `validate:p1-28-write-reachability` landed with them. It derives the
canonical write list from the P1-24 operation register at check time — 14
operations — and refuses any it cannot classify.

It exists because of `P1-27-INT-113`: ten canonical P1-27 writes shipped with a
route, a permission, an audit class, an idempotency entry, an OpenAPI path and a
register row, and no screen from which anybody could invoke them, while every
automated tier stayed green. The allow-list only shrinks, and an allow-listed
operation that IS called fails the gate — so the wave that lands a screen must
flip the entry in the same change.

Wave A also produced the finding that shaped the gate: **an adapter nobody
consumes is not reachability.** The whole reception adapter surface landed
before its screens, so a write can have a real call site and still be invocable
by nobody. Teaching the gate to resolve a path helper by shape would have
flipped five screenless writes to REACHABLE — INT-113 certified by the gate
built to catch it — so consumption is required as well as a call site.

## Waves B–H — the screens (`P1-28-FE-001` … `P1-28-FE-022`)

- **B — walk-in intake (`FE-006`)** with two degradations stated on screen: no
  telephone search (R7 open), and the customer-to-vehicle list only after R4.
- **C — appointments (`FE-001`…`FE-005`)**. The truthful-labelling obligation
  bites here: **"Confirm" is not an operation.** Confirmation is a side effect of
  `apt.appointment-reschedule`, so the control says "Confirm by rescheduling"
  and the awaiting-confirmation state carries the same sentence.
- **D — the check-in wizard core (`FE-007`/`FE-008`/`FE-009`)**, including the
  walk-in-to-check-in seam and the receiving-employee field, which records an
  identifier and says so because no employee register exists (R6).
- **E — pre-service condition evidence (`FE-010`…`FE-016`, `FE-019`)**. The
  wave's own record is `EVIDENCE_KIND_COVERAGE`: of the eight evidence kinds
  four record unconditionally, three appear only when the reference data they
  need exists, and one is blocked outright because its contract requires a
  registered document that nothing in this product can produce. A coverage claim
  nobody can check is what that table exists to stop.
- **F/G — summary, approval, the two terminal exits, conversion, the
  acknowledgement document and the branch board (`FE-020`, `FE-021`,
  `FE-022`)**. Conversion is the only way a work order comes to exist, and a
  replay on a converted visit answers 200 `alreadyConverted: true`, which the
  step renders as the success it is.
- **H — media (`FE-017`)**: the named-open-decision notice, and the ban proved.
  Nothing on that screen takes, chooses or records a picture or a file. Two CI
  rules refuse an upload control and refuse an invented size or file-type limit
  while `P1-OD-025` is open, so a "sensible default" of 10 MB and JPEG/PNG —
  which looks like care and is an undecided policy presented as though it had
  been decided — cannot be added back quietly.

## Security, QA and DevOps riders

- `P1-28-SEC-001`/`-002`/`-003` ride the waves they police: the role-to-grant
  mapping, the sensitive-narrative controls for complaint and contents (where
  the application check passes and the DATABASE refuses), and the no
  client-asserted-scope rule.
- `P1-28-QA-001`…`-004` ride them too: the contract-mirror suites, the error and
  replay-shape coverage, tenant isolation, and the `recordVersion` sourcing
  discipline. `P1-28-QA-005` is end-of-phase.
- `P1-28-DO-001` — the two P1-28 gates are now named by hosted jobs directly
  rather than reached only through the clean-room aggregate, and the trace ends
  at the required-check list rather than at "a workflow mentions it":
  `validate:p1-28-matrix` runs in `static-quality`,
  `validate:p1-28-write-reachability` in `web-quality`, both jobs are
  `alwaysRequired`, both are in `ci-gate`'s `needs`, and `ci-gate` is the single
  required check.

  The same task found a co-maintenance failure and fixed it: the P1-28 plan §9
  names three Frontend trees and the frontend gate had adopted one of them, so
  `features/appointments` — the booking, calendar and detail screens — was
  scanned by no rule at all, including the two that enforce the media
  disposition. Adopting it required a `MODULE_DISPOSITION` decision for
  `components/overlays` and moved two derived doc-count markers, and all three
  landed in the same change, which is what the obligation says.

- `P1-28-DO-002` — the correlation reference was already surfaced across the
  apt/rec surface and nothing was measuring it. It is measured now: every
  recoverable failure in both feature trees and all three route trees is swept
  structurally, in both directions, so a missing reference on a backend failure
  and an invented one on a client-side gate both fail.

## Documentation

- `P1-28-DOC-001` — both authority documents were re-verified against the tree
  at this head. The correction that mattered: an addendum had exempted the
  contract tables from the document's own rule ("if the tree disagrees, the tree
  wins"), leaving the archaeology asserting that operations which now exist and
  which P1-28 screens now call were MISSING — including the sentence "there is
  no GET anywhere in apt/rec", the most load-bearing claim in the file. The
  exemption is withdrawn and every row states what is true at this head, with
  the source-head fact kept and labelled as history where it explains a
  decision. Three documents carried a citation to gate rules that had moved; all
  three are corrected. `FE-020`'s operation binding was missing the two terminal
  exits the reachability manifest already attributed to it, and now names them.
- `P1-28-DOC-002` — this file, and `operator-guide.md`: what each screen does,
  what is deliberately blocked and why. Its sentences are pinned to the
  executable thing they describe, because a guide that only has to exist passes
  while describing a product nobody built.

---

## What is deliberately NOT in this release

Stated here so the absence is a record rather than a discovery:

- **Media capture** — `P1-OD-025` is open. No approved file types, no invented
  size limit, no object store assumed. Even after the decision the honest state
  of a registered file is "registered, pending": no storage provider and no
  scanner are configured, so nothing can be retrieved back out.
- **The signature image** — the write requires a registered signature document
  and its exact version, and nothing in this product registers a document. The
  step shows what a signature would attribute and records nothing.
- **Warning-light entries** — the catalogue ships zero rows and no operation
  anywhere can add one. The step says so; no row is invented.
- **Road test** — no operation, status or report for one exists anywhere in the
  platform. Nothing is labelled as a road test.
- **Everything after the work order exists** — no work-order editing, no
  technician assignment, no department routing, no diagnostics. P1-28 ends where
  the work order begins; those are P1-29.
