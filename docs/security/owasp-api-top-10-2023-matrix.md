# OWASP API Security Top 10:2023 Mapping Matrix

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Adopted by owner instruction (2026-07-17); merged with the Phase 1-2 pull request (#5), which passed its Database Standards Gate on 2026-07-17 ·
**Owner:** Eng. Ezzaldeen Al-Bitar ·
**Review:** [Solo Developer Review Policy](../governance/solo-developer-review-policy.md)

---

## 1. Purpose

This matrix maps the **OWASP API Security Top 10 (2023 edition)** categories to their
RootLco owners and statuses. **No business API exists today** — the only route handlers
are `/`, `/_not-found`, and `/api/health` — so every category is honestly `Planned` and
owned by the backend phases (Phases 1-13..1-24). The matrix exists **now** so that the
backend phases inherit explicit, pre-assigned obligations rather than discovering them.

It is a risk-awareness mapping complementing the requirement-level
[ASVS matrix](./owasp-asvs-5-matrix.md) (chiefly chapters V4, V8, V9); it is **not a
compliance claim**. Focus texts are paraphrases.

## 2. The matrix

| Category                                                  | Focus (paraphrase)                                      | Applicability | Risk     | RootLco ID        | Owning phase                                     | Owning module             | Implementation path                                                                                                                                                                                                                               | Test ID                                                                                                                           | Evidence path                                                                            | Status                                                                    | Exception |
| --------------------------------------------------------- | ------------------------------------------------------- | ------------- | -------- | ----------------- | ------------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------- |
| API1:2023 Broken Object Level Authorization               | Object IDs manipulated to reach other consumers' data   | Applicable    | Critical | RL-API-API1-2023  | Phases 1-13..1-24; database layer from Phase 1-2 | iam / database-foundation | **Defense-in-depth already exists at the data layer**: forced default-deny RLS means an API handler that forgets an object-level check still cannot cross tenants (RL-SEC-DB-001/002/006); API object-level checks arrive with the backend phases | `tests/db/rls.test.ts :: "Tenant A cannot read Tenant B rows even when addressing them directly"` plus UPDATE/WITH CHECK variants | [phase-1-2-evidence-register.md](../phase-1/phase-1-2/phase-1-2-evidence-register.md)    | Planned — database layer implemented and test-verified; API layer unbuilt | —         |
| API2:2023 Broken Authentication                           | Flawed token, credential, or session validation         | Applicable    | Critical | RL-API-API2-2023  | Phases 1-13..1-24; iam schema from Phase 1-4     | iam                       | — assigned by owning phase (Supabase Auth configuration; ASVS V6/V7/V9 rows)                                                                                                                                                                      | —                                                                                                                                 | —                                                                                        | Planned                                                                   | —         |
| API3:2023 Broken Object Property Level Authorization      | Reading or writing fields the consumer should not touch | Applicable    | High     | RL-API-API3-2023  | Phases 1-13..1-24                                | api-backend               | Column-restricted grants already practiced at the data layer (`UPDATE (next_value, current_period)` only); API property filtering arrives with backend phases                                                                                     | `tests/db/rls.test.ts :: "cannot INSERT (no grant, no policy — provisioning is admin-only)"`                                      | [phase-1-2-evidence-register.md](../phase-1/phase-1-2/phase-1-2-evidence-register.md)    | Planned                                                                   | —         |
| API4:2023 Unrestricted Resource Consumption               | Missing rate, size, and cost limits                     | Applicable    | High     | RL-API-API4-2023  | Phases 1-13..1-24                                | api-backend               | — assigned by owning phase (rate limiting, pagination, payload limits)                                                                                                                                                                            | —                                                                                                                                 | —                                                                                        | Planned                                                                   | —         |
| API5:2023 Broken Function Level Authorization             | Consumers invoking admin or foreign functions           | Applicable    | Critical | RL-API-API5-2023  | Phases 1-13..1-24                                | iam                       | EXECUTE-revocation precedent at the data layer (allocator callable only by granted roles); API function-level checks arrive with backend phases                                                                                                   | `tests/db/rls.test.ts :: "an unprivileged login cannot execute the allocator (PUBLIC EXECUTE revoked)"`                           | [phase-1-2-evidence-register.md](../phase-1/phase-1-2/phase-1-2-evidence-register.md) §4 | Planned                                                                   | —         |
| API6:2023 Unrestricted Access to Sensitive Business Flows | Business flows abused at scale (e.g., mass booking)     | Applicable    | High     | RL-API-API6-2023  | Phases 1-13..1-24                                | api-backend               | — assigned by owning phase (anti-automation on business flows; ASVS 2.4)                                                                                                                                                                          | —                                                                                                                                 | —                                                                                        | Planned                                                                   | —         |
| API7:2023 Server Side Request Forgery                     | Server made to fetch attacker-chosen URLs               | Applicable    | High     | RL-API-API7-2023  | Phases 1-13..1-24                                | api-backend               | **No outbound-fetch application code exists today**; the rule lands with the first integration                                                                                                                                                    | —                                                                                                                                 | —                                                                                        | Planned                                                                   | —         |
| API8:2023 Security Misconfiguration                       | Missing hardening across the API stack                  | Applicable    | High     | RL-API-API8-2023  | Phases 1-13..1-24 + ops phases                   | platform-ops              | Foundation hardening exists (hardened `public` schema, nothing-more allow-list tests); API/CORS/header configuration arrives with backend phases                                                                                                  | `tests/db/foundation.test.ts :: "no extension exists outside the approved + environment allow-lists"`                             | [phase-1-2-evidence-register.md](../phase-1/phase-1-2/phase-1-2-evidence-register.md)    | Planned                                                                   | —         |
| API9:2023 Improper Inventory Management                   | Unknown, undocumented, or zombie API endpoints          | Applicable    | Medium   | RL-API-API9-2023  | Phases 1-13..1-24                                | governance                | — assigned by owning phase (endpoint inventory, versioning policy); precedent: the database keeps a nothing-more object inventory enforced by tests                                                                                               | —                                                                                                                                 | —                                                                                        | Planned                                                                   | —         |
| API10:2023 Unsafe Consumption of APIs                     | Trusting third-party API responses blindly              | Applicable    | Medium   | RL-API-API10-2023 | Phases 1-13..1-24                                | api-backend               | — assigned by owning phase (validate and bound third-party data; relevant to future integrations)                                                                                                                                                 | —                                                                                                                                 | —                                                                                        | Planned                                                                   | —         |

## 3. Reading notes

- The recurring pattern is deliberate: **the data layer already refuses what the API
  layer might one day forget to refuse.** Forced RLS (API1), column-restricted grants
  (API3), and EXECUTE revocation (API5) are verified today as defense-in-depth beneath
  APIs that do not exist yet.
- Every row stays `Planned` until the backend phases produce API-level tests — the
  database evidence never substitutes for them.

## 4. Relationship to other documents

- [security-baseline.md](./security-baseline.md) — vocabulary, gate, and the verified
  `RL-SEC-DB` controls cited here.
- [owasp-asvs-5-matrix.md](./owasp-asvs-5-matrix.md) — requirement-level detail (V4 API
  and Web Service, V8 Authorization, V9 Tokens).
- [owasp-top-10-2025-matrix.md](./owasp-top-10-2025-matrix.md) — the general companion.

## 5. Honest limits

- No API exists; nothing in this matrix is verified at the API layer, and no row may be
  upgraded without API-level test evidence.
- All cited evidence is database-layer, owner-authorized self-review; no independent
  verification exists; no GitHub Actions run exists for this branch yet.
