# Phase 1-27 — deliverable manifest

**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Status:** P1-27 **OPEN** — reopened on `OWNER ACCEPTANCE: FAIL`, not closed, not
promoted · **Recorded:** 2026-08-06

**Company:** RootLco — Root Link Company · **Product:** CRM (temporary but
decided) · **Phase:** P1-27 — CRM and Vehicle Frontend ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review
under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent third-party audit.**

---

## 1. How this manifest was produced

**Every row below comes from a command run against the branch as committed.**
Nothing is listed from a plan, from a task register, or from memory of what a
wave covered. Where a figure could not be produced by a command in this
checkout — the database tier needs a running PostgreSQL, the hosted-CI results
belong to GitHub — the row is marked **recorded** and the document that records
it is named. Where a fact could not be established at all it is in §13, with what
would establish it.

That discipline is not decoration. Six of the ten evidence cells in the first
version of this phase's task register named test files **that do not exist**;
they were written from memory of what each wave had covered, and every one of
them was plausible. A register that cites a file which is not there is worse than
one that cites nothing, because it looks like evidence.

### 1.1 The commands

| #   | command                                                                                                                                                                                                                                                                           | what it established                                                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | recursive file enumeration of `apps/web/src/features/crm`, `apps/web/src/features/vehicles`, `apps/web/src/app`, `apps/web/tests`, `tests/ci`, `scripts/ci`, `scripts/dev/owner-acceptance`, `apps/web/scripts`, `docs/phase-1/phase-1-27`, `docs/product`, `supabase/migrations` | every path in §5, §6, §7, §9, §10 and the migration count                                                                                   |
| 2   | `node scripts/ci/check-p1-27-frontend.mjs`                                                                                                                                                                                                                                        | `40 file(s) across 2 tree(s), 0 failure(s)`                                                                                                 |
| 3   | `node scripts/ci/check-plain-language.mjs`                                                                                                                                                                                                                                        | `2 catalogue(s), 24 rule(s), 0 finding(s)`                                                                                                  |
| 4   | `node scripts/check-tailwind-theme.mjs` (from `apps/web`)                                                                                                                                                                                                                         | `170 file(s) checked, 54 colour(s) registered, 0 unresolvable`                                                                              |
| 5   | `node scripts/check-design-tokens.mjs` · `check-brand-isolation.mjs` · `check-api-boundary.mjs` (from `apps/web`)                                                                                                                                                                 | `195 / 0`, `197 / 0`, `170 / 0`                                                                                                             |
| 6   | `node scripts/ci/check-command-coverage.mjs`                                                                                                                                                                                                                                      | `142 registered command(s), 70 required · reachable 70/70 · invoked by hosted CI 70/70`                                                     |
| 7   | `node scripts/ci/generate-idempotent-operations.mjs --check`                                                                                                                                                                                                                      | `243 published operation(s), 120 idempotent` · manifest matches the published contract                                                      |
| 8   | `npm run test:web`                                                                                                                                                                                                                                                                | **39 files, 803 passed, 0 failed**                                                                                                          |
| 9   | `npm run test`                                                                                                                                                                                                                                                                    | **77 files, 1680 passed, 0 failed**                                                                                                         |
| 10  | `npx vitest run tests/ci`                                                                                                                                                                                                                                                         | **31 files, 638 passed, 0 failed**                                                                                                          |
| 11  | `npx playwright test --list` (from `apps/web`)                                                                                                                                                                                                                                    | **150 tests in 2 files**                                                                                                                    |
| 12  | the same with `ROOTLCO_E2E_AUTH=1`                                                                                                                                                                                                                                                | **331 tests in 9 files** — the authenticated tier is the 181-test, 7-file difference                                                        |
| 13  | reading `docs/api/openapi.v1.json`                                                                                                                                                                                                                                                | **243 operations across 203 paths**; `components.schemas` holds exactly `ProblemDocument`, `Money`, `PageEnvelope`                          |
| 14  | reading `supabase/seeds/04_iam_permission_catalog.sql`                                                                                                                                                                                                                            | `veh.vehicle.manage` seeded · `veh.vehicle.create` **not** seeded · `shared.document.manage` seeded · `shared.document.read` **not** seeded |
| 15  | reading `.git/refs/heads`, `.git/refs/remotes`, `.git/packed-refs`, `.git/logs/HEAD`                                                                                                                                                                                              | every SHA in §4                                                                                                                             |
| 16  | reading `.git/logs/refs/heads/docs/p1-27-registers-and-program` and `.git/index`                                                                                                                                                                                                  | the working-branch anchor in §1.2, and which documentation files are TRACKED rather than merely present — §1.3                              |

Command 14 is in the list because it is the one that refuses invention. A
previous documentation wave wrote the permission `veh.vehicle.create` by symmetry
with `crm.customer.create`; the catalogue check refused the whole bootstrap
rather than granting thirty of thirty-one. **The real code is
`veh.vehicle.manage`**, the same code that gates editing, and this manifest
states it because the file states it.

### 1.2 Anchors

| anchor                     | value                                                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| protected `origin/develop` | `19f370b982ebd7750612239154311f0036e5c34e`                                                                                                                                      |
| working branch             | `docs/p1-27-registers-and-program`, head `9de1a3c3940722097d8f630dd8c7bfc180881da6` — **one documentation commit ahead of `develop`**, and carrying untracked documents besides |
| that commit                | `docs(p1-27): correct an overstatement, and measure the drawer`, read from `.git/logs/refs/heads/docs/p1-27-registers-and-program`                                              |
| protected `origin/main`    | `f085d82001a43de51725707426d5c10eb134c004` — **untouched by this phase**                                                                                                        |
| migrations on the branch   | **119** `.sql` files under `supabase/migrations`                                                                                                                                |
| published API surface      | **243** operations across **203** paths                                                                                                                                         |
| `P1-G27` gate record       | **does not exist**, and must not be created — §11                                                                                                                               |

### 1.3 What a reader should reconcile against

The authority for §5 is command 2: `validate:p1-27-frontend` walks
`apps/web/src/features/crm` and `apps/web/src/features/vehicles` and reports the
file count it inspected. The authority for §6 is commands 8 to 12. The authority
for §4 is the reflog. A path that no command produced is not in this manifest.

**Every documentation count in §3, §9 and §10 is a count of files TRACKED on the
branch**, checked against `.git/index`, not of everything present on disk. At the
moment of enumeration the working tree also held five untracked documents that a
documentation wave was still writing — `deliverable-manifest.md` (this file),
`open-decisions.md`, `risk-register.md`, `evidence/task-traceability.md` and
`docs/product/workshop/frontend-implementation-program.md`. They are named here
so that a later reader who enumerates the directories and counts nineteen and
twelve does not conclude that this manifest is wrong, and so that nobody reads
their presence as a claim that they were part of any merge in §4. **They were
not.**

---

## 2. What this manifest is, and what it is not

| it is                                                                         | it is not                                                                 |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| An inventory of what P1-27 and its three remediations put into the repository | A statement that the deliverable is complete, accepted, or ready to close |
| A record that each artefact exists at the path given, at the branch given     | Evidence that the product satisfies the Product Owner                     |
| A technical self-review under the two named policies                          | An independent third-party audit                                          |

**P1-27 is open.** The Product Owner manually tested the merged application and
returned `OWNER ACCEPTANCE: FAIL` with eleven confirmed defects. Three
remediations have since merged. None of that is acceptance. The phase closes only
on an explicit `OWNER ACCEPTANCE: PASS` — §14.

The single most important fact this phase produced belongs at the top of its
manifest rather than in a footnote: **at the moment the Owner found eleven
defects, 767 web unit tests, 146 anonymous browser tests, 180 authenticated
browser tests, 1636 database and RLS tests, hosted CI and CodeQL were all green.**
Every figure in this document is therefore offered as a description of what
exists, never as an argument that it works.

---

## 3. Deliverable totals

