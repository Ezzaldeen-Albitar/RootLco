# Technical Ownership Record — Phase 1-1

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Active · **Phase:** 1-1 (Source-of-Truth Validation and Development Readiness) ·
**Recorded:** 2026-07-16 · **Related tasks:** P1-01-SEC-003, P1-01-DOC series

---

## 1. Purpose

This document records who owns what in the technical delivery of Phase 1-1, and states
honestly where ownership is concentrated, where it is shared, and where it is **not yet
assigned**. It exists so that the phase gate is assessed against the real ownership
situation, not an assumed one. Where this record and the canonical Word documents
disagree, the canonical documents win (see `docs/governance/canonical-documents.md`).

## 2. Technical ownership — Eng. Ezzaldeen Al-Bitar

Eng. Ezzaldeen Al-Bitar (GitHub: `Ezzaldeen-Albitar`) holds the following roles:

| Role                          | Scope                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| Technical Lead                | Overall technical direction and day-to-day technical decisions.                     |
| Solution Architecture Owner   | Architecture decisions and the ADR register (`docs/adr/`).                          |
| Repository Administrator      | GitHub repository administration, branch strategy, access control.                  |
| Development Owner             | Application code, code quality gates, development workflow.                         |
| Database Engineering Owner    | PostgreSQL/Supabase schema direction, migrations, seed policy.                      |
| Backend Owner                 | Server-side application logic and API surface.                                      |
| Frontend Owner                | UI implementation, styling architecture (Sass/SCSS), accessibility direction.       |
| DevOps Owner                  | Docker, Compose, local environment, CI/CD direction, push/branch tooling.           |
| Security Implementation Owner | Implementation of security controls (secret hygiene, scanning, dependency posture). |

These roles are held by a **single person**. That concentration is recorded as a risk in
section 5 rather than presented as a strength.

## 3. Joint business ownership — Eng. Ezzaldeen Al-Bitar and Eng. Bilal Jradat

Eng. Ezzaldeen Al-Bitar and Eng. Bilal Jradat are jointly the **Product Owners**. The
following decisions require **joint final business approval** by both owners:

- Scope approval, including any change to Phase 1 scope or the Phase 1-1 task set.
- Business decisions, including product naming ([PRODUCT NAME — Pending Final Approval]
  remains undecided — OIR-01/ASM-01) and brand/visual identity (no visual identity is
  approved; all current colours are neutral defaults — OIR-06).
- Phase-gate approval, including the Phase 1-1 exit decision against the entry criteria
  register (P1-EC-001..022, defined in the canonical Phase 1 plan).
- Commercial and pilot decisions, including all decisions concerning Benzene Vehicle
  Services (بنزين لخدمات المركبات) as the first configured pilot tenant. Benzene is a
  customer, never an owner, and is onboarded by configuration only.

Neither owner approves gated business decisions alone.

## 4. QA ownership — honest statement

- Technical tests (lint, typecheck, format, stylelint, Vitest suite, build, container
  verification) are currently **executed by Eng. Ezzaldeen Al-Bitar**, who also wrote the
  code under test.
- **Independent QA ownership is NOT assigned.** No named QA owner, independent of the
  implementation, exists at the time of writing.
- This is recorded as a **conditional-gate risk**: Phase 1-1 evidence of test execution is
  real and reproducible, but it is self-verified. The phase gate must weigh this
  explicitly rather than treat executed tests as independently assured quality.

### Concentration-of-roles risk (stated plainly)

All technical roles in section 2, and test execution in this section, rest on one person.
The consequences are: no independent technical challenge to design or implementation
decisions, no second person able to verify claims without ramp-up, a single point of
failure for continuity, and self-review as the only current review of technical work.
This risk is accepted for Phase 1-1 only because the codebase is deliberately small; it
is not acceptable as a steady state and must be revisited at the phase gate.

## 5. Security review ownership — honest statement (P1-01-SEC-003 outcome)

- A **Security Implementation Owner exists**: Eng. Ezzaldeen Al-Bitar implements security
  controls. Implementation ownership is **not the same as independent review**.
- An **independent named security reviewer is NOT evidenced.**
- A **named security exception authority is NOT evidenced.**
- A **named security incident contact is NOT evidenced.**

This is the recorded outcome of P1-01-SEC-003 and is a **candidate blocker for
P1-EC-016** at the Phase 1-1 gate. No document in this repository may claim that an
independent security review took place until a named reviewer is appointed and their
review is evidenced.

## 6. Open input required

| Item                                                                 | Detail                                                                                                                                           | Owner of the answer     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| GitHub username of Eng. Bilal Jradat                                 | Unknown. Held as a **placeholder in a CODEOWNERS comment only**. It must be supplied by Eng. Bilal Jradat and must never be guessed or invented. | Eng. Bilal Jradat       |
| Independent QA owner                                                 | Not assigned (section 4).                                                                                                                        | Product Owners, jointly |
| Independent security reviewer, exception authority, incident contact | Not evidenced (section 5).                                                                                                                       | Product Owners, jointly |

## 7. Change control

Changes to this record require agreement of both Product Owners for the business roles in
section 3, and of Eng. Ezzaldeen Al-Bitar for the technical roles in section 2. Any
appointment that resolves an item in section 6 must be recorded here with a date.
