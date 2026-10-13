/**
 * P1-32-PRE-OD-FD6 — part lines on quotations (ADR-023 D6), at the database.
 *
 * What migration 20261005100000_quo_part_line_snapshots.sql promises and these
 * cases hold it to:
 *
 *  - the six snapshot columns, the two foreign keys and the guard exist, and every
 *    existing kind of row still writes (a service line carries none of them);
 *  - a part line is accepted ONLY at exactly what `inv.resolve_item_sale_price`
 *    answers for its branch — price row, unit price, currency and tax class — with
 *    the class's effective rate (zero for none), and the item's current stock code,
 *    name and unit. A typed figure (a cost, a stale price, the company row while a
 *    branch row applies), no price at all, an archived item, a wrong snapshot or a
 *    wrong rate are refused;
 *  - the snapshot is frozen: an UPDATE of the item, unit, price row, unit price or
 *    tax rate of a part line is refused, while an ordinary draft edit (the
 *    description) still goes through; a later catalogue price or unit change leaves
 *    the written line exactly as it was;
 *  - a part line links only a required part of its own work order, naming its item;
 *  - a work-order invoice part line copied from it cannot carry stock coordinates
 *    and cannot be posted as a sale, so invoicing it moves no stock;
 *  - another tenant's caller can neither see the line nor write a part line naming
 *    this tenant's item.
 */
import type { Client } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withRolledBackTx,
  setContext,
  TENANT_A,
  TENANT_B,
  COMPANY_A1,
  BRANCH_A1,
  USER_A,
  USER_B,
} from './helpers';
import {
  seedItem,
  seedService,
  seedQuotation,
  draftRevision,
  addServiceItem,
} from './p1-10-helpers';
import {
  ctxA,
  expectFail,
  makeWorkOrder,
  seedDraftInvoice,
  seedP111Base,
  seedPartner,
} from './p1-11-helpers';

type Q = { query: Client['query'] };

const admin = adminPool();
const runtime = runtimePool();
/** A second branch of COMPANY_A1, so "another branch's row" names a real branch. */
const BRANCH_ELSEWHERE = 'a1100000-0000-4000-8000-000000fd6a02';

