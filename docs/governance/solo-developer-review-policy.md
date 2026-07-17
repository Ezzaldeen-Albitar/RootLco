# Solo Developer Review Policy

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Active — owner-approved · **Approved by:** Eng. Ezzaldeen Al-Bitar and
Eng. Bilal Jradat (RootLco founders) · **Approval date:** 2026-07-16 ·
**Recorded:** 2026-07-16, at the owners' direction ·
**Related:** ADR-006; [phase-1-1-owner-gate.md](../phase-1/phase-1-1/phase-1-1-owner-gate.md);
[pull-request-review-requirement.md](../phase-1/phase-1-1/pull-request-review-requirement.md);
[standing-technical-authorization-policy.md](./standing-technical-authorization-policy.md)

---

## Solo Developer Review Policy

Eng. Ezzaldeen Al-Bitar is currently the sole software developer,
technical reviewer, QA reviewer, security reviewer, and repository
administrator.

Pull Requests and successful CI checks remain mandatory.

The required approving-review count is temporarily set to zero because
GitHub does not allow a pull-request author to approve their own work
and no second technical reviewer is currently assigned.

This policy will be revisited when another qualified developer or
reviewer joins the project.

## Clarifications (binding)

- This is an **owner-approved combined-role operating model** (see the
  Owner-Approved Combined-Role Model in the
  [Phase 1-1 owner gate](../phase-1/phase-1-1/phase-1-1-owner-gate.md)).
- It does **not** claim that an independent review was performed. No document in this
  repository may describe work reviewed under this policy as independently reviewed.
- Technical self-review must be documented with evidence: what was checked, how, and with
  what result, in the phase evidence registers.
- Pull Requests remain **mandatory**. All work reaches `develop` through a pull request.
- CI checks remain **mandatory**. A failed check blocks the merge and must not be bypassed.
- Direct work on `main` remains **prohibited**.
- Direct work on `develop` remains **prohibited**, except documented
  repository-administration emergencies, which must be recorded with reason and date.
- Force pushes and protected-branch deletion remain **prohibited**.
- Security and QA findings must **not** be hidden because the same person implemented and
  reviewed the work. A finding is recorded, fixed, or accepted as a disclosed risk — never
  silently dropped.
- An independent review may be introduced before production release, when the team
  expands, or when the owners request it.
- This policy must be **reviewed at every release gate**.

## Repository rules under this policy

The governing configuration for the protected branches (`main` and `develop`) under this
policy is:

| Rule                            | Value       |
| ------------------------------- | ----------- |
| Required approving reviews      | **0**       |
| Required Pull Request           | **enabled** |
| Required CI checks              | **enabled** |
| Require conversation resolution | **enabled** |
| Block force pushes              | **enabled** |
| Block branch deletion           | **enabled** |

> Honesty note on verification: the ruleset itself lives in GitHub and was not inspected
> from the build environment (no GitHub CLI or API token is used there). The values above
> are the owner-approved policy state, stated by the repository administrator in the
> Phase 1-2 authorization of 2026-07-16. The repository administrator is responsible for
> keeping the live GitHub ruleset aligned with this table, including the required-check
> names documented in
> [github-required-checks.md](../phase-1/phase-1-1/github-required-checks.md).

## Standing technical authorization (2026-07-17)

The [Standing Technical Authorization Policy](./standing-technical-authorization-policy.md)
builds on this policy: for **routine technical phases**, the documented self-review
required here, plus green mandatory CI, plus the pull-request merge into `develop` by
Eng. Ezzaldeen Al-Bitar, **constitute the phase gate decision** — recorded
automatically as **Go — Technical Gate Passed**, with the merge as the recorded
approval event. No repeated checkbox, signature, separate owner-gate message, or
per-phase approval from Eng. Bilal Jradat is required for routine technical work.
Decisions reserved to the founders jointly (listed in that policy §5) are unchanged.

## Reversion trigger

The required approving-review count returns to **1** (and this policy is retired or
rewritten) as soon as a second qualified developer or reviewer with write access joins the
project — see Option A in
[pull-request-review-requirement.md](../phase-1/phase-1-1/pull-request-review-requirement.md),
which remains the preferred end state.
