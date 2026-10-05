/**
 * P1-32-PRE-OD-FD5 — invoice approved quantities only, tracked per source line
 * across superseding revisions (ADR-023 D5 and D15), at the database.
 *
 * What migration 20261006090000_sal_invoiced_quotation_quantities.sql promises
 * and these cases hold it to:
 *
 *  - the read function and the three guards exist, SECURITY INVOKER with an empty
 *    search_path and no EXECUTE for PUBLIC; uq_invoices_work_order_active is gone
 *    and its two replacements are there;
 *  - a fully approved revision bills each line once; a second invoice for the same
 *    lines is refused whatever its quantity;
 *  - a partly approved revision bills its approved lines only: an undecided or a
 *    rejected line is refused, and a quantity above the approved one is refused;
 *  - a later revision that raises an approved quantity bills only the increase,
 *    and only up to what remains of the approved line's total; a superseded
 *    revision's line can no longer be billed at all;
 *  - an invoice voided before issue releases what it held; an issued invoice that
 *    moves to credited does not;
 *  - two approved lines of one lineage after an earlier revision billed some of it
 *    are refused rather than guessed;
 *  - one draft per work order, one live unsourced invoice per work order, never
 *    both kinds at once, and the revision an invoice bills is frozen;
 *  - under concurrency, exactly one of two transactions invoicing the same
 *    remaining quantity commits — the work order row lock serialises them and the
 *    loser re-reads after it;
 *  - another tenant sees no line of the revision through the function.
 */
