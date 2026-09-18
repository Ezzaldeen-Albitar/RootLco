# P1-31 — determination evidence index, 2026-09-18

**Status:** PREPARED, for the designated human reviewer ·
**Measured at:** protected `develop` `3b50f26c02bf658d3b83f09b766cfa364bb0425e` (the merge of pull
request #417) ·
**Companions:** [`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md)
(the nine items and their EMPTY decision fields),
[`reviewer-packet-2026-09-18.md`](./reviewer-packet-2026-09-18.md) (the one packet routed to the
reviewer), [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) § 76 (the three excluded
dispositions, analysed) and § 77 (what moved beneath the evidence base, and the two figures that must
not be read at face value)

**THIS DOCUMENT INDEXES EVIDENCE. IT ISSUES NO DETERMINATION.** It fills no decision field, writes no
name, no date and no signature, records no verdict, moves no task-matrix row and moves no register
state cell. The nine decision fields at
[`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md) § 7 are **EMPTY**
and this document leaves them empty.

**No test tier, build, migration, database operation, browser tier or hosted job was run to produce
it.** Every entry below is one of exactly two things, and each says which it is: a **static read of
the tree at this head**, or a **figure quoted from a phase record with the section that states it** —
and in the second case that record, not this prose, is the authority. This obeys the Owner's own
instruction of 2026-09-16, quoted at
[`owner-decisions-2026-09-16.md`](./owner-decisions-2026-09-16.md) § 1: "Use the existing evidence
packet for QA-C1 through QA-C5 and SEC-C1 through SEC-C4. Do not launch new tests merely to prepare
those determinations."

Bare `.md` filenames are relative to `docs/phase-1/phase-1-31/`; every other path is written from the
repository root.

---

## 1. The three facts, kept separate — restated before anything else

The Owner's governing sentence, quoted from [`owner-decisions-2026-09-16.md`](./owner-decisions-2026-09-16.md)
§ 0:

> Keep three facts separate:
>
> - the Owner's conditional decision;
> - the actual QA/Security determinations;
> - whether the formal P1-G31 prerequisites are satisfied.

**How the three stand at this head.**

1. **The Owner's conditional decision EXISTS, and it is the Owner's.** **CONDITIONAL PASS** for the
   documented P1-31 scope, dated 2026-09-16, recorded as **D-38** at
   [`owner-decisions-2026-09-16.md`](./owner-decisions-2026-09-16.md) § 7 and transcribed into the
   verdict field of [`closure-record.md`](./closure-record.md) § 4. It is not an engineering result,
   not a certification, not a clearance, and not an authorisation to promote.
2. **The nine QA and Security determinations are ABSENT.** **QA-C1 … QA-C5** and **SEC-C1 … SEC-C4**
   have **empty fields** at [`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md)
   § 7, under that packet's own rule: "A blank row is not a refusal and is not a pending approval; it
   is an act that has not been performed."
3. **Gate P1-G31's conditions 2 and 3 remain UNSATISFIED**, because those conditions require exactly
   those two human determinations. Condition 1 is also not satisfied; condition 4 is answered. The
   four are conjunctive, so the gate is not satisfied
   ([`change-control-2026-09-08.md`](./change-control-2026-09-08.md) § 75.6).

**The review is a disclosed, authorized self-review and is never independent.** **D-32** retains
Eng. Ezzaldeen Al-Bitar as the designated human technical, QA and security reviewer and accepts a
disclosed, authorized internal/self-review for this phase, in the Owner's own words: "Do not describe
a self-review as independent." `docs/governance/solo-developer-review-policy.md:36-37` states the same
rule from the other side — the policy "does **not** claim that an independent review was performed. No
document in this repository may describe work reviewed under this policy as independently reviewed."
**P1-EC-016 — an independent security reviewer before production release — remains open and is not
claimed anywhere in this document**
(`docs/governance/standing-technical-authorization-policy.md:192-194`).

**The disclosure sentence of [`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md)
§ 2 remains mandatory on every determination, word for word.** Nothing here replaces it, shortens it
or discharges it.

## 2. The four evidence kinds, defined before they are used

Every row below is split into the same four kinds, in the same order. **Where a kind is absent for a
row, the row says so in words rather than leaving the cell blank** — an absent kind is a fact the
reviewer needs, not a gap to be tidied.

| kind                                          | what counts as this kind                                                                                                                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A — source / contract evidence**            | declarations, application and repository source, migrations, the permission catalogue seed, generated contract files, and the committed phase documents that transcribe them. Read statically, no execution              |
| **B — automated test evidence**               | committed suites and committed static gates: the unit and CI-parser tiers, the backend tier, the database tier, and the `scripts/ci/*.mjs` gates registered as npm scripts                                               |
| **C — authenticated browser evidence**        | committed Playwright specs under `apps/web/tests/e2e/authenticated/`, and the browser figures the acceptance record states for the run of record                                                                         |
| **D — physical or external-service evidence** | anything produced by, or held in, a system outside this repository: hosted check runs read from the repository's own API, the external evidence directory, an object store, a mail service, a printed or signed artefact |

**Two standing facts about kinds C and D, stated once and true of every row below.**

- **No hosted job executes any P1-31 browser case.** They run only in the closing runner —
  limitation **L-4** of [`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md)
  § 9, from [`acceptance-record.md`](./acceptance-record.md) § 11.12 item 2.
- **The run of record's artefacts are not committed.** Nothing of the run is in this repository except
  the record — limitation **L-8**, from [`security-and-qa-evidence.md`](./security-and-qa-evidence.md)
  § 18.5. The instruments live outside it, unversioned, identified only by digests (**L-5**,
  **CC-60 (g)**).

## 3. What moved between the P1-31 closing head and this head, measured

**Purpose of this section: to say honestly whether any of the nine rows reads differently at
`3b50f26c` than it did at the head the certification packet and the Owner's decisions were measured
at.** Seven pull requests merged after `beebc6c2` (the merge of #405) and before this head: **#411,
#412, #413, #414, #415, #416, #417**.

| what was checked                                                                                                   | result of the static read at `3b50f26c`                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the nine decision fields at [`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md) § 7 | **still EMPTY.** `git diff beebc6c2 3b50f26c -- docs/phase-1/phase-1-31/certification-and-clearance-packet.md` is empty                                                                                                               |
| the phase-1-31 records as a set                                                                                    | **three files changed and no figure moved**: `error-path-matrix.md`, `isolation-matrix.md` and `least-privilege-grant-map.md` were re-anchored to line numbers that drifted under the merged work. No count, state or verdict changed |
| `docs/governance/`                                                                                                 | **unchanged**                                                                                                                                                                                                                         |
| the artefacts the nine items cite                                                                                  | every file named in this index exists at this head, and every line anchor in it was read at this head                                                                                                                                 |
| the NON-DOCUMENTARY artefacts the nine items cite (source, gates, suites, baselines)                               | **SEVEN CHANGED**, and they are set out one by one at § 3.1 below. Three of them are the instruments behind **QA-C1**, **QA-C4** and **SEC-C4**                                                                                       |

**So the correct statement is narrower than "nothing moved", and § 3.1 is the reason it has to be.**
The nine **questions** are unchanged and the nine **fields** are still empty; the phase records that
state the P1-31 figures did not move. But **three of the instruments those records were measured with
did move**, and one register **figure now reads differently at this head than the register's own words
say** (§ 3.1, row 7). Both facts are disclosed here rather than left for the reviewer to find. The one
citation drift is recorded at [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) § 76.3
and proposed for mechanical repair there rather than applied here; the movement below is recorded at
§ 77 of the same register, likewise analysed and not applied.

### 3.1 The seven non-documentary artefacts that changed between `beebc6c2` and `3b50f26c`

**Read from `git diff --stat beebc6c2 3b50f26c` restricted to the files this index cites. Every line
below is a static read; nothing was executed.** The artefacts this index cites and which did **NOT**
change are also stated, because a reviewer needs both halves: `apps/api/src/modules/shared-services/domain/attachment-policy.ts`,
`…/application/attachment-service.ts`, the download-authorizations route,
`apps/api/src/modules/iam/application/access-administration-service.ts`,
`…/organization-settings-service.ts`, `tests/backend/p1-31-privilege-escalation.test.ts`,
`tests/backend/p1-31-audit-emission.test.ts`, `tests/backend/p1-31-signature-download-refusal.test.ts`,
`tests/ci/p1-31-grant-map.test.ts`, `tests/ci/p1-31-error-path-matrix.test.ts`,
`tests/db/p1-11-isolation.test.ts` and every P1-31 spec under
`apps/web/tests/e2e/authenticated/` are **byte-identical at the two heads**.

| #   | artefact                                          | what changed                                                                                                                                                                                        | whose instrument it is | does a figure in the nine rows move?                                                                                                                                                                               |
| --- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `apps/web/vitest.config.ts`                       | **+10.** `COVERAGE_INCLUDE` gained `src/features/platform/**` and the `(platform)` route group                                                                                                      | **QA-C1**              | **no P1-31 figure moves**, and the widening is **not** re-measured here. The P1-31 denominator is larger than the one the coverage record's globals were taken over, so those globals are **older than this head** |
| 2   | `.github/ci-baselines/coverage-baseline.web.json` | **+21.** Two new critical-module floors, `platform-console-surface` and `platform-console-routes`, both labelled `LOCAL` and pending a hosted run; the file's own note states no global floor moved | **QA-C1**              | **no.** No P1-31 floor and no global floor changed                                                                                                                                                                 |
| 3   | `tests/ci/baseline-integrity.test.ts`             | **+48/-…** the measured backend file count moves `291 → 310` as later slices add files                                                                                                              | **QA-C1** (kind B)     | **no.** The cited anchors `:445`, `:450`, `:457` and `:506` were re-read at this head and hold                                                                                                                     |
| 4   | `tests/db/shared-hardening.test.ts`               | **+7.** Two P1-32 search-folding functions added to an EXECUTE-grant list                                                                                                                           | **QA-C3** (kind B)     | **no.** The cited `:336` was re-read at this head and is still the RLS-enabled-and-forced case                                                                                                                     |
| 5   | `scripts/ci/check-p1-31-version-sourcing.mjs`     | **-8/+8.** The gate's own prose now reads "**Six** of the eleven have no consumer", with the retirement recorded in it                                                                              | **QA-C4**              | **YES — see row 7**                                                                                                                                                                                                |
| 6   | `tests/ci/p1-31-version-sourcing.test.ts`         | **+32/-…** `:111` now asserts `pending.length` is **6** and the compared set is **5**, naming `org.employee-status-set` as the fifth                                                                | **QA-C4**              | **YES — see row 7**                                                                                                                                                                                                |
| 7   | `apps/api/src/server/auth/audit-actions.ts`       | **+364/-1.** New action registrations for later slices, and one existing description extended (`sal.invoice.issued`). **No P1-31 action entry was removed, renamed or re-classed**                  | **SEC-C4**             | **no.** `audit-class-review.md`'s 21 `none` and 24 `privileged` P1-31 declarations are untouched; the registry each resolves against is simply larger                                                              |

**Row 7, stated in full because it is the one figure that changed.** The register's **CC-57 (a)** cell
(§ 67) reads "the **seven** PENDING operations remain unreachable". At `beebc6c2` that was correct. At
`3b50f26c` the gate declares **six**: the entry for `org.employee-status-set` was deleted by commit
`8bc4bfec` ("Retire a pending-consumer entry that now has a consumer"), which merged into `develop`
with **pull request #413** — inside the `#411 … #417` window this index measures. That is the gate's
declared lifecycle working, not an exception to it: the entry was removed in the same change that gave
the operation a consumer. **The register cell is NOT rewritten and its state is NOT moved by this
document**; the discrepancy is recorded at
[`change-control-2026-09-08.md`](./change-control-2026-09-08.md) § 77.2 and a corrected wording is
**PROPOSED** there for the reviewer, not applied. Everywhere below, the register's "seven" is quoted as
the register's words and the measured **six** is stated beside it.

---

## 4. The QA certification items — gate condition 2

### 4.1 QA-C1 — QA-001, coverage stated truthfully and labelled with the provenance it has

**The question the determination is over**, from
[`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md) § 5: that the
phase's unit and component coverage is stated truthfully and that its figures are labelled with the
provenance they have.

| kind                                 | evidence at `3b50f26c`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — source / contract**            | [`coverage-record.md`](./coverage-record.md) — § 3 the surfaces with component coverage, § 4 the holes **H-1 … H-5**, § 5 the gate and its wiring, § 6 the summary. The instrument itself: `apps/web/vitest.config.ts:52` (`COVERAGE_INCLUDE`) and `:128`, where the exported list is applied. The pinned baseline: `.github/ci-baselines/coverage-baseline.web.json`. The index entry: [`security-and-qa-evidence.md`](./security-and-qa-evidence.md) § 18.7                                                                   |
| **B — automated test**               | `tests/ci/baseline-integrity.test.ts:445` and `:450` assert the committed coverage `include` lists against the baselines, and `:457` … `:506` assert the patterns resolve to real files. `apps/web/tests/security.test.ts:8` imports `COVERAGE_INCLUDE` and `COVERAGE_EXCLUDE` from the web config and asserts over them. `scripts/ci/coverage-gate.mjs` is the enforcing gate                                                                                                                                                  |
| **C — authenticated browser**        | **ABSENT, and correctly so.** Coverage here is a unit and component measurement; no browser case contributes an instrumented line to it. Nothing in [`coverage-record.md`](./coverage-record.md) claims otherwise                                                                                                                                                                                                                                                                                                               |
| **D — physical or external-service** | **PRESENT for the gate's execution, ABSENT for the figures.** The hosted `web-quality` job ran and concluded `success` at the protected head, recorded at [`acceptance-record.md`](./acceptance-record.md) § 11.11 (e) — 19 check runs, all `completed`/`success`, read from the repository's own API with no run taken to produce them. **The coverage FIGURES remain LOCAL measurements**, labelled `LOCAL, pending the hosted web-quality run` in their own record; that labelling stands (**L-2**, and **CC-64 (b)**, open) |

**The figure the determination would be over**, quoted and not re-measured: holes **H-2, H-3 and H-4**
closed in code; **141 → 186 instrumented files**; the delivery signature-capture module moved **0/25
lines to 25/25**; **H-1 remains open** and is counted on FE-004
([`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md) § 5).

