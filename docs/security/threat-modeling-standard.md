# Threat Modeling Standard

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Adopted by owner instruction (2026-07-17); merged with the Phase 1-2 pull request (#5), which passed its Database Standards Gate on 2026-07-17 ·
**Owner:** Eng. Ezzaldeen Al-Bitar ·
**Review:** [Solo Developer Review Policy](../governance/solo-developer-review-policy.md)

---

## 1. When a threat model is required

A threat model is produced **before implementation starts** in every phase that adds any
of the following:

- a new database schema or a new table family (Phase 1-3 onward),
- a new module,
- a new external interface (API surface, file upload, webhook, integration),
- a new trust boundary (a new role, a new environment, a new party handling data).

A phase that adds none of these records that judgment in its evidence register instead
of producing an empty model.

**The first formal threat-model document under this standard is required at
Phase 1-3** (the `org` schema). None exists yet — see §6.

## 2. Method

Lightweight and repeatable, not ceremonial. Each model answers the four framing
questions popularized by the Threat Modeling Manifesto (paraphrased): what are we
building, what can go wrong, what are we doing about it, and did we do enough?

Concretely:

1. **Scope statement** — what the phase builds, in one paragraph.
2. **Data-flow sketch** — components, data stores, and **trust boundaries** drawn
   explicitly. **The tenant-isolation boundary is always in scope**, in every model,
   for every phase — it is the product's defining security property
   ([ADR-004](../adr/ADR-004-mandatory-row-level-security-direction.md)).
3. **Threat table** — STRIDE per trust boundary (spoofing, tampering, repudiation,
   information disclosure, denial of service, elevation of privilege). One row per
   credible threat; "not credible here because X" is a legitimate, recordable outcome.
4. **Mitigations mapped to requirements** — every mitigation cites the `RL-` requirement
   ID(s) it satisfies ([security-baseline.md §5](./security-baseline.md)) and the test
   that will prove it ([security-testing-standard.md](./security-testing-standard.md)).
5. **Residual risks** — anything consciously accepted goes to the owners; if accepted,
   it is recorded in the
   [security-exceptions-register.md](./security-exceptions-register.md) with expiry and
   stop condition. Unaccepted residual risks are findings under the
   [vulnerability-management-standard.md](./vulnerability-management-standard.md).

## 3. Artifact and storage

One markdown file per phase: `docs/phase-1/phase-1-<n>/threat-model.md`, versioned with
the phase branch, reviewed under the Solo Developer Review Policy, and listed in the
phase's evidence register. The model is a living document within its phase: findings
discovered during implementation are appended, not hidden.

## 4. How findings flow

Threat-table rows that lack a mitigation become findings with a severity from
[security-baseline.md §7](./security-baseline.md). Critical findings block the phase's
merge; High findings need an owner-approved, time-bounded exception. The phase gate
checks the model exists, covers the tenant boundary, and has no unresolved
Critical/High rows — this is part of the Security Gate.

## 5. NIST SSDF alignment

This standard implements, in paraphrase, the SSDF v1.1 practices for designing software
to meet security requirements and assessing threats early (PW.1) and for defining
security requirements before development (PO.1/PO.5 in spirit): threats are assessed
per phase, before code, against documented requirements.

## 6. Retrospective honesty — what exists today

**No formal threat-model document exists yet.** Phase 1-2 predates this standard's
adoption. What Phase 1-2 did run was a **four-lens adversarial self-review**
(phase scope · database security · internal consistency · evidentiary honesty) against
the finished branch, recorded in the
[evidence register §4.1](../phase-1/phase-1-2/phase-1-2-evidence-register.md). That
review served the same defect-finding purpose for the database foundation — it found a
PUBLIC-EXECUTE grant defect, a guard bypass, and a fail-open CI check, all fixed
pre-merge — but it was post-implementation review, not design-time threat modeling, and
it is not presented as a threat model. Phase 1-3 starts the real series.

## 7. Relationship to other documents

- [security-baseline.md](./security-baseline.md) — requirement IDs, severities, gate.
- [security-testing-standard.md](./security-testing-standard.md) — every mitigation's
  proof.
- [vulnerability-management-standard.md](./vulnerability-management-standard.md) —
  unmitigated threats are findings.
- [security-exceptions-register.md](./security-exceptions-register.md) — accepted
  residual risks.
- [rls-standard.md](../database/rls-standard.md) — the standing mitigation on the
  tenant boundary.

## 8. Honest limits

- Threat models under this standard are produced and reviewed by the same person under
  the Solo Developer Review Policy; that is a disclosed structural weakness of the
  method until an independent reviewer exists (P1-EC-016).
- STRIDE-per-boundary at this depth finds design-level issues; it is not a substitute
  for penetration testing (none has been performed) or code audit (none has been
  performed).
