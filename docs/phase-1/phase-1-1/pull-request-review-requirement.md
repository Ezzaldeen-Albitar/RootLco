# Pull Request Review Requirement — Status and Resolution Options

**Date:** 2026-07-16 · **Owner:** Eng. Ezzaldeen Al-Bitar (repository administrator) ·
**Related:** ADR-006; [phase-1-1-owner-gate.md](./phase-1-1-owner-gate.md);
[github-required-checks.md](./github-required-checks.md)

## The blocker

Pull request #1 (`chore/p1-01-development-readiness` → `develop`) reported, before it was
merged by the owner:

> At least 1 approving review is required by reviewers with write access.

The repository currently has one person with write access: Eng. Ezzaldeen Al-Bitar, who
authored the change. GitHub does not count a pull request author's own approval. With one
write-access collaborator and a one-approval rule, **no pull request in this repository can
ever be merged through the normal path** — the rule is unsatisfiable rather than merely
strict.

Pull request #1 has since been merged by the owner and `develop` is at `01bda69`. How that
merge satisfied or bypassed the rule was not observed from this environment and is not
assumed here. The requirement still applies to every subsequent pull request, including the
secret-scan fix, so it remains unresolved rather than moot.

**No approving review exists.** This document does not claim one, and none may be claimed
unless GitHub itself shows it.

## What the owners have already decided

The owners recorded the **Owner-Approved Combined-Role Model** in
[phase-1-1-owner-gate.md](./phase-1-1-owner-gate.md), assigning the technical, DevOps,
database, security-review and QA-execution authorities to Eng. Ezzaldeen Al-Bitar for the
current foundation stages, and stating plainly:

> The current review is an owner-authorized technical self-review and must not be
> represented as an independent external review.

That decision resolves conditional items C1 and C2 (independent QA ownership; independent
security reviewer) **for the foundation stages only**, as an accepted, disclosed risk. It
does **not** by itself decide how the pull-request approval rule should be configured — a
combined-role model can be delivered through either option below.

## Resolution options (owners' decision required)

Both keep governance intact. Neither disables a control.

### Option A — Add a second reviewer

Eng. Bilal Jradat is added as a collaborator with **Write** access and approves the pull
request.

- Preserves the one-approval rule exactly as written.
- Gives genuine four-eyes review on merges.
- **Prerequisite:** Eng. Bilal Jradat's GitHub username, which is not known and has
  deliberately not been invented (conditional item C3).
- Steps: Settings → Collaborators → Add people → grant **Write** → he reviews and approves
  the pull request.

### Option B — Temporary small-team rule

The owners explicitly approve a temporary rule in which:

- Pull requests remain **mandatory** — no direct pushes.
- CI status checks remain **mandatory**.
- Conversation resolution remains **mandatory**.
- Force pushes and branch deletion remain **blocked**.
- The required approving-review count is temporarily **0**, until a second reviewer with
  write access exists.

- Steps: Settings → Rules → Rulesets → open the ruleset → **Require a pull request before
  merging** → set **Required approvals** to `0` → keep every other control enabled → Save.
- This must be reverted to `1` the moment a second write-access reviewer is added.

### Recommendation (not a decision)

Option A is stronger and should be adopted as soon as C3 is answered. Option B is a
reasonable temporary measure that keeps every other control in force and makes the
governance honest rather than theatrical — a rule that cannot be satisfied provides no
protection and simply blocks all work.

## Decision record — owners only

| Field                     | Value                                                                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Option chosen             | ☑ **B (temporary zero-approval rule)** — formalized as the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)                      |
| Decided by                | Eng. Ezzaldeen Al-Bitar and Eng. Bilal Jradat (RootLco founders)                                                                                                 |
| Date                      | 2026-07-16 (communicated in the owners' Phase 1-2 authorization; recorded at their direction)                                                                    |
| If B: revert-to-1 trigger | A second qualified developer or reviewer with write access joins the project (Option A remains the preferred end state and still requires C3 — Bilal's username) |

> Applied state: the owners state that the required approving-review count is set to zero
> while pull requests, required CI checks, conversation resolution, force-push blocking,
> and branch-deletion blocking all remain enabled. The live GitHub ruleset was not
> inspected from the build environment (no GitHub CLI or API token is used there); keeping
> it aligned with this decision is the repository administrator's responsibility. No
> approving review is claimed for any merged pull request.
