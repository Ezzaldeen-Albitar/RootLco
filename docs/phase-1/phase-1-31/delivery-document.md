# P1-31 — the printable delivery handover document (FE-007)

**Date:** 2026-09-11 · **Branch:** `feature/p1-31-delivery-document` · **Base:** protected
`develop` `c1b1a8cdd822e3e70667600a0309d36a7d6438c6` (merged in 2026-09-11; the slice was written
against `01c32937c2d6f5f78f5757cb83c6fdf2995f1dad`) · **Lane:** `p1-31-frontend` (web, docs,
tests) · **Status:** implemented and **unmerged**, open as pull request #368. This document records
no hosted run, and nothing here has been proved against a running environment.

This slice adds one control to the vehicle-handover screen: a printable sheet. It publishes no
operation, changes no schema, adds no permission and writes nothing.

---

## 1. The Owner's decision (D-7, 2026-09-10), in the Owner's words

Recorded in [`owner-decisions-2026-09-10.md`](./owner-decisions-2026-09-10.md) §2. The delivery
document is a **permission-checked printable operational view**.

- **Stored immutable document versions remain deferred.** If they are ever wanted they arrive
  through their own contract, deliberately, and not as a side effect of a print view.
- The printable view is **never described as an immutable archive** — not in the interface, not in
  the documentation, not in a commit message. It renders what the server published at the moment it
  was printed, and that is the whole of its claim.
- The view is **permission-checked**: it shows a caller only what the reads they already hold
  publish.

The Owner attached one consequence explicitly and it is repeated here because it bounds this
slice: no backend print route and no new document operation is authorized by that answer.

---

## 2. Measured facts (not part of the decision)

These are the facts this slice was built against. Each was read in the tree at the base commit
above; none of them is an Owner decision.

| fact                                                                                                                                                                                                                      | where                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| the shared print frame exists and owns the page geometry, the repeating header, the forced paper surface and a table whose header repeats across a page break                                                             | `apps/web/src/components/print/PrintDocument.tsx`                                                         |
| the print stylesheet hides interactive chrome, including anything marked `data-print="hide"`                                                                                                                              | `apps/web/src/styles/print/_index.scss`                                                                   |
| the invoice screen's print panel is the shipped pattern: local open state, a read made only when the sheet is opened and only when the caller may make it, a hidden toolbar, a browser print control                      | `apps/web/src/features/billing/components/InvoiceScreen.tsx`                                              |
| the reception acknowledgement is the shipped precedent for stating the OUTCOME of each read on paper rather than printing a failed read as an empty section                                                               | `apps/web/src/features/receptions/components/AcknowledgementDocument.tsx`                                 |
| six delivery reads are already consumed by the screen — the record, the release checks, the receiver, the signatures, the checklist results and the stage history                                                         | `apps/web/src/features/delivery/api.ts`                                                                   |
| the release checks declare the financial read code **in addition to** the delivery code, and the screen decides that before it asks                                                                                       | `apps/web/src/features/delivery/delivery-contract.ts`, `components/use-eligibility.ts`                    |
| the delivering employee, the vehicle, the visit and the final odometer reading are bare identifiers with no reader anywhere in the platform; the delivering employee's display name lands with a backend slice not merged | `delivery-contract.ts`, and D-12 in [`owner-decisions-2026-09-10.md`](./owner-decisions-2026-09-10.md) §1 |
| a work-order summary read DOES exist and publishes a work-order number, a customer display name with its relationship role, a registration plate and a make and model; it declares `wo.work_order.read`                   | `apps/web/src/features/work-orders/api.ts`, `work-orders-contract.ts`                                     |
| the session carries no company, branch or organisation NAME — only identifiers and the resolved scope                                                                                                                     | `apps/web/src/features/authentication/types/session.ts`                                                   |
| not one delivery read carries an amount; the release checks publish blocker codes rather than figures                                                                                                                     | `delivery-contract.ts`                                                                                    |

---

## 3. Engineering consequence (not an Owner decision)

Every choice below is this slice's own. The Owner named none of them.

- **The sheet is a panel of the existing screen, not a route.** A second route would need its own
  gate, its own crumb and its own navigation entry, and would present the same reads under a second
  authority. The screen is already refused to anyone without `sal.delivery.view`, so the control is
  drawn only inside a screen that code unlocked; it adds no second check for the code the route
  already required, because a redundant gate is a gate nobody maintains.
- **The reads happen when the sheet is opened.** Composing the sheet on every visit would double the
  cost of the screen for a document most visits never print. Four delivery reads and, at most, one
  work-order read are made on open, and the print control appears only once they have landed.
- **The release checks are reused, not read again.** The screen already holds one eligibility
  answer for the panel that explains it and the control that releases the vehicle. Reading it a
  third time could hand the sheet a different answer from the one on screen.
- **The work-order read is used, under its own permission.** It is the only read reachable from this
  screen that resolves a customer name, a registration plate or a work-order number. A caller
  holding `wo.work_order.read` gets those three; a caller without it is not asked to spend a request
  discovering that, and the sheet prints the identifiers the delivery record carries and states
  why. The capability is resolved on the route page, beside the other three, and passed down.
