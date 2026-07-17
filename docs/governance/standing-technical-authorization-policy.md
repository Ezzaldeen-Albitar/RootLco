# Standing Technical Authorization Policy

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Active — adopted by owner instruction received 2026-07-17 (recorded at the
owners' direction; no handwritten or cryptographic signature exists or is claimed) ·
**Related:** [solo-developer-review-policy.md](./solo-developer-review-policy.md) ·
ADR-006 · [pull-request-review-requirement.md](../phase-1/phase-1-1/pull-request-review-requirement.md) ·
[github-required-checks.md](../phase-1/phase-1-1/github-required-checks.md) ·
[security-baseline.md](../security/security-baseline.md)

---

## 1. Delegation

**Eng. Ezzaldeen Al-Bitar is the delegated technical and execution authority for RootLco
development phases.** He currently holds, alone, the roles of software developer,
technical lead, software architect, database engineer, DevOps owner, security reviewer,
QA reviewer, and repository administrator (recorded in
[technical-ownership.md](../phase-1/phase-1-1/technical-ownership.md)).

This policy exists to remove repeated per-phase approval ceremonies that add delay
without adding scrutiny while one person holds every technical role. It changes **who
must repeat an approval**, not **what must be true** before a merge.

## 2. The routine technical gate

For a **routine technical phase**, the phase gate decision is constituted by the
following sequence — no other event is required:

1. **All mandatory CI checks are green** on the phase's pull request.
2. **No unresolved Critical security finding exists**
   ([vulnerability-management-standard.md](../security/vulnerability-management-standard.md)).
3. **No unresolved High security finding exists** without an approved, time-bounded
   exception in the
   [security-exceptions-register.md](../security/security-exceptions-register.md).
4. **Eng. Ezzaldeen Al-Bitar completes the documented technical self-review**
   (documented with evidence in the phase evidence register, per the
   [Solo Developer Review Policy](./solo-developer-review-policy.md)).
5. **Eng. Ezzaldeen Al-Bitar merges the pull request into `develop`.**

> **The pull request merge by Eng. Ezzaldeen Al-Bitar is the recorded technical
> approval event.** When all five conditions are satisfied, the phase gate record is
> completed automatically as:
>
> **Decision: Go — Technical Gate Passed**
> **Technical authority:** Eng. Ezzaldeen Al-Bitar
> **Decision evidence:** successful CI and pull request merge into `develop`
> **Date:** the actual merge date

The gate record is completed against **verified facts** (the merge commit reachable
from `develop`; the required checks green on the pull request) — never against
intention. If the facts cannot be verified, the record stays pending.

## 3. What is NOT required for a routine technical gate

- A repeated checkbox decision.
- A separate signature.
- An additional owner-gate message or chat approval after the merge.
- An approval from Eng. Bilal Jradat.
- A second GitHub reviewer while no second technical reviewer exists.

## 4. GitHub governance that remains binding (unchanged)

| Rule                                      | Value          |
| ----------------------------------------- | -------------- |
| Required approving reviews                | **0**          |
| Pull requests                             | **mandatory**  |
| Successful CI                             | **mandatory**  |
| Conversation resolution                   | **mandatory**  |
| Force pushes                              | **prohibited** |
| Protected-branch deletion                 | **prohibited** |
| Direct implementation on `main`/`develop` | **prohibited** |

This policy loosens nothing in the table above. It removes ceremony, not controls.

## 5. Decisions reserved to Eng. Bilal Jradat (joint founder approval)

Eng. Bilal Jradat's **explicit approval is required only** for:

- Major commercial or product-scope changes.
- Material financial commitments.
- Pricing, contracts, or customer commitments.
- Production Go-Live.
- Migration of real customer data.
- Acceptance of unresolved Critical or High security risks.
- Major architecture changes with material business or financial impact.

**Routine database, backend, frontend, QA, DevOps, security-implementation,
documentation, and refactoring phases do not require his repeated approval.**

Nothing in this policy removes or dilutes the founders' joint authority over the
reserved decisions above, over product naming (ADR-011), brand identity, cloud
provider/region/platform selection (ADR-012), or promotion of `develop` to `main` as a
release (ADR-006).

## 6. Routine vs. escalation — when to pause

A phase is **routine** when it implements planned technical work inside the approved
scope. Execution **pauses and requests explicit owner input only when**:

- CI cannot be made green.
- A Critical finding exists.
- A High finding needs risk acceptance (an exception request).
- A major architecture or product-scope decision is unresolved.
- Production, real customer data, contracts, pricing, or material cost is involved.

Execution does **not** pause merely to request routine approval.

## 7. Canonical DOCX synchronization (lock policy)

Canonical DOCX synchronization is an **administrative post-merge task, not a routine
technical-phase blocker.** A locked canonical DOCX must not block technical
implementation, CI, pull request review, merge, or the start of the next authorized
technical phase.

If a canonical DOCX file is locked:

1. Continue all repository tasks.
2. Record the DOCX synchronization as **pending** (in
   [canonical-documents.md](./canonical-documents.md)).
3. Prepare the exact update safely (backup verified, edit scripted and validated).
4. **Do not kill or force-close Microsoft Word.** Do not wait indefinitely, and do not
   run a long-lived watcher that blocks completion.
5. Apply the update during the next available documentation window.
6. Final DOCX synchronization is required only **before production release or formal
   external delivery**.

## 8. Future phase behavior

Every future routine technical phase proceeds as:

1. Complete implementation.
2. Run tests.
3. Open the pull request.
4. Wait for mandatory CI.
5. Perform and document the technical self-review.
6. Merge into `develop`.
7. Automatically record **Go — Technical Gate Passed** in the phase gate record
   (template: [phase-gate-record-template.md](./phase-gate-record-template.md)).
8. Begin the next authorized technical phase.

The [Security Gate](../security/security-baseline.md) (conditions 2 and 3 of §2) binds
every gate; the phase evidence register documents the self-review (condition 4).

## 9. Honesty and limits

- The technical self-review under this policy is **owner-authorized self-review and
  must never be represented as an independent review**. P1-EC-016 (independent security
  reviewer before production release) remains open and is unaffected.
- The automatic gate record documents that the defined conditions were met; it is not a
  claim of external scrutiny.
- The live GitHub ruleset is administered in the GitHub UI; the build environment holds
  no GitHub credentials, so "CI green" is verified from the pull request's recorded
  check results and "merged" from the git graph (`develop` containing the branch head).

## 10. Revocation and review

Either founder may revoke or narrow this delegation at any time by a recorded
instruction. The policy is re-reviewed at every release gate alongside the
[Solo Developer Review Policy](./solo-developer-review-policy.md), and is expected to be
rewritten when a second qualified technical reviewer joins (the same reversion trigger
as that policy).
