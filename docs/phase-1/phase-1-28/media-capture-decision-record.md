# P1-28 · Reception media capture — the Owner record for `P1-OD-025`

**Task:** `FE-017` (reception camera and media upload), with the template-document
half of `FE-012` and the signature-image half of `FE-018`.
**Status:** built as a **named-open-decision notice**. No capture UI exists, and
that is the deliverable rather than a shortfall.
**Decision this waits on:** `P1-OD-025` — document and media file policy, **OPEN**
(`canonical-plan.md` §7).

This document exists so the decision can be taken **without re-deriving it**. It
records what the Owner asked for, which part of that is fixed and which part is a
proposal, what P1-28 ships instead, what the Owner must settle, and — importantly
— what settling it does and does not unblock. It decides nothing itself.

---

## 1. What the Owner asked for

The reception media requirement, as it stands in the Owner-facing sources:

| element               | statement                                                                                                                                     | source                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Exterior photographs  | **Seven**, one per angle. An angle satisfied by two photographs is acceptable; an angle with none is not. All seven before the vehicle moves. | `reception-media-checklist.md:112-113`   |
| Dashboard photographs | Odometer; state of charge for electric and plug-in hybrid; illuminated warning lamps when any is lit.                                         | `reception-media-checklist.md:93-95`     |
| Vehicle identity      | The vehicle identification number or chassis plate — required on the first visit, conditional afterwards.                                     | `reception-media-checklist.md:96`        |
| Owner register rows   | `OR-12`, `OR-13`, `OR-14` — recorded as **Blocked** (`INT-093`/`094`/`095`).                                                                  | `owner-workflow-requirements.md:160-162` |

### 1.1 What is FIXED, and what is only a PROPOSAL

This distinction is the reason the document exists, and it must not be collapsed:

- **Fixed — the count.** Seven exterior photographs. The Owner brief fixes it.
- **A proposal — the angle set.** `EXT-1` … `EXT-7` (near side, front three-quarter,
  front elevation, and so on) were **named in order to give the decision something
  concrete to accept or amend**. Which seven angles constitute the set is a
  business decision that is **not established** and must be confirmed alongside
  `P1-OD-025` (`reception-media-checklist.md:102-105`, and §9 row 1 of the same
  document).

P1-28 therefore asserts neither. The shipped notice states that the exterior set
is one of the things the Owner must decide, and names no count and no angle — a
screen that displayed "7 photographs required" would be publishing half a decision
as though the whole of it had been taken.

---

## 2. What P1-28 ships instead

A decision-neutral notice, at every point where an operator would reach for a
camera.

| where                                            | surface identifier    | shipped by      |
| ------------------------------------------------ | --------------------- | --------------- |
| The check-in wizard's photographs-and-media step | `reception-evidence`  | `FE-017`, now   |
| The damage-map template document                 | `damage-map-template` | `FE-012`, ready |
| The signature image                              | `signature-image`     | `FE-018`, ready |

The notice states four things, in this order:

1. what the place is for — so the absence is legible rather than a gap;
2. that capture is blocked, and by which decision, spelled **`P1-OD-025`** on
   screen so it can be looked up;
3. what the Owner must decide (§3 below), as open questions and never as
   defaults;
4. what will exist once it is decided, together with the honest ceiling (§4).

Both the Arabic and the English copy carry all four.

### 2.1 What the notice deliberately does NOT contain

| absent                                      | why                                                                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| A file input, drag target or camera control | `P1-OD-025` owns the policy; a control asserts the policy exists.                                                                        |
| A **disabled** control                      | A greyed-out button advertises a capability the product does not have, and is the single most likely thing for a later commit to enable. |
| An accepted file type or extension          | Not established (`reception-media-checklist.md` §9). Naming one takes the decision.                                                      |
| A size ceiling, in any unit                 | The same. A "sensible default" is the invention that arrives through diligence.                                                          |
| An object-store or provider assumption      | `STORAGE_PROVIDER` defaults to `unconfigured`; there is no store to assume.                                                              |
| A photograph count or an angle list         | Only the count is fixed and the angle set is not; showing either would publish half a decision. See §1.1.                                |
| The words "uploaded" or "attached"          | Neither is true of anything this platform can do. See §4.                                                                                |

---

## 3. What the Owner must decide

Four questions, each already recorded as **Not established** in
`reception-media-checklist.md` §9. Listing them here records the open questions;
none of them is answered by this document or by any screen.