| category                                                               | artefacts                                                          | how counted                                                                |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Feature source under the P1-27 ownership gate                          | **40**                                                             | command 2                                                                  |
| Router pages (CRM and Vehicle)                                         | **8**                                                              | command 1                                                                  |
| Shared-foundation source files changed by the phase or its remediation | **13** named in §5.5                                               | command 1, cross-read against the task register and the remediation record |
| Web unit and component test files                                      | **39**                                                             | commands 1 and 8                                                           |
| Playwright specification files                                         | **9** (2 anonymous, 7 authenticated)                               | commands 11 and 12                                                         |
| Root CI-contract test files                                            | **31**                                                             | commands 1 and 10                                                          |
| CI gate scripts under `scripts/ci`                                     | **40** in the directory, **5** introduced or changed by this phase | command 1; the five are the `scripts/ci` rows of §7.1                      |
| Web gate scripts under `apps/web/scripts`                              | **4** in the directory, **1** introduced by this phase             | command 1                                                                  |
| Phase documentation under `docs/phase-1/phase-1-27`                    | **15** tracked                                                     | command 1, filtered to `.git/index` — see §1.3                             |
| Product planning documentation under `docs/product`                    | **11** tracked                                                     | command 1, filtered to `.git/index` — see §1.3                             |
| Local acceptance tooling under `scripts/dev/owner-acceptance`          | **8**                                                              | command 1                                                                  |
| Mutation identifiers in the `M-OA` family                              | **20**                                                             | command 1, reading `scripts/ci/hostile-mutations.mjs`                      |
| Migrations added                                                       | **0** — the count stays at 119                                     | command 1                                                                  |

---

## 4. Protected merge history

Five merges carried P1-27 onto protected `develop`. The SHAs below are read out
of `.git/logs/HEAD`, `.git/refs/heads` and `.git/refs/remotes/origin/develop` in
this checkout. **The pull-request numbers are a separate claim from the SHAs**,
and the table marks which of them a repository document actually names.

| branch                                         | branch head                                | protected `develop` after the merge        | PR number | named by                                                                                                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------ | ------------------------------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `feature/p1-27-crm-vehicle-frontend`           | `3b81b13ce09f7ece7883d6a6527ecf346aae256b` | `9a9d7a6765e5495eed16bdc1956362484fa61cef` | **#198**  | [`ci-evidence.md`](ci-evidence.md) and [`findings.md`](findings.md) §Wave 17                                                                                                                                |
| `remediation/p1-27-lint-ignores-supabase-temp` | `f7d5febb0e872e5953091cb131f2ffb31b5ef53a` | `8b9be4bc92a6349a6cb99d15ee282f5f463c63a5` | **#199**  | **no tracked repository document names this number** — only this manifest and `open-decisions.md`, both untracked at §1.3; see §13                                                                          |
| `remediation/p1-27-owner-acceptance-ux`        | `8ef5747d1c35c6e4013152813de9bb068de6196d` | `11c07b1d9e7916f609d9b49d77c42de457a1778c` | **#200**  | [`owner-acceptance-fail-remediation.md`](owner-acceptance-fail-remediation.md) §Governance                                                                                                                  |
| `remediation/p1-27-chrome-review-findings`     | `7597106b9270400d8bff5c372c7f9e943b0aecd4` | `44e053ad1ec2267398ad96dab83693b5cada5d31` | **#201**  | the same                                                                                                                                                                                                    |
| `docs/p1-27-installed-chrome-review`           | `4de51d9ca45be114e6a03ff42a8a53db5c594757` | `19f370b982ebd7750612239154311f0036e5c34e` | **#202**  | **no tracked repository document names this number** — this manifest, `open-decisions.md`, `risk-register.md` §9 and `evidence/task-traceability.md` §1 all do, and all four are untracked at §1.3; see §13 |

### 4.1 What each merge carried

| #    | scope                                                                                                                                                                                                    | the reason it was a separate merge                                                                                                                                                                       |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #198 | The 42 implementation tasks — Frontend 29, Security 4, QA 5, DevOps 2, Documentation 2                                                                                                                   | The feature branch itself                                                                                                                                                                                |
| #199 | `P1-27-F-001` — root lint walked `supabase/.temp/`, 154 errors, failing the **required** `verify:repository` aggregate                                                                                   | Found during Owner-acceptance verification of the protected merge, not during development: the directory only exists once `supabase start` has run, and hosted CI never runs that command before linting |
| #200 | `OA-01` … `OA-09` — the Owner-acceptance remediation, plus the eleven `docs/product` planning documents                                                                                                  | The Owner's `FAIL` arrived against the merged application, so the fixes could only be based on the merged SHA                                                                                            |
| #201 | The three defects the installed Chrome found — a closed navigation group 6px tall, a stylesheet documenting a rule the browser discards, and an authenticated browser tier that could not sign in at all | The review ran against the merged tree, so its findings could not have been in #200                                                                                                                      |
| #202 | [`installed-chrome-review.md`](installed-chrome-review.md) — the measured record of that review, later extended with a second pass                                                                       | Documentation only                                                                                                                                                                                       |

The Owner tested `8b9be4bc92a6349a6cb99d15ee282f5f463c63a5` — the state after
#199 — and that is the SHA the eleven defects are recorded against.

### 4.2 Merge-commit discipline

`owner-acceptance-fail-remediation.md` states that #200 and #201 are two-parent
merge commits, that no push to a protected branch was direct, and that there was
no force push, no squash and no rebase. **This manifest does not independently
re-prove the parent count**, because doing so requires running `git`, which this
document's own production rules forbid; §13 records that gap and what closes it.
What the reflog does show, and what is stated here rather than inferred, is that
every advance of local `develop` in the sequence above was a fast-forward from
`origin/develop` — the branch was never advanced locally by a commit of its own.

---

## 5. Source files

### 5.1 The two trees the P1-27 ownership gate owns — 40 files

`validate:p1-27-frontend` reports **40 files across 2 trees, 0 failures**. Those
40 are §5.2 and §5.3 together. The gate refuses to pass a rule that inspected
zero files, and it runs its own `selfTest()` on **every** invocation — a comment
stripper that over-matched would turn all six rules into scans over empty strings
and report clean, which is the one failure mode the per-rule anti-vacuity checks
cannot see.

### 5.2 CRM — `apps/web/src/features/crm/` (18 files)

| path                                              | carries                                                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `permissions.ts`                                  | The CRM permission codes the screens gate on                                                          |
| `customers/api.ts`                                | `crm.customer-search` adapter                                                                         |
| `customers/contract.ts`                           | Search criteria, `CustomerSearchHit`, the page contract `{ items, nextCursor, hasMore }`              |
| `customers/creation-actions.ts`                   | `crm.individual-create`, `crm.company-create`                                                         |
| `customers/creation-contract.ts`                  | The creation schemas and `possibleDuplicates` on the creation **response**                            |
| `customers/governance-actions.ts`                 | The six governance writes, behind six different permissions                                           |
| `customers/governance-contract.ts`                | Their schemas and server vocabularies                                                                 |
| `customers/identity-api.ts`                       | `crm.customer-timeline`, `crm.customer-history`, `crm.duplicate-list`, `crm.duplicate-review`         |
| `customers/identity-contract.ts`                  | Duplicate-candidate and timeline shapes                                                               |
| `customers/profile-api.ts`                        | The eight profile sub-resource reads, including the notes adapter that publishes `includesRestricted` |
| `customers/profile-contract.ts`                   | Their shapes                                                                                          |
| `customers/components/CustomerCreateActions.tsx`  | `OA-04` — Add an individual customer / Add a company customer                                         |
| `customers/components/CustomerCreateScreen.tsx`   | Both creation paths                                                                                   |
| `customers/components/CustomerProfileScreen.tsx`  | The profile and its component sections                                                                |
| `customers/components/CustomerSearchScreen.tsx`   | Search, with the results a separate component mounted only after submission                           |
| `customers/components/DuplicateDecisionPanel.tsx` | The dismissal decision — **and no merge form**, because **`P1-OD-017`** is open                       |
| `customers/components/DuplicateReviewScreen.tsx`  | The CRM duplicate queue                                                                               |
| `customers/components/RecordForm.tsx`             | The shared write form, gated on a successful read                                                     |

### 5.3 Vehicle — `apps/web/src/features/vehicles/` (22 files)

