# Phase 1-4 Evidence Register

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-4 · **Date:** 2026-07-18 · **Recorded by:** Eng. Ezzaldeen Al-Bitar
(owner-authorized self-review — [policy](../../governance/solo-developer-review-policy.md))

Every entry was executed on 2026-07-18 on the development host (Windows 11,
Node 24.16.0, Docker 29.5.3, PostgreSQL 17.6). Provenance labels follow the
Standing Technical Authorization Policy §2.1.

## 1. Base and containment (Proven)

Branch `feature/p1-04-identity-access-and-scope-schema` from `origin/develop`
`d41a747`; the Phase 1-3 gate commit `f748d1c` is contained in `develop`
(verified before start).

## 2. Migrations and objects (Proven)

Nine migrations `20260718090000..098000` + one seed. **19 new tables, 14 new
functions, 25 new triggers, 21 new RLS policies.** Migrations `0001–0003` and all
`20260717…` are byte-identical to `develop`; the only change to a Phase-1-3 table
is the additive `org.departments` composite key via a new forward migration.

## 3. Test suite (Proven)

**311 tests in 23 files, all passing on a clean `supabase db reset`.** The 194
Phase 1-2/1-3 tests are preserved; **117 new** Phase-1-4 tests. Per new file:
iam-accounts 19, iam-roles 14, iam-grants 13, iam-approvals 10, iam-sessions 10,
iam-audit 12, shared-status 10, iam-permissions 15, iam-hardening 7, iam-seeds 7
(= 117 new across the ten files; with the 194 preserved Phase 1-2/1-3 tests this
totals 311). Every isolation assertion runs as the NON-OWNER runtime login.

## 4. Security properties proven by test

| Property                                                              | Evidence                                                    |
| --------------------------------------------------------------------- | ----------------------------------------------------------- |
| No credential/token/plaintext-network column in any iam table         | structural scans (iam-accounts, iam-sessions)               |
| Deny precedence (BR-IAM-001)                                          | iam-roles data-level + iam-permissions resolution           |
| Scoped grants: cross-tenant/cross-company rejected; deferred ≥1-scope | iam-grants (composite FK + `SET CONSTRAINTS ALL IMMEDIATE`) |
| Self-grant / scope-widening denied                                    | iam-grants (`granted_by<>user_id`, immutable `scope_mode`)  |
| Context spoofing / invalid-UUID / cross-tenant → deny                 | iam-permissions                                             |
| Money is NUMERIC(18,4), non-overlapping, immutable                    | iam-approvals                                               |
| Login/session hashes only; own-row + permission-gated admin view      | iam-sessions, iam-hardening                                 |
| Audit hash chain: append, mask, tamper, gap, **orphan**, concurrency  | iam-audit (12)                                              |
| Audit read requires `iam.audit.view`; unauthorized → zero rows        | iam-hardening                                               |
| No SECURITY DEFINER; FORCE RLS; no BYPASSRLS; DELETE-nowhere          | iam-hardening + global org-security guards                  |

## 5. Adversarial review (2026-07-18)

A focused adversarial pass ran real probes over the nine migrations and the
live database against the §37 checklist (credentials, tokens, plaintext network,
tenant isolation, RLS/FORCE, runtime ownership, BYPASSRLS, SECURITY DEFINER,
search_path, deny precedence, self-grant, scope widening, cross-tenant mappings,
approval overlap, mutable audit/history, unmasked restricted, chain fork, hash
canonicalization, unauthorized reads, duplicate idempotency, Benzene logic,
Phase-1-5 objects, missing classifications).

| #   | Severity | Finding                                                                                                                                                                                     | Disposition                                                                                                                                                                                         |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | minor    | `iam.audit_verify_chain` validated the LINKED chain but would not detect a forged `audit_records` row inserted with a fresh `seq` and no integrity link (a fabrication, not an alteration). | **Fixed.** verify_chain now also asserts `count(records) = linked count`; an orphan record returns `{ok:false, reason:'orphan_record'}`. New test `iam-audit › detects a forged record … (orphan)`. |

All other checklist categories: **clean** (probes returned none; the properties
in §4 are test-backed). No credential/token/plaintext-network column; no
SECURITY DEFINER; no BYPASSRLS; no crm/veh Phase-1-5 object; no Benzene literal
in any migration/function/policy; every column classified (dictionary coverage
test passes).

## 6. CI (honest status)

The `Database migrations and RLS tests` CI job applies all migrations from a
clean database and runs the full `test:db` suite (now 311), plus the migration
immutability diff; the secrets job runs the scope-exclusion guard, credential
scan, and browser-secret check. **No GitHub Actions run exists for this branch
yet** — CI is not claimed green until the pull request's run reports.

## 7. Honest limits carried

Solo review throughout (P1-EC-016 open). Login/session issuance, MFA, IdP
integration, audit-read access logging, and privileged-grant different-actor
approval enforcement are Phase-1-14 — the DB defines and access-controls the
shapes, it does not claim those runtime controls exist. A superuser/BYPASSRLS DB
role can still write audit rows; the chain is the detection control.

## Phase 1-5 forward correction (2026-07-18)

The Phase 1-4 IAM seed counts above are historical evidence. Increment M strips
tenant fixtures from seed 04 while retaining every catalog, role-shape, mapping,
allow-only, idempotence, and no-user/grant assertion in ephemeral tests.
