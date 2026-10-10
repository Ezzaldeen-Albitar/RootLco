# DBCR-P1-32-PRE-OD-FD2C-001 — credit-approval permission and credit-note approval limits

**Company:** RootLco — Root Link Company · **Classification:** Confidential — Commercial Product
and Pilot Planning · **Phase:** 1-32 (preparatory) — Owner directive, finance decision D13 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)).
**This is not an independent third-party review, and no approval of this migration is recorded
here.** It implements Owner decision D13 of 2026-09-30 as recorded in
[ADR-023](../../adr/ADR-023-sales-and-finance-policy-decisions.md); applying it to any existing
database is a separate, rehearsed step.

- **Migration:** `supabase/migrations/20261001090000_sal_credit_approval_limits.sql` (the 165th)
- **Seed change:** one permission code, `sal.credit.approve`, in
  `supabase/seeds/04_iam_permission_catalog.sql`. **Policy change:** none. **Grant change:** none.
- **Executable proof:** `tests/db/sal-credit-approval-limits.test.ts` (the permission in the note
  scope, a credit-note limit set by somebody else in the note currency, a discount limit never
  counting, a self-set limit never counting, the cumulative anti-splitting total, two approvals on
  one invoice serialising on its row lock, rejection needing the permission and no limit, the
  unchanged withdrawal, another tenant refused, the runtime login unable to forge the approver or a
  limit's creator or amount, the minor-unit and above-zero rules, and one credit-note limit per
  currency), `tests/db/sal-credit-note-decisions.test.ts` (the D3 rules on the re-issued guard),
  `tests/db/foundation.test.ts` (routine and trigger inventory),
  `tests/db/p1-15-shared-services-runtime-capabilities.test.ts` (migration census), and
  `tests/backend/od-finance-credit-limits.test.ts` (the operations end to end).
- **Rollback classification:** **ROLLBACK-SAFE WITH DATA NOTE** — the inverse is in the migration
  footer; the narrower exclusion constraints can be restored only while no subject holds two
  overlapping credit-note limits in different currencies.

---

## 1. Why this change request exists

A credit note had no amount authority: any holder of `sal.credit.manage` who was not the requester
approved any amount, while a discount was held to `iam.approval_limits` (finance review M-02). The
Owner's decision D13: reuse the approval-limit mechanism with explicit credit-approval permissions and
limits, never inherited from discount amounts, with currency, tenant and branch scope, separation of
duties, and protection against splitting a credit or approving concurrently to bypass a limit.

## 2. What changes

| Object                                              | Change                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ex_approval_limits_role_no_overlap`                | Dropped and re-created under its own name with one more key, `CASE WHEN limit_type = 'credit_note' THEN currency_code ELSE '' END`: every other type keeps the key it had; a credit-note limit is keyed by its currency.                                                                                                                         |
| `ex_approval_limits_user_no_overlap`                | The same, for a person's limit.                                                                                                                                                                                                                                                                                                                  |
| `iam.guard_approval_limit_money()`                  | NEW trigger function behind `tg_approval_limits_money` (BEFORE INSERT): a new limit fits its currency's minor unit (`approval_limit_minor_unit`); a credit-note limit is above zero (`approval_limit_not_positive`). An unknown currency and a negative amount are left to the foreign key and the CHECK. `SECURITY INVOKER`, empty search_path. |
| `sal.guard_credit_note_decision()`                  | Re-issued with the same identity. An approval additionally needs `sal.credit.approve` in the note's company and branch, takes the invoice row lock, and needs a credit-note limit in the note currency, not created by the approver, covering every approved credit on the invoice plus this note. A rejection needs `sal.credit.approve`.       |
| `sal.reject_credit_note`, `sal.approve_credit_note` | Comments rewritten; bodies unchanged.                                                                                                                                                                                                                                                                                                            |
| `iam.approval_limits`                               | Table comment rewritten.                                                                                                                                                                                                                                                                                                                         |

No row is written, moved or deleted, and stored limits are not re-validated.

## 3. Refusal tokens

Each refusal carries a stable token before the first colon, which the application translates into a
named, recorded refusal: `credit_approval_permission_missing` (SQLSTATE 42501),
`credit_no_approval_limit`, `credit_limit_self_created`, `credit_limit_currency_mismatch`,
`credit_limit_exceeded`, `approval_limit_minor_unit`, `approval_limit_not_positive` (23514), and the
re-worded `credit_note_reject_permission_missing` (42501).

## 4. Applying it

The migration is forward-only and writes no row; the new permission reaches an existing database
through the idempotent seed. Granting the code to an existing organisation's standard administrator
is the operator backfill, run only for the named QA organisations after a backup and a rehearsal;
credit-note limits are then set by each organisation's administrator. None of this is performed by
the pull request.