beforeAll(async () => {
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  await seedP111Base(admin);
  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'branch_fd6_elsewhere','Fixture Branch FD6 elsewhere','UTC',$4)
     ON CONFLICT (id) DO NOTHING`,
    [BRANCH_ELSEWHERE, TENANT_A, COMPANY_A1, USER_A]
  );
}, 180_000);

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

const one = async <T>(c: Q, sql: string, params: unknown[] = []): Promise<T> =>
  (await c.query(sql, params)).rows[0] as T;

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

interface Part {
  readonly item: string;
  readonly priceRef: string;
  readonly price: string;
  readonly sku: string;
  readonly name: string;
  readonly unitCode: string;
  readonly unitName: string;
  readonly taxClass?: string | null;
  readonly taxRate?: string;
  readonly quantity?: string;
  readonly discount?: string;
  readonly line?: number;
  readonly requiredPart?: string | null;
}

/** The part-line INSERT with its money computed in SQL, as `tg_quotation_items_money` requires. */
const insertPart = `INSERT INTO quo.quotation_items
   (tenant_id, company_id, branch_id, quotation_revision_id, line_number, item_kind, item_ref,
    item_sale_price_ref, quoted_item_sku, quoted_item_name, quoted_unit_code,
    quoted_unit_name, quoted_tax_class_ref, source_required_part_ref, currency_code,
    captured_unit_price, captured_quantity, captured_discount, captured_tax_rate,
    captured_tax_amount, captured_line_total, created_by)
 SELECT $1,$2,$3,$4,$5,'part',$6,$7,$8,$9,$10,$11,$12,$13,'USD',$14,$15,$16,$17, m.tax, m.net + m.tax, $18
   FROM (SELECT n.net, shared.round_to_minor_unit(n.net * $17::numeric(9,6), 'USD') AS tax
           FROM (SELECT shared.round_to_minor_unit(
                          $14::numeric(18,4) * $15::numeric(12,3) - $16::numeric(18,4), 'USD') AS net) n) m
 RETURNING id`;

const partParams = (revision: string, p: Part): unknown[] => [
  TENANT_A,
  COMPANY_A1,
  BRANCH_A1,
  revision,
  p.line ?? 1,
  p.item,
  p.priceRef,
  p.sku,
  p.name,
  p.unitCode,
  p.unitName,
  p.taxClass ?? null,
  p.requiredPart ?? null,
  p.price,
  p.quantity ?? '2',
  p.discount ?? '0',
  p.taxRate ?? '0',
  USER_A,
];

const addPart = async (c: Q, revision: string, p: Part): Promise<string> =>
  (await c.query(insertPart, partParams(revision, p))).rows[0].id as string;

/** A draft USD revision on a fresh work order, and an item priced at the branch. */
async function scene(c: Q, tag: string) {
  const { wo } = await makeWorkOrder(c, tag);
  const quotation = await seedQuotation(c, wo, tag);
  const revision = await draftRevision(c, quotation, 1);
  const { item, uom } = await seedItem(c, tag);
  const priceRef = await setPrice(c, item, '12.3400', { branch: BRANCH_A1 });
  const part: Part = {
    item,
    priceRef,
    price: '12.3400',
    sku: `SKU_${tag}`,
    name: `Item ${tag}`,
    unitCode: `u_${tag}`,
    unitName: `Unit ${tag}`,
  };
  return { wo, quotation, revision, item, uom, priceRef, part };
}

describe('quo.quotation_items — the part-line snapshot columns and their guard', () => {
  it('adds six nullable snapshot columns, two foreign keys and one guard trigger', async () => {
    const columns = await admin.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'quo' AND table_name = 'quotation_items'
          AND column_name IN ('item_sale_price_ref','quoted_item_sku','quoted_item_name',
                              'quoted_unit_code','quoted_unit_name','quoted_tax_class_ref')
        ORDER BY column_name`
    );
    expect(columns.rows).toEqual([
      { column_name: 'item_sale_price_ref', data_type: 'uuid', is_nullable: 'YES' },
      { column_name: 'quoted_item_name', data_type: 'text', is_nullable: 'YES' },
      { column_name: 'quoted_item_sku', data_type: 'text', is_nullable: 'YES' },
      { column_name: 'quoted_tax_class_ref', data_type: 'uuid', is_nullable: 'YES' },
      { column_name: 'quoted_unit_code', data_type: 'text', is_nullable: 'YES' },
      { column_name: 'quoted_unit_name', data_type: 'text', is_nullable: 'YES' },
    ]);
    const constraints = await admin.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'quo.quotation_items'::regclass
          AND conname IN ('fk_quotation_items_sale_price','fk_quotation_items_tax_class')
        ORDER BY conname`
    );
    expect(constraints.rows.map((row) => row.conname)).toEqual([
      'fk_quotation_items_sale_price',
      'fk_quotation_items_tax_class',
    ]);
    const trigger = await admin.query<{ tgname: string; secdef: boolean }>(
      `SELECT t.tgname, p.prosecdef AS secdef FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE t.tgrelid = 'quo.quotation_items'::regclass AND t.tgname = 'tg_quotation_items_part_line'`
    );
    expect(trigger.rows).toEqual([{ tgname: 'tg_quotation_items_part_line', secdef: false }]);
  });

  it('still writes a service line, which carries none of the part columns', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { revision, item } = await scene(c, 'fd6_svc');
      const { service } = await seedService(c, 'fd6_svc');
      await addServiceItem(c, revision, service, 1, 100, 1);
      await expectFail(
        c,
        '23514',
        `INSERT INTO quo.quotation_items
           (tenant_id, company_id, branch_id, quotation_revision_id, line_number, item_kind,
            service_id, item_ref, currency_code, captured_unit_price, captured_quantity,
            captured_tax_amount, captured_line_total, created_by)
         VALUES ($1,$2,$3,$4,2,'service',$5,$6,'USD',10,1,0,10,$7)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, revision, service, item, USER_A]
      );
    });
  });
});

