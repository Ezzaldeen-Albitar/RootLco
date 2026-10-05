# DBCR-P1-32-PRE-OD-FD5-001 — invoice approved quantities only, tracked per source line across revisions

**Company:** RootLco — Root Link Company · **Classification:** Confidential — Commercial Product
and Pilot Planning · **Phase:** 1-32 (preparatory) — Owner decisions D5 and D15 of
[ADR-023](../../adr/ADR-023-sales-and-finance-policy-decisions.md) · **Owner:** Eng. Ezzaldeen
Al-Bitar (technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)).
**This is not an independent third-party review, and no approval of this migration is recorded
here.** It implements the Owner's decisions D5 and D15 of 2026-09-30; applying it to any existing
database is a separate, rehearsed step.

- **Migration:** `supabase/migrations/20261006090000_sal_invoiced_quotation_quantities.sql` (the
  171st)
- **Seed change:** none. **Permission change:** none — `sal.invoice-create`,
  `sal.invoice-preview` and `sal.work-order-invoice-read` keep their declared permissions.
  **Audit action:** none new (the description of `sal.invoice.created` is corrected). **Route:**
  none new.
- **Executable proof:** `tests/db/sal-invoiced-quotation-quantities.test.ts` (the read function and
  the three guards exist, invoker-rights with an empty search path and no PUBLIC execute; the old
  unique index is replaced by the two new ones; a fully approved revision is billed once and a
  second bill of the same line is refused; a quantity above the approved one, a line with no
  source, a wrong kind, a foreign line and an amount above the approved line are refused; an
  undecided and a rejected line are refused while the approved line is billed; a later revision
  that raises the quantity bills only the increase, at what remains of the total, and the
  superseded line can no longer be billed; a re-priced line below what was billed and two approved
  lines of one lineage are refused; a draft voided before issue releases what it held and a
  credited invoice keeps it; one draft per work order, one live unsourced invoice per work order,
  never both kinds, and the revision frozen; under concurrency exactly one of two transactions
  invoicing the same quantity commits, three times over; a caller without `sal.finance.view` reads
  every quantity and the billing status and no remaining amount; another tenant and another branch
  see no line, and another tenant cannot write an invoice line naming one),
  `tests/backend/od-invoice-approved-quantities.test.ts` (the routes end to end, including two
  creates racing, a replayed key, and two quotations on one work order), `tests/db/p1-15-shared-services-runtime-capabilities.test.ts`
  (migration census) and `tests/db/foundation.test.ts` (function and trigger inventories).
- **Rollback classification:** **ROLLBACK-SAFE WHILE NO WORK ORDER HOLDS TWO LIVE INVOICES** — the
  inverse is in the migration footer; it refuses to run once one does, because it restores
  `uq_invoices_work_order_active`, which such a work order would violate.

---

## 1. Why this change request exists

A work-order invoice copied every line of a quotation revision whose every line was approved, and
`uq_invoices_work_order_active` allowed one live invoice per work order. That index was the only
thing preventing a second bill of the same work, and it made the later billing of approved work
impossible: a revision with one line still undecided could not be billed at all, and once one
invoice existed nothing more could be billed until it was voided. Owner decisions D5 and D15 ask for
the opposite on both counts — approved items and quantities are invoiceable and rejected,
cancelled and unapproved ones are not; invoiced quantities and amounts are tracked against accepted
revisions and their source lines so approved work not yet billed can be billed later without
billing anything twice, across superseding revisions; "one invoice per revision" is not the only
safeguard; idempotency and concurrency protection live in the backend and the database.

## 2. The change