| path                                            | carries                                                                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `api.ts`                                        | `veh.vehicle-search`, `veh.vehicle-create` (permission **`veh.vehicle.manage`**)                                                            |
| `catalogue-api.ts`                              | The five catalogue reads — makes, models, trims, body types, powertrain types                                                               |
| `contract.ts`                                   | `normalizeCriteria` over a frozen `CRITERIA_KEYS` list into an `Object.create(null)` target                                                 |
| `documents-api.ts`                              | `veh.vehicle-document-list`, gated on **`shared.document.manage`**                                                                          |
| `documents-contract.ts`                         | The document reference shape — a reference and nothing else. Holds `MEDIA_STATUS = 'blocked-on-p1-od-025'`, because **`P1-OD-025`** is open |
| `duplicates-api.ts`                             | `veh.vehicle-duplicate-list`, `veh.vehicle-duplicate-review`, `veh.vehicle-history`                                                         |
| `duplicates-contract.ts`                        | Candidate and attribute-history shapes                                                                                                      |
| `history-api.ts`                                | Ownership, plate and odometer history reads                                                                                                 |
| `history-contract.ts`                           | Their shapes                                                                                                                                |
| `profile-api.ts`                                | `veh.vehicle-read`, `veh.vehicle-update`, `veh.vehicle-status-change`, and the VIN-uniqueness probe                                         |
| `profile-contract.ts`                           | The vehicle detail shape, including `recordVersion`                                                                                         |
| `relations-api.ts`                              | EV profile read and set; relationships; authorised-party add and retire                                                                     |
| `relations-contract.ts`                         | Their shapes                                                                                                                                |
| `components/VehicleSearchScreen.tsx`            | Vehicle search — exact VIN, plate and vehicle number, no substring                                                                          |
| `components/VehicleCreateScreen.tsx`            | Creation with dependent catalogue selectors                                                                                                 |
| `components/VinField.tsx`                       | Format validation at the edge; the server's uniqueness verdict                                                                              |
| `components/VehicleProfileScreen.tsx`           | The profile and its tabs                                                                                                                    |
| `components/VehicleHistorySections.tsx`         | Ownership, plate, odometer                                                                                                                  |
| `components/VehicleRelationsSections.tsx`       | EV/hybrid information and vehicle-customer relationships                                                                                    |
| `components/VehicleDocumentsSection.tsx`        | The document list, permission checked **before** the read is issued                                                                         |
| `components/VehicleAttributeHistorySection.tsx` | The attribute-change ledger — not a timeline                                                                                                |
| `components/VehicleDuplicateReviewScreen.tsx`   | The vehicle duplicate queue                                                                                                                 |

### 5.4 Router pages — `apps/web/src/app/[locale]/(dashboard)/` (8 files)

| path                                  | screen                          |
| ------------------------------------- | ------------------------------- |
| `crm/customers/page.tsx`              | Customer search                 |
| `crm/customers/[customerId]/page.tsx` | Customer profile                |
| `crm/customers/new/[kind]/page.tsx`   | Individual and company creation |
| `crm/customer-duplicates/page.tsx`    | CRM duplicate queue             |
| `vehicles/page.tsx`                   | Vehicle search                  |
| `vehicles/[vehicleId]/page.tsx`       | Vehicle profile                 |
| `vehicles/new/page.tsx`               | Vehicle creation                |
| `vehicles/duplicates/page.tsx`        | Vehicle duplicate queue         |

These eight are the whole of P1-27's routed surface. **The router holds no page
for any other business domain** — outside authentication, administration, the
dashboard overview, the profile and the component gallery, nothing else exists.

### 5.5 Shared-foundation source changed by the phase or its remediation (13 files)

These sit outside the two gate-owned trees and are named individually, because a
manifest that listed only the gate's 40 files would omit the fixes the Owner
actually asked for.

| path                                                      | task                 | what changed                                                                                                                  |
| --------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/forms/Field.tsx`                 | `OA-01`              | `PasswordField` — the reveal control inside the field, product-wide, in the design-system authority rather than on one screen |
| `apps/web/src/styles/base/_scrollbars.scss`               | `OA-02`              | The subtle overlay scrollbar on the sidebar navigation                                                                        |
| `apps/web/src/components/shell/Sidebar.tsx`               | `OA-03`              | Every sidebar parent a controlled disclosure, with a `grid-template-rows` transition and a chevron                            |
| `apps/web/src/components/shell/AppShell.tsx`              | `OA-03` (`M-OA-06c`) | The tablet drawer renders the same accordion — `collapsed={false} withinDrawer`                                               |
| `apps/web/src/config/navigation.ts`                       | `OA-05`              | Both duplicate queues named, iconed, and each gated on its own `*.duplicate.review` code                                      |
| `apps/web/src/i18n/messages/en.json`                      | `OA-05`, `OA-07`     | The English catalogue — 1023 keys, every value subject to 24 plain-language rules                                             |
| `apps/web/src/i18n/messages/ar.json`                      | `OA-05`, `OA-07`     | The Arabic catalogue, under the same rules, with no exemption                                                                 |
| `apps/web/src/components/duplicates/MatchExplanation.tsx` | `OA-06`              | Match evidence rendered as business sentences with a confidence band                                                          |
| `apps/web/src/lib/duplicates/explanations.ts`             | `OA-06`              | The sentence construction; no signal name leaks to the screen                                                                 |
| `apps/web/src/lib/duplicates/score.ts`                    | `OA-06`              | `formatMatchScore` over a `numeric` **string**, never `parseFloat`                                                            |
| `apps/web/tailwind.config.ts`                             | `OA-08`              | The colour registrations, including `paper` — `--color-paper` was a real token with no utility                                |
| `apps/web/src/lib/api/operation-contract.ts`              | `P1-27-INT-003`      | Resolves a request path to its published operation, in both `/api/v1`-prefixed and unprefixed forms                           |
| `apps/web/src/components/data-table/use-server-table.ts`  | `QA-002`, `DO-002`   | Passes the failure status through instead of collapsing `unavailable`, `expired` and `not-found` into a generic error         |

Two generic helpers were promoted out of `features/administration/shared` in
Wave 2 — `lib/api/read-operation.ts` and the table hook above — with the old
paths re-exporting, so no P1-26 screen changed.

### 5.6 The generated artefact

| path                                            | generator                                       | gate                                                                                          |
| ----------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `apps/web/src/lib/api/idempotent-operations.ts` | `scripts/ci/generate-idempotent-operations.mjs` | `validate:idempotent-operations` fails the build on any drift from `docs/api/openapi.v1.json` |

This closes `P1-27-INT-003`. The client used to derive `Idempotency-Key` from the
HTTP method; the backend reads `operation.idempotent` off the registration. Nine
operations disagreed — six PUT and three PATCH — and each answered
`400 ERR-INT-002` **before authorization**, on every attempt. Three of the nine
are on P1-27's own call list: `crm.preference-set`, `veh.vehicle-update` and
`veh.vehicle-status-change`.

### 5.7 What no source file in §5.2 or §5.3 contains

Six rules, each enforced by `check-p1-27-frontend.mjs` and each pinned by a
planted violation:

| rule                           | what it refuses                                                                        | why it exists                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-merge-caller`              | Any call to `crm.customer-merge` or `veh.vehicle-merge`                                | **`P1-OD-017` — duplicate and merge rules — is an OPEN Owner decision.** The affordance is _absent_, not disabled: a disabled control asserts that the capability exists and that this operator lacks permission, which is a different and false statement. Both review screens say so in a sentence. Wave 6 shipped a working merge form; it was removed, and the gate exists because a green suite did not stop it |
| `no-duplicate-scan-on-a-queue` | Any call to `crm.duplicate-scan` or `veh.vehicle-duplicate-scan` from a review surface | Each reads like a query and is a privileged audited **write** that creates candidate rows and is throttled at 30/min. A queue that "refreshed" by scanning would write audit history every time an operator opened it                                                                                                                                                                                                |
| `no-client-asserted-scope`     | `tenantId`, `companyId`, `branchId` and their snake_case forms                         | Scope is resolved server-side from the session on every operation these screens call                                                                                                                                                                                                                                                                                                                                 |
| `no-invented-total`            | `total: rows.length` and its variants                                                  | Every list is `{ items, nextCursor, hasMore }` with **no total**. A count derived from a page is correct on page one and wrong from page two, invisibly                                                                                                                                                                                                                                                              |
| `no-upload-path`               | `new FormData()`, `multipart/form-data`, `type="file"`                                 | **`P1-OD-025` — vehicle document and media file policy — is an OPEN Owner decision.** There is no vehicle media operation in the platform at all. `MEDIA_STATUS` is `'blocked-on-p1-od-025'`, not a feature flag: a flag implies something to switch on                                                                                                                                                              |
| `no-console-output`            | `console.*` reaching a feature module                                                  | Observability goes through the shared authority                                                                                                                                                                                                                                                                                                                                                                      |

**Neither duplicate queue shows a candidate count.** The read publishes
`{ items, nextCursor, hasMore }` and no total, so a count would be a fabricated
number on a screen whose entire purpose is a careful decision about two real
records.

---

## 6. Test files

### 6.1 Web unit and component — `apps/web/tests` (39 files, 803 cases, 0 failed)

Measured by command 8, run twice with identical results.

