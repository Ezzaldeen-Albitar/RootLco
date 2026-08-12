# Phase 1-27 — Owner acceptance result and remediation

**Classification:** Confidential — Commercial Product and Pilot Planning ·

> **SUPERSEDED — `closure-record.md` is the current record.** The Owner
> returned `OWNER ACCEPTANCE: PASS` on 2026-08-12; this document records the
> 2026-08-06 refusal and the remediation it forced, and is kept as history.

**Status at the time of writing:** P1-27 REOPENED · **Recorded:** 2026-08-06

---

## The result

```
OWNER ACCEPTANCE: FAIL
```

The Product Owner manually tested the merged P1-27 application — `develop`
`8b9be4bc92a6349a6cb99d15ee282f5f463c63a5` — and returned eleven confirmed
defects. **P1-27 is reopened.** `P1-G27` is not written, the phase is not
closed, and P1-28 has not started.

None of the eleven is visual polish. Each is recorded below with its
disposition, and nothing is marked closed on the strength of a diff: a defect is
closed when a named test fails without the fix, and the mutation matrix
(`scripts/ci/hostile-mutations.mjs --only=M-OA`) executes that claim.

## What the automated tiers were saying at the same moment

This is the part worth keeping.

| tier                                     | result at the moment the Owner found eleven defects |
| ---------------------------------------- | --------------------------------------------------- |
| Web unit and component tests             | 767 passed, 0 failed                                |
| Anonymous browser (Playwright)           | 146 passed, 0 failed                                |
| Authenticated browser (en / ar / tablet) | 180 passed, 0 failed                                |
| Database and RLS                         | 1636 / 1636                                         |
| Hosted CI on the merge commit            | green                                               |
| CodeQL                                   | 0 open alerts, repository-wide                      |

Six of the eleven defects are frontend behaviour, and **not one of them was
visible to any of those tiers**. That is not an argument for more tests of the
same kind. It is the specific reason each fix in this remediation is pinned by a
mutation rather than by a passing assertion — a `className` assertion passes
whether or not the class means anything, and a screen that renders is not a
screen that works.

## The eleven defects

| #   | Defect (Owner's words)                                                                                                                               | Owned by                 | Disposition                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------- |
| 1   | The Password show/hide control is incorrectly placed outside or below the Password field                                                             | this remediation         | **Fixed** — `PasswordField` in the design-system authority          |
| 2   | The Sidebar exposes a permanently intrusive scrollbar                                                                                                | this remediation         | **Fixed** — `styles/base/_scrollbars.scss`                          |
| 3   | Administration navigation is always expanded and has no clear expand/collapse arrow                                                                  | this remediation         | **Fixed** — every parent is a disclosure                            |
| 4   | Administration expansion/collapse lacks a smooth controlled animation                                                                                | this remediation         | **Fixed** — `grid-template-rows` transition                         |
| 5   | Customer Search has no clear Add Customer action                                                                                                     | this remediation         | **Fixed** — `CustomerCreateActions`, header and empty result        |
| 6   | The system does not guide a normal non-technical user through creating an Individual or Company Customer                                             | this remediation, partly | **Partly addressed** — see below                                    |
| 7   | Duplicate-customer and duplicate-vehicle areas use technical or unclear language                                                                     | this remediation         | **Fixed** — labels, icons, intros rewritten                         |
| 8   | Duplicate-review screens do not explain, in business language, why records may be duplicates                                                         | this remediation         | **Fixed** — `MatchExplanation`                                      |
| 9   | User-facing wording across the application still assumes technical knowledge                                                                         | this remediation         | **Fixed** — audit plus `validate:plain-language`                    |
| 10  | The complete vehicle reception → delivery workflow is not represented as one integrated operating journey                                            | **not this phase**       | **Documented, not implemented** — `docs/product/workshop/`          |
| 11  | Vehicle creation does not provide the required Make → Model → Year → Trim/Body/Powertrain experience backed by an approved global catalogue strategy | **not this phase**       | **Documented, not implemented** — `docs/product/vehicle-catalogue/` |

### Defect 6 is only partly addressed, and the difference matters

Two creation paths exist and both are now reachable, discoverable and clearly
labelled. What this remediation did **not** do is rebuild the creation forms as
progressive sections — §9 of the Owner's instruction lists fourteen sections per
path, and most of those sections describe fields whose backend contract this
phase has not audited.

Building a fourteen-section wizard against unverified contracts is how the
phase's other guessing failures happened: an invented `veh.vehicle.create`
permission, an invented `ADDRESS_TYPES` list wrong in both directions, and nine
fixture fields guessed and rejected. The section model belongs in a controlled
Frontend wave with contract archaeology in front of it, and it is recorded as
such rather than half-built here.

### Defects 10 and 11 are documented, and documented is not implemented

`docs/product/workshop/` and `docs/product/vehicle-catalogue/` now carry the
complete business journey, the reception media checklist, the inspection and
diagnostics model, department assignment, parts and procurement, pricing,
payment and delivery, the vehicle history model, the provider evaluation, the
catalogue architecture and the manual-entry policy.

**None of it is built.** Every document says so in its own header. The
integration findings register in `docs/product/README.md` names, for each missing
contract, the owning Backend phase and the owning Frontend phase, and the
controlled sequence that closes it. Selecting or contracting a paid vehicle-data
provider is a commercial decision reserved to the Product Owner.

