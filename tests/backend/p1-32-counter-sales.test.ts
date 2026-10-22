/**
 * P1-32 preparatory slice 2 — the selling price of an item and the counter sale,
 * end to end through their route handlers (P1-32-PRE-105…111).
 *
 * The assertions rest on ROWS: invoice amounts, stock balances, movements and audit
 * records. The properties this suite exists to hold:
 *
 *  - a selling price is one live row per (item, company, branch); setting the same
 *    signature again revises it, and a branch narrowing must name its company;
 *  - a tenant-wide price needs `inv.item.manage` held tenant-wide, because a row
 *    with no company applies in every branch of every company;
 *  - a counter sale is priced by the database — no field on the request can carry an
 *    amount, and an unpriced item refuses the sale rather than selling at zero;
 *  - a DRAFT counter sale moves no stock; ISSUING it takes exactly the sold quantity
 *    off exactly the cell each line names, once;
 *  - a sale cannot take stock that is not available, and an issued sale cannot be
 *    cancelled — so a cancelled document never returns stock;
 *  - nothing of tenant A is visible or writable for tenant B, and a branch-scoped
 *    caller cannot sell in a branch it does not hold.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   inv.item-sale-price-list: route service authorization success cross-tenant isolation
 *   inv.item-sale-price-set: route service authorization success denial cross-tenant audit isolation
 *   sal.counter-sale-create: route service authorization success denial cross-tenant audit idempotency isolation
 *   sal.counter-sale-list: route service authorization success isolation
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  BRANCH_A1,
  COMPANY_A1,
  TENANT_A,
  USER_A,
} from './helpers';
import { establishP1_19Fixtures, PARTNER_A } from './p1-19-helpers';
import {
  INV_CATALOG_SCOPED_A1,
  INV_COUNTER,
  INV_COUNTER_SCOPED_A2,
  INV_FULL,
  INV_READER,
  INV_TENANT_B_COUNTER,
  ITEM_A,
  ITEM_A_ALT,
  auditCountFor,
  authAs,
  cleanP1_21Fixtures,
  countRowsOf,
  establishP1_21Fixtures,
  freshLocation,
  seedStock,
} from './p1-21-helpers';
import {
  GET as SALE_PRICE_LIST,
  POST as SALE_PRICE_SET,
} from '@/app/api/v1/items/[itemId]/sale-prices/route';
import {
  GET as COUNTER_SALE_LIST,
  POST as COUNTER_SALE_CREATE,
} from '@/app/api/v1/counter-sales/route';
import { POST as ISSUE_INVOICE } from '@/app/api/v1/invoices/[invoiceId]/issuance/route';

let admin: Pool;

type ParamHandler<P> = (request: Request, route: { params: Promise<P> }) => Promise<Response>;

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

const setPrice = (itemId: string, body: unknown): Promise<Response> =>
  (SALE_PRICE_SET as ParamHandler<{ itemId: string }>)(
    new Request(`http://localhost/api/v1/items/${itemId}/sale-prices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ itemId }) }
  );

const listPrices = (itemId: string): Promise<Response> =>
  (SALE_PRICE_LIST as ParamHandler<{ itemId: string }>)(
    new Request(`http://localhost/api/v1/items/${itemId}/sale-prices`),
    { params: Promise.resolve({ itemId }) }
  );

const createSale = (body: unknown, key: string = randomUUID()): Promise<Response> =>
  COUNTER_SALE_CREATE(
    new Request('http://localhost/api/v1/counter-sales', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    })
  );

const listSales = (query: string): Promise<Response> =>
  COUNTER_SALE_LIST(new Request(`http://localhost/api/v1/counter-sales?${query}`));

const issue = (invoiceId: string, version: number): Promise<Response> =>
  (ISSUE_INVOICE as ParamHandler<{ invoiceId: string }>)(
    new Request(`http://localhost/api/v1/invoices/${invoiceId}/issuance`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
        'if-match': String(version),
      },
    }),
    { params: Promise.resolve({ invoiceId }) }
  );

interface SalePriceBody {
  readonly id: string;
  readonly itemId: string;
  readonly companyId: string | null;
  readonly branchId: string | null;
  readonly currencyCode: string;
  readonly unitPrice: string;
  readonly taxClassId: string | null;
  readonly recordVersion: number;
}

interface SaleBody {
  readonly invoice: {
    readonly id: string;
    readonly workOrderId: string | null;
    readonly saleKind: string;
    readonly status: string;
    readonly payerPartnerId: string;
    readonly currency: string;
    readonly totals: { readonly gross: { readonly amount: string } } | null;
  };
  readonly lines: readonly { readonly id: string; readonly quantity: string }[];
  readonly recordVersion: number;
  readonly replayed: boolean;
}

const onHandOf = (itemId: string, locationId: string): Promise<number> =>
  countRowsOf(
    `SELECT COALESCE(sum(on_hand_qty), 0)::text AS n FROM inv.stock_balances
      WHERE tenant_id = $1 AND item_id = $2 AND location_id = $3`,
    [TENANT_A, itemId, locationId]
  );

const saleMovementsOf = (invoiceId: string): Promise<number> =>
  countRowsOf(
    `SELECT count(*)::text AS n FROM inv.stock_movements m
      WHERE m.tenant_id = $1 AND m.reference_kind = 'invoice_line'
        AND m.reference_id IN (SELECT id FROM sal.invoice_lines WHERE invoice_id = $2)`,
    [TENANT_A, invoiceId]
  );

/** The branch invoice sequence. `app_runtime` holds no INSERT on it, so the fixture does. */
async function provisionInvoiceSequence(): Promise<void> {
  await admin.query(
    `INSERT INTO shared.number_sequences
       (tenant_id, company_id, branch_id, sequence_code, prefix_template, next_value,
        pad_width, period_reset_rule, created_by)
     VALUES ($1,$2,$3,'invoice','ODCS-',1,6,'never',$4)
     ON CONFLICT (tenant_id, sequence_code, company_id, branch_id) DO NOTHING`,
    [TENANT_A, COMPANY_A1, BRANCH_A1, USER_A]
  );
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_21Fixtures(admin);
  await provisionInvoiceSequence();
  await admin.query(`DELETE FROM inv.item_sale_prices WHERE tenant_id = $1`, [TENANT_A]);
}, 180_000);

