# P1-31 — the delivery detail screen, and the P-16 gate-before-read check

**Date:** 2026-09-09 · **Branch:** `feature/p1-31-delivery-detail-screen` · **Base:** `develop`
`0272390b` · **Lane:** `p1-31-frontend` (web, docs, tooling, tests, rootConfig)

This is the first P1-31 screen. It renders one vehicle handover, end to end, and writes nothing.

---

## 1. What the screen shows, and what it reads to show it

`/{locale}/delivery/{deliveryId}` — a route page that resolves one permission, reads the delivery
record, and hands it to a screen of six panels. Each panel reads its own subresource, so one
refusal or one outage stays inside one panel instead of taking the screen with it.

| panel                    | operation                            | permissions the route declares           | what is rendered                                                                                                |
| ------------------------ | ------------------------------------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Summary                  | `sal.delivery-read`                  | `sal.delivery.view`                      | stage, handover moment, a link to the work order, four labelled identifiers                                     |
| Release checks — FE-002  | `sal.delivery-eligibility-read`      | `sal.delivery.view` + `sal.finance.view` | eligible or not, the blocking reasons, every composed fact with its `established` flag, the open required items |
| Receiver — FE-003        | `sal.delivery-receiver-read`         | `sal.delivery.view`                      | the confirmed receiver and who confirmed them, or the fact that there is none yet                               |
| Signatures — FE-006      | `sal.delivery-signature-list`        | `sal.delivery.view`                      | role, moment, and the statement that the image is on file                                                       |
| Checklist results        | `sal.delivery-checklist-result-list` | `sal.delivery.view`                      | item code, label, outcome, and a waiver's reason                                                                |
| History — FE-007         | `sal.delivery-status-history`        | `sal.delivery.view`                      | the append-only transition ledger, newest first                                                                 |
| Work-order entry section | `sal.work-order-delivery-read`       | `sal.delivery.view`                      | on the work-order detail: no handover, or its stage and a link to this screen                                   |

