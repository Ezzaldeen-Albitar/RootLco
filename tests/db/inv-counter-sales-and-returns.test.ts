/**
 * P1-32 preparatory slice 2 — the counter sale and the sales return, the database
 * half (P1-32-PRE-105…116).
 *
 * The application layer only names the field a refusal is about; everything that
 * makes a counter sale safe is here, and every assertion counts a SIDE EFFECT —
 * rows, balances, movements — rather than an exit status:
 *
 *  - one live selling price per (item, company, branch), resolved most-specific
 *    first, and NO price at all rather than a zero when none is configured;
 *  - `sale_kind` and `work_order_id` are a biconditional, so a counter sale with a
 *    job and a work-order invoice without one are both unrepresentable;
 *  - a counter-sale line carries the item and the cell it leaves; a work-order line
 *    carries neither;
 *  - the `sale` movement posts only against an ISSUED counter sale, only from the
 *    cell the line names, and only ONCE — `uq_stock_movements_source`;
 *  - an issued sale cannot be voided, so cancelling never returns stock;
 *  - a return lands in the received location when restockable and in the quarantine
 *    location when damaged, is bounded by a ceiling that counts BOTH return tables,
 *    and raises exactly one pending credit note for the returned share of the line.
 *
 * Cases run inside rolled-back transactions on the runtime role. `inv.stock_balances`
 * is read inside the same transaction that wrote it, which is what makes "the
 * balance moved by exactly the quantity sold" an assertion about the ledger rather
 * than about a later read.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from 'pg';
import {
  adminPool,
  runtimePool,
  withRolledBackTx,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  TENANT_A,
  COMPANY_A1,
  BRANCH_A1,
  USER_A,
} from './helpers';
import { seedItem, seedLocations, seedStock, seedMaterialRequest } from './p1-10-helpers';
import {
  ctxA,
  expectFail,
  issueInvoice,
  makeWorkOrder,
  seedDraftInvoice,
  addInvoiceLine,
  seedP111Base,
  seedPartner,
} from './p1-11-helpers';

type Q = { query: Client['query'] };

const admin = adminPool();
const runtime = runtimePool();

beforeAll(async () => {
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  await seedP111Base(admin);
}, 180_000);

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

const one = async <T>(c: Q, sql: string, params: unknown[] = []): Promise<T> =>
  (await c.query(sql, params)).rows[0] as T;

const scalar = async (c: Q, sql: string, params: unknown[] = []): Promise<string> =>
  String(((await c.query(sql, params)).rows[0] as Record<string, unknown>).v);

/** A tax class with one effective rate, as a FRACTION. */
async function seedTax(c: Q, tag: string, rate: string): Promise<string> {
  const taxClass = await one<{ id: string }>(
    c,
    `INSERT INTO org.tax_classes (tenant_id, company_id, tax_class_code, name, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [TENANT_A, COMPANY_A1, `tc_${tag}`, `Tax ${tag}`, USER_A]
  );
  await c.query(
    `INSERT INTO org.tax_rates (tenant_id, company_id, tax_class_id, rate, effective_from, created_by)
     VALUES ($1,$2,$3,$4::numeric,DATE '2020-01-01',$5)`,
    [TENANT_A, COMPANY_A1, taxClass.id, rate, USER_A]
  );
  return taxClass.id;
}

const setPrice = (
  c: Q,
  item: string,
  price: string,
  options: { company?: string | null; branch?: string | null; taxClass?: string | null } = {}
): Promise<string> =>
  one<{ id: string }>(c, `SELECT inv.set_item_sale_price($1,$2,$3,'USD',$4::numeric,$5) AS id`, [
    item,
    options.company === undefined ? COMPANY_A1 : options.company,
    options.branch === undefined ? null : options.branch,
    price,
    options.taxClass ?? null,
  ]).then((row) => row.id);

const createCounterSale = (
  c: Q,
  partner: string,
  lines: readonly { itemId: string; locationId: string; quantity: string }[],
  key: string | null = null
): Promise<string> =>
  one<{ id: string }>(
    c,
    `SELECT sal.create_counter_sale_invoice($1,$2,$3,$4::jsonb,$5,NULL) AS id`,
    [COMPANY_A1, BRANCH_A1, partner, JSON.stringify(lines), key]
  ).then((row) => row.id);

const onHand = (c: Q, item: string, location: string): Promise<string> =>
  scalar(
    c,
    `SELECT on_hand_qty::text AS v FROM inv.stock_balances
      WHERE tenant_id = $1 AND item_id = $2 AND location_id = $3`,
    [TENANT_A, item, location]
  );

const movementsFor = (c: Q, referenceKind: string, referenceId: string): Promise<string> =>
  scalar(
    c,
    `SELECT count(*)::text AS v FROM inv.stock_movements
      WHERE tenant_id = $1 AND reference_kind = $2 AND reference_id = $3`,
    [TENANT_A, referenceKind, referenceId]
  );

describe('inv.item_sale_prices — one live price per signature, most specific first', () => {
  it('resolves the branch row over the company row over the tenant-wide row', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'odcs_resolve');

      // Nothing configured: NO ROW, which is what makes a missing price a refusal
      // at the call site rather than a zero on a customer's bill.
      expect(
        await scalar(c, `SELECT count(*)::text AS v FROM inv.resolve_item_sale_price($1,$2,$3)`, [
          item,
          COMPANY_A1,
          BRANCH_A1,
        ])
      ).toBe('0');

      await setPrice(c, item, '10.0000', { company: null });
      expect(
        await scalar(c, `SELECT unit_price::text AS v FROM inv.resolve_item_sale_price($1,$2,$3)`, [
          item,
          COMPANY_A1,
          BRANCH_A1,
        ])
      ).toBe('10.0000');

      await setPrice(c, item, '11.0000');
      expect(
        await scalar(c, `SELECT unit_price::text AS v FROM inv.resolve_item_sale_price($1,$2,$3)`, [
          item,
          COMPANY_A1,
          BRANCH_A1,
        ])
      ).toBe('11.0000');

      await setPrice(c, item, '12.5000', { branch: BRANCH_A1 });
      expect(
        await scalar(c, `SELECT unit_price::text AS v FROM inv.resolve_item_sale_price($1,$2,$3)`, [
          item,
          COMPANY_A1,
          BRANCH_A1,
        ])
      ).toBe('12.5000');

      // Three rows, one per signature — and setting the same signature again
      // REVISES rather than appending, so the index is never approached.
      expect(
        await scalar(c, `SELECT count(*)::text AS v FROM inv.item_sale_prices WHERE item_id = $1`, [
          item,
        ])
      ).toBe('3');
      await setPrice(c, item, '13.0000', { branch: BRANCH_A1 });
      expect(
        await scalar(c, `SELECT count(*)::text AS v FROM inv.item_sale_prices WHERE item_id = $1`, [
          item,
        ])
      ).toBe('3');
      expect(
        await scalar(
          c,
          `SELECT record_version::text AS v FROM inv.item_sale_prices
            WHERE item_id = $1 AND branch_id = $2`,
          [item, BRANCH_A1]
        )
      ).toBe('2');
    });
  });

  it('refuses a branch row with no company, a tax class with no company, and a duplicate signature', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'odcs_price_ck');
      await expectFail(
        c,
        '23514',
        `INSERT INTO inv.item_sale_prices (tenant_id, item_id, company_id, branch_id, currency_code, unit_price, created_by)
         VALUES ($1,$2,NULL,$3,'USD',5,$4)`,
        [TENANT_A, item, BRANCH_A1, USER_A]
      );
      const taxClass = await seedTax(c, 'odcs_price_ck', '0.160000');
      await expectFail(
        c,
        '23514',
        `INSERT INTO inv.item_sale_prices (tenant_id, item_id, company_id, branch_id, currency_code, unit_price, tax_class_id, created_by)
         VALUES ($1,$2,NULL,NULL,'USD',5,$3,$4)`,
        [TENANT_A, item, taxClass, USER_A]
      );
      await setPrice(c, item, '5.0000');
      await expectFail(
        c,
        '23505',
        `INSERT INTO inv.item_sale_prices (tenant_id, item_id, company_id, branch_id, currency_code, unit_price, created_by)
         VALUES ($1,$2,$3,NULL,'USD',6,$4)`,
        [TENANT_A, item, COMPANY_A1, USER_A]
      );
    });
  });
});

describe('sal.invoices — a counter sale is an invoice kind', () => {
  it('makes the work order and the sale kind a biconditional', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const partner = await seedPartner(c, 'odcs_kind');
      const { wo } = await makeWorkOrder(c, 'odcs_kind');
      // A counter sale that names a job.
      await expectFail(
        c,
        '23514',
        `INSERT INTO sal.invoices (tenant_id, company_id, branch_id, work_order_id, sale_kind, payer_partner_id, currency_code, created_by)
         VALUES ($1,$2,$3,$4,'counter_sale',$5,'USD',$6)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, wo, partner, USER_A]
      );
      // A work-order invoice that names none.
      await expectFail(
        c,
        '23514',
        `INSERT INTO sal.invoices (tenant_id, company_id, branch_id, work_order_id, sale_kind, payer_partner_id, currency_code, created_by)
         VALUES ($1,$2,$3,NULL,'work_order',$4,'USD',$5)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, partner, USER_A]
      );
      // And a sale kind outside the vocabulary.
      await expectFail(
        c,
        '23514',
        `INSERT INTO sal.invoices (tenant_id, company_id, branch_id, work_order_id, sale_kind, payer_partner_id, currency_code, created_by)
         VALUES ($1,$2,$3,NULL,'wholesale',$4,'USD',$5)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, partner, USER_A]
      );
    });
  });

  it('binds a line shape to its parent sale kind, and freezes the kind', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const partner = await seedPartner(c, 'odcs_lines');
      const { item } = await seedItem(c, 'odcs_lines');
      const { warehouse } = await seedLocations(c, 'odcs_lines');
      await seedStock(c, item, warehouse, 5, 'odcs_lines');
      await setPrice(c, item, '7.0000');
      const sale = await createCounterSale(c, partner, [
        { itemId: item, locationId: warehouse, quantity: '1' },
      ]);

      // A counter-sale line with no item.
      await expectFail(
        c,
        '23514',
        `INSERT INTO sal.invoice_lines (tenant_id, company_id, branch_id, invoice_id, line_number, line_type, quantity, currency_code, created_by)
         VALUES ($1,$2,$3,$4,99,'part',1,'USD',$5)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, sale, USER_A]
      );

      // A work-order invoice line that names one.
      const { wo } = await makeWorkOrder(c, 'odcs_lines_wo');
      const invoice = await seedDraftInvoice(c, { wo, payer: partner });
      await expectFail(
        c,
        '23514',
        `INSERT INTO sal.invoice_lines (tenant_id, company_id, branch_id, invoice_id, line_number, line_type, quantity, currency_code, item_id, stock_location_id, created_by)
         VALUES ($1,$2,$3,$4,1,'part',1,'USD',$5,$6,$7)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, invoice, item, warehouse, USER_A]
      );

      // The kind itself is frozen for the life of the document.
      await expectFail(
        c,
        '23514',
        `UPDATE sal.invoices SET sale_kind = 'work_order' WHERE id = $1`,
        [sale]
      );
    });
  });

  it('prices and taxes every line in the database, exactly, and refuses an unpriced item', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const partner = await seedPartner(c, 'odcs_price');
      const { item } = await seedItem(c, 'odcs_price');
      const { item: unpriced } = await seedItem(c, 'odcs_unpriced');
      const { warehouse } = await seedLocations(c, 'odcs_price');
      await seedStock(c, item, warehouse, 20, 'odcs_price');
      await seedStock(c, unpriced, warehouse, 5, 'odcs_unpriced');
      const taxClass = await seedTax(c, 'odcs_price', '0.160000');
      // 12.3400 x 3 = 37.0200 net; 16% of that is 5.9232 tax, gross 42.9432.
      await setPrice(c, item, '12.3400', { taxClass });

      const sale = await createCounterSale(c, partner, [
        { itemId: item, locationId: warehouse, quantity: '3' },
      ]);
      const amounts = await one<{ net: string; tax: string; gross: string }>(
        c,
        `SELECT net_total::text AS net, tax_total::text AS tax, gross_total::text AS gross
           FROM sal.invoice_amounts WHERE invoice_id = $1`,
        [sale]
      );
      expect(amounts).toEqual({ net: '37.0200', tax: '5.9232', gross: '42.9432' });
      const line = await one<{ unit: string; net: string; tax: string; customer: string }>(
        c,
        `SELECT unit_price::text AS unit, net_amount::text AS net, tax_amount::text AS tax,
                customer_pay_amount::text AS customer
           FROM sal.invoice_line_amounts WHERE invoice_id = $1`,
        [sale]
      );
      expect(line).toEqual({
        unit: '12.3400',
        net: '37.0200',
        tax: '5.9232',
        customer: '42.9432',
      });
      // A draft moves NO stock.
      expect(await onHand(c, item, warehouse)).toBe('20.000');

      // An item with no price refuses the whole sale — and leaves no half-built draft.
      const before = await scalar(
        c,
        `SELECT count(*)::text AS v FROM sal.invoices WHERE sale_kind = 'counter_sale'`
      );
      await expectFail(
        c,
        '23514',
        `SELECT sal.create_counter_sale_invoice($1,$2,$3,$4::jsonb,NULL,NULL)`,
        [
          COMPANY_A1,
          BRANCH_A1,
          partner,
          JSON.stringify([{ itemId: unpriced, locationId: warehouse, quantity: '1' }]),
        ]
      );
      expect(
        await scalar(
          c,
          `SELECT count(*)::text AS v FROM sal.invoices WHERE sale_kind = 'counter_sale'`
        )
      ).toBe(before);
    });
  });
});