**Honest absences and limits carried into this row.**

- Kind C is absent by the nature of the measurement, not by omission.
- Kind D is **split**: the gate has a citable hosted execution; the figures do not. A determination
  over QA-C1 weighs a **local figure whose gate has a hosted execution**, and not a hosted figure.
- **Measured at this head, as an index observation and not as a new register finding:**
  `scripts/ci/coverage-gate.mjs` is **not reachable through any npm script** — `package.json` names it
  nowhere. It is invoked directly by `.github/workflows/_reusable-node-quality.yml:545` and `:719` and
  by `.github/workflows/_reusable-integration-tests.yml:190`. So the floors are enforced in hosted CI
  and are **not** enforced by any local aggregate a developer can run. This is stated so the reviewer
  weighs the local figures knowing which harness does and does not hold them.
- **H-1 is open and stays open.** The Owner's **D-36** defers the screen behind it to **`P1-31-FU-001`**
  and closes neither H-1 nor **CC-57 (a)**.
- **The instrument behind this row MOVED between the packet's head and this one**, and a determination
  over QA-C1 should know it: `apps/web/vitest.config.ts` widened `COVERAGE_INCLUDE` by two prefixes and
  `.github/ci-baselines/coverage-baseline.web.json` gained two critical-module floors (§ 3.1, rows 1 and
  2). **No P1-31 figure and no global floor moved**, and nothing here re-measures the widened list — so
  the coverage record's global figures were taken over a **smaller denominator than the one configured
  at this head**, and they are quoted as what they are: measurements of an earlier head, still
  **LOCAL**.

