# P1-22 execution checkpoint

**Phase:** P1-22 — Billing, Payment, Delivery, and Warranty Backend
**Branch:** `feature/p1-22-billing-payment-delivery-warranty-backend`
**Status:** Wave 0 in progress — baseline verified, archaeology under way.

## Current position

| Field                       | Value                                                              |
| --------------------------- | ------------------------------------------------------------------ |
| `P1_22_BASE_SHA` (current)  | `0a53e540d72329e9aef6b196b68627aeb40b4c79`                         |
| `P1_22_BASE_SHA` (original) | `d9a2c1dc8d09e8fe2b3cf9ca8a2d4a6c905756de`                         |
| HEAD                        | `0a53e540d72329e9aef6b196b68627aeb40b4c79`                         |
| Commits of P1-22 work       | **0**                                                              |
| Working tree                | clean                                                              |
| Remote ref                  | none yet                                                           |
| Migrations                  | 119, no `120`                                                      |
| Schema hash                 | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c` |

## The concurrency interrupt, and what it cost

P1-22 was opened, its baseline verified and its branch created, and then a
concurrent **pre-P1-22 main promotion** mandate took priority. Both streams
touched the same repository.

**Nothing was lost, because nothing had been written yet.** At the interrupt the
branch was byte-identical to its base: 0 commits, 0 changed files, clean tree, no
remote ref. That was measured, not assumed —
`git rev-list --count d9a2c1d..HEAD` = 0 and
`git diff --name-only d9a2c1d...HEAD` = empty.

No checkpoint commit was created, deliberately: a commit over an empty diff would
be a fake completion artefact, and this repository has already paid for one of
those.

The promotion was executed in a **separate worktree** on `ops/pre-p1-22-main-promotion`
so this worktree was never switched, stashed or reset.

### Base change

The promotion record landed on `develop` as a documentation-only merge, so
`develop` advanced from `d9a2c1d` to `0a53e54`. This branch was brought forward
with `git merge --ff-only` — a clean fast-forward, since it carried no work. The
delta is 9 documentation files under
`docs/engineering/releases/pre-p1-22-main-promotion/` and **zero executable
files**, so no P1-22 assumption is affected.

## Wave 0 — completed so far

1. `git fetch --all --prune`; clean worktree; worktree inventory recorded.
2. `origin/develop` verified against the authorised baseline.
3. `origin/main` verified unchanged **before** promotion (`491c4e0`), and
   verified promoted **after** (`9c2fea1`) with a byte-identical tree.
4. No pre-existing P1-22 branch or pull request.
5. Migrations 119, no `120`; schema hash unchanged.
6. Prerequisite gate records present on `develop`: CodeQL remediation, CI/CD
   platform.
7. Every `p1-23` and `p1-22` string hit traced to **P1-11 forward contracts and
   schema comments** that explicitly state no such backend is created.
8. Branch created from the exact verified SHA.

## Plan-to-repository differences already found (§5)

**The canonical documentation paths in the phase plan do not exist.** The plan
names `documentation/04-chapter-03-requirements.md` and eight siblings; this
repository has no `documentation/` directory. The equivalent material lives under
`docs/` — `docs/phase-1/`, `docs/standards/`, `docs/adr/`, `docs/governance/`,
and per-phase `change-log.md` / `open-decisions.md` / `traceability-matrix.md`
files. Recorded here rather than silently substituted.

Further differences — route grammar, event naming, and test identifiers — are
being resolved by the archaeology lens on module conventions and will be recorded
in `contract-archaeology.md`.

## In progress

**Protected-contract archaeology**, nine parallel read-only lenses over the
P1-11 protected foundation (`sal`, `wty`), following the rigour of
`docs/phase-1/phase-1-21/wave-1-contract-archaeology.md`:

money and currency precision · invoice lifecycle and numbering · payments,
receipts and allocation · credit notes, financial events and immutability ·
delivery eligibility, receivers, checklist and signature · warranty ·
permissions and RLS · audit, outbox, errors, operation registry and route
grammar · upstream cross-phase ports.

Every blocker-severity gap is independently attacked by a second agent before it
is accepted.

## Next exact action

Complete the archaeology, write `docs/phase-1/phase-1-22/contract-archaeology.md`,
and only then begin Wave 1 module foundations. **No code before archaeology is
complete.**
