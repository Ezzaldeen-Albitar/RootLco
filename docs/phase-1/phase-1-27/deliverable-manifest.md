# Phase 1-27 — deliverable manifest

**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Status:** P1-27 **CLOSED** — `OWNER ACCEPTANCE: PASS`, 2026-08-12
([`closure-record.md`](closure-record.md)); not promoted, P1-28 not begun ·
**Recorded:** 2026-08-06, status updated 2026-08-12

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
| 2   | `node scripts/ci/check-p1-27-frontend.mjs`                                                                                                                                                                                                                                        | `69 file(s) across 3 tree(s), 0 failure(s)`                                                                                                 |
| 3   | `node scripts/ci/check-plain-language.mjs`                                                                                                                                                                                                                                        | `2 catalogue(s), 24 rule(s), 0 finding(s)`                                                                                                  |
| 4   | `node scripts/check-tailwind-theme.mjs` (from `apps/web`)                                                                                                                                                                                                                         | `170 file(s) checked, 54 colour(s) registered, 0 unresolvable`                                                                              |
| 5   | `node scripts/check-design-tokens.mjs` · `check-brand-isolation.mjs` · `check-api-boundary.mjs` (from `apps/web`)                                                                                                                                                                 | `195 / 0`, `197 / 0`, `170 / 0`                                                                                                             |
| 6   | `node scripts/ci/check-command-coverage.mjs`                                                                                                                                                                                                                                      | `143 registered command(s), 71 required · reachable 71/71 · invoked by hosted CI 71/71`                                                     |
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

### 1.1.1 Which of those outputs are SUPERSEDED — `E-10`

The table above records what each command printed **on the run that produced this
manifest**, and it is kept in that form because a production record that is
edited afterwards stops recording the production. But it was presented as if it
were current, and eight of the sixteen outputs no longer are. That is `E-10`, and
this is the marker it was missing.

**A superseded row is not a wrong row. It is a row with a date.** The current
value is stated beside it only where this repository can derive one; where it
cannot, that is said instead of guessed.

| #   | what it printed then                   | what it prints now                     | how the current value is held true                                  |
| --- | -------------------------------------- | -------------------------------------- | ------------------------------------------------------------------- |
| 2   | `69 file(s) across 3 tree(s)`          | `123 file(s) across 5 tree(s)`         | derived — §3 and §5.1                                               |
| 4   | `170 file(s) checked`                  | `179 file(s) checked`                  | re-run; the colour count is unchanged at 54                         |
| 5   | `195 / 0`, `197 / 0`, `170 / 0`        | `204 / 0`, `206 / 0`, `179 / 0`        | re-run; all three still report zero                                 |
| 6   | `143 registered · 71 required · 71/71` | `159 registered · 81 required · 81/81` | derived — §7.1                                                      |
| 8   | `39 files, 803 passed`                 | `98` files; case total NOT restated    | the file half derived — §3 and §6.1; the case half is `E-03`        |
| 9   | `77 files, 1680 passed`                | `96 files, 2398 passed`                | recorded, not derived — §6.4 says why                               |
| 10  | `31 files, 638 passed`                 | `47 files, 1216 passed`                | the file half derived — §6.4                                        |
| 11  | `150 tests in 2 files`                 | **not re-measured**                    | needs a browser install; unchanged as far as any record here states |
| 12  | `331 tests in 9 files`                 | **not re-measured**                    | the same                                                            |

Commands 1, 3, 7, 13, 14, 15 and 16 print what they printed. Command 7 still
reports `243 published operation(s), 120 idempotent`, and command 13 still reads
243 operations across 203 paths with exactly three component schemas.

### 1.2 Anchors

| anchor                     | value                                                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| protected `origin/develop` | `19f370b982ebd7750612239154311f0036e5c34e`                                                                                                                                      |
| working branch             | `docs/p1-27-registers-and-program`, head `9de1a3c3940722097d8f630dd8c7bfc180881da6` — **one documentation commit ahead of `develop`**, and carrying untracked documents besides |
| that commit                | `docs(p1-27): correct an overstatement, and measure the drawer`, read from `.git/logs/refs/heads/docs/p1-27-registers-and-program`                                              |
| protected `origin/main`    | `f085d82001a43de51725707426d5c10eb134c004` — **untouched by this phase**                                                                                                        |
| migrations on the branch   | **120** `.sql` files under `supabase/migrations`                                                                                                                                |
| published API surface      | **243** operations across **203** paths                                                                                                                                         |
| `P1-G27` gate record       | **does not exist**, and must not be created — §11                                                                                                                               |

### 1.3 What a reader should reconcile against

The authority for §5 is command 2: `validate:p1-27-frontend` walks
`apps/web/src/features/crm`, `apps/web/src/features/vehicles` and
`apps/web/src/app/[locale]/(dashboard)` and reports the file count it inspected. The authority for §6 is commands 8 to 12. The authority
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

**P1-27 is closed — `OWNER ACCEPTANCE: PASS`, 2026-08-12** (`closure-record.md`).
The sentence that stood here — the phase is open — was true from the 2026-08-06
refusal until that acceptance. The Product Owner manually tested the merged application and
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

**Every count in this table is DERIVED**, except the four rows that say
otherwise. `validate:p1-27-doc-counts` recomputes each from the tree and fails
the build if this table disagrees. The markers that bind them sit at the foot of
this document, outside every table.

That is not decoration either. The ownership gate has since walked a third tree
— the prediction this paragraph was written to anticipate — and the first row of
this table had been hand-copied into four documents. A number hand-corrected
today is stale on the commit that lands the change; the derived markers followed
the gate from 43 to 69 without a hand edit, and the prose that restated the same
fact in words did not, which is the gap this revision closes.

| category                                                               | artefacts                                                          | how counted                                                                |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Source files under the P1-27 ownership gate                            | **111** (43 feature source + 34 route + 34 adopted reception)      | derived from the gate's own scan roots                                     |
| Router pages (CRM and Vehicle)                                         | **8**                                                              | command 1                                                                  |
| Shared-foundation source files changed by the phase or its remediation | **13** named in §5.5                                               | command 1, cross-read against the task register and the remediation record |
| Web unit and component test files                                      | **102**                                                            | derived                                                                    |
| Playwright specification files                                         | **9** (2 anonymous, 7 authenticated)                               | commands 11 and 12 — **not re-measured**, §1.1.1                           |
| Root CI-contract test files                                            | **46**                                                             | derived                                                                    |
| CI gate scripts under `scripts/ci`                                     | **59** in the directory, **8** introduced or changed by this phase | derived; the eight are the `scripts/ci` rows of §7.1                       |
| Web gate scripts under `apps/web/scripts`                              | **4** in the directory, **1** introduced by this phase             | derived                                                                    |
| Phase documentation under `docs/phase-1/phase-1-27`                    | **38** tracked, of which **30** are `.md`                          | derived from `git ls-files` — see §9.1                                     |
| Product planning documentation under `docs/product`                    | **13** tracked                                                     | derived from `git ls-files` — see §9.2                                     |
| Local acceptance tooling under `scripts/dev/owner-acceptance`          | **8**                                                              | command 1                                                                  |
| Mutation identifiers in the `M-OA` family                              | **20**                                                             | command 1, reading `scripts/ci/hostile-mutations.mjs`                      |
| Migrations added                                                       | **0** — the count stays at 120                                     | derived                                                                    |