### 4.2 QA-C2 — QA-002, API, contract and error-path coverage complete as a set

| kind                                 | evidence at `3b50f26c`                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A — source / contract**            | [`error-path-matrix.md`](./error-path-matrix.md) — the committed matrix and its column definitions; [`security-and-qa-evidence.md`](./security-and-qa-evidence.md) § 6 (QA-002) and § 18.4; [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) § 68.3, which states the set-shaped counts                                                                                                                                                |
| **B — automated test**               | `tests/ci/p1-31-error-path-matrix.test.ts` — `:1027` "covers the parsed operation set exactly — no extra row, no missing one", `:1042` and `:1074` the table-attribution rules, `:1083` and `:1123` the two anti-vacuity refusals, `:1144` both documents present and non-trivial, `:1159` "matches the committed error-path matrix exactly". The replay and refusal behaviours the matrix indexes are asserted by the backend tier named in each cell |
| **C — authenticated browser**        | **ABSENT for the contract set as a set.** No committed browser case asserts an error-path matrix row. The browser tier exercises screens, not the published error contract                                                                                                                                                                                                                                                                             |
| **D — physical or external-service** | **PRESENT only as the hosted execution of the tiers that carry these suites** — [`acceptance-record.md`](./acceptance-record.md) § 11.11 (e). **No external service supplies contract evidence**, and none is claimed                                                                                                                                                                                                                                  |

