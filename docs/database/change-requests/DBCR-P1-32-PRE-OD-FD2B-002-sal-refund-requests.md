# DBCR-P1-32-PRE-OD-FD2B-002 — refund requests, the second approver and the payout record

**Company:** RootLco — Root Link Company · **Classification:** Confidential — Commercial Product
and Pilot Planning · **Phase:** 1-32 (preparatory) — Owner directive, finance decision D2, part 2 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)).
**This is not an independent third-party review, and no approval of this migration is recorded
here.** It implements part 2 of Owner decision D2 of 2026-09-30 as recorded in
[ADR-023](../../adr/ADR-023-sales-and-finance-policy-decisions.md); applying it to any existing
database is a separate, rehearsed step.

- **Migration:** `supabase/migrations/20261008140000_sal_refund_requests.sql` (the 186th)
- **Seed change:** `supabase/seeds/04_iam_permission_catalog.sql` mints `sal.refund.approve` (risk
  high). **Permission change:** approving and rejecting a refund request declare it; requesting,
  withdrawing and recording the payout declare `sal.payment.record`; every refund read and command
  also declares `sal.finance.view`. **Role bundle or backfill:** the standard tenant administrator
  bundle carries the code for new organisations (98 codes); existing organisations keep their set
  (CC-OD-58); the operator backfill grants it only to the named QA organisations, after the seed,
  dry run first.