describe('the sale movement — once, at issuance, from the cell the line names', () => {
  it('posts one out movement per line at issue and never a second', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const partner = await seedPartner(c, 'odcs_post');
      const { item } = await seedItem(c, 'odcs_post');
      const { warehouse } = await seedLocations(c, 'odcs_post');
      await seedStock(c, item, warehouse, 10, 'odcs_post');
      await setPrice(c, item, '4.0000');
      const sale = await createCounterSale(c, partner, [
        { itemId: item, locationId: warehouse, quantity: '2.5' },
      ]);
      const line = await one<{ id: string }>(
        c,
        `SELECT id FROM sal.invoice_lines WHERE invoice_id = $1`,
        [sale]
      );

      // While it is a draft the movement has no provenance: the document may still
      // be voided, and stock that left for a voided sale would be unexplainable.
      await expectFail(c, '23514', `SELECT inv.post_counter_sale_line($1,NULL)`, [line.id]);
      expect(await onHand(c, item, warehouse)).toBe('10.000');

      await issueInvoice(c, sale);
      await c.query(`SELECT inv.post_counter_sale_line($1,NULL)`, [line.id]);
      expect(await onHand(c, item, warehouse)).toBe('7.500');
      expect(await movementsFor(c, 'invoice_line', line.id)).toBe('1');

      // The second posting is refused by the index, not by a code path.
      await expectFail(c, '23505', `SELECT inv.post_counter_sale_line($1,NULL)`, [line.id]);
      expect(await onHand(c, item, warehouse)).toBe('7.500');
      expect(await movementsFor(c, 'invoice_line', line.id)).toBe('1');
    });
  });

  it('refuses a sale that is not available, and a posting redirected to another cell', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const partner = await seedPartner(c, 'odcs_avail');
      const { item } = await seedItem(c, 'odcs_avail');
      const { warehouse } = await seedLocations(c, 'odcs_avail');
      const other = await one<{ id: string }>(
        c,
        `INSERT INTO inv.stock_locations (tenant_id, company_id, branch_id, location_code, name, location_type, created_by)
         VALUES ($1,$2,$3,'wh_odcs_avail2','Second','warehouse',$4) RETURNING id`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, USER_A]
      );
      await seedStock(c, item, warehouse, 2, 'odcs_avail');
      await setPrice(c, item, '4.0000');
      const sale = await createCounterSale(c, partner, [
        { itemId: item, locationId: warehouse, quantity: '3' },
      ]);
      const line = await one<{ id: string }>(
        c,
        `SELECT id FROM sal.invoice_lines WHERE invoice_id = $1`,
        [sale]
      );
      await issueInvoice(c, sale);
      // Two on the shelf, three sold: refused INSIDE the balance-row lock.
      await expectFail(c, '23514', `SELECT inv.post_counter_sale_line($1,NULL)`, [line.id]);
      expect(await onHand(c, item, warehouse)).toBe('2.000');

      // And a hand-written movement cannot name a different cell.
      await expectFail(
        c,
        '23503',
        `SELECT inv.post_stock_movement($1,$2,'sale','out',1,'invoice_line',$3,NULL)`,
        [item, other.id, line.id]
      );
    });
  });

  it('will not let a cancelled document return stock, because an issued sale cannot be cancelled', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const partner = await seedPartner(c, 'odcs_void');
      const { item } = await seedItem(c, 'odcs_void');
      const { warehouse } = await seedLocations(c, 'odcs_void');
      await seedStock(c, item, warehouse, 6, 'odcs_void');
      await setPrice(c, item, '9.0000');
      const sale = await createCounterSale(c, partner, [
        { itemId: item, locationId: warehouse, quantity: '1' },
      ]);
      const line = await one<{ id: string }>(
        c,
        `SELECT id FROM sal.invoice_lines WHERE invoice_id = $1`,
        [sale]
      );
      await issueInvoice(c, sale);
      await c.query(`SELECT inv.post_counter_sale_line($1,NULL)`, [line.id]);
      expect(await onHand(c, item, warehouse)).toBe('5.000');

      await expectFail(
        c,
        '23514',
        `UPDATE sal.invoices SET status = 'void_before_issue' WHERE id = $1`,
        [sale]
      );
      // Nothing came back: there is no `in` leg for a sale in the whole matrix.
      expect(await onHand(c, item, warehouse)).toBe('5.000');
      expect(
        await scalar(
          c,
          `SELECT count(*)::text AS v FROM inv.stock_movements
            WHERE reference_kind = 'invoice_line' AND direction = 'in'`
        )
      ).toBe('0');
    });
  });
});