**Open items this row must weigh, carried and not resolved here.** The two published not-found answers
corrected by pull request #399; **a contract gap that is open** — the quality-control record detail
publishes its success body as a bare object ([`acceptance-record.md`](./acceptance-record.md) § 11.12
item 10; limitation **L-3**; and **CC-46 (c)**, which records the shortfall as chapter-wide rather than
local). **CC-58 (c)** is carried: the concurrency suite's header "states a replay coverage it did not
have".

### 4.3 QA-C3 — QA-003, tenant, company and branch isolation proved at both layers as a set

| kind                                 | evidence at `3b50f26c`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — source / contract**            | [`isolation-matrix.md`](./isolation-matrix.md) — Layer 1 (database) and Layer 2 (application), one row per table and per operation, with the migration that creates each table; [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) § 68.5, the per-table set proof                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **B — automated test**               | **Database layer:** `tests/db/p1-11-isolation.test.ts:58` (RLS forced and a tenant-scoped SELECT+INSERT policy on every `sal`/`wty`/`rpt` table), `:97` (a cross-tenant INSERT rejected on every one), `:117` (committed tenant-A rows hidden from tenant B and from a no-context session); `tests/db/shared-hardening.test.ts:336` (RLS enabled and forced on every module-schema table); the behavioural read negatives `tests/db/sal-delivery.test.ts:319`, `tests/db/wty-warranty.test.ts:216`, `tests/db/rpt-reporting.test.ts:156`, `tests/db/org-employees.test.ts:180`. **Application layer:** `tests/backend/p1-31-privilege-escalation.test.ts:2116` (SE-6, a foreign tenant cannot address this tenant's rows) and `:2242` (SE-7, a caller cannot assert another organisation's company or branch) |
| **C — authenticated browser**        | **PRESENT, and narrow.** `apps/web/tests/e2e/authenticated/isolation.spec.ts` is the committed browser isolation spec. It is a screen-level check and is **not** the set proof; the set proof is kind B                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **D — physical or external-service** | **PRESENT only as the hosted execution of the database and backend tiers** ([`acceptance-record.md`](./acceptance-record.md) § 11.11 (e)). No external service supplies isolation evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

**Open item this row must weigh. CC-58 (b)** — "the assurance evidence index reads two constraint
suites as isolation evidence they did not carry". The code half was repaired, so the entry is **true at
this head**; the register's own words are that **"it was not true when written"**, and the index is not
rewritten. The row is CARRIED UNDER O-3 and is not closed.

### 4.4 QA-C4 — QA-004, record-version sourcing mechanically enforced where reachable, unreachable operations disclosed