- **Every part states the outcome of its read.** `read`, `refused` or, where a second permission is
  involved, `withheld`. An empty list and a failed read print differently: asserting "nothing is
  recorded" over a refusal would put an absence the sheet never observed onto paper, in front of a
  reader who cannot check it. A refusal carries the reference the backend logged.
- **One page of each list is printed, and truncation is said.** The lists use the feature's page
  size and the server's own end-of-set signal. A sheet that stopped silently at the page boundary
  would be a copy missing records nobody mentioned.
- **Sensitive references stay references.** The signature image and the receiver's identity evidence
  are stored-document references; the sheet states that the mark and the proof are on file, prints
  neither reference nor content, and offers no way to fetch the bytes. The one image on the sheet is
  the brand mark the frame renders, and a test asserts the set of images is exactly that.
- **No company, branch or organisation name is printed.** The session publishes none, so there is
  nothing to print that would not have been invented here.
- **No figure is printed.** Nothing in this feature formats or computes money, and the release
  checks publish codes rather than amounts.
- **The footer disclaimer is a translated string in both catalogues**, not English text with an
  Arabic layout: the sheet states in the reader's own language that it is an operational printout
  and not an archived copy of a document.

---

## 4. What this slice explicitly is NOT

- **It is not an immutable archive, and it says so on the paper.** The sentence is in the footer of
  every sheet, in English and in Arabic.
- **No document version is stored.** Nothing is created, uploaded, registered or linked. Stored
  immutable versions remain deferred per D-7 and would arrive through their own contract.
- **No operation was published and no permission was minted.** The operation register and the
  permission catalogue are untouched; `npm run validate:p1-31-access` reports the same segment
  derivation and the same page count as it did before this branch.
- **No backend route, no migration, no seed, no audit action.** `apps/api` and `supabase` are not
  edited at all.
- **Nothing is written from the sheet.** No write adapter is imported by either new file, and the
  test suite asserts that every write of this feature — and the work-order transition adapter that
  arrived in the same import closure — is untouched while the sheet is composed and printed.
- **No PDF is generated and no bytes are produced.** `window.print()` is the browser's own dialogue.
- **It is not verified end to end.** No acceptance record exists for P1-31, no hosted run was made,
  and no claim is made about one.

---

## 5. What changed

| file                                                                   | change                                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `apps/web/src/features/delivery/components/DeliveryDocument.tsx`       | NEW — the printable sheet, composed from read outcomes rather than from bare rows                 |
| `apps/web/src/features/delivery/components/DeliveryDocumentPanel.tsx`  | NEW — the control: local open state, the reads made on open, the hidden toolbar, the print button |
| `apps/web/src/features/delivery/components/DeliveryDetailScreen.tsx`   | mounts the panel; takes the work-order read capability as a fourth affordance                     |
| `apps/web/src/app/[locale]/(dashboard)/delivery/[deliveryId]/page.tsx` | resolves `wo.work_order.read` beside the three it already resolved, after its own gate            |
| `apps/web/src/i18n/messages/en.json`, `ar.json`                        | 37 new `delivery.document.*` keys in both catalogues                                              |
| `apps/web/tests/delivery-document.dom.test.tsx`                        | NEW — 14 cases                                                                                    |

---

## 6. Proof

Everything below was run locally on this branch. Nothing here was run against a hosted environment,
and no gate result is claimed that was not executed.

| id       | what was shown                                                                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D7-1** | a caller the route refuses never reaches the control, and none of the reads the sheet needs is made                                                       |
| **D7-2** | nothing the sheet needs is read until it is opened — the work-order read, which nothing else on this screen makes, is the probe                           |
| **D7-3** | the opened sheet carries the frame the print stylesheet finds, with the checklist, signature and stage rows the mocked reads published                    |
| **D7-4** | the customer, the plate and the work-order number come from the work-order read when its code is held, and that read is NOT made when it is not           |
| **D7-5** | the financial half is absent, unrequested and SAID to be absent without the financial read code                                                           |
| **D7-6** | a refused list prints "this part could not be read" with the backend's reference, never an empty section; a truncated list says it is the first page only |
| **D7-7** | the disclaimer is on the sheet in English and in Arabic, in the right-to-left rendering                                                                   |
| **D7-8** | the print control appears only after the reads land, calls the browser's own dialogue once, and sits inside the toolbar the stylesheet hides              |
| **D7-9** | every write adapter of this feature, and the work-order transition adapter, is untouched throughout                                                       |

---

## 7. Status

- **Implemented, unmerged.** Branch `feature/p1-31-delivery-document`, pushed and open as pull
  request #368 against `develop`.
- **No hosted result is recorded here.** No acceptance, no browser pass, no environment.
- The task matrix records FE-007 as `implemented/unmerged` against this head, and
  [`a0-preflight.md`](./a0-preflight.md) carries the same statement in its readiness row.
