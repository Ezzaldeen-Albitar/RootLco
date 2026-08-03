# Phase 1-25 — Frontend Architecture and Design-System Foundation — gate record

**Classification:** Confidential — Commercial Product and Pilot Planning

|                         |                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| **Gate**                | P1-G25                                                                                                    |
| **Final decision**      | **Go — P1-25 Frontend Architecture and Design-System Foundation Gate Passed** (§10)                       |
| **Protected `develop`** | `ac7c089ce10b2ebb65be4903f993a13ce0cb4e81`                                                                |
| **Protected tree**      | `72efec2b3668695f4ffa1e1f367fef5cbce6a199`                                                                |
| **`main` at this gate** | `f085d82001a43de51725707426d5c10eb134c004` — unchanged; P1-25 is **not** promoted                         |
| **Final feature PR**    | [#172](https://github.com/Ezzaldeen-Albitar/RootLco/pull/172), reviewed head `474f6bea`, merge `ac7c089c` |
| **Migrations**          | 119 — none created, none modified                                                                         |
| **Schema hash**         | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c` — unchanged                            |

> This record is **documentation only**. It creates no executable change. The work it
> attests to is already on protected `develop` and was verified there before this record
> was written.

---

## 1. What P1-25 delivered

The frontend foundation every later phase composes from: `apps/web` as the sole Frontend
workspace, an App Router under `src/app`, a per-request nonce CSP, a configuration-driven
shell and sidebar, a server-driven data table, a form framework with decimal money as
canonical strings, overlays, shared states, Arabic and English with RTL by logical
properties, a typed API client, accessibility and print foundations, and the testing and
CI tiers that hold all of it.

**No business screen exists.** Thirteen of fifteen navigation entries are `status:
'planned'` and render as visibly unavailable rather than as links that 404. That is P1-26's
scope, and it is deliberately absent here.

## 2. The Owner decisions this gate rests on

| Decision         | Value                                                                            | Closes    |
| ---------------- | -------------------------------------------------------------------------------- | --------- |
| Product name     | **CRM** — temporarily approved working name                                      | OIR-01    |
| Primary green    | **#1F6B52**                                                                      | OIR-06    |
| Primary navy     | **#0F2742**                                                                      | OIR-06    |
| Neutrals         | **#FFFFFF**, **#000000**                                                         | OIR-06    |
| Visual direction | soft, elegant, premium, modern, user-friendly, rich in tools but never cluttered | OIR-06    |
| Prototype basis  | the approved P1-25 design system itself; no separate package required            | P1-EC-006 |

RootLco remains the **company** (Root Link Company), never the product name. Benzene
remains a configurable pilot tenant and appears nowhere as a product identity. Zoom
Vehicle Inspection remains outside Phase 1.

**"CRM" is a working name and is expected to change.** It lives in exactly two
configuration fields, and `scripts/ci/check-product-name-authority.mjs` fails the build if
they ever disagree — so a future rename is two edits with a gate watching, not a search
across the tree.

## 3. Evidence

| Area                                                    | Record                                                                     |
| ------------------------------------------------------- | -------------------------------------------------------------------------- |
| Final brand, palette derivation, 21-pair contrast proof | [final-brand-evidence.md](final-brand-evidence.md)                         |
| Brand-mechanism findings (F-026 … F-028)                | [brand-mechanism-findings.md](brand-mechanism-findings.md)                 |
| Frontend foundation evidence                            | [frontend-foundation-evidence.md](frontend-foundation-evidence.md)         |
| Task register (35 tasks)                                | [task-register.md](task-register.md)                                       |
| Execution checkpoint and findings F-001 … F-025         | [execution-checkpoint.md](execution-checkpoint.md)                         |
| Topology remediation                                    | [remediation/](remediation/)                                               |
| Workspace normalization                                 | [workspace-normalization-evidence.md](workspace-normalization-evidence.md) |

## 4. Verification at the gated SHA

| Tier                                        | Result                                                     |
| ------------------------------------------- | ---------------------------------------------------------- |
| `verify:workspaces`                         | **exit 0**                                                 |
| Root unit / CI-contract                     | **1438 / 1438** across 67 files                            |
| Web unit / component                        | **239 / 239** across 12 files                              |
| Web browser matrix (Playwright, 5 projects) | **81 / 81**                                                |
| Backend tier                                | **1752 / 1752** across 75 files                            |
| Database / RLS tier                         | **1636 / 1636** across 138 files                           |
| Hosted CI — feature head `474f6bea`         | **20 / 20**                                                |
| Hosted CI — protected push `ac7c089c`       | **18 / 18** including `protected-gate`                     |
| CodeQL                                      | **0 open alerts** on `develop`, on `main`, repository-wide |
| Dependency audit                            | 0 vulnerabilities, 0 waivers                               |

**Failed executable tests: 0. Suppressed failures: 0.**

## 5. Gates now permanently enforcing this foundation

| Gate                               | Enforces                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `check-web-topology.mjs`           | one App Router root under `src`, the proxy convention, no competing roots, single brand and colour authority |
| `check-api-backend-only.mjs`       | `apps/api` holds no page, stylesheet, client component or tracked build output                               |
| `check-generated-artifacts.mjs`    | no generated output tracked anywhere, one lockfile, ignore rules intact                                      |
| `check-product-name-authority.mjs` | both tiers name the product identically, or both are pending                                                 |
| `check-phase-ownership.mjs`        | a phase changes only what it declared it would                                                               |
| `check-command-coverage.mjs`       | every required command is reachable locally and in hosted CI                                                 |
| `check-brand-isolation.mjs`        | no component holds a brand value — now including `.json` catalogues                                          |
| `check-design-tokens.mjs`          | no raw colour outside the token layer                                                                        |

Each carries mutation tests proving it fails on the violation it exists for. That property
is not decorative: the API-boundary gate's five import rules were caught matching **nothing**
by their own mutation suite before they shipped.

## 6. Findings

Twenty-eight findings were raised and resolved across P1-25 (`F-001` … `F-028`), plus five
in the pre-P1-26 preflight. **No Critical finding was raised. No High or Medium finding
remains open.** One Low finding is carried forward by decision:

| ID               | State                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------- |
| `PRE-P126-F-004` | **Closed by this gate** — the two product-name placeholders are now one approved value in both tiers, enforced |

The three found while applying the brand are worth naming, because each was invisible
until the moment it would have mattered:

- **`P1-25-F-026`** — the header notice and overview card announcing "final brand pending"
  were rendered **unconditionally**. The phase's central claim, that replacing the brand
  touches no component, was **false in effect**: the approved identity would have shipped
  alongside a banner saying it was pending. Found and fixed _before_ the brand was applied.
- **`P1-25-F-027`** — the brand gate scanned `.ts`/`.tsx`/`.scss` and never opened the
  `.json` message catalogues, which is where user-facing brand copy lives.
- **`P1-25-F-028`** — `dev:stop` reported success without stopping anything when its
  recorded PIDs had been orphaned.

## 7. Owner visual-fidelity decision

The Owner supplied the brand direction and the anchors as the authoritative instruction
package for this cycle, designated the existing design system as the binding basis, and
directed that the result be finalised against it.

The applied result was verified **in the running application** rather than asserted:
`--color-primary` resolves to `#1f6b52`, `--color-sidebar-background` to `#0f2742`
computing to `rgb(15, 39, 66)`, `data-theme="approved"` on both locales, `CRM` rendered as
the brand mark, `data-provisional` absent, Arabic `dir="rtl"`, and **zero console errors**.

**Decision: Pass**, against the approved direction recorded in §2.

## 8. Governance statements

- No historical migration was modified; no migration was created. Migrations remain 119.
- The schema hash is unchanged.
- `supabase/` diff across the whole phase: **0 files**.
- `apps/api` is Backend/API-only; `apps/web` is the only Frontend workspace.
- `apps/api/src/app/api/**` remains the approved Next.js Route Handler namespace, 196 handlers.
- No direct push to a protected branch. No force push. No squash merge. No rebase merge.
- No `main` promotion. No deployment, release, tag, or customer migration.
- **No P1-26 implementation and no P1-26 branch existed when this record was written.**
- No P1-27 work exists.

## 9. Known limitations carried forward

- **The product name is temporary.** "CRM" is a working name. The mechanism for replacing
  it is proven and gated; the decision remains the Owner's.
- **No logo asset.** The brand renders as a wordmark, which is a complete configuration.
  Supplying an asset later is a file plus one field.
- **204 documents retain the old placeholder.** Historical evidence tied to an earlier
  immutable SHA keeps it deliberately — rewriting a record of what was true at a past
  commit would make it false. Live documents were updated.
- **The canonical DOCX files are not yet re-synchronised** with this cycle's decisions.
  Per `docs/governance/canonical-documents.md` §"Synchronization policy" that does not
  block a phase gate; it becomes a blocker before production release or formal external
  delivery.

## 10. Decision

**Go — P1-25 Frontend Architecture and Design-System Foundation Gate Passed.**

Recorded against protected `develop` `ac7c089c`, tree `72efec2b`, after PR #172 was merged
by `Ezzaldeen-Albitar` as a merge commit and the protected push verified green on the exact
merge SHA.

**P1-G25 is therefore closed.** P1-26 — Authentication and Administration Frontend — is
unblocked and may begin from the protected SHA that carries this record.