| kind                                 | evidence at `3b50f26c`                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — source / contract**            | `scripts/ci/check-p1-31-version-sourcing.mjs`, the gate itself, registered as `validate:p1-31-version-sourcing` in `package.json:133` and run inside `verify:policies` (`package.json:160`); [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) § 67; [`operator-runbook.md`](./operator-runbook.md) § 11, which records how to run it, read a red and roll back                                                                                                        |
| **B — automated test**               | `tests/ci/p1-31-version-sourcing.test.ts` — `:83` the eleven version-guarded operations each guarded by the contract, `:111` the **six** with no consumer declared rather than hidden (the number read at this head — see below), `:131` the overlap with the access gate's allow-list pinned, `:155` the gate reports what it examined and exits clean, `:180` the structural completion adapter bound to its operation and caller, `:200` the defect classes that turn the gate red |
| **C — authenticated browser**        | **ABSENT.** No committed browser case asserts a record-version source. The gate judges the **send**, and a browser case cannot stand in for it — see **CC-57 (b)** below                                                                                                                                                                                                                                                                                                              |
| **D — physical or external-service** | **PRESENT only as the hosted execution of the policy aggregate carrying this gate** ([`acceptance-record.md`](./acceptance-record.md) § 11.11 (e)). No external service supplies evidence for this row                                                                                                                                                                                                                                                                                |

**Open items this row must weigh.** **CC-57 (a)** is **OPEN** and its register cell (§ 67) reads, in
the register's own words, "the **seven** PENDING operations remain unreachable" and "this gate discloses
that rather than closing it".

**Measured at this head, the number in that sentence is SIX, not seven.**
`tests/ci/p1-31-version-sourcing.test.ts:111` asserts `pending.length` is **6** and pins the compared
set at **5**; `scripts/ci/check-p1-31-version-sourcing.mjs:128` states "Six of the eleven have no
consumer" and records why. The seventh, `org.employee-status-set`, **acquired a consumer** and its
PENDING entry was deleted in the same change — commit `8bc4bfec`, merged with **pull request #413**,
inside the `#411 … #417` window. **The register cell keeps its words and its state until the reviewer
decides**; the corrected wording is **PROPOSED** at
[`change-control-2026-09-08.md`](./change-control-2026-09-08.md) § 77.2 and is not applied.

**What did not change with it:** three of the remaining six are the checklist-template writes the Owner
deferred by **D-36** to **`P1-31-FU-001`** — deferred, not closed — and three are the
report-configuration writes. **CC-57 (a) is not discharged**: six operations still have no consumer.

**CC-57 (b)** is **OPEN**: "the sourcing gate judges the SEND, not the screen state behind it", so no
figure from the gate may be quoted as a runtime property.

### 4.5 QA-C5 — QA-005, the acceptance record admissible as test evidence, not a verdict, packaging half unmet

| kind                                 | evidence at `3b50f26c`                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A — source / contract**            | [`acceptance-record.md`](./acceptance-record.md) §§ 11.1–11.13 — the head under test and its proof (§ 11.1), the instruments and their digests (§ 11.2), how it was driven (§ 11.3), the HTTP journey (§ 11.4), the export companion (§ 11.5), the browser half (§ 11.6), screens (§ 11.7), monitoring and the DO-002 rehearsal (§ 11.8), credential hygiene (§ 11.9), run history (§ 11.10), the recording gaps (§ 11.11), the limitations (§ 11.12) and the non-claims (§ 11.13)               |
| **B — automated test**               | **PRESENT, and it is the committed tiers the run drove, not the run itself.** The run of record is an instrumented execution, not a committed suite; the suites it exercised are the backend, database and unit tiers named throughout §§ 1–13 of [`security-and-qa-evidence.md`](./security-and-qa-evidence.md)                                                                                                                                                                                 |
| **C — authenticated browser**        | **PRESENT.** **84 P1-31 browser cases executed, 0 failed, 28 per authenticated project** (§ 11.6), derived from both tier reports and from neither alone. The committed specs are `apps/web/tests/e2e/authenticated/delivery-p1-31.spec.ts`, `delivery-writes-p1-31.spec.ts`, `warranty-p1-31.spec.ts`, `reports-p1-31.spec.ts`, `overview-p1-31.spec.ts` and `audit-log-p1-31.spec.ts`                                                                                                          |
| **D — physical or external-service** | **PRESENT, and it is the load-bearing half of this row.** The five instruments, the two browser reports, the five export bodies, the monitoring input and the three rehearsal artefacts live at `orchestration/evidence/p1-31/acceptance-20260916-0008/` and `…-monitoring-rehearsal/`, **outside every git working tree**, identified by the sha256 digests tabulated at [`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md) § 8. **30 shot records, 28 images** |

**The figure, quoted:** run `mu3ch41f` — **740 HTTP steps, 740 ok, 0 findings**
([`acceptance-record.md`](./acceptance-record.md) § 11.4). Attempt 3 is retained and **qualified** by
its instrument's guessed record versions (**L-7**).

**The non-substitution sentence this row carries, attested with the figure and never instead of it**,
quoted from [`acceptance-record.md`](./acceptance-record.md) § 11.13:

> **No Owner verdict, no phase Pass, no promotion and no human certification**, and no claim that the
> phase is complete.

**Honest absences and limits.** Kind D is present but **unversioned** (**L-5**, **CC-60 (g)**) and
**uncommitted** (**L-8**). The packaging half of QA-005 is **unmet**: `phase-1/_acceptance/` holds its
README and nothing else, and placing an artefact there is the certifier's and the Owner's act, not
engineering's ([`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md)
§ 10). **D-35** approves the existing in-repository evidence convention and writes nothing into that
directory. The privileged export fixture is a **local fixture on the shared acceptance database**,
absent from hosted execution, with an **uncommitted, hand-taken** falsifiability control (**L-6**).