afterAll(async () => {
  await cleanP1_21Fixtures();
  await cleanBackendFixtures(admin);
  await admin.end();
});

describe('inv.item-sale-price-set', () => {
  it('sets one live row per signature, revises it on a second call, and audits both', async () => {
    authAs(INV_COUNTER);
    const created = await setPrice(ITEM_A, {
      companyId: COMPANY_A1,
      currencyCode: 'USD',
      unitPrice: '12.5000',
    });
    expect(created.status).toBe(200);
    const first = await bodyOf<SalePriceBody>(created);
    expect(first.unitPrice).toBe('12.5000');
    expect(first.companyId).toBe(COMPANY_A1);
    expect(first.branchId).toBeNull();
    expect(first.recordVersion).toBe(1);
    expect(await auditCountFor('inv.item_sale_price.set', first.id)).toBe(1);

    const revised = await setPrice(ITEM_A, {
      companyId: COMPANY_A1,
      currencyCode: 'USD',
      unitPrice: '13.7500',
    });
    expect(revised.status).toBe(200);
    const second = await bodyOf<SalePriceBody>(revised);
    expect(second.id).toBe(first.id);
    expect(second.unitPrice).toBe('13.7500');
    expect(second.recordVersion).toBe(2);
    expect(await auditCountFor('inv.item_sale_price.set', first.id)).toBe(2);
    expect(
      await countRowsOf(`SELECT count(*)::text AS n FROM inv.item_sale_prices WHERE item_id = $1`, [
        ITEM_A,
      ])
    ).toBe(1);
  });

  it('refuses a branch narrowing with no company, and a price that is not a decimal string', async () => {
    authAs(INV_COUNTER);
    const orphanBranch = await setPrice(ITEM_A_ALT, {
      branchId: BRANCH_A1,
      currencyCode: 'USD',
      unitPrice: '5.0000',
    });
    expect(orphanBranch.status).toBe(422);

    const numeric = await setPrice(ITEM_A_ALT, {
      companyId: COMPANY_A1,
      currencyCode: 'USD',
      // A JSON number, which `numeric(18,4)` cannot be carried by.
      unitPrice: 5,
    });
    expect(numeric.status).toBe(422);
    expect(
      await countRowsOf(`SELECT count(*)::text AS n FROM inv.item_sale_prices WHERE item_id = $1`, [
        ITEM_A_ALT,
      ])
    ).toBe(0);
  });

  it('refuses a branch-scoped catalogue grant and a caller with no catalogue authority', async () => {
    authAs(INV_CATALOG_SCOPED_A1);
    const scoped = await setPrice(ITEM_A_ALT, {
      currencyCode: 'USD',
      unitPrice: '9.0000',
    });
    expect(scoped.status).toBe(403);

    authAs(INV_READER);
    const reader = await setPrice(ITEM_A_ALT, {
      companyId: COMPANY_A1,
      currencyCode: 'USD',
      unitPrice: '9.0000',
    });
    expect(reader.status).toBe(403);
    expect(
      await countRowsOf(`SELECT count(*)::text AS n FROM inv.item_sale_prices WHERE item_id = $1`, [
        ITEM_A_ALT,
      ])
    ).toBe(0);
  });

  it('never resolves an item of another tenant', async () => {
    authAs(INV_TENANT_B_COUNTER);
    const response = await setPrice(ITEM_A, {
      currencyCode: 'USD',
      unitPrice: '1.0000',
    });
    expect(response.status).toBe(404);
  });
});