| cases | file                                   |     | cases | file                                      |
| ----- | -------------------------------------- | --- | ----- | ----------------------------------------- |
| 24    | `administration.test.ts`               |     | 36    | **`p1-27-owner-acceptance.dom.test.tsx`** |
| 39    | `api-client.test.ts`                   |     | 18    | `p1-27-qa.test.ts`                        |
| 4     | `api-readiness.test.ts`                |     | 20    | `p1-27-security.test.ts`                  |
| 22    | `authentication.test.ts`               |     | 17    | `security.test.ts`                        |
| 15    | `brand-replacement.test.ts`            |     | 11    | `server-vocabularies.test.ts`             |
| 23    | `crm-customer-components.dom.test.tsx` |     | 16    | `session.test.ts`                         |
| 19    | `crm-customer-create.dom.test.tsx`     |     | 13    | `shell-viewport.dom.test.tsx`             |
| 21    | `crm-customer-profile.dom.test.tsx`    |     | 24    | `shell.dom.test.tsx`                      |
| 13    | `crm-customer-search.dom.test.tsx`     |     | 28    | `stylelint-policy.test.ts`                |
| 40    | `crm-customer-search.test.ts`          |     | 25    | `table-state.test.ts`                     |
| 24    | `crm-duplicate-review.test.ts`         |     | 23    | `vehicle-api.test.ts`                     |
| 27    | `crm-governance-writes.test.ts`        |     | 25    | `vehicle-contract.test.ts`                |
| 10    | `crm-profile-api.test.ts`              |     | 20    | `vehicle-duplicates.test.ts`              |
| 8     | `data-table.dom.test.tsx`              |     | 20    | `vehicle-history.test.ts`                 |
| 19    | `gallery-and-print.dom.test.tsx`       |     | 24    | `vehicle-profile.test.ts`                 |
| 10    | `i18n.test.ts`                         |     | 18    | `vehicle-relations.test.ts`               |
| 4     | `loading-boundary.dom.test.tsx`        |     | 24    | `vehicle-screens.dom.test.tsx`            |
| 37    | `money.test.ts`                        |     | 22    | `navigation.test.ts`                      |
| 12    | `observability.test.ts`                |     | 21    | `overlays.dom.test.tsx`                   |
| 27    | `operation-contract.test.ts`           |     |       |                                           |

Three files in that directory are helpers and declare no test: `render.tsx`,
`setup.dom.ts` and `e2e/origin.ts`.

**`p1-27-owner-acceptance.dom.test.tsx` declares 34 `it(...)` blocks and executes
36 cases.** Two of the declarations are `it.each(BOTH_DIRECTIONS)` over English
and Arabic, so each expands to two. A reader counting declarations gets 34 and a
runner reports 36; both are correct about different things, and the difference is
recorded here so nobody later reconciles them by editing one of the numbers.

### 6.2 The files that pin the Owner-acceptance fixes

| file                                                 | cases | what it pins                                                                                                                                                                                                                                                          |
| ---------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/tests/p1-27-owner-acceptance.dom.test.tsx` | 36    | All six frontend defects, in four blocks: the password reveal inside the field; the sidebar navigation, including the tablet drawer and an `AppShell` source assertion; customer creation offered where an operator looks; a duplicate candidate that explains itself |
| `apps/web/tests/crm-customer-search.test.ts`         | 40    | The header creation actions (`M-OA-15`)                                                                                                                                                                                                                               |
| `apps/web/tests/vehicle-screens.dom.test.tsx`        | 24    | The vehicle match explanation, with a `<pre>` count of zero (`M-OA-13`)                                                                                                                                                                                               |
| `tests/ci/plain-language-gate.test.ts`               | 21    | That `validate:plain-language` can still fail (`M-OA-16`, `M-OA-17`)                                                                                                                                                                                                  |
| `tests/ci/tailwind-theme-gate.test.ts`               | 8     | That `validate:web-theme` can still fail (`M-OA-18`)                                                                                                                                                                                                                  |
| `tests/ci/eslint-global-ignores.test.ts`             | 11    | `P1-27-F-001` — and the opposite failure too: `src/**`, `scripts/**`, `tests/**` and `**/*` must never appear in the ignore list                                                                                                                                      |
| `apps/web/tests/navigation.test.ts`                  | 22    | The exact `available` and `planned` lists, so drift in either direction fails                                                                                                                                                                                         |
| `apps/web/tests/server-vocabularies.test.ts`         | 11    | Server vocabularies read out of the migrations and compared to both catalogues, in both directions                                                                                                                                                                    |

### 6.3 Browser tiers

| tier                                                                                                                                                                                                         | files | tests   | how measured                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ------- | -------------------------------------- |
| Anonymous (`foundation.spec.ts`, `shared-ux-anonymous.spec.ts`) across 5 projects — `desktop-en`, `desktop-ar`, `laptop-en`, `tablet-ar`, `reduced-motion`                                                   | 2     | **150** | command 11                             |
| Authenticated (`auth.setup.ts`, `shared-ux`, `administration`, `accessibility`, `crm-and-vehicles`, `drawer-and-restore`, `isolation`) across `authenticated-en`, `authenticated-ar`, `authenticated-tablet` | 7     | **181** | command 12, as the difference from 331 |

`apps/web/tests/e2e/authenticated/crm-and-vehicles.spec.ts` is the file that
asserts against the real stack with nothing mocked: **six** of the eight routes
in §5.4 resolve under a real session in both locales, both duplicate queues are
reachable **from the sidebar**, typing a VIN issues no request, no merge or
rescan control exists in the rendered output of either queue, opening either
queue issues no non-GET request at all, no request carries a scope parameter, and
a VIN typed into search never reaches the address bar.

**Six, not eight.** The spec's route list is `/crm/customers`,
`/crm/customers/new/individual`, `/crm/customer-duplicates`, `/vehicles`,
`/vehicles/new` and `/vehicles/duplicates`. The two detail routes —
`/crm/customers/[customerId]` and `/vehicles/[vehicleId]` — need a record
identifier, and the database is empty of business data by policy, so nothing in
this tier loads either of them. Its own `describe` block is named "every P1-27
route is reachable and renders" and the test inside it is named "the six screens
load without an error state"; the second name is the accurate one, and this
manifest states the number rather than repeating the block title.

**Neither browser tier is a superset of the other**, and this phase paid for
assuming otherwise twice. The authenticated tier is opt-in and local because it
needs a running Supabase, a running API and a real password; the anonymous tier
is what hosted CI runs. The installed-Chrome review then found that the
authenticated tier could not sign in at all — `getByLabel('Password')` matched
two elements once the reveal control gained the name "Show password" — while the
anonymous tier had been fixed before merge.

### 6.4 Root tiers

| tier                                                  | files                                           | cases                                                                                                                                                        | how measured                 |
| ----------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| `npm run test` — the root unit and contract aggregate | **77**                                          | **1680**                                                                                                                                                     | command 9                    |
| of which `tests/ci`                                   | **31**                                          | **638**                                                                                                                                                      | command 10                   |
| `tests/backend`                                       | **80** test files (85 files in the directory)   | **not run here** — needs a running PostgreSQL                                                                                                                | command 1 for the file count |
| `tests/db`                                            | **138** test files (142 files in the directory) | **not run here** — needs a running PostgreSQL. **Recorded** as 1636 / 1636 in [`owner-acceptance-fail-remediation.md`](owner-acceptance-fail-remediation.md) | command 1 for the file count |

The four `tests/ci` files this phase introduced or that carry its gates are
`p1-27-frontend-gate.test.ts` (26), `plain-language-gate.test.ts` (21),
`tailwind-theme-gate.test.ts` (8) and `idempotent-operations-manifest.test.ts`
(6); `eslint-global-ignores.test.ts` (11) and `documented-counts.test.ts` (4)
were changed by it.

---

## 7. Continuous-integration gate scripts

### 7.1 Introduced or changed by P1-27 and its remediation

| script                                          | npm command                                          | owning task                | what it refuses                                                                                                                                                                                                                                                                                                                                                      | measured output                                                 |
| ----------------------------------------------- | ---------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `scripts/ci/check-p1-27-frontend.mjs`           | `validate:p1-27-frontend`                            | `DO-001` (new)             | The six rules in §5.7, over the two feature trees. Comments are stripped first, a rule inspecting zero files fails, and `selfTest()` runs on every invocation                                                                                                                                                                                                        | `40 file(s) across 2 tree(s), 0 failure(s)`                     |
| `scripts/ci/check-plain-language.mjs`           | `validate:plain-language`                            | `OA-07` (new)              | 24 rules over every value in both message catalogues — JSON, UUID, enum, payload, null, boolean, object, schema, endpoint, API, design token, status code, token, cursor, idempotency, serialise, SQL, regex, tenant, permission code, operation id, snake_case identifier, camelCase identifier, raw translation key. **No exemptions**, and a two-way `selfTest()` | `2 catalogue(s), 24 rule(s), 0 finding(s)`                      |
| `apps/web/scripts/check-tailwind-theme.mjs`     | `validate:web-theme` (root) / `validate:theme` (web) | `OA-08` (new)              | A colour utility whose name resolves to no entry in `theme.extend.colors` and to no surviving Tailwind palette name                                                                                                                                                                                                                                                  | `170 file(s) checked, 54 colour(s) registered, 0 unresolvable`  |
| `scripts/ci/generate-idempotent-operations.mjs` | `validate:idempotent-operations`                     | `P1-27-INT-003` (new)      | Drift between the published contract and the generated table                                                                                                                                                                                                                                                                                                         | `243 published operation(s), 120 idempotent` — manifest matches |
| `scripts/ci/hostile-mutations.mjs`              | none — hand-run                                      | changed by `OA-*`          | The 20 `M-OA` mutations in §8                                                                                                                                                                                                                                                                                                                                        | not re-run here; it mutates tracked source in place             |
| `eslint.config.mjs`                             | `lint` → `verify:repository`                         | `P1-27-F-001` (changed)    | `globalIgnores` gained `'supabase/.temp/**'` and `'supabase/.branches/**'`                                                                                                                                                                                                                                                                                           | covered by `tests/ci/eslint-global-ignores.test.ts`             |
| `scripts/ci/check-command-coverage.mjs`         | `validate:command-coverage`                          | changed — registry entries | A required command not reachable from `verify:workspaces` **and** not invoked by hosted CI                                                                                                                                                                                                                                                                           | `142 registered command(s), 70 required · 70/70 · 70/70`        |

`validate:web-theme` exists because seven Tailwind colour names were used across
fourteen components and registered in the theme in none of them, so **51
utilities had no rule behind them**: every primary button on the CRM and Vehicle
screens rendered with no fill, every error message was not red, every success
message was not green, and the printed document had no page colour. Nothing
caught it — not the type checker, not ESLint, not Stylelint, not the design-token
gate (these are names, not raw values), not 767 unit tests, not either browser
tier. A `className` assertion passes whether or not the class resolves.

### 7.2 Gates P1-27 runs and did not introduce

`apps/web/scripts/check-design-tokens.mjs` (`195 file(s), 0 raw value(s)`),
`check-brand-isolation.mjs` (`197 file(s), 0 violation(s)`),
`check-api-boundary.mjs` (`170 file(s), 0 violation(s)`), plus
`scripts/ci/check-notification-authority.mjs`, `check-web-topology.mjs`,
`check-phase-ownership.mjs` and `check-p1-26-frontend.mjs`.

### 7.3 Where they are wired

| aggregate          | includes                                                                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify:web`       | `validate:web-tokens`, `validate:web-theme`, `validate:web-brand`, `validate:notification-authority`, `validate:web-boundary`, **`validate:p1-27-frontend`**, `build:web`, `test:web`, `test:web-e2e`       |
| `verify:policies`  | `validate:command-coverage`, `validate:web-topology`, `validate:api-backend-only`, `validate:generated-artifacts`, `validate:product-name`, **`validate:plain-language`**, `validate:p1-26-frontend`        |
| `verify:contracts` | `validate:module-boundaries`, `validate:authorization-coverage`, `validate:operation-coverage`, `validate:openapi`, `validate:exact-money`, `validate:p1-24-register`, **`validate:idempotent-operations`** |