describe('inv.sales_returns — condition, ceiling and credit', () => {
  it('restocks a restockable return and quarantines a damaged one', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const partner = await seedPartner(c, 'odcs_ret');
      const { item } = await seedItem(c, 'odcs_ret');
      const { warehouse, quarantine } = await seedLocations(c, 'odcs_ret');
      await seedStock(c, item, warehouse, 10, 'odcs_ret');
      await setPrice(c, item, '20.0000');
      const sale = await createCounterSale(c, partner, [
        { itemId: item, locationId: warehouse, quantity: '4' },
      ]);
      const line = await one<{ id: string }>(
        c,
        `SELECT id FROM sal.invoice_lines WHERE invoice_id = $1`,
        [sale]
      );
      await issueInvoice(c, sale);
      await c.query(`SELECT inv.post_counter_sale_line($1,NULL)`, [line.id]);
      expect(await onHand(c, item, warehouse)).toBe('6.000');

      const restock = await one<{ id: string }>(
        c,
        `SELECT inv.receive_sales_return('invoice_line',$1,1,'restockable',$2,NULL,'Wrong part',NULL,NULL) AS id`,
        [line.id, warehouse]
      );
      expect(await onHand(c, item, warehouse)).toBe('7.000');
      expect(await movementsFor(c, 'sales_return', restock.id)).toBe('1');

      const damaged = await one<{ id: string }>(
        c,
        `SELECT inv.receive_sales_return('invoice_line',$1,1,'damaged',$2,$3,'Broken',NULL,NULL) AS id`,
        [line.id, warehouse, quarantine]
      );
      // The damaged unit does NOT come back to the sellable cell.
      expect(await onHand(c, item, warehouse)).toBe('7.000');
      expect(await onHand(c, item, quarantine)).toBe('1.000');
      expect(
        await scalar(
          c,
          `SELECT location_id::text AS v FROM inv.stock_movements
            WHERE reference_kind = 'sales_return' AND reference_id = $1`,
          [damaged.id]
        )
      ).toBe(quarantine);
      // And no inv.damaged_stock row is forged for a unit that was never in a
      // sellable cell of this tenant.
      expect(
        await scalar(c, `SELECT count(*)::text AS v FROM inv.damaged_stock WHERE item_id = $1`, [
          item,
        ])
      ).toBe('0');

      // A damaged return into a sellable cell, and a restockable one into quarantine,
      // are both refused: the condition decides the shelf.
      await expectFail(
        c,
        '23514',
        `SELECT inv.receive_sales_return('invoice_line',$1,1,'damaged',$2,$3,NULL,NULL,NULL)`,
        [line.id, warehouse, warehouse]
      );
      await expectFail(
        c,
        '23514',
        `SELECT inv.receive_sales_return('invoice_line',$1,1,'restockable',$2,NULL,NULL,NULL,NULL)`,
        [line.id, quarantine]
      );
    });
  });

  it('raises exactly one pending credit note for the returned share of the line', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const partner = await seedPartner(c, 'odcs_credit');
      const { item } = await seedItem(c, 'odcs_credit');
      const { warehouse } = await seedLocations(c, 'odcs_credit');
      await seedStock(c, item, warehouse, 10, 'odcs_credit');
      const taxClass = await seedTax(c, 'odcs_credit', '0.160000');
      // 7.5000 x 4 = 30.0000 net, 4.8000 tax, 34.8000 gross. One of four back is 8.7000.
      await setPrice(c, item, '7.5000', { taxClass });
      const sale = await createCounterSale(c, partner, [
        { itemId: item, locationId: warehouse, quantity: '4' },
      ]);
      const line = await one<{ id: string }>(
        c,
        `SELECT id FROM sal.invoice_lines WHERE invoice_id = $1`,
        [sale]
      );
      await issueInvoice(c, sale);
      await c.query(`SELECT inv.post_counter_sale_line($1,NULL)`, [line.id]);

      const returned = await one<{ id: string }>(
        c,
        `SELECT inv.receive_sales_return('invoice_line',$1,1,'restockable',$2,NULL,'Unused',NULL,NULL) AS id`,
        [line.id, warehouse]
      );
      const row = await one<{ status: string; credit: string }>(
        c,
        `SELECT status, credit_note_id::text AS credit FROM inv.sales_returns WHERE id = $1`,
        [returned.id]
      );
      expect(row.status).toBe('credited');
      const note = await one<{ amount: string; state: string; currency: string; invoice: string }>(
        c,
        `SELECT amount::text AS amount, approval_state AS state, currency_code AS currency,
                invoice_id::text AS invoice
           FROM sal.credit_notes WHERE id = $1`,
        [row.credit]
      );
      expect(note).toEqual({
        amount: '8.7000',
        state: 'pending',
        currency: 'USD',
        invoice: sale,
      });
      // Exactly one: the return does not credit twice, and it does not approve itself.
      expect(
        await scalar(c, `SELECT count(*)::text AS v FROM sal.credit_notes WHERE invoice_id = $1`, [
          sale,
        ])
      ).toBe('1');

      // Returning the whole remaining line credits the rest exactly — 26.1000 —
      // so the four credits of a full return sum to the line gross and not a
      // rounding artefact of a per-unit division.
      const rest = await one<{ id: string }>(
        c,
        `SELECT inv.receive_sales_return('invoice_line',$1,3,'restockable',$2,NULL,'All back',NULL,NULL) AS id`,
        [line.id, warehouse]
      );
      expect(
        await scalar(
          c,
          `SELECT amount::text AS v FROM sal.credit_notes
            WHERE id = (SELECT credit_note_id FROM inv.sales_returns WHERE id = $1)`,
          [rest.id]
        )
      ).toBe('26.1000');
      expect(
        await scalar(
          c,
          `SELECT sum(amount)::text AS v FROM sal.credit_notes WHERE invoice_id = $1`,
          [sale]
        )
      ).toBe('34.8000');
    });
  });

  it('bounds the total against BOTH return tables and reports the remainder', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'odcs_ceiling');
      const { warehouse } = await seedLocations(c, 'odcs_ceiling');
      await seedStock(c, item, warehouse, 10, 'odcs_ceiling');
      const { wo } = await makeWorkOrder(c, 'odcs_ceiling');
      const { request } = await seedMaterialRequest(c, wo, item, 5);
      const issue = await one<{ id: string }>(
        c,
        `SELECT inv.issue_material_request($1,$2,5,NULL) AS id`,
        [request, warehouse]
      );

      expect(
        await one<{ source: string; returned: string; remaining: string }>(
          c,
          `SELECT source_quantity::text AS source, returned_quantity::text AS returned,
                  remaining_quantity::text AS remaining
             FROM inv.returnable_quantity('part_issue',$1)`,
          [issue.id]
        )
      ).toEqual({ source: '5.000', returned: '0.000', remaining: '5.000' });

      // Two back through the OLD path, two through the new one.
      await c.query(`SELECT inv.return_part($1,2,'Old path',NULL)`, [issue.id]);
      await c.query(
        `SELECT inv.receive_sales_return('part_issue',$1,2,'restockable',$2,NULL,'New path',NULL,NULL)`,
        [issue.id, warehouse]
      );
      expect(
        await one<{ returned: string; remaining: string }>(
          c,
          `SELECT returned_quantity::text AS returned, remaining_quantity::text AS remaining
             FROM inv.returnable_quantity('part_issue',$1)`,
          [issue.id]
        )
      ).toEqual({ returned: '4.000', remaining: '1.000' });

      // The fifth is the last: a sixth is refused, through either path.
      await c.query(
        `SELECT inv.receive_sales_return('part_issue',$1,1,'restockable',$2,NULL,NULL,NULL,NULL)`,
        [issue.id, warehouse]
      );
      await expectFail(
        c,
        '23514',
        `SELECT inv.receive_sales_return('part_issue',$1,1,'restockable',$2,NULL,NULL,NULL,NULL)`,
        [issue.id, warehouse]
      );
      await expectFail(c, '23514', `SELECT inv.return_part($1,1,NULL,NULL)`, [issue.id]);
      expect(await onHand(c, item, warehouse)).toBe('10.000');
      // An internal return credits nothing: nothing was invoiced for it.
      expect(
        await scalar(
          c,
          `SELECT count(*)::text AS v FROM inv.sales_returns
            WHERE source_kind = 'part_issue' AND credit_note_id IS NOT NULL`
        )
      ).toBe('0');
    });
  });

  /**
   * The ceiling is keyed on NEW.tenant_id, never on `iam.current_tenant_id()`.
   *
   * `inv.guard_part_return_ceiling` was written that way from the start. Its sibling
   * reached both the source and the running total through helpers that read the GUC,
   * so in a session carrying none the source was not found and the sum was zero — a
   * ceiling that refuses for the wrong reason, or does not bind at all. Both helpers
   * now take the tenant as an argument. This case holds them to it: the GUC is
   * cleared INSIDE the transaction once the fixtures are in place, and the guard must
   * still find the issue and still count what has already come back.
   */
  it('binds the ceiling on the row tenant, in a session carrying no tenant GUC', async () => {
    await withRolledBackTx(admin, ctxA, async (c) => {
      const { item } = await seedItem(c, 'odcs_noguc');
      const { warehouse } = await seedLocations(c, 'odcs_noguc');
      await seedStock(c, item, warehouse, 10, 'odcs_noguc');
      const { wo } = await makeWorkOrder(c, 'odcs_noguc');
      const { request } = await seedMaterialRequest(c, wo, item, 5);
      const issue = await one<{ id: string }>(
        c,
        `SELECT inv.issue_material_request($1,$2,5,NULL) AS id`,
        [request, warehouse]
      );

      await c.query(`SELECT set_config('app.tenant_id','',true)`);
      expect(await scalar(c, `SELECT (iam.current_tenant_id() IS NULL)::text AS v`)).toBe('true');

      const rawReturn = `INSERT INTO inv.sales_returns
          (tenant_id, company_id, branch_id, source_kind, source_id, item_id, quantity,
           return_condition, received_location_id, created_by)
        VALUES ($1,$2,$3,'part_issue',$4,$5,$6::numeric,'restockable',$7,$8)`;
      const args = (quantity: string): unknown[] => [
        TENANT_A,
        COMPANY_A1,
        BRANCH_A1,
        issue.id,
        item,
        quantity,
        warehouse,
        USER_A,
      ];

      // Four of the five come back: the source is located by NEW.tenant_id alone.
      await c.query(rawReturn, args('4'));
      // The running total is keyed the same way, so two more are one too many.
      await expectFail(c, '23514', rawReturn, args('2'));
      // The fifth is still allowed, so the guard bounds rather than blocks.
      await c.query(rawReturn, args('1'));
      expect(
        await scalar(
          c,
          `SELECT sum(quantity)::text AS v FROM inv.sales_returns WHERE source_id = $1`,
          [issue.id]
        )
      ).toBe('5.000');
    });
  });

  it('replays an idempotency key instead of receiving the part twice', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { item } = await seedItem(c, 'odcs_idem');
      const { warehouse } = await seedLocations(c, 'odcs_idem');
      await seedStock(c, item, warehouse, 10, 'odcs_idem');
      const { wo } = await makeWorkOrder(c, 'odcs_idem');
      const { request } = await seedMaterialRequest(c, wo, item, 3);
      const issue = await one<{ id: string }>(
        c,
        `SELECT inv.issue_material_request($1,$2,3,NULL) AS id`,
        [request, warehouse]
      );
      const first = await one<{ id: string }>(
        c,
        `SELECT inv.receive_sales_return('part_issue',$1,1,'restockable',$2,NULL,NULL,'odcs-key-1',NULL) AS id`,
        [issue.id, warehouse]
      );
      const second = await one<{ id: string }>(
        c,
        `SELECT inv.receive_sales_return('part_issue',$1,1,'restockable',$2,NULL,NULL,'odcs-key-1',NULL) AS id`,
        [issue.id, warehouse]
      );
      expect(second.id).toBe(first.id);
      expect(await onHand(c, item, warehouse)).toBe('8.000');
      expect(
        await scalar(c, `SELECT count(*)::text AS v FROM inv.sales_returns WHERE source_id = $1`, [
          issue.id,
        ])
      ).toBe('1');
    });
  });

  it('refuses a return of an unissued sale and of a line that sold no stock', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const partner = await seedPartner(c, 'odcs_unissued');
      const { item } = await seedItem(c, 'odcs_unissued');
      const { warehouse } = await seedLocations(c, 'odcs_unissued');
      await seedStock(c, item, warehouse, 5, 'odcs_unissued');
      await setPrice(c, item, '3.0000');
      const draft = await createCounterSale(c, partner, [
        { itemId: item, locationId: warehouse, quantity: '1' },
      ]);
      const draftLine = await one<{ id: string }>(
        c,
        `SELECT id FROM sal.invoice_lines WHERE invoice_id = $1`,
        [draft]
      );
      await expectFail(
        c,
        '23514',
        `SELECT inv.receive_sales_return('invoice_line',$1,1,'restockable',$2,NULL,NULL,NULL,NULL)`,
        [draftLine.id, warehouse]
      );

      // A work-order invoice line sells no stock: its parts left as a part issue.
      const { wo } = await makeWorkOrder(c, 'odcs_unissued_wo');
      const invoice = await seedDraftInvoice(c, { wo, payer: partner });
      const { line } = await addInvoiceLine(c, invoice, { lineNumber: 1, net: 10 });
      await issueInvoice(c, invoice);
      await expectFail(
        c,
        '23514',
        `SELECT inv.receive_sales_return('invoice_line',$1,1,'restockable',$2,NULL,NULL,NULL,NULL)`,
        [line, warehouse]
      );
      // And an unknown source kind is refused rather than silently unbounded.
      await expectFail(
        c,
        '23514',
        `SELECT inv.receive_sales_return('goods_receipt_line',$1,1,'restockable',$2,NULL,NULL,NULL,NULL)`,
        [line, warehouse]
      );
    });
  });
});
