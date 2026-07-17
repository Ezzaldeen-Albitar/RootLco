# OWASP Top 10:2025 Mapping Matrix

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Adopted by owner instruction (2026-07-17); merges with the Phase 1-2 pull request — the Phase 1-2 exit gate is not decided ·
**Owner:** Eng. Ezzaldeen Al-Bitar ·
**Review:** [Solo Developer Review Policy](../governance/solo-developer-review-policy.md)

---

## 1. Purpose

This matrix maps the ten categories of the **OWASP Top 10:2025** (category list
confirmed by direct fetch from owasp.org on 2026-07-17) to their RootLco owners,
statuses, and evidence. It is a **risk-awareness mapping** that complements the
requirement-level [ASVS matrix](./owasp-asvs-5-matrix.md); it is **not a compliance
claim** ([security-baseline.md §4](./security-baseline.md)). Category focus texts are
paraphrases; the authoritative descriptions are OWASP's.

Statuses follow the [baseline vocabulary](./security-baseline.md). Category-level rows
follow the same honesty rule as ASVS rows: a category whose full scope includes
application layers that do not exist yet is `Planned`, even where its database layer is
already implemented and test-verified — that verified evidence is cited in the row.

## 2. The matrix

| Category                                        | Focus (paraphrase)                                          | Applicability | Risk     | RootLco ID      | Owning phase                                                  | Owning module              | Implementation path                                                                                                                                                                               | Test ID                                                                                                                           | Evidence path                                                                                                                           | Status                                                                                                                                                        | Exception |
| ----------------------------------------------- | ----------------------------------------------------------- | ------------- | -------- | --------------- | ------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| A01:2025 Broken Access Control                  | Consumers act outside their intended permissions            | Applicable    | Critical | RL-T10-A01-2025 | Phases 1-13..1-24 (backend); database layer from Phase 1-2    | iam / database-foundation  | Forced default-deny RLS + server-resolved context (RL-SEC-DB-001/002/005/006); API-layer authorization in backend phases                                                                          | `tests/db/rls.test.ts :: "Tenant A cannot read Tenant B rows even when addressing them directly"` plus UPDATE/WITH CHECK variants | [phase-1-2-evidence-register.md](../phase-1/phase-1-2/phase-1-2-evidence-register.md)                                                   | Planned — the **database layer is implemented and test-verified today**; the API and frontend layers do not exist yet                                         | —         |
| A02:2025 Security Misconfiguration              | Insecure defaults, exposed configuration, missing hardening | Applicable    | High     | RL-T10-A02-2025 | Phases 1-13..1-24 (backend) + later ops phases                | platform-ops               | Hardened `public` schema, PUBLIC-EXECUTE revocation, non-root Docker, `.dockerignore`; hosted-environment hardening is future                                                                     | `tests/db/foundation.test.ts :: "module schemas contain EXACTLY the approved routines — nothing more"`                            | [phase-1-2-evidence-register.md](../phase-1/phase-1-2/phase-1-2-evidence-register.md) §4 (the PUBLIC-EXECUTE defect found and fixed)    | Planned — foundation hardening exists and is tested; environment configuration arrives with hosted environments                                               | —         |
| A03:2025 Software Supply Chain Failures         | Compromised dependencies, build tooling, or distribution    | Applicable    | High     | RL-T10-A03-2025 | Before first backend phase (gate); ops phases (SBOM, signing) | platform-ops               | [dependency-and-supply-chain-standard.md](./dependency-and-supply-chain-standard.md): lockfile + `npm ci` binding today; **no SCA, no SBOM, no digest pinning yet — stated plainly**              | —                                                                                                                                 | [SECURITY.md §7](../../SECURITY.md)                                                                                                     | Planned                                                                                                                                                       | —         |
| A04:2025 Cryptographic Failures                 | Weak or absent protection of data in transit and at rest    | Applicable    | High     | RL-T10-A04-2025 | Phases 1-13..1-24 (backend); TLS at ops phases                | api-backend / platform-ops | — assigned by owning phase (ASVS V11/V12 rows)                                                                                                                                                    | —                                                                                                                                 | —                                                                                                                                       | Planned                                                                                                                                                       | —         |
| A05:2025 Injection                              | Untrusted data changes the meaning of queries or commands   | Applicable    | Critical | RL-T10-A05-2025 | Phases 1-13..1-24 (backend)                                   | api-backend                | [secure-coding-standard.md](./secure-coding-standard.md): parameterized SQL binding today and practiced by the DB harness and migrations; application input boundaries arrive with backend phases | —                                                                                                                                 | —                                                                                                                                       | Planned                                                                                                                                                       | —         |
| A06:2025 Insecure Design                        | Missing threat modeling and secure-design decisions         | Applicable    | High     | RL-T10-A06-2025 | Every phase from 1-3 onward                                   | governance                 | [threat-modeling-standard.md](./threat-modeling-standard.md) — first formal threat model required at Phase 1-3                                                                                    | —                                                                                                                                 | [phase-1-2-evidence-register.md](../phase-1/phase-1-2/phase-1-2-evidence-register.md) §4.1 (the Phase 1-2 adversarial review precedent) | Planned                                                                                                                                                       | —         |
| A07:2025 Authentication Failures                | Broken login, credential, and identity confirmation flows   | Applicable    | Critical | RL-T10-A07-2025 | Phases 1-13..1-24 (backend); iam schema from Phase 1-4        | iam                        | — assigned by owning phase (ASVS V6/V7 rows; Supabase Auth configuration)                                                                                                                         | —                                                                                                                                 | —                                                                                                                                       | Planned                                                                                                                                                       | —         |
| A08:2025 Software or Data Integrity Failures    | Unverified updates, deserialization, tampered pipelines     | Applicable    | High     | RL-T10-A08-2025 | Phases 1-13..1-24 (backend) + ops phases                      | platform-ops               | Migration-immutability CI check (fail-closed) exists today; artifact signing/provenance is future                                                                                                 | `scripts/db/apply-migrations.mjs` rehearsal                                                                                       | [rehearsal-defective-migration.md](../phase-1/phase-1-2/rehearsal-defective-migration.md)                                               | Planned — the migration-pipeline integrity control is implemented and locally verified; the broader category (updates, deserialization, provenance) is future | —         |
| A09:2025 Security Logging and Alerting Failures | Attacks invisible for lack of logs and alerts               | Applicable    | High     | RL-T10-A09-2025 | Phases 1-13..1-24 (backend); ops phases (alerting)            | api-backend                | **No logging or alerting infrastructure exists yet — stated plainly.** ASVS V16 rows carry the requirements                                                                                       | —                                                                                                                                 | —                                                                                                                                       | Planned                                                                                                                                                       | —         |
| A10:2025 Mishandling of Exceptional Conditions  | Errors and edge cases that fail open or leak internals      | Applicable    | High     | RL-T10-A10-2025 | Phases 1-13..1-24 (backend)                                   | api-backend                | Fail-closed precedent set in Phase 1-2 (the CI immutability check was found failing open and fixed); application error handling arrives with backend phases                                       | —                                                                                                                                 | [phase-1-2-evidence-register.md](../phase-1/phase-1-2/phase-1-2-evidence-register.md) §4                                                | Planned                                                                                                                                                       | —         |

## 3. Reading notes

- **A01 is the category this product's foundation was built around**: tenant isolation
  is enforced at the database with forced, default-deny RLS and verified by cross-tenant
  negative tests executed as a non-owner role. The row is still `Planned` because the
  category is application-wide and the application layers are unbuilt — the honest
  status rule of [security-baseline.md §6](./security-baseline.md).
- **A03 and A09 are the frankest rows**: no dependency scanning and no logging
  infrastructure exist today. Both have named owning phases and standards.

## 4. Relationship to other documents

- [security-baseline.md](./security-baseline.md) — status vocabulary, Security Gate, and
  the verified `RL-SEC-DB` control table this matrix cites.
- [owasp-asvs-5-matrix.md](./owasp-asvs-5-matrix.md) — the requirement-level view behind
  every category row.
- [owasp-api-top-10-2023-matrix.md](./owasp-api-top-10-2023-matrix.md) — the API-specific
  companion.

## 5. Honest limits

- Category rows are awareness-level; only the ASVS matrix carries requirement-level
  verification.
- All evidence cited is owner-authorized self-review; no independent verification
  exists; no GitHub Actions run exists for this branch yet.
- This matrix makes no statement about Zoom Vehicle Inspection and Evaluation Services
  (outside Phase 1).