A command no aggregate runs is a command that has never run.
`validate:command-coverage` refused the new gate until it was registered, which is
what makes it reachable from `verify:web` and invoked by hosted CI.

---

## 8. Mutation identifiers

`scripts/ci/hostile-mutations.mjs` holds **20** identifiers in the `M-OA`
family — `M-OA-01` … `M-OA-06`, `M-OA-06b`, `M-OA-06c`, `M-OA-07` … `M-OA-18` —
read out of the file by command 1.

| identifiers                                   | pin                                                                                                             | verifier                                     |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `M-OA-01` … `M-OA-03`                         | The password reveal inside the field                                                                            | `p1-27-owner-acceptance.dom.test.tsx`        |
| `M-OA-04` … `M-OA-06`, `M-OA-06b`, `M-OA-06c` | Every sidebar parent a disclosure; the closed group at zero height; the same accordion inside the tablet drawer | the same                                     |
| `M-OA-07` … `M-OA-09`                         | The overlay scrollbar                                                                                           | the same                                     |
| `M-OA-10`, `M-OA-11`, `M-OA-15`               | Customer creation offered from the page header and the empty result                                             | the same, and `crm-customer-search.test.ts`  |
| `M-OA-12` … `M-OA-14`                         | Match evidence as sentences with a confidence band                                                              | the same, and `vehicle-screens.dom.test.tsx` |
| `M-OA-16`, `M-OA-17`                          | That the plain-language gate can still fail                                                                     | `tests/ci/plain-language-gate.test.ts`       |
| `M-OA-18`                                     | That the theme gate can still fail                                                                              | `tests/ci/tailwind-theme-gate.test.ts`       |

`owner-acceptance-fail-remediation.md` records the matrix as **19 / 19 caught**.
The repository holds **20** identifiers; `M-OA-06c` — the tablet-drawer fix — is
absent from that verification table. The reconciliation is §12.

---

## 9. Documentation set

### 9.1 Phase documentation — `docs/phase-1/phase-1-27/` (15 tracked files)

Fifteen files are tracked on the branch. Four more were present on disk and
untracked when this was enumerated — see §1.3 — and are deliberately not counted
here, because an untracked file is not a deliverable of any merge in §4.

| path                                         | lines | what it is                                                                        |
| -------------------------------------------- | ----- | --------------------------------------------------------------------------------- |
| `canonical-plan.md`                          | 316   | What P1-27 is scoped to build, and the disposition of `P1-OD-017` and `P1-OD-025` |
| `task-register.md`                           | 239   | Every task with its contract, evidence and SHA, plus `OA-01` … `OA-09`            |
| `findings.md`                                | 871   | The live `P1-27-INT-###` register                                                 |
| `findings/p1-27-int-006-cursor-precision.md` | 166   | The cursor-precision finding in full                                              |
| `execution-checkpoint.md`                    | 289   | Base SHAs, surface baselines, the wave log                                        |
| `contract-archaeology.md`                    | 402   | What the Backend actually publishes, read before anything was built               |
| `owner-acceptance-fail-remediation.md`       | 182   | The `OWNER ACCEPTANCE: FAIL` result and the disposition of all eleven defects     |
| `installed-chrome-review.md`                 | 215   | The measured review in the Owner's own Chrome, first and second passes            |
| `owner-acceptance-checklist.md`              | 128   | What the Owner is asked to test                                                   |
| `operator-guide.md`                          | 176   | `DOC-002`                                                                         |
| `developer-guide.md`                         | 115   | `DOC-002`                                                                         |
| `ci-evidence.md`                             | 89    | Hosted CI on PR #198                                                              |
| `clean-room-evidence.md`                     | 86    | The clean-room build at `e14984e`                                                 |
| `preflight/final-readiness.md`               | 169   | The 9/9 readiness record                                                          |
| `preflight/final-readiness.json`             | 218   | Its machine-readable form                                                         |

`docs/engineering/ci-automation/pull-request-body.md` was also updated under
`DOC-001`, because adding one file to `scripts/ci` made its stated inventory
wrong; `tests/ci/documented-counts.test.ts` named the exact phrase that had to
change.

### 9.2 Product planning — `docs/product/` (11 tracked files)

Produced by `OA-09`, against the Owner's defects 10 and 11. Eleven files are
tracked and merged in #200; a twelfth was present on disk and untracked when this
was enumerated — see §1.3 — and `OA-09` did not produce it.
**Planning and traceability only. Nothing in this set is implemented, and every
document says so in its own header.**

| path                                                  | lines |
| ----------------------------------------------------- | ----- |
| `README.md` — the index and the consolidated register | 443   |
| `workshop/end-to-end-workshop-workflow.md`            | 1244  |
| `workshop/pricing-payment-and-delivery.md`            | 1137  |
| `workshop/vehicle-history-model.md`                   | 1039  |
| `workshop/inspection-and-diagnostics.md`              | 901   |
| `workshop/parts-and-procurement-flow.md`              | 798   |
| `workshop/department-task-assignment.md`              | 751   |
| `workshop/reception-media-checklist.md`               | 563   |
| `vehicle-catalogue/catalogue-architecture.md`         | 1029  |
| `vehicle-catalogue/manual-entry-policy.md`            | 656   |
| `vehicle-catalogue/provider-evaluation.md`            | 648   |

