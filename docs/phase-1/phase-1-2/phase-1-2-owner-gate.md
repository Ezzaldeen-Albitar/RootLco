# Phase 1-2 Gate — Database Standards Gate

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-2 — Database Architecture and Engineering Standards ·
**Gate package assembled:** 2026-07-16 · **Gate mechanics updated:** 2026-07-17 ·
**Decision: Go — Technical Gate Passed (2026-07-17)** — see the decision record below ·
**Review model:** [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)
under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
— the submitted evidence is owner-authorized technical self-review, not independent review.
Both policies are re-reviewed at this gate (their own standing rule).

## Purpose and rules

This is the decision record for the Phase 1-2 exit gate.

Phase 1-2 is a **routine technical phase**. Under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
(adopted 2026-07-17), its gate decision is **constituted by verified facts, not by a
separate approval ceremony**: when the five gate conditions below are all satisfied,
the decision is recorded automatically as **Go — Technical Gate Passed**, with the pull
request merge by Eng. Ezzaldeen Al-Bitar as the recorded technical approval event. No
additional checkbox, signature, owner-gate message, or approval from Eng. Bilal Jradat
is required for this routine technical gate.

- **Phase 1-3 (organization-structure schema) begins only after the Go is recorded
  here** — which happens automatically once the merge is proven **and** the CI result is
  evidenced, not upon a promise of either.
- The record is completed **only from evidenced facts**: the merge commit proven
  reachable from `develop`, and the mandatory check conclusions either read directly or
  supplied by the repository administrator (each labelled with its provenance below). It
  is never completed from intention, never before the merge, and never from a merge
  alone.
- Escalation remains possible: if any pause trigger of the standing policy §6 fires
  (CI cannot go green; a Critical finding; a High finding needing risk acceptance; a
  reserved owner decision), this gate stops being automatic and the escalation is
  recorded below.

## What is submitted

The full package on branch `feature/p1-02-database-engineering-foundation`:

- **Migrations 0001–0003** (extensions; schemas/roles/context; number sequences) —
  applied to a clean PostgreSQL 17.6 four times during the phase, most recently with the adversarial-review hardening (REVOKE of PUBLIC function EXECUTE; regression-guard CHECK).
- **68 passing database tests** (RLS default-deny and tenant isolation as a non-owner
  runtime role; FORCE RLS; constraint templates positive+negative; append-only history;
  idempotency pattern; 50-worker allocation concurrency — the approved baseline, not
  reduced).
- **Twelve controlled standards documents**, the populated data dictionary, and the
  evidence corpus: [initial audit](./initial-audit.md) ·
  [readiness checklist](./phase-1-2-readiness-checklist.md) (34 items: 33 Complete · 1 Complete-Doc) ·
  [evidence register](./phase-1-2-evidence-register.md) ·
  [traceability register](./traceability.md) ·
  [defective-migration rehearsal](./rehearsal-defective-migration.md) ·
  [completion report](./phase-1-2-completion-report.md).
- **CI extended** with the clean-database migration-validation job (Phase 1-1 jobs
  untouched).
- **Phase 1-1 closure** and the Solo Developer Review Policy, recorded and
  cross-referenced.
- **The security-baseline package** (owner instruction, 2026-07-17): ten controlled
  documents under `docs/security/`, pinning OWASP ASVS v5.0.0 (Level 2 target; selective
  Level 3), OWASP Top 10:2025, OWASP API Security Top 10:2023, NIST SSDF v1.1, and OWASP
  SAMM v2.0.3 (future) — including a **345-row ASVS requirement matrix built from the
  pinned upstream tag** with honesty-validated statuses, the verified database controls
  RL-SEC-DB-001..014 with named test evidence, and an empty security-exceptions
  register. **No OWASP compliance is claimed.**
