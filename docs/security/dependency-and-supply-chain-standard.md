# Dependency and Supply-Chain Standard

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Adopted by owner instruction (2026-07-17); merged with the Phase 1-2 pull request (#5), which passed its Database Standards Gate on 2026-07-17 ·
**Owner:** Eng. Ezzaldeen Al-Bitar ·
**Review:** [Solo Developer Review Policy](../governance/solo-developer-review-policy.md)

---

## 1. Why this document exists

Software supply-chain failure is a first-class category in the pinned baseline —
**A03:2025** in the [OWASP Top 10:2025 matrix](./owasp-top-10-2025-matrix.md) — and the
subject of the SSDF v1.1 practices for protecting software and the toolchain (PS and PO
practice groups, paraphrased). This document records what actually protects this
repository's supply chain today, what does not exist yet, and who owns each gap.

## 2. Controls that exist today (each true and checkable)

| Control                         | State                                                                                                                                                                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Authoritative lockfile**      | `package-lock.json` is committed; it is the current dependency inventory                                                                                                                                                               |
| **`npm ci` binding**            | Docker builds and CI install with `npm ci`, never `npm install` ([SECURITY.md §7](../../SECURITY.md)) — installs cannot silently drift from the lockfile                                                                               |
| **Pinned runtime**              | Node 22 LTS version-pinned in the Dockerfile (`ARG NODE_VERSION=22-alpine`); host toolchain documented separately                                                                                                                      |
| **New-dependency rules**        | Binding: stated justification, licence check for commercial-product compatibility (no incompatible copyleft without owner decision), and technical-owner review before adoption. Prefer the standard library and existing dependencies |
| **Install-script caution**      | Unfamiliar packages are reviewed before adoption; install scripts from untrusted packages are a recognized risk                                                                                                                        |
| **Secret scanning of the tree** | Both scans exist and ran clean locally (RL-SEC-DB-012) — a compromised dependency cannot quietly commit a credential                                                                                                                   |
| **Pinned framework direction**  | Next.js 16.2.10 / React 19.2.4 / TypeScript 5 strict; changes are architecture decisions, not casual bumps                                                                                                                             |

## 3. Gaps — stated plainly, each with an owner

| Gap                                                                                                                                             | Status    | Owning decision / phase                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No automated dependency scanning (SCA).** No `dependabot.yml`, no `npm audit` gate in CI. No audit result is claimed clean — none is recorded | `Planned` | Adding Dependabot and/or an `npm audit` CI gate changes GitHub/CI configuration → owner approval; target **before the first backend phase** (Phases 1-13..1-24) or earlier by owner decision |
| **No SBOM.** The lockfile is an inventory, but no standard SBOM artifact (e.g., CycloneDX) is generated                                         | `Planned` | Required **before the first release**; tooling selection with the owners                                                                                                                     |
| **No digest pinning.** The base image is version-pinned, not digest-pinned — a re-tagged upstream image would be pulled silently                | `Planned` | Open hardening item recorded since Phase 1-1 in [security-readiness.md](../phase-1/phase-1-1/security-readiness.md)                                                                          |
| **No artifact/image signing or provenance attestation**                                                                                         | `Planned` | Ops phases; requires a registry and hosting decisions that do not exist yet                                                                                                                  |

## 4. Binding rules going forward

1. **The dependency gate joins CI before the first backend phase** (or earlier by owner
   decision). From that point, a `Critical`/`High` advisory affecting a shipped
   dependency is a finding under the
   [vulnerability-management-standard.md](./vulnerability-management-standard.md) and is
   handled by the same merge-blocking rules — fix, upgrade, or owner-approved
   time-bounded exception.
2. **Dependency review is part of code review.** A PR adding or upgrading a dependency
   states why, checks the licence, and looks at what the package pulls in transitively
   (dependency-confusion risk is judged there — `RL-ASVS-15.2.4`, selected L3).
3. **Lockfile changes are reviewed as code.** An unexplained lockfile diff is a finding.
4. **No new package manager.** npm only; pnpm/yarn require an owner decision.
5. **`npm audit` may be run manually at any time**; findings are triaged by the
   technical owner and recorded — including accepted ones — per
   [SECURITY.md §7](../../SECURITY.md).

## 5. Relationship to other documents

- [security-baseline.md](./security-baseline.md) — RL-SEC-DB-014 (dependency security
  gates, `Planned`) lives in its verified-controls table.
- [owasp-top-10-2025-matrix.md](./owasp-top-10-2025-matrix.md) — the A03 row this
  document implements.
- [owasp-asvs-5-matrix.md](./owasp-asvs-5-matrix.md) — V15.1/V15.2 rows (inventory,
  trusted repositories, dependency confusion).
- [secure-coding-standard.md](./secure-coding-standard.md) — rule R10.
- [SECURITY.md §7–§8](../../SECURITY.md) — the repository dependency and Docker
  policies this standard extends.

## 6. Honest limits

- **Nothing scans dependencies automatically today.** Until the SCA gate exists, a
  vulnerable transitive dependency would be found only by manual `npm audit` runs or
  outside news — that is the risk the `Planned` status names.
- The lockfile protects against drift, not against a malicious version that was already
  current when it was locked.
- No claim is made about the integrity of upstream registries; provenance controls
  arrive with the ops phases.