The two documentation rows read **15** and **11** until this revision, against a
tracked listing that returns 34 and 13 (`E-07`). Both were true of the moment
§1.3 describes — a branch on which four of the phase documents and one product
document were still untracked — and neither said which moment it belonged to.
They are derived now, so the question cannot arise again.

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

### 5.1 The five trees the P1-27 ownership gate owns — 126 files

`validate:p1-27-frontend` reports **126 files across 5 trees, 0 failures**. Of
those, **43** are §5.2 and §5.3 together — the two feature trees — and both
halves are derived from the trees the gate itself names, so the count follows the
gate rather than a reader's memory of it. The next **34** are the third
canonical tree, `apps/web/src/app/[locale]/(dashboard)`, which this manifest
tables nowhere: §5.4 lists the eight CRM and Vehicle route pages only, and the
other route files belong to earlier phases or to P1-28. The last **47** are the
two trees P1-28 adopted: **9** in `apps/web/src/features/appointments`, added
when `P1-28-DO-001` found that the P1-28 plan names three Frontend trees and the
gate had adopted only one of them, and **38** in
`apps/web/src/features/receptions`, which is not a P1-27 tree at all either: P1-28
ADOPTED these rules for it (`ADOPTED_ROOTS` in the gate, declared by
`phase-1-28/canonical-plan.md` §9), because `no-upload-path` and
`no-invented-media-limit` enforce the standing `P1-OD-025` disposition rather
than a P1-27 one, and while no root collected that tree both reported clean over
a tree they had never opened. Every one of these files is counted here because
the gate scans it, not because this phase wrote it. The gate refuses to pass a
rule that inspected zero files, and it runs its own `selfTest()` on **every**
invocation — a comment stripper that over-matched would turn all eight rules into
scans over empty strings and report clean, which is the one failure mode the
per-rule anti-vacuity checks cannot see.

This sentence said **40** until this revision, in the document whose own
`DOC-001` fix had corrected that number everywhere except inside itself
(`E-05`). Three more copies of it survived in `open-decisions.md` and
`risk-register.md`; all are derived now.

### 5.2 CRM — `apps/web/src/features/crm/` (20 files)

<!-- derived: rows crm-source = 20 -->

| path                                              | carries                                                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `permissions.ts`                                  | The CRM permission codes the screens gate on                                                          |
| `customers/action-support.ts`                     | The shared write path every CRM action goes through — `write()` and `client.send`                     |
| `customers/profile-actions.ts`                    | `crm.contact-add`, `crm.address-add` — the two profile writes, outside the governance six             |
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

**Three rows were missing until this revision** — `action-support.ts`,
`profile-actions.ts` here and `write-support.ts` in §5.3. The two headings were
right and the two tables were short, so the document contradicted itself by
counting (`E-04`). Both tables are now pinned to their own row count, so a row
cannot be dropped without the build noticing.

### 5.3 Vehicle — `apps/web/src/features/vehicles/` (23 files)

<!-- derived: rows vehicle-source = 23 -->