describe('a part line is written only at the authorised sales price', () => {
  it('accepts exactly the resolved branch price, its row, its tax class and rate, and the item now', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { revision, item, part } = await scene(c, 'fd6_ok');
      const taxClass = await seedTax(c, 'fd6_ok', '0.160000');
      const priceRef = await setPrice(c, item, '12.3400', { branch: BRANCH_A1, taxClass });
      const id = await addPart(c, revision, { ...part, priceRef, taxClass, taxRate: '0.160000' });
      const row = await one<Record<string, string>>(
        c,
        `SELECT item_kind, captured_unit_price::text AS price, captured_tax_amount::text AS tax,
                captured_line_total::text AS total, quoted_unit_code AS unit
           FROM quo.quotation_items WHERE id = $1`,
        [id]
      );
      // 12.34 x 2 = 24.68 net; 16% is 3.9488, half-up to the cent: 3.95.
      expect(row).toEqual({
        item_kind: 'part',
        price: '12.3400',
        tax: '3.9500',
        total: '28.6300',
        unit: part.unitCode,
      });
    });
  });

  it('refuses a typed figure, the less specific row, no price, an archived item, a wrong snapshot or rate', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { revision, item, part } = await scene(c, 'fd6_no');
      const companyRow = await setPrice(c, item, '15.0000');
      const refused = async (p: Part): Promise<void> =>
        expectFail(c, '23514', insertPart, partParams(revision, p));
      // A figure that is not the resolved price — a cost, a discount baked in.
      await refused({ ...part, price: '9.9900' });
      // The company row while a branch row applies to this branch.
      await refused({ ...part, priceRef: companyRow, price: '15.0000' });
      // A snapshot that is not the item's own.
      await refused({ ...part, unitName: 'Box' });
      await refused({ ...part, name: 'Renamed' });
      // A tax rate for an untaxed price.
      await refused({ ...part, taxRate: '0.160000' });
      // A part line with a service.
      const { service } = await seedService(c, 'fd6_no');
      await expectFail(c, '23514', `UPDATE quo.quotation_items SET service_id = $2 WHERE id = $1`, [
        await addPart(c, revision, { ...part, line: 9 }),
        service,
      ]);

      // No price at all for the item.
      const { item: unpriced } = await seedItem(c, 'fd6_unpriced');
      await refused({
        ...part,
        item: unpriced,
        sku: 'SKU_fd6_unpriced',
        name: 'Item fd6_unpriced',
        unitCode: 'u_fd6_unpriced',
        unitName: 'Unit fd6_unpriced',
      });

      // An archived item.
      await c.query(
        `UPDATE inv.item_master SET lifecycle_status = 'archived', archived_at = now() WHERE id = $1`,
        [item]
      );
      await refused({ ...part, line: 2 });
    });
  });

  it('prices from the branch row, else the company row, else the tenant-wide row — never another branch', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { revision } = await scene(c, 'fd6_prec');
      const { item } = await seedItem(c, 'fd6_prec2');
      const base: Part = {
        item,
        priceRef: '',
        price: '',
        sku: 'SKU_fd6_prec2',
        name: 'Item fd6_prec2',
        unitCode: 'u_fd6_prec2',
        unitName: 'Unit fd6_prec2',
      };
      const tenantWide = await setPrice(c, item, '5.0000', { company: null });
      // Another branch's row never prices this branch.
      const elsewhere = await setPrice(c, item, '4.0000', { branch: BRANCH_ELSEWHERE });
      await expectFail(
        c,
        '23514',
        insertPart,
        partParams(revision, { ...base, priceRef: elsewhere, price: '4.0000' })
      );
      await addPart(c, revision, { ...base, priceRef: tenantWide, price: '5.0000', line: 1 });
      const company = await setPrice(c, item, '6.0000');
      await expectFail(
        c,
        '23514',
        insertPart,
        partParams(revision, { ...base, priceRef: tenantWide, price: '5.0000', line: 2 })
      );
      await addPart(c, revision, { ...base, priceRef: company, price: '6.0000', line: 2 });
      const branch = await setPrice(c, item, '7.0000', { branch: BRANCH_A1 });
      await addPart(c, revision, { ...base, priceRef: branch, price: '7.0000', line: 3 });
    });
  });
});

describe('the snapshot is frozen, and a later catalogue change never reaches it', () => {
  it('refuses an UPDATE of the item, unit, price row, price or rate; a description edit still goes through', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { revision, part } = await scene(c, 'fd6_frz');
      const id = await addPart(c, revision, part);
      await c.query(`UPDATE quo.quotation_items SET description = 'Front pads' WHERE id = $1`, [
        id,
      ]);
      for (const assignment of [
        `quoted_unit_code = 'box'`,
        `quoted_unit_name = 'Box'`,
        `quoted_item_name = 'Other'`,
        `item_sale_price_ref = NULL`,
        `item_kind = 'service'`,
        `captured_unit_price = 1, captured_tax_amount = 0, captured_line_total = 2`,
        `captured_tax_rate = 0.5, captured_tax_amount = 12.34, captured_line_total = 37.02`,
      ]) {
        await expectFail(c, '23514', `UPDATE quo.quotation_items SET ${assignment} WHERE id = $1`, [
          id,
        ]);
      }
    });
  });

  it('keeps the written line when the price, the unit and the name change in the catalogue', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { revision, item, part } = await scene(c, 'fd6_cat');
      const id = await addPart(c, revision, part);
      await setPrice(c, item, '20.0000', { branch: BRANCH_A1 });
      const other = await one<{ id: string }>(
        c,
        `INSERT INTO inv.units_of_measure (scope, tenant_id, code, name, dimension, created_by)
         VALUES ('tenant',$1,'u_fd6_cat_box','Box fd6','count',$2) RETURNING id`,
        [TENANT_A, USER_A]
      );
      await c.query(`UPDATE inv.item_master SET uom_id = $2, name = 'Renamed fd6' WHERE id = $1`, [
        item,
        other.id,
      ]);
      const row = await one<Record<string, string>>(
        c,
        `SELECT captured_unit_price::text AS price, quoted_unit_code AS unit,
                quoted_unit_name AS unit_name, quoted_item_name AS name
           FROM quo.quotation_items WHERE id = $1`,
        [id]
      );
      expect(row).toEqual({
        price: '12.3400',
        unit: part.unitCode,
        unit_name: part.unitName,
        name: part.name,
      });
      // The same old figures can no longer be written: a new line takes the catalogue now.
      await expectFail(c, '23514', insertPart, partParams(revision, { ...part, line: 2 }));
    });
  });
});

