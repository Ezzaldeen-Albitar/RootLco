# ADR-006: Git Branching and Protected Main

## Status

Accepted by owner instruction (branching model and the single authorised bootstrap exception).

Branch protection enforcement on `main` is **Blocked** — it cannot be applied from the current workstation and has not been applied.

## Context

RootLco (Root Link Company) is developing a commercial multi-tenant automotive CRM and ERP platform, currently carrying the placeholder product name [PRODUCT NAME — Pending Final Approval]. The work is hosted in the private repository `github.com/Ezzaldeen-Albitar/RootLco`, classified "Confidential — Commercial Product and Pilot Planning".

Phase 1-1, "Source-of-Truth Validation and Development Readiness", requires that repository readiness be verified before implementation work begins (P1-01-DO-001) and that repository access control be classified alongside the Phase 1 plan set (P1-01-SEC-004). A defined branching model is a precondition for both: without one, there is no agreed answer to where implementation commits land, what a reviewable change looks like, or what state `main` is expected to represent.

Three facts constrain the decision:

1. The repository was empty at creation. Git cannot create a branch from an unborn `main`, so at least one commit had to exist on `main` before `develop` or any working branch could be cut from it.
2. The GitHub CLI is not installed on the technical owner's workstation and no GitHub token is available. Branch protection rules and pull requests are configured through the GitHub API or web interface; neither is reachable from the current tooling.
3. Independent QA ownership is not assigned. Technical tests are currently executed by Eng. Ezzaldeen Al-Bitar, who is also the author of the implementation work. This weakens the review value of a pull request gate, because approver and author may be the same person.

The current branch state, as measured, is:

| Branch                              | Purpose                               | State                                   |
| ----------------------------------- | ------------------------------------- | --------------------------------------- |
| `main`                              | Release-representing permanent branch | Bootstrap root commit `a6e0af4`, pushed |
| `develop`                           | Integration permanent branch          | Pushed                                  |
| `chore/p1-01-development-readiness` | Phase 1-1 working branch              | Local working branch                    |

## Decision

The repository adopts a two-permanent-branch model with prefixed short-lived working branches.

**Permanent branches.** `main` and `develop` are permanent and are never deleted. `main` represents released or release-candidate state. `develop` is the integration branch and is the parent of all working branches.

**Working branches.** Every unit of work is carried out on a short-lived branch cut from `develop`, named with a type prefix followed by a task or scope identifier, for example `chore/p1-01-development-readiness`. Working branches are deleted after merge.

**Pull request target.** All pull requests target `develop`. No pull request targets `main` except a deliberate release promotion of `develop` into `main`.

**Protection of `main`.** `main` never receives direct implementation commits. Implementation reaches `main` only by promotion of an integrated `develop`.

**The one authorised exception.** Commit `a6e0af4` on `main` is the bootstrap root commit. It was made directly to `main` because no branch can be created from an unborn `main`; there was no `develop` to branch from and no `develop` could exist until `main` had a commit. The exception is bounded in three ways: it is a single commit, it is the root commit, and it contains only `README`, `LICENSE`, and `.gitignore`. It contains no application code, no schema, no migration, and no configuration. No further direct commit to `main` is authorised under this exception, and the exception does not generalise to any subsequent bootstrap-shaped situation.

**Enforcement status.** Branch protection on `main` — requiring pull requests, blocking direct pushes, and blocking force pushes — is **not applied**. It is blocked by the absence of the GitHub CLI and of any GitHub token. It must be applied manually by the repository administrator through the GitHub web interface. Until then the branching model is a convention enforced by discipline, not by the platform.

## Alternatives Considered

**Trunk-based development with a single `main` branch.** All work commits to or merges rapidly into `main`, with release branches cut on demand. Rejected because it depends on an automated test suite and a merge gate that can reject a bad change within minutes. No CI pipeline is running, the unit test suite that exists is deliberately minimal because Phase 1-1 carries almost no application code, and branch protection cannot currently be applied. Under those conditions trunk-based development degrades to unreviewed commits landing directly on the branch that is supposed to represent releasable state — precisely the outcome this ADR exists to prevent. It remains a reasonable future option once CI and protection are in place.

**Full Gitflow with `release/*` and `hotfix/*` branches in addition to `main` and `develop`.** Rejected as premature. Gitflow's release and hotfix branches exist to allow parallel stabilisation of an outgoing version while the next version continues on `develop`. There is no released version, no production environment, and no user of a released version to hotfix. Only the Local environment is being implemented; Development, Staging, and Production are planned and not provisioned. Adding those branch types now would create ceremony with no corresponding event to justify it. If and when a production deployment exists, this ADR may be superseded by one that adds them.

**Committing implementation directly to `main` and deferring the branching model until CI exists.** Rejected because it inverts the dependency. The branching model is cheap to adopt now and expensive to retrofit once history is polluted with direct commits; CI can be added to an existing model at any time. It would also make P1-01-DO-001 unanswerable, since there would be no defined repository state to verify readiness against.

## Consequences

**Benefits.**

- `main` has a defined meaning: it represents release state, and its history is reviewable as such.
- Every change has a review surface — a branch and a pull request into `develop` — which is a precondition for the review evidence Phase 1 requires.
- Working-branch names are traceable to Phase 1 task identifiers, so history can be read against the plan.
- Adding CI later requires no change to the branching model; the pull request into `develop` is already the natural place to attach checks.

**Negative consequences and trade-offs.**