| path                                            | carries                                                                                                                                                                                                                |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api.ts`                                        | `veh.vehicle-search`, `veh.vehicle-create` (permission **`veh.vehicle.manage`**)                                                                                                                                       |
| `write-support.ts`                              | The vehicle tree's own write path — the counterpart of the CRM `action-support.ts`                                                                                                                                     |
| `catalogue-api.ts`                              | The five catalogue reads — makes, models, trims, body types, powertrain types                                                                                                                                          |
| `contract.ts`                                   | `normalizeCriteria` over a frozen `CRITERIA_KEYS` list into an `Object.create(null)` target                                                                                                                            |
| `documents-api.ts`                              | `veh.vehicle-document-list`, gated on **`shared.document.manage`**                                                                                                                                                     |
| `documents-contract.ts`                         | The document reference shape — a reference and nothing else. Held `MEDIA_STATUS = 'blocked-on-p1-od-025'` while **`P1-OD-025`** was open; the decision is RESOLVED and both constants are now a tombstone in that file |
| `duplicates-api.ts`                             | `veh.vehicle-duplicate-list`, `veh.vehicle-duplicate-review`, `veh.vehicle-history`                                                                                                                                    |
| `duplicates-contract.ts`                        | Candidate and attribute-history shapes                                                                                                                                                                                 |
| `history-api.ts`                                | Ownership, plate and odometer history reads                                                                                                                                                                            |
| `history-contract.ts`                           | Their shapes                                                                                                                                                                                                           |
| `profile-api.ts`                                | `veh.vehicle-read`, `veh.vehicle-update`, `veh.vehicle-status-change`, and the VIN-uniqueness probe                                                                                                                    |
| `profile-contract.ts`                           | The vehicle detail shape, including `recordVersion`                                                                                                                                                                    |
| `relations-api.ts`                              | EV profile read and set; relationships; authorised-party add and retire                                                                                                                                                |
| `relations-contract.ts`                         | Their shapes                                                                                                                                                                                                           |
| `components/VehicleSearchScreen.tsx`            | Vehicle search — exact VIN, plate and vehicle number, no substring                                                                                                                                                     |
| `components/VehicleCreateScreen.tsx`            | Creation with dependent catalogue selectors                                                                                                                                                                            |
| `components/VinField.tsx`                       | Format validation at the edge; the server's uniqueness verdict                                                                                                                                                         |
| `components/VehicleProfileScreen.tsx`           | The profile and its tabs                                                                                                                                                                                               |
| `components/VehicleHistorySections.tsx`         | Ownership, plate, odometer                                                                                                                                                                                             |
| `components/VehicleRelationsSections.tsx`       | EV/hybrid information and vehicle-customer relationships                                                                                                                                                               |
| `components/VehicleDocumentsSection.tsx`        | The document list, permission checked **before** the read is issued                                                                                                                                                    |
| `components/VehicleAttributeHistorySection.tsx` | The attribute-change ledger — not a timeline                                                                                                                                                                           |
| `components/VehicleDuplicateReviewScreen.tsx`   | The vehicle duplicate queue                                                                                                                                                                                            |

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

These sit outside all three gate-owned trees and are named individually, because
a manifest that listed only the gate-owned files would omit the fixes the Owner
actually asked for. They are also the reach the gate still does not have:
`components/`, `lib/`, `config/`, `styles/` and `i18n/` are unscanned by it.

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

### 5.7 What no source file in any of the three gate-owned trees contains

Eight rules, each enforced by `check-p1-27-frontend.mjs` and each pinned by a
planted violation. This heading named §5.2 and §5.3 only; the gate now scans
§5.4's tree as well — all **69** files, not the 43 of the two feature trees — so
every rule below is refused across the route pages too.

It said **six** until `SEC-002`'s export and media conjuncts were moved into the
gate. Of that task's five conjuncts, only `file-access` had a rule behind it, and
that rule covered three of the seven constructs `apps/web/tests/p1-27-security
.test.ts` refuses on the same surface — so export, media and four of the seven
file-access constructs were held by one deletable test file. The last three rows
below are what changed.

| rule                           | what it refuses                                                                                                                                                                                                                 | why it exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no-merge-caller`              | Any call to `crm.customer-merge` or `veh.vehicle-merge`                                                                                                                                                                         | **`P1-OD-017` — duplicate and merge rules — is an OPEN Owner decision.** The affordance is _absent_, not disabled: a disabled control asserts that the capability exists and that this operator lacks permission, which is a different and false statement. Both review screens say so in a sentence. Wave 6 shipped a working merge form; it was removed, and the gate exists because a green suite did not stop it                                                                                                                                                                                                                                                                |
| `no-duplicate-scan-on-a-queue` | Any call to `crm.duplicate-scan` or `veh.vehicle-duplicate-scan` from a review surface                                                                                                                                          | Each reads like a query and is a privileged audited **write** that creates candidate rows and is throttled at 30/min. A queue that "refreshed" by scanning would write audit history every time an operator opened it                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `no-client-asserted-scope`     | `tenantId`, `companyId`, `branchId` and their snake_case forms, **asserted** rather than displayed                                                                                                                              | Scope is resolved server-side from the session on every operation these screens call. The rule is positional because adding §5.4's tree brought in `profile/page.tsx`, which renders the tenant the server resolved — a display, not an assertion                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `no-invented-total`            | `total: rows.length` and its variants                                                                                                                                                                                           | Every list is `{ items, nextCursor, hasMore }` with **no total**. A count derived from a page is correct on page one and wrong from page two, invisibly                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `no-upload-path`               | Seven constructs: `new FormData(` with or without an argument, `multipart/form-data`, a file input in any spelling, `FileReader`, an `input.files` list, an `onDrop=`/`onDragOver=` target, a `DataTransfer`                    | **`P1-OD-025` — vehicle document and media file policy — is an OPEN Owner decision FOR THIS TREE.** It was resolved for reception evidence, and for nothing this rule scans: there is no vehicle media operation in the platform at all, and no vehicle document category exists. `MEDIA_STATUS` held `'blocked-on-p1-od-025'` and is now a tombstone in `documents-contract.ts` (see the row above), which does not change what the rule refuses here. It refused three constructs until the security suite's own list was read: every drag-and-drop upload is built out of the last three and none of them needs an `<input type="file">`                                         |
| `no-export-surface`            | `shared.export-authorize`, `shared.export-catalogue`, an `/exports` path, an `exportSomething` caller, `attachment-download`, `download=`, `createObjectURL`, `new Blob(`, `text/csv`, `application/pdf`, `Content-Disposition` | **P1-27 publishes no export surface**, and §6 of the canonical plan records it: the task table names the operation behind all 29 Frontend tasks and none of them is an export. The platform DOES publish both export operations, so the absence is a decision rather than a gap. Both routes are refused, because bulk extraction assembled in the browser out of pages read one at a time is the same disclosure without the operation                                                                                                                                                                                                                                             |
| `no-invented-media-limit`      | A `MAX_FILE_SIZE_`-style constant, byte arithmetic such as `10 * 1024`, an accepted-MIME list, an extension allow-list, an `accept=` attribute                                                                                  | **`P1-OD-025` is OPEN for every surface this rule scans** — it was resolved for reception evidence only — and §14's disposition is "keep upload acceptance blocked **and** do not invent limits". The reception capture reads its accepted types and its ceiling from the category the SERVER publishes, which is what this rule has always distinguished from a limit the application invents. `no-upload-path` enforces the second sentence; nothing enforced the third, and the third is the one broken by diligence rather than carelessness — a "sensible default" of 10 MB and JPEG/PNG is a policy the Owner has not decided, presented to an operator as though it had been |
| `no-console-output`            | Any `console.*` in a scanned tree — a feature module or a route page                                                                                                                                                            | Observability goes through the shared authority                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

**Neither duplicate queue shows a candidate count.** The read publishes
`{ items, nextCursor, hasMore }` and no total, so a count would be a fabricated
number on a screen whose entire purpose is a careful decision about two real
records.

---

## 6. Test files

### 6.1 Web unit and component — `apps/web/tests` (102 files, and no case total — `E-03`)

**`E-03` is closed by DELETING the number, not by correcting it.** The heading
used to read `(70 files, 1493 cases, 0 failed)`, and before that `(66 files, 1231
cases)`. The file half was derived; the case half was a hand-copied measurement
that nothing recomputed, sitting inside the same parenthesis as a checked number
and borrowing its credibility. It drifted exactly as the finding predicted: the
paragraphs below this heading still said `66` and `1231` while the heading beside
them said `70` and `1493` — `E-02` returning, in the section written to close it.

`91` is recomputed from the tree on every run, here and in §3, and
`p1-27-doc-reconciliation.test.ts` fails if either statement of it disagrees with
`apps/web/tests`.

**No tier-wide case total is stated anywhere in this document, because none can
be derived.** A case count is derived by counting `it(` / `test(` call sites in
comment-stripped source, and that number is only right for a file whose cases are
all written down. **Twenty-eight of the ninety-one files build theirs at runtime**
— `it.each` over a table, or an `it(` inside a `for` or an iteration callback —
so `scripts/ci/check-p1-27-doc-counts.mjs` refuses them rather than certify a
plausible wrong number: `api-client.test.ts`,
`appointment-detail.dom.test.tsx`, `appointments-contract.test.ts`,
`crm-customer-search.test.ts`, `crm-governance-writes.test.ts`,
`duplicate-review-writes.test.ts`, `field-error-translation.test.ts`,
`governance-write-validation.test.ts`, `money.test.ts`,
`operation-contract.test.ts`, `overlays.dom.test.tsx`,
`p1-27-owner-acceptance.dom.test.tsx`,
`p1-27-permission-route-binding.dom.test.tsx`,
`p1-28-appointment-routes.test.ts`, `p1-28-reception-routes.test.ts`,
`profile-accessibility.dom.test.tsx`, `reception-queue.dom.test.tsx`,
`reception-summary.dom.test.tsx`, `receptions-contract.test.ts`,
`route-permission-binding.test.ts`,
`server-vocabularies.test.ts`, `shell.dom.test.tsx`,
`stylelint-policy.test.ts`, `vehicle-api.test.ts`,
`vehicle-documents.test.ts`, `vehicle-duplicates.test.ts`,
`vehicle-party-identity.dom.test.tsx` and
`write-permission-gating.dom.test.tsx`. A total over 91 files that is unknowable
for 28 of them is not a measurement, it is an estimate with a decimal point.