- **The governance package** (owner instruction, 2026-07-17): the
  [Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
  and the [phase-gate record template](../../governance/phase-gate-record-template.md),
  with the cross-reference updates across CONTRIBUTING, SECURITY, the review policy,
  ownership and branch-governance records.

## What was weighed (stated plainly)

1. **The pull request's CI run was the outstanding proof — it has since been supplied.**
   Every check passed locally, and at assembly time no GitHub Actions run existed. PR #5
   has since run and merged, and the owner inspected its four mandatory checks in GitHub
   and confirms they passed on the final source commit `dae6681`. Condition 1 closes on
   that **Owner-verified** evidence, not on an observation made from the build
   environment (see the provenance note below).
2. **Everything is self-reviewed** under the owner-approved policies. The review did
   find and fix real defects before merge (pad-overflow truncation,
   analytics-container failure, CRLF gate breakage, PUBLIC-EXECUTE revocation,
   guard-bypass hardening, fail-open CI check) — evidence it had teeth — but it remains
   one person.
3. **Deferred by design:** composite FKs on `shared.number_sequences` scope columns
   (Phase 1-3, with `org.*`); the permanent `shared.idempotency_keys` table (first
   business-operation phase); ruleset alignment of required-check names now includes
   the new job name `Database migrations and RLS tests`
   (see [github-required-checks.md](../phase-1-1/github-required-checks.md)).
4. **No business tables, no Benzene hard-coding, no Zoom objects** — verified by
   automated guard and grep, restated in the completion report.

## Required-checks note for the repository administrator

When aligning the branch ruleset, the four reported check names are:
`Lint, types, tests, build` · `Docker build validation` ·
`Database migrations and RLS tests` · `Secret and sensitive-file scan`.
A stale hand-entered name in the ruleset blocks the merge silently — see
[github-required-checks.md](../phase-1-1/github-required-checks.md).

## Gate conditions (Standing Technical Authorization §2) — status as of 2026-07-17

| #   | Condition                                                              | Status                                                                                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | All mandatory CI checks green on the pull request                      | **Satisfied (Owner-verified)** — the repository owner inspected PR #5's checks directly in GitHub and confirms all four mandatory checks completed successfully on the final Phase 1-2 source commit `dae6681` (2026-07-17). Provenance below. |
| 2   | No unresolved Critical security finding                                | **Satisfied** — zero known ([vulnerability-management-standard.md](../../security/vulnerability-management-standard.md) §5)                                                                                                                    |
| 3   | No unresolved High finding without an approved, time-bounded exception | **Satisfied** — zero known; the [exceptions register](../../security/security-exceptions-register.md) is empty                                                                                                                                 |
| 4   | Documented technical self-review completed by Eng. Ezzaldeen Al-Bitar  | **Satisfied** — [evidence register](./phase-1-2-evidence-register.md) (incl. the four-lens adversarial pass, §4.1) and the readiness checklist                                                                                                 |
| 5   | Pull request merged into `develop` by Eng. Ezzaldeen Al-Bitar          | **Satisfied** — PR #5 merged 2026-07-17 14:02:36 +0300 by `Ezzaldeen-Albitar`; merge commit `e5fa5bf`; final source head `dae6681` proven an ancestor of `origin/develop` via `git merge-base --is-ancestor`                                   |

### Provenance of the condition-1 evidence (stated precisely)

What closed condition 1, and what did not:

- **The CI conclusions are Owner-verified, not machine-verified from this environment.**
  The repository owner, Eng. Ezzaldeen Al-Bitar, **inspected pull request #5's checks
  directly in GitHub** and confirms that all four mandatory checks —
  `Lint, types, tests, build` · `Docker build validation` ·
  `Database migrations and RLS tests` · `Secret and sensitive-file scan` — completed
  successfully on the final Phase 1-2 source commit `dae6681`. The build environment
  holds no GitHub credentials (no CLI, no token; an unauthenticated fetch of the private
  pull request returns HTTP 404), so **no check-run conclusion was read here and no
  claim is made that this environment queried GitHub.** The verification is the owner's;
  the authoritative run results live in GitHub Actions.
- **The merge did not close this condition.** A successful merge is not evidence of
  green CI: the required-check names in
  [github-required-checks.md](../phase-1-1/github-required-checks.md) may still be the
  stale ones (`quality`, `docker`, `secrets` — names GitHub never reports), so a merge
  could proceed without the four checks being enforced. Condition 1 rests on the owner's
  direct inspection above, and on nothing else.
- **Local runs are corroboration, not the evidence.** Every CI step was executed locally
  on the merged tree and passed (recorded in the
  [evidence register](./phase-1-2-evidence-register.md)). That is local evidence; the
  condition requires the remote run.

**On the authority for closing condition 1 this way — stated without dressing it up.**
The Standing Technical Authorization Policy, as written on 2026-07-17, did **not**
provide for closure on evidence the build environment cannot read. Its §2 said the record
is completed against verified facts and "if the facts cannot be verified, the record
stays pending", and its §9 said "CI green" is verified from the pull request's recorded
check results. Those sentences assumed an access this environment does not have. The
sentence naming the administrator-supplied path was **this gate document's own**
(recorded at `31fb699`), not the policy's, and a self-authored sentence is not governance
authority.

That gap has been closed the honest way rather than by reinterpretation: the policy now
carries **§2.1 Evidence provenance**, added by owner instruction on 2026-07-17, which
defines the **Proven** / **Owner-verified** / **Owner-stated** labels used in the table
above, forbids any agent describing an owner-supplied fact as its own observation, and
forbids closing a condition by citing a rule that does not exist. Condition 1 is closed
under that amended clause, with its provenance on the face of the record. It is not a
claim of independent review, and it is not a claim that this environment observed the run.

## Decision record

**Decision: Go — Technical Gate Passed**

- **Decision:** **Go — Technical Gate Passed**
- **Technical authority:** Eng. Ezzaldeen Al-Bitar (delegated technical and execution
  authority, [Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md) §1)
- **CI evidence:** all four mandatory pull request #5 checks were **visually verified as
  successful by the repository owner** in GitHub, on the final Phase 1-2 source commit
  `dae6681` (**Owner-verified**, 2026-07-17 — not read by the build environment; see the
  provenance note above)
- **Phase 1-2 merge commit:** `e5fa5bf9bcc43ba62a0b6c0c0fd558bf0a539db8`
- **Merge date:** **2026-07-17 14:02:36 +0300**
- **Merge target:** `develop`
- **Review model:** owner-authorized technical self-review
  ([Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)) —
  never independent review
- **Final Phase 1-2 source commit:** `dae668196e002245f71d4dc3698f444996f6c74a`
  (**Proven** an ancestor of `origin/develop` and of `origin/main` via
  `git merge-base --is-ancestor`)
- **Environment template status:** `.env.example` restored, tracked, not ignored, and
  placeholder-only — **verified present in both `origin/develop` and `origin/main`**
  (blob `5a9bbbc516f8992ab27b20a2fa86446fffa0c094`, byte-identical across all three
  branches). See the note below.

All five conditions of the standing policy §2 are satisfied. **No further signature,
checkbox, owner-gate message, or approval from Eng. Bilal Jradat is required** for this
routine technical gate. **Phase 1-3 (organization-structure schema) is authorized to
begin.**

This gate record remains owner-authorized self-review under the
[Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
Recording a Go does not convert it into an independent review, and P1-EC-016
(independent security reviewer before production release) remains open.

## Environment template on `main` (defect found, fixed, and verified)

`.env.example` was deleted from `main`'s line by pull request #4 (`60549c4`, merged in
`4de14f5`). The deletion never reached `develop`, so `develop` kept the file. The
`develop` → `main` promotions #6 and #8 did **not** restore it: git's three-way merge
resolves a path deleted on one side and unchanged on the other as deleted, and a further
promotion would not have repaired it either. For a period, `main` therefore lacked
`.env.example` while `README.md`, `docs/phase-1/phase-1-1/docker-runbook.md`,
`CODEOWNERS`, and `.dockerignore` on `main` all still referenced it, and the documented
`cp .env.example .env.local` step could not work from a `main` checkout.

**Resolved.** Branch `fix/main-restore-env-example` restored the file byte-for-byte from
`origin/develop` (commit `d9e71cd`, no edit of any kind); it merged to `develop` via
PR #9 (`c37984e`) and reached `main` via PR #10 (`11ede2c`) on 2026-07-17. Verified from
the remote trees: blob `5a9bbbc` present in `origin/develop` and `origin/main`.
`.gitignore` was not changed — the rules were already correctly ordered (`.env`,
`.env.*`, then `!.env.example`) — and `.env`, `.env.local`, `.env.production`,
`.env.development`, `.env.test` and `supabase/.env` all remain ignored and untracked.

## Decisions reserved to the founders (not covered by the automatic record)

None of Phase 1-2's content touches a reserved decision (no production, no customer
data, no pricing/contract, no material financial commitment, no major
commercial-scope change). Should that assessment be wrong, the standing policy §5
governs: the affected item requires Eng. Bilal Jradat's explicit approval and is
escalated rather than auto-recorded.

## Canonical document synchronization (administrative — does not block this gate)

Per the standing policy §7, DOCX synchronization is an administrative post-merge task:

- **Master document:** updated in place to revision 0.4 on 2026-07-17 (hash recorded in
  [canonical-documents.md](../../governance/canonical-documents.md)).
- **Phase 1 plan:** the B.5 / 1.0-rc3 update is prepared and validated; application is
  **pending** the next documentation window (the file is held open by a Microsoft Word
  session; the lock is never forced). This pending state does not block the merge, this
  gate, or Phase 1-3. Final synchronization is required before production release or
  formal external delivery.