| #   | question                                                                             | what it unblocks                                                                | recorded as          |
| --- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | -------------------- |
| 1   | Which pictures must a reception carry, and **which views make up the exterior set**? | The checklist definition and the per-item completion model (`RMC-14/15`).       | §9 row 1; `:102-105` |
| 2   | Which **file kinds** are accepted, and what is the **ceiling** on a single file?     | Anything at all in the client: no control can exist without both.               | §9 row 2             |
| 3   | Where are the files **held**, in which region, and **how long** are they kept?       | Provider evaluation and provisioning; the retention class.                      | §9 rows 3 and 6      |
| 4   | Does **missing media prevent a reception being approved**?                           | Whether the checklist is advisory or a precondition of `rec.reception-approve`. | §9 row 4; `RMC-14`   |

Two further questions are adjacent and are named so they are not lost, but they
are **not** what `FE-017` waits on: whether reception media is restricted data
(§9 row 10), and whether device capture time is recorded at all (§9 row 9, no
column exists — `uploaded_at` is a server clock, not a camera clock).

---

## 4. What deciding `P1-OD-025` does — and does not — deliver

**This is the part most likely to be misread, so it is stated plainly.** The
decision unblocks the design. It does not, by itself, produce a working
photograph.

The attachment chain that exists today is dead-ended in **two independent**
places:

1. **No storage.** `STORAGE_PROVIDER` defaults to `unconfigured` and the only
   adapter signs against a non-resolvable host (`RMC-02`). No bytes can be placed
   anywhere.
2. **No scanner.** A version can be accepted only when `shared.file_scan_results`
   holds a `clean` row, and that table is granted to **no role** (`RMC-03`).
   `scannerAvailable` is a hard-coded `false`.

So the best state any registered file can reach is
**"registered, pending, never downloadable"** (`reception-media-checklist.md:208-210`).
That is why the notice says the state will be _pending_ even after the decision,
and why no screen in this phase says "uploaded", "attached" or "complete".

Beyond `P1-OD-025` itself, the following are separate pieces of work with named
owners, and none of them is P1-28's:

| still required after the decision                                                               | owner            | recorded as       |
| ----------------------------------------------------------------------------------------------- | ---------------- | ----------------- |
| Provision a storage provider (an evaluation, not a purchase)                                    | P1-15            | `RMC-02`          |
| Introduce a scanning component with its own role and grant                                      | P1-15            | `RMC-03`          |
| Seed document categories; without one, upload authorisation 404s                                | P1-15            | `RMC-05`          |
| A per-entity document list, so a visit's media can be enumerated                                | P1-15 with P1-18 | `RMC-06`          |
| A checklist definition and per-visit completion, with a min count                               | P1-18            | `RMC-14`/`RMC-15` |
| A neutral condition-evidence kind for a no-defect walk-around                                   | P1-18            | `RMC-16`          |
| An evidence reference on the odometer reading, or a rule that the photograph binds to the visit | P1-17            | `RMC-09`          |

---

## 5. Where this lives, and what holds it

| artefact                                                          | what it is                                                                                                                                                                                                                   |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/features/receptions/media/media-decision.ts`        | The decision identifier, the closed status value, the three surfaces, and the four open questions as translation keys.                                                                                                       |
| `apps/web/src/features/receptions/media/MediaDecisionNotice.tsx`  | The shared notice. One component, three surface statements.                                                                                                                                                                  |
| `apps/web/src/features/receptions/components/steps/MediaStep.tsx` | The wizard step that puts it where the camera would have been.                                                                                                                                                               |
| `apps/web/tests/p1-28-reception-media.test.ts`                    | The source ban: the gate's own `no-upload-path`, `no-invented-media-limit` and `no-export-surface` rules applied over the whole reception tree, plus the camera constructs the gate does not cover, plus the wording sweep.  |
| `apps/web/tests/p1-28-reception-media.dom.test.tsx`               | The rendered ban: no capture affordance on the start screen, on any registered wizard step, or on walk-in intake, in either language — with a planted-affordance control case so the sweep cannot pass by measuring nothing. |

Two enforcement notes worth keeping:

- The `no-upload-path` and `no-invented-media-limit` gate rules
  (`scripts/ci/check-p1-27-frontend.mjs:876-895,919-939`) are the specification, but their
  `SCAN_ROOTS` do **not** include `apps/web/src/features/receptions`. The reception
  routes are scanned; the feature tree is held by the suites above, which assert
  that fact rather than implying wider coverage than exists.
- The gate's seven file-access constructs cover file input and drag-drop and
  **do not cover a camera**: `navigator.mediaDevices.getUserMedia`, `ImageCapture`,
  a `<video>` preview and the `capture` attribute all pass every rule. This is
  measured in `p1-28-reception-media.test.ts` and enforced there for the reception
  tree. Widening the P1-27 gate is not P1-28's to do — its rule count is a
  published document marker — so the gap is reported rather than patched.

---

## 6. What this document does not do

It does not choose the seven angles. It does not propose a file type, a size, a
provider, a region or a retention period. It does not decide whether missing
media blocks approval. It records the questions, their consequences and their
sources, so that whoever answers them is answering the whole question once.