**The derivable half is 63 files, and it is derived per file rather than summed.**
Each of the sixty-three carries an exact answer the gate recomputes; the three this
document actually cites are pinned by name at the foot of this file
(`vehicle-screens.dom.test.tsx`, `tailwind-theme-gate.test.ts`,
`navigation.test.ts`), and a citation that needs no count is written without one
(`G-07`, `G-08`, and §6.2 below). The executed total belongs to the runner and to
the floor that reads its report —
`.github/ci-baselines/test-count-baseline.json` and
`tests/ci/web-test-floor.test.ts`, which compare EXECUTED tests against a floor
and against what the tree declares on disk. That is where a reader should go for
it, and it is the only place it is held true.

**The per-file table below is SUPERSEDED and is kept as a snapshot, not a
status** (`MAN-04`). It records 39 files and 803 cases — the tier as it stood
when the manifest was written. Two earlier revisions stated 39/803 and then
64/1208 here while the heading beside them said something else — a stale number
is bad, and two stale numbers disagreeing on one page is worse (`E-02`). The
difference is entirely files this branch added while closing the
Owner-acceptance findings and five rounds of adversarial review.

A hand-maintained per-file table of a tier that grows every commit is stale on
arrival; it was already stale by 24 files and 386 cases before anyone noticed.
The headline totals above are what the reconciliation test now derives from a
live measurement, and `p1-27-doc-reconciliation.test.ts` fails if this heading
and the tier disagree. The rows are left because a snapshot that shows only the
final state cannot be checked against the run that produced it.

Original measurement, by command 8, run twice with identical results:

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

A case count appears below **only where a gate can derive it**. Five of these
eight files build cases at runtime, and the numbers this table used to state for
three of them — 40, 24 and 11 — were 41, 36 and 11 by the time anyone looked
(`G-07`). A citation does not need a count: the file and what it pins are the
claim, and the count was the only part that could rot.