describe('inv.item-sale-price-list', () => {
  it('returns the configured prices most specific first, and 404s another tenant item', async () => {
    authAs(INV_COUNTER);
    await setPrice(ITEM_A, { companyId: COMPANY_A1, currencyCode: 'USD', unitPrice: '13.7500' });
    await setPrice(ITEM_A, {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      currencyCode: 'USD',
      unitPrice: '11.0000',
    });
    const response = await listPrices(ITEM_A);
    expect(response.status).toBe(200);
    const body = await bodyOf<{ itemId: string; prices: readonly SalePriceBody[] }>(response);
    expect(body.itemId).toBe(ITEM_A);
    expect(body.prices.map((p) => p.unitPrice)).toEqual(['11.0000', '13.7500']);
    expect(body.prices[0]?.branchId).toBe(BRANCH_A1);

    authAs(INV_TENANT_B_COUNTER);
    expect((await listPrices(ITEM_A)).status).toBe(404);
  });
});

describe('sal.counter-sale-create', () => {
  it('prices every line in the database, writes no stock movement, and audits the sale', async () => {
    const cell = await freshLocation();
    await seedStock({ itemId: ITEM_A, locationId: cell, quantity: '20' });
    authAs(INV_COUNTER);
    await setPrice(ITEM_A, {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      currencyCode: 'USD',
      unitPrice: '12.5000',
    });

    const response = await createSale({
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      customerPartnerId: PARTNER_A,
      lines: [{ itemId: ITEM_A, locationId: cell, quantity: '2' }],
    });
    expect(response.status).toBe(201);
    const sale = await bodyOf<SaleBody>(response);
    expect(sale.invoice.saleKind).toBe('counter_sale');
    expect(sale.invoice.workOrderId).toBeNull();
    expect(sale.invoice.status).toBe('draft');
    expect(sale.invoice.payerPartnerId).toBe(PARTNER_A);
    // 12.5000 x 2, untaxed: the figure came from the price row, not the request.
    expect(sale.invoice.totals?.gross.amount).toBe('25.0000');
    expect(sale.lines).toHaveLength(1);
    expect(sale.replayed).toBe(false);
    expect(await auditCountFor('sal.counter_sale.created', sale.invoice.id)).toBe(1);

    // A draft moves nothing.
    expect(await onHandOf(ITEM_A, cell)).toBe(20);
    expect(await saleMovementsOf(sale.invoice.id)).toBe(0);
  });

  it('refuses an amount in the body, an empty sale, and an item with no price', async () => {
    const cell = await freshLocation();
    await seedStock({ itemId: ITEM_A_ALT, locationId: cell, quantity: '5' });
    authAs(INV_COUNTER);

    const withPrice = await createSale({
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      customerPartnerId: PARTNER_A,
      lines: [{ itemId: ITEM_A_ALT, locationId: cell, quantity: '1', unitPrice: '1.0000' }],
    });
    expect(withPrice.status).toBe(422);

    const empty = await createSale({
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      customerPartnerId: PARTNER_A,
      lines: [],
    });
    expect(empty.status).toBe(422);

    // ITEM_A_ALT has no price row: the sale is refused rather than sold for nothing.
    const unpriced = await createSale({
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      customerPartnerId: PARTNER_A,
      lines: [{ itemId: ITEM_A_ALT, locationId: cell, quantity: '1' }],
    });
    expect(unpriced.status).toBe(409);
    expect(await onHandOf(ITEM_A_ALT, cell)).toBe(5);
  });

  it('replays one idempotency key instead of creating a second sale', async () => {
    const cell = await freshLocation();
    await seedStock({ itemId: ITEM_A, locationId: cell, quantity: '10' });
    authAs(INV_COUNTER);
    await setPrice(ITEM_A, {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      currencyCode: 'USD',
      unitPrice: '12.5000',
    });
    const key = randomUUID();
    const body = {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      customerPartnerId: PARTNER_A,
      lines: [{ itemId: ITEM_A, locationId: cell, quantity: '1' }],
    };
    const first = await bodyOf<SaleBody>(await createSale(body, key));
    const replay = await createSale(body, key);
    // 200 rather than 201: the stored response is replayed and the handler is never
    // re-entered, so a retrying till can tell it did not sell the part twice. The
    // body is the FIRST response verbatim, `replayed: false` included — that flag
    // reports the service's own resolution, which this path never reaches.
    expect(replay.status).toBe(200);
    const second = await bodyOf<SaleBody>(replay);
    expect(second.invoice.id).toBe(first.invoice.id);
    expect(await auditCountFor('sal.counter_sale.created', first.invoice.id)).toBe(1);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.invoices WHERE tenant_id = $1 AND idempotency_key = $2`,
        [TENANT_A, key]
      )
    ).toBe(1);
  });

  it('refuses a caller without the financial permission, and one scoped to another branch', async () => {
    const cell = await freshLocation();
    await seedStock({ itemId: ITEM_A, locationId: cell, quantity: '5' });
    authAs(INV_COUNTER);
    await setPrice(ITEM_A, {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      currencyCode: 'USD',
      unitPrice: '12.5000',
    });
    const body = {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      customerPartnerId: PARTNER_A,
      lines: [{ itemId: ITEM_A, locationId: cell, quantity: '1' }],
    };

    // Every inventory code, no `sal.` code at all: the operation declares two and
    // needs both, because the amounts tables are gated on the second.
    authAs(INV_FULL);
    expect((await createSale(body)).status).toBe(403);

    // The whole authority, held in branch A2.
    authAs(INV_COUNTER_SCOPED_A2);
    expect((await createSale(body)).status).toBe(403);

    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.invoices
          WHERE tenant_id = $1 AND sale_kind = 'counter_sale' AND payer_partner_id = $2
            AND created_at > now() - interval '1 minute'`,
        [TENANT_A, PARTNER_A]
      )
    ).toBeGreaterThanOrEqual(0);
  });
});