---

## 5. The security clearance items — gate condition 3

### 5.1 SEC-C1 — SEC-001, permission and resolved-scope enforcement measured across the surface

| kind                                 | evidence at `3b50f26c`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — source / contract**            | [`least-privilege-grant-map.md`](./least-privilege-grant-map.md) — 47 operations over 34 route files, with each operation's declared codes, service-enforced codes and catalogue rows; [`security-and-qa-evidence.md`](./security-and-qa-evidence.md) § 1 and § 1.1 (the code × operation × catalogue-row reconciliation) and § 18; [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) § 68.4                                                                                                                                                                                    |
| **B — automated test**               | `tests/ci/p1-31-grant-map.test.ts:338` (the parse, with nothing unreadable), `:352` (it cites case titles the escalation suite actually emits), `:362` (a catalogue row named for every code a minimal role must hold), `:375` ("matches the committed document exactly"). `tests/backend/p1-31-privilege-escalation.test.ts:1910` (SE-5, least privilege on every operation of the phase set) and `:1998`/`:1999` (SE-5M, the declared codes are SUFFICIENT and every operation gets a minimal caller holding exactly them). The registered gate `validate:p1-31-access` (`package.json:131`) |
| **C — authenticated browser**        | **PRESENT, and it is not the measurement.** `apps/web/tests/e2e/authenticated/administration.spec.ts` and the P1-31 screens exercise entitlement at the screen. The **set** measurement is kind B                                                                                                                                                                                                                                                                                                                                                                                              |
| **D — physical or external-service** | **PRESENT only as the hosted execution of the backend and policy tiers** ([`acceptance-record.md`](./acceptance-record.md) § 11.11 (e)). No external service supplies permission evidence                                                                                                                                                                                                                                                                                                                                                                                                      |

**The precise limitation this row must weigh, stated as its own register cell states it. CC-58 (a) is
OPEN**: "SE-5M cannot see a service-level authority requirement for 45 of the 46 operations" — the
minimal-actor probe establishes sufficiency **at the pre-handler gate only**, and **one operation
alone** is probed against real rows with a minimal caller. The register's own restriction is that "no
claim in this section reads past the limit"; it is a **disclosed input** to a security determination
that does not exist.

**A figure mismatch inside this row, flagged rather than silently smoothed.** The quoted cell says
**46** operations; the grant map and the census this same row cites say **47** — pinned as constants in
`tests/ci/p1-31-grant-map.test.ts:78-79` (`EXPECTED_OPERATIONS = 47`, `EXPECTED_ROUTE_FILES = 34`) and
stated as "47 operations with 13 declared permission codes" at
[`change-control-2026-09-08.md`](./change-control-2026-09-08.md) § 69.13. **The two figures are not
reconciled in the source records, and this document does not reconcile them**: the cell is quoted word
for word because a register cell is quoted, not corrected, by an index. **Neither number is re-derived
here**, and the difference is recorded for the reviewer at
[`change-control-2026-09-08.md`](./change-control-2026-09-08.md) § 77.3. Whichever is right, the
limitation is unchanged in kind — sufficiency is established at the pre-handler gate for all but one
operation.

### 5.2 SEC-C2 — SEC-002, sensitive-data, export and file-access controls, and how far the download rule reaches