| file                                                 | cases          | what it pins                                                                                                                                                                                                                                                          |
| ---------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/tests/p1-27-owner-acceptance.dom.test.tsx` | runtime-built  | All six frontend defects, in four blocks: the password reveal inside the field; the sidebar navigation, including the tablet drawer and an `AppShell` source assertion; customer creation offered where an operator looks; a duplicate candidate that explains itself |
| `apps/web/tests/crm-customer-search.test.ts`         | runtime-built  | The header creation actions (`M-OA-15`)                                                                                                                                                                                                                               |
| `apps/web/tests/vehicle-screens.dom.test.tsx`        | **36** derived | The vehicle match explanation, with a `<pre>` count of zero (`M-OA-13`)                                                                                                                                                                                               |
| `tests/ci/plain-language-gate.test.ts`               | runtime-built  | That `validate:plain-language` can still fail (`M-OA-16`, `M-OA-17`)                                                                                                                                                                                                  |
| `tests/ci/tailwind-theme-gate.test.ts`               | **8** derived  | That `validate:web-theme` can still fail (`M-OA-18`)                                                                                                                                                                                                                  |
| `tests/ci/eslint-global-ignores.test.ts`             | runtime-built  | `P1-27-F-001` — and the opposite failure too: `src/**`, `scripts/**`, `tests/**` and `**/*` must never appear in the ignore list                                                                                                                                      |
| `apps/web/tests/navigation.test.ts`                  | **22** derived | The exact `available` and `planned` lists, so drift in either direction fails                                                                                                                                                                                         |
| `apps/web/tests/server-vocabularies.test.ts`         | runtime-built  | Server vocabularies read out of the migrations and compared to both catalogues, in both directions                                                                                                                                                                    |

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

| tier                                                  | files                                           | cases                                                                                                                                                        | how measured                            |
| ----------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| `npm run test` — the root unit and contract aggregate | **96**                                          | **2398**                                                                                                                                                     | re-run; the file half is not derived    |
| of which `tests/ci`                                   | **46**                                          | **1202**                                                                                                                                                     | the file half derived; the cases re-run |
| `tests/backend`                                       | **86** test files (91 files in the directory)   | **not run here** — needs a running PostgreSQL                                                                                                                | both halves derived                     |
| `tests/db`                                            | **139** test files (143 files in the directory) | **not run here** — needs a running PostgreSQL. **Recorded** as 1636 / 1636 in [`owner-acceptance-fail-remediation.md`](owner-acceptance-fail-remediation.md) | both halves derived                     |

The root aggregate's file count is **not** derived, and the reason is worth
stating rather than leaving as an omission: `npm run test` is a vitest project
selection, not a directory, so the only honest source for it is the runner. The
two directory counts beside it are derived, and `tests/ci` at 36 supersedes the
31 this row carried in two places while a third said 33 (`E-08`).

The six `tests/ci` files this phase introduced or that carry its gates are
`p1-27-frontend-gate.test.ts`, `plain-language-gate.test.ts`,
`tailwind-theme-gate.test.ts`, `idempotent-operations-manifest.test.ts`,
`eslint-global-ignores.test.ts` and `documented-counts.test.ts`. **The counts
that used to follow those names are gone.** `p1-27-frontend-gate.test.ts` was
cited here as 26 and in `evidence/task-traceability.md` as 28, and 28 is what it
runs (`G-08`); it plants its violations with `it.each`, so no gate can derive
either number, and a number nothing derives is what produced the disagreement.
`tests/ci/p1-27-doc-counts.test.ts` was added by the same task and covers the
gate that keeps this document honest.

---

## 7. Continuous-integration gate scripts

### 7.1 Introduced or changed by P1-27 and its remediation

| script                                          | npm command                                          | owning task                | what it refuses                                                                                                                                                                                                                                                                                                                                                       | measured output                                                                           |
| ----------------------------------------------- | ---------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `scripts/ci/check-p1-27-frontend.mjs`           | `validate:p1-27-frontend`                            | `DO-001` (new)             | The eight rules in §5.7, over the three canonical trees — the two feature trees and the `(dashboard)` route tree — and over the adopted `features/receptions` tree (`ADOPTED_ROOTS`; `no-client-asserted-scope` alone is narrowed away from it, see §5.1). Comments are stripped first, a rule inspecting zero files fails, and `selfTest()` runs on every invocation | `69 file(s) across 3 tree(s), 0 failure(s)`                                               |
| `scripts/ci/check-plain-language.mjs`           | `validate:plain-language`                            | `OA-07` (new)              | 24 rules over every value in both message catalogues — JSON, UUID, enum, payload, null, boolean, object, schema, endpoint, API, design token, status code, token, cursor, idempotency, serialise, SQL, regex, tenant, permission code, operation id, snake_case identifier, camelCase identifier, raw translation key. **No exemptions**, and a two-way `selfTest()`  | `2 catalogue(s), 24 rule(s), 0 finding(s)`                                                |
| `apps/web/scripts/check-tailwind-theme.mjs`     | `validate:web-theme` (root) / `validate:theme` (web) | `OA-08` (new)              | A colour utility whose name resolves to no entry in `theme.extend.colors` and to no surviving Tailwind palette name                                                                                                                                                                                                                                                   | `170 file(s) checked, 54 colour(s) registered, 0 unresolvable`                            |
| `scripts/ci/generate-idempotent-operations.mjs` | `validate:idempotent-operations`                     | `P1-27-INT-003` (new)      | Drift between the published contract and the generated table                                                                                                                                                                                                                                                                                                          | `243 published operation(s), 120 idempotent` — manifest matches                           |
| `scripts/ci/hostile-mutations.mjs`              | none — hand-run                                      | changed by `OA-*`          | The 20 `M-OA` mutations in §8                                                                                                                                                                                                                                                                                                                                         | not re-run here; it mutates tracked source in place                                       |
| `eslint.config.mjs`                             | `lint` → `verify:repository`                         | `P1-27-F-001` (changed)    | `globalIgnores` gained `'supabase/.temp/**'` and `'supabase/.branches/**'`                                                                                                                                                                                                                                                                                            | covered by `tests/ci/eslint-global-ignores.test.ts`                                       |
| `scripts/ci/check-command-coverage.mjs`         | `validate:command-coverage`                          | changed — registry entries | A required command not reachable from `verify:workspaces` **and** not invoked by hosted CI                                                                                                                                                                                                                                                                            | **159 registered · 81 required · 81/81 reachable · 81/81 invoked by hosted CI** — derived |
| `scripts/ci/build-p1-27-evidence-manifest.mjs`  | `validate:p1-27-evidence` / `evidence:p1-27`         | `QA-005` (new)             | An evidence document edited without its SHA-256 digest being regenerated in the same commit. Digests are over file BYTES, so a BOM or an encoding repair counts as a change. The `--check` half is required; the writer is deliberately optional, because a CI job that ran it would repair the drift the check exists to report                                      | `39 evidence document(s), in sync`                                                        |
| `scripts/ci/check-p1-27-lifecycle.mjs`          | `validate:p1-27-lifecycle`                           | closure lifecycle (new)    | A declared lifecycle state the tree does not hold, in either direction: a blocker the ledger does not declare, and a declared blocker the tree no longer raises. Eight negative cases run inside the gate on every invocation, so a rule that stopped refusing a transition fails rather than passing quietly                                                         | `CANDIDATE_INCOMPLETE` — merge blocked, 23 blocker(s), 0 disagreement(s)                  |
| `scripts/ci/check-p1-27-closing-values.mjs`     | `validate:p1-27-closing-values` / `record:p1-27-run` | `QA-005` (new)             | A closing value on either evidence page that names no authority: an unclassified figure, a locally derivable one the tree contradicts, a hosted one naming no run or job, a protected-only one carrying a figure before the merge, an excluded one sitting in a current region. Thirteen negative cases run inside the gate on every invocation                       | `58 classified, A:12 B:8 C:23 D:4 E:10 F:1` — five counts all zero                        |

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

### 9.1 Phase documentation — `docs/phase-1/phase-1-27/` (41 tracked files)

**This table used to list fifteen of them, and eight of its fifteen line counts
were wrong** — under a row in §15.1 asserting "26 of 26 exact" (`E-06`, `E-07`).
Both halves of that are the same defect: a hand-kept list of a directory that
kept growing. The list is the tracked listing now, and every line count carries a
marker the build recomputes.

`.json` records are included. They are evidence in this phase exactly as the prose
is — `evidence-manifest.json` digests the directory, `task-matrix.json` carries
the canonical ids — and a documentation set that counted only Markdown would
under-report itself by seven files.

<!-- derived: linecolumn phase-documentation = 0 -->
<!-- derived: rows phase-documentation = 40 -->

| path                                              | lines | what it is                                                                         |
| ------------------------------------------------- | ----- | ---------------------------------------------------------------------------------- |
| `adversarial-round-five.md`                       | 857   | The live finding register; its totals are derived from its own rows                |
| `closure-record.md`                               | 114   | The closure — `OWNER ACCEPTANCE: PASS`, 2026-08-12; what it does and does not do   |
| `adversarial-round-four.md`                       | 147   | The previous round, superseded by round five                                       |
| `blocker-remediation-plan.md`                     | 545   | What blocked the phase, and how each blocker was cleared                           |
| `canonical-plan.md`                               | 340   | What P1-27 is scoped to build, and the disposition of `P1-OD-017` and `P1-OD-025`  |
| `canonical-write-reachability.json`               | 66    | Every write operation classified reachable or deliberately absent, with a decision |
| `ci-evidence.md`                                  | 275   | Hosted CI, with every value classified and every hosted one naming its run         |
| `clean-room-evidence.md`                          | 379   | The clean-room record, and the six classes every closing value is sorted into      |
| `contract-archaeology.md`                         | 416   | What the Backend actually publishes, read before anything was built                |
| `deliverable-manifest.md`                         | 1051  | This file                                                                          |
| `developer-guide.md`                              | 228   | `DOC-002` — the developer half                                                     |
| `evidence/change-log.md`                          | 1135  | `DOC-002` — the change-log half; its rows are scraped by a test                    |
| `evidence/evidence-manifest.json`                 | 171   | `QA-005` — a SHA-256 digest of every document in this directory                    |
| `evidence/closing-value-ledger.json`              | 907   | Every closing value on the two evidence pages, classified, with its authority      |
| `evidence/lifecycle-ledger.json`                  | 72    | The closure lifecycle's observations and the state this repository declares        |
| `evidence/local-run-ledger.json`                  | 30    | What a tier DID when it was run — written only by `record:p1-27-run`               |
| `evidence/task-traceability.md`                   | 437   | Every task, the operations it calls, the files it produced, the named proof        |
| `evidence/test-catalogue-traceability.md`         | 406   | `DOC-001` — the 29 canonical `TC-P1-27-*` ids bound to executable tests            |
| `evidence/test-catalogue-traceability.json`       | 863   | Its machine-readable form, checked by `validate:p1-27-doc-counts`                  |
| `execution-checkpoint.md`                         | 290   | Base SHAs, surface baselines, the wave log                                         |
| `final-canonical-remediation.md`                  | 451   | The canonical remediation wave                                                     |
| `final-task-adjudication.md`                      | 959   | The 33 adjudicated audit items, and the retraction of `42 / 42`                    |
| `finding-phase-disposition.md`                    | 511   | Which phase owns each finding                                                      |
| `finding-task-map.json`                           | 536   | Findings to tasks, machine-readable                                                |
| `findings.md`                                     | 889   | The live `P1-27-INT-###` register                                                  |
| `findings/p1-27-int-006-cursor-precision.md`      | 166   | The cursor-precision finding in full                                               |
| `independent-task-audit.md`                       | 137   | The 42-task independent audit, superseded by the adjudication                      |
| `installed-chrome-review.md`                      | 215   | The measured review in the Owner's own Chrome, first and second passes             |
| `open-decisions.md`                               | 1205  | `P1-OD-017`, `P1-OD-025` and the phase's own open questions                        |
| `operator-guide.md`                               | 205   | `DOC-002` — the operator half                                                      |
| `owner-acceptance-checklist.md`                   | 128   | What the Owner is asked to test                                                    |
| `owner-acceptance-fail-remediation.md`            | 198   | The `OWNER ACCEPTANCE: FAIL` result and the disposition of all eleven defects      |
| `p1-27-int-113-unregistered-rate-limit-policy.md` | 149   | Six shipped operations that answered 500 to every request                          |
| `preflight/final-readiness.json`                  | 218   | The machine-readable readiness record                                              |
| `preflight/final-readiness.md`                    | 169   | The 9/9 readiness record                                                           |
| `reception-read-surface-plan.md`                  | 602   | The reception read surface — planned here; executed by `83c055d` (2026-08-12)      |
| `risk-register.md`                                | 587   | The phase's document-local `P1-27-R-##` risks                                      |
| `task-matrix-verdicts.json`                       | 1094  | Per-task verdicts, machine-readable                                                |
| `task-matrix.json`                                | 1487  | The canonical 42-task matrix, machine-readable                                     |
| `task-register.md`                                | 299   | Every task with its contract, evidence and SHA, plus `OA-01` … `OA-09`             |

