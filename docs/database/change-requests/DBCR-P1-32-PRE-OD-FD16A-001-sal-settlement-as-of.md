# DBCR-P1-32-PRE-OD-FD16A-001 — invoice and receipt amounts as of a stated moment

**Company:** RootLco — Root Link Company · **Classification:** Confidential — Commercial Product
and Pilot Planning · **Phase:** 1-32 (preparatory) — Owner decision D16 of
[ADR-023](../../adr/ADR-023-sales-and-finance-policy-decisions.md), part 1 · **Owner:** Eng.
Ezzaldeen Al-Bitar (technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)).
**This is not an independent third-party review, and no approval of this migration is recorded
here.** It implements the as-of half of the Owner's decision D16; applying it to any existing
database is a separate, rehearsed step.

- **Migration:** `supabase/migrations/20261008090000_sal_settlement_as_of.sql` (the 181st)
- **Seed change:** none. **Permission change:** none. **Audit action:** none new — the existing
  `rpt.report.exported` record gains an `as_of` detail for the invoice and payment report.
- **Executable proof:** `tests/db/sal-settlement-as-of.test.ts` (both functions against an
  allocation, a credit note and a reversal that took effect after the moment; equal to the live
  functions at and after the read; a missing moment refused; EXECUTE only for `app_runtime` and
  `app_readonly`; the three stamps on the runtime login, and the boundary for a role that bypasses
  row security; the credit-note and reversal instants already held),
  `tests/backend/p1-31-report-engine-invoice-payment.test.ts` (the report end to end),
  `tests/db/p1-15-shared-services-runtime-capabilities.test.ts` (migration census) and
  `tests/db/foundation.test.ts` (function and trigger inventories).
- **Rollback classification:** **ROLLBACK-SAFE** — two read functions and three stamping triggers;
  the inverse is in the migration footer and writes no row.

---

## 1. Why this change request exists

D16: "End-of-period reporting is defined and tested. Later payments, credits, reversals or
backdated entries never silently change a historical report. The as-of calculation and the
preserved snapshot are documented, and restatements are distinguished. No new accounting subsystem
is built."

The invoice and payment report chose its documents by period but computed every amount at the
moment it ran: `sal.invoice_open_receivable` and `sal.receipt_unallocated` count every allocation,
approved credit note and approved reversal that exists, and the receipt stream dropped a receipt
reversed at any time. So last month's report changed whenever a payment was applied, a credit
approved or a receipt reversed today, with nothing on it saying so.

## 2. The change