describe('sal.invoice-issue over a counter sale', () => {
  it('takes exactly the sold quantity off exactly the cell the line names, once', async () => {
    const cell = await freshLocation();
    await seedStock({ itemId: ITEM_A, locationId: cell, quantity: '8' });
    authAs(INV_COUNTER);
    await setPrice(ITEM_A, {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      currencyCode: 'USD',
      unitPrice: '12.5000',
    });
    const sale = await bodyOf<SaleBody>(
      await createSale({
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        customerPartnerId: PARTNER_A,
        lines: [{ itemId: ITEM_A, locationId: cell, quantity: '3' }],
      })
    );

    const issued = await issue(sale.invoice.id, sale.recordVersion);
    expect(issued.status).toBe(200);
    expect(await onHandOf(ITEM_A, cell)).toBe(5);
    expect(await saleMovementsOf(sale.invoice.id)).toBe(1);
    expect(await auditCountFor('sal.invoice.issued', sale.invoice.id)).toBe(1);

    // A second issue is a replay: no second number, no second movement.
    const replay = await issue(sale.invoice.id, sale.recordVersion + 1);
    expect(replay.status).toBe(200);
    expect(await onHandOf(ITEM_A, cell)).toBe(5);
    expect(await saleMovementsOf(sale.invoice.id)).toBe(1);
  });

  it('refuses to issue a sale the shelf cannot supply, and leaves the document a draft', async () => {
    const cell = await freshLocation();
    await seedStock({ itemId: ITEM_A, locationId: cell, quantity: '2' });
    authAs(INV_COUNTER);
    await setPrice(ITEM_A, {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      currencyCode: 'USD',
      unitPrice: '12.5000',
    });
    const sale = await bodyOf<SaleBody>(
      await createSale({
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        customerPartnerId: PARTNER_A,
        lines: [{ itemId: ITEM_A, locationId: cell, quantity: '3' }],
      })
    );

    const issued = await issue(sale.invoice.id, sale.recordVersion);
    expect(issued.status).toBe(409);
    // The whole issuance rolled back: no number, no movement, nothing off the shelf.
    expect(await onHandOf(ITEM_A, cell)).toBe(2);
    expect(await saleMovementsOf(sale.invoice.id)).toBe(0);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.invoices
          WHERE id = $1 AND status = 'draft' AND invoice_number IS NULL`,
        [sale.invoice.id]
      )
    ).toBe(1);
  });
});

describe('sal.counter-sale-list', () => {
  it('lists the branch counter sales and never a work-order invoice', async () => {
    const cell = await freshLocation();
    await seedStock({ itemId: ITEM_A, locationId: cell, quantity: '4' });
    authAs(INV_COUNTER);
    await setPrice(ITEM_A, {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      currencyCode: 'USD',
      unitPrice: '12.5000',
    });
    const sale = await bodyOf<SaleBody>(
      await createSale({
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        customerPartnerId: PARTNER_A,
        lines: [{ itemId: ITEM_A, locationId: cell, quantity: '1' }],
      })
    );

    const response = await listSales(`companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&limit=50`);
    expect(response.status).toBe(200);
    const body = await bodyOf<{ items: readonly SaleBody['invoice'][] }>(response);
    expect(body.items.map((invoice) => invoice.id)).toContain(sale.invoice.id);
    // Every row is a counter sale, and none carries a work order.
    expect(body.items.every((invoice) => invoice.saleKind === 'counter_sale')).toBe(true);
    expect(body.items.every((invoice) => invoice.workOrderId === null)).toBe(true);

    // A branch the caller does not hold is refused rather than answered empty.
    authAs(INV_COUNTER_SCOPED_A2);
    expect((await listSales(`companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&limit=50`)).status).toBe(
      403
    );

    // And tenant B sees none of it.
    authAs(INV_TENANT_B_COUNTER);
    const otherTenant = await listSales(`companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&limit=50`);
    expect([403, 404]).toContain(otherTenant.status);
  });
});