- **Executable proof:** `tests/db/sal-refund-requests.test.ts` (born pending and stamped; a raw
  INSERT held to every rule — currency, payee, minor unit, excess, reason; an inactive method; the
  requester's permission; a repeated key; one live request per obligation, and two requests racing
  on committed rows with one winner; self-approval through the primitive and a raw UPDATE; a decider
  without `sal.refund.approve`; rejection with a reason, withdrawal by the requester only, every
  decision frozen; the payout only once approved, by the approved method, with a day not in the
  future, once, with one `refund_executed` event; two payouts racing with one winner; the obligation
  settled exactly when paid out in full, and settling or cancelling by hand refused; a raw payout
  left unsettled or without its event refused at commit; forced RLS by tenant and
  `sal.finance.view`; no DELETE; the update grant limited to five columns; the facts frozen for every
  role), `tests/db/sal-credit-note-decisions.test.ts` (the obligation's settled transition),
  `tests/db/foundation.test.ts` (inventory), `tests/db/p1-15-shared-services-runtime-capabilities.test.ts`
  (census), `tests/backend/od-finance-refund-requests.test.ts` (end to end through the routes).
- **Rollback classification:** **ROLLBACK-SAFE WHILE `sal.refund_requests` IS EMPTY**;
  roll-forward-only once a request exists. The inverse is in the migration footer and refuses to run
  while any request exists.

## 1. Why this change request exists

Part 1 (DBCR-P1-32-PRE-OD-FD2A-001) records that a customer is owed money back. Nothing could pay it
back: no request, no second approver and no record of a payout existed, so an obligation stayed
open for ever. The Owner's decision D2: approving a refund and paying it out are separate acts with
a second approver, and duplicate or excess refunds are refused, safely under concurrency. Accounting
effects — refund accounts, ledger postings, cash or bank movement, tax and period close — stay out of
scope until the accounting questionnaire is answered.

## 2. The change

| Object                                                                     | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sal.refund_requests`                                                      | NEW table: tenant, company, branch, obligation, invoice, payee, currency, amount (`numeric(18,4)`, above zero), payment method (tenant row), reason, approval state, requester and request time, approver and time, decider, time and reason, executor, time, payout reference and day, the two idempotency keys, `record_version`. Fourteen CHECKs; composite foreign keys; a partial unique index of the live request per obligation; partial unique indexes of the two keys. ENABLE + FORCE RLS. |
| `sal.guard_refund_request_insert()`                                        | NEW BEFORE INSERT guard: stamps the requester and time and births the row pending; locks the obligation; holds the permission, open-obligation, one-live-request, invoice, payee, currency, amount, minor-unit, excess, method and reason rules.                                                                                                                                                                                                                                                    |
| `sal.guard_refund_request_update()`                                        | NEW BEFORE UPDATE guard for every role: facts frozen; approval and rejection by a different holder of `sal.refund.approve` in scope; withdrawal by the requester; decisions frozen; the payout once, on an approved request, by a holder of `sal.payment.record`, within what is still owed under the obligation lock; executor and time stamped; a paid-out row frozen.                                                                                                                            |
| `sal.guard_refund_request_settlement()`                                    | NEW deferred constraint trigger function: at commit after a payout, the obligation is settled exactly when what has been paid out reaches its amount.                                                                                                                                                                                                                                                                                                                                               |
| Triggers                                                                   | NEW `tg_refund_requests_insert_rules`, `tg_refund_requests_rules`, `tg_refund_requests_touch_metadata` and the deferred constraint triggers `tg_refund_requests_settlement` and `tg_refund_requests_event_completeness`.                                                                                                                                                                                                                                                                            |
| Primitives                                                                 | NEW `sal.request_refund`, `sal.approve_refund_request`, `sal.reject_refund_request`, `sal.withdraw_refund_request`, `sal.execute_refund_request` — each locks the obligation before the request; `EXECUTE` for `app_runtime` only.                                                                                                                                                                                                                                                                  |
| Policies and grants                                                        | `sel_`, `ins_` and `upd_refund_requests_gated`: tenant, company and branch reach with `sal.finance.view`. `app_runtime`: SELECT, INSERT and UPDATE of `approval_state`, `decision_reason`, `payout_reference`, `payout_date`, `execution_idempotency_key`; `app_readonly`: SELECT; no DELETE.                                                                                                                                                                                                       |
| `sal.guard_refund_obligation_update()`                                     | Re-issued: `open -> settled` admitted when the payouts equal the amount (`refund_obligation_not_paid_out` otherwise); every other state change refused; `cancelled` unreachable.                                                                                                                                                                                                                                                                                                                    |
| `sal.financial_events`                                                     | `ck_financial_events_event_type` admits `refund_executed` and `ck_financial_events_source_type` admits `refund_request`; table comment restated (no event is an accounting entry).                                                                                                                                                                                                                                                                                                                  |
| `sal.guard_financial_event_provenance()`, `sal.guard_event_completeness()` | Re-issued with one more branch each: the event is bound to the paid-out request's amount and currency, and required at commit.                                                                                                                                                                                                                                                                                                                                                                      |
| Comments                                                                   | `sal.refund_obligations` table and `state` column restated.                                                                                                                                                                                                                                                                                                                                                                                                                                         |

**Concurrency.** Every primitive locks the obligation row before the request, and the insert guard
takes the same lock, so two requests on one obligation serialise and the second meets the first
(the partial unique index is the backstop); two payouts of one request serialise and the second
finds it paid out. The excess check reads the paid-out sum under that lock at request and again at
payout.

## 3. Measured effect

Replayed from empty through all 186 migrations on a throwaway `postgres:17-alpine` container on
`127.0.0.1:55457` with `scripts/db/apply-migrations.mjs` and seeded twice with
`npm run validate:seed-state`: `scripts/ci/migration-replay-checks.mjs --phase post` reported, against
the 185 baseline, `tables` 281 (was 280), `functions` 679 (was 671), `policies` 813 (was 810),
`triggers` 667 (was 662) and the permission count 135 (was 134); `security_definer` stayed 0.
`scripts/db/schema-inventory.mjs` reported `functions` 377 (was 369); `scripts/db/structural-review.mjs`
reported every gate true (693 foreign keys, 1269 indexes, 281 live tables, every live table in the data
dictionary). The test files above ran on that database. This is a local measurement; the hosted
migration-replay and database jobs re-prove it.

## 4. Records this change moves

`.github/ci-baselines/schema-baseline.json` (`migrationCount` 186, `schemaHash`, `permissionCount`
135, the four structural totals, `structuralTotalsNote186`, the 671/369 -> 679/377 step in
`functionCountDiscrepancyNote`), the inventory in `tests/db/foundation.test.ts`, the P1-15 migration
census, the fixture clean-up lists, the classification registry
`docs/database/sal-wty-rpt-personal-data-classification.json` (thirty new columns, the amount
restricted), `docs/database/data-dictionary.md`, `docs/database/role-and-grant-standard.md`, the
generated permission catalogue reference and the P1-27 migration-count records.

## 5. Upgrade of an existing database — rehearsed

Rehearsed on 2026-10-08 on a disposable restore of the newest acceptance backup,
`20261008T023121Z-fd16c-cp20261008-1-preapply` (ledger 182; its checksums verified), in a
`public.ecr.aws/supabase/postgres:17.6.1.143` container on `127.0.0.1:55458`, applying the four
pending migrations (183 to 186) from this branch with `npx supabase migration up --db-url`, then
running the permission seed twice as the operator step will. The restore was removed afterwards; the
acceptance database was not touched. Evidence (outside repository):
`orchestration/evidence/fd2b-refund-requests/rehearse.sh`, `rehearse.log` and `rehearsal/`.

- The four migrations applied in 5 seconds; the server logged no warning, error or fatal (sixteen
  notices); the ledger reads 186, newest `20261008140000`; the new table has forced row-level
  security and three policies.
- Every pre-existing application table kept its row count and its data digest (55 941 rows); the
  only data-side differences are the two new, empty tables. Every money total read before and after
  is identical, and the as-of reads equal the live ones for all 47 invoices and 40 receipts.
- No existing approved credit exceeds the ceiling (0 invoices), no pending note would be refused by
  it at approval (0 of 7), and no invoice's open receivable changes (the digest of every invoice's
  open receivable is identical before and after).
- No obligation, refund request or financial event is written by the migrations (financial events by
  type identical; 0 obligations; 0 requests).
- The permission seed adds exactly one catalogue row, `sal.refund.approve` (134 -> 135), and a second
  run adds none.

The operator backfill was not run on the restore: it runs under a named platform operator's authority,
which this rehearsal does not use; its dry-run shape is proved by
`tests/backend/p1-31-tenant-administrator-bundle-backfill.test.ts` (BF-23).

## 6. Open policy points (not readings of D2, not built)

- (a) Who may create an explicit refund obligation that no credit created.
- (b) Paying a third party back instead of the customer (D14): the payee is the obligation's
  customer.
- (c) Cancelling an obligation: `cancelled` stays unreachable.
- (d) Refund approval limits: the D13 approval-limit mechanism is not applied to refunds.
- (e) Refunds in the D16 report and its snapshots.
- (f) A printed refund voucher.
