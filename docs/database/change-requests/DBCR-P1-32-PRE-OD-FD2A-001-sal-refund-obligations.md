# DBCR-P1-32-PRE-OD-FD2A-001 — the D2 credit ceiling and refund obligations

**Company:** RootLco — Root Link Company · **Classification:** Confidential — Commercial Product
and Pilot Planning · **Phase:** 1-32 (preparatory) — Owner directive, finance decision D2, part 1 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)).
**This is not an independent third-party review, and no approval of this migration is recorded
here.** It implements part 1 of Owner decision D2 of 2026-09-30 as recorded in
[ADR-023](../../adr/ADR-023-sales-and-finance-policy-decisions.md); applying it to any existing
database is a separate, rehearsed step.

- **Migration:** `supabase/migrations/20261008121000_sal_refund_obligations.sql` (the 184th)
- **Seed change:** none. **Permission change:** none — the new list read declares
  `sal.finance.view`, which already gates every amount it shows. **Role bundle or backfill:** none.
- **Executable proof:** `tests/db/sal-credit-note-decisions.test.ts` (the ceiling of the gross less
  the approved credits, a pending note not counted, exactly what remains accepted; two approvals
  racing on one invoice serialised on its row lock, the second refused; the obligation recorded for
  exactly the excess, none when the credit stays within what is owed, one financial event bound to
  it; a raw obligation refused when it is not the excess, names another currency or customer, is
  finer than the minor unit or cites a note that is not approved; every fact frozen and every state
  change refused for the runtime login and the owner; no DELETE; forced row-level security by
  tenant and by `sal.finance.view`; the open receivable at zero and the as-of read equal to it; a
  receipt reversal refused at request and at approval while an obligation is open, and allowed when
  none is), `tests/db/sal-settlement-as-of.test.ts` (never below zero at any moment),
  `tests/db/p1-22-protected-residuals.test.ts` (the floored derivation beside the raw over-payment),
  `tests/db/foundation.test.ts` (table, routine, trigger and policy inventory),
  `tests/db/p1-15-shared-services-runtime-capabilities.test.ts` (migration census), and
  `tests/backend/od-finance-credit-decisions.test.ts` (end to end through the route handlers).
- **Rollback classification:** **ROLLBACK-SAFE WHILE `sal.refund_obligations` IS EMPTY**;
  roll-forward-only once an obligation exists. The inverse is in the migration footer and refuses to
  run while any obligation exists.

---

## 1. Why this change request exists

`sal.approve_credit_note` refused a credit above the invoice's open receivable (gross less
receipts less approved credits), so a paid invoice could not be credited at all, and nothing could
record that a customer was owed money back. The Owner's decision D2: a credit is at most the
eligible invoiced amount less the effective credits already given, enforced safely under
concurrency; a credit above what is still outstanding becomes a customer credit or refund
obligation; nothing is refunded automatically; approving and paying a refund are separate acts with
a second approver, and duplicate or excess refunds are refused. Part 1, this change, delivers the
ceiling and the obligation. Part 2 (P1-32-PRE-OD-FD2B) delivers refund requests, their approval and
their execution. Accounting effects — refund accounts, ledger postings, cash or bank movement, tax
and period close — stay out of scope until the accounting questionnaire is answered.

## 2. The change

