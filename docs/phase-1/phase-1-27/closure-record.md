# Phase 1-27 — Closure Record

**Classification:** Confidential — Commercial Product and Pilot Planning

**Status: CLOSED — `OWNER ACCEPTANCE: PASS`, 2026-08-12**

|                       |                                                                                                                                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accepted at           | protected `develop` `aa78a6627bff0400621ec13d10777e44ff2cf9a3` — the P1-27 merge `46d4e482` plus the protected-reproof evidence record (PR #218)                                                               |
| `main`                | `f085d82001a43de51725707426d5c10eb134c004` — **unchanged; P1-27 is NOT promoted**                                                                                                                              |
| Decision              | `OWNER ACCEPTANCE: PASS`, 2026-08-12, unconditional — returned verbatim after the final technical handoff, with no conditions and no defects reported                                                          |
| Superseded record     | [`owner-acceptance-fail-remediation.md`](owner-acceptance-fail-remediation.md) — the 2026-08-06 `OWNER ACCEPTANCE: FAIL` and the disposition of its eleven defects                                             |
| Technical gate record | `P1-G27` remains the technical gate record reference; its substance is the protected reproof and the lifecycle ledger (`ci-evidence.md`, `evidence/lifecycle-ledger.json`) — still only technical verification |

---

## 1. What closed, and on whose word

P1-27 was recorded as complete once before — 42 of 42 implementation tasks, every
automated tier green — and the Product Owner tested the merged application by
hand on 2026-08-06 and refused it with eleven confirmed defects. The phase was
reopened on that refusal, and the permanent rule P1-26 produced was applied to
this phase without exception:

> No Frontend phase may be formally closed until the complete system runs
> locally, a usable Owner account exists, the Owner can sign in, the Owner can
> inspect every delivered screen by hand, real API integration is exercised, and
> the Owner explicitly records Pass.

It closes now because that rule was satisfied in full. The final technical
handoff left the application running — API at `localhost:3000`, Web at
`localhost:3100` — with the Owner administrator, read-only and Tenant B accounts
provisioned and verified against the live system: sign-in 200, session 200, 30
permissions resolved, wrong password 401. The content under test was protected
`develop` itself, not a working copy: the merge tree `98bd0264` is byte-identical
to the reviewed candidate. Against that running application, on 2026-08-12, the
Product Owner returned, verbatim:

> `OWNER ACCEPTANCE: PASS`

**Silence was never treated as Pass.** This phase asked, and the Owner answered
in the exact words the rule requires. The verdict is the Owner's act; no count in
this repository derived it and none could have.

## 2. What was accepted

The 42-task canonical scope — the CRM and Vehicle Frontend — as merged to
protected `develop` by PR #214 (`46d4e482`, second parent `a6b1e030`, the
reviewed candidate), on top of the Backend remediations PR #212 and PR #213. The
code candidate the evidence seals is `501f5f0d48d7b8cafc12dad51f6c501534b66a18`.

The defects that mattered most in getting here, all fixed and proved before the
handoff:

- **The client/API error contract root cause.** The web client declared
  `errorCode`/`errors` where the API emits `code`/`violations`, so field errors
  from every real 422 resolved to nothing and every conflict code rendered the
  same false sentence. Fixing the contract is what made the QA regression record
  truthful.
- **The `FE-023` odometer-history correction**, with its edge case proved in
  both halves rather than asserted.
- **The accessibility repairs**, asserted against rendered output rather than
  against words in files.

## 3. Recorded at the accepted state

Numbers, not adjectives — each produced by the run or record named, all taken at
or against the accepted content.

| tier                                   | result                                                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 42-task matrix                         | **42 PASS / 0 PARTIAL / 0 FAIL** (`task-matrix.json`, derived)                                                  |
| Round-five register                    | **96 findings: 95 FIXED / 1 REFUTED / 0 OPEN / 0 PARTIAL** (`adversarial-round-five.md`, derived)               |
| Protected reproof, run `31590615278`   | **19 / 19** jobs, protected-gate **GO** (job `94097982319`), at the merge SHA itself                            |
| Protected authenticated browser        | **224 passed / 0 failed** (job `94094472258`)                                                                   |
| CodeQL, repository-wide                | **0** open alerts                                                                                               |
| Hosted candidate CI, run `31587707846` | **21 / 21** checks; web 70 files / 1867 tests / 0 failed; authenticated browser 225 / 0                         |
| Local at the sealed candidate          | root 91 files / 2149 · web 70 / 1867 · backend 80 / 1842 · DB/RLS 139 / 1647 (`evidence/local-run-ledger.json`) |
| Migrations                             | **136**, schema hash `0598d8af8fa015f0ba0b2b46dc7a0861ea94e987376074905eecd877b93c893f`                         |
| Lifecycle at handoff                   | `POST_MERGE_PROTECTED_REPROOF`, sole blocker `OWNER_ACCEPTANCE_NOT_TAKEN` — the one this verdict discharges     |

## 4. What this closure does NOT do

- **It does not promote to `main`.** `main` remains `f085d820`. Promotion is a
  separate governance step with its own change-control sequence and its own
  authorisation, and it has not been requested.
- **It does not begin P1-28.** No successor phase is started, scoped or
  scheduled by this record.
- **It does not replace the technical gate.** `P1-G27` remains the technical
  gate record reference: the protected reproof and the lifecycle ledger are the
  technical verification, and this record adds no technical evidence to them —
  it records the Owner's acceptance, which no technical record can contain.
- **It does not accept any production data, deployment, release or tag.** The
  acceptance environment is local, its accounts created at runtime, and no
  business row is committed. The permanent no-fake-data policy is unchanged.

## 5. Carried forward, openly

Known at acceptance and not hidden by it:

| item                                                                                        | why it is carried rather than fixed                                                                                                   |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `P1-OD-017` (duplicate and merge rules) and `P1-OD-025` (document/media policy)             | Owner business decisions, still open. The delivered screens are decision-neutral: the affordances are absent, not disabled            |
| The `record-form-consumers.dom.test.tsx` intermittent                                       | Three occurrences, never reproduced under observation, message never captured. Recorded as unexplained rather than dismissed as flaky |
| The multi-company selector, and every item `finding-phase-disposition.md` assigns elsewhere | They belong to the phases that own those surfaces; the disposition record names each                                                  |

Nothing in this list was discovered after acceptance. All of it was on the record
before the Owner was asked.

---

**PHASE 1-27 IS CLOSED.** Accepted by the Product Owner on 2026-08-12 at
`develop` `aa78a662`, against a running application they tested themselves,
in the exact words the rule requires — and only in those words.