## A defect the Owner did not report, which this remediation found

Seven Tailwind colour names were used across fourteen components and registered
in the theme in none of them:

`brand-primary` · `on-brand` · `status-danger` · `status-success` ·
`status-warning` · `link` · `paper`

Tailwind emits no CSS for a class it does not recognise, and reports nothing
about it. So **51 utilities across 14 components had no rule behind them**: every
primary button on the CRM and Vehicle screens rendered with no fill, every error
message was not red, every success message was not green, and the printed
document had no page colour.

Nothing caught it — not the type checker, not ESLint, not Stylelint, not the
design-token gate (these are names, not raw values), not 767 unit tests, not
either browser tier. A `className` assertion passes whether or not the class
resolves, which is exactly how a screen can be colourless while its suite is
green.

Renamed to the names the theme defines; `paper` registered, because
`--color-paper` was a real token with no utility. `validate:web-theme` now fails
the build on an unresolvable colour utility, and
`tests/ci/tailwind-theme-gate.test.ts` proves the gate can still fail.

This is very likely part of what the Owner was reacting to under defect 9. It is
recorded separately because it is a different failure with a different cause, and
merging it into the wording finding would lose the lesson.

## What is deliberately still absent

- **CRM and Vehicle merge.** `P1-OD-017` is open. The affordance is absent, not
  disabled — a disabled control asserts that the capability exists and that this
  operator lacks permission, which is a different and false statement. Both
  review screens say so in a sentence.
- **Media upload.** `P1-OD-025` is open. The reception media checklist is
  specified in `docs/product/workshop/reception-media-checklist.md` and no upload
  path is claimed complete.
- **A candidate count on either duplicate queue.** The Owner's §10 permits one
  "when the contract safely supports it". It does not: the read publishes
  `{ items, nextCursor, hasMore }` and no total. A count derived from a page
  would be a fabricated number on a screen whose entire purpose is a careful
  decision about two real records.
- **Vehicle document creation.** `/api/v1/vehicles/{id}/documents` is read-only;
  no create operation exists. Recorded as an integration finding rather than
  worked around.

## The installed-browser review found three more

Recorded in full in [`installed-chrome-review.md`](installed-chrome-review.md).

Everything above merged with every automated tier green. Twenty minutes in the
Owner's own Chrome then found a closed navigation group that was **6px tall
rather than zero**, a stylesheet documenting a scrollbar rule the browser
discards, and an **authenticated browser tier that could not sign in at all**.

That is the second time in one week that this phase has learned the same thing,
and it is worth stating rather than filing: **a green tier is a statement about
the tier, not about the product.** All three are fixed in `44e053ad`, and the
review was re-run against the merged tree.

## Verification

| tier                                     | result                                           |
| ---------------------------------------- | ------------------------------------------------ |
| Web unit and component                   | **801 passed**, 0 failed                         |
| Root CI tier                             | 638 passed, 0 failed                             |
| Database and RLS, on a clean database    | **1636 / 1636**, before fixtures and after reset |
| Anonymous browser                        | 146 passed, 0 failed, 4 skipped                  |
| Authenticated browser (en / ar / tablet) | **181 passed**, 0 failed                         |
| Installed Chrome                         | **26 passed · 3 not applicable · 0 failed**      |
| Mutation matrix `--only=M-OA`            | **19 / 19 caught**                               |
| Hosted CI, PR #200 head                  | 20 / 20 acceptable, `ci-gate` green              |
| Hosted CI, PR #201 head                  | 19 success, 1 skipped, `ci-gate` green           |
| `validate:plain-language`                | 24 rules, 0 findings                             |
| `validate:web-theme`                     | 170 files, 54 colours, 0 unresolvable            |
| `validate:web-tokens`                    | 195 files, 0 raw values                          |
| `validate:p1-27-frontend`                | **43** files, 0 failures                         |
| `validate:command-coverage`              | 71 / 71 required commands reachable and invoked  |

## Governance

- Branch `remediation/p1-27-owner-acceptance-ux`, based on the exact protected
  `origin/develop` `8b9be4bc92a6349a6cb99d15ee282f5f463c63a5`, merged as PR
  #200 → `11c07b1d`. Branch `remediation/p1-27-chrome-review-findings` merged as
  PR #201 → `44e053ad`. Both are two-parent merge commits.
- No database schema change, no migration change. Migration count remains 119.
- No Backend business logic in this branch.
- No direct push to a protected branch, no force push, no squash, no rebase.
- `main` untouched at `f085d82001a43de51725707426d5c10eb134c004`.
- `P1-G27` not created. P1-27 not closed. P1-28 not started.

**P1-27 closes only when the Product Owner manually tests the application again
and returns `OWNER ACCEPTANCE: PASS`. Silence is not Pass.**

<!-- The gate-owned file count in this document is DERIVED. It read 40 while the
     gate reported 43 (`E-05`), in three places, after the fix that corrected the
     sentence directly above the first of them. `validate:p1-27-doc-counts`
     recomputes it from the gate's own scan roots, so the day a third tree is
     added this document follows it. The markers live here, outside every table:
     an earlier revision put them in a label column and broke two other gates
     whose regexes read the label and the number as adjacent cells. -->

<!-- derived: files p1-27-frontend-gate = 70 -->
<!-- derived: files p1-27-frontend-gate:trees = 3 -->