The three paged reads send the cursor the server minted and the page size this feature chose (25,
well inside the routes' bound of 100). No total is requested and none is invented — the reads
publish none.

Absence is never a refusal and never a fault: a delivery with no receiver answers with nothing
inside a 200, a delivery with no signatures answers with an empty page, and a work order with no
live handover answers with nothing. A `not-found` from any of these therefore means the SUBJECT
could not be resolved — a delivery in a branch the caller cannot see — and the screen says exactly
that rather than "there is nothing here".

---

## 2. Gate before read — the proof, not the claim

`sal.delivery.view` is tested and returned on **before** `readDelivery` is called. A page that
issues its read first has already asked the backend for the record by the time it decides whether
the operator may see it; the backend would refuse, but the request was made.

Two independent proofs, because a source rule and a behaviour test fail in different directions:

- **Source.** `scripts/ci/check-p1-31-access.mjs` parses the page and refuses one that reads before
  it denies, one that consults no permission, one whose only `holds` computes a control capability,
  one whose negated check falls through, and one whose docblock merely quotes the rule.
- **Behaviour.** `apps/web/tests/delivery.dom.test.tsx` invokes the route module with a session that
  holds `sal.finance.view` and `sal.delivery.complete` but **not** `sal.delivery.view`, and requires
  both halves: the refusal renders, and every one of the six adapters is untouched. Asserting only
  "nothing was read" would stay green with the gate deleted if the screen happened not to render.

---

## 3. The financial rule: a second permission the page respects rather than discovers

`sal.delivery-eligibility-read` declares `sal.finance.view` **in addition to** `sal.delivery.view`,
because one of the eight reasons it composes is the customer's open balance. A caller without it is
refused at the route with a 403.

So the page resolves that code and passes it down as a capability, and the release-checks panel
renders a scoped refusal **without issuing the request**. Asking and rendering the answer would put
a denial in the backend's log for a decision this screen could make for itself. The refusal is
scoped to the panel and not to the page, because gating the whole screen on a financial code would
hide the custody chain from everybody outside finance — which is the opposite of least privilege.

`sal.delivery.complete` is resolved for one purpose only: the panel says whether the single
overridable reason may be overridden by the reader or by somebody else. It gates nothing, because
this slice contains no act for it to authorise.

---

## 4. "Could not be checked" is not "failed"

Five of the eight blocking reasons exist only because the application composes them — the database
primitive enforces three — and every composed fact fails **closed**: a fact that could not be read
counts as blocking. That default is correct and it is a terrible thing to render as if it were an
observation.

An operator who reads _the customer still owes money_ chases the customer. An operator who reads
_this could not be checked_ raises a platform problem. The panel therefore draws every fact by its
`established` flag, marks the unreadable ones distinctly, and prints the source reference beside
them so support has something to search for. The rendering test asserts the counts in **both**
directions — one unreadable row and two established ones — because an assertion on the unreadable
count alone would pass if every row were drawn that way.

---

## 5. Sensitivity: two references that stay references

`identityEvidenceDocumentVersionId` on the receiver and `signatureDocumentVersionId` on each
signature point at stored documents. This screen states that the evidence is on file and stops:

- no request is made for either document;
- neither identifier is printed anywhere in the rendered page — the test asserts that the document
  strings appear nowhere in the container;
- no control on the screen would fetch the bytes.

An identity document is the most sensitive thing this custody chain touches, and a handover screen
has no business displaying one.

---

## 6. No money crosses this feature

Not one delivery read carries an amount. `financial_balance_outstanding` is a blocker **code**, not
a figure, and `finalOdometerReadingId` is a reference to a reading rather than a reading value.

Consequently this slice adds **no area** to `check-p1-30-server-arithmetic.mjs` and P1-31 carries no
arithmetic-gate entry yet. That is a decision, not an omission: an area with no money in it is a
rule that passes vacuously, and a vacuous rule is indistinguishable from a working one. **The first
money-bearing P1-31 screen owes that entry**, and the condition is recorded here so the obligation
travels with the phase rather than with anybody's memory.

Likewise `check-p1-30-payload-parity.mjs` is unaffected: it compares REQUEST payloads against the
routes' zod schemas, and this slice sends no request body at all.

---

## 7. P-16 — the gate's design

`scripts/ci/check-p1-31-access.mjs`, wired as `validate:p1-31-access`, appended to
`verify:policies`, registered in `scripts/ci/check-command-coverage.mjs`, and mutation-proved by
`tests/ci/p1-31-access-gate.test.ts`.

**A sibling, not a widening.** The P1-29 gate derives its segments from the `wo|dia|qms|tech`
operations and the P1-30 gate from `svc|quo|inv|sal|wty`. Both are what a closed phase's closure
rests on, so widening either changes a gate somebody else's evidence depends on. This is a third
file that **reuses the judgement** — `judgePage`, and through it the P1-28 gate's
`denyAndReturnGate` — so the five false-negative shapes an adversarial review found in the first
P1-29 version cannot regress here without regressing there.

**Scope is an allow-list of operation ids, not a namespace.** This is the one structural difference
from its siblings and it is forced: P1-30 already owns the whole `sal.` and `wty.` namespaces, so a
namespace pattern here would either claim P1-30's operations or claim nothing. `P1_31_OPERATION_IDS`
names the eight operations P1-31 published; each is looked up in the P1-24 operation register and
its route's **resource root** is taken (`/api/v1/deliveries/{deliveryId}/eligibility` → `deliveries`)
for the reason the P1-29 gate records: taking every segment would pull in `eligibility`,
`signatures`, `status-history` and a dozen more, and a rule that reaches outside its lane produces
violations nobody in that lane can act on.

**A stale allow-list entry is a violation.** An id named in the list that the register does not
carry is reported, not skipped. That is the failure mode an allow-list has and a namespace does
not — it can go quietly stale, shrinking the gate's reach with no diff saying so — and the test
proves the refusal against a register that carries none of the ids.

**The dashboard areas are named as well as derived.** `P1_31_AREAS` is `delivery`, `warranty`,
`reports`. This is not redundant with the derivation: the href committed in `navigation.ts` is the
**singular** `/delivery`, while every delivery operation is addressed under the plural `deliveries`,
so a page under `(dashboard)/delivery/**` matches no derived root. That is precisely how this
screen would have escaped the P1-30 gate. `warranty` and `reports` have no page today and are named
now, so the first screen under either meets a rule that predates it.

**Anti-vacuity, twice.** An empty derivation is refused, as in both siblings. And unlike them, this
gate ships **beside** a screen rather than ahead of one, so it also refuses a run that examines no
page. The floor is an explicit `--min-pages`, defaulting to one over the application root and to
zero when `--app-root` points at a scratch directory — which is what lets the floor itself be
proved by a test rather than merely asserted.

Today it reports **8 route pages across 6 owned segments** (`deliveries`, `delivery`, `reports`,
`warranties`, `warranty`, `work-orders`) with zero violations. `work-orders` is derived from
`sal.work-order-delivery-read` and pulls P1-29's work-order pages into this gate's view as well.
That is harmless and it is the direction that fails safe.

---

## 8. D-15, decided by precedent

> **D-15 — Will the delivery href be `/delivery` or `/deliveries`, and should P1-31 ship a sibling
> gate-before-read check?**

Recorded as decided by precedent rather than escalated, because neither half was actually open to
this phase:

- the href `/delivery` is already **committed** in `apps/web/src/config/navigation.ts` and merged by
  the P-8 slice, so changing it is a change request against merged work rather than a decision this
  screen may take;
- P1-29 and P1-30 each shipped their **own** gate-before-read check, for the stated reason that
  widening a closed phase's derivation changes a gate that phase's closure rests on.

So: the href stays `/delivery`, and P1-31 ships a sibling. Recorded on the D-15 entry of
`a0-preflight.md` and as **CC-16** in `change-control-2026-09-08.md`.

---

## 9. What this does NOT close

- **FE-001, the delivery list.** It waits on Owner decision **D-3**. The navigation entry keeps
  `status: 'planned'`, the planned-list navigation test is untouched, `/delivery` has no page, and
  the detail screen is reached by address or from the work order. The screen renders **one**
  breadcrumb for that reason: `shell.dom.test.tsx` measures that no route-less ancestor crumb exists
  in this product, and the only ancestor available would link a page that does not exist.
- **Every write.** Creating a delivery, confirming a receiver, recording a checklist result,
  attaching a signature and completing the handover are separate tasks. The adapter file contains no
  write and `delivery-api.test.ts` asserts the transport's write path is never called.
- **FE-004 as a template-driven checklist.** The checklist template and template-item tables are
  SELECT-only with no HTTP surface — registered as **PPD-12**, and the subject of prerequisite
  **P-9**. Items that were never recorded are unknowable from any read this screen has, so the panel
  shows what was **recorded** and says so in its own description; the unsatisfied _mandatory_ items
  appear under the release checks, because that read is the only one that publishes them. FE-004 is
  closed by the results list only, and completed when P-9 merges.
- **Bilingual names for people, vehicles and visits.** Nothing in the platform resolves any of these
  identifiers to a name; `sal.delivery_records.delivering_employee_id` has no foreign key at all, and
  Owner requirement **OWR-2026-09-06-G-10** on that subject is **Undecided**. The screen renders
  labelled references and invents no lookup. Arabic labels exist for every closed vocabulary — the
  eight reasons, five stages, three signer roles, three outcomes — and are real translations, not
  transliterations; what has no Arabic is what has no words at all.
- **The eligibility read's own known limits.** The unsatisfied-item sample is capped at 20 by the
  read and the screen says the list is a sample; the gap scan is company-scoped rather than
  template-scoped (**P1-27-INT-088**), which this screen inherits and does not paper over.