| Object                                      | Change                                                                                                                                                                                                                                                                                       |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uq_invoices_work_order_active`             | Dropped, and replaced by the two indexes and the three guards below.                                                                                                                                                                                                                         |
| `uq_invoices_work_order_draft`              | New unique index: at most one draft invoice per work order (both kinds). Two creators racing for one work order both insert a draft; the second is refused by the index.                                                                                                                     |
| `uq_invoices_work_order_unsourced`          | New unique index: at most one live invoice per work order among invoices that name no quotation revision — the old rule, kept whole for invoices the quantity guards cannot follow.                                                                                                          |
| `ix_invoice_lines_source_quotation_item`    | New index on `sal.invoice_lines (tenant_id, source_quotation_item_id)` for the reads below.                                                                                                                                                                                                  |
| `sal.billable_quotation_lines(uuid, uuid)`  | New SECURITY INVOKER read, empty `search_path`, EXECUTE to `app_runtime` only. Per line of a revision: the decision; the quoted, approved, invoiced and remaining quantity; the remaining net, tax and discount (only to a holder of `sal.finance.view`); and a billing status.              |
| `sal.guard_invoice_work_order_source()`     | New SECURITY INVOKER trigger function behind `tg_invoices_work_order_source` (BEFORE INSERT OR UPDATE OF `quotation_revision_id` on `sal.invoices`): locks the work order row; a named revision belongs to the work order's quotations; the two kinds never coexist; the revision is frozen. |
| `sal.guard_invoice_line_source()`           | New SECURITY INVOKER trigger function behind `tg_invoice_lines_source` (BEFORE INSERT OR UPDATE on `sal.invoice_lines`): on an invoice naming a revision, a live line names a billable line of it, of its kind, within the remaining quantity — judged after the work order row lock.        |
| `sal.guard_invoice_line_amount_source()`    | New SECURITY INVOKER trigger function behind `tg_invoice_line_amounts_source` (BEFORE INSERT OR UPDATE on `sal.invoice_line_amounts`): a sourced line's net and tax stay within what remains of the approved line, under the same lock.                                                      |
| Tables, columns, policies, grants on tables | None.                                                                                                                                                                                                                                                                                        |

### The source line, and why nothing is stored for it

A quotation line carries no pointer to the line it replaced: revisions are typed afresh and the
optional work-order references are never sent by the screens. The identity that survives a
superseding revision is the thing being sold — the line kind with its service, or with its
catalogue item: the line's lineage. It is derived from columns every line already has, so no
existing row is linked by guesswork and nothing is backfilled. What live invoices of the work order
hold for a lineage, under any revision, counts against the approved quantity of that lineage in the
revision billed now. When that revision holds more than one approved line of a lineage and part of
the lineage was billed under another revision, the two lines cannot be told apart and both are
refused (`lineage_ambiguous`) rather than one being guessed.

### What remains, in quantity and in money

A line nothing has invoiced remains billable at exactly its captured amounts, so a revision approved
whole and never invoiced is billed exactly as before. A line part of whose lineage was billed earlier
remains billable for the approved quantity less what was billed, at the approved line's net and tax
less what was billed — the difference of totals, so no rounding rule is invented; its discount is
not restated. A line whose approved total is now below what was billed is refused
(`repriced_below_invoiced`). An invoice voided before issue releases what it held; an issued or
credited invoice keeps it — an approved credit note does not make work billable again.

### Why the work order row, and why after it

Every guard takes `SELECT … FOR NO KEY UPDATE` on the work order row before it reads what remains,
and reads it in a statement of its own after the lock. Under READ COMMITTED that statement sees a
concurrent writer's committed lines, so two transactions invoicing the same remaining quantity
cannot both pass: the second waits for the first and is then judged against it. `FOR NO KEY
UPDATE` does not conflict with the key-share locks foreign keys take on the work order.

### Why the old protection is replaced by an equal or stronger one

The old index forbade a second live invoice on a work order. Each of its cases is still refused:
a second draft (`uq_invoices_work_order_draft`); a second live invoice naming no revision
(`uq_invoices_work_order_unsourced`); one of each kind (`sal.guard_invoice_work_order_source`); and
a second invoice naming a revision may bill only approved quantity no live invoice holds, line by
line, in quantity and in money. The new rules are stronger in one respect the old one was not: an
invoice naming a revision can no longer carry a line that is not an approved line of it.

## 3. What the application does with it

`sal.invoice-create` refuses while a draft is open (`invoice_draft_open`), bills exactly the
remaining approved quantities each at what remains of it, refuses when nothing remains
(`invoice_nothing_to_bill`), and answers a guard's refusal — a concurrent creator — as a 409 with the
guard's rule. `sal.invoice-preview` lists what it would bill with the approved and already invoiced
quantities, every other line of the revision with why, and the revision as quoted.
`sal.work-order-invoice-read` lists every live invoice and says whether approved work remains. The
delivery financial blocker judges every live invoice and treats unbilled approved work as
outstanding.

## 4. Open points this change does not decide

Recorded in ADR-023 under D5/D15: credit notes do not release quantity; approved lines of an expired
or superseded revision are not billed; a re-priced line below what was invoiced and two approved
lines of one lineage are refused rather than guessed.

Also recorded there, as an Owner decision this change does not take: two quotations on one work order
that both have approved work still to bill are refused until one is cancelled, and the delivery
blocker stays on unless overridden. That refuses more than base, which billed the one quotation
accepted as a whole and ignored a partly approved one. A quotation whose approved work is all
invoiced no longer competes, so another quotation's approved lines are then billed on a further
invoice, which base never allowed.

What counts as already invoiced is pooled by work order, not by quotation (Owner open point, ADR-023
D5/D15). An approved line of a second quotation selling a service or part that a first quotation of
the same work order already invoiced counts that invoiced quantity against itself: up to it, the line
is shown as already invoiced, is not billed, and does not hold the delivery blocker. When the second
quotation's other approved lines are invoiced, approved work to invoice turns false although that
line was never billed from the second quotation; when it has no other approved line, both quotations
have nothing left and the preview answers a conflict (409) rather than "nothing to bill". Scoping the
pool to one quotation's revisions would bill that line, at the risk of billing work quoted twice; that
is the Owner's choice, not this change's. `tests/backend/od-invoice-approved-quantities.test.ts`
pins the pooled answer.

## 5. Measured effect

Measured on a database created empty in a throwaway `postgres:17` container on a loopback port of
its own, replayed through all 171 migrations with `npm run db:apply-migrations` and seeded twice with
`npm run validate:seed-state`:

- `scripts/ci/migration-replay-checks.mjs --phase post` reported, against the 170 baseline, exactly
  the migration count, `functions` 652 and `triggers` 644; `tables` 278, `policies` 805,
  `security_definer` 0 and 134 permissions hold;
- `npm run validate:schema-inventory -- --hash-only` produced the schema hash recorded in
  `.github/ci-baselines/schema-baseline.json`, and `scripts/db/schema-inventory.mjs` counted 350
  functions;
- the database and backend tests named above passed on a second disposable database. This is a
  local measurement; the hosted migration-replay, database and backend jobs re-prove it.

Nothing was written to the acceptance database.

## 6. Records this change moves

`.github/ci-baselines/schema-baseline.json` (`migrationCount` 171, `schemaHash`, `structuralTotals`,
the 171 sentence of `migrationCountNote`, `functionCountDiscrepancyNote`, `structuralTotalsNote171`),
the P1-15 migration census, the `tests/db/foundation.test.ts` inventories,
`docs/database/data-dictionary.md`, and the P1-27 migration-count records.

## 7. Upgrade of an existing database

The migration is forward-only and writes no row. Every invoice the application created names its
revision and every line its source, so existing invoices count against their lineages as soon as it
applies. The application change ships in the same pull request. Applying the migration to the
acceptance database happens later, through the established backup, rehearsal on a restored copy and
forward apply — not in this change.