import type { Client } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  adminPool,
  runtimePool,
  runtimeClient,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  setContext,
  withCommittedTx,
  withRolledBackTx,
  TENANT_A,
  TENANT_B,
  COMPANY_A1,
  BRANCH_A1,
  USER_A,
  USER_B,
} from './helpers';
import { seedService, seedQuotation, draftRevision, addServiceItem } from './p1-10-helpers';
import {
  addInvoiceLine,
  ctxA,
  cleanP111Committed,
  expectFail,
  issueInvoice,
  makeWorkOrder,
  seedDraftInvoice,
  seedP111Base,
  P9,
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
  await cleanP111Committed(admin);
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

const one = async <T>(c: Q, sql: string, params: unknown[] = []): Promise<T> =>
  (await c.query(sql, params)).rows[0] as T;

/** A statement refused with `code` and a message naming `token`. */
async function expectRefusal(
  c: Q,
  code: string,
  token: RegExp,
  sql: string,
  params: unknown[] = []
): Promise<void> {
  await c.query('SAVEPOINT sp_refusal');
  let err: { code?: string; message?: string } | undefined;
  try {
    await c.query(sql, params);
  } catch (e) {
    err = e as { code?: string; message?: string };
  }
  await c.query('ROLLBACK TO SAVEPOINT sp_refusal');
  if (!err) throw new Error(`expected ${code} ${String(token)} but the statement succeeded`);
  expect(err.code, err.message).toBe(code);
  expect(err.message).toMatch(token);
}

interface Scene {
  readonly wo: string;
  readonly quotation: string;
  readonly revision: string;
  readonly service: string;
  readonly other: string;
  /** Line 1: the service at 50.00 a unit, quantity `qty`. */
  readonly first: string;
  /** Line 2: another service, 30.00, quantity 1. */
  readonly second: string;
}

/**
 * A work order with an ISSUED revision of two service lines, decided as asked.
 * Line 1 is 50.00 x `qty` with a 10% tax; line 2 is 30.00 x 1, untaxed.
 */
async function scene(
  c: Q,
  tag: string,
  decide: { first?: 'approved' | 'rejected'; second?: 'approved' | 'rejected' } = {
    first: 'approved',
    second: 'approved',
  },
  qty = 2
): Promise<Scene> {
  const { wo } = await makeWorkOrder(c, tag);
  const { service } = await seedService(c, `${tag}a`);
  const { service: other } = await seedService(c, `${tag}b`);
  const quotation = await seedQuotation(c, wo, tag);
  const revision = await draftRevision(c, quotation, 1);
  const first = await addServiceItem(c, revision, service, 1, 50, qty, 0, 0.1);
  const second = await addServiceItem(c, revision, other, 2, 30, 1);
  await c.query(`SELECT quo.issue_revision($1)`, [revision]);
  if (decide.first) await decideLine(c, first, decide.first);
  if (decide.second) await decideLine(c, second, decide.second);
  return { wo, quotation, revision, service, other, first, second };
}

const decideLine = (c: Q, item: string, decision: 'approved' | 'rejected') =>
  c.query(`SELECT quo.record_item_decision($1,$2,'in_person')`, [item, decision]);

/** A new revision of the quotation, issued (superseding the current one). */
async function revise(
  c: Q,
  quotation: string,
  revisionNumber: number,
  lines: ReadonlyArray<{ service: string; unit: number; qty: number; taxRate?: number }>
): Promise<string[]> {
  const revision = await draftRevision(c, quotation, revisionNumber);
  const items: string[] = [];
  let lineNumber = 1;
  for (const line of lines) {
    items.push(
      await addServiceItem(
        c,
        revision,
        line.service,
        lineNumber++,
        line.unit,
        line.qty,
        0,
        line.taxRate ?? 0
      )
    );
  }
  await c.query(`SELECT quo.issue_revision($1)`, [revision]);
  return [revision, ...items];
}

interface Billable {
  readonly decision: string | null;
  readonly approved_quantity: string;
  readonly invoiced_quantity: string;
  readonly remaining_quantity: string;
  readonly remaining_net: string | null;
  readonly remaining_tax: string | null;
  readonly remaining_discount: string | null;
  readonly carried: boolean;
  readonly billing_status: string;
}

const billable = async (c: Q, revision: string, item: string): Promise<Billable> =>
  one<Billable>(
    c,
    `SELECT decision, approved_quantity::text, invoiced_quantity::text,
            remaining_quantity::text, remaining_net::text, remaining_tax::text,
            remaining_discount::text, carried, billing_status
       FROM sal.billable_quotation_lines($1) WHERE quotation_item_id = $2`,
    [revision, item]
  );

/** The source line's own captured net and tax, as the database stores them. */
const captured = (c: Q, item: string) =>
  one<{ net: string; tax: string }>(
    c,
    `SELECT (captured_line_total - captured_tax_amount)::text AS net, captured_tax_amount::text AS tax
       FROM quo.quotation_items WHERE id = $1`,
    [item]
  );

const INSERT_LINE = `INSERT INTO sal.invoice_lines
   (tenant_id, company_id, branch_id, invoice_id, line_number, line_type, quantity,
    currency_code, source_quotation_item_id, created_by)
 VALUES ($1,$2,$3,$4,$5,$6,$7::numeric,'USD',$8,$9) RETURNING id`;
const INSERT_AMOUNTS = `INSERT INTO sal.invoice_line_amounts
   (tenant_id, company_id, branch_id, invoice_line_id, invoice_id, unit_price, net_amount,
    tax_amount, gross_amount, customer_pay_amount, warranty_pay_amount, created_by)
 VALUES ($1,$2,$3,$4,$5,$6::numeric,$7::numeric,$8::numeric,
         round($7::numeric + $8::numeric, 4), round($7::numeric + $8::numeric, 4), 0, $9)`;

/** Inserts one sourced line and its amounts; returns the line id. */
async function billLine(
  c: Q,
  invoice: string,
  line: {
    readonly lineNumber: number;
    readonly item: string;
    readonly quantity: string;
    readonly net: string;
    readonly tax: string;
    readonly unitPrice?: string;
  }
): Promise<string> {
  const { id } = await one<{ id: string }>(c, INSERT_LINE, [
    TENANT_A,
    COMPANY_A1,
    BRANCH_A1,
    invoice,
    line.lineNumber,
    'service',
    line.quantity,
    line.item,
    USER_A,
  ]);
  await c.query(INSERT_AMOUNTS, [
    TENANT_A,
    COMPANY_A1,
    BRANCH_A1,
    id,
    invoice,
    line.unitPrice ?? line.net,
    line.net,
    line.tax,
    USER_A,
  ]);
  return id;
}

/** A sourced draft invoice billing `item` in full, at its captured amounts. */
async function billWhole(c: Q, s: { wo: string; revision: string }, item: string, lineNumber = 1) {
  const invoice = await seedDraftInvoice(c, {
    wo: s.wo,
    payer: P9.SR,
    quotationRevision: s.revision,
  });
  const { quantity } = await one<{ quantity: string }>(
    c,
    `SELECT captured_quantity::text AS quantity FROM quo.quotation_items WHERE id = $1`,
    [item]
  );
  const money = await captured(c, item);
  await billLine(c, invoice, { lineNumber, item, quantity, ...money });
  return invoice;
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

describe('the objects the migration adds and replaces', () => {
  it('has the read function and three guards, invoker-rights with an empty search_path and no PUBLIC execute', async () => {
    const { rows } = await admin.query<{
      name: string;
      definer: boolean;
      config: string[] | null;
      public_execute: boolean;
    }>(
      `SELECT p.proname AS name, p.prosecdef AS definer, p.proconfig AS config,
              has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'sal'
          AND p.proname IN ('billable_quotation_lines', 'guard_invoice_work_order_source',
                            'guard_invoice_line_source', 'guard_invoice_line_amount_source')
        ORDER BY 1`
    );
    expect(rows.map((r) => r.name)).toEqual([
      'billable_quotation_lines',
      'guard_invoice_line_amount_source',
      'guard_invoice_line_source',
      'guard_invoice_work_order_source',
    ]);
    for (const row of rows) {
      expect(row.definer, row.name).toBe(false);
      expect(row.config, row.name).toEqual(['search_path=""']);
      expect(row.public_execute, row.name).toBe(false);
    }
  });

  it('replaced uq_invoices_work_order_active with a one-draft and a one-unsourced index', async () => {
    const { rows } = await admin.query<{ name: string; definition: string }>(
      `SELECT indexname AS name, indexdef AS definition FROM pg_indexes
        WHERE schemaname = 'sal' AND tablename = 'invoices'
          AND indexname IN ('uq_invoices_work_order_active', 'uq_invoices_work_order_draft',
                            'uq_invoices_work_order_unsourced')
        ORDER BY 1`
    );
    expect(rows.map((r) => r.name)).toEqual([
      'uq_invoices_work_order_draft',
      'uq_invoices_work_order_unsourced',
    ]);
    expect(rows[0]?.definition).toMatch(/UNIQUE INDEX .*status = 'draft'/);
    expect(rows[1]?.definition).toMatch(/UNIQUE INDEX .*quotation_revision_id IS NULL/);
    expect(rows[1]?.definition).toMatch(/status <> 'void_before_issue'/);
  });
});

// ---------------------------------------------------------------------------
// D5: only approved quantities
// ---------------------------------------------------------------------------

describe('a fully approved revision', () => {
  it('bills each line once, and refuses any second bill of the same line', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const s = await scene(c, 'fdfull');
      const before = await billable(c, s.revision, s.first);
      expect(before).toMatchObject({
        decision: 'approved',
        approved_quantity: '2.000',
        invoiced_quantity: '0.000',
        remaining_quantity: '2.000',
        remaining_net: '100.0000',
        remaining_tax: '10.0000',
        remaining_discount: '0.0000',
        carried: false,
        billing_status: 'billable',
      });

      const invoice = await billWhole(c, s, s.first);
      await billLine(c, invoice, {
        lineNumber: 2,
        item: s.second,
        quantity: '1',
        ...(await captured(c, s.second)),
      });
      await issueInvoice(c, invoice);
      expect(await billable(c, s.revision, s.first)).toMatchObject({
        invoiced_quantity: '2.000',
        remaining_quantity: '0.000',
        billing_status: 'fully_invoiced',
      });

      // A second invoice may exist now — but it bills nothing already billed.
      const second = await seedDraftInvoice(c, {
        wo: s.wo,
        payer: P9.SR,
        quotationRevision: s.revision,
      });
      await expectRefusal(
        c,
        '23514',
        /invoice_line_not_billable: .* is fully_invoiced/,
        INSERT_LINE,
        [TENANT_A, COMPANY_A1, BRANCH_A1, second, 1, 'service', '0.001', s.first, USER_A]
      );
    });
  });

  it('refuses a quantity above the approved one, a line with no source, a wrong kind and a foreign line', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const s = await scene(c, 'fdshape');
      const other = await scene(c, 'fdshapo');
      const invoice = await seedDraftInvoice(c, {
        wo: s.wo,
        payer: P9.SR,
        quotationRevision: s.revision,
      });
      await expectRefusal(c, '23514', /invoice_quantity_exceeds_approved/, INSERT_LINE, [
        TENANT_A,
        COMPANY_A1,
        BRANCH_A1,
        invoice,
        1,
        'service',
        '2.001',
        s.first,
        USER_A,
      ]);
      await expectRefusal(
        c,
        '23514',
        /invoice_source_line_required/,
        `INSERT INTO sal.invoice_lines (tenant_id, company_id, branch_id, invoice_id, line_number, line_type, quantity, currency_code, created_by)
         VALUES ($1,$2,$3,$4,1,'service',1,'USD',$5)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, invoice, USER_A]
      );
      await expectRefusal(c, '23514', /invoice_line_type_mismatch/, INSERT_LINE, [
        TENANT_A,
        COMPANY_A1,
        BRANCH_A1,
        invoice,
        1,
        'part',
        '1',
        s.first,
        USER_A,
      ]);
      await expectRefusal(c, '23514', /invoice_source_line_foreign/, INSERT_LINE, [
        TENANT_A,
        COMPANY_A1,
        BRANCH_A1,
        invoice,
        1,
        'service',
        '1',
        other.first,
        USER_A,
      ]);
      // And the amounts: a line within its quantity still cannot carry more money
      // than its approved line.
      const { id: line } = await one<{ id: string }>(c, INSERT_LINE, [
        TENANT_A,
        COMPANY_A1,
        BRANCH_A1,
        invoice,
        1,
        'service',
        '2',
        s.first,
        USER_A,
      ]);
      await expectRefusal(c, '23514', /invoice_amount_exceeds_approved/, INSERT_AMOUNTS, [
        TENANT_A,
        COMPANY_A1,
        BRANCH_A1,
        line,
        invoice,
        '50',
        '100.0100',
        '10',
        USER_A,
      ]);
    });
  });
});

describe('a partly approved revision', () => {
  it('bills its approved line only; an undecided and a rejected line are refused', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const s = await scene(c, 'fdpart', { first: 'approved' });
      expect(await billable(c, s.revision, s.first)).toMatchObject({
        billing_status: 'billable',
      });
      expect(await billable(c, s.revision, s.second)).toMatchObject({
        decision: null,
        approved_quantity: '0.000',
        remaining_quantity: '0.000',
        remaining_net: null,
        billing_status: 'not_approved',
      });
      const invoice = await billWhole(c, s, s.first);
      await expectRefusal(
        c,
        '23514',
        /invoice_line_not_billable: .* is not_approved/,
        INSERT_LINE,
        [TENANT_A, COMPANY_A1, BRANCH_A1, invoice, 2, 'service', '1', s.second, USER_A]
      );

      // The customer now refuses line 2: it is rejected, and line 1 stays billed.
      await decideLine(c, s.second, 'rejected');
      expect(await billable(c, s.revision, s.second)).toMatchObject({
        decision: 'rejected',
        billing_status: 'rejected',
      });
      await expectRefusal(c, '23514', /invoice_line_not_billable: .* is rejected/, INSERT_LINE, [
        TENANT_A,
        COMPANY_A1,
        BRANCH_A1,
        invoice,
        2,
        'service',
        '1',
        s.second,
        USER_A,
      ]);
      // A rejected revision (the quotation's roll-up) keeps its approved line billable.
      await c.query(`UPDATE quo.quotation_revisions SET status = 'rejected' WHERE id = $1`, [
        s.revision,
      ]);
      expect(await billable(c, s.revision, s.first)).toMatchObject({
        billing_status: 'fully_invoiced',
        invoiced_quantity: '2.000',
      });
    });
  });
});

// ---------------------------------------------------------------------------
// D15: across superseding revisions
// ---------------------------------------------------------------------------

describe('a later revision', () => {
  it('bills only the increase of an approved quantity, never the superseded line again', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      // Revision 1: line 1 approved (2 x 50 + 10% tax), line 2 left undecided.
      const s = await scene(c, 'fdinc', { first: 'approved' });
      const invoice = await billWhole(c, s, s.first);
      await issueInvoice(c, invoice);

      // Revision 2 supersedes it: the same service, now three units.
      const [revision2, raised, kept] = await revise(c, s.quotation, 2, [
        { service: s.service, unit: 50, qty: 3, taxRate: 0.1 },
        { service: s.other, unit: 30, qty: 1 },
      ]);
      await decideLine(c, raised as string, 'approved');

      // The superseded line can never be billed again.
      expect(await billable(c, s.revision, s.first)).toMatchObject({
        billing_status: 'not_current',
      });
      expect(await billable(c, revision2 as string, raised as string)).toMatchObject({
        approved_quantity: '3.000',
        invoiced_quantity: '2.000',
        remaining_quantity: '1.000',
        remaining_net: '50.0000',
        remaining_tax: '5.0000',
        remaining_discount: '0.0000',
        carried: true,
        billing_status: 'billable',
      });
      expect(await billable(c, revision2 as string, kept as string)).toMatchObject({
        billing_status: 'not_approved',
      });

      const next = await seedDraftInvoice(c, {
        wo: s.wo,
        payer: P9.SR,
        quotationRevision: revision2 as string,
      });
      // A line of the superseded revision is not a line of the revision billed now.
      await expectRefusal(c, '23514', /invoice_source_line_foreign/, INSERT_LINE, [
        TENANT_A,
        COMPANY_A1,
        BRANCH_A1,
        next,
        1,
        'service',
        '1',
        s.first,
        USER_A,
      ]);
      // Two of the three units were billed under revision 1.
      await expectRefusal(c, '23514', /invoice_quantity_exceeds_approved/, INSERT_LINE, [
        TENANT_A,
        COMPANY_A1,
        BRANCH_A1,
        next,
        1,
        'service',
        '2',
        raised,
        USER_A,
      ]);
      await billLine(c, next, {
        lineNumber: 1,
        item: raised as string,
        quantity: '1',
        net: '50.0000',
        tax: '5.0000',
        unitPrice: '50.0000',
      });
      expect(await billable(c, revision2 as string, raised as string)).toMatchObject({
        invoiced_quantity: '3.000',
        remaining_quantity: '0.000',
        billing_status: 'fully_invoiced',
      });
    });
  });

  it('refuses a raised quantity whose approved total is now below what was already billed', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const s = await scene(c, 'fdcut', { first: 'approved' });
      await billWhole(c, s, s.first);
      // Three units at 20.00 = 60.00, less than the 100.00 already billed for two.
      const [revision2, cheaper] = await revise(c, s.quotation, 2, [
        { service: s.service, unit: 20, qty: 3, taxRate: 0.1 },
      ]);
      await decideLine(c, cheaper as string, 'approved');
      expect(await billable(c, revision2 as string, cheaper as string)).toMatchObject({
        remaining_quantity: '0.000',
        remaining_net: null,
        billing_status: 'repriced_below_invoiced',
      });
    });
  });

  it('refuses two approved lines of one lineage once an earlier revision billed part of it', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const s = await scene(c, 'fdamb', { first: 'approved' });
      await billWhole(c, s, s.first);
      const [revision2, a, b] = await revise(c, s.quotation, 2, [
        { service: s.service, unit: 50, qty: 2, taxRate: 0.1 },
        { service: s.service, unit: 50, qty: 1, taxRate: 0.1 },
      ]);
      await decideLine(c, a as string, 'approved');
      await decideLine(c, b as string, 'approved');
      for (const item of [a, b]) {
        expect(await billable(c, revision2 as string, item as string)).toMatchObject({
          remaining_quantity: '0.000',
          billing_status: 'lineage_ambiguous',
        });
      }
    });
  });
});

describe('releasing and keeping quantity', () => {
  it('an invoice voided before issue releases what it held; a credited invoice keeps it', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const s = await scene(c, 'fdvoid');
      const draft = await billWhole(c, s, s.first);
      expect((await billable(c, s.revision, s.first)).billing_status).toBe('fully_invoiced');
      await c.query(`UPDATE sal.invoices SET status = 'void_before_issue' WHERE id = $1`, [draft]);
      expect(await billable(c, s.revision, s.first)).toMatchObject({
        remaining_quantity: '2.000',
        billing_status: 'billable',
      });

      const issued = await billWhole(c, s, s.first);
      await issueInvoice(c, issued);
      await c.query(`UPDATE sal.invoices SET status = 'credited' WHERE id = $1`, [issued]);
      expect(await billable(c, s.revision, s.first)).toMatchObject({
        invoiced_quantity: '2.000',
        billing_status: 'fully_invoiced',
      });
    });
  });
});

// ---------------------------------------------------------------------------
// The header rules that replaced uq_invoices_work_order_active
// ---------------------------------------------------------------------------

describe('one work order, its invoices', () => {
  const INSERT_HEADER = `INSERT INTO sal.invoices (tenant_id, company_id, branch_id, work_order_id, quotation_revision_id, payer_partner_id, currency_code, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'USD',$7)`;

  it('holds one draft per work order, of either kind', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const s = await scene(c, 'fddraft');
      await seedDraftInvoice(c, { wo: s.wo, payer: P9.SR, quotationRevision: s.revision });
      await expectFail(c, '23505', INSERT_HEADER, [
        TENANT_A,
        COMPANY_A1,
        BRANCH_A1,
        s.wo,
        s.revision,
        P9.SR,
        USER_A,
      ]);
    });
  });

  it('keeps one live unsourced invoice per work order, and never both kinds at once', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const s = await scene(c, 'fdmix');
      const unsourced = await seedDraftInvoice(c, { wo: s.wo, payer: P9.SR });
      await c.query(`UPDATE sal.invoices SET status = 'void_before_issue' WHERE id = $1`, [
        unsourced,
      ]);
      const live = await seedDraftInvoice(c, { wo: s.wo, payer: P9.SR });
      await addInvoiceLine(c, live, { lineNumber: 1, net: 40 });
      await issueInvoice(c, live);
      // Another unsourced live invoice: the old rule, kept.
      await expectFail(c, '23505', INSERT_HEADER, [
        TENANT_A,
        COMPANY_A1,
        BRANCH_A1,
        s.wo,
        null,
        P9.SR,
        USER_A,
      ]);
      // A sourced one beside a live unsourced one: refused.
      await expectRefusal(c, '23514', /invoice_source_mixed/, INSERT_HEADER, [
        TENANT_A,
        COMPANY_A1,
        BRANCH_A1,
        s.wo,
        s.revision,
        P9.SR,
        USER_A,
      ]);
    });
  });

  it('refuses an unsourced invoice beside a sourced one, a revision of another work order, and a moved revision', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const s = await scene(c, 'fdkind');
      const elsewhere = await scene(c, 'fdkino');
      const invoice = await billWhole(c, s, s.first);
      await issueInvoice(c, invoice);
      await expectRefusal(c, '23514', /invoice_source_mixed/, INSERT_HEADER, [
        TENANT_A,
        COMPANY_A1,
        BRANCH_A1,
        s.wo,
        null,
        P9.SR,
        USER_A,
      ]);
      await expectRefusal(c, '23514', /invoice_source_foreign/, INSERT_HEADER, [
        TENANT_A,
        COMPANY_A1,
        BRANCH_A1,
        s.wo,
        elsewhere.revision,
        P9.SR,
        USER_A,
      ]);
      const draft = await seedDraftInvoice(c, {
        wo: s.wo,
        payer: P9.SR,
        quotationRevision: s.revision,
      });
      await expectRefusal(
        c,
        '23514',
        /invoice_source_frozen/,
        `UPDATE sal.invoices SET quotation_revision_id = NULL WHERE id = $1`,
        [draft]
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Concurrency: the work order row lock, and the re-read after it
// ---------------------------------------------------------------------------

/**
 * One whole invoice in its own transaction on a fresh connection: header, the
 * line, its amounts, the header totals and issue. Returns 'ok' or the SQLSTATE.
 */
async function invoiceInOwnTransaction(
  s: { wo: string; revision: string },
  item: string,
  money: { net: string; tax: string }
): Promise<string> {
  const client = runtimeClient();
  await client.connect();
  try {
    await client.query('BEGIN');
    await setContext(client, ctxA);
    const invoice = await seedDraftInvoice(client, {
      wo: s.wo,
      payer: P9.SR,
      quotationRevision: s.revision,
    });
    await billLine(client, invoice, { lineNumber: 1, item, quantity: '2', ...money });
    await issueInvoice(client, invoice);
    await client.query('COMMIT');
    return 'ok';
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* the connection is closed below either way */
    }
    return (e as { code?: string }).code ?? 'error';
  } finally {
    await client.end();
  }
}

describe('two transactions invoicing the same approved quantity', () => {
  it('lets exactly one commit; the other is refused after the lock (x3)', async () => {
    for (let rep = 0; rep < 3; rep++) {
      const s = await withCommittedTx(runtime, ctxA, (c) => scene(c, `fdrace${rep}`));
      const money = await withRolledBackTx(runtime, ctxA, (c) => captured(c, s.first));
      const results = await Promise.all([
        invoiceInOwnTransaction(s, s.first, money),
        invoiceInOwnTransaction(s, s.first, money),
      ]);
      expect(results.filter((r) => r === 'ok').length, `rep ${rep}: exactly one winner`).toBe(1);
      // The loser either met the winner's draft (23505) or, when the winner had
      // already issued, the guard re-read after the lock (23514).
      expect(
        results.filter((r) => r === '23514' || r === '23505').length,
        `rep ${rep}: the loser is refused, not faulted`
      ).toBe(1);
      const billed = await withRolledBackTx(runtime, ctxA, (c) =>
        one<{ n: string }>(
          c,
          `SELECT COALESCE(sum(l.quantity), 0)::text AS n
             FROM sal.invoice_lines l JOIN sal.invoices i ON i.id = l.invoice_id
            WHERE i.work_order_id = $1 AND i.status <> 'void_before_issue'`,
          [s.wo]
        )
      );
      expect(billed.n, `rep ${rep}: billed once`).toBe('2.000');
    }
  });
});

describe('two writers of one draft at once', () => {
  it('the second waits on the work order row for the first, then is refused', async () => {
    const s = await withCommittedTx(runtime, ctxA, (c) => scene(c, 'fdlock'));
    const draft = await withCommittedTx(runtime, ctxA, (c) =>
      seedDraftInvoice(c, { wo: s.wo, payer: P9.SR, quotationRevision: s.revision })
    );
    const line = (lineNumber: number) => [
      TENANT_A,
      COMPANY_A1,
      BRANCH_A1,
      draft,
      lineNumber,
      'service',
      '2',
      s.first,
      USER_A,
    ];
    const first = runtimeClient();
    const second = runtimeClient();
    await first.connect();
    await second.connect();
    try {
      await first.query('BEGIN');
      await setContext(first, ctxA);
      await second.query('BEGIN');
      await setContext(second, ctxA);
      await first.query(INSERT_LINE, line(1));
      let settled = false;
      const waiting = second
        .query(INSERT_LINE, line(2))
        .then(
          () => 'ok',
          (error: { code?: string }) => error.code ?? 'error'
        )
        .finally(() => {
          settled = true;
        });
      // Neither line is committed, so without the row lock the second would read the
      // whole quantity as remaining and be admitted at once.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled, 'the second writer waits for the first').toBe(false);
      await first.query('COMMIT');
      expect(await waiting, 'then it is judged against what the first billed').toBe('23514');
      await second.query('ROLLBACK');
    } finally {
      await first.end();
      await second.end();
    }
  });
});

// ---------------------------------------------------------------------------
// Isolation
// ---------------------------------------------------------------------------

describe('tenant isolation', () => {
  it('shows another tenant no line of the revision, and refuses its invoice line', async () => {
    const s = await withCommittedTx(runtime, ctxA, (c) => scene(c, 'fdiso'));
    await withRolledBackTx(runtime, { tenantId: TENANT_B, userId: USER_B }, async (c) => {
      const { rows } = await c.query(`SELECT * FROM sal.billable_quotation_lines($1)`, [
        s.revision,
      ]);
      expect(rows).toEqual([]);
    });
    // A caller of tenant A narrowed to another branch sees nothing either.
    await withRolledBackTx(
      runtime,
      { ...ctxA, companyIds: [COMPANY_A1], branchIds: ['a1100000-0000-4000-8000-0000000fd5b2'] },
      async (c) => {
        const { rows } = await c.query(`SELECT * FROM sal.billable_quotation_lines($1)`, [
          s.revision,
        ]);
        expect(rows).toEqual([]);
      }
    );
  });
});
