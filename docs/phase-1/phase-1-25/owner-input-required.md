# P1-25 — Owner input required

**One package, one decision session.** Everything P1-25 still needs is listed here so it
can be answered once rather than in five separate rounds. Nothing in this document
proposes a value; every field below is yours to decide.

Prepared against protected `develop` `0f34c460`. P1-26 remains blocked until this is
answered — not by a technical gap, but by these inputs.

---

## 1. What is actually blocking

| Dependency                                   | State                                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| P1-14, P1-15, P1-24 gates                    | **Passed**, recorded in protected history                                    |
| **P1-25 gate**                               | **No gate record exists.** Every phase 1-1…1-24 has one; 1-25 has none       |
| **OIR-01** — product name                    | **Open.** Decided by the Product Owners jointly                              |
| **OIR-06** — visual identity / UI prototypes | **Open.** Explicitly "blocks frontend build-out phases (Phase 1-25 onwards)" |
| **P1-OD-004**                                | **Open** — additionally requires the Benzene business representative         |
| **P1-EC-006**                                | Requires approved prototype links/files **and** a fidelity checklist         |

Searched exhaustively for existing Owner input: the repository contains **exactly one
image file** — `apps/web/public/favicon.svg`, whose first line declares itself
provisional — and `apps/web/public/brand/` holds a single empty `.gitkeep`. No
`prototypes/`, `designs/`, `mockups/` or design-source file exists in the repository or
in the sibling delivery folders. The only owner-supplied brand text found is
**company-level**: `documentation/_assets/rootlco-company-philosophy.md` ("From Roots to
Possibilities.", "Root the Vision. Link the Future.") — a company statement with no
product name, no palette and no logo.

---

## 2. The inputs

### 2.1 Final product name — closes OIR-01

RootLco is the **company**, never the product (ADR-011). The name you supply replaces
**four** distinct placeholder forms now in the tree:

| Form                                                                                    | Where                                                     | Count                                |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------ |
| `[SYSTEM NAME]` / `[SN]`                                                                | `apps/web/src/config/brand.ts` — the web brand authority  | 2 fields                             |
| `[PRODUCT NAME — Pending Final Approval]`                                               | `apps/api/src/shared/constants/app.ts` + documentation    | **213 occurrences across 204 files** |
| `Commercial Multi-Tenant Automotive CRM and ERP Platform` (temporary descriptive title) | `apps/api` → baked into `docs/api/openapi.v1.json` line 4 | 21 occurrences across 20 files       |
| `[SYSTEM_NAME]` (underscore variant)                                                    | canonical plan, P1-OD-002                                 | 1                                    |

Please provide:

- **Product name** (exact, as it should appear in the interface).
- **Short form** for the collapsed sidebar (replaces `[SN]`, roughly 2–4 characters).
- Whether the **API's descriptive title** in the published OpenAPI contract should become
  the product name, stay descriptive, or take a third value. This one is a **published
  contract change** and needs a deliberate answer.

### 2.2 Final logo — part of OIR-06

Accepted formats, in preference order: **SVG** (preferred — scales, themeable), then PNG
with transparency at 2× the largest rendered size, then WebP/AVIF.

Variants needed:

| Variant                     | Used by                                    | Required?    |
| --------------------------- | ------------------------------------------ | ------------ |
| Primary horizontal wordmark | expanded sidebar, header                   | **Required** |
| Compact mark / monogram     | collapsed sidebar, small viewports         | **Required** |
| Light-background version    | default theme                              | **Required** |
| Dark-background version     | dark theme, if approved                    | Optional     |
| Favicon                     | browser tab — replaces the provisional one | **Required** |

Assets land in `apps/web/public/brand/`. Please supply files, not descriptions.

### 2.3 Final colour palette — part of OIR-06

The token layer expects **ten-step ramps** (50, 100, 200, 300, 400, 500, 600, 700, 800,
900), matching the shape already in `apps/web/src/styles/tokens/_colors.scss`.

| Ramp               | Steps      | Notes                                             |
| ------------------ | ---------- | ------------------------------------------------- |
| **Primary**        | 10         | 500 is the base; 600 hover, 700 active, 50 subtle |
| **Neutral**        | 10 + white | surfaces, borders, text                           |
| **Success**        | 10         |                                                   |
| **Warning**        | 10         |                                                   |
| **Error / danger** | 10         |                                                   |
| **Info**           | 10         |                                                   |

If you supply fewer values (for example only a primary 500), say so explicitly and the
remaining steps will be derived and brought back to you for confirmation rather than
chosen silently.

**Accessibility constraint worth knowing before you choose:** body text on its surface
must reach WCAG AA (4.5:1), and interactive borders 3:1. If a supplied pair cannot meet
that, you will be told which pair and by how much rather than having it quietly adjusted.

### 2.4 Approved prototype package — closes OIR-06

Required by P1-EC-006. For P1-25 the prototypes must cover the surfaces that exist today:

application shell · header · sidebar expanded · sidebar collapsed · tablet drawer ·
breadcrumbs · page header and actions · form controls · data table with pagination and
filters · dialog · drawer · tabs · toast · loading / empty / error / permission-denied
states · print sample — each in **Arabic (RTL)** and **English (LTR)**, at desktop and
tablet.

A separate P1-26 package will be needed for the eighteen authentication and
administration screens; supplying both together avoids a second blocking round.

### 2.5 Fidelity decision — closes P1-25

After the final brand is applied you will be asked to review the running application and
record one of: **Pass · Conditional Pass · Fail · Deferred**. Silence cannot be read as
Pass. The review checklist is in §5.

---

## 3. What changes when you supply the above

Applying the brand itself is small and already proven. The **surrounding** documentation
change is not, and that is the honest part of this estimate.

### Code and assets — the applying change

| File                                      | What changes                                                                      |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| `apps/web/src/config/brand.ts`            | name, short name, `logoMode`, `logoAsset`, `primaryTheme`, `isProvisional: false` |
| `apps/web/src/styles/tokens/_colors.scss` | the primitive ramps                                                               |
| `apps/web/src/styles/themes/`             | the approved theme layer                                                          |
| `apps/web/public/brand/`                  | the approved assets                                                               |
| `apps/web/public/favicon.svg`             | replaced by the approved favicon                                                  |
| `apps/api/src/shared/constants/app.ts`    | the API-side product-name authority                                               |
| `docs/api/openapi.v1.json`                | **regenerated** if the descriptive title changes                                  |

**No component file changes** — and that claim is now true rather than merely intended.
It was not true until this branch: the header notice and the overview "Provisional
identity" card were rendered **unconditionally**, so flipping `isProvisional: false`
would have left the shipped product still announcing "final brand pending". Both are now
guarded on brand state, with tests (`P1-25-F-026`).

### Documentation — the larger surface

**204 files** carry `[PRODUCT NAME — Pending Final Approval]`, including the root
`README.md`, `package.json`, `Dockerfile`, `SECURITY.md`, `CONTRIBUTING.md`, the issue
templates and roughly 190 documents under `docs/`. Historical evidence tied to an earlier
immutable SHA will keep its placeholder — rewriting a record of what was true at a past
commit would make it false. Current, live documents will be updated.

### Decision records to close

`docs/phase-1/phase-1-1/open-decisions.md` (OIR-01, OIR-06) ·
`documentation/_registry/open-information-register.md` ·
`phase-1/11-phase-1-open-decisions.md` (P1-OD-002, P1-OD-004) · plus the phase-1-10,
phase-1-13, phase-1-15 and phase-1-19 registers · a **superseding ADR** for ADR-011 (ADR
numbers are never reused; the next free number is ADR-021) · the two canonical DOCX files
and their hashes in `docs/governance/canonical-documents.md`.

### Three decisions the repository cannot make for you

1. **`OIR-01` is overloaded.** Twelve ADRs bind `OIR-01` to _hosting, region and
   deployment platform_, not the product name; `phase-1-15/open-decisions.md` already
   writes a second row to disambiguate. Closing "OIR-01" must state **which** OIR-01.
2. **Gate-record filename.** Three conventions exist: `phase-1-N-owner-gate.md`
   (phases 1-1…1-20), `gate-record.md` (1-21…1-24), and the governance template's
   `phase-1-N-gate.md`, which no phase uses. P1-25 must choose one.
3. **Theme file: rename or sibling?** `task-register.md` says `_provisional.scss` is
   "renamed and remapped"; the file itself says an approved theme "is added as a
   **sibling file**". The two contradict; the closure has to settle it.

---

## 4. Review the current provisional state now

The stack is running from protected `develop` `0f34c460`:

|                             |                                           |
| --------------------------- | ----------------------------------------- |
| English                     | http://127.0.0.1:3100/en                  |
| Arabic (RTL)                | http://127.0.0.1:3100/ar                  |
| Component gallery — English | http://127.0.0.1:3100/en/gallery          |
| Component gallery — Arabic  | http://127.0.0.1:3100/ar/gallery          |
| API readiness               | http://127.0.0.1:3000/api/v1/health/ready |

```bash
npm run dev:status
```

The gallery is the most useful surface: every shared component, every state, both
directions, on one page. **No authentication or administration screens exist yet** —
those are P1-26, and they are what this input unblocks.

---

## 5. Fidelity review checklist

Please walk this against the running application once the final brand is applied:

**Identity** — product name in the sidebar and browser tab · logo at expanded and
collapsed sidebar widths · favicon · no remaining "provisional" notice.

**Colour** — primary on buttons and links · hover and active states · subtle
backgrounds · success / warning / error / info states · text contrast on every surface.

**Layout** — header · sidebar expanded and collapsed · tablet drawer · breadcrumbs ·
page title and actions · data table with pagination, sorting and filters · forms ·
dialog · drawer · tabs · toast.

**Both directions** — English LTR and Arabic RTL, at 1440×900, 1280×800 and 1024×768.
Arabic must not clip, and the sidebar, breadcrumbs and drawer must mirror.

**Behaviour** — keyboard-only navigation · reduced motion · 200% zoom · print sample in
both languages.

Record: **Pass · Conditional Pass · Fail · Deferred**, with conditions if not Pass.

---

## 6. Wording to return

Copy, complete and return — or state the values any way you prefer and they will be
transcribed into the registers verbatim.

```text
FINAL_PRODUCT_NAME:            ______________________________
FINAL_PRODUCT_SHORT_NAME:      ______________________________
API_DESCRIPTIVE_TITLE:         [ ] use product name  [ ] keep descriptive  [ ] other: ______
FINAL_LOGO_FILES:              (attach: wordmark, compact mark, favicon; SVG preferred)
FINAL_PRIMARY_PALETTE:         50…900 = ______________________________
FINAL_NEUTRAL_PALETTE:         50…900 = ______________________________
FINAL_SEMANTIC_COLORS:         success / warning / error / info = ______________________
APPROVED_P1_25_PROTOTYPES:     (attach or link)
APPROVED_P1_26_PROTOTYPES:     (attach or link)

OIR-01 (product name) DECISION: ______________________________
  — state explicitly that this closes the PRODUCT-NAME OIR-01,
    not the hosting/region OIR-01 that twelve ADRs reference.

OIR-06 (visual identity) DECISION: ______________________________

OWNER_P1_25_VISUAL_FIDELITY_DECISION: [ ] Pass  [ ] Conditional Pass  [ ] Fail  [ ] Deferred
  Conditions (if not Pass): ______________________________
  Reviewed by: ______________________  Date: ____________
```

---

## 7. What happens after you answer

1. Branch `feature/p1-25-final-brand-and-fidelity-gate` from protected `develop`.
2. Apply the brand centrally; regenerate the OpenAPI contract if its title changes.
3. Add the product-name authority gate that fails on any surviving placeholder.
4. Correct any prototype mismatches found against the approved package.
5. Run every tier, the installed-Chrome browser matrix, and the exact-SHA clean room.
6. Bring the running application back to you for the fidelity decision.
7. On **Pass**: close OIR-01 and OIR-06, merge through protected `develop`, then merge
   the formal P1-25 gate record.
8. Only then does P1-26 begin — its eighteen screens, four security tasks, five QA tasks,
   two DevOps tasks and two documentation tasks.

Steps 1–7 need no further input from you beyond §6 and the fidelity decision at step 6.