describe('the required part a line quotes belongs to its own work order', () => {
  it('links one of its own required parts naming the item, and refuses another work order or item', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo, revision, item, part } = await scene(c, 'fd6_rp');
      const addRequired = async (workOrder: string, itemRef: string | null): Promise<string> =>
        (
          await one<{ id: string }>(
            c,
            `INSERT INTO wo.required_parts (tenant_id, company_id, branch_id, work_order_id,
               description, quantity, unit, item_ref, created_by)
             VALUES ($1,$2,$3,$4,'Brake pads',2,'each',$5,$6) RETURNING id`,
            [TENANT_A, COMPANY_A1, BRANCH_A1, workOrder, itemRef, USER_A]
          )
        ).id;
      await addPart(c, revision, { ...part, requiredPart: await addRequired(wo, item) });
      await addPart(c, revision, { ...part, line: 2, requiredPart: await addRequired(wo, null) });
      const { wo: otherOrder } = await makeWorkOrder(c, 'fd6_rp_other');
      await expectFail(
        c,
        '23514',
        insertPart,
        partParams(revision, {
          ...part,
          line: 3,
          requiredPart: await addRequired(otherOrder, item),
        })
      );
      const { item: otherItem } = await seedItem(c, 'fd6_rp_item');
      await expectFail(
        c,
        '23514',
        insertPart,
        partParams(revision, { ...part, line: 4, requiredPart: await addRequired(wo, otherItem) })
      );
    });
  });
});

describe('invoicing a part line moves no stock', () => {
  it('a work-order invoice part line carries no stock coordinates and cannot be posted as a sale', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo, revision, part } = await scene(c, 'fd6_inv');
      const source = await addPart(c, revision, part);
      const partner = await seedPartner(c, 'fd6_inv');
      const invoice = await seedDraftInvoice(c, { wo, payer: partner });
      const { id: line } = await one<{ id: string }>(
        c,
        `INSERT INTO sal.invoice_lines (tenant_id, company_id, branch_id, invoice_id, line_number,
           line_type, quantity, currency_code, source_quotation_item_id, created_by)
         VALUES ($1,$2,$3,$4,1,'part',2,'USD',$5,$6) RETURNING id`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, invoice, source, USER_A]
      );
      const before = await one<{ n: number }>(
        c,
        `SELECT count(*)::int AS n FROM inv.stock_movements WHERE tenant_id = $1`,
        [TENANT_A]
      );
      await expectFail(c, '23514', `SELECT inv.post_counter_sale_line($1)`, [line]);
      await expectFail(c, '23514', `UPDATE sal.invoice_lines SET item_id = $2 WHERE id = $1`, [
        line,
        part.item,
      ]);
      const after = await one<{ n: number }>(
        c,
        `SELECT count(*)::int AS n FROM inv.stock_movements WHERE tenant_id = $1`,
        [TENANT_A]
      );
      expect(after.n).toBe(before.n);
    });
  });
});

describe('tenant isolation', () => {
  it('another tenant neither sees the line nor resolves a price for this tenant’s item', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { revision, part } = await scene(c, 'fd6_iso');
      const id = await addPart(c, revision, part);
      // Positive control: tenant A sees its own line and its item's price.
      const own = await c.query(`SELECT 1 FROM quo.quotation_items WHERE id = $1`, [id]);
      expect(own.rowCount).toBe(1);
      // The same transaction, as tenant B: row security hides both.
      await setContext(c, { tenantId: TENANT_B, userId: USER_B });
      const seen = await c.query(`SELECT 1 FROM quo.quotation_items WHERE id = $1`, [id]);
      expect(seen.rowCount).toBe(0);
      const price = await c.query(`SELECT * FROM inv.resolve_item_sale_price($1,$2,$3)`, [
        part.item,
        COMPANY_A1,
        BRANCH_A1,
      ]);
      expect(price.rowCount).toBe(0);
    });
  });
});