| Object                                                                                | Change                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sal.invoice_open_receivable_as_of(uuid, timestamptz)`                                | New. 0 for a draft, a voided invoice and an invoice issued after the moment; otherwise gross less allocations with `allocated_at <= moment` of receipts not reversed by then (a reversal counts from its `reversed_at`) and less approved credits with `issued_at <= moment`. |
| `sal.receipt_unallocated_as_of(uuid, timestamptz)`                                    | New. 0 for a receipt received after the moment or reversed by then; otherwise its amount less allocations with `allocated_at <= moment`.                                                                                                                                      |
| `sal.stamp_receipt_received_at()` + `tg_receipts_received_at`                         | New BEFORE INSERT trigger on `sal.receipts`: `received_at := now()` for `app_runtime` and its login members.                                                                                                                                                                  |
| `sal.stamp_payment_allocation_allocated_at()` + `tg_payment_allocations_allocated_at` | New BEFORE INSERT trigger on `sal.payment_allocations`: `allocated_at := now()` for the same population.                                                                                                                                                                      |
| `sal.stamp_financial_event_occurred_at()` + `tg_financial_events_occurred_at`         | New BEFORE INSERT trigger on `sal.financial_events`: `occurred_at := now()` for the same population.                                                                                                                                                                          |
| Tables, columns, policies, grants, seeds                                              | None. The two reads are STABLE, SECURITY INVOKER, empty `search_path`, EXECUTE revoked from PUBLIC and granted to `app_runtime` and `app_readonly`, exactly as their live counterparts; the trigger functions are SECURITY INVOKER with EXECUTE revoked from PUBLIC.          |

For a moment at or after the read each read equals its live counterpart: every instant compared is
stamped by `now()`, and a receipt is `reversed` exactly when its approved reversal exists.

## 3. Timestamp integrity — the finding

Measured on a disposable database (postgres:17-alpine on a loopback port, all 180 earlier
migrations and the seeds) with the runtime login, a login member of `app_runtime`, inside
rolled-back transactions:

| Instant                                            | Before this migration                                                                                                       | After           |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `sal.receipts.received_at`                         | a raw INSERT naming 2020-01-01 stored 2020-01-01 (table-level INSERT grant; frozen only on UPDATE)                          | stamped `now()` |
| `sal.payment_allocations.allocated_at`             | a raw INSERT naming 2020-01-01 stored it (table-level INSERT grant; no UPDATE grant)                                        | stamped `now()` |
| `sal.financial_events.occurred_at`                 | a raw INSERT naming 2020-01-01 stored it (table-level INSERT grant; no UPDATE grant)                                        | stamped `now()` |
| `sal.credit_notes.approved_at`, `issued_at`        | already held: cleared on INSERT (`sal.stamp_dual_control_maker`), stamped at approval and frozen; no UPDATE grant on either | unchanged       |
| `sal.receipt_reversals.approved_at`, `reversed_at` | already held: cleared on INSERT, stamped at approval and frozen; no UPDATE grant on either                                  | unchanged       |

The first three cases are the `stamps …` cases of `tests/db/sal-settlement-as-of.test.ts`: run on
that database without this migration they failed (the stored instant was the past one), and with it
they hold. The convention followed is the server stamp of `shared.stamp_status_history` (whatever
the writer supplies, the trigger sets the instant), held to the request-path population exactly as
`svc.record_pricing_approval_policy_version` (20261007150000) holds its rule: a role that bypasses
row security — a superuser, or the provisioning connection that writes fixtures — is not held to
it. Every primitive already leaves the three to their column defaults, so the request path writes
exactly what it wrote before. No historical row is rewritten.

## 4. What the application does with it

`invoice_payment_summary` declares an optional `asOf` parameter (rows query and export body).
Documents are still chosen by the period. Every amount, the credit status and the status are
computed as of the moment: default the period's exclusive end once it has passed, otherwise the
read time; earlier than the period start or later than the read is refused (`ERR-VAL-001`); every
other dataset refuses an `asOf`. A document dated after a moment inside the period did not exist
then and is left out. The run answers `freshness: 'as_of'` with `asOf`; the CSV carries an `asOf`
column beside `freshness`; the export audit records `as_of`. The report screen states the moment on
the branch clock and offers end of period, now or a specific moment.

## 5. Measured effect

Measured on a database created empty in a throwaway `postgres:17-alpine` container on a loopback
port of its own, replayed through all 181 migrations with `npm run db:apply-migrations` and seeded
twice with `npm run validate:seed-state`:

- `scripts/ci/migration-replay-checks.mjs --phase post` reported, against the 180 baseline, exactly
  the migration count, `functions` 668 and `triggers` 657; `tables` 278, `policies` 805,
  `security_definer` 0 and 134 permissions hold; `scripts/db/schema-inventory.mjs` reported 366
  functions (from 361);
- `npm run validate:schema-inventory -- --hash-only` produced `6e28f956…`, recorded in
  `.github/ci-baselines/schema-baseline.json`;
- the database and backend tests named above ran with 0 failed on that database. This is a local
  measurement; the hosted migration-replay, database and backend jobs re-prove it.

## 6. Populated-data rehearsal

The migration adds triggers, so it was rehearsed on a disposable restore of the most recent
acceptance backup the D5-D8 checkpoint record references
(`C:/Users/Ezzaldeen/rootlco-db-backups/20261006T142940Z-d5-d8-cp2-preapply/`, ledger 170, dump
sha256 `49785af9…`, checksums verified), in `public.ecr.aws/supabase/postgres:17.6.1.143` on
127.0.0.1:55449 with the method of that checkpoint's rehearsal scripts:

- restore: roles 14 errors, all "already exists"; `pg_restore --create` exit 0 with an empty log;
- `npx supabase migration up --db-url …` from this branch: exit 0, eleven files applied in order
  (171 to 180, then 181), 0 pending afterwards, ledger 181; server log 0 WARNING, 0 ERROR, 0 FATAL;
- row count and md5 of all 20 `sal` tables identical before and after;
- read-only smoke: for all 35 invoices and 39 receipts, the as-of functions at `now()` and at
  `now() + 1 day` equal the live functions (0 differ); no allocation, receipt or financial event
  carries an instant later than now; the three triggers present; EXECUTE held by `app_runtime` and
  `app_readonly`;
- schema hash `6e28f956…`, equal to the empty replay.

The disposable container was removed. The acceptance database was not read or written.

## 7. Records this change moves

`.github/ci-baselines/schema-baseline.json` (`migrationCount` 181, `schemaHash`,
`structuralTotals` functions and triggers, `migrationCountNote`, `functionCountDiscrepancyNote`,
`structuralTotalsNote181`), the P1-15 migration census, the `tests/db/foundation.test.ts`
inventories, `docs/database/data-dictionary.md`, and the P1-27 migration-count records.

## 8. Upgrade of an existing database

Forward-only, writes no row, takes no long lock beyond creating three triggers on `sal.receipts`,
`sal.payment_allocations` and `sal.financial_events`. Apply with the other pending migrations by the
established backup, rehearsal and forward-apply procedure; never by reset.

## 9. Not in this change

The preserved period snapshot and the marking of restatements (FD16B); period close and financial
statements, which wait for the accounting questionnaire.
