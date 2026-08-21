# P1-26 — dependency readiness

Read from live repository evidence at protected `develop` `9e70c61c`, not from
recollection. Each decision below was taken from the gate document itself and quoted.

## Declared dependencies

| Phase | Gate record                                        | Decision                                                                           | State          |
| ----- | -------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------- |
| P1-14 | `docs/phase-1/phase-1-14/phase-1-14-owner-gate.md` | "Go — P1-14 Authentication, Authorization, and Administration Backend Gate Passed" | **PASSED**     |
| P1-15 | `docs/phase-1/phase-1-15/phase-1-15-owner-gate.md` | "Go — P1-15 Shared Services Backend Gate Passed"                                   | **PASSED**     |
| P1-24 | `docs/phase-1/phase-1-24/gate-record.md`           | "Go — P1-24 Backend Integration and Release Gate Passed"; promoted to `main`       | **PASSED**     |
| P1-25 | **none exists**                                    | **no decision recorded**                                                           | **NOT PASSED** |

Each of the three passed gates was verified to be a real conversion rather than a
retroactive claim: P1-14 and P1-15 preserve their prior "Pending" text verbatim in §8
(P1-15 additionally records a SHA-256 of the original blob), and all three gate documents
are themselves merged into protected history.

## P1-25 is technically complete and formally open

`docs/phase-1/phase-1-25/` holds fifteen files. It contains **no `gate-record.md`, no
`phase-1-25-owner-gate.md`, and no `promotion-record.md`.** A repository-wide search for
gate documents returns one for every phase from 1-1 through 1-24 and nothing for 1-25.

The phase says so about itself:

> `execution-checkpoint.md`: "**P1-25 is NOT closed.**" · "P1-25 was reopened — still
> formally open, still no gate record — for one mandatory remediation" · "P1-26 has not
> started."

> `task-register.md`: "**P1-25-OWNER-01 — final visual identity and fidelity approval.
> Status: Pending Owner Input and Fidelity Review.**" · "Three inputs are required and
> none can be supplied by the implementation."

### The three outstanding inputs

1. The final **product name**, replacing the `[SYSTEM NAME]` placeholder.
2. The final **logo** asset.
3. The final **colour palette**.

Plus **Product Owner fidelity sign-off** on the running application.

None is technical. None can be produced by implementation. All four are Owner inputs.

## OIR-06 is open, and it names this phase

`docs/phase-1/phase-1-1/open-decisions.md`, row **OIR-06 — UI prototypes and brand
colours**:

> "No visual identity is approved. All colour tokens … are neutral defaults pending
> brand approval; UI prototypes remain open."
>
> Blocks later phases: **"Yes — blocks frontend build-out phases (Phase 1-25 onwards)
> that require an approved visual identity."**

Decided by: the Product Owners jointly. Still open in the current tree — ADR-020
("**OIR-06 remains open.** This ADR decides the mechanism, not the values"), ADR-013,
the styling standard, `_provisional.scss`, `_colors.scss` and even the provisional
favicon all restate it.

**No approved prototypes exist in the repository.** There is no `prototypes/`,
`designs/`, or `mockups/` directory and no design artefact anywhere under `docs/`.
`apps/web/public/` contains `brand/.gitkeep` — an empty placeholder — and a favicon whose
first line reads "PROVISIONAL favicon (OIR-06 open: no visual identity is approved)".

## Product name

`[PRODUCT NAME — Pending Final Approval]` (`apps/api/src/shared/constants/app.ts`) and
`[SYSTEM NAME]` (`apps/web/src/config/brand.ts`). Two placeholders for one undecided
name — recorded as `PRE-P126-F-004` for P1-26 to resolve centrally. Neither names a
product, which is the property that matters. **RootLco is the company, never the product
name** (ADR-011).

## Consequence for P1-26

P1-26 delivers eighteen authentication and administration **screens**. Its Definition of
Done requires Arabic and English, RTL and LTR, desktop and tablet, accessibility, and
fidelity to approved prototypes. Building those screens against an unapproved visual
identity, with no prototypes to be faithful to, would produce work that must be redone
when the palette and logo arrive — and would let the phase claim a fidelity it cannot
demonstrate.

The prompt governing this work states the rule directly: where P1-25 remains technically
complete but not formally approved, complete the pre-P1-26 API file-boundary remediation,
do **not** begin P1-26 business-screen implementation, record the missing dependency, and
leave the P1-26 implementation branch uncreated.

That is what was done. This remediation contains no P1-26 business implementation, and no
`feature/p1-26-*` branch exists.

## What unblocks it

| #   | Input                                                          | Owner          |
| --- | -------------------------------------------------------------- | -------------- |
| 1   | Final product name                                             | Product Owners |
| 2   | Final logo asset                                               | Product Owners |
| 3   | Final colour palette                                           | Product Owners |
| 4   | Approved UI prototypes closing OIR-06                          | Product Owners |
| 5   | Fidelity sign-off on the running application                   | Product Owner  |
| 6   | The P1-25 gate record, recorded through the protected workflow | Owner          |

Applying the brand itself is already proven to be a configuration change: P1-25's
rehearsal replaced the name and the full colour ramp by editing two files, touching no
component, and verified the new values reached both the server-rendered HTML and the
emitted stylesheet.