`docs/engineering/ci-automation/pull-request-body.md` was also updated under
`DOC-001`, because adding one file to `scripts/ci` made its stated inventory
wrong; `tests/ci/documented-counts.test.ts` named the exact phrase that had to
change.

### 9.2 Product planning — `docs/product/` (13 tracked files)

Produced by `OA-09`, against the Owner's defects 10 and 11. Eleven were merged in
#200; the two that were untracked when §1.3 was written —
`owner-workflow-requirements.md` and `workshop/frontend-implementation-program.md` —
are tracked now, and this row said **11** until they were counted (`E-07`).
**Planning and traceability only. Nothing in this set is implemented, and every
document says so in its own header.**

<!-- derived: linecolumn product-documentation = 0 -->
<!-- derived: rows product-documentation = 13 -->

| path                                                  | lines |
| ----------------------------------------------------- | ----- |
| `README.md` — the index and the consolidated register | 443   |
| `owner-workflow-requirements.md`                      | 356   |
| `workshop/end-to-end-workshop-workflow.md`            | 1244  |
| `workshop/frontend-implementation-program.md`         | 954   |
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

| absent                                                                                           | why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A gate record `P1-G27`**                                                                       | It does not exist in `docs/phase-1/phase-1-27/`, and it must not be created. The documentation-only gate record is written **only after** the Product Owner returns an explicit Pass. Writing it now would be the P1-26 mistake repeated: that phase was closed once on five unproven claims and had to be reopened                                                                                                                                                                              |
| **Any promotion to `main`**                                                                      | `origin/main` is `f085d82001a43de51725707426d5c10eb134c004` and is untouched by this phase. Promotion is a separate, later act with its own pull requests and its own gate, and it is not part of closing anything                                                                                                                                                                                                                                                                               |
| **Any migration**                                                                                | The count on the branch is **120**, exactly what protected `develop` already carries. `MIGRATION_DIFF=0` and `SUPABASE_DIFF=0` are required at merge. **This row said 119 and "There is no migration 120"; both were false.** Migration 120 is `P1-27-INT-013`, the custody-release fix — a **Backend** change merged through `develop` as PR #204, so it is correctly no part of this Frontend phase's diff, and the boundary this row states is intact. The number was wrong, not the boundary |
| **Any Backend change in any Frontend branch**                                                    | `apps/api` is Backend only; `apps/web` is Frontend only. `APPS_API_EXECUTABLE_DIFF=0` is required at merge and the changed-file ownership gate enforces it. The six Backend defects this phase found were fixed on **Backend branches** — `P1-27-INT-001`/`-002`/`-005`/`-006` before the feature branch existed, and `-007`/`-008` on a P1-17 branch during it — each with its own finding id, its own tests and its own protected merge                                                        |
| **Any P1-28 artefact**                                                                           | P1-28 has not started. `P1_28_FILES=0` is a recorded boundary value of this phase                                                                                                                                                                                                                                                                                                                                                                                                                |
| **A candidate count on either duplicate queue**                                                  | The read publishes no total. See §5.7                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **A merge affordance anywhere**                                                                  | `P1-OD-017` is open. Absent, not disabled                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Any upload path**                                                                              | No vehicle media operation exists in the platform, and `P1-OD-025` is open for vehicle documents (it was resolved for reception evidence only)                                                                                                                                                                                                                                                                                                                                                   |
| **A vehicle document create path**                                                               | `/api/v1/vehicles/{id}/documents` is read-only; no create operation exists. Recorded as an integration finding rather than worked around                                                                                                                                                                                                                                                                                                                                                         |
| **The fourteen progressive creation sections of the Owner's defect 6**                           | Most name fields whose backend contract this phase has not audited. This phase's own record contains four separate failures caused by guessing a contract — an invented `veh.vehicle.create` permission, an invented `ADDRESS_TYPES` list wrong in both directions, six invented enum vocabularies, and nine guessed fixture fields. That work belongs in a Frontend wave with contract archaeology in front of it                                                                               |
| **Any implementation of the workshop journey or the vehicle catalogue**                          | Defects 10 and 11 are **documented, not implemented**. Eleven planning documents exist; none of it is built                                                                                                                                                                                                                                                                                                                                                                                      |
| **Any coverage percentage, effort estimate, service level, price, vendor cost or volume figure** | Nothing in the repository supplies one, and inventing one is forbidden by `docs/product/README.md` §0.1, whose second rule reads "No count, total, service level, vendor price or throughput figure is invented"                                                                                                                                                                                                                                                                                 |

