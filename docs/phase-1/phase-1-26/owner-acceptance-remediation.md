# Phase 1-26 — Owner Acceptance Remediation

**Classification:** Confidential — Commercial Product and Pilot Planning

**Status: CLOSED — OWNER ACCEPTANCE: PASS, 2026-08-04**

The Product Owner tested the running application by hand and returned
`OWNER ACCEPTANCE: PASS`. That is the condition §5 of this record set, it is the
only thing that could close this phase, and it has been met.

The closure record is `closure-record.md`.

---

## 1. Why this record exists

P1-26 was recorded as technically closed on 2026-08-03 against protected
`develop` `0ad993cc8e728b700bd20c59d41c84074f4e8b04`. That record — `gate-record.md`
— remains valid **as a technical gate**, and nothing in it is withdrawn.

The Product Owner subsequently required that no Frontend phase may be formally
closed until the complete system runs locally, a usable account exists, the Owner
can sign in, every delivered screen can be inspected by hand, real API
integration is exercised, and the Owner explicitly records Pass.

P1-26 did not meet that bar, and **its own final report said so**. The report
listed, unprompted, five things that were not proven:

1. Cross-tenant behaviour end to end with a real authenticated account.
2. The eleven Administration screens in a real browser with a real Backend session.
3. Automated accessibility scanning of those authenticated screens.
4. Owner manual acceptance.
5. Integration of the Owner-supplied logo assets.

The first three were recorded as blocked by the no-fake-data policy: proving them
needs a real account in a real tenant, and seeding one was forbidden. The Product
Owner has now **explicitly authorised synthetic, local-only acceptance data**,
which removes the blocker rather than the requirement.

P1-26 is therefore reopened for **Owner Acceptance Remediation**.

## 2. What is and is not withdrawn

|                                                            |                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------ |
| The technical gate record (`gate-record.md`)               | **Preserved.** Accurate as a record of technical verification      |
| The historical Feature PR #174 and merge `fd0c2324`        | **Preserved.** Not rewritten, not reverted                         |
| The historical gate-record PR #175 and merge `0ad993cc`    | **Preserved**                                                      |
| The 44 findings and their dispositions                     | **Preserved**                                                      |
| The claim of _final_ P1-26 closure                         | **Superseded.** It was a technical closure recorded as a final one |
| The line `PHASE 1-26 OFFICIALLY CLOSED — 100/100 VERIFIED` | **Withdrawn** until the Owner records Pass                         |

The prior evidence is reclassified, not invalidated: it is **technical
verification evidence**, and it was never Owner acceptance evidence. The error
was in the label, not in the measurements.

## 3. What this remediation adds

| Gap                                                    | What closes it                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Owner logo assets unintegrated                         | Both approved PNGs wired through the single brand authority — `logo-integration-evidence.md`            |
| No usable account                                      | A real local-only account with the full approved permission set — `local-acceptance-account-runbook.md` |
| Screens never seen authenticated                       | All eleven exercised against the real API in installed Chrome — `authenticated-browser-evidence.md`     |
| No authenticated accessibility scan                    | axe over every authenticated route — `authenticated-accessibility-evidence.md`                          |
| Cross-tenant behaviour unproven                        | A second synthetic tenant with no membership — `cross-tenant-evidence.md`                               |
| No Owner acceptance step                               | A checklist and an explicit decision — `owner-acceptance-checklist.md`                                  |
| Fixtures and the clean-database invariant in conflict  | An executable lifecycle that keeps both true — `npm run acceptance:full-cycle`, `P1-26-F-057`           |
| A reset that could not be trusted                      | Catalogue-driven discovery over 232 tenant-scoped tables — `P1-26-F-056`                                |
| Development and production sharing one build directory | Isolated `distDir`, and the phantom defect it had already produced — `P1-26-F-055`                      |

## 4. The boundary this remediation does not cross

Local-only synthetic acceptance data is authorised. That authorisation does
**not** extend to production data, customer data, historical migrations, new
schema, production Supabase, production Auth users, deployment, release or
tagging. No business row is committed: the fixtures are created at runtime, by a
script that refuses to run against anything but a loopback local database.

The permanent no-fake-data policy is unchanged and still holds, because it is a
policy about what **ships**, and nothing here ships. `check-no-fake-data.mjs`
scans tracked files; no tracked file gains a business record.

## 5. Closure condition — MET

P1-26 closes when, and only when, the Product Owner responds with:

```
OWNER ACCEPTANCE: PASS
```

A conditional pass or a fail is recorded with its conditions or defects and
remediated before closure. **Silence is not Pass.**

**On 2026-08-04 the Product Owner returned exactly that**, against protected
`develop` `02eb4842`, after testing the running application by hand. Unconditional:
no conditions were attached and no defects were reported.

The canonical status of this phase is therefore:

**CLOSED — OWNER ACCEPTANCE: PASS**

The condition was never relaxed to reach it. It was asked four separate times
across the remediation and answered once, by the Owner, at the end — which is the
whole point of a rule that says silence is not Pass.

See `closure-record.md` for what was accepted and what remains open.
