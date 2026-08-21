# Phase Gate Record — Template (Phase 1-3 onward)

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Template — adopted with the
[Standing Technical Authorization Policy](./standing-technical-authorization-policy.md)
(2026-07-17). Copy into `docs/phase-1/phase-1-<n>/gate-record.md` and fill — see
[phase-gate-record-convention.md](./phase-gate-record-convention.md). This line
previously prescribed `phase-1-<n>-gate.md`, a third filename no phase has ever used.

---

> Usage: this template replaces the dual-owner checkbox/signature record for **routine
> technical phases**. If the phase touches a decision reserved to the founders jointly
> (see the policy §5), add an explicit owner-decision section for that item — the
> automatic record below never covers reserved decisions.

# Phase 1-\<n\> Gate — \<Gate Name\>

**Phase:** 1-\<n\> — \<phase title\> · **Gate package assembled:** \<date\> ·
**Review model:** the Solo Developer Review Policy under the Standing Technical
Authorization Policy — link both from the copied file as
`../../governance/solo-developer-review-policy.md` and
`../../governance/standing-technical-authorization-policy.md`.

## What is submitted

\<the branch, migrations, tests, standards, evidence corpus — with links\>

## What was weighed (stated plainly)

\<the honest limits: what is proven, what is deferred, what remains self-reviewed\>

## Gate conditions (Standing Technical Authorization §2)

| #   | Condition                                                              | Status                                  |
| --- | ---------------------------------------------------------------------- | --------------------------------------- |
| 1   | All mandatory CI checks green on the pull request                      | \<Pending / Satisfied — evidence\>      |
| 2   | No unresolved Critical security finding                                | \<status — vulnerability register ref\> |
| 3   | No unresolved High finding without an approved, time-bounded exception | \<status — exceptions register ref\>    |
| 4   | Documented technical self-review completed by Eng. Ezzaldeen Al-Bitar  | \<evidence register reference\>         |
| 5   | Pull request merged into `develop` by Eng. Ezzaldeen Al-Bitar          | \<Pending / merge commit SHA\>          |

## Decision record (completed automatically upon verification of all five conditions)

- **Decision:** Go — Technical Gate Passed
- **Technical authority:** Eng. Ezzaldeen Al-Bitar
- **Decision evidence:** successful CI and pull request merge into `develop`
  (PR #\<n\>, merge commit `<sha>`)
- **Date:** \<actual merge date\>

_Until all five conditions are verified, this section reads **Pending** — it is never
filled from intention, only from the verified merge and check results._

## Escalations (if any)

\<Only if a §6 pause trigger fired: what was escalated, to whom, and the recorded
owner decision. Reserved decisions require the founders' explicit approval and are
never covered by the automatic record.\>

## Canonical document synchronization

\<Applied / Pending — per the DOCX lock policy (Standing Technical Authorization §7);
a pending state does not block this gate or the next phase.\>