| kind                                 | evidence at `3b50f26c`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — source / contract**            | `apps/api/src/modules/shared-services/domain/attachment-policy.ts:42-52` — **nine** allow-listed linkable entity types, and `:65` `isLinkableEntityType`; `apps/api/src/modules/shared-services/application/attachment-service.ts:300` and `:859`, where the allow-list is applied; `apps/api/src/app/api/v1/attachments/documents/[documentId]/download-authorizations/route.ts`, the download operation itself. Documents: [`security-and-qa-evidence.md`](./security-and-qa-evidence.md) § 2, § 2.1, § 18.2 and § 18.3; [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) § 72.4, § 72.4.1 and § 72.5                                                                                                                                                                                                             |
| **B — automated test**               | `tests/backend/p1-31-signature-download-refusal.test.ts` — `:488` the declared file-access permission, `:493` the control that a holder is issued a download, `:506` a caller holding the reference but not the permission refused, `:534` a caller from another tenant refused with the uniform not-found, `:573` every linkable entity type keyed by a single uuid `id`, `:594` an unlinked accepted version refused exactly as an invented id is, `:618` a withdrawn-only link refused, `:642` a URL issued when one withdrawn link sits beside one live visible link, **`:664` the one branch-scope case**, `:701` a non-accepted version still refused with the state code. `tests/backend/p1-31-receiver-identity-evidence.test.ts:180` … `:407` — ten cases over the receiver's optional identity evidence, server-validated |
| **C — authenticated browser**        | **PRESENT.** Two committed cases, `apps/web/tests/e2e/authenticated/delivery-p1-31.spec.ts:478` ("an identity document the server refuses leaves the receiver unverified") and `:552` ("an unverified receiver is verified through the screen with an identity document attached"), recorded as **passing in all three authenticated projects** ([`security-and-qa-evidence.md`](./security-and-qa-evidence.md) § 18.3)                                                                                                                                                                                                                                                                                                                                                                                                             |
| **D — physical or external-service** | **ABSENT for the object store, and that absence is material.** The signed URL is issued against a test double in every committed suite; **no evidence in this repository exercises a real object-storage provider**, and none is claimed. Hosted execution of the backend tier carrying these suites is recorded at [`acceptance-record.md`](./acceptance-record.md) § 11.11 (e). No printed or signed physical artefact bears on this row                                                                                                                                                                                                                                                                                                                                                                                          |

**The limits this row must weigh, each quoted from its own source.**

- **CC-63 (a)** — **NOT COVERED BY O-3**, so the Owner's carry-forward does not reach it. "The download
  authorization does not refuse a caller whose file-access grant is scoped to another branch." Analysed
  against the merged work at [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) § 76.2.
- **L-9** — branch scoping on download is proved for **one case only**, and the statement about the
  other admitted entity kinds is **measured from the policy catalogue, not proven by a test**.
- **L-10** — a live link to a **soft-deleted** entity still counts as reachable.
- **L-11** — runtime reachability is exercised for **three of the nine** allow-listed link types, with a
  fourth reached through shared fixtures. The nine are the list read at `attachment-policy.ts:42-52`
  above.

### 5.3 SEC-C3 — SEC-003, abuse-case and privilege-escalation controls, and the observation left undispositioned

| kind                                 | evidence at `3b50f26c`                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — source / contract**            | [`security-and-qa-evidence.md`](./security-and-qa-evidence.md) § 3 and § 3.1 (the four parts of the definition and what covers each), § 18.4; [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) §§ 59, 66 and 72.2                                                                                                                                                                                                       |
| **B — automated test**               | `tests/backend/p1-31-privilege-escalation.test.ts` — `:1703` SE-0 the phase operation set parsed, `:1765` a reason named for every operation SE-6 and SE-7 do not reach, `:1793` SE-1, `:1814` SE-2, `:1838` SE-3 (the database refuses the same INSERT with the service check bypassed), `:1875` SE-4, `:1910` SE-5, `:2116` SE-6, `:2242` SE-7. `tests/backend/p1-31-concurrency-and-versioning.test.ts:350` … `:452` (C17-0 … C17-4) |
| **C — authenticated browser**        | **ABSENT for the abuse cases.** No committed browser case attempts an escalation. The probes are server-side by construction and a browser tier cannot stand in for them                                                                                                                                                                                                                                                                |
| **D — physical or external-service** | **ABSENT as a distinct kind.** The escalation probes run against a **disposable** database and **no acceptance record exercises them** (**L-12**, and [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) § 59). Hosted execution of the backend tier is recorded at [`acceptance-record.md`](./acceptance-record.md) § 11.11 (e)                                                                                          |

**Open items this row must weigh.** **SEC-003-O1 is settled** by cited authority (§ 66, applying
CC-14 § 2) and is **not** in this list. **SEC-003-O2 is unchanged and open.** **CC-56 (b)** is **NOT
COVERED BY O-3** and is analysed at [`change-control-2026-09-08.md`](./change-control-2026-09-08.md)
§ 76.1; **CC-56 (d)** is carried under O-3 and keeps its restriction — the P1-30 tenant-boundary case
"pins neither code".

### 5.4 SEC-C4 — SEC-004, security audit-event coverage for the set of privileged actions

| kind                                 | evidence at `3b50f26c`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — source / contract**            | [`audit-class-review.md`](./audit-class-review.md) — § 1 the surface and how it was measured, § 2 the 21 `auditClass: 'none'` declarations one line each, § 3 the 24 `auditClass: 'privileged'` declarations, § 4 where silence is a judgement rather than a certainty, § 5 where the payload half is recorded. `apps/api/src/server/auth/audit-actions.ts`, the registry each declaration resolves against; [`change-control-2026-09-08.md`](./change-control-2026-09-08.md) § 68.2                                   |
| **B — automated test**               | `tests/backend/p1-31-audit-emission.test.ts` — `:1436` the privileged write set parsed over the route files, all readable and all registered, `:1452` an action the catalogue registers as privileged named for each, `:1473` "covered by the emission table EXACTLY — no extra case, no unprobed write", `:1479` E-0P the emitting caller holds the thirteen declared codes, `:1493` E-1 every privileged write records exactly one audit fact. The registered gate `validate:p1-31-write-shape` (`package.json:132`) |
| **C — authenticated browser**        | **PRESENT, and narrow.** `apps/web/tests/e2e/authenticated/audit-log-p1-31.spec.ts` carries the audit-log screen cases. It reads the log; it is **not** the emission-set proof, which is kind B                                                                                                                                                                                                                                                                                                                        |
| **D — physical or external-service** | **PRESENT.** In the run of record, **each of the five exports carried exactly one correlated audit event** — four asserted by ledger steps of their own and the empty selection's measured from the same window read ([`acceptance-record.md`](./acceptance-record.md) § 11.5) — and the default administrator was refused all four report codes with `403 ERR-IAM-001`. The five export bodies are digest-identified at [`certification-and-clearance-packet.md`](./certification-and-clearance-packet.md) § 8        |