The register in `README.md` §3 gathers **176 findings** — `WF-01…28`,
`RMC-01…18`, `INS-01…19`, `DTA-01…20`, `PROC-01…21`, `PPD-01…15`, `VHM-01…20`,
`VDP-01…10`, `VCAT-01…13`, `MVE-01…12`. Every identifier is **document-local and
is not an entry in the `P1-27-INT-###` register**, whose highest allocated
identifier is `P1-27-INT-009`. Twenty of the 176 are the same gap seen from
different documents, listed so nobody counts 176 separate pieces of work.
Promoting any of them into the live register is a governance act belonging to the
register's owner, and that set does not perform it.

Three constraints this set binds itself to, and this manifest repeats because
they bind any later reader of it:

| constraint           | statement                                                                                                                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Money                | A **decimal string plus an ISO 4217 currency code**. `numeric` and `bigint` arrive as strings and stay strings. Never JavaScript floating point                                                                      |
| Pagination           | Every list is `{ items, nextCursor, hasMore }`. **There is no `total`**, and no screen may show "page 3 of 47"                                                                                                       |
| Commercial decisions | Selecting or contracting a paid vehicle-data provider is **reserved to the Product Owner**. `provider-evaluation.md` recommends an **evaluation**; it names no price, endorses no vendor, and authorises no purchase |

`README.md` §5 states the eight-step controlled sequence by which any of the 176
becomes real work in a later phase, and its first rule: **a finding blocked on an
Owner decision stops at step 1.** `P1-OD-017` and `P1-OD-025` are open, and every
finding they bind waits for the decision rather than for an engineer.

---

## 10. Local acceptance tooling

Committed, and therefore part of this manifest:

| path                                                                                 | npm command               |
| ------------------------------------------------------------------------------------ | ------------------------- |
| `scripts/dev/owner-acceptance/create-owner-account.mjs`                              | `acceptance:create-owner` |
| `scripts/dev/owner-acceptance/reset-owner-account.mjs`                               | `acceptance:reset-owner`  |
| `scripts/dev/owner-acceptance/status-owner-account.mjs`                              | `acceptance:status-owner` |
| `scripts/dev/owner-acceptance/verify-reset.mjs`                                      | `acceptance:verify-reset` |
| `scripts/dev/owner-acceptance/full-cycle.mjs`                                        | `acceptance:full-cycle`   |
| `scripts/dev/owner-acceptance/discovery.mjs` · `context.mjs` · `align-local-jwt.mjs` | supporting modules        |

`tests/ci/acceptance-discovery.test.ts` (10 cases) and
`tests/ci/owner-acceptance-password.test.ts` (12 cases) cover this tooling.

The acceptance role carries **thirty** permission codes. It previously carried
exactly the fourteen Administration codes from P1-26 and not one CRM or Vehicle
code, so **the Owner could not have tested this phase at all** — every screen it
built would have answered "you do not have permission", and no test in the
repository could have said so, because every one of them either mocks the session
or asserts that the denial path is correct, which it was.
`crm.customer.merge` and `veh.vehicle.merge` are deliberately **withheld**:
`P1-OD-017` is open, no screen calls either, and granting them would let an
acceptance run pass while the affordance that must not exist quietly did.

**Not part of this manifest:** the probes under `.local/` —
`owner-review-chrome.mjs`, `owner-review-tablet-drawer.mjs` and the screenshot
directory `.local/owner-review-shots/`. `.local/` is git-ignored. Those probes
read the local acceptance credentials, which never enter the repository, so they
are evidence that was produced on the Owner's machine and are not deliverables of
the branch.

---

## 11. What this manifest deliberately does not contain

| absent                                                                                           | why                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A gate record `P1-G27`**                                                                       | It does not exist in `docs/phase-1/phase-1-27/`, and it must not be created. The documentation-only gate record is written **only after** the Product Owner returns an explicit Pass. Writing it now would be the P1-26 mistake repeated: that phase was closed once on five unproven claims and had to be reopened                                                                                                                       |
| **Any promotion to `main`**                                                                      | `origin/main` is `f085d82001a43de51725707426d5c10eb134c004` and is untouched by this phase. Promotion is a separate, later act with its own pull requests and its own gate, and it is not part of closing anything                                                                                                                                                                                                                        |
| **Any migration**                                                                                | The count on the branch is **119**, exactly what protected `develop` already carried. There is no migration 120. `MIGRATION_DIFF=0` and `SUPABASE_DIFF=0` are required at merge                                                                                                                                                                                                                                                           |
| **Any Backend change in any Frontend branch**                                                    | `apps/api` is Backend only; `apps/web` is Frontend only. `APPS_API_EXECUTABLE_DIFF=0` is required at merge and the changed-file ownership gate enforces it. The six Backend defects this phase found were fixed on **Backend branches** — `P1-27-INT-001`/`-002`/`-005`/`-006` before the feature branch existed, and `-007`/`-008` on a P1-17 branch during it — each with its own finding id, its own tests and its own protected merge |
| **Any P1-28 artefact**                                                                           | P1-28 has not started. `P1_28_FILES=0` is a recorded boundary value of this phase                                                                                                                                                                                                                                                                                                                                                         |
| **A candidate count on either duplicate queue**                                                  | The read publishes no total. See §5.7                                                                                                                                                                                                                                                                                                                                                                                                     |
| **A merge affordance anywhere**                                                                  | `P1-OD-017` is open. Absent, not disabled                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Any upload path**                                                                              | `P1-OD-025` is open, and no vehicle media operation exists in the platform                                                                                                                                                                                                                                                                                                                                                                |
| **A vehicle document create path**                                                               | `/api/v1/vehicles/{id}/documents` is read-only; no create operation exists. Recorded as an integration finding rather than worked around                                                                                                                                                                                                                                                                                                  |
| **The fourteen progressive creation sections of the Owner's defect 6**                           | Most name fields whose backend contract this phase has not audited. This phase's own record contains four separate failures caused by guessing a contract — an invented `veh.vehicle.create` permission, an invented `ADDRESS_TYPES` list wrong in both directions, six invented enum vocabularies, and nine guessed fixture fields. That work belongs in a Frontend wave with contract archaeology in front of it                        |
| **Any implementation of the workshop journey or the vehicle catalogue**                          | Defects 10 and 11 are **documented, not implemented**. Eleven planning documents exist; none of it is built                                                                                                                                                                                                                                                                                                                               |
| **Any coverage percentage, effort estimate, service level, price, vendor cost or volume figure** | Nothing in the repository supplies one, and inventing one is forbidden by `docs/product/README.md` §0.1, whose second rule reads "No count, total, service level, vendor price or throughput figure is invented"                                                                                                                                                                                                                          |

---

## 12. Reconciliations — where the repository and its own documents disagree

Recorded rather than repeated, so a later reader does not close the gap by
editing whichever number is nearer to hand.