---

## 12. Reconciliations — where the repository and its own documents disagree

Recorded rather than repeated, so a later reader does not close the gap by
editing whichever number is nearer to hand.

| #   | the repository says                                                                                                                                                                                                            | a document says                                                                                      | disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The web suite was **803** cases in 39 files when this row was written, and the tier is **72 files** now                                                                                                                        | `owner-acceptance-fail-remediation.md` records **801**                                               | The 801/803 difference was `p1-27-owner-acceptance.dom.test.tsx`: 34 declarations, 36 executed cases, because two are `it.each` over two locale directions. **Every case figure in this row is superseded and this document no longer states a current one** — the file half is derived in §3 and §6.1, and §6.1 says why no tier-wide case total is derivable and where the executed total is actually held (`E-03`)                                                                                                               |
| 2   | `hostile-mutations.mjs` holds **20** `M-OA` identifiers                                                                                                                                                                        | The verification table records **19 / 19 caught**                                                    | `M-OA-06c`, the tablet-drawer mutation, is not in that table. Whether the matrix currently runs 20 / 20 is **not established** here — §13                                                                                                                                                                                                                                                                                                                                                                                           |
| 3   | `findings.md` puts the remaining `P1-27-INT-006` cursor sites at **10**                                                                                                                                                        | `findings/p1-27-int-006-cursor-precision.md` and `canonical-plan.md` §4.1 both say **16**            | 10 is current. The six vehicle-module sites were closed by `P1-27-INT-008`; the two subordinate documents pre-date that closure                                                                                                                                                                                                                                                                                                                                                                                                     |
| 4   | `crm.duplicate-scan` is not called by any file in `apps/web/src`; the duplicate warning is delivered on the **creation response**                                                                                              | `canonical-plan.md` §7 says `FE-003`'s warning "uses `crm.duplicate-list`"                           | The plan is stale. `task-register.md` and `findings.md` are correct. The gate's allow-list entry for `creation-actions.ts` under `no-duplicate-scan-on-a-queue` is currently **vacuous** — nothing there matches                                                                                                                                                                                                                                                                                                                    |
| 5   | `veh.vehicle-ownership-transfer`, `-plate-assign` and `-odometer-record` have no call site; neither does `crm.vehicle-link`                                                                                                    | `task-register.md` binds those three writes to `FE-021`…`FE-023`, and `crm.vehicle-link` to `FE-025` | The register overstates what those tasks consumed. The reads are consumed. The three vehicle writes are documented in `history-contract.ts`'s operation table and are not called. `crm.vehicle-link` is weaker still: it appears nowhere under `apps/web/src` except as a row in the generated `idempotent-operations.ts` table, so `FE-025` consumed it neither in code nor in a contract docblock                                                                                                                                 |
| 6   | **Four** measured case counts differ from the register: `crm-customer-search.test.ts` **41**, `vehicle-contract.test.ts` **25**, `p1-27-security.test.ts` **22**, `vehicle-screens.dom.test.tsx` **36**                        | `task-register.md` says 38, 22, 18 and 21 for the same four files                                    | The register is stale in four cells, not one. **Three of the four figures this row itself stated were also stale** — it said 40, 20 and 24 (`E-11`), which is the same defect one level up: a row written to correct a count, hand-maintained. Two of the four are derivable and are now pinned; `crm-customer-search.test.ts` and `p1-27-security.test.ts` build cases at runtime, so their figures are measurements, and the row says which is which                                                                              |
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
| Current case counts for `tests/backend` (85 files) and `tests/db` (139 files)              | A running local PostgreSQL. The 1636 / 1636 figure is recorded, not re-measured here                                                                                                                                                                                                                                                                                                                                      |
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

| check                                                     | scope                                                                                                                               | result                                                                                                                                                                                                |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every cited file, script and test **opened**              | **324** distinct path citations across the five documents                                                                           | All resolve, **except the seven cited precisely because they do not exist** — the six historical evidence filenames and `apps/web/tests/crm.test.ts`                                                  |
| Every markdown link followed                              | all relative links in the five                                                                                                      | 0 broken                                                                                                                                                                                              |
| Every quoted lower-case string matched against source     | **254** quotations                                                                                                                  | **229** are test-case or gate titles present **verbatim** in the file named; the other 25 are quotations of prose, each located in its document                                                       |
| Every permission-shaped code checked against the seed     | `supabase/seeds/04_iam_permission_catalog.sql`                                                                                      | **No invented permission code.** Six unseeded codes are cited, and each is cited _because_ it is unseeded                                                                                             |
| Every operation id checked against the published contract | `docs/api/openapi.v1.json`                                                                                                          | **0** unresolved — every operation id in all five documents is one of the 243 published                                                                                                               |
| Documentation line counts in §9                           | 26 files                                                                                                                            | **26 of 26 exact at the time.** Superseded: §9.1 listed fifteen of a directory holding far more, and eight of those fifteen had drifted by round five (`E-06`). Every line count in §9 is derived now |
| Structural counts re-measured                             | migrations, `scripts/ci`, `apps/web/scripts`, `tests/ci`, router pages, Playwright specs, seeded codes, `M-OA` identifiers, OpenAPI | 119 · 40 · 4 · 31 · 28 · 9 · 104 · 20 · 243 operations / 203 paths / 152 mutations / **0** `requestBody` / 3 schemas — all as recorded                                                                |
| §6.1's own arithmetic                                     | the 39 per-file case counts                                                                                                         | Sum **803**, matching the row total                                                                                                                                                                   |

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
| 6   | This manifest §6.4: "`tests/backend` 85 files present", "`tests/db` 139 files present"                                                                                                                                                                                  | **85 and 139 are the _test_ file counts; 90 and 143 files are present.** This row itself said 138 and 142 (`E-09`), and all four numbers are derived now, here and in `risk-register.md` §6.4                                                                                                                   |

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
| Current case counts for `tests/backend` (86 test files) and `tests/db` (139 test files)                | A running local PostgreSQL                                                                                               |
| A mutation for `OA-05`, and whether the `creation-actions.ts` allow-list entry was ever exercised      | Unchanged by this reconciliation — `evidence/task-traceability.md` §12 and `risk-register.md` §10 still record both      |

**None of this is acceptance.** Reconciling documents against each other makes
the record honest; it says nothing about whether the product works. **P1-27
closes only when the Product Owner manually tests the running application and
returns an explicit `OWNER ACCEPTANCE: PASS`. Silence is not Pass.**

<!-- The counts in this document's tables are checked against the tree by
     `validate:p1-27-doc-counts`. The markers live here, outside every table:
     an earlier revision put them in the label column and broke two other gates
     whose regexes read the label and the number as adjacent cells. -->