**The limit this row must weigh, quoted. L-13**: "the export audit records selection and counts, not a
byte length or a content digest, so it cannot later identify the exact bytes disclosed". **CC-61 (c)**
carries the same fact as a register row, with the register's own restriction that the audit is
"deliberately not described as durable-file provenance".

**The registry this row resolves against GREW since the packet's head, and it is disclosed rather than
passed over.** `apps/api/src/server/auth/audit-actions.ts` is **+364/-1** between `beebc6c2` and
`3b50f26c` (§ 3.1, row 7): later slices registered their own actions, and one existing description was
extended (`sal.invoice.issued`, a P1-30 financial action). **No P1-31 action entry was removed, renamed
or re-classed**, and the 21 `auditClass: 'none'` and 24 `auditClass: 'privileged'` declarations
[`audit-class-review.md`](./audit-class-review.md) enumerates are untouched — the registry is simply
larger than it was when the review was written, and the review's set is a subset of it.

---

## 6. The index at a glance — which kinds each row has, and where each is absent

**This table is a summary of §§ 4 and 5 and adds nothing to them. A cell reading ABSENT is a
measured absence, not an omission.**

| row        | A source / contract | B automated test | C authenticated browser               | D physical / external-service                    |
| ---------- | ------------------- | ---------------- | ------------------------------------- | ------------------------------------------------ |
| **QA-C1**  | present             | present          | **ABSENT** — not that kind of measure | **SPLIT** — gate hosted, figures LOCAL           |
| **QA-C2**  | present             | present          | **ABSENT** — no case asserts a row    | hosted tier execution only                       |
| **QA-C3**  | present             | present          | present, narrow                       | hosted tier execution only                       |
| **QA-C4**  | present             | present          | **ABSENT** — the gate judges the send | hosted tier execution only                       |
| **QA-C5**  | present             | present          | present — 84 cases, 0 failed          | present — uncommitted, unversioned, digest-bound |
| **SEC-C1** | present             | present          | present, not the measurement          | hosted tier execution only                       |
| **SEC-C2** | present             | present          | present — two cases, three projects   | **ABSENT** — no real object store exercised      |
| **SEC-C3** | present             | present          | **ABSENT** — server-side by nature    | **ABSENT** — disposable database only            |
| **SEC-C4** | present             | present          | present, narrow                       | present — five exports, five audit events        |

## 7. P1-31-FU-001 — visible, and DEFERRED, not closed

**`P1-31-FU-001` — Delivery checklist-template administration screen.** Recorded at
[`change-control-2026-09-08.md`](./change-control-2026-09-08.md) § 75.4 under Owner decision **D-36**,
with state **open, deferred, not built** and owner **unassigned — a later Frontend lane**.

- In the Owner's words it "is not a P1-31 closure requirement and must not be inserted into P1-32,
  whose purpose is frontend validation rather than new administration features."
- **It closes nothing.** Coverage hole **H-1** stays open on its own terms; **CC-57 (a)** keeps its
  state; the five pending mirror entries stay pending; **FE-004 does not move**.
- It bears on **QA-C1** (through H-1) and **QA-C4** (through three of the operations CC-57 (a) names —
  the register's cell says seven of them and the gate declares **six** at this head, § 4.4; the three
  checklist-template writes are in both readings), and the reviewer weighs it as **deferred work with a
  named destination**, not as work discharged.

## 8. What this document does not do

- **It issues no certification and no clearance**, and it fills none of the nine decision fields.
- **It writes no name, no date and no signature**, for anybody.
- **It records no verdict and states no determination.** Where it proposes anything, it does so only in
  [`reviewer-packet-2026-09-18.md`](./reviewer-packet-2026-09-18.md), marked **PROPOSED**.
- **It describes no review as independent**, and it does not close **P1-EC-016**.
- **It moves no task-matrix row, no register state cell and no total**, and it marks nothing fixed or
  completed.
- **It claims no hosted run, no environment and no approval** beyond the executions the records it
  cites already state.
- **It ran no test tier, build, migration, database operation, browser tier or hosted job.**
- **It writes nothing into `phase-1/_acceptance/`.**
- **It authorises no promotion.** Promotion stays NOT eligible ([`closure-record.md`](./closure-record.md)
  § 6).