| Object                                                                                      | Change                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sal.refund_obligations`                                                                    | NEW table: tenant, company, branch, customer (`partner_id`), invoice, credit note (one per note), currency, amount (`numeric(18,4)`, above zero), `source` (`credit_excess` only), `state` (`open`, `settled`, `cancelled`), `record_version`, creation and update stamps. Composite foreign keys to the branch, the invoice and the credit note; foreign keys to the customer and the currency. ENABLE + FORCE RLS. |
| `sal.guard_refund_obligation_insert()`                                                      | NEW BEFORE INSERT guard: stamps the creator and time for the request path; forces `open`; binds the row to an APPROVED note of the same invoice, the invoice's customer and currency, the currency's minor unit and exactly the excess of the credit over the invoice's open receivable before it; locks the invoice.                                                                                                |
| `sal.guard_refund_obligation_update()`                                                      | NEW BEFORE UPDATE guard for every role: every fact frozen; every state change refused until refund requests exist.                                                                                                                                                                                                                                                                                                   |
| Triggers                                                                                    | NEW `tg_refund_obligations_insert_rules`, `tg_refund_obligations_frozen`, `tg_refund_obligations_touch_metadata` and the deferred constraint trigger `tg_refund_obligations_event_completeness`.                                                                                                                                                                                                                     |
| Policies and grants                                                                         | `sel_`, `ins_` and `upd_refund_obligations_gated`: tenant, company and branch reach with `sal.finance.view`. `app_runtime`: SELECT, INSERT and UPDATE (`state`); `app_readonly`: SELECT; no DELETE for any application role.                                                                                                                                                                                         |
| `sal.financial_events`                                                                      | `ck_financial_events_event_type` admits `refund_obligation_recorded`; `ck_financial_events_source_type` admits `refund_obligation`; table comment states no event is an accounting entry.                                                                                                                                                                                                                            |
| `sal.guard_financial_event_provenance()`, `sal.guard_event_completeness()`                  | Re-issued with one more branch each: the event is bound to the obligation's amount and currency, and required at commit.                                                                                                                                                                                                                                                                                             |
| `sal.invoice_open_receivable(uuid)`, `sal.invoice_open_receivable_as_of(uuid, timestamptz)` | Re-issued: never below zero (what lies below zero is the obligation's). For a moment at or after the read the two still agree.                                                                                                                                                                                                                                                                                       |
| `sal.approve_credit_note(uuid, uuid)`                                                       | Re-issued: the ceiling is the issued invoice's gross less the credits already approved, under the note and invoice locks (`credit_note_exceeds_creditable`); an approved credit above what the invoice still owed records the excess as one obligation with its event, in the same transaction.                                                                                                                      |
| `sal.guard_receipt_reversal_request()`, `sal.approve_receipt_reversal(uuid, uuid)`          | Re-issued (interim rule, open policy point): after the receipt lock, the invoices the receipt paid are share-locked, and a reversal is refused while any of them has an open obligation (`receipt_reversal_refund_obligation_open`).                                                                                                                                                                                 |
| Table comments                                                                              | `sal.credit_notes` and `sal.financial_events` restated.                                                                                                                                                                                                                                                                                                                                                              |

Every function is `SECURITY INVOKER` with an empty `search_path`; the two new trigger functions
have `EXECUTE` revoked from PUBLIC, and every re-issued function keeps its grants. The migration
writes no row.

**Concurrency.** Two approvals on one invoice serialise on the invoice row lock the approval already
took, so the second reads the first's approved credit and its ceiling. A receipt-reversal request
or approval takes a share lock on the invoices the receipt paid after the receipt lock, and a
credit approval holds its invoice `FOR UPDATE`, so the reversal either waits for the credit and sees
its obligation, or holds the invoice first and the credit then reads the reversed receipt. The lock
order of `sal.allocate_receipt` (receipt, then invoice) is the reversal's, so no new cycle arises.

## 3. Measured effect

Measured on a throwaway `postgres:17-alpine` container on `127.0.0.1:55451`, replayed from empty
through all 184 migrations with `scripts/db/apply-migrations.mjs` and seeded twice with
`npm run validate:seed-state`:

- `scripts/ci/migration-replay-checks.mjs --phase post` reported `tables` 280 (was 279),
  `functions` 671 (was 669), `policies` 810 (was 807) and `triggers` 662 (was 658);
  `security_definer` 0 and the permission count 134 did not move;
- `scripts/db/schema-inventory.mjs` reported `functions` 369 (was 367) over the seventeen RootLco
  schemas, the companion figure `functionCountDiscrepancyNote` records;
- `scripts/db/structural-review.mjs` reported every gate true (686 foreign keys, 1258 indexes, 280
  live tables, every live table in the data dictionary);
- `npm run validate:schema-inventory -- --hash-only` produced the schema hash recorded in
  `.github/ci-baselines/schema-baseline.json`;
- the database and backend tests named above ran on that database. This is a local measurement;
  the hosted migration-replay and database jobs re-prove it.

The acceptance database was not read or written by this change.

## 4. Records this change moves

`.github/ci-baselines/schema-baseline.json` (`migrationCount` 184, `schemaHash`, the four structural
totals, `structuralTotalsNote184`, the 669/367 -> 671/369 step in `functionCountDiscrepancyNote`),
the inventory in `tests/db/foundation.test.ts`, the P1-15 migration census, the residual in
`tests/db/p1-22-protected-residuals.test.ts`, the fixture clean-up lists (`tests/db/helpers.ts`,
`tests/db/p1-11-helpers.ts`, `tests/backend/p1-22-helpers.ts`), the classification registry
`docs/database/sal-wty-rpt-personal-data-classification.json` (sixteen new columns, the amount
restricted), `docs/database/data-dictionary.md`, and the P1-27 migration-count records.

## 5. Upgrade of an existing database — rehearsed

Rehearsed on 2026-10-08 on a disposable restore of the newest acceptance backup,
`20261008T023121Z-fd16c-cp20261008-1-preapply` (ledger 182; its checksums verified), in a
`public.ecr.aws/supabase/postgres:17.6.1.143` container on `127.0.0.1:55452`, applying the two
pending migrations (183 and 184) from this branch with `npx supabase migration up --db-url`. The
restore was removed afterwards; the acceptance database was not touched. Evidence (outside
repository): `orchestration/evidence/fd2a-refund-obligations/rehearse.sh`, `rehearse.log` and
`rehearsal/`.

- Both migrations applied in 4 seconds; the server logged no warning, error or fatal (eight notices,
  all from the CLI's own bookkeeping table); the ledger reads 184, newest `20261008121000`.
- Every application table kept its row count and its data digest (55 941 rows); the only data-side
  difference is the new, empty `sal.refund_obligations`. Every money total read before and after is
  identical.
- Every existing approved credit stays within the new ceiling: no invoice's approved credits exceed
  its eligible gross (0 of 47 invoices), and no pending note would be refused by it at approval
  (0 of 7).
- No existing invoice's open receivable changes: the digest of every invoice's open receivable is
  identical before and after (23 of 47 non-zero), no invoice's gross less receipts less credits was
  below zero before, and the as-of read at now equals the live one for all 47.
- No obligation and no financial event is written by the migration (financial events by type
  identical; 0 obligations).

## 6. Open policy points (not readings of D2)

- (a) Who may create an explicit refund obligation that no credit created. None can be created in
  part 1: `source` admits `credit_excess` only.
- (b) Whom to refund when a third party paid the invoice (D14). The obligation names the invoice's
  customer, because the invoice stays the customer's.
- (c) The interim conservative rule for D4: a receipt that paid an invoice with an open refund
  obligation is not reversed, because a reversal would change the excess the obligation was computed
  from.
- (d) Refund obligations are not yet shown in the D16 report or its snapshots.