| #   | the repository says                                                                                                                                                                                                            | a document says                                                                                      | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The web suite is **803** cases in 39 files (command 8, run twice)                                                                                                                                                              | `owner-acceptance-fail-remediation.md` records **801**                                               | The difference is `p1-27-owner-acceptance.dom.test.tsx`: 34 declarations, 36 executed cases, because two are `it.each` over two locale directions. The measured figure is 803                                                                                                                                                                                                                                                                                                                                                       |
| 2   | `hostile-mutations.mjs` holds **20** `M-OA` identifiers                                                                                                                                                                        | The verification table records **19 / 19 caught**                                                    | `M-OA-06c`, the tablet-drawer mutation, is not in that table. Whether the matrix currently runs 20 / 20 is **not established** here — §13                                                                                                                                                                                                                                                                                                                                                                                           |
| 3   | `findings.md` puts the remaining `P1-27-INT-006` cursor sites at **10**                                                                                                                                                        | `findings/p1-27-int-006-cursor-precision.md` and `canonical-plan.md` §4.1 both say **16**            | 10 is current. The six vehicle-module sites were closed by `P1-27-INT-008`; the two subordinate documents pre-date that closure                                                                                                                                                                                                                                                                                                                                                                                                     |
| 4   | `crm.duplicate-scan` is not called by any file in `apps/web/src`; the duplicate warning is delivered on the **creation response**                                                                                              | `canonical-plan.md` §7 says `FE-003`'s warning "uses `crm.duplicate-list`"                           | The plan is stale. `task-register.md` and `findings.md` are correct. The gate's allow-list entry for `creation-actions.ts` under `no-duplicate-scan-on-a-queue` is currently **vacuous** — nothing there matches                                                                                                                                                                                                                                                                                                                    |
| 5   | `veh.vehicle-ownership-transfer`, `-plate-assign` and `-odometer-record` have no call site; neither does `crm.vehicle-link`                                                                                                    | `task-register.md` binds those three writes to `FE-021`…`FE-023`, and `crm.vehicle-link` to `FE-025` | The register overstates what those tasks consumed. The reads are consumed. The three vehicle writes are documented in `history-contract.ts`'s operation table and are not called. `crm.vehicle-link` is weaker still: it appears nowhere under `apps/web/src` except as a row in the generated `idempotent-operations.ts` table, so `FE-025` consumed it neither in code nor in a contract docblock                                                                                                                                 |
| 6   | **Four** measured case counts differ from the register: `crm-customer-search.test.ts` **40**, `vehicle-contract.test.ts` **25**, `p1-27-security.test.ts` **20**, `vehicle-screens.dom.test.tsx` **24**                        | `task-register.md` says 38, 22, 18 and 21 for the same four files                                    | The register is stale in four cells, not one. All four measured figures are command 8, run twice. The other nine evidence counts in that table match the repository exactly, so the staleness is per-cell and not a systematic offset                                                                                                                                                                                                                                                                                               |
| 7   | `apps/web/src/features/crm/permissions.ts` cites `apps/web/tests/crm.test.ts`                                                                                                                                                  | That file does not exist                                                                             | Already a carried finding in `findings.md`; still present. The assertion lives in `crm-customer-search.test.ts` and is `it.each`-driven                                                                                                                                                                                                                                                                                                                                                                                             |
| 8   | `execution-checkpoint.md` §5 lists 16 cursor sites; its §5 findings table omits `INT-007` and `INT-008`, though line 188 names both in the Wave 7 narrative; `INT-009` and `P1-27-F-001` appear nowhere in the file at all     | Its own line 140 says "See §9"; the file has no §8 and no §9                                         | Stale, with a dangling cross-reference. Waves 13–17b, the Owner-acceptance remediation and the installed-Chrome review appear in it only as rows in the wave-log table. The register of record for all four identifiers is `findings.md`, not this file                                                                                                                                                                                                                                                                             |
| 9   | `ci-evidence.md` and `clean-room-evidence.md` describe PR #198 at `e14984e`                                                                                                                                                    | There is no clean-room or hosted-CI evidence document for #200, #201 or #202                         | Those three carry two summary rows in `owner-acceptance-fail-remediation.md` and nothing more                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 10  | Four `planned` sidebar entries name permission codes that are **not seeded** — `appointments` → `apt.appointment.read`, `billing` → `sal.invoice.read`, `delivery` → `sal.delivery.read`, `documents` → `shared.document.read` | Only the `shared.document.read` case is registered anywhere, as `RMC-07`                             | Under the navigation file's own "unknown means denied" rule these four are invisible to every actor — the shape of `P1-26-F-011`. `navigation.ts` holds **20** `available` entries and **12** `planned`, both lists pinned key-by-key in `apps/web/tests/navigation.test.ts`; all 20 `available` entries resolve correctly, and eight of the twelve `planned` codes are seeded. Three of the four unseeded cases appear in no register, and this manifest raises no identifier for them: allocating one is the register owner's act |

---

## 13. What this manifest does not establish

| not established                                                                            | what would establish it                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| That the five merges in §4 are two-parent merge commits                                    | A `git` command, which this document's own production rules forbid. `owner-acceptance-fail-remediation.md` states it for #200 and #201; nothing in the repository states it for #198, #199 or #202                                                                                                                                                                                                                        |
| The pull-request number and hosted-CI result of **#199** and **#202**                      | The GitHub pull-request records, or a document in `docs/phase-1/phase-1-27/` naming them. The reflog establishes the branch, its head, the resulting `develop` SHA and the commit subjects — which is what §4.1 states their scope from — and no more                                                                                                                                                                     |
| Whether the `M-OA` matrix currently runs 20 / 20                                           | `node scripts/ci/hostile-mutations.mjs --only=M-OA`, not run here because it mutates tracked source in place                                                                                                                                                                                                                                                                                                              |
| Current case counts for `tests/backend` (80 files) and `tests/db` (138 files)              | A running local PostgreSQL. The 1636 / 1636 figure is recorded, not re-measured here                                                                                                                                                                                                                                                                                                                                      |
| Any definition — statement, owner, decision-maker or date — for `P1-OD-017` or `P1-OD-025` | The canonical Word documents outside the repository. `docs/` holds dispositions only; no file in `docs/` is a `P1-OD-###` register                                                                                                                                                                                                                                                                                        |
| A release group for this phase                                                             | No P1-25, P1-26 or P1-27 document records one. The Backend phases carry "Release 3 — Backend Foundation"; nothing extends that to the Frontend phases                                                                                                                                                                                                                                                                     |
| Any **global `RSK-##`** allocation for P1-27                                               | The phase allocates none. A phase risk register was written into the working tree while this manifest was being produced — untracked, §1.3 — and carries document-local `P1-27-R-##` identifiers only. The highest-numbered risk with a definition anywhere in `docs/` is still `RSK-27`; `RSK-31`, `RSK-44`, `RSK-45` and `RSK-52` are mentions without definitions. Issuing a global number is the register owner's act |
| Which Frontend phase owns documents, notifications, reporting or the parts surface         | A Product Owner scope decision. `docs/product/README.md` §6 states that no repository record names one                                                                                                                                                                                                                                                                                                                    |
| Whether any of the 176 planning findings is in Phase 1 scope                               | A Product Owner scope decision against the canonical Phase 1 plan                                                                                                                                                                                                                                                                                                                                                         |
| Whether the gate's allow-list entry for `crm.duplicate-scan` was ever exercised            | It matches nothing today; only the change history would say                                                                                                                                                                                                                                                                                                                                                               |

---

## 14. Closure condition

Everything in this manifest exists. **None of it closes the phase.**

Forty-two implementation tasks were complete, every automated tier was green, and
the product was rejected by hand in twenty minutes. Three remediations have since
merged and a second measured review has run in the Owner's own browser. That
raises the odds; it decides nothing.

> **P1-27 closes only when the Product Owner manually tests the running
> application in installed Chrome and returns an explicit
> `OWNER ACCEPTANCE: PASS`.**
>
> **Silence is not Pass.**

Only after that Pass is the documentation-only `P1-G27` gate record written, and
promotion to `main` is a separate act after that. Until then `P1-G27` does not
exist, `main` stays at `f085d82001a43de51725707426d5c10eb134c004`, and P1-28 has
not started.

---

## 15. Cross-document reconciliation

Five documents were written in one wave — this manifest, `open-decisions.md`,
`risk-register.md`, `evidence/task-traceability.md` and
`docs/product/workshop/frontend-implementation-program.md` — and a set written
in one wave agrees with itself for the same reason it can be wrong together.
They were therefore read against each other and against the repository, on
`develop` `19f370b982ebd7750612239154311f0036e5c34e`. **Where a document and the
repository disagreed, the repository won.** Nothing below closes anything.

### 15.1 What was checked, and what it cost to check

Every count in the table below was measured over the five documents **as they
stood before this section was appended**; a reconciliation that counted its own
prose would be reporting on itself.

| check                                                     | scope                                                                                                                               | result                                                                                                                                               |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every cited file, script and test **opened**              | **324** distinct path citations across the five documents                                                                           | All resolve, **except the seven cited precisely because they do not exist** — the six historical evidence filenames and `apps/web/tests/crm.test.ts` |
| Every markdown link followed                              | all relative links in the five                                                                                                      | 0 broken                                                                                                                                             |
| Every quoted lower-case string matched against source     | **254** quotations                                                                                                                  | **229** are test-case or gate titles present **verbatim** in the file named; the other 25 are quotations of prose, each located in its document      |
| Every permission-shaped code checked against the seed     | `supabase/seeds/04_iam_permission_catalog.sql`                                                                                      | **No invented permission code.** Six unseeded codes are cited, and each is cited _because_ it is unseeded                                            |
| Every operation id checked against the published contract | `docs/api/openapi.v1.json`                                                                                                          | **0** unresolved — every operation id in all five documents is one of the 243 published                                                              |
| Documentation line counts in §9                           | 26 files                                                                                                                            | **26 of 26 exact**                                                                                                                                   |
| Structural counts re-measured                             | migrations, `scripts/ci`, `apps/web/scripts`, `tests/ci`, router pages, Playwright specs, seeded codes, `M-OA` identifiers, OpenAPI | 119 · 40 · 4 · 31 · 28 · 9 · 104 · 20 · 243 operations / 203 paths / 152 mutations / **0** `requestBody` / 3 schemas — all as recorded               |
| §6.1's own arithmetic                                     | the 39 per-file case counts                                                                                                         | Sum **803**, matching the row total                                                                                                                  |