<!-- derived: files apps/web/tests = 102 -->
<!-- derived: files tests/ci = 60 -->
<!-- derived: files scripts/ci = 59 -->
<!-- derived: files apps/web/scripts = 4 -->
<!-- derived: files supabase/migrations = 128 -->
<!-- derived: files tests/db = 143 -->
<!-- derived: files tests/db:all = 147 -->
<!-- derived: files tests/backend = 99 -->
<!-- derived: files tests/backend:all = 106 -->
<!-- derived: files apps/web/src/features/crm = 20 -->
<!-- derived: files apps/web/src/features/vehicles = 23 -->
<!-- derived: files p1-27-frontend-gate = 126 -->
<!-- derived: files p1-27-frontend-gate:trees = 5 -->
<!-- derived: tracked docs/phase-1/phase-1-27 = 41 -->
<!-- derived: tracked docs/phase-1/phase-1-27:md = 31 -->
<!-- derived: tracked docs/product = 13 -->
<!-- derived: commands registered = 171 -->
<!-- derived: commands required = 90 -->
<!-- derived: commands reachable = 90 -->
<!-- derived: commands hosted-ci = 90 -->
<!-- derived: cases vehicle-screens.dom.test.tsx = 43 -->
<!-- derived: cases tailwind-theme-gate.test.ts = 8 -->
<!-- derived: cases navigation.test.ts = 22 -->
<!-- LINE-COUNT MARKERS. Regenerated, never typed. -->

<!-- derived: lines docs/phase-1/phase-1-27/adversarial-round-five.md = 857 -->
<!-- derived: lines docs/phase-1/phase-1-27/adversarial-round-four.md = 147 -->
<!-- derived: lines docs/phase-1/phase-1-27/blocker-remediation-plan.md = 545 -->
<!-- derived: lines docs/phase-1/phase-1-27/canonical-plan.md = 340 -->
<!-- derived: lines docs/phase-1/phase-1-27/canonical-write-reachability.json = 66 -->
<!-- derived: lines docs/phase-1/phase-1-27/ci-evidence.md = 275 -->
<!-- derived: lines docs/phase-1/phase-1-27/clean-room-evidence.md = 379 -->
<!-- derived: lines docs/phase-1/phase-1-27/closure-record.md = 114 -->
<!-- derived: lines docs/phase-1/phase-1-27/contract-archaeology.md = 416 -->
<!-- derived: lines docs/phase-1/phase-1-27/deliverable-manifest.md = 1051 -->
<!-- derived: lines docs/phase-1/phase-1-27/developer-guide.md = 228 -->
<!-- derived: lines docs/phase-1/phase-1-27/evidence/change-log.md = 1135 -->
<!-- derived: lines docs/phase-1/phase-1-27/evidence/evidence-manifest.json = 171 -->
<!-- derived: lines docs/phase-1/phase-1-27/evidence/closing-value-ledger.json = 907 -->
<!-- derived: lines docs/phase-1/phase-1-27/evidence/lifecycle-ledger.json = 72 -->
<!-- derived: lines docs/phase-1/phase-1-27/evidence/local-run-ledger.json = 30 -->
<!-- derived: lines docs/phase-1/phase-1-27/evidence/task-traceability.md = 437 -->
<!-- derived: lines docs/phase-1/phase-1-27/evidence/test-catalogue-traceability.json = 863 -->
<!-- derived: lines docs/phase-1/phase-1-27/evidence/test-catalogue-traceability.md = 406 -->
<!-- derived: lines docs/phase-1/phase-1-27/execution-checkpoint.md = 290 -->
<!-- derived: lines docs/phase-1/phase-1-27/final-canonical-remediation.md = 451 -->
<!-- derived: lines docs/phase-1/phase-1-27/final-task-adjudication.md = 959 -->
<!-- derived: lines docs/phase-1/phase-1-27/finding-phase-disposition.md = 511 -->
<!-- derived: lines docs/phase-1/phase-1-27/finding-task-map.json = 536 -->
<!-- derived: lines docs/phase-1/phase-1-27/findings.md = 889 -->
<!-- derived: lines docs/phase-1/phase-1-27/findings/p1-27-int-006-cursor-precision.md = 166 -->
<!-- derived: lines docs/phase-1/phase-1-27/independent-task-audit.md = 137 -->
<!-- derived: lines docs/phase-1/phase-1-27/installed-chrome-review.md = 215 -->
<!-- derived: lines docs/phase-1/phase-1-27/open-decisions.md = 1205 -->
<!-- derived: lines docs/phase-1/phase-1-27/operator-guide.md = 205 -->
<!-- derived: lines docs/phase-1/phase-1-27/owner-acceptance-checklist.md = 128 -->
<!-- derived: lines docs/phase-1/phase-1-27/owner-acceptance-fail-remediation.md = 198 -->
<!-- derived: lines docs/phase-1/phase-1-27/p1-27-int-113-unregistered-rate-limit-policy.md = 149 -->
<!-- derived: lines docs/phase-1/phase-1-27/preflight/final-readiness.json = 218 -->
<!-- derived: lines docs/phase-1/phase-1-27/preflight/final-readiness.md = 169 -->
<!-- derived: lines docs/phase-1/phase-1-27/reception-read-surface-plan.md = 602 -->
<!-- derived: lines docs/phase-1/phase-1-27/risk-register.md = 587 -->
<!-- derived: lines docs/phase-1/phase-1-27/task-matrix-verdicts.json = 1094 -->
<!-- derived: lines docs/phase-1/phase-1-27/task-matrix.json = 1487 -->
<!-- derived: lines docs/phase-1/phase-1-27/task-register.md = 299 -->
<!-- derived: lines docs/product/README.md = 443 -->
<!-- derived: lines docs/product/owner-workflow-requirements.md = 356 -->
<!-- derived: lines docs/product/vehicle-catalogue/catalogue-architecture.md = 1029 -->
<!-- derived: lines docs/product/vehicle-catalogue/manual-entry-policy.md = 656 -->
<!-- derived: lines docs/product/vehicle-catalogue/provider-evaluation.md = 648 -->
<!-- derived: lines docs/product/workshop/department-task-assignment.md = 751 -->
<!-- derived: lines docs/product/workshop/end-to-end-workshop-workflow.md = 1244 -->
<!-- derived: lines docs/product/workshop/frontend-implementation-program.md = 954 -->
<!-- derived: lines docs/product/workshop/inspection-and-diagnostics.md = 901 -->
<!-- derived: lines docs/product/workshop/parts-and-procurement-flow.md = 798 -->
<!-- derived: lines docs/product/workshop/pricing-payment-and-delivery.md = 1137 -->
<!-- derived: lines docs/product/workshop/reception-media-checklist.md = 563 -->
<!-- derived: lines docs/product/workshop/vehicle-history-model.md = 1039 -->
