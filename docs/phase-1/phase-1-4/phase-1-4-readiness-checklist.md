# Phase 1-4 Readiness Checklist

**Company:** RootLco · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential · **Phase:** 1-4 · **Date:** 2026-07-18

| #   | Item                                                                           | State                         |
| --- | ------------------------------------------------------------------------------ | ----------------------------- |
| 1   | Phase 1-3 gate commit `f748d1c` contained in `develop` before start            | ✅ verified                   |
| 2   | 9 migrations `20260718090000..098000` apply from empty                         | ✅                            |
| 3   | `0001–0003` and `20260717…` byte-identical to develop                          | ✅                            |
| 4   | Additive `org.departments` key via forward migration (no edit of merged file)  | ✅                            |
| 5   | 19 tables / 14 functions / 25 triggers / 21 policies — exact allow-lists green | ✅                            |
| 6   | Full DB suite green on clean reset                                             | ✅ 311/311                    |
| 7   | No credential / token / MFA secret / plaintext IP or user-agent                | ✅ structural scans           |
| 8   | Deny precedence persisted and resolved                                         | ✅                            |
| 9   | Scoped grants: deferred ≥1-scope; cross-tenant/company rejected                | ✅                            |
| 10  | Money NUMERIC(18,4), non-overlapping, immutable                                | ✅                            |
| 11  | Audit SHA-256 chain: append/mask/tamper/gap/orphan/concurrency                 | ✅                            |
| 12  | Audit reads permission-gated; unauthorized → zero rows                         | ✅                            |
| 13  | Context helpers safe on unset/invalid/cross-tenant                             | ✅                            |
| 14  | Permission catalog + baseline roles seeded (fictional tenant only)             | ✅ idempotent                 |
| 15  | No Benzene role/user/assignment; no Phase-1-5 object                           | ✅                            |
| 16  | No SECURITY DEFINER; FORCE RLS; no BYPASSRLS; DELETE-nowhere                   | ✅                            |
| 17  | Data dictionary + ERD-relevant docs updated; every column classified           | ✅ coverage test              |
| 18  | Adversarial review complete; one minor finding fixed (orphan detection)        | ✅                            |
| 19  | Format / lint / typecheck / style / build / scope / secret scans green         | ✅ (final clean-room)         |
| 20  | Pull request opened, CI green, merged into develop                             | ⏳ **pending** (owner/manual) |

**Blockers to Go:** only #20 — the PR run and merge, which are external
(no `gh` CLI / token in this environment). Everything else is satisfied and
test-backed.

## Phase 1-5 forward correction (2026-07-18)

Item 14 records the Phase 1-4 evidence as it existed and is not rewritten.
Increment M subsequently removed tenant roles from seed 04: only the structural
permission catalog is seeded now. The same six-role and mapping assertions are
preserved with an ephemerally provisioned tenant in `iam-seeds.test.ts`, followed
by cascade cleanup. Clean seeded state contains no tenant roles.