Two claims that look wrong and are right, recorded so nobody "corrects" them:

- A plain grep for `status: 'planned'` in `apps/web/src/config/navigation.ts`
  returns **13**, not the 12 this manifest, the risk register and the program all
  state. The thirteenth is in the module docblock, which **explains** the value.
  `apps/web/tests/navigation.test.ts:85-100` pins the real list at twelve keys.
  This is `P1-27-R-03` — a text scanner cannot tell code from prose about code —
  occurring inside the reconciliation of `P1-27-R-03`.
- `crm-and-vehicles.spec.ts` declares **nine** `test(...)` blocks and yields the
  **12** cases the risk register states: three of the nine sit inside `for` loops
  over two locales, two locales and two routes.

### 15.2 Where two documents contradicted each other, and which side was wrong

| #   | the disagreement                                                                                                                                                                                                                                                        | settled against the repository                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `open-decisions.md` §0.1: "`P1-OD-042` is merely the highest `P1-OD-` identifier _referenced_ anywhere in `docs/`". Its own §`P1-27-OD-001` says `provider-evaluation.md` §10 suggests **`P1-OD-043`**                                                                  | **§0.1 was wrong**, and the document refuted itself. `P1-OD-043` is referenced at `docs/product/vehicle-catalogue/provider-evaluation.md:486`. §0.1 and the closing table now say "highest number `docs/` treats as an existing decision", which is what is true — and the conclusion is unchanged and stronger |
| 2   | `evidence/task-traceability.md` §1: "**#202 is named by no P1-27 evidence document.** The only record of it is `deliverable-manifest.md` §4". `risk-register.md` §9: "It is **not** undocumented … `open-decisions.md:15-17` and `:806` name it again"                  | **The traceability document was wrong.** #202 is named in four P1-27 documents. What is genuinely absent is #202 from `owner-acceptance-fail-remediation.md`, and its **hosted-CI result** from everywhere. §1 now says that instead                                                                            |
| 3   | `open-decisions.md` §`P1-27-OD-002` cited four records for the fourteen-section count. **Three of the four line numbers pointed at unrelated lines** — `risk-register.md:190` is about `P1-OD-` identifiers, `deliverable-manifest.md:579` about acceptance permissions | **The citations were wrong, the claim was right.** Corrected to `risk-register.md:213-218`, `evidence/task-traceability.md:233`, `deliverable-manifest.md:608`. All five records still repeat the count and **none lists a single section**                                                                     |
| 4   | This manifest §4 said no repository document names PR **#199** or **#202**; `open-decisions.md`, `risk-register.md` and `evidence/task-traceability.md` all name #202                                                                                                   | **The manifest was imprecise.** The claim is true of **tracked** documents only; the four that name #202 are the four §1.3 records as untracked. Both rows now say so. Separately: `#199` and `#202` do appear in four P1-18 documents — as **workflow run numbers**, not pull requests                         |
| 5   | `risk-register.md` §4 and §9 cited `open-decisions.md:86-91` and `:798`                                                                                                                                                                                                 | Both moved when §0.1 was corrected. Re-pointed to `:93-98` and `:806`                                                                                                                                                                                                                                           |
| 6   | This manifest §6.4: "`tests/backend` 80 files present", "`tests/db` 138 files present"                                                                                                                                                                                  | **80 and 138 are the _test_ file counts; 85 and 142 files are present.** Corrected here and in `risk-register.md` §6.4                                                                                                                                                                                          |

### 15.3 The four questions this reconciliation was asked, answered

| question                                                                        | answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which task in `task-register.md` has **no row** in the traceability document?   | **None.** All 42 canonical tasks, `OA-01`…`OA-09` and `P1-27-INT-003` carry a row. **The gap runs the other way**, and it is worth stating: `task-register.md` never names `SEC-002`, `SEC-003`, `QA-002`, `QA-003` or `QA-004` individually — they exist only inside the ranges `SEC-001`…`SEC-004` and `QA-001`…`QA-005` — and it never names `DO-001`, `DO-002`, `DOC-001` or `DOC-002` **at all**, while its closing tally counts DevOps 2 / 2 and Documentation 2 / 2. That is the register's own stated defect ("a range is not searchable") applied to `FE-` ids and not to the rest. Not repaired here: the task register is not one of the five documents this reconciliation may edit                                                                       |
| Which finding in `findings.md` has **no disposition** anywhere in the five?     | Every **numbered** finding has one — `P1-27-INT-001`…`-009`, `P1-16-A-01`, `P1-16-A-02`, `P1-17-A-01`, `P1-17-A-02`, `P1-27-F-001`. Two survive only in the **program** document (`P1-27-INT-002`, `P1-27-INT-005`, §4.4), which is a planning record that authorises nothing. Of the **un-numbered** findings, four had no disposition anywhere: the CodeQL alert invisible from the branch ref; `&#8594;` read as a hex colour by `check-design-tokens.mjs`; the one transient `validate:upgrade-matrix` failure; and the creation form that discarded typed input. The **first** is a verification-method defect of the class `P1-27-R-04` exists to hold and is now recorded there; the other three are closed in code and are recorded here rather than promoted |
| Which of the 176 integration findings is **not reachable** from a work package? | **Nine were.** `DTA-05` and `DTA-06` were inside the range `DTA-04`…`DTA-07` in `WFP-08` — present but unsearchable, the exact defect the task register names. `VHM-16`, `VDP-05`, `VCAT-09`, `VCAT-10` and `MVE-10` were named by no package at all, though `docs/product/README.md` §3 gives each an owning phase or a P1-27 consumer; each has been added to the package its own register row points at. `PPD-07` and `VDP-10` carry **no** package deliberately — one is a Backend-internal invariant with no screen obligation, the other a governance gap dispositioned as `P1-27-OD-001` — and the program now says so in §3.0.1. A text search over §3 of the program now reaches **all 176**                                                                 |
| Where does any document imply closure, authorisation or scheduling?             | **Nowhere, after one change.** Every hit on closure, authorisation and scheduling language across the five was a negation ("authorises nothing", "does not close, promote, schedule or fund anything", "none scheduled"), a domain term (an _authorised_ reception, an _authorised-party_ relationship, an _approved_ work order), or a quotation of the Owner's own question. The single exception was `open-decisions.md` §`P1-27-OD-002`, whose consequence table said a Frontend wave "is scheduled" if the Owner requires the section model; it now says the wave becomes **buildable** and that sequencing it is a separate Owner act                                                                                                                           |

### 15.4 What remains open after this reconciliation

| open                                                                                                   | what would close it                                                                                                      |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| The hosted-CI result of **#199** and **#202**, and the parent count of **#198**, **#199** and **#202** | The GitHub pull-request records. A reflog shows neither                                                                  |
| Whether the `M-OA` matrix currently runs **20 / 20**                                                   | `node scripts/ci/hostile-mutations.mjs --only=M-OA`. It mutates tracked source in place and was not run for this reading |
| A clean room and a hosted-CI evidence document for **#200**, **#201** and **#202**                     | Running each, and recording it. `ci-evidence.md` and `clean-room-evidence.md` still describe #198 only                   |
| The nine tasks `task-register.md` does not name individually                                           | An edit to that register, in a change that owns it                                                                       |
| Any definition of `P1-OD-017` or `P1-OD-025`                                                           | The canonical Word documents outside this repository                                                                     |
| Whether any of the 176 planning findings is in Phase 1 scope                                           | A Product Owner scope decision                                                                                           |
| Current case counts for `tests/backend` (80 test files) and `tests/db` (138 test files)                | A running local PostgreSQL                                                                                               |
| A mutation for `OA-05`, and whether the `creation-actions.ts` allow-list entry was ever exercised      | Unchanged by this reconciliation — `evidence/task-traceability.md` §12 and `risk-register.md` §10 still record both      |

**None of this is acceptance.** Reconciling documents against each other makes
the record honest; it says nothing about whether the product works. **P1-27
closes only when the Product Owner manually tests the running application and
returns an explicit `OWNER ACCEPTANCE: PASS`. Silence is not Pass.**