- **The model is currently unenforced.** Branch protection is blocked. Nothing at the platform level prevents a direct push to `main` or a force push that rewrites it, including by accident. The stated protection of `main` is an intention, not a control, and must not be represented as applied in any readiness or security evidence.
- **The pull request gate has no independent approver.** With QA ownership unassigned and Eng. Ezzaldeen Al-Bitar acting as both author and reviewer, a pull request into `develop` provides a record of the change but not independent scrutiny of it. This is a real weakness in the control, not a formality, and is recorded openly as a conditional-gate item rather than treated as satisfied.
- **Two permanent branches cost more than one.** Every change requires a branch, a pull request, and a merge, and `develop` must periodically be promoted to `main`. With a single-developer team this overhead buys structure and traceability rather than coordination, which is a weaker justification than it would be for a larger team.
- **`develop` and `main` will drift.** Until a promotion happens, `main` reflects only the bootstrap commit while all real state lives on `develop`. Anyone reading `main` in the interim will see a repository that appears nearly empty. This is expected and must not be misread as a fault.
- **The bootstrap exception is a permanent artefact of history.** Commit `a6e0af4` is a direct commit to `main` and will always be visible as one. Any future audit of "no direct commits to `main`" must be qualified by this documented exception rather than returning a clean result.

## Security Impact

The repository is private and classified "Confidential — Commercial Product and Pilot Planning" (P1-01-SEC-004). The branching model contributes to repository access control in intent but not yet in enforcement.

- **Unprotected `main` is an open security finding.** Without branch protection, `main` can be force-pushed or rewritten. There is currently no platform control preventing loss or silent alteration of the branch that is meant to represent release state. This must be recorded as Blocked and Open, never as applied.
- **No secrets in the bootstrap commit.** Commit `a6e0af4` contains only `README`, `LICENSE`, and `.gitignore`. The `.gitignore` is the first line of defence against committed secrets and is present from the root commit forward, which supports P1-01-SEC-005 (verify no secrets or fabricated compliance claims). This ADR asserts no scanning result and claims no compliance certification.
- **Security ownership is not confirmed.** Per P1-01-SEC-003, unconfirmed security ownership is recorded against P1-EC-016 as blocking. The absence of an assigned security owner is one reason the manual application of branch protection has no confirmed accountable party beyond the technical owner.
- **Review is not an independent control.** As noted under Consequences, author and reviewer are currently the same person. Pull requests into `develop` should be treated as a traceability record, not as an independent security review, until QA ownership is assigned.

## Operational Impact

- **Manual action required by the repository administrator.** Branch protection on `main` must be configured through the GitHub web interface: require a pull request before merging, block direct pushes, and block force pushes. This cannot be scripted from the current workstation and remains outstanding.
- **Pull request creation is blocked from the workstation.** Without the GitHub CLI or a token, pull requests must be raised through the GitHub web interface. Any Phase 1 evidence referring to pull requests must reflect this constraint.
- **Day-to-day flow.** Branch from `develop` with a type prefix and task identifier; commit; push; raise a pull request into `develop` via the web interface; merge; delete the working branch. Promotion of `develop` into `main` is a deliberate, separate act.
- **Interaction with tenant onboarding.** Benzene Vehicle Services (بنزين لخدمات المركبات) is the first customer, first subscribed tenant, and first pilot. It is onboarded through configuration and seed data only. No branch, merge, or release step is tenant-specific, and no branch may exist to carry tenant-specific hard-coding.
- **Out of scope.** No branch, pull request, or release step in Phase 1 relates to Zoom Vehicle Inspection and Evaluation Services, which is future work outside Phase 1.
- **Revisit trigger.** This ADR should be revisited when branch protection is applied, when CI checks become available to attach to the pull request gate, or when independent QA ownership is assigned. Any of those events materially changes the strength of the controls described here.

## Related Phase 1 Task and Requirement IDs

| ID            | Relationship                                                                                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-01-DO-001  | Verify repository readiness — this ADR defines the branching model and records the bootstrap exception and the unapplied protection that readiness verification must account for. |
| P1-01-SEC-004 | Classify Phase 1 plan set sensitivity and repository access control — the unprotected `main` is part of the access-control picture.                                               |
| P1-01-SEC-005 | Verify no secrets or fabricated compliance claims — bootstrap commit contents and the `.gitignore` from the root commit are relevant evidence; no scan result is claimed here.    |
| P1-01-SEC-003 | Verify security ownership or record P1-EC-016 as blocking — no confirmed accountable party for applying branch protection.                                                        |
| P1-EC-016     | Entry criterion recorded as blocking pending confirmation of security ownership.                                                                                                  |
| P1-01-DOC-012 | Development-readiness checklist for the 22 entry criteria — the blocked branch protection item belongs on that checklist.                                                         |
| P1-01-QA-009  | Verify the development-readiness checklist — must verify that branch protection is recorded as Blocked and not as applied.                                                        |
| P1-01-DOC-014 | Produce the Architecture Decision Register — this ADR is a member of that register.                                                                                               |

## Decision Owner

Eng. Ezzaldeen Al-Bitar (technical and IT owner) — branching model, bootstrap exception, and branch protection requirement, as technical decisions.

Eng. Ezzaldeen Al-Bitar and Eng. Bilal Jradat (jointly) — any decision to promote `develop` to `main` as a release, which is a business and commercial decision, and any future decision to relax the protection of `main`.

## Date

2026-07-16
